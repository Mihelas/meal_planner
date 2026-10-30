// Two devices, one shared file, no server.
//
// Everything here is a scenario that loses real data today. The merge in v2 kept the
// durable things from both sides and resolved the week itself last-write-wins, which
// means one person's afternoon of edits is thrown away whenever both touched the week
// -- and that is the normal case, not the rare one, because they share a plan.
//
// These tests are written against the *behaviour the pair would notice*: "I un-banned
// that and it came back", "I un-ticked the milk and it re-ticked itself", "I swapped
// Tuesday and her off-plan Monday vanished". Not against the merge's internals.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, emptyState, migrate, mergeStates, SCHEMA_VERSION,
  TOMBSTONE_TTL_MS, pruneRemoved, planAddress, REMOVED_BUCKETS,
} from '../src/store.js';
import {
  generateWeek, defaultSettings, logOffPlan, dayTotals, SLOT_KEYS, entriesIn, isEntry,
  forget, remember,
} from '../src/planner.js';
import {
  swapMeal, banRecipe, unbanRecipe, addCustomRecipe, removeCustomRecipe,
} from '../src/swap.js';
import { createSync, memoryHandles, SYNC_FILE_NAME } from '../src/sync.js';

const S = defaultSettings();
// Tombstones are pruned against the wall clock, so a stamp of `2000` is a removal from
// 1970 and gets swept before any test can assert on it. Everything here hangs off now.
const T = Date.now();
const P1 = S.people[0].id;

/** A state carrying a week, saved at a chosen moment so merges are decidable. */
const at = (state, savedAt) => ({ ...migrate(state), savedAt });

/** Both devices start from the identical week, which is what makes it mergeable. */
function shared() {
  const plan = generateWeek(S, { banned: [] });
  const base = { ...emptyState(), settings: S, plan };
  return { plan, base };
}

/** The recipe on a plate, for asserting that an edit survived. */
const mealAt = (plan, day, slot, person = P1) => {
  const v = plan.days[day][slot];
  return (isEntry(v) ? v : v[person])?.recipeId ?? null;
};

// ---------------------------------------------------------------- plan identity
test('a generated week carries an id, and the same inputs give the same id', () => {
  // Content-derived on purpose. Two devices that generated the same week from the
  // same seed really do hold the same week, so they are allowed to merge cell by
  // cell; a clock-based id would call them strangers and throw one away.
  const a = generateWeek(S, { banned: [] });
  const b = generateWeek(S, { banned: [] });
  assert.ok(a.id, 'a plan without an id cannot be merged, only overwritten');
  assert.equal(a.id, b.id);
});

test('a different week gets a different id', () => {
  const a = generateWeek(S, { banned: [] });
  const b = generateWeek({ ...S, seed: S.seed + 1 }, { banned: [] });
  assert.notEqual(a.id, b.id);
});

test('editing a week does not change its id — it is still that week', () => {
  const plan = generateWeek(S, { banned: [] });
  const swapped = swapMeal(plan, S, { banned: [] }, { day: 2, slot: 'dinner', person: P1 });
  assert.equal(swapped.id, plan.id, 'a swap must not make the week unrecognisable');
});

// ---------------------------------------------------------------- per-cell stamps
test('saving stamps the cells a change really touched, and no others', () => {
  const { base } = shared();
  const st = createStore(undefined);
  st.load();
  st.save({ ...base, sync: { ...base.sync, device: 'laptop' } }, { at: 1000 });
  const swapped = swapMeal(st.state.plan, S, st.state.memory, { day: 2, slot: 'dinner', person: P1 });
  const after = st.save({ ...st.state, plan: swapped }, { at: 2000 });

  const touched = [];
  after.plan.days.forEach((d, i) => {
    for (const slot of SLOT_KEYS) {
      for (const e of entriesIn(d[slot])) if (e.touched?.at === 2000) touched.push(`${i}|${slot}`);
    }
  });
  assert.ok(touched.includes('2|dinner'), 'the swapped meal has to be stamped or the merge is blind');
  // Wednesday lunch is Tuesday dinner's leftovers, so the swap rewrote that too and
  // the stamp has to follow. Stamping only the clicked plate would merge a new dinner
  // while keeping a lunch made of the old one's leftovers.
  assert.ok(touched.includes('3|lunch'), 'the dependent leftover lunch was left unstamped');
  // But a swap is not an edit to the whole week: everything before it, and every day
  // the leftover chain does not reach, must still look untouched to the merge.
  const unrelated = touched.filter((k) => !k.startsWith('2|') && !k.startsWith('3|'));
  assert.deepEqual(unrelated, [], `a swap marked unrelated days as edited: ${unrelated.join(', ')}`);
  // A dinner is one shared entry, not a per-person map -- they eat the same thing and
  // only the portion differs -- so the stamp lives on the entry itself.
  const [dinner] = entriesIn(after.plan.days[2].dinner);
  assert.equal(dinner.touched?.device ?? null, 'laptop',
    'a stamp without a device cannot answer "who changed this"');
});

test('a save that changes nothing about the week stamps nothing', () => {
  // save() runs on every render path, so a stamp on every save would mark the whole
  // week as freshly edited and the merge would be last-write-wins again by accident.
  const { base } = shared();
  const st = createStore(undefined);
  st.load();
  st.save(base, { at: 1000 });
  const after = st.save({ ...st.state, ui: { tab: 'shopping' } }, { at: 2000 });
  for (const d of after.plan.days) {
    for (const slot of SLOT_KEYS) {
      for (const e of entriesIn(d[slot])) {
        assert.notEqual(e.touched?.at, 2000, 'opening a tab is not editing the week');
      }
    }
  }
});

// ---------------------------------------------------------------- the headline case
test('her swap and his off-plan log both survive the same merge', () => {
  const { plan, base } = shared();

  // She swaps Tuesday dinner on her phone.
  const hers = swapMeal(plan, S, { banned: [] }, { day: 2, slot: 'dinner', person: P1 });
  const phone = at({ ...base, plan: hers }, 2000);

  // He logs a burger for Monday on his laptop, a minute later.
  const his = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1100, label: 'Burger' });
  const laptop = at({ ...base, plan: his }, 3000);

  // Stamp each side the way save() would, so the merge can tell them apart.
  stamp(phone.plan, plan, 2000, 'phone');
  stamp(laptop.plan, plan, 3000, 'laptop');

  for (const [x, y] of [[phone, laptop], [laptop, phone]]) {
    const merged = mergeStates(x, y);
    assert.equal(mealAt(merged.plan, 2, 'dinner'), mealAt(hers, 2, 'dinner'),
      'her Tuesday swap was thrown away');
    assert.ok(dayTotals(merged.plan.days[1])[P1].kcal >= 1100,
      'his Monday burger was thrown away');
  }
});

test('two edits to the same meal keep the later one, and say so', () => {
  // Not a CRDT and not pretending to be: the same plate edited twice resolves to one
  // of the two. What matters is that it resolves by time and not by who synced last.
  const { plan, base } = shared();
  const first = swapMeal(plan, S, { banned: [] }, { day: 3, slot: 'lunch', person: P1 });
  const second = swapMeal(first, S, { banned: [] }, { day: 3, slot: 'lunch', person: P1 });
  const a = at({ ...base, plan: first }, 2000);
  const b = at({ ...base, plan: second }, 3000);
  stamp(a.plan, plan, 2000, 'phone');
  stamp(b.plan, plan, 3000, 'laptop');
  assert.equal(mealAt(mergeStates(a, b).plan, 3, 'lunch'), mealAt(second, 3, 'lunch'));
  assert.equal(mealAt(mergeStates(b, a).plan, 3, 'lunch'), mealAt(second, 3, 'lunch'));
});

test('two genuinely different weeks resolve to one of them, whole', () => {
  // Nothing can reconcile two independently generated weeks: cell-merging them would
  // invent a week neither person chose, with leftovers that chain to nothing. So the
  // later one wins entire, and the plan id is what tells them apart.
  const a = at({ ...emptyState(), settings: S, plan: generateWeek(S, { banned: [] }) }, 2000);
  const b = at({ ...emptyState(), settings: S, plan: generateWeek({ ...S, seed: S.seed + 7 }, { banned: [] }) }, 3000);
  const merged = mergeStates(a, b);
  assert.equal(merged.plan.id, b.plan.id, 'the later week should win');
  for (let i = 0; i < 7; i++) {
    for (const slot of SLOT_KEYS) {
      assert.deepEqual(merged.plan.days[i][slot], b.plan.days[i][slot],
        `day ${i} ${slot} came from the wrong week — a Frankenstein week is worse than losing one`);
    }
  }
  assert.ok(merged.mergeNote, 'the person whose week was replaced has to be told');
});

// ---------------------------------------------------------------- deletions
test('un-banning on one device is not undone by the other', () => {
  const a = at({ ...emptyState(), memory: { ...emptyState().memory, banned: ['d-huehner-ramen'] } }, T - 3000);
  // She un-bans it: gone from the list, and a tombstone saying when.
  const b = at({
    ...emptyState(),
    memory: { ...emptyState().memory, banned: [], removed: { banned: { 'd-huehner-ramen': T - 2000 } } },
  }, T - 2000);
  for (const [x, y] of [[a, b], [b, a]]) {
    assert.deepEqual(mergeStates(x, y).memory.banned, [], 'the ban came back from the dead');
  }
});

test('banning it again after an un-ban sticks', () => {
  // The tombstone must not become permanent. "Never again" has to be sayable twice.
  const stale = at({
    ...emptyState(),
    memory: { ...emptyState().memory, banned: [], removed: { banned: { 'd-huehner-ramen': T - 2000 } } },
  }, T - 2000);
  const reBanned = at({
    ...emptyState(),
    memory: { ...emptyState().memory, banned: ['d-huehner-ramen'] },
  }, T - 1000);
  for (const [x, y] of [[stale, reBanned], [reBanned, stale]]) {
    assert.deepEqual(mergeStates(x, y).memory.banned, ['d-huehner-ramen'], 'the re-ban was swallowed');
  }
});

test('un-ticking a bought item propagates instead of re-ticking itself', () => {
  const a = at({ ...emptyState(), bought: { 'milch-1-5-ml': true } }, T - 3000);
  const b = at({
    ...emptyState(), bought: {},
    memory: { ...emptyState().memory, removed: { bought: { 'milch-1-5-ml': T - 2000 } } },
  }, T - 2000);
  for (const [x, y] of [[a, b], [b, a]]) {
    assert.ok(!mergeStates(x, y).bought['milch-1-5-ml'], 'the tick re-applied itself');
  }
});

test('a deleted custom recipe stays deleted', () => {
  const mine = { id: 'custom-1', name: 'Nicks Pfanne', slot: 'dinner', kcal: 600, protein: 40, minutes: 20, ingredients: [], method: [] };
  const a = at({ ...emptyState(), memory: { ...emptyState().memory, custom: [mine] } }, T - 3000);
  const b = at({
    ...emptyState(),
    memory: { ...emptyState().memory, custom: [], removed: { custom: { 'custom-1': T - 2000 } } },
  }, T - 2000);
  for (const [x, y] of [[a, b], [b, a]]) {
    assert.deepEqual(mergeStates(x, y).memory.custom, [], 'the deleted recipe reappeared');
  }
});

test('emptying a staple from the cupboard sticks', () => {
  // The cupboard merges by `Math.max` on the amount, which is right for "I have
  // 500 g" meeting "I have 1 kg" and wrong for "I have none": zero is not a
  // smaller amount, it is an absence, and max cannot express it. Without a
  // tombstone, taking the last of the rice out on one phone has the other phone
  // put it straight back -- and then the shopping list leaves rice off, which is
  // the way this one is actually noticed, in the shop.
  const a = at({ ...emptyState(), memory: { ...emptyState().memory, pantry: { 'reis-1000-g': 1000 } } }, T - 3000);
  const b = at({
    ...emptyState(),
    memory: { ...emptyState().memory, pantry: {}, removed: { pantry: { 'reis-1000-g': T - 2000 } } },
  }, T - 2000);
  for (const [x, y] of [[a, b], [b, a]]) {
    assert.equal(mergeStates(x, y).memory.pantry['reis-1000-g'], undefined, 'the rice came back');
  }
});

test('buying the staple again after emptying it sticks', () => {
  const stale = at({
    ...emptyState(),
    memory: { ...emptyState().memory, pantry: {}, removed: { pantry: { 'reis-1000-g': T - 2000 } } },
  }, T - 2000);
  const back = at({ ...emptyState(), memory: { ...emptyState().memory, pantry: { 'reis-1000-g': 1000 } } }, T - 1000);
  for (const [x, y] of [[stale, back], [back, stale]]) {
    assert.equal(mergeStates(x, y).memory.pantry['reis-1000-g'], 1000, 'the restocked rice was swallowed');
  }
});

test('clearing a note or a rating is not read as never having set one', () => {
  // Both maps merge by spread, which makes an absent key and a deleted key the
  // same thing: the side that still holds a value always wins, whichever side
  // was saved later. Clearing a rating is one click on the star that is already
  // lit, so this is ordinary use, not an edge case -- and a rating that will not
  // go away keeps steering the planner towards a meal somebody stopped liking.
  const a = at({
    ...emptyState(),
    memory: { ...emptyState().memory, ratings: { 'd-huehner-ramen': 5 }, notes: { 'd-huehner-ramen': 'too salty' } },
  }, T - 3000);
  const b = at({
    ...emptyState(),
    memory: {
      ...emptyState().memory,
      ratings: {},
      notes: {},
      removed: { ratings: { 'd-huehner-ramen': T - 2000 }, notes: { 'd-huehner-ramen': T - 2000 } },
    },
  }, T - 2000);
  for (const [x, y] of [[a, b], [b, a]]) {
    const m = mergeStates(x, y).memory;
    assert.equal(m.ratings['d-huehner-ramen'], undefined, 'the cleared rating came back');
    assert.equal(m.notes['d-huehner-ramen'], undefined, 'the cleared note came back');
  }
});

test('rating it again after clearing sticks', () => {
  const stale = at({
    ...emptyState(),
    memory: { ...emptyState().memory, ratings: {}, removed: { ratings: { 'd-huehner-ramen': T - 2000 } } },
  }, T - 2000);
  const back = at({
    ...emptyState(), memory: { ...emptyState().memory, ratings: { 'd-huehner-ramen': 3 } },
  }, T - 1000);
  for (const [x, y] of [[stale, back], [back, stale]]) {
    assert.equal(mergeStates(x, y).memory.ratings['d-huehner-ramen'], 3, 'the new rating was swallowed');
  }
});

test('a corrected weigh-in is not overwritten by the copy it corrected', () => {
  // Weights merge by date into a Map, mine first and theirs second, so the
  // remote entry wins every collision regardless of which phone was saved
  // later. Fix a typo in Monday's weight and the other copy puts the typo back
  // -- and the trend, which is the number the whole plan is steered by after
  // three weeks, is computed from it.
  const typo = at({ ...emptyState(), weights: [{ date: '2026-10-01', person1: 1020 }] }, T - 3000);
  const fixed = at({ ...emptyState(), weights: [{ date: '2026-10-01', person1: 102 }] }, T - 2000);
  for (const [x, y] of [[typo, fixed], [fixed, typo]]) {
    assert.deepEqual(mergeStates(x, y).weights, [{ date: '2026-10-01', person1: 102 }],
      'the corrected weigh-in lost to the one it corrected');
  }
});

test('every bucket the merge knows about can actually be written to', () => {
  // There are two bucket lists -- REMOVED_BUCKETS here and REMOVED_EMPTY in
  // planner.js, because swap.js needs one and is built before store.js -- and a
  // bucket present in one but not the other is a deletion that silently does not
  // stick. Which is indistinguishable from the bug tombstones were added to fix,
  // so it is worth one test rather than a comment.
  for (const bucket of REMOVED_BUCKETS) {
    const out = forget({}, bucket, 'some-id', T - 1000);
    assert.ok(out.removed[bucket]?.['some-id'] > 0, `forget() cannot write to ${bucket}`);
    assert.equal(remember(out, bucket, 'some-id').removed[bucket]['some-id'], undefined,
      `remember() cannot clear ${bucket}`);
  }
});

test('tombstones are pruned, so the file does not grow for ever', () => {
  const now = Date.UTC(2026, 0, 1);
  const kept = now - TOMBSTONE_TTL_MS + 86400000;
  const gone = now - TOMBSTONE_TTL_MS - 86400000;
  const out = pruneRemoved({ banned: { fresh: kept, ancient: gone } }, now);
  assert.deepEqual(Object.keys(out.banned), ['fresh']);
  // 90 days is longer than either of them will go without opening the app, which is
  // the only thing the window has to outlast.
  assert.ok(TOMBSTONE_TTL_MS >= 90 * 24 * 3600 * 1000);
});

// ---------------------------------------------------------------- clocks
test('pulling without editing does not promote you to permanent winner', () => {
  // The v2 bug: pull() -> save() stamped savedAt = now, push() copied it to the file,
  // and from then on the device that merely *looked* at the week outranked the one
  // that was being used.
  const st = createStore(undefined);
  st.load();
  const theirs = at({ ...emptyState(), settings: S, plan: generateWeek(S, { banned: [] }) }, 5000);
  st.save({ ...st.state, plan: null }, { at: 1000 });
  const merged = st.save(mergeStates(st.state, theirs), { touch: false });
  assert.equal(merged.savedAt, 5000, 'syncing is not editing; the clock must not move');

  const edited = st.save({ ...merged, ui: { tab: 'shopping' } }, { at: 9000 });
  assert.equal(edited.savedAt, 9000, 'a real save still stamps');
});

// ---------------------------------------------------------------- the race
test('a concurrent write is merged into the file, not dropped on top of it', async () => {
  // Both offline, both debounces fire. Today the second write wins the whole file and
  // the first person's week is gone before anyone notices.
  const { plan, base } = shared();
  const file = { text: '' };
  const handle = fakeHandle(file);

  const her = createStore(undefined);
  her.load();
  her.save(base, { at: 2000 });

  const his = createStore(undefined);
  his.load();
  his.save(base, { at: 3000 });

  const syncFor = (store) => createSync({
    win: fakeWin(handle), store, handles: memoryHandles(), onChange: () => {},
  });

  // Both link while the file is empty, so neither has seen the other's edits yet --
  // which is the state two laptops are in after an afternoon in a synced folder.
  const a = syncFor(her);
  const b = syncFor(his);
  await a.link({ create: true });
  await b.link({ create: true });

  // Then the edits land locally, and both debounces fire.
  her.save({ ...her.state, plan: swapMeal(plan, S, { banned: [] }, { day: 2, slot: 'dinner', person: P1 }),
    memory: { ...her.state.memory, banned: ['d-huehner-ramen'] } }, { at: 4000 });
  his.save({ ...his.state, plan: logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1100 }),
    memory: { ...his.state.memory, favourites: ['l-huehner-bowl'] } }, { at: 5000 });
  await a.push({ force: true });
  await b.push({ force: true });

  const final = JSON.parse(file.text);
  assert.deepEqual(final.memory.banned, ['d-huehner-ramen'], 'her ban was overwritten');
  assert.deepEqual(final.memory.favourites, ['l-huehner-bowl'], 'his favourite was lost');
  assert.ok(dayTotals(final.plan.days[1])[P1].kcal >= 1100, 'his Monday log was lost');
});

test('the shared file is re-read before being written, every time', async () => {
  const { base } = shared();
  const file = { text: '' };
  const st = createStore(undefined);
  st.load();
  st.save(base, { at: 1000 });
  const s = createSync({ win: fakeWin(fakeHandle(file)), store: st, handles: memoryHandles(), onChange: () => {} });
  await s.link({ create: true });
  // Somebody else's edit lands in the file after we linked and before we push.
  const theirs = at({ ...base, memory: { ...base.memory, banned: ['d-rote-linsen-dal'] } }, 8000);
  file.text = JSON.stringify(theirs);
  await s.push({ force: true });
  assert.ok(JSON.parse(file.text).memory.banned.includes('d-rote-linsen-dal'),
    'push wrote over an edit it never read');
});

test('an unreadable file still blocks writing, exactly as before', async () => {
  const st = createStore(undefined);
  st.load();
  const file = { text: 'not json at all' };
  const s = createSync({ win: fakeWin(fakeHandle(file)), store: st, handles: memoryHandles(), onChange: () => {} });
  await s.link({ create: true });
  const res = await s.push({ force: true });
  assert.equal(res.ok, false, 'a file we cannot parse must never be overwritten');
});

// ---------------------------------------------------------------- bidirectional
test('sync pulls on focus, so a tab left open all afternoon is not stale', async () => {
  const { base } = shared();
  const file = { text: '' };
  const st = createStore(undefined);
  st.load();
  st.save(base, { at: 1000 });
  const win = fakeWin(fakeHandle(file));
  const s = createSync({ win, store: st, handles: memoryHandles(), onChange: () => {} });
  await s.link({ create: true });
  s.watch();

  file.text = JSON.stringify(at({ ...base, memory: { ...base.memory, banned: ['d-rote-linsen-dal'] } }, 9000));
  await win.fire('focus');
  assert.ok(st.state.memory.banned.includes('d-rote-linsen-dal'), 'coming back to the tab pulled nothing');
});

test('sync pulls on a timer while the tab is visible, and stops when it is not', async () => {
  const { base } = shared();
  const file = { text: '' };
  const st = createStore(undefined);
  st.load();
  st.save(base, { at: 1000 });
  const win = fakeWin(fakeHandle(file));
  const s = createSync({ win, store: st, handles: memoryHandles(), onChange: () => {} });
  await s.link({ create: true });
  s.watch();
  assert.ok(win.intervals.length, 'nothing is polling the shared file');

  file.text = JSON.stringify(at({ ...base, memory: { ...base.memory, favourites: ['s-skyr-beeren'] } }, 9000));
  await win.runIntervals();
  assert.ok(st.state.memory.favourites.includes('s-skyr-beeren'), 'the timer pulled nothing');

  // Hidden tabs must not keep reading a file in a synced folder: that is what makes
  // Dropbox spin a CPU all night on a laptop nobody is using.
  win.visibility = 'hidden';
  file.text = JSON.stringify(at({ ...base, memory: { ...base.memory, favourites: ['b-skyr-obst'] } }, 10000));
  await win.runIntervals();
  assert.ok(!st.state.memory.favourites.includes('b-skyr-obst'), 'a hidden tab should not be polling');

  s.unwatch();
  assert.equal(win.intervals.filter(Boolean).length, 0, 'unwatch left a timer running');
});

// ---------------------------------------------------------------- migration
test('an old saved state gains the new fields without losing anything', () => {
  const old = {
    schema: 3,
    memory: { banned: ['d-huehner-ramen'], favourites: [], ratings: { 'd-huehner-ramen': 4 }, notes: {}, custom: [], pantry: {}, stats: { away: {}, kept: {} } },
    bought: { 'milch-1-5-ml': true },
  };
  const m = migrate(old);
  assert.equal(m.schema, SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 4);
  assert.deepEqual(m.memory.banned, ['d-huehner-ramen'], 'the ban was dropped by the migration');
  assert.equal(m.memory.ratings['d-huehner-ramen'], 4);
  assert.deepEqual(Object.keys(m.memory.removed).sort(), [...REMOVED_BUCKETS].sort());
  assert.equal(m.bought['milch-1-5-ml'], true);
});

test('a state with junk in removed is repaired, not trusted', () => {
  const m = migrate({ schema: 3, memory: { removed: 'nope' } });
  assert.deepEqual(Object.keys(m.memory.removed).sort(), [...REMOVED_BUCKETS].sort());
  const n = migrate({ schema: 4, memory: { removed: { banned: { x: 'soon' }, custom: null, bought: {} } } });
  assert.deepEqual(n.memory.removed.banned, {}, 'a non-numeric stamp cannot be compared, so it cannot be kept');
  assert.deepEqual(n.memory.removed.custom, {});
});

test('a plan without stamps merges the way v2 did, rather than throwing a wobbly', () => {
  // The first sync after the update has unstamped entries on both sides. It must be
  // last-write-wins then, not empty.
  const { plan, base } = shared();
  const a = at({ ...base, plan }, 2000);
  const swapped = swapMeal(plan, S, { banned: [] }, { day: 4, slot: 'dinner', person: P1 });
  const b = at({ ...base, plan: swapped }, 3000);
  const merged = mergeStates(a, b);
  assert.equal(mealAt(merged.plan, 4, 'dinner'), mealAt(swapped, 4, 'dinner'));
});

test('planAddress is stable, because it is the key the whole merge turns on', () => {
  assert.equal(planAddress(2, 'dinner', P1), `2|dinner|${P1}`);
  assert.equal(planAddress(0, 'breakfast', null), '0|breakfast|*');
});

// ---------------------------------------------------------------- helpers
/** What store.save() does to a plan, applied by hand so tests can choose the clock. */
function stamp(next, prev, when, device) {
  for (let i = 0; i < 7; i++) {
    for (const slot of SLOT_KEYS) {
      const a = prev.days[i][slot];
      const b = next.days[i][slot];
      if (isEntry(b)) {
        if (JSON.stringify(a) !== JSON.stringify(b)) b.touched = { at: when, device };
        continue;
      }
      for (const pid of Object.keys(b ?? {})) {
        const was = isEntry(a) ? a : a?.[pid];
        if (JSON.stringify(was) !== JSON.stringify(b[pid])) b[pid].touched = { at: when, device };
      }
    }
  }
  return next;
}

function fakeHandle(file, { name = SYNC_FILE_NAME } = {}) {
  return {
    name,
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getFile() { return { text: async () => file.text }; },
    async createWritable() {
      let buf = '';
      return { async write(c) { buf += c; }, async close() { file.text = buf; } };
    },
  };
}

function fakeWin(handle = null) {
  const listeners = new Map();
  const win = {
    indexedDB: null,
    visibility: 'visible',
    get document() { return { get visibilityState() { return win.visibility; } }; },
    timers: [],
    intervals: [],
    setTimeout(fn) { win.timers.push(fn); return win.timers.length; },
    clearTimeout(id) { win.timers[id - 1] = null; },
    setInterval(fn) { win.intervals.push(fn); return win.intervals.length; },
    clearInterval(id) { win.intervals[id - 1] = null; },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    removeEventListener(name, fn) {
      listeners.set(name, (listeners.get(name) ?? []).filter((f) => f !== fn));
    },
    showSaveFilePicker: async () => handle,
    showOpenFilePicker: async () => [handle],
    async fire(name) { for (const fn of listeners.get(name) ?? []) await fn(); },
    async runIntervals() { for (const fn of win.intervals.filter(Boolean)) await fn(); },
  };
  return win;
}

// ------------------------------------------------- the real removal paths write notes
//
// Everything above tests the merge given a tombstone. These test that the app's own
// deletion paths actually leave one -- without which the whole fix is theoretical --
// and, just as important, that putting the thing back rubs the note out. A tombstone
// that outlives its removal is the same bug with the sign flipped: the other device
// would delete something that is currently on the list.

test('un-banning leaves a dated note, and re-banning takes it away again', () => {
  const id = 'd-huehner-ramen';
  const banned = banRecipe(emptyState().memory, id);
  assert.deepEqual(banned.banned, [id]);
  assert.deepEqual(banned.removed.banned, {}, 'banning should not record a removal');

  const un = unbanRecipe(banned, id);
  assert.deepEqual(un.banned, []);
  assert.ok(un.removed.banned[id] >= T, 'un-banning left no note, so the other device will re-ban it');

  const again = banRecipe(un, id);
  assert.deepEqual(again.banned, [id]);
  assert.equal(again.removed.banned[id], undefined,
    'the stale note survived a re-ban, so the other device will un-ban it for you');
});

test('deleting one of your own recipes leaves a note, and re-adding it clears it', () => {
  const draft = {
    name: 'Testauflauf', slot: 'dinner', kcal: 600, protein: 35, minutes: 25,
    cuisine: 'northern', equipment: ['oven'],
    ingredients: [{ item: 'Reis', qty: 100, unit: 'g', aisle: 'dry-goods' }],
    method: ['In den Ofen.'],
  };
  const added = addCustomRecipe(emptyState().memory, draft);
  assert.equal(added.ok, true, JSON.stringify(added.errors));
  const id = added.recipe.id;

  const gone = removeCustomRecipe(added.memory, id);
  assert.deepEqual(gone.custom, []);
  assert.ok(gone.removed.custom[id] >= T, 'a deleted recipe with no note comes back on the next sync');

  const back = addCustomRecipe(gone, draft);
  assert.equal(back.ok, true);
  assert.equal(back.memory.removed.custom[back.recipe.id], undefined,
    'the recipe is back on the list but still marked as deleted');
  // Leave the shared library as it was found.
  removeCustomRecipe(back.memory, back.recipe.id);
});

test('a week saved before plan ids existed gets one, so the week in progress still merges', () => {
  // Without the backfill the per-plate merge would only start working on the next week
  // they generate -- and the week that matters is the one they are already living in.
  const plan = generateWeek(S, { banned: [] });
  const { id, ...idless } = plan;
  const old = migrate({ ...emptyState(), schema: 3, settings: S, plan: idless });
  assert.equal(old.plan.id, id, 'the id was not recovered from the content');

  // Two devices reach it independently, from the stored week alone.
  const other = migrate({ ...emptyState(), schema: 3, settings: S, plan: JSON.parse(JSON.stringify(idless)) });
  assert.equal(other.plan.id, old.plan.id);
});

test('the household row cannot hand this device a revision that is not its own', () => {
  // The hazard this closes: mergeStates copies the remote side wholesale when
  // the remote side is newer, so a `cloud` block inside the incoming document
  // would replace the revision the next push is conditioned on -- with her
  // phone's. The push after that would be refused for ever, silently, and the
  // only symptom would be a week that stopped arriving.
  const mine = migrate({ savedAt: 10, cloud: { householdId: 'h1', rev: 4, at: 10 } });
  const theirs = migrate({ savedAt: 99, cloud: { householdId: 'h1', rev: 41, at: 99 } });

  const out = mergeStates(mine, theirs);

  assert.equal(out.savedAt, 99, 'the newer week should still have won');
  assert.equal(out.cloud.householdId, 'h1');
  assert.equal(out.cloud.rev, 4, "her phone's revision replaced the one the next push is conditioned on");
  // `at` is the one part of the bookmark a merge is allowed to touch, and here
  // it has to: the row holds her week, this document is now a merge of both, and
  // a bookmark saying otherwise is what would stop the merge ever being pushed.
  assert.equal(out.cloud.at, null);
});

// ------------------------------------------------------- the file and the row
//
// Two transports, one merge. The shared file and the household row both fold a
// document in through mergeStates, but only the row has a push attached, and the
// push is skipped when the bookmark says the row already holds what this phone
// has. A file merge used to leave that bookmark untouched: fold her bans in from
// the file and the household never heard about them, because nothing had moved
// `savedAt` and so `cloudJob.read()` had nothing to report.

test('a merge that changed the shared week invalidates the bookmark', () => {
  const mine = migrate({
    savedAt: T, memory: { banned: ['a'] }, cloud: { householdId: 'h1', rev: 7, at: T },
  });
  const theirs = migrate({ savedAt: T - 60_000, memory: { banned: ['b'] } });

  const out = mergeStates(mine, theirs);

  assert.deepEqual(out.memory.banned.sort(), ['a', 'b'], 'the union is the premise of this test');
  assert.equal(out.cloud.householdId, 'h1', 'the merge moved this phone to another household');
  assert.equal(out.cloud.rev, 7, 'the merge moved the revision the next push is conditioned on');
  assert.equal(out.cloud.at, null,
    'the row holds a week without her ban and nothing is going to push the merged one');
});

test('a merge that changed nothing leaves the bookmark alone', () => {
  // The other half of the same rule, and the reason it is conditional: clearing
  // the bookmark unconditionally would mean every poll of the shared file ended
  // in a push, and two phones polling would push each other's identical
  // documents back and forth for ever, a revision at a time.
  const mine = migrate({
    savedAt: T, memory: { banned: ['a'] }, cloud: { householdId: 'h1', rev: 7, at: T },
  });
  const theirs = migrate({ savedAt: T - 60_000, memory: { banned: ['a'] } });

  const out = mergeStates(mine, theirs);

  assert.equal(out.cloud.at, T, 'an identical document was treated as news');
});
