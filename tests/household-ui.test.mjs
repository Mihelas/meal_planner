// The household card, driven against the real built file.
//
// src/household.js already has its own tests against a fake PostgREST. What
// these prove is the half that cannot be unit-tested: that the card appears
// only for an account that has one, that a button is wired to the call it
// claims, that a refusal reaches the screen in words, and -- the one that
// matters most -- that none of it is a precondition for planning a week.

import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from './harness.mjs';

const ME = 'd3f4a1b2-0000-4000-8000-000000000001';
const HER = 'd3f4a1b2-0000-4000-8000-000000000002';
const HID = 'aaaaaaaa-0000-4000-8000-00000000000a';

const reply = (status, payload) => ({
  ok: status < 400,
  status,
  async json() { return payload; },
  async text() { return JSON.stringify(payload); },
});

/** A PostgREST error body, as PostgREST actually shapes one. */
const pgError = (code, message) => reply(400, { code, message, details: null, hint: null });

/**
 * A fetch that routes by path instead of by turn.
 *
 * The queue the account tests use cannot work here: the card fires three
 * requests whose order is an implementation detail, and a queue would make a
 * test pass or fail on that detail rather than on the behaviour.
 */
function pgFake(routes = []) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { path, method, body, headers: init.headers ?? {} };
    calls.push(call);
    for (const [match, handler] of routes) {
      if (!path.includes(match)) continue;
      const out = typeof handler === 'function' ? handler(call) : handler;
      if (out !== undefined) return out;
    }
    // Loud rather than empty: an unrouted request is a test that does not know
    // what the app is doing, and [] would let it pass anyway.
    throw new Error(`no route for ${method} ${path}`);
  };
  fn.calls = calls;
  fn.to = (match, method = null) => calls.filter(
    (c) => c.path.includes(match) && (!method || c.method === method),
  );
  return fn;
}

/** A membership row as PostgREST returns it for `mine()`. */
const memberRow = (over = {}) => ({
  user_id: ME,
  role: 'owner',
  person_id: 'person1',
  joined_at: '2026-10-01T10:00:00Z',
  households: { id: HID, name: 'Home' },
  profiles: { display_name: '' },
  ...over,
});

/**
 * The app, signed in, with the household endpoints answered.
 *
 * Signed in via the URL hash, which is not a shortcut: that session carries no
 * user object at all, so this is also the path that proves `remote.userId()`
 * fetches the id the household queries are filtered on.
 */
function signedIn(routes = [], { stored = null, clipboard = null } = {}) {
  const fetch = pgFake([
    ['/auth/v1/user', reply(200, { id: ME, email: 'me@example.com' })],
    ...routes,
    ['/rest/v1/household_members', reply(200, [])],
    ['/rest/v1/household_invites', reply(200, [])],
  ]);
  const app = open({
    stored,
    extend: (win) => {
      win.fetch = fetch;
      // jsdom has no clipboard at all, which is also what an older phone looks
      // like, so the card has to cope with both.
      if (clipboard) Object.defineProperty(win.navigator, 'clipboard', { value: clipboard, configurable: true });
      win.location.hash = '#access_token=at-h&refresh_token=rt-h&expires_in=3600&token_type=bearer';
    },
  });
  return { app, fetch };
}

/**
 * Let the card's requests land. Three hops: the id, the list, then its contents.
 *
 * A macrotask per turn rather than a microtask: each one drains everything the
 * previous fetch queued, so n is a count of round trips and not of `.then`s.
 */
const settle = async (n = 6) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => { setTimeout(r, 0); });
};

const card = (app) => app.$('[data-panel="household"]');
const cardText = (app) => card(app)?.textContent.replace(/\s+/g, ' ') ?? '';

// ------------------------------------------------------------ not an account
test('signed out there is no household card, and nothing is asked of the network', () => {
  let touched = 0;
  const app = open({ extend: (win) => { win.fetch = () => { touched += 1; throw new Error('went to the network'); }; } });
  app.tab('settings');

  assert.equal(card(app), null, 'a signed-out phone was shown a household card');
  assert.equal(touched, 0);
  assert.deepEqual(app.errors, []);
});

test('a household that cannot be reached does not take the week with it', async () => {
  const app = open({
    extend: (win) => {
      win.fetch = () => { throw new TypeError('Failed to fetch'); };
      win.location.hash = '#access_token=at-h&refresh_token=rt-h&expires_in=3600';
    },
  });
  await settle(10);
  app.tab('settings');

  assert.equal(app.$$('.day').length, 7, 'the week went away over a failed household read');
  assert.match(cardText(app), /offline/i, 'offline was not said, or was called a refusal');
  assert.doesNotMatch(cardText(app), /not allowed|refused|permission/i);
  assert.deepEqual(app.errors, []);
});

// -------------------------------------------------------------- starting one
test('an account in no household is offered one to start and one to join', async () => {
  const { app } = signedIn();
  await settle();
  app.tab('settings');

  assert.ok(card(app), 'no household card for a signed-in account');
  assert.match(cardText(app), /not in a household/i);
  assert.ok(app.$('#hh-name'), 'nowhere to name a new household');
  assert.ok(app.$('#hh-code'), 'nowhere to type an invite code');
});

test('starting a household sends the typed name and reads the result back', async () => {
  let made = false;
  const { app, fetch } = signedIn([
    ['/rpc/create_household', () => { made = true; return reply(200, HID); }],
    ['/rest/v1/household_members', () => (made ? reply(200, [memberRow()]) : reply(200, []))],
  ]);
  await settle();
  app.tab('settings');
  app.set('#hh-name', '  Ours  ', 'input');
  app.click('[data-act="hh-create"]');
  await settle(10);

  const [post] = fetch.to('/rpc/create_household');
  assert.ok(post, 'nothing was sent');
  assert.equal(post.body.household_name, 'Ours', 'the name went untrimmed');
  assert.ok(post.body.seat, 'no seat was claimed');
  assert.match(cardText(app), /Home/, 'the card did not re-read after creating one');
  assert.deepEqual(app.errors, []);
});

test('a refusal from the database is shown in words rather than swallowed', async () => {
  const { app } = signedIn([
    ['/rpc/create_household', pgError('28000', 'you must be signed in to create a household')],
  ]);
  await settle();
  app.tab('settings');
  app.set('#hh-name', 'Ours', 'input');
  app.click('[data-act="hh-create"]');
  await settle(10);

  assert.match(cardText(app), /must be signed in/i, 'the refusal never reached the screen');
  assert.deepEqual(app.errors, []);
});

// ------------------------------------------------------------- what is in it
test('the card names the household, your role, and everybody in it', async () => {
  const { app } = signedIn([
    ['/rest/v1/household_members', (c) => (c.path.includes('user_id=eq.')
      ? reply(200, [memberRow()])
      : reply(200, [
        memberRow({ profiles: { display_name: '' } }),
        memberRow({
          user_id: HER, role: 'member', person_id: 'person2',
          joined_at: '2026-10-02T10:00:00Z', profiles: { display_name: 'Jacqueline' },
        }),
      ]))],
  ]);
  await settle();
  app.tab('settings');
  const t = cardText(app);

  assert.match(t, /Home/, 'the household has no name on screen');
  assert.match(t, /owner/i, 'your role is not shown');
  assert.match(t, /Jacqueline/, 'a member with a name is not shown by it');
  assert.match(t, /\byou\b/i, 'nothing says which row is you');
});

test('a member who never set a name is still called something a person recognises', async () => {
  // Her profile is empty until she edits it, which is the normal state on the
  // day she joins. The seat is a person in the plan, so the plan's own name for
  // that person beats both an empty string and a raw `person2`.
  const stored = JSON.stringify({
    settings: { people: [{ name: 'Nick' }, { name: 'Jacque' }] },
  });
  const { app } = signedIn([
    ['/rest/v1/household_members', (c) => (c.path.includes('user_id=eq.')
      ? reply(200, [memberRow()])
      : reply(200, [memberRow(), memberRow({
        user_id: HER, role: 'member', person_id: 'person2', profiles: { display_name: '' },
      })]))],
  ], { stored });
  await settle();
  app.tab('settings');

  assert.match(cardText(app), /Jacque/, 'a nameless member was not named by their seat');
  assert.doesNotMatch(cardText(app), /person2/, 'the raw seat id reached the screen');
});

// ------------------------------------------------------------------ inviting
test('an owner can issue an invite, and the code is shown to read out', async () => {
  const { app, fetch } = signedIn([
    ['/rpc/create_invite', reply(200, 'K7QM2W')],
    ['/rest/v1/household_members', (c) => (c.path.includes('user_id=eq.')
      ? reply(200, [memberRow()]) : reply(200, [memberRow()]))],
  ]);
  await settle();
  app.tab('settings');
  app.click('[data-act="hh-invite"]');
  await settle(10);

  const [post] = fetch.to('/rpc/create_invite');
  assert.ok(post, 'no invite was requested');
  assert.equal(post.body.target_household, HID);
  assert.equal(post.body.seat, 'person2', 'it invited somebody into a seat that is taken');
  assert.match(cardText(app), /K7QM2W/, 'the code is not on screen, so it cannot be read out');
  assert.equal(app.$('[data-act="hh-copy"]'), null, 'a Copy button with no clipboard behind it');
});

test('where there is a clipboard, the code can be copied instead of read out', async () => {
  const written = [];
  const { app } = signedIn([
    ['/rpc/create_invite', reply(200, 'K7QM2W')],
    ['/rest/v1/household_members', reply(200, [memberRow()])],
  ], { clipboard: { writeText: async (t) => { written.push(t); } } });
  await settle();
  app.tab('settings');
  app.click('[data-act="hh-invite"]');
  await settle(10);
  app.click('[data-act="hh-copy"]');
  await settle();

  assert.deepEqual(written, ['K7QM2W']);
  assert.match(cardText(app), /copied/i, 'nothing said it had been copied');
  assert.deepEqual(app.errors, []);
});

test('a pending invite can be taken back', async () => {
  const { app, fetch } = signedIn([
    ['/rest/v1/household_members', reply(200, [memberRow()])],
    ['/rest/v1/household_invites', (c) => (c.method === 'DELETE'
      ? reply(204, null)
      : reply(200, [{ code: 'K7QM2W', person_id: 'person2', expires_at: '2026-11-04T10:00:00Z' }]))],
  ]);
  await settle();
  app.tab('settings');
  assert.match(cardText(app), /K7QM2W/, 'a pending invite is not listed');

  app.click('[data-act="hh-revoke"]');
  await settle(10);

  const [gone] = fetch.to('/rest/v1/household_invites', 'DELETE');
  assert.ok(gone, 'nothing was deleted');
  assert.match(gone.path, /code=eq\.K7QM2W/, `deleted ${gone.path}`);
});

test('the seat an invite is for is one nobody already holds or has been offered', async () => {
  const { app, fetch } = signedIn([
    ['/rpc/create_invite', reply(200, 'NEW111')],
    ['/rest/v1/household_members', reply(200, [memberRow()])],
    ['/rest/v1/household_invites', (c) => (c.method === 'DELETE' ? reply(204, null) : reply(200, [
      { code: 'K7QM2W', person_id: 'person2', expires_at: '2026-11-04T10:00:00Z' },
    ]))],
  ]);
  await settle();
  app.tab('settings');

  // person1 is taken by the owner and person2 by the invite already out, so
  // there is nobody left to invite -- offering one anyway would guarantee a 23505.
  assert.equal(app.$('[data-act="hh-invite"]'), null,
    'an invite was offered into a seat that is already spoken for');
});

// ------------------------------------------------------------------- joining
test('joining sends the code exactly as typed and then shows the household', async () => {
  let joined = false;
  const { app, fetch } = signedIn([
    ['/rpc/redeem_invite', () => { joined = true; return reply(200, HID); }],
    ['/rest/v1/household_members', () => (joined
      ? reply(200, [memberRow({ role: 'member', person_id: 'person2' })])
      : reply(200, []))],
  ]);
  await settle();
  app.tab('settings');
  app.set('#hh-code', 'k7qm-2w ', 'input');
  app.click('[data-act="hh-join"]');
  await settle(10);

  const [post] = fetch.to('/rpc/redeem_invite');
  assert.ok(post, 'nothing was sent');
  assert.equal(post.body.invite_code, 'k7qm-2w ',
    'the client normalised a code the database is the only judge of');
  assert.match(cardText(app), /Home/, 'the card did not re-read after joining');
});

test('a code that is not a code says so without clearing what was typed', async () => {
  const { app } = signedIn([
    ['/rpc/redeem_invite', pgError('P0002', 'that invite is not valid')],
  ]);
  await settle();
  app.tab('settings');
  app.set('#hh-code', 'nope11', 'input');
  app.click('[data-act="hh-join"]');
  await settle(10);

  assert.match(cardText(app), /not valid/i);
  assert.equal(app.$('#hh-code').value, 'nope11', 'the code was thrown away, so it must be retyped');
});

// ------------------------------------------------------------------- leaving
test('leaving takes two presses, and the first one changes nothing', async () => {
  const { app, fetch } = signedIn([
    ['/rest/v1/household_members', (c) => (c.method === 'DELETE'
      ? reply(204, null)
      : reply(200, [memberRow()]))],
  ]);
  await settle();
  app.tab('settings');

  app.click('[data-act="hh-leave"]');
  await settle();
  assert.equal(fetch.to('/rest/v1/household_members', 'DELETE').length, 0,
    'one press left the household -- a mis-tap would have, too');
  assert.match(cardText(app), /\?/, 'nothing asked for a second press');

  app.click('[data-act="hh-leave-go"]');
  await settle(10);
  const [gone] = fetch.to('/rest/v1/household_members', 'DELETE');
  assert.ok(gone, 'the second press did not leave either');
  assert.match(gone.path, /household_id=eq\./);
  assert.doesNotMatch(gone.path, /user_id=/, 'it named the account; the policy is the filter');
});

test('an owner told who is in the way is shown that sentence, not a status code', async () => {
  const { app } = signedIn([
    ['/rpc/delete_household', pgError('42501', 'ask the other 1 member(s) to leave first')],
    ['/rest/v1/household_members', reply(200, [memberRow()])],
  ]);
  await settle();
  app.tab('settings');
  app.click('[data-act="hh-delete"]');
  await settle();
  app.click('[data-act="hh-delete-go"]');
  await settle(10);

  assert.match(cardText(app), /ask the other 1 member/i);
  assert.deepEqual(app.errors, []);
});

test('only an owner is offered the button that bins a household', async () => {
  const { app } = signedIn([
    ['/rest/v1/household_members', reply(200, [memberRow({ role: 'member', person_id: 'person2' })])],
  ]);
  await settle();
  app.tab('settings');

  assert.ok(app.$('[data-act="hh-leave"]'), 'a member cannot leave');
  assert.equal(app.$('[data-act="hh-delete"]'), null, 'a member was offered to delete the household');
  assert.equal(app.$('[data-act="hh-invite"]'), null, 'a member was offered to invite somebody');
});

// ------------------------------------------------------------------ renaming
test('an owner renaming it patches the household and keeps the new name', async () => {
  // The fake remembers the write: a database that forgets one would let the
  // card pass this by never re-reading at all.
  let name = 'Home';
  const { app, fetch } = signedIn([
    ['/rest/v1/households', (c) => {
      if (c.method !== 'PATCH') return undefined;
      name = c.body.name;
      return reply(200, [{ id: HID, name }]);
    }],
    ['/rest/v1/household_members', () => reply(200, [memberRow({ households: { id: HID, name } })])],
  ]);
  await settle();
  app.tab('settings');
  // Rename asks first, like leave and delete: the box only exists once opened,
  // which is also what keeps one #hh-rename in the page when you are in two
  // households.
  app.click('[data-act="hh-rename"]');
  app.set('#hh-rename', 'Ours', 'input');
  app.click('[data-act="hh-rename-go"]');
  await settle(10);

  const [patch] = fetch.to('/rest/v1/households', 'PATCH');
  assert.ok(patch, 'nothing was patched');
  assert.deepEqual(patch.body, { name: 'Ours' });
  assert.match(patch.headers.prefer ?? '', /return=representation/,
    'without the representation an ignored update looks like a successful one');
  assert.match(cardText(app), /Ours/);
});

test('an update the database quietly ignored is reported as the refusal it is', async () => {
  // PostgREST answers an update that matched no row with 200 and an empty list.
  // Reading that as success would show the new name until the next reload.
  const { app } = signedIn([
    ['/rest/v1/households', (c) => (c.method === 'PATCH' ? reply(200, []) : undefined)],
    ['/rest/v1/household_members', reply(200, [memberRow()])],
  ]);
  await settle();
  app.tab('settings');
  app.click('[data-act="hh-rename"]');
  app.set('#hh-rename', 'Ours', 'input');
  app.click('[data-act="hh-rename-go"]');
  await settle(10);

  assert.match(cardText(app), /only an owner/i);
  assert.deepEqual(app.errors, []);
});

// --------------------------------------------------------------- the account
test('signing out puts the household card away and asks nothing more', async () => {
  const { app, fetch } = signedIn([
    ['/auth/v1/logout', reply(204, null)],
    ['/rest/v1/household_members', reply(200, [memberRow()])],
  ]);
  await settle();
  app.tab('settings');
  assert.ok(card(app), 'no card to begin with');

  const before = fetch.calls.length;
  app.click('[data-act="account-signout"]');
  await settle(10);

  assert.equal(card(app), null, 'the household card outlived the session');
  const after = fetch.to('/rest/v1/household_members').length;
  assert.ok(after <= before, 'it kept reading households after signing out');
  assert.equal(app.$$('.day').length, 7);
});

test('the household is read once per sign-in, not once per render', async () => {
  const { app, fetch } = signedIn([
    ['/rest/v1/household_members', reply(200, [memberRow()])],
  ]);
  await settle();
  app.tab('settings');
  const first = fetch.to('/rest/v1/household_members').length;

  // Any keystroke re-renders the whole settings view.
  app.set('#hh-code', 'a', 'input');
  app.set('#hh-code', 'ab', 'input');
  app.tab('week');
  app.tab('settings');
  await settle(10);

  assert.equal(fetch.to('/rest/v1/household_members').length, first,
    'rendering the card asks the server again, so typing in it would loop');
});
