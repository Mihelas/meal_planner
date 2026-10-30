// What time it is, according to the only participant both phones agree on.
//
// Two people editing one week means two clocks deciding which edit is newer,
// and a phone's own clock is nobody's authority: set by hand, drifting after a
// flat battery, or an hour out across a timezone change that did not stick.
// `savedAt` and `touched.at` are the merge's whole tie-break, so a phone ten
// minutes fast did not win once -- it won every comparison, on every plate, for
// as long as it stayed fast, and the other person's afternoon lost to its
// morning. That is the bug this file closes.
//
// The authority is the database, and it is already answering: every PostgREST
// response carries an HTTP `Date`. So there is no extra request here, no time
// service, no dependency. rest.js hands over what the server said; this file
// keeps the difference and hands back a corrected clock.
//
// Three things worth knowing before changing anything here:
//
//   - **The offset is measured against the raw clock, never the corrected one.**
//     Comparing against `now()` would fold each reading into the last and drift
//     without bound.
//   - **Small readings are ignored.** `Date` is truncated to the second and the
//     answer took time to arrive, so every reading is a second or so pessimistic.
//     Correcting for that would make the corrected clock jitter, and jitter can
//     run backwards -- the one thing a tie-breaker must never do.
//   - **It fixes the future, not the past.** A stamp written while the phone was
//     fast keeps its number. Nothing here can go back and re-date somebody's
//     week, and pretending otherwise would mean rewriting stamps on read, which
//     is how you lose the one record of who actually touched what.
//
// A module singleton rather than a factory, because there is exactly one device
// and one clock on it, and threading an instance through store.js, rest.js and
// everything that calls save() would be ceremony for a single number.

/**
 * How wrong the phone has to be before this bothers.
 *
 * Two seconds covers the `Date` header's one-second truncation plus a slow
 * round trip on mobile data, and is far below the skew that actually loses
 * work -- the failure this exists for is minutes, not seconds.
 */
export const CLOCK_DEAD_BAND_MS = 2000;

/** Milliseconds to add to this device's clock to get the server's. */
let offset = 0;

/** Whether anything was ever learned, so `skew()` can tell nothing from zero. */
let known = false;

/**
 * Note what the server said the time was when it answered.
 *
 * Takes either a millisecond number or an HTTP date string, because the header
 * arrives as the latter and the tests find the former easier to reason about.
 * Anything unreadable -- a fetch fake with no headers, a proxy that stripped
 * it, a cached response -- is ignored, and ignored means *keeps what it knew*:
 * one unreadable answer is not evidence the phone is suddenly right.
 */
export function learn(serverTime) {
  const at = typeof serverTime === 'number' ? serverTime : Date.parse(serverTime);
  // `> 0` rather than a null check: Date.parse gives NaN for junk, and a zero
  // would be 1970, which no server is going to claim.
  if (!Number.isFinite(at) || at <= 0) return skew();

  // Against the offset in force, not against zero: that is what makes a phone
  // whose clock gets fixed drop back to trusting itself instead of staying
  // corrected for a skew that is no longer there.
  const want = at - Date.now();
  if (Math.abs(want - offset) >= CLOCK_DEAD_BAND_MS) {
    offset = want;
    known = true;
  }
  return skew();
}

/** The time, corrected. Everything that stamps a document reads this. */
export function now() {
  return Date.now() + offset;
}

/** How wrong this device is, or null if no server has told it yet. */
export function skew() {
  return known ? offset : null;
}

/** Forget the correction. For tests, which need each one to start level. */
export function resetClock() {
  offset = 0;
  known = false;
}
