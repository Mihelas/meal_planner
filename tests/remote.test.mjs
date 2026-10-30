import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_KEY, PENDING_KEY, REFRESH_SKEW_MS,
  OTP_PATH, TOKEN_PATH, LOGOUT_PATH, VERIFY_PATH, USER_PATH,
  normaliseSession, isExpired, expiresInMs, sessionFromHash,
  memorySession, sessionStore, pendingStore, describeRemote, createRemote,
} from '../src/remote.js';
import { createStore, snapshot, emptyState } from '../src/store.js';

// ---------------------------------------------------------------- the fakes
//
// Auth is a handful of HTTP calls and a clock, and both are injectable for the
// same reason sync.js injects its file handles: the interesting cases are the
// ones a real network will not produce on demand. A fake fetch can be offline,
// rate-limited, or hand back a refused refresh token on the third call.

const T0 = Date.UTC(2026, 9, 19, 9, 0, 0);   // a fixed clock, so expiry is arithmetic

/** A session as the app stores it, `mins` minutes from expiring. */
const freshFor = (mins, extra = {}) => ({
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  expiresAt: T0 + mins * 60_000,
  email: 'someone@example.com',
  userId: 'u-1',
  ...extra,
});

/** What Supabase actually puts on the wire. */
const wirePayload = (over = {}) => ({
  access_token: 'at-new',
  refresh_token: 'rt-new',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'u-1', email: 'someone@example.com' },
  ...over,
});

/**
 * A fetch that records every call and replies from a queue.
 *
 * Replies are functions so a test can assert on the request as it arrives, and
 * so the third call can fail where the first two succeeded.
 */
function fakeFetch(replies = []) {
  const calls = [];
  const queue = [...replies];
  const fn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (!next) return jsonReply(200, {});
    return typeof next === 'function' ? next({ url, init, body }) : next;
  };
  fn.calls = calls;
  return fn;
}

const jsonReply = (status, payload) => ({
  ok: status < 400,
  status,
  async json() { return payload; },
  async text() { return JSON.stringify(payload); },
});

const offline = () => { throw new TypeError('Failed to fetch'); };

function fakeWin({ hash = '', href = 'https://mihelas.github.io/meal_planner/' } = {}) {
  const store = new Map();
  const win = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    location: { href, hash, origin: 'https://mihelas.github.io', pathname: '/meal_planner/' },
    history: {
      replaced: [],
      replaceState(_a, _b, url) { win.history.replaced.push(url); win.location.hash = ''; },
    },
    raw: store,
  };
  return win;
}

const remote = (over = {}) => createRemote({
  win: fakeWin(),
  fetch: fakeFetch([jsonReply(200, {})]),
  session: memorySession(),
  now: () => T0,
  ...over,
});

// ------------------------------------------------------- reading the wire
//
// expires_in is seconds and expires_at is epoch seconds, while everything in
// this app is epoch milliseconds. That conversion is exactly where an
// off-by-1000 lives, so it gets its own tests rather than being trusted.

test('a wire payload becomes a session with expiry in milliseconds', () => {
  const s = normaliseSession(wirePayload(), T0);
  assert.equal(s.accessToken, 'at-new');
  assert.equal(s.refreshToken, 'rt-new');
  assert.equal(s.expiresAt, T0 + 3600 * 1000);
  assert.equal(s.email, 'someone@example.com');
  assert.equal(s.userId, 'u-1');
});

test('an explicit expires_at wins over expires_in, and is still seconds on the wire', () => {
  const at = Math.floor(T0 / 1000) + 900;
  const s = normaliseSession(wirePayload({ expires_at: at }), T0);
  assert.equal(s.expiresAt, at * 1000);
});

test('a payload with no access token is not a session', () => {
  for (const p of [null, undefined, {}, { refresh_token: 'rt' }, { access_token: '' }]) {
    assert.equal(normaliseSession(p, T0), null, `${JSON.stringify(p)} should not be a session`);
  }
});

test('a session with no expiry at all is treated as already expired, not as eternal', () => {
  // Fail closed: an unreadable expiry must mean "refresh", never "valid for ever".
  assert.equal(isExpired({ accessToken: 'at' }, T0), true);
  assert.equal(isExpired(null, T0), true);
  assert.equal(isExpired({ accessToken: 'at', expiresAt: 'soon' }, T0), true);
});

test('expiry is decided by the clock, to the second', () => {
  assert.equal(isExpired({ accessToken: 'a', expiresAt: T0 - 1 }, T0), true);
  assert.equal(isExpired({ accessToken: 'a', expiresAt: T0 + 1 }, T0), false);
  assert.equal(expiresInMs(freshFor(10), T0), 600_000);
  assert.equal(expiresInMs(freshFor(-5), T0), -300_000, 'an expired session reads negative, not zero');
  assert.equal(expiresInMs(null, T0), 0);
});

// ------------------------------------------------------------ magic links
test('signing in asks for a one-time link, with the key and a way back to this page', async () => {
  const fetch = fakeFetch([jsonReply(200, {})]);
  const r = await remote({ fetch }).signIn('someone@example.com');
  assert.equal(r.ok, true);
  assert.equal(fetch.calls.length, 1);
  const [call] = fetch.calls;
  assert.ok(call.url.endsWith(OTP_PATH), `posted to ${call.url}`);
  assert.equal(call.method, 'POST');
  assert.ok(call.headers.apikey, 'the publishable key has to travel with it');
  assert.equal(call.body.email, 'someone@example.com');
  assert.ok(call.body.options?.email_redirect_to?.startsWith('https://mihelas.github.io'),
    `no way back to the app: ${JSON.stringify(call.body.options)}`);
});

test('an email address is trimmed and lower-cased before it is sent', async () => {
  const fetch = fakeFetch([jsonReply(200, {})]);
  await remote({ fetch }).signIn('  SomeOne@Example.COM  ');
  assert.equal(fetch.calls[0].body.email, 'someone@example.com');
});

test('a blank email is refused here, without a round trip', async () => {
  const fetch = fakeFetch([jsonReply(200, {})]);
  const r = await remote({ fetch }).signIn('   ');
  assert.equal(r.ok, false);
  assert.match(r.error, /email/i);
  assert.equal(fetch.calls.length, 0, 'nothing should have been sent');
});

test('signing in with no network says so in words, rather than throwing', async () => {
  const r = await remote({ fetch: offline }).signIn('someone@example.com');
  assert.equal(r.ok, false);
  assert.match(r.error, /offline|connect|network/i, `unhelpful message: ${r.error}`);
});

test('being rate-limited is reported as something to wait out, not as a failure to retry', async () => {
  const fetch = fakeFetch([jsonReply(429, { message: 'For security purposes, you can only request this after 54 seconds.' })]);
  const r = await remote({ fetch }).signIn('someone@example.com');
  assert.equal(r.ok, false);
  assert.match(r.error, /54|wait|moment/i, `unhelpful message: ${r.error}`);
});

// -------------------------------------------------- coming back by code
//
// A corporate mailbox is the reason this exists. Outlook Safe Links and every
// other scanner of its kind *fetches* a link before a person ever sees it,
// which spends a one-time token; the human then clicks an expired link and is
// told, truthfully but uselessly, that it has expired. A code cannot be spent
// by something that never types it. It also needs no redirect URL at all,
// which removes the whole allow-list failure mode with it.

test('asking for a link remembers the address, so a code can be checked after a reload', async () => {
  const win = fakeWin();
  const r = remote({ win, fetch: fakeFetch([jsonReply(200, {})]) });
  await r.signIn('  SomeOne@Example.com ');
  assert.equal(r.pendingEmail(), 'someone@example.com', 'the normalised address was not kept');
  // The phone is very likely to be evicted from memory while the mail app is
  // open, so this has to survive a reload rather than living in a closure.
  //
  // Read on T0, the same clock signIn() wrote with. Letting `get()` default to
  // the real Date.now() made this test pass on the day it was written and fail
  // every day after: the record is stamped at T0, the TTL is 24 hours, and the
  // wall clock walks away from a frozen constant at exactly one day per day.
  assert.equal(pendingStore(win).get(T0)?.email, 'someone@example.com');
});

test('a code is exchanged for a session, with the address it was sent to', async () => {
  const fetch = fakeFetch([jsonReply(200, {}), jsonReply(200, wirePayload())]);
  const r = remote({ fetch });
  await r.signIn('someone@example.com');
  const out = await r.verifyCode('123456');

  assert.equal(out.ok, true, out.error);
  assert.equal(fetch.calls.length, 2);
  const call = fetch.calls[1];
  assert.ok(call.url.endsWith(VERIFY_PATH), `posted to ${call.url}`);
  assert.deepEqual(call.body, { email: 'someone@example.com', token: '123456', type: 'email' });
  assert.equal(r.signedIn(), true);
  assert.equal(r.session().accessToken, 'at-new');
});

test('a code is accepted however it was copied out of the email', async () => {
  for (const typed of ['123 456', '123-456', ' 123456 ', '123456']) {
    const fetch = fakeFetch([jsonReply(200, {}), jsonReply(200, wirePayload())]);
    const r = remote({ fetch });
    await r.signIn('someone@example.com');
    await r.verifyCode(typed);
    assert.equal(fetch.calls[1].body.token, '123456', `"${typed}" was sent as "${fetch.calls[1].body.token}"`);
  }
});

test('a code from a brand-new account still works, whichever email carried it', async () => {
  // An address Supabase has never seen gets the Confirm signup email, not the
  // Magic Link one, and its code verifies under a different type. Nobody should
  // have to know that to sign in for the first time.
  const fetch = fakeFetch([
    jsonReply(200, {}),
    jsonReply(403, { msg: 'Token has expired or is invalid' }),
    jsonReply(200, wirePayload()),
  ]);
  const r = remote({ fetch });
  await r.signIn('someone@example.com');
  const out = await r.verifyCode('123456');

  assert.equal(out.ok, true, out.error);
  assert.equal(r.signedIn(), true);
  assert.deepEqual(fetch.calls.slice(1).map((c) => c.body.type), ['email', 'signup'],
    'the fallback did not try the other kind of email');
});

test('a wrong code is refused in words, and leaves you signed out and able to retry', async () => {
  const fetch = fakeFetch([
    jsonReply(200, {}),
    jsonReply(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' }),
  ]);
  const r = remote({ fetch });
  await r.signIn('someone@example.com');
  const out = await r.verifyCode('000000');

  assert.equal(out.ok, false);
  assert.match(out.error, /expired|invalid/i, `unhelpful message: ${out.error}`);
  assert.equal(fetch.calls.length, 3, 'both kinds of email should have been tried before giving up');
  assert.equal(r.signedIn(), false);
  // The address stays: the whole point is that they can ask for another code
  // without typing their email again.
  assert.equal(r.pendingEmail(), 'someone@example.com');
});

test('a code typed with no address asked for first is refused without a round trip', async () => {
  const fetch = fakeFetch([jsonReply(200, wirePayload())]);
  const r = remote({ fetch });
  const out = await r.verifyCode('123456');
  assert.equal(out.ok, false);
  assert.match(out.error, /email|address/i, `unhelpful message: ${out.error}`);
  assert.equal(fetch.calls.length, 0, 'a request went out with no address to verify against');
});

test('a blank code is refused without a round trip', async () => {
  const fetch = fakeFetch([jsonReply(200, {}), jsonReply(200, wirePayload())]);
  const r = remote({ fetch });
  await r.signIn('someone@example.com');
  const out = await r.verifyCode('   ');
  assert.equal(out.ok, false);
  assert.equal(fetch.calls.length, 1, 'only the sign-in request should have gone out');
});

test('verifying with no network keeps the address, because the code is still good', async () => {
  let first = true;
  const fetch = fakeFetch([({ url }) => {
    if (first && url.endsWith(OTP_PATH)) { first = false; return jsonReply(200, {}); }
    return offline();
  }]);
  const r = remote({ fetch });
  await r.signIn('someone@example.com');
  const out = await r.verifyCode('123456');

  assert.equal(out.ok, false);
  assert.match(out.error, /offline|connect|network/i, `unhelpful message: ${out.error}`);
  assert.equal(r.pendingEmail(), 'someone@example.com', 'the address was thrown away over a dropped connection');
});

test('a code that works clears the address it was waiting on', async () => {
  const win = fakeWin();
  const r = remote({ win, fetch: fakeFetch([jsonReply(200, {}), jsonReply(200, wirePayload())]) });
  await r.signIn('someone@example.com');
  await r.verifyCode('123456');
  assert.equal(r.pendingEmail(), null);
  assert.equal(win.raw.has(PENDING_KEY), false, 'a stale sign-in was left in storage');
});

test('signing out forgets the address as well as the session', async () => {
  const win = fakeWin();
  const r = remote({ win, fetch: fakeFetch([jsonReply(200, {})]) });
  await r.signIn('someone@example.com');
  await r.signOut();
  assert.equal(r.pendingEmail(), null);
  assert.equal(win.raw.has(PENDING_KEY), false);
});

test('a mistyped address is not a dead end -- the code box can be abandoned', async () => {
  const win = fakeWin();
  const r = remote({ win, fetch: fakeFetch([jsonReply(200, {})]) });
  await r.signIn('someoen@example.com');     // the classic typo
  assert.equal(r.status().sent, true);

  r.cancelSignIn();
  assert.equal(r.pendingEmail(), null);
  assert.equal(r.status().sent, false, 'the panel would still be asking for a code');
  assert.equal(win.raw.has(PENDING_KEY), false);
});

test('an address waiting for a code expires on its own rather than lingering for ever', () => {
  const win = fakeWin();
  const box = pendingStore(win);
  box.set({ email: 'someone@example.com', at: T0 });
  assert.equal(box.get(T0 + 30 * 60_000)?.email, 'someone@example.com', 'half an hour in, it should still be there');
  // Supabase expires the code itself; this only stops a week-old address being
  // offered back as though a code were still on its way.
  assert.equal(box.get(T0 + 25 * 60 * 60_000), null, 'a day later it should be gone');
});

test('the address waiting for a code never reaches the shared file either', () => {
  const win = fakeWin();
  pendingStore(win).set({ email: 'someone@example.com', at: T0 });
  const text = JSON.stringify(snapshot(emptyState(), 'd1'));
  assert.equal(text.includes('someone@example.com'), false, 'the address travelled into the shared file');
  assert.notEqual(PENDING_KEY, 'mealplanner.v1');
});

// --------------------------------------------------- coming back from email
test('tokens arriving in the URL hash become a stored session', () => {
  const hash = '#access_token=at-h&refresh_token=rt-h&expires_in=3600&token_type=bearer';
  const s = sessionFromHash(hash, T0);
  assert.equal(s.accessToken, 'at-h');
  assert.equal(s.refreshToken, 'rt-h');
  assert.equal(s.expiresAt, T0 + 3600 * 1000);
});

test('a hash with no tokens in it is nothing, not a broken session', () => {
  for (const h of ['', '#', '#tab=week', undefined]) {
    assert.equal(sessionFromHash(h, T0), null, `${h} should be nothing`);
  }
});

test('completing a sign-in wipes the hash, so the token leaves the address bar', async () => {
  const win = fakeWin({ hash: '#access_token=at-h&refresh_token=rt-h&expires_in=3600' });
  const session = memorySession();
  const r = await createRemote({ win, fetch: fakeFetch(), session, now: () => T0 }).completeFromUrl();

  assert.equal(r.signedIn, true);
  assert.equal(session.get().accessToken, 'at-h');
  assert.equal(win.location.hash, '', 'the token is still in the address bar');
  assert.equal(win.history.replaced.length, 1, 'history should have been rewritten, not pushed');
});

test('an error in the hash is surfaced and nothing is stored', async () => {
  const win = fakeWin({ hash: '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired' });
  const session = memorySession();
  const r = await createRemote({ win, fetch: fakeFetch(), session, now: () => T0 }).completeFromUrl();

  assert.equal(r.signedIn, false);
  assert.match(r.error, /invalid|expired/i, `swallowed the reason: ${r.error}`);
  assert.equal(session.get(), null);
  assert.equal(win.location.hash, '', 'a failed link should not be left to be retried on reload');
});

test('arriving with no hash at all is a no-op', async () => {
  const session = memorySession();
  const r = await createRemote({ win: fakeWin(), fetch: fakeFetch(), session, now: () => T0 }).completeFromUrl();
  assert.equal(r.signedIn, false);
  assert.equal(r.error, null);
  assert.equal(session.get(), null);
});

// --------------------------------------------------------- silent refresh
test('a comfortably fresh token is handed back without touching the network', async () => {
  const fetch = fakeFetch([jsonReply(200, wirePayload())]);
  const session = memorySession(freshFor(60));
  const token = await remote({ fetch, session }).accessToken();
  assert.equal(token, 'at-1');
  assert.equal(fetch.calls.length, 0, 'it refreshed a token that had an hour left');
});

test('a token inside the skew window is refreshed before it is handed out', async () => {
  const fetch = fakeFetch([jsonReply(200, wirePayload())]);
  const session = memorySession(freshFor(0.5));   // 30s left, inside the skew
  assert.ok(REFRESH_SKEW_MS > 30_000, 'this test assumes the skew is wider than 30s');

  const token = await remote({ fetch, session }).accessToken();
  assert.equal(token, 'at-new');
  assert.equal(fetch.calls.length, 1);
  assert.ok(fetch.calls[0].url.includes(TOKEN_PATH), `refreshed via ${fetch.calls[0].url}`);
  assert.equal(fetch.calls[0].body.refresh_token, 'rt-1');
  assert.equal(session.get().accessToken, 'at-new', 'the new token was not kept');
});

test('an expired token still refreshes rather than being handed out dead', async () => {
  const fetch = fakeFetch([jsonReply(200, wirePayload())]);
  const session = memorySession(freshFor(-30));
  assert.equal(await remote({ fetch, session }).accessToken(), 'at-new');
});

test('four callers at once cause exactly one refresh', async () => {
  // A render with several widgets asks for a token several times in the same
  // tick. Four refreshes would mean three of them racing to invalidate each
  // other's refresh token, and Supabase rotates it on every use.
  const fetch = fakeFetch([jsonReply(200, wirePayload())]);
  const r = remote({ fetch, session: memorySession(freshFor(0.5)) });
  const tokens = await Promise.all([r.accessToken(), r.accessToken(), r.accessToken(), r.accessToken()]);
  assert.deepEqual(tokens, ['at-new', 'at-new', 'at-new', 'at-new']);
  assert.equal(fetch.calls.length, 1, `${fetch.calls.length} refreshes went out`);
});

test('a refused refresh token signs you out instead of retrying for ever', async () => {
  const fetch = fakeFetch([jsonReply(400, { error: 'invalid_grant', error_description: 'Refresh Token Not Found' })]);
  const session = memorySession(freshFor(-1));
  const r = remote({ fetch, session });

  assert.equal(await r.accessToken(), null);
  assert.equal(session.get(), null, 'a dead session has to be cleared, or every call retries it');
  assert.equal(r.signedIn(), false);

  await r.accessToken();
  assert.equal(fetch.calls.length, 1, 'it kept asking with a token the server has already refused');
});

test('a refresh that fails on the network keeps the session, because the token may still be good', async () => {
  // Offline is not the same as refused. Clearing here would sign people out
  // every time they opened the app in a tunnel.
  const session = memorySession(freshFor(-1));
  const r = remote({ fetch: offline, session });
  assert.equal(await r.accessToken(), null);
  assert.ok(session.get(), 'an offline moment should not destroy the session');
  assert.equal(r.signedIn(), true);
});

// ---------------------------------------------------------------- sign-out
test('signing out clears the session even when the network call fails', async () => {
  const session = memorySession(freshFor(60));
  const r = remote({ fetch: offline, session });
  const out = await r.signOut();
  assert.equal(out.ok, true, 'you must be able to sign out of a borrowed phone on a plane');
  assert.equal(session.get(), null);
  assert.equal(r.signedIn(), false);
});

test('signing out tells the server too, with the token it is revoking', async () => {
  const fetch = fakeFetch([jsonReply(204, {})]);
  const session = memorySession(freshFor(60));
  await remote({ fetch, session }).signOut();
  const [call] = fetch.calls;
  assert.ok(call.url.endsWith(LOGOUT_PATH), `posted to ${call.url}`);
  assert.equal(call.headers.authorization, 'Bearer at-1');
});

// ---------------------------------------------------------- who is signed in
//
// Households are keyed on the account id, and the one case that matters is the
// one a happy path never reaches: a session built out of a magic-link URL has
// no user object in it at all.

test('an id the session already carries costs nothing to read', async () => {
  const fetch = fakeFetch([jsonReply(200, { id: 'u-wrong' })]);
  const id = await remote({ fetch, session: memorySession(freshFor(60)) }).userId();
  assert.equal(id, 'u-1');
  assert.equal(fetch.calls.length, 0, 'it asked the server something it already knew');
});

test('a session that came from an email link learns who it belongs to, once', async () => {
  // Exactly what sessionFromHash() builds: tokens and an expiry, no user.
  const fetch = fakeFetch([jsonReply(200, { id: 'u-7', email: 'someone@example.com' })]);
  const session = memorySession(freshFor(60, { userId: null }));
  const r = remote({ fetch, session });

  assert.equal(await r.userId(), 'u-7');
  assert.equal(await r.userId(), 'u-7', 'the second read should be free');
  assert.equal(fetch.calls.length, 1, 'the id was fetched more than once');
  const [call] = fetch.calls;
  assert.ok(call.url.endsWith(USER_PATH), `asked ${call.url}`);
  assert.equal(call.method, 'GET');
  assert.equal(call.headers.authorization, 'Bearer at-1');
});

test('signed out, nobody is signed in and nothing is asked', async () => {
  const fetch = fakeFetch([jsonReply(200, { id: 'u-7' })]);
  assert.equal(await remote({ fetch, session: memorySession() }).userId(), null);
  assert.equal(fetch.calls.length, 0);
});

test('an id that cannot be fetched is null, not a crash and not a guess', async () => {
  for (const f of [offline, fakeFetch([jsonReply(401, { message: 'bad jwt' })])]) {
    const session = memorySession(freshFor(60, { userId: null }));
    assert.equal(await remote({ fetch: f, session }).userId(), null);
  }
});

test('an id does not outlive the session it belonged to', async () => {
  // The cache is per sign-in, and a shared phone is the whole reason to care:
  // an id left behind would attach her plan to his household.
  const fetch = fakeFetch([jsonReply(200, { id: 'u-7' })]);
  const session = memorySession(freshFor(60, { userId: null }));
  const r = remote({ fetch, session });
  assert.equal(await r.userId(), 'u-7');

  await r.signOut();
  assert.equal(await r.userId(), null, 'the id outlived the session it belonged to');
});

// ------------------------------------------------- where the token is kept
test('the session lives in its own storage key, not in the app state', () => {
  const win = fakeWin();
  const box = sessionStore(win);
  box.set(freshFor(60));

  assert.ok(win.raw.has(SESSION_KEY), 'nothing was written where it was meant to be');
  assert.notEqual(SESSION_KEY, 'mealplanner.v1');
  const reread = createStore(win);
  reread.load();
  assert.equal(JSON.stringify(reread.state).includes('rt-1'), false, 'the refresh token is in the app state');
});

test('a token never reaches the file that syncs to a shared folder', () => {
  // sync.js writes snapshot(state) into a Dropbox folder and merges whatever it
  // finds there. A session kept in state would be handed to the other person's
  // device on the next pull -- a refresh token, in a folder, in plain text.
  const win = fakeWin();
  sessionStore(win).set(freshFor(60));
  const text = JSON.stringify(snapshot(emptyState(), 'd1'));
  for (const secret of ['at-1', 'rt-1', 'someone@example.com']) {
    assert.equal(text.includes(secret), false, `${secret} travelled into the shared file`);
  }
});

test('a corrupt stored session reads as signed out rather than crashing the app', () => {
  const win = fakeWin();
  win.localStorage.setItem(SESSION_KEY, '{not json');
  assert.equal(sessionStore(win).get(), null);
  win.localStorage.setItem(SESSION_KEY, '{"accessToken":""}');
  assert.equal(sessionStore(win).get(), null, 'a session with no token is not a session');
});

// ------------------------------------------------------------- the caption
test('the account line says what is true, in words a person can act on', () => {
  assert.match(describeRemote(null, {}, T0).text, /not signed in|signed out/i);
  assert.equal(describeRemote(null, {}, T0).signedIn, false);

  const on = describeRemote(freshFor(60), {}, T0);
  assert.equal(on.signedIn, true);
  assert.match(on.text, /someone@example\.com/);

  assert.match(describeRemote(freshFor(60), { error: 'Email link is invalid.' }, T0).text, /invalid/);
  assert.match(describeRemote(null, { sent: true }, T0).text, /check|sent|email/i);
});

test('signing out leaves the plan alone', async () => {
  const win = fakeWin();
  const store = createStore(win);
  store.save({ ...store.state, bought: { 'x-1': true } });
  const session = sessionStore(win);
  session.set(freshFor(60));

  await createRemote({ win, fetch: offline, session, now: () => T0 }).signOut();

  const after = createStore(win);
  after.load();
  assert.deepEqual(after.state.bought, { 'x-1': true }, 'the shopping list went with the session');
  assert.ok(after.state.savedAt, 'the week itself should still be there');
});

// ------------------------------------------------------------- closed signup
//
// The app is served from a public URL and always will be: GitHub Pages hands the
// whole bundle to anyone who asks, and a sign-in screen drawn by that bundle is
// a picture of a door. The only real lock is on the one thing a stranger can
// make the server do, which is send a code to an address of their choosing.

test('asking for a code never offers to make an account', async () => {
  const fetch = fakeFetch([jsonReply(200, {})]);
  await remote({ fetch }).signIn('stranger@example.com');

  const [call] = fetch.calls;
  assert.equal(call.body.options?.should_create_user, false,
    'any address on earth can still sign itself up here');
});

test('an address with no account is told so, not shown the server\'s wording', async () => {
  const fetch = fakeFetch([
    jsonReply(422, { code: 'otp_disabled', error_code: 'otp_disabled', msg: 'Signups not allowed for otp' }),
  ]);
  const api = remote({ fetch });
  const r = await api.signIn('stranger@example.com');

  assert.equal(r.ok, false);
  assert.match(r.error, /no account for that address/i, `shown instead: ${r.error}`);
  assert.doesNotMatch(r.error, /otp|signups not allowed/i, 'the database spoke to the person directly');
  assert.equal(api.pendingEmail(), null,
    'it waited for a code that was never sent, and will keep asking for one');
});

test('a refused sign-up is not confused with being rate-limited', async () => {
  const fetch = fakeFetch([jsonReply(429, { msg: 'Email rate limit exceeded' })]);
  const r = await remote({ fetch }).signIn('someone@example.com');

  assert.match(r.error, /too many requests/i, `shown instead: ${r.error}`);
});
