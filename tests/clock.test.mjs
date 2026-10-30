// One clock, and it is the server's.
//
// `savedAt` and `touched.at` decide which of two weeks survives a merge, and
// until now both were whatever the phone's own clock said. A phone ten minutes
// fast won every tie-break for as long as it was fast -- not once, but for
// every merge, including per-plate, so the correct phone's afternoon lost to
// the fast phone's morning. These tests pin down the correction: the offset is
// learned from the HTTP `Date` on answers the app already asks for, and it is
// the only clock `save()` is allowed to read.
//
// What is deliberately not tested, because it is not true: that an offset
// already written into a stamp gets fixed. It does not. Correcting the clock
// stops new skew; stamps written while the phone was fast keep their numbers
// until something overwrites them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { now, learn, skew, resetClock, CLOCK_DEAD_BAND_MS } from '../src/clock.js';
import { createRest } from '../src/rest.js';
import { createStore } from '../src/store.js';

const TEN_MIN = 10 * 60 * 1000;

/** Generous enough for a slow CI box, tight enough to catch a dropped offset. */
const near = (got, want, slack = 500) => assert.ok(
  Math.abs(got - want) <= slack,
  `expected ${got} to be within ${slack}ms of ${want} (off by ${got - want})`,
);

test.beforeEach(() => resetClock());

test('an unset clock is the device\'s own, and says so', () => {
  assert.equal(skew(), null);
  near(now(), Date.now());
});

test('a server ten minutes ahead moves the clock ten minutes', () => {
  learn(Date.now() + TEN_MIN);
  near(skew(), TEN_MIN);
  near(now(), Date.now() + TEN_MIN);
});

test('a server ten minutes behind moves it back', () => {
  learn(Date.now() - TEN_MIN);
  near(skew(), -TEN_MIN);
  near(now(), Date.now() - TEN_MIN);
});

test('a second or two of difference is left alone', () => {
  // The `Date` header is truncated to the second and the answer travelled to get
  // here, so a small reading is noise. Correcting for noise would make the
  // corrected clock jitter -- and jitter can run backwards, which is the one
  // thing a tie-breaker must not do.
  learn(Date.now() + (CLOCK_DEAD_BAND_MS - 500));
  assert.equal(skew(), null);
  near(now(), Date.now());
});

test('the newest reading replaces the last, it does not add to it', () => {
  learn(Date.now() + TEN_MIN);
  learn(Date.now() + 2 * TEN_MIN);
  near(skew(), 2 * TEN_MIN);
});

test('a phone that gets its clock fixed goes back to trusting itself', () => {
  learn(Date.now() + TEN_MIN);
  near(skew(), TEN_MIN);
  learn(Date.now());
  near(skew(), 0);
  near(now(), Date.now());
});

test('nothing readable is not a reason to forget what was learned', () => {
  learn(Date.now() + TEN_MIN);
  for (const bad of [undefined, null, NaN, 'Tuesday', Infinity, 0]) {
    learn(bad);
    near(skew(), TEN_MIN);
  }
});

test('an HTTP date string is read as well as a number', () => {
  learn(new Date(Date.now() + TEN_MIN).toUTCString());
  // toUTCString() truncates to the second, so this lands within a second.
  near(skew(), TEN_MIN, 1500);
});

// ------------------------------------------------------------------ the wiring

const signedIn = { accessToken: async () => 'tok', userId: async () => 'u', signedIn: () => true };

const answer = (headers) => async () => ({
  ok: true,
  status: 200,
  headers,
  async json() { return []; },
});

test('every answer teaches the clock what time the server thinks it is', async () => {
  const { rest } = createRest({
    remote: signedIn,
    url: 'https://x.supabase.co',
    key: 'sb_publishable_test',
    fetch: answer(new Headers({ date: new Date(Date.now() + TEN_MIN).toUTCString() })),
  });

  const res = await rest('/rest/v1/anything');
  assert.equal(res.ok, true);
  near(skew(), TEN_MIN, 1500);
});

test('a response with no headers is not a reason to throw', async () => {
  // Every fetch fake in the other suites answers without a `headers` object, and
  // so does a cached response in some browsers. Reading the clock must not be
  // able to break a request that otherwise worked.
  const { rest } = createRest({
    remote: signedIn,
    url: 'https://x.supabase.co',
    key: 'sb_publishable_test',
    fetch: answer(undefined),
  });

  const res = await rest('/rest/v1/anything');
  assert.equal(res.ok, true);
  assert.equal(skew(), null);
});

test('a save is stamped with the server\'s time, not the phone\'s', () => {
  learn(Date.now() + TEN_MIN);

  const map = new Map();
  const win = {
    localStorage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
    },
  };

  const store = createStore(win);
  store.load();
  const saved = store.update((s) => ({ ...s, settings: { ...s.settings } }));

  near(saved.savedAt, Date.now() + TEN_MIN);
});
