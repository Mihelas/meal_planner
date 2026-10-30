import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, emptyState, migrate, mergeStates, cloudDoc, sameDoc, addWeight, weightTrend,
  STORAGE_KEY, SCHEMA_VERSION,
} from '../src/store.js';
import {
  generateWeek, defaultSettings, PLAN_VERSION, pantryKey, legacyPantryKey,
} from '../src/planner.js';

/** A localStorage stand-in, so the store can be tested without a browser. */
function fakeWindow({ throwOnWrite = false, quota = Infinity } = {}) {
  const map = new Map();
  return {
    localStorage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => {
        if (throwOnWrite) throw new Error('denied');
        if (v.length > quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
        map.set(k, v);
      },
      removeItem: (k) => map.delete(k),
    },
    _map: map,
  };
}

test('a fresh store starts from the defaults and persists', () => {
  const win = fakeWindow();
  const s = createStore(win);
  s.load();
  assert.equal(s.persistent, true);
  assert.equal(s.state.schema, SCHEMA_VERSION);
  assert.deepEqual(s.state.memory.banned, []);
  s.save({ ...s.state, memory: { ...s.state.memory, banned: ['d-huehner-ramen'] } });
  assert.ok(win._map.get(STORAGE_KEY).includes('d-huehner-ramen'));
});

test('everything survives a reload — that is the whole point of memory', () => {
  const win = fakeWindow();
  const settings = defaultSettings();
  const plan = generateWeek(settings, { banned: [] });
  const a = createStore(win);
  a.load();
  a.save({
    ...a.state, plan,
    memory: { banned: ['s-popcorn'], favourites: ['d-puten-chili'] },
    settings: { ...settings, dayModes: ['office', 'office', 'together', 'wfh', 'wfh', 'together', 'together'] },
    bought: { 'banane-g': true },
    weights: [{ date: '2026-09-28', person1: 100, person2: 65 }],
  });

  const b = createStore(win);   // a brand new session, same browser
  b.load();
  assert.deepEqual(b.state.memory.banned, ['s-popcorn']);
  assert.deepEqual(b.state.memory.favourites, ['d-puten-chili']);
  assert.equal(b.state.settings.dayModes[2], 'together');
  assert.equal(b.state.bought['banane-g'], true);
  assert.equal(b.state.weights[0].person1, 100);
  assert.equal(b.state.plan.days.length, 7);
  assert.equal(b.state.plan.days[0].dinner.recipeId, plan.days[0].dinner.recipeId);
});

test('locks inside a saved plan survive the round trip', () => {
  const win = fakeWindow();
  const settings = defaultSettings();
  const plan = generateWeek(settings, { banned: [] });
  plan.days[3].dinner.locked = true;
  const a = createStore(win); a.load(); a.save({ ...a.state, plan });
  const b = createStore(win); b.load();
  assert.equal(b.state.plan.days[3].dinner.locked, true);
});

test('a blocked localStorage degrades to in-memory instead of crashing', () => {
  const s = createStore(fakeWindow({ throwOnWrite: true }));
  s.load();
  assert.equal(s.persistent, false);
  s.save({ ...s.state, memory: { banned: ['x'], favourites: [] } });
  assert.deepEqual(s.state.memory.banned, ['x'], 'the session still works');
});

test('no window at all (server-side, or a file with storage disabled) is survivable', () => {
  const s = createStore(undefined);
  s.load();
  assert.equal(s.persistent, false);
  assert.equal(s.state.schema, SCHEMA_VERSION);
});

test('a full quota is reported, not swallowed', () => {
  const s = createStore(fakeWindow({ quota: 10 }));
  s.load();
  s.save({ ...s.state, memory: { banned: ['a-very-long-id-to-blow-the-quota'], favourites: [] } });
  assert.ok(s.error && /full/i.test(s.error), `expected a quota message, got ${s.error}`);
});

test('corrupt stored JSON starts fresh with an explanation', () => {
  const win = fakeWindow();
  win.localStorage.setItem(STORAGE_KEY, '{ not json');
  const s = createStore(win);
  s.load();
  assert.equal(s.state.schema, SCHEMA_VERSION);
  assert.ok(s.loadError && s.loadError.length > 10, 'the user should be told why their week vanished');
  // The app saves a fresh week straight after this, which must not erase the reason.
  s.save({ ...s.state, memory: { banned: [], favourites: [] } });
  assert.ok(s.loadError, 'the explanation was wiped by the next successful save');
  assert.equal(s.error, null, 'that save worked, so there is no save error');
});

// ---------- Migration ----------
test('migrate fills in everything a partial blob is missing', () => {
  const m = migrate({ memory: { banned: ['s-popcorn'] } });
  assert.deepEqual(m.memory.banned, ['s-popcorn']);
  assert.equal(m.settings.dayModes.length, 7);
  assert.equal(m.settings.people.length, 2);
  assert.ok(m.settings.people[0].weightKg > 0, 'people must be complete or the maths is wrong');
  assert.deepEqual(m.weights, []);
});

test('migrate repairs nonsense without throwing', () => {
  for (const junk of [null, 42, 'nope', [], { settings: 'broken' }, { memory: { banned: 'popcorn' } }]) {
    const m = migrate(junk);
    assert.equal(m.settings.dayModes.length, 7, `failed on ${JSON.stringify(junk)}`);
    assert.ok(Array.isArray(m.memory.banned));
  }
});

test('a plan from an older engine is dropped, but the bans and log are kept', () => {
  const m = migrate({
    plan: { version: PLAN_VERSION - 1, days: [{}] },
    memory: { banned: ['s-popcorn'] },
    weights: [{ date: '2026-09-01', person1: 104 }],
  });
  assert.equal(m.plan, null, 'a stale plan must not be rendered');
  assert.deepEqual(m.memory.banned, ['s-popcorn']);
  assert.equal(m.weights.length, 1);
  assert.ok(m.migrationNote, 'the user should be told the week was rebuilt');
});

test('a truncated plan (right version, wrong shape) is also dropped', () => {
  const m = migrate({ plan: { version: PLAN_VERSION, days: [{}, {}] } });
  assert.equal(m.plan, null);
});

// ---------- Export / import ----------
test('export then import reproduces the state exactly', () => {
  const win = fakeWindow();
  const s = createStore(win); s.load();
  const plan = generateWeek(defaultSettings(), { banned: [] });
  s.save({ ...s.state, plan, memory: { banned: ['s-mandeln'], favourites: [] } });
  const json = s.exportJSON();

  const fresh = createStore(fakeWindow()); fresh.load();
  fresh.importJSON(json);
  assert.deepEqual(fresh.state.memory.banned, ['s-mandeln']);
  assert.equal(fresh.state.plan.days[4].dinner.recipeId, plan.days[4].dinner.recipeId);
});

test('exported JSON is human-readable and stamped', () => {
  const s = createStore(fakeWindow()); s.load();
  const json = s.exportJSON();
  assert.ok(json.includes('\n'), 'export should be pretty-printed, not one line');
  assert.ok(JSON.parse(json).exportedAt, 'no timestamp on the export');
});

test('importing junk throws a message rather than wiping the plan', () => {
  const s = createStore(fakeWindow()); s.load();
  const plan = generateWeek(defaultSettings(), { banned: [] });
  s.save({ ...s.state, plan });
  assert.throws(() => s.importJSON('not json at all'));
  assert.throws(() => s.importJSON('"a string"'));
  assert.equal(s.state.plan.days.length, 7, 'a failed import destroyed the existing week');
});

test('reset clears storage as well as memory', () => {
  const win = fakeWindow();
  const s = createStore(win); s.load();
  s.save({ ...s.state, memory: { banned: ['s-popcorn'], favourites: [] } });
  s.reset();
  assert.deepEqual(s.state.memory.banned, []);
  assert.equal(win.localStorage.getItem(STORAGE_KEY), null);
});

// ---------- Weight log ----------
test('a second weigh-in on the same day replaces the first', () => {
  let w = addWeight([], { date: '2026-09-28', person1: 100 });
  w = addWeight(w, { date: '2026-09-28', person1: 99.6 });
  assert.equal(w.length, 1);
  assert.equal(w[0].person1, 99.6);
});

test('the log stays in date order however it is entered', () => {
  let w = addWeight([], { date: '2026-10-05', person1: 99 });
  w = addWeight(w, { date: '2026-09-28', person1: 100 });
  assert.deepEqual(w.map((x) => x.date), ['2026-09-28', '2026-10-05']);
});

test('the trend is kg per week, and honest about needing two points', () => {
  assert.equal(weightTrend([], 'person1'), null);
  assert.equal(weightTrend([{ date: '2026-09-28', person1: 100 }], 'person1'), null);
  const t = weightTrend([
    { date: '2026-09-28', person1: 100 },
    { date: '2026-10-12', person1: 99 },
  ], 'person1');
  assert.equal(t.days, 14);
  assert.ok(Math.abs(t.kgPerWeek - -0.5) < 1e-9, `got ${t.kgPerWeek}`);
});

test('the trend ignores a person who was not weighed', () => {
  const log = [{ date: '2026-09-28', person1: 100 }, { date: '2026-10-05', person1: 99.5, person2: 64 }];
  assert.ok(weightTrend(log, 'person1'));
  assert.equal(weightTrend(log, 'person2'), null, 'one data point is not a trend');
});

test('emptyState is a complete, usable state on its own', () => {
  const e = emptyState();
  for (const k of ['schema', 'settings', 'memory', 'plan', 'bought', 'weights', 'ui']) {
    assert.ok(k in e, `emptyState is missing ${k}`);
  }
  assert.equal(e.plan, null, 'a fresh install has no week yet');
});

test('an existing cupboard survives pantryKey learning to spell', () => {
  // The old key dropped umlauts: Olivenoel -> "oliven-l-ml". If migrate did not
  // move these, the first launch after an update would look like the app had
  // forgotten everything already bought and everything in the cupboard.
  const oil = { item: 'Olivenöl', qty: 20, unit: 'ml' };
  const was = legacyPantryKey(oil);
  const now = pantryKey(oil);
  assert.notEqual(was, now, 'fixture is pointless if the key did not change');

  const out = migrate({
    memory: { pantry: { [was]: true, 'reis-g': true } },
    bought: { [was]: true },
    itemShop: { [was]: 'aldi' },
  });

  assert.equal(out.memory.pantry[now], true, 'cupboard entry was not moved');
  assert.equal(out.memory.pantry[was], undefined, 'old cupboard key left behind');
  assert.equal(out.memory.pantry['reis-g'], true, 'an unaffected key must not move');
  assert.equal(out.bought[now], true, 'shopping tick was not moved');
  assert.equal(out.itemShop[now], 'aldi', 'per-item shop was not moved');

  // Idempotent: a state already migrated must come back unchanged.
  const twice = migrate(out);
  assert.equal(twice.memory.pantry[now], true);
  assert.deepEqual(Object.keys(twice.bought), [now]);
});

test('a key from the user’s own recipe is moved too', () => {
  // The remap is rebuilt from ingredient lists, and a custom recipe’s ingredients
  // are in state rather than in the built-in library.
  const ing = { item: 'Grüner Spargel', qty: 200, unit: 'g', aisle: 'produce' };
  const was = legacyPantryKey(ing);
  const out = migrate({
    memory: {
      pantry: { [was]: true },
      custom: [{
        id: 'u-spargel-400', name: 'Spargel vom Blech', slot: 'dinner',
        kcal: 400, protein: 25, minutes: 20, cuisine: 'northern',
        equipment: ['oven'], tags: ['custom'], ingredients: [ing], method: ['Backen.'],
      }],
    },
  });
  assert.equal(out.memory.pantry[pantryKey(ing)], true);
  assert.equal(out.memory.pantry[was], undefined);
});

// ------------------------------------------------------- the household row
//
// `cloud` is the bookmark for the shared row: which household it belongs to,
// which revision this device last saw land, and which `savedAt` is known to be
// in it. All three are about *this device's* relationship to the row, which is
// why none of them may travel inside the document -- see merge.test.mjs for the
// half of that rule the merge enforces.

test('a plan from before the cloud existed comes back with a cloud bookmark', () => {
  const out = migrate({ schema: 3, plan: null });
  assert.deepEqual(out.cloud, { householdId: null, rev: 0, at: null });
});

test('a cloud bookmark that is not an object is replaced rather than half-trusted', () => {
  assert.deepEqual(migrate({ cloud: 'yes' }).cloud, { householdId: null, rev: 0, at: null });
  assert.deepEqual(migrate({ cloud: null }).cloud, { householdId: null, rev: 0, at: null });
});

test('a cloud bookmark that is there is left exactly as it was', () => {
  const was = { householdId: 'h1', rev: 12, at: 1700000000000 };
  assert.deepEqual(migrate({ cloud: was }).cloud, was);
});

test('a revision that is not a number cannot be trusted to guard the next push', () => {
  // A rev of "12" would be sent as rev=eq.12 and work, right up until the
  // comparison that decides whether the other phone has news.
  assert.equal(migrate({ cloud: { householdId: 'h1', rev: '12' } }).cloud.rev, 12);
  assert.equal(migrate({ cloud: { householdId: 'h1', rev: null } }).cloud.rev, 0);
});

test('what travels to the household leaves this device behind', () => {
  const s = migrate({
    savedAt: 99,
    cloud: { householdId: 'h1', rev: 12, at: 99 },
    sync: { name: 'plan.json', at: 5, writes: 3, device: 'dev-a' },
  });
  const doc = cloudDoc(s);

  assert.equal(doc.cloud, undefined, 'the rev travelled, and the next push is now guarding the wrong number');
  assert.equal(doc.sync, undefined, 'this device\'s file handle travelled to the other phone');
  assert.equal(doc.savedAt, 99, 'savedAt is the merge tie-breaker and has to travel');
  assert.deepEqual(doc.plan, s.plan);
  assert.deepEqual(doc.memory, s.memory);
});

test('the tab this phone is on does not travel, or the two never stop pushing', () => {
  // sameDoc is what stops two phones trading merges for ever: fold in the
  // remote week, and push back only if the row does not already hold the
  // result. `ui` is the one field mergeStates deliberately does not merge --
  // being on the shopping list is not an opinion about the week -- so if it
  // travelled, the merged result could never match the row while the two
  // people were on different tabs, and each phone would re-push after every
  // poll. Thirty seconds apart. For ever. Spending a revision each time.
  const mine = migrate({ savedAt: 50, ui: { tab: 'shopping' } });
  const theirs = cloudDoc(migrate({ savedAt: 60, ui: { tab: 'week' } }));

  assert.equal(theirs.ui, undefined, 'the other phone was told which tab this one is on');

  const merged = mergeStates(mine, theirs);
  assert.equal(merged.ui.tab, 'shopping', 'the other phone moved this one off its tab');
  assert.equal(sameDoc(cloudDoc(merged), theirs), true,
    'the merge changed nothing but still does not match the row, so this phone will push back -- and so will hers, every thirty seconds, for ever');
});

test('a week from a newer build is not truncated and then republished', () => {
  // The keep-set exists to drop junk, and junk is what an *older* document
  // holds. A newer one holds fields this build has never heard of, and deleting
  // them is destruction: two phones on different versions is the normal state of
  // an installed PWA -- one of them updates first -- and the older one would
  // strip the newer one's week and push the stripped copy back as the newest
  // word. Whichever phone was behind would decide what the other one gets to
  // keep.
  const fromTheFuture = {
    ...migrate({ savedAt: 10 }),
    schema: SCHEMA_VERSION + 1,
    puddingRota: { tuesday: 'crumble' },
  };

  const got = migrate(fromTheFuture);

  assert.deepEqual(got.puddingRota, { tuesday: 'crumble' },
    'an older build deleted a field it did not understand, and the next push published the deletion');
  assert.equal(got.schema, SCHEMA_VERSION + 1,
    'claiming to be this version would make the newer build trust the truncation');
  assert.match(got.migrationNote ?? '', /newer version/i,
    'nothing told anybody their phone is the one that is behind');
});

test('junk from an older document is still dropped', () => {
  // The other half of the same decision: the gate must not become a licence to
  // keep everything. A bug once wrote a key named after a recipe id, and it
  // synced.
  const got = migrate({ savedAt: 10, schema: SCHEMA_VERSION, 'dinner-shakshuka-42': true });
  assert.equal('dinner-shakshuka-42' in got, false);
  assert.equal(got.migrationNote, undefined, 'an ordinary load apologised for itself');
});

test('a restored backup does not point the phone at a household it has left', () => {
  // `cloud` is this device's bookmark in the row: which household, and the
  // revision its next push is conditioned on. Both are facts about the device,
  // not about the week -- which is why cloudDoc strips them on the way out. A
  // file exported before she joined carries the bookmark from before, and
  // restoring it would silently re-aim the phone at an old household, or at
  // none, with a revision that no longer means anything.
  const win = fakeWindow();
  const store = createStore(win);
  store.load();
  store.save({ ...store.state, cloud: { householdId: 'now', rev: 9, at: 5 } });

  store.importJSON(JSON.stringify({ savedAt: 99, cloud: { householdId: 'old', rev: 2, at: 1 } }));

  assert.equal(store.state.cloud.householdId, 'now', 'the backup re-aimed the phone at an old household');
  assert.equal(store.state.cloud.rev, 9, "the backup overwrote the revision the next push depends on");
});

test('two documents that say the same thing in a different order are the same document', () => {
  const a = { plan: { days: [1, 2] }, memory: { banned: ['x'], notes: {} }, savedAt: 7 };
  const b = { savedAt: 7, memory: { notes: {}, banned: ['x'] }, plan: { days: [1, 2] } };
  assert.equal(sameDoc(a, b), true, 'a round trip through JSON would now cost a revision every poll');
  assert.equal(sameDoc(a, { ...b, savedAt: 8 }), false);
  assert.equal(sameDoc(a, { ...b, memory: { banned: ['x', 'y'], notes: {} } }), false,
    'an order-insensitive compare that ignores arrays would lose a ban');
});
