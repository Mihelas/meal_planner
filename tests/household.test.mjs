import test from 'node:test';
import assert from 'node:assert/strict';
import { createHouseholds, humanise } from '../src/household.js';

// ---------------------------------------------------------------- the fakes
//
// A fake PostgREST rather than a fake household.js: the interesting cases here
// are all things the real database says and a happy path never shows -- a
// unique violation from a taken seat, a raw RLS refusal, a 404 from a migration
// nobody ran. Routing by URL keeps each test honest about which endpoint it is
// actually exercising.

const reply = (status, payload) => ({
  ok: status < 400,
  status,
  async json() { return payload; },
  async text() { return JSON.stringify(payload); },
});

/** What PostgREST puts on the wire when a `raise exception` reaches it. */
const pgError = (code, message) => reply(400, { code, message, details: null, hint: null });

/**
 * A fake REST endpoint.
 *
 * `routes` is an array of [substring, handler]. The substring is matched against
 * the path, so a test says `/rpc/create_invite` rather than the whole URL.
 */
function fakeRest(routes = []) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const path = String(url).replace('https://db.example', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method ?? 'GET', headers: init.headers ?? {}, body });
    for (const [match, handler] of routes) {
      if (path.includes(match)) {
        return typeof handler === 'function' ? handler({ path, body, init }) : handler;
      }
    }
    return reply(200, []);
  };
  fn.calls = calls;
  return fn;
}

const offline = () => { throw new TypeError('Failed to fetch'); };

/**
 * The two methods household.js is allowed to know about.
 *
 * Deliberately not a real remote: this module's whole contract with auth is
 * "give me a token and my own id", and a test that wired up the real session
 * machinery would be testing remote.js again with extra steps.
 */
const stubRemote = ({ token = 'tok-1', id = 'u-me' } = {}) => ({
  accessToken: async () => token,
  userId: async () => id,
});

const subject = (routes, remote = stubRemote()) => {
  const doFetch = fakeRest(routes);
  const hh = createHouseholds({ remote, fetch: doFetch, url: 'https://db.example', key: 'pub-key' });
  return { hh, doFetch };
};

/** A membership row as the select in mine() would return it. */
const membershipRow = (over = {}) => ({
  role: 'owner',
  person_id: 'person1',
  joined_at: '2026-10-01T10:00:00Z',
  households: { id: 'h-1', name: 'Home' },
  ...over,
});

// -------------------------------------------------------------- signed out
//
// Every method begins by asking for a token, and a null one is an ordinary
// answer rather than an error -- see the note on accessToken() in remote.js.
// What must not happen is a request going out without one: PostgREST would
// answer as `anon`, and anon's answer to most of these is an empty list, which
// is indistinguishable from "you are in no households".

test('signed out, nothing is requested and nothing is claimed', async () => {
  const doFetch = fakeRest();
  const hh = createHouseholds({
    remote: { accessToken: async () => null, userId: async () => null },
    fetch: doFetch,
    url: 'https://db.example',
    key: 'pub-key',
  });
  const r = await hh.mine();
  assert.equal(r.ok, false);
  assert.match(r.error, /sign in/i);
  assert.equal(doFetch.calls.length, 0, 'a request went out without a token');
});

// ---------------------------------------------------------------- the token

test('every call carries the bearer token and the publishable key', async () => {
  const { hh, doFetch } = subject([['/rpc/create_household', reply(200, 'h-new')]]);
  await hh.create('Home', 'person1');
  const { headers } = doFetch.calls[0];
  assert.equal(headers.authorization, 'Bearer tok-1');
  assert.equal(headers.apikey, 'pub-key');
});

// ------------------------------------------------------------------ mine()

test('the households you are in come back with your own role and seat', async () => {
  const { hh, doFetch } = subject([['/household_members', reply(200, [
    membershipRow(),
    membershipRow({
      role: 'member',
      person_id: 'person2',
      households: { id: 'h-2', name: 'Lake house' },
    }),
  ])]]);

  const r = await hh.mine();
  assert.equal(r.ok, true);
  assert.deepEqual(r.households, [
    { id: 'h-1', name: 'Home', role: 'owner', seat: 'person1', joinedAt: '2026-10-01T10:00:00Z' },
    { id: 'h-2', name: 'Lake house', role: 'member', seat: 'person2', joinedAt: '2026-10-01T10:00:00Z' },
  ]);

  // Filtered to this account on the way out, not sorted out on the way in. The
  // select policy in 0002 returns your household-mates' rows as well as your
  // own, so a client that asked for everything would show you your partner's
  // seat as yours.
  assert.match(doFetch.calls[0].path, /user_id=eq\.u-me/);
});

test('a membership whose household did not come back is skipped, not rendered as undefined', async () => {
  // PostgREST drops the embedded object when the row it points at is filtered
  // away -- a race against somebody leaving, not something to crash the panel.
  const { hh } = subject([['/household_members', reply(200, [
    membershipRow({ households: null }),
    membershipRow(),
  ])]]);
  const r = await hh.mine();
  assert.equal(r.ok, true);
  assert.equal(r.households.length, 1);
  assert.equal(r.households[0].id, 'h-1');
});

// ---------------------------------------------------------------- create()

test('creating a household returns the id the function returned', async () => {
  const { hh, doFetch } = subject([['/rpc/create_household', reply(200, 'h-new')]]);
  const r = await hh.create('  Home  ', ' person1 ');
  assert.deepEqual(r, { ok: true, id: 'h-new' });
  // Trimmed here as well as in SQL, and not as belt-and-braces: the untrimmed
  // string is what an optimistic card would show until the next read, so
  // trimming only in the database means the name reads wrong for a second.
  assert.deepEqual(doFetch.calls[0].body, { household_name: 'Home', seat: 'person1' });
});

test('an empty name is left for the database to default rather than invented here', async () => {
  const { hh, doFetch } = subject([['/rpc/create_household', reply(200, 'h-new')]]);
  await hh.create('   ', 'person1');
  // create_household coalesces this to 'Home'. Sending 'Home' from here too
  // would be a second place to change if that default ever moved.
  assert.equal(doFetch.calls[0].body.household_name, '');
});

// ---------------------------------------------------------------- invite()

test('an invite comes back as a code', async () => {
  const { hh, doFetch } = subject([['/rpc/create_invite', reply(200, 'ABCD234XYZ')]]);
  const r = await hh.invite('h-1', 'person2', 7);
  assert.deepEqual(r, { ok: true, code: 'ABCD234XYZ' });
  assert.deepEqual(doFetch.calls[0].body, {
    target_household: 'h-1', seat: 'person2', valid_days: 7,
  });
});

test('inviting into a seat somebody already has says so in words', async () => {
  const { hh } = subject([
    ['/rpc/create_invite', pgError('23505', 'somebody is already in that seat')],
  ]);
  const r = await hh.invite('h-1', 'person1');
  assert.equal(r.ok, false);
  // The function's own message, not one derived from the errcode: 0003 writes
  // these for people to read, and 23505 also arrives from constraint violations
  // whose wording would be nothing like this.
  assert.match(r.error, /already in that seat/i);
});

// ------------------------------------------------------------------ join()

test('a code typed with spaces and dashes reaches the server as typed', async () => {
  const { hh, doFetch } = subject([['/rpc/redeem_invite', reply(200, 'h-1')]]);
  const r = await hh.join('abcd-234 xyz');
  assert.deepEqual(r, { ok: true, id: 'h-1' });
  // normalise_invite_code() in 0003 is the single definition of what a code is.
  // Stripping separators here too would make two definitions that can drift, and
  // the one that matters is the one compared against the primary key.
  assert.equal(doFetch.calls[0].body.invite_code, 'abcd-234 xyz');
});

test('a wrong, spent or expired code gets the one answer the database gives', async () => {
  const { hh } = subject([
    ['/rpc/redeem_invite', pgError('P0002', 'that invite is not valid')],
  ]);
  const r = await hh.join('NOPE');
  assert.equal(r.ok, false);
  assert.match(r.error, /not valid/i);
});

test('joining with nothing typed does not cost a request', async () => {
  const { hh, doFetch } = subject([['/rpc/redeem_invite', reply(200, 'h-1')]]);
  const r = await hh.join('   ');
  assert.equal(r.ok, false);
  assert.match(r.error, /code/i);
  assert.equal(doFetch.calls.length, 0);
});

// --------------------------------------------------------------- members()

test('members come back with their seats and whichever name they have set', async () => {
  const { hh } = subject([['/household_members', reply(200, [
    {
      user_id: 'u-me', role: 'owner', person_id: 'person1',
      joined_at: '2026-10-01T10:00:00Z', profiles: { display_name: 'Nick' },
    },
    {
      user_id: 'u-her', role: 'member', person_id: 'person2',
      joined_at: '2026-10-02T10:00:00Z', profiles: { display_name: '' },
    },
  ])]]);

  const r = await hh.members('h-1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.members, [
    {
      userId: 'u-me', role: 'owner', seat: 'person1',
      displayName: 'Nick', name: 'Nick', you: true,
      joinedAt: '2026-10-01T10:00:00Z',
    },
    // No display name set, so the seat is the name. Better than an email the
    // plan never uses, and better than 'Unknown'. `displayName` stays empty, so
    // a caller with a better fallback -- the app, which knows what the plan
    // calls that seat -- can tell the difference.
    {
      userId: 'u-her', role: 'member', seat: 'person2',
      displayName: '', name: 'person2', you: false,
      joinedAt: '2026-10-02T10:00:00Z',
    },
  ]);
});

// --------------------------------------------------------------- invites()

test('pending invites list, and a redeemed one is not pending', async () => {
  const { hh, doFetch } = subject([['/household_invites', reply(200, [
    {
      code: 'ABCD234XYZ', person_id: 'person2',
      expires_at: '2026-11-04T10:00:00Z', redeemed_by: null,
    },
  ])]]);
  const r = await hh.invites('h-1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.invites, [
    { code: 'ABCD234XYZ', seat: 'person2', expiresAt: '2026-11-04T10:00:00Z' },
  ]);
  // Asked for in the query rather than filtered afterwards: a household running
  // for a year has a row per invite ever issued, and all but a couple are spent.
  assert.match(doFetch.calls[0].path, /redeemed_by=is\.null/);
});

test('revoking an invite deletes exactly that code', async () => {
  const { hh, doFetch } = subject([['/household_invites', reply(204, null)]]);
  const r = await hh.revoke('ABCD234XYZ');
  assert.equal(r.ok, true);
  assert.equal(doFetch.calls[0].method, 'DELETE');
  assert.match(doFetch.calls[0].path, /code=eq\.ABCD234XYZ/);
});

// ----------------------------------------------------------------- leave()

test('leaving sends no user filter, because the policy is the filter', async () => {
  const { hh, doFetch } = subject([['/household_members', reply(204, null)]]);
  const r = await hh.leave('h-1');
  assert.equal(r.ok, true);
  assert.equal(doFetch.calls[0].method, 'DELETE');
  assert.match(doFetch.calls[0].path, /household_id=eq\.h-1/);
  // `leave a household` in 0002 is `using (user_id = auth.uid())`, so this
  // deletes one row however it is addressed. Naming the user here would add a
  // second thing that has to be right, and would quietly delete nothing at all
  // if that id were ever stale.
  assert.doesNotMatch(doFetch.calls[0].path, /user_id/);
});

// ---------------------------------------------------------------- remove()

test('deleting a household you still share says who is in the way', async () => {
  const { hh } = subject([
    ['/rpc/delete_household', pgError('42501', 'ask the other 1 member(s) to leave first')],
  ]);
  const r = await hh.remove('h-1');
  assert.equal(r.ok, false);
  assert.match(r.error, /leave first/i);
});

test('a plain member is told it is not theirs to delete', async () => {
  const { hh } = subject([
    ['/rpc/delete_household', pgError('42501', 'only an owner can delete a household')],
  ]);
  const r = await hh.remove('h-1');
  assert.equal(r.ok, false);
  assert.match(r.error, /owner/i);
});

// ---------------------------------------------------------------- rename()

test('renaming patches the household', async () => {
  const { hh, doFetch } = subject([
    ['/households', reply(200, [{ id: 'h-1', name: 'The flat' }])],
  ]);
  const r = await hh.rename('h-1', '  The flat ');
  assert.equal(r.ok, true);
  assert.equal(doFetch.calls[0].method, 'PATCH');
  assert.deepEqual(doFetch.calls[0].body, { name: 'The flat' });
});

test('a member renaming a household is refused without the row being changed', async () => {
  // RLS does not raise for an update that matches no row -- it returns an empty
  // representation and a 200. Reading that as success is the subtle failure
  // this guards: the card would show the new name until the next reload.
  const { hh } = subject([['/households', reply(200, [])]]);
  const r = await hh.rename('h-1', 'Mine now');
  assert.equal(r.ok, false);
  assert.match(r.error, /owner/i);
});

// ----------------------------------------------------------------- offline

test('offline is not refusal', async () => {
  const hh = createHouseholds({
    remote: stubRemote(), fetch: offline, url: 'https://db.example', key: 'pub-key',
  });
  const r = await hh.mine();
  assert.equal(r.ok, false);
  assert.match(r.error, /offline/i);
  // Same rule as remote.js: a network problem reported as a refusal teaches
  // people to re-type things that were never wrong.
  assert.doesNotMatch(r.error, /not allowed|refused|permission/i);
});

// ------------------------------------------------------------- the messages

test('a raw row-level-security refusal is not shown to anybody', async () => {
  const { hh } = subject([['/households', reply(403, {
    code: '42501',
    message: 'new row violates row-level security policy for table "households"',
  })]]);
  const r = await hh.rename('h-1', 'Mine now');
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error, /row-level|policy|table/i);
});

test('a missing function names the migration rather than the HTTP status', async () => {
  // PostgREST answers 404 for an RPC it has no entry for, which in practice
  // means a migration that was written but never run. Reporting "404" would
  // send somebody to the network tab instead of to migrations/.
  const { hh } = subject([['/rpc/create_household', reply(404, {
    code: 'PGRST202',
    message: 'Could not find the function public.create_household in the schema cache',
  })]]);
  const r = await hh.create('Home', 'person1');
  assert.equal(r.ok, false);
  assert.match(r.error, /migration/i);
});

test('an expired token asks for a fresh sign-in instead of blaming the household', async () => {
  const { hh } = subject([['/household_members', reply(401, {
    code: 'PGRST301', message: 'JWT expired',
  })]]);
  const r = await hh.mine();
  assert.equal(r.ok, false);
  assert.match(r.error, /sign in/i);
});

test('humanise leaves a sentence the database wrote alone', () => {
  // The guard on all of the above: 0003 and 0004 write their messages for
  // people, and a client that rewrote them by errcode would have to keep four
  // different 42501s apart by hand.
  assert.equal(
    humanise({ code: '42501', message: 'ask the other 2 member(s) to leave first' }),
    'ask the other 2 member(s) to leave first',
  );
  assert.notEqual(
    humanise({ code: '42501', message: 'new row violates row-level security policy' }),
    'new row violates row-level security policy',
  );
});
