// The plan travelling: one document per household, guarded by a revision.
//
// Everything here is told to the fake PostgREST below rather than to Supabase,
// so what these tests actually pin down is the contract with 0001's enforce_rev
// trigger and 0002's update policy:
//
//   - a push is a conditional PATCH on the rev it last saw;
//   - an empty list back means somebody else got there first;
//   - rev advances by exactly one, and the client never picks the number.
//
// The convergence tests use a trivial merge on purpose. What mergeStates does
// with two weeks is settled in merge.test.mjs; what this file settles is that a
// lost race ends with both sides' work in the row, and that it ends at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloud } from '../src/cloud.js';

const URL = 'https://x.supabase.co';
const KEY = 'sb_publishable_test';
const HID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ME = 'd3f4a1b2-0000-4000-8000-000000000001';
const HER = 'd3f4a1b2-0000-4000-8000-000000000002';

const reply = (status, payload) => ({
  ok: status < 400,
  status,
  async json() { return payload; },
  async text() { return JSON.stringify(payload); },
});

/** A PostgREST that holds one household_state row and enforces the rev rule. */
function pg(row = { doc: { plan: 'theirs' }, rev: 3, updated_at: '2026-10-28T10:00:00Z', updated_by: HER }) {
  const calls = [];
  const state = row ? { ...row } : null;
  const fn = async (url, init = {}) => {
    const path = String(url).slice(URL.length);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method ?? 'GET', body, headers: init.headers ?? {} });

    if (init.method === 'PATCH') {
      const want = /rev=eq\.(\d+)/.exec(path);
      const seen = want ? Number(want[1]) : null;
      // The filter is the whole guard: no row matches, nothing is written.
      if (!state || seen !== state.rev) return reply(200, []);
      if (body.rev !== state.rev + 1) {
        return reply(400, { code: '23514', message: 'rev must advance by exactly one' });
      }
      state.doc = body.doc;
      state.rev = body.rev;
      state.updated_by = ME;
      state.updated_at = '2026-10-28T11:00:00Z';
      return reply(200, [{ ...state }]);
    }
    return reply(200, state ? [{ ...state }] : []);
  };
  fn.calls = calls;
  fn.row = () => (state ? { ...state } : null);
  fn.to = (method) => calls.filter((c) => c.method === method);
  return fn;
}

const signedIn = { accessToken: async () => 'tok', userId: async () => ME, signedIn: () => true };
const signedOut = { accessToken: async () => null, userId: async () => null, signedIn: () => false };

/** A clock the test drives by hand, so a debounce is not a sleep. */
function clock() {
  let at = 0;
  const jobs = [];
  return {
    now: () => at,
    setTimer: (fn, ms) => { jobs.push({ at: at + ms, fn, id: jobs.length + 1 }); return jobs.length; },
    clearTimer: (id) => { const j = jobs[id - 1]; if (j) j.done = true; },
    async tick(ms = 0) {
      at += ms;
      for (const j of jobs) if (!j.done && j.at <= at) { j.done = true; j.fn(); }
      // Macrotask ticks, not microtask ones: a push is half a dozen awaits
      // deep and a drain that stops early reads as "it never happened".
      for (let i = 0; i < 8; i += 1) await new Promise((r) => { setTimeout(r, 0); });
    },
  };
}

const make = (fetch, remote = signedIn, extra = {}) => createCloud({
  remote, fetch, url: URL, key: KEY, ...extra,
});

// --------------------------------------------------------------------- pull

test('pull brings back the week, the revision and who wrote it last', async () => {
  const fetch = pg();
  const r = await make(fetch).pull(HID);

  assert.equal(r.ok, true);
  assert.deepEqual(r.doc, { plan: 'theirs' });
  assert.equal(r.rev, 3);
  assert.equal(r.updatedBy, HER);
  assert.equal(r.updatedAt, '2026-10-28T10:00:00Z');
  assert.match(fetch.calls[0].path, /household_id=eq\./, 'it read every household it could see');
});

test('a household with no row yet is missing, which is not an error', async () => {
  const r = await make(pg(null)).pull(HID);

  assert.equal(r.ok, true, 'a household without a plan row was treated as broken');
  assert.equal(r.missing, true);
  assert.equal(r.rev, 0, 'a missing row has to read as rev 0, or the first push cannot be built');
});

test('signed out, nothing is asked and nothing is guessed', async () => {
  const fetch = pg();
  const r = await make(fetch, signedOut).pull(HID);

  assert.equal(r.ok, false);
  assert.match(r.error, /sign in/i);
  assert.equal(fetch.calls.length, 0, 'it asked anyway, and anon would have answered an empty list');
});

// --------------------------------------------------------------------- push

test('a push filters on the revision it saw and sends the next one', async () => {
  const fetch = pg();
  const r = await make(fetch).push(HID, { plan: 'mine' }, 3);

  assert.equal(r.ok, true);
  assert.equal(r.rev, 4);
  const [patch] = fetch.to('PATCH');
  assert.match(patch.path, /rev=eq\.3(&|$)/, 'without the rev filter this is last-write-wins again');
  assert.deepEqual(patch.body, { doc: { plan: 'mine' }, rev: 4 });
  assert.match(patch.headers.prefer ?? '', /return=representation/,
    'without the representation a lost race looks exactly like a won one');
});

test('a push somebody else got to first is stale, not a failure', async () => {
  const fetch = pg({ doc: { plan: 'hers' }, rev: 9, updated_at: 'x', updated_by: HER });
  const r = await make(fetch).push(HID, { plan: 'mine' }, 3);

  assert.equal(r.ok, false);
  assert.equal(r.stale, true, 'an empty list was read as something other than a lost race');
  assert.equal(r.error, undefined, 'a lost race is not worth a sentence; it is worth a retry');
  assert.deepEqual(fetch.row().doc, { plan: 'hers' }, 'it wrote anyway');
});

test('a rev that does not advance by one is refused by the database, and reported', async () => {
  const fetch = pg();
  // Only reachable from a bug here; the trigger in 0001 is the backstop.
  const r = await make(fetch).push(HID, { plan: 'mine' }, 3, { to: 7 });

  assert.equal(r.ok, false);
  assert.match(r.error, /advance by exactly one/);
});

test('an offline push says offline, in words, and is not a refusal', async () => {
  const fetch = () => { throw new TypeError('Failed to fetch'); };
  const r = await make(fetch).push(HID, { plan: 'mine' }, 3);

  assert.equal(r.ok, false);
  assert.equal(r.offline, true);
  assert.match(r.error, /offline/i);
  assert.doesNotMatch(r.error, /not yours|refused/i);
});

// --------------------------------------------------------------------- save

test('save pushes what it was handed and reports where it landed', async () => {
  const fetch = pg();
  const written = [];
  const r = await make(fetch).save(HID, {
    read: () => ({ doc: { plan: 'mine', n: 1 }, rev: 3 }),
    merge: () => { throw new Error('merged when nothing was in the way'); },
    write: (doc, rev) => written.push([doc, rev]),
  });

  assert.equal(r.ok, true);
  assert.equal(r.rev, 4);
  assert.deepEqual(fetch.row().doc, { plan: 'mine', n: 1 });
  assert.deepEqual(written, [[{ plan: 'mine', n: 1 }, 4]], 'the device was not told which rev it now sits on');
});

test('a lost race is pulled, merged and pushed again, and both sides survive', async () => {
  // Her push lands between my read and my write: the row moves to rev 4 while I
  // still think it is 3.
  const fetch = pg({ doc: { hers: true }, rev: 4, updated_at: 'x', updated_by: HER });
  const written = [];
  const r = await make(fetch).save(HID, {
    read: () => ({ doc: { mine: true }, rev: 3 }),
    merge: (mine, theirs) => ({ ...theirs, ...mine }),
    write: (doc, rev) => written.push([doc, rev]),
  });

  assert.equal(r.ok, true);
  assert.equal(r.rev, 5, 'the retry did not build on the rev it had just read');
  assert.deepEqual(fetch.row().doc, { hers: true, mine: true }, 'somebody lost a week');
  assert.deepEqual(written, [[{ hers: true, mine: true }, 5]]);
  assert.equal(fetch.to('PATCH').length, 2, 'it either did not retry, or retried more than it had to');
});

test('a merge is given both sides the right way round', async () => {
  const fetch = pg({ doc: { side: 'theirs' }, rev: 4, updated_at: 'x', updated_by: HER });
  const seen = [];
  await make(fetch).save(HID, {
    read: () => ({ doc: { side: 'mine' }, rev: 3 }),
    merge: (mine, theirs) => { seen.push([mine, theirs]); return mine; },
    write: () => {},
  });

  assert.deepEqual(seen, [[{ side: 'mine' }, { side: 'theirs' }]],
    'mine and theirs arrived the wrong way round, which would quietly drop this device');
});

test('a race it keeps losing gives up and says so, rather than looping', async () => {
  let rev = 4;
  const fetch = async (url, init = {}) => {
    if (init.method === 'PATCH') { rev += 1; return reply(200, []); }
    return reply(200, [{ doc: { n: rev }, rev, updated_at: 'x', updated_by: HER }]);
  };
  const r = await make(fetch).save(HID, {
    read: () => ({ doc: { mine: true }, rev: 3 }),
    merge: (mine) => mine,
    write: () => {},
    tries: 3,
  });

  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
  assert.match(r.error, /newer/i, 'it did not say what the person should do about it');
});

test('save with nothing to send does not write at all', async () => {
  const fetch = pg();
  const r = await make(fetch).save(HID, { read: () => null, merge: (m) => m, write: () => {} });

  assert.equal(r.ok, true);
  assert.equal(fetch.to('PATCH').length, 0, 'it pushed a document it did not have');
});

// ----------------------------------------------------------------- the queue

test('five edits in a row are one push, once the typing stops', async () => {
  const fetch = pg();
  const c = clock();
  const cloud = make(fetch, signedIn, { ...c, quiet: 800 });
  const job = { read: () => ({ doc: { n: 1 }, rev: 3 }), merge: (m) => m, write: () => {} };

  for (let i = 0; i < 5; i += 1) { cloud.schedule(HID, job); await c.tick(100); }
  assert.equal(fetch.to('PATCH').length, 0, 'it pushed mid-sentence');
  assert.equal(cloud.status().state, 'pending');

  await c.tick(800);
  assert.equal(fetch.to('PATCH').length, 1, 'five edits were five pushes');
  assert.equal(cloud.status().state, 'saved');
});

test('flush sends it now and resolves once the server has it', async () => {
  const fetch = pg();
  const c = clock();
  const cloud = make(fetch, signedIn, { ...c, quiet: 800 });
  cloud.schedule(HID, { read: () => ({ doc: { n: 1 }, rev: 3 }), merge: (m) => m, write: () => {} });

  const r = await cloud.flush();
  assert.equal(r.ok, true);
  assert.equal(fetch.to('PATCH').length, 1);
  assert.equal(cloud.status().state, 'saved');
  await c.tick(2000);
  assert.equal(fetch.to('PATCH').length, 1, 'the debounce fired again over an edit already sent');
});

test('an edit made offline is still waiting when the connection comes back', async () => {
  let up = false;
  const live = pg({ doc: { n: 0 }, rev: 3, updated_at: 'x', updated_by: HER });
  const fetch = async (...a) => {
    if (!up) throw new TypeError('Failed to fetch');
    return live(...a);
  };
  const c = clock();
  const cloud = make(fetch, signedIn, { ...c, quiet: 800 });
  const job = { read: () => ({ doc: { n: 1 }, rev: 3 }), merge: (m) => m, write: () => {} };

  cloud.schedule(HID, job);
  await c.tick(800);
  assert.equal(cloud.status().state, 'offline');
  assert.equal(cloud.status().waiting, true, 'the edit was dropped on the floor');

  up = true;
  const r = await cloud.flush();
  assert.equal(r.ok, true);
  assert.deepEqual(live.row().doc, { n: 1 });
  assert.equal(cloud.status().waiting, false);
});

test('an edit made while a save is in flight goes out on its own', async () => {
  // The queue holds the last edit, so a save that lands has to put down only
  // the edit it actually sent. Clearing it wholesale would mean that typing
  // during the half-second a push spends in the air costs the sentence typed --
  // not lost, the device still has it, but queued nowhere and waiting for the
  // next thing that happens to notice.
  const live = pg({ doc: { n: 0 }, rev: 3, updated_at: 'x', updated_by: HER });
  let release = null;
  let tried = 0;
  const fetch = async (url, init = {}) => {
    // Counted out here rather than in `live.to`, because the whole point is to
    // hold the push before the row is touched.
    if (init.method === 'PATCH') {
      tried += 1;
      if (tried === 1) await new Promise((r) => { release = r; });
    }
    return live(url, init);
  };
  const c = clock();
  const cloud = make(fetch, signedIn, { ...c, quiet: 800 });

  let doc = { n: 1 };
  const job = { read: () => ({ doc, rev: live.row().rev }), merge: (m) => m, write: () => {} };

  cloud.schedule(HID, job);
  await c.tick(800);
  assert.equal(tried, 1, 'the push never left');
  assert.equal(live.row().rev, 3, 'the push was not in flight after all');

  doc = { n: 2 };
  cloud.schedule(HID, job);
  release();
  await c.tick(0);

  assert.deepEqual(live.row().doc, { n: 1 }, 'the first push landed something else');
  assert.equal(cloud.status().waiting, true, 'the edit typed mid-push was dropped');

  await c.tick(800);
  assert.deepEqual(live.row().doc, { n: 2 }, 'the edit typed mid-push never went');
  assert.equal(live.row().rev, 5);
  assert.equal(cloud.status().waiting, false);
});

// --------------------------------------------------------------- the watcher

test('watch notices a week written by the other phone', async () => {
  const fetch = pg({ doc: { hers: true }, rev: 7, updated_at: 'x', updated_by: HER });
  const c = clock();
  const seen = [];
  const cloud = make(fetch, signedIn, c);
  const stop = cloud.watch(HID, (r) => seen.push(r), { period: 30000, rev: () => 3 });

  await c.tick(30000);
  assert.equal(seen.length, 1, 'it did not look');
  assert.equal(seen[0].rev, 7);
  assert.deepEqual(seen[0].doc, { hers: true });
  stop();
  await c.tick(60000);
  assert.equal(seen.length, 1, 'stopping did not stop it');
});

test('a week that cannot be folded in does not stop the watcher', async () => {
  // The callback is the app's merge, and a merge is the most likely thing here
  // to throw: one malformed row -- a buggy build, a hand-edited document --
  // and a watcher that re-arms only on the happy path would never look again.
  // Silently, for the rest of the session, on both phones.
  const fetch = pg({ doc: { hers: true }, rev: 7, updated_at: 'x', updated_by: HER });
  const c = clock();
  const blew = [];
  const cloud = make(fetch, signedIn, { ...c, onError: (e) => blew.push(e) });

  let seen = 0;
  const stop = cloud.watch(HID, () => { seen += 1; throw new TypeError('weights is not iterable'); },
    { period: 1000, rev: () => 0 });

  await c.tick(1000);
  assert.equal(seen, 1);
  await c.tick(1000);
  assert.equal(seen, 2, 'one week it could not read and the other phone is never heard from again');
  stop();

  // Contained, not hidden: a merge that cannot run is a bug, and the only place
  // left to say so is the console.
  assert.equal(blew.length, 2);
  assert.match(blew[0].message, /not iterable/);
});

test('your own push does not come back to you as news', async () => {
  const fetch = pg({ doc: { mine: true }, rev: 3, updated_at: 'x', updated_by: ME });
  const c = clock();
  const seen = [];
  const cloud = make(fetch, signedIn, c);
  cloud.watch(HID, (r) => seen.push(r), { period: 30000, rev: () => 3 });

  await c.tick(30000);
  assert.deepEqual(seen, [], 'the rev it already had was reported as an arrival');
});
