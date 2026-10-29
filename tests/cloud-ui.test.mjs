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
