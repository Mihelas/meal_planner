// The week travelling, driven against the real built file.
//
// src/cloud.js has its own tests against a fake PostgREST; what those cannot
// prove is the part that decides whether anybody loses a week. Two phones, two
// plans, one row -- and the first time an account signs in on a phone that
// already has a week, something has to give. The rule these tests hold to is
// that nothing gives silently: the question is asked, out loud, before either
// week is touched.
//
// And, as everywhere else in this app: none of it is a precondition for dinner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { open, slotName } from './harness.mjs';

const ME = 'd3f4a1b2-0000-4000-8000-000000000001';
const HER = 'd3f4a1b2-0000-4000-8000-000000000002';
const HID = 'aaaaaaaa-0000-4000-8000-00000000000a';

const reply = (status, payload) => ({
  ok: status < 400,
  status,
  async json() { return payload; },
  async text() { return JSON.stringify(payload); },
});

const memberRow = () => ({
  user_id: ME,
  role: 'owner',
  person_id: 'person1',
  joined_at: '2026-10-01T10:00:00Z',
  households: { id: HID, name: 'Home' },
  profiles: { display_name: '' },
});

/**
 * A week somebody else planned.
 *
 * Built from a real one rather than hand-written: a hand-written plan is a plan
 * the app rejects and regenerates, which would make this test pass for a reason
 * that has nothing to do with syncing. Monday's dinner is moved to a recipe
 * that is not on Monday in the default week, so "her week arrived" is something
 * the page can be asked rather than inferred.
 */
let REAL = null;
const herWeek = () => {
  REAL ??= open({}).state();
  const doc = JSON.parse(JSON.stringify(REAL));
  delete doc.cloud;
  delete doc.sync;
  doc.plan.days[0].dinner.recipeId = HER_DINNER;
  doc.memory.banned = ['her-ban'];
  doc.savedAt = Date.now();
  return doc;
};
const HER_DINNER = 'd-palak-paneer';
const HER_DINNER_NAME = /palak paneer/i;

/**
 * This phone: a week, and months of durable data attached to it.
 *
 * Saved an hour before hers on purpose. The two buttons exist because the
 * person is answering a question, and their answer has to outrank whichever
 * week happens to carry the later stamp -- otherwise the question was theatre.
 */
const myWeek = () => {
  REAL ??= open({}).state();
  const doc = JSON.parse(JSON.stringify(REAL));
  delete doc.cloud;
  delete doc.sync;
  doc.memory.banned = ['my-ban'];
  doc.memory.ratings = { [HER_DINNER]: 5 };
  doc.savedAt = Date.now() - 3600_000;
  return JSON.stringify(doc);
};

/**
 * A fetch that routes by path, with one mutable household_state row behind it.
 *
 * The row is stateful because the interesting cases all involve reading what
 * was written: a push that landed, a push that was refused, a week that arrived
 * from the other phone.
 */
function cloudFake({ row = {}, rev = 0, routes = [] } = {}) {
  const state = { doc: row, rev, updated_at: '2026-10-28T10:00:00Z', updated_by: HER };
  const calls = [];
  const fn = async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method, body, headers: init.headers ?? {} });

    for (const [match, handler] of routes) {
      if (!path.includes(match)) continue;
      const out = typeof handler === 'function' ? handler({ path, method, body }) : handler;
      if (out !== undefined) return out;
    }
    if (path.startsWith('/auth/v1/user')) return reply(200, { id: ME, email: 'me@example.com' });
    if (path.startsWith('/rest/v1/household_members')) return reply(200, [memberRow()]);
    if (path.startsWith('/rest/v1/household_invites')) return reply(200, []);
    if (path.startsWith('/rest/v1/household_state')) {
      if (method !== 'PATCH') return reply(200, [{ ...state }]);
      const seen = Number(/rev=eq\.(\d+)/.exec(path)?.[1] ?? -1);
      if (seen !== state.rev) return reply(200, []);
      state.doc = body.doc;
      state.rev = body.rev;
      state.updated_by = ME;
      return reply(200, [{ ...state }]);
    }
    throw new Error(`no route for ${method} ${path}`);
  };
  fn.calls = calls;
  fn.row = () => ({ ...state });
  /** The other phone pushing, while this one is not looking. */
  fn.her = (doc) => { state.doc = doc; state.rev += 1; state.updated_by = HER; };
  fn.to = (match, method = null) => calls.filter(
    (c) => c.path.includes(match) && (!method || c.method === method),
  );
  return fn;
}

function signedIn({ fetch, stored = null } = {}) {
  const app = open({
    stored,
    extend: (win) => {
      win.fetch = fetch;
      win.location.hash = '#access_token=at-c&refresh_token=rt-c&expires_in=3600&token_type=bearer';
    },
  });
  return app;
}

const settle = async (n = 8) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => { setTimeout(r, 0); });
};

/** The debounce is 800 ms; pagehide is the app's own way of not waiting for it. */
const flush = async (app) => {
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  await settle(8);
};

const card = (app) => app.$('[data-panel="cloud"]');
const cardText = (app) => card(app)?.textContent.replace(/\s+/g, ' ') ?? '';
const pageText = (app) => app.text();

// ------------------------------------------------------------- not an account

test('signed out, there is no shared week and the row is never asked about', () => {
  let touched = 0;
  const app = open({ extend: (win) => { win.fetch = () => { touched += 1; throw new Error('went to the network'); } } });
  app.tab('settings');

  assert.equal(card(app), null, 'a signed-out phone was shown a shared-week card');
  assert.equal(touched, 0);
  assert.deepEqual(app.errors, []);
});

test('a row that cannot be reached does not take the week with it', async () => {
  const app = signedIn({ fetch: () => { throw new TypeError('Failed to fetch'); } });
  await settle(12);
  app.tab('settings');

  assert.equal(app.$$('.day').length, 7, 'the week went away over a failed household read');
  assert.deepEqual(app.errors, []);
});

// ---------------------------------------------------------- the first sign-in

test('a household with no week yet takes this phone\'s, without asking', async () => {
  const fetch = cloudFake({ row: {}, rev: 0 });
  const app = signedIn({ fetch });
  await settle(12);
  await flush(app);

  assert.match(pageText(app), /./);
  assert.equal(fetch.to('household_state', 'PATCH').length, 1, 'an empty household was not given this week');
  assert.equal(fetch.row().rev, 1);
  assert.ok(fetch.row().doc.plan, 'the week itself did not travel');
  assert.equal(app.state().cloud.householdId, HID);
  assert.equal(app.state().cloud.rev, 1, 'the device did not write down the revision it now sits on');
  assert.deepEqual(app.errors, []);
});

test('a household that already has a week asks before touching either one', async () => {
  const fetch = cloudFake({ row: herWeek(), rev: 4 });
  const app = signedIn({ fetch });
  await settle(12);

  assert.match(pageText(app), /keep this phone's week|take the household's/i,
    'two weeks met and nobody was asked which one survives');
  assert.ok(app.$('[data-act="cloud-keep"]'), 'no way to keep this phone\'s week');
  assert.ok(app.$('[data-act="cloud-take"]'), 'no way to take the household\'s week');
  assert.equal(fetch.to('household_state', 'PATCH').length, 0, 'it pushed over her week before asking');
  assert.equal(app.state().cloud.householdId, null, 'it bookmarked the row it had not been allowed to use yet');
  assert.doesNotMatch(slotName(app, 0, 'dinner') ?? '', HER_DINNER_NAME, 'it took her week before asking');
  assert.deepEqual(app.errors, []);
});

test('keeping this phone\'s week pushes it over the household\'s', async () => {
  const fetch = cloudFake({ row: herWeek(), rev: 4 });
  const app = signedIn({ fetch });
  await settle(12);
  const was = app.weekText();

  app.click('[data-act="cloud-keep"]');
  await settle(4);
  await flush(app);

  assert.equal(app.weekText(), was, 'keeping this week changed it');
  assert.equal(fetch.row().rev, 5, 'the push did not land');
  assert.deepEqual(fetch.row().doc.plan, app.state().plan);
  assert.equal(app.$('[data-act="cloud-keep"]'), null, 'the question is still being asked');
  assert.deepEqual(app.errors, []);
});

test('taking the household\'s week replaces this phone\'s', async () => {
  const fetch = cloudFake({ row: herWeek(), rev: 4 });
  const app = signedIn({ fetch });
  await settle(12);

  app.click('[data-act="cloud-take"]');
  await settle(6);

  assert.match(slotName(app, 0, 'dinner') ?? '', HER_DINNER_NAME, "the household's week did not arrive");
  assert.equal(app.state().cloud.rev, 4, 'it took the week without the revision that guards the next push');
  assert.ok(app.state().memory.banned.includes('her-ban'), 'her bans did not come with it');
  assert.deepEqual(app.errors, []);
});

// The question promises that one of the two *weeks* is replaced. It used to
// replace the whole document, in whichever direction was chosen -- so the losing
// side's bans, ratings, own recipes and weight log went with the week they
// happened to be attached to, and nothing on screen said so. These two hold the
// banner to what it says.

test("keeping this phone's week keeps her bans as well", async () => {
  const fetch = cloudFake({ row: herWeek(), rev: 4 });
  const app = signedIn({ fetch, stored: myWeek() });
  await settle(12);
  const was = app.weekText();

  app.click('[data-act="cloud-keep"]');
  await settle(4);
  await flush(app);

  assert.equal(app.weekText(), was, 'keeping this week changed it');
  assert.ok(app.state().memory.banned.includes('my-ban'), "it dropped this phone's own ban");
  assert.ok(app.state().memory.banned.includes('her-ban'),
    'her ban was thrown away with the week it happened to be attached to');
  assert.deepEqual(fetch.row().doc.memory.banned.sort(), ['her-ban', 'my-ban'],
    'the household row was left holding one side of the pair');
  assert.deepEqual(app.errors, []);
});

test("taking the household's week keeps this phone's ratings", async () => {
  const fetch = cloudFake({ row: herWeek(), rev: 4 });
  const app = signedIn({ fetch, stored: myWeek() });
  await settle(12);

  app.click('[data-act="cloud-take"]');
  await settle(6);
  await flush(app);

  assert.match(slotName(app, 0, 'dinner') ?? '', HER_DINNER_NAME, "the household's week did not arrive");
  assert.ok(app.state().memory.banned.includes('her-ban'), 'her bans did not come with her week');
  assert.ok(app.state().memory.banned.includes('my-ban'),
    "this phone's ban went with the week it did not keep");
  assert.equal(app.state().memory.ratings[HER_DINNER], 5, 'months of ratings were replaced by hers');
  assert.ok(fetch.row().doc.memory.banned.includes('my-ban'),
    'the union stayed on this phone and never reached the household');
  assert.deepEqual(app.errors, []);
});

// ------------------------------------------------------------- the push itself

test('the revision never travels inside the week', async () => {
  const fetch = cloudFake({ row: {}, rev: 0 });
  const app = signedIn({ fetch });
  await settle(12);
  await flush(app);

  const [patch] = fetch.to('household_state', 'PATCH');
  assert.ok(patch, 'nothing was pushed at all');
  assert.equal(patch.body.doc.cloud, undefined,
    'the bookmark travelled; the other phone will now push against this one\'s revision');
  assert.equal(patch.body.doc.sync, undefined, 'this device\'s file handle travelled');
  assert.equal(patch.body.rev, 1, 'the revision belongs beside the document, not inside it');
  assert.match(patch.headers.prefer ?? '', /return=representation/);
});

test('an edit after the week has landed is pushed, once', async () => {
  const fetch = cloudFake({ row: {}, rev: 0 });
  const app = signedIn({ fetch });
  await settle(12);
  await flush(app);
  const first = fetch.to('household_state', 'PATCH').length;

  app.tab('settings');
  await flush(app);
  assert.equal(fetch.to('household_state', 'PATCH').length, first,
    'looking at a tab counted as an edit, and spent a revision on it');

  app.tab('week');
  app.click('[data-act="reroll"]');
  await settle(2);
  await flush(app);

  assert.equal(fetch.to('household_state', 'PATCH').length, first + 1, 'a new week was not sent');
  assert.equal(app.state().cloud.rev, 2);
  assert.deepEqual(app.errors, []);
});

// ------------------------------------------------------------------ the status

test('the card says where the week stands, and offers a way to try again', async () => {
  const fetch = cloudFake({ row: {}, rev: 0 });
  const app = signedIn({ fetch });
  await settle(12);
  await flush(app);
  app.tab('settings');

  assert.match(cardText(app), /saved|shared/i, 'the card does not say whether the week is safe');
  assert.deepEqual(app.errors, []);
});

test('a week that could not be sent says so, and the Retry is a button', async () => {
  let up = true;
  const live = cloudFake({ row: {}, rev: 0 });
  const fetch = async (...a) => {
    const path = String(a[0]);
    if (!up && path.includes('household_state')) throw new TypeError('Failed to fetch');
    return live(...a);
  };
  fetch.to = (...a) => live.to(...a);
  fetch.row = () => live.row();

  const app = signedIn({ fetch });
  await settle(12);
  up = false;
  app.tab('week');
  app.click('[data-act="reroll"]');
  await settle(2);
  await flush(app);
  app.tab('settings');

  assert.match(cardText(app), /offline/i, 'a week stuck on the phone was reported as saved');
  assert.ok(app.$('[data-act="cloud-retry"]'), 'nothing to press when the signal comes back');

  up = true;
  app.click('[data-act="cloud-retry"]');
  await settle(8);

  assert.ok(fetch.row().doc.plan, 'Retry did not retry');
  assert.deepEqual(app.errors, []);
});

test('a phone that is behind does not publish what it could not read', async () => {
  // The other half of the schema gate. migrate() now keeps the fields a newer
  // build wrote instead of deleting them, but keeping them locally is not
  // enough: the plan may still have been rebuilt, and anything this build does
  // not understand it also cannot maintain. So while the document says it came
  // from a newer version, this phone reads and shows, and writes nothing to the
  // household. The row keeps the real week until the app updates.
  const stale = herWeek();
  stale.schema = 99;
  stale.puddingRota = { tuesday: 'crumble' };
  stale.cloud = { householdId: HID, rev: 4, at: null };

  const fetch = cloudFake({ row: herWeek(), rev: 4 });
  const app = signedIn({ fetch, stored: JSON.stringify(stale) });
  await settle(12);
  await flush(app);

  assert.equal(fetch.to('household_state', 'PATCH').length, 0,
    'a phone that cannot read the week still overwrote the household with its own copy of it');
  assert.equal(fetch.row().rev, 4, 'the revision moved, so something was published');
  assert.match(pageText(app), /newer version/i, 'nothing said why this phone is not saving');
  assert.deepEqual(app.errors, []);
});

test('a row that could not be read on sign-in is asked again, not given up on', async () => {
  // The guard that stops render() fetching twice is set before the request, so
  // it has to be let go of when the request fails. Two seconds of bad signal in
  // the wrong place used to cost the whole session: no bookmark, no watcher, no
  // push, no error, and no retry button -- because the queue was never reached,
  // so there was nothing for the card to report as broken.
  let down = true;
  const live = cloudFake({ row: {}, rev: 0 });
  const fetch = async (url, init = {}) => {
    if (down && String(url).includes('household_state')) throw new TypeError('Failed to fetch');
    return live(url, init);
  };

  const app = signedIn({ fetch });
  await settle(12);
  assert.equal(app.state().cloud.householdId, null, 'it bookmarked a row it never managed to read');

  down = false;
  app.tab('settings');
  await settle(12);
  await flush(app);

  assert.equal(app.state().cloud.householdId, HID,
    'two seconds of bad signal at sign-in stranded the week for the rest of the session');
  assert.equal(live.row().rev, 1, 'the week never reached the household');
  assert.deepEqual(app.errors, []);
});

test('a row that keeps refusing is retried, but never in a tight loop', async () => {
  // The guard above is let go of so that one bad moment is not permanent. The
  // handler that let it go used to call render() as well -- and render() is the
  // thing that asks. So a row failing for any lasting reason (no route, no
  // network, a policy that says no) asked again at once, failed again at once,
  // and did it all inside a promise chain: the microtask queue never drained, no
  // timer ever got a turn, and the tab did not degrade, it locked.
  //
  // The row is held down here and the asking is counted. It relents at the
  // ceiling on purpose -- a test that never returns reports nothing, so a
  // regression has to come back as a failed assertion rather than as a suite
  // that hangs and gets read as slow.
  const CEILING = 40;
  let tries = 0;
  const live = cloudFake({ row: {}, rev: 0 });
  const fetch = async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/rest/v1/household_state') && (init.method ?? 'GET') === 'GET') {
      tries += 1;
      if (tries < CEILING) throw new TypeError('Failed to fetch');
    }
    return live(url, init);
  };

  const app = signedIn({ fetch });
  await settle(16);

  assert.ok(tries > 0, 'the row was never asked for at all');
  assert.ok(tries < CEILING, `the row was asked ${tries} times: render() is asking itself in a loop`);
  assert.deepEqual(app.errors, []);
});

test('a week arriving from the other phone takes the Undo offer away', async () => {
  // Undo is a snapshot of the whole document, which is honest for one step back
  // and a lie once somebody else's work has arrived on top: rolling back to it
  // would quietly throw away her swap, her weigh-in and her cupboard along with
  // this phone's ban -- and then push the rollback out as the newest word.
  const fetch = cloudFake({ row: {}, rev: 0 });
  const app = signedIn({ fetch });
  await settle(12);
  await flush(app);

  const row = [...app.$$('.day')[3].querySelectorAll('.slot')].find((r) => r.querySelector('[data-ban]'));
  app.click(row.querySelector('[data-ban]'));
  assert.ok(app.$('[data-act="undo"]'), 'the ban was not offered as undoable at all');

  const mine = fetch.row().doc;
  fetch.her({
    ...mine,
    savedAt: Date.now() + 1000,
    memory: { ...mine.memory, banned: [...(mine.memory?.banned ?? []), 'her-ban'] },
  });
  await flush(app);

  assert.ok(app.state().memory.banned.includes('her-ban'), 'her ban never arrived, so there is nothing to protect');
  assert.equal(app.$('[data-act="undo"]'), null,
    'Undo still offers to roll back to a moment before her work existed');
  assert.deepEqual(app.errors, []);
});

test('two phones editing the same week both keep their work', async () => {
  const fetch = cloudFake({ row: {}, rev: 0 });
  const app = signedIn({ fetch });
  await settle(12);
  await flush(app);
  assert.equal(fetch.row().rev, 1, 'the week never landed, so there is no race to lose');

  // Her phone bans something, an hour ago by the clock the merge uses, and
  // pushes. Nothing tells this phone, which still thinks the row is at rev 1.
  const mine = fetch.row().doc;
  fetch.her({
    ...mine,
    savedAt: Date.now() - 3600000,
    memory: { ...mine.memory, banned: ['her-ban'] },
  });

  // And then this phone rerolls the week and pushes into a row that moved.
  app.tab('week');
  app.click('[data-act="reroll"]');
  await settle(2);
  await flush(app);

  assert.equal(fetch.row().rev, 3, 'the lost race was never retried, so this reroll is gone');
  assert.ok(fetch.row().doc.memory.banned.includes('her-ban'),
    'her ban was pushed straight back out of the row');
  assert.ok(app.state().memory.banned.includes('her-ban'), 'her ban never reached this phone');
  assert.deepEqual(fetch.row().doc.plan, app.state().plan, 'the row and the phone disagree about the week');
  assert.equal(app.state().cloud.rev, 3);
  assert.deepEqual(app.errors, []);
});

// ------------------------------------------------- arrivals and open sheets
//
// render() replaces the whole page, so anything the person has open goes with
// it: a swap sheet closes, a half-typed weight is gone, the cursor with it. For
// a render they caused that is correct -- they tapped something and this is the
// answer. For one that arrived from the other phone it is not, and the loss is
// real from their side even though the store never lost anything.

/** A week of hers, built from what is in the row, with Monday's dinner moved. */
const herVersionOf = (doc) => {
  const hers = JSON.parse(JSON.stringify(doc));
  const when = Date.now() + 1000;
  hers.savedAt = when;
  hers.plan.days[0].dinner.recipeId = HER_DINNER;
  hers.plan.days[0].dinner.touched = { at: when, device: 'hers' };
  return hers;
};

/** The swap button on a day-3 slot that is a real recipe, so the sheet opens. */
const swapButton = (app) => {
  const row = [...app.$$('.day')[3].querySelectorAll('.slot')]
    .find((r) => r.querySelector('[data-ban]') && r.querySelector('[data-swap]'));
  assert.ok(row, 'no day-3 slot with a recipe in it');
  return row.querySelector('[data-swap]');
};

test('her week arriving while a sheet is open does not close it', async () => {
  const fetch = cloudFake({ row: {}, rev: 0 });
  const app = signedIn({ fetch });
  await settle(12);
  await flush(app);

  // An edit, so there is a push waiting to be sent...
  const row = [...app.$$('.day')[3].querySelectorAll('.slot')].find((r) => r.querySelector('[data-ban]'));
  app.click(row.querySelector('[data-ban]'));
  // ...and the other phone gets there first, with a different Monday dinner.
  fetch.her(herVersionOf(fetch.row().doc));

  // Somebody opens the swap sheet while that push is still in the air.
  app.click(swapButton(app));
  assert.ok(app.$('#swap[open]'), 'the swap sheet did not open');
  const shown = slotName(app, 0, 'dinner');

  await flush(app);

  assert.ok(app.$('#swap[open]'),
    'her week arriving closed the sheet somebody was in the middle of using');
  assert.match(app.state().plan.days[0].dinner.recipeId, new RegExp(HER_DINNER),
    'her week did not arrive at all, so there is nothing being deferred');
  assert.equal(slotName(app, 0, 'dinner'), shown,
    'the week behind the sheet was redrawn under it');
  assert.deepEqual(app.errors, []);
});

test('and it is shown the moment the sheet closes', async () => {
  const fetch = cloudFake({ row: {}, rev: 0 });
  const app = signedIn({ fetch });
  await settle(12);
  await flush(app);

  const row = [...app.$$('.day')[3].querySelectorAll('.slot')].find((r) => r.querySelector('[data-ban]'));
  app.click(row.querySelector('[data-ban]'));
  fetch.her(herVersionOf(fetch.row().doc));

  app.click(swapButton(app));
  await flush(app);

  app.click('#swap [data-close]');
  await settle(4);

  assert.equal(app.$('#swap[open]'), null, 'the sheet did not close');
  assert.match(slotName(app, 0, 'dinner') ?? '', HER_DINNER_NAME,
    'the update that was waiting for the sheet is still waiting');
  assert.deepEqual(app.errors, []);
});

test('a sheet dismissed with Escape releases it too', async () => {
  // Escape goes through none of the buttons: the browser closes the dialog
  // itself and fires `close` on it. The harness's showModal/close stubs do not
  // fire that event, so it is dispatched here the way a browser would -- which
  // is exactly the wiring under test.
  const fetch = cloudFake({ row: {}, rev: 0 });
  const app = signedIn({ fetch });
  await settle(12);
  await flush(app);

  const row = [...app.$$('.day')[3].querySelectorAll('.slot')].find((r) => r.querySelector('[data-ban]'));
  app.click(row.querySelector('[data-ban]'));
  fetch.her(herVersionOf(fetch.row().doc));

  app.click(swapButton(app));
  await flush(app);
  assert.ok(app.$('#swap[open]'), 'the arrival was never deferred, so there is nothing to release');

  const dlg = app.$('#swap');
  dlg.removeAttribute('open');
  dlg.dispatchEvent(new app.window.Event('close'));
  await settle(4);

  assert.match(slotName(app, 0, 'dinner') ?? '', HER_DINNER_NAME,
    'Escape left her week sitting unpainted until the next poll');
  assert.deepEqual(app.errors, []);
});
