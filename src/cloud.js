// The plan itself, travelling between two phones.
//
// Its own module rather than more of household.js: that file is about who
// shares a plan with whom, and this is about the document they share. The only
// thing here that knows anything about a week of meals is the `merge` function,
// and that is handed in -- store.js owns the shape of the document, and a sync
// layer that learned it would be a second place to change when a field is added.
//
// The whole design is one row and one number. `public.household_state` holds a
// single row per household: the document, and a revision. A push is a
// conditional update -- "set this document, but only if the revision is still
// the one I read" -- and the trigger in 0001 refuses anything that does not
// advance the revision by exactly one. From that, three things follow, and they
// are the three things worth understanding here:
//
//   - **A lost race looks like success.** PostgREST answers an UPDATE that
//     matched no row with `200 []`, not an error. Without
//     `Prefer: return=representation` there is nothing to count, and a push that
//     wrote nothing would be reported as saved. That header is load-bearing.
//   - **A lost race is not a failure.** Somebody else pushed first; the answer is
//     to read what they wrote, merge, and push again -- not to show an error to
//     somebody who did nothing wrong. Bounded at three attempts, because two
//     phones editing the same minute should converge and a loop that cannot
//     converge should say so rather than spin.
//   - **The revision is not part of the document.** It is what the next push is
//     conditioned on, and mergeStates copies the remote document wholesale when
//     the remote one is newer. A revision stored inside `doc` would be
//     overwritten by the very merge whose result it is about to guard. The
//     caller keeps it outside, and `write(doc, rev)` is how it is told.
//
// Polling, not Realtime. One row, two phones, a thirty-second period: a
// websocket held open on a phone in a pocket costs more than it saves, and the
// pull is the same request the app already makes on wake.

import { SUPABASE_URL, SUPABASE_KEY } from './remote.js';
import { createRest } from './rest.js';

const STATE = '/rest/v1/household_state';
const COLUMNS = 'doc,rev,updated_at,updated_by';

const BUSY = 'The household has a newer week than this phone, and it keeps changing while this tries to save. '
  + 'Nothing was lost — try again in a moment.';

export function createCloud({
  remote,
  fetch: doFetch = globalThis.fetch,
  url = SUPABASE_URL,
  key = SUPABASE_KEY,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  quiet = 800,
  retry = 15000,
} = {}) {
  const { rest } = createRest({ remote, fetch: doFetch, url, key });
  const q = encodeURIComponent;

  /**
   * The household's document, and the revision it is at.
   *
   * No row yet is `{ missing: true, rev: 0 }` rather than an error: a household
   * created before this feature existed, or one whose row was never written, is
   * a perfectly ordinary empty household, and rev 0 is exactly what the first
   * push has to be conditioned on.
   */
  async function pull(id) {
    const res = await rest(`${STATE}?household_id=eq.${q(id)}&select=${COLUMNS}`);
    if (!res.ok) return res;

    const row = Array.isArray(res.payload) ? res.payload[0] : null;
    if (!row) return { ok: true, missing: true, doc: null, rev: 0 };
    return {
      ok: true,
      doc: row.doc ?? null,
      rev: Number(row.rev ?? 0),
      updatedAt: row.updated_at ?? null,
      updatedBy: row.updated_by ?? null,
    };
  }

  /**
   * Write the document, but only if nobody has written since `rev`.
   *
   * `to` exists for the tests and for nothing else: the next revision is always
   * `rev + 1`, and the trigger in 0001 is there to make sure of it even if this
   * file one day disagrees.
   */
  async function push(id, doc, rev, { to } = {}) {
    const next = to ?? rev + 1;
    const res = await rest(`${STATE}?household_id=eq.${q(id)}&rev=eq.${rev}`, {
      method: 'PATCH',
      body: { doc, rev: next },
      prefer: 'return=representation',
    });
    if (!res.ok) return res;

    const row = Array.isArray(res.payload) ? res.payload[0] : null;
    // Nothing matched the filter, so nothing was written: somebody else pushed
    // between the read and here. Not an error, and deliberately without a
    // sentence -- the caller's answer to this is a retry, not a message.
    if (!row) return { ok: false, stale: true };

    return {
      ok: true,
      rev: Number(row.rev ?? next),
      updatedAt: row.updated_at ?? null,
      updatedBy: row.updated_by ?? null,
    };
  }

  /**
   * Push what the device has, and keep pushing until it lands or it is clear it
   * will not.
   *
   * `read()` hands over `{ doc, rev }`, or null when there is nothing to send.
   * `merge(mine, theirs)` resolves a lost race. `write(doc, rev)` is told what
   * ended up in the row and which revision the device now sits on -- both,
   * because after a merge the document on the device is no longer the document
   * that was read.
   */
  async function save(id, { read, merge, write, tries = 3 } = {}) {
    const snap = read?.();
    if (!snap) return { ok: true, nothing: true };

    let { doc } = snap;
    let rev = Number(snap.rev ?? 0);

    for (let left = tries; left > 0; left -= 1) {
      const res = await push(id, doc, rev);
      if (res.ok) {
        write?.(doc, res.rev);
        return { ok: true, rev: res.rev };
      }
      if (!res.stale) return res;

      const got = await pull(id);
      if (!got.ok) return got;
      doc = merge(doc, got.doc ?? {});
      rev = got.rev;
    }

    return { ok: false, conflict: true, error: BUSY };
  }

  // ---------------------------------------------------------------- the queue
  //
  // Typing a note is a keystroke a second and a push a keystroke would be a
  // hundred revisions for one sentence. Edits collapse into one push once the
  // typing stops, and an edit that could not be sent stays queued rather than
  // being lost to a tunnel.

  let timer = null;
  let pending = null;      // {id, job} -- the last edit, not a list of them
  let running = false;
  let state = 'idle';
  let error = null;
  let at = null;
  let rev = null;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const arm = (ms) => {
    cancel();
    timer = setTimer(() => { timer = null; run(); }, ms);
  };

  async function run() {
    if (running || !pending) return { ok: true, nothing: true };
    running = true;
    state = 'saving';
    error = null;

    const mine = pending;
    const { id, job } = mine;
    let res;
    try {
      res = await save(id, job);
    } finally {
      running = false;
    }

    if (res.ok) {
      // Put down only the edit that was actually sent. `schedule` can have
      // replaced `pending` while this was in the air -- somebody typing through
      // the half-second a push takes -- and clearing it wholesale would leave
      // that edit queued nowhere, waiting for the next render to notice it.
      if (pending === mine) {
        pending = null;
        state = 'saved';
      } else {
        state = 'pending';
        arm(quiet);
      }
      at = now();
      if (res.rev != null) rev = res.rev;
    } else if (res.offline) {
      // Still queued, and armed to go again: the point of a queue is that the
      // person does not have to remember to press anything when the signal
      // comes back.
      state = 'offline';
      error = res.error;
      arm(retry);
    } else {
      state = res.conflict ? 'conflict' : 'error';
      error = res.error;
      arm(retry);
    }
    return res;
  }

  return {
    pull,
    push,
    save,

    /** Note an edit. One push follows, once the edits stop. */
    schedule(id, job) {
      pending = { id, job };
      if (state !== 'saving') state = 'pending';
      error = null;
      arm(quiet);
    },

    /** Send the queued edit now, and resolve once the server has it. */
    flush() {
      cancel();
      return run();
    },

    status() {
      return { state, waiting: pending !== null, at, error, rev };
    },

    /**
     * Watch for a week written somewhere else.
     *
     * `rev()` is asked each time rather than captured, because the device's
     * revision moves under this -- every push advances it -- and a watcher
     * holding the revision it was created with would report the device's own
     * writes back to it as news.
     */
    watch(id, onRemote, { period = 30000, rev: mine = () => 0 } = {}) {
      let stopped = false;
      let id2 = null;

      const look = async () => {
        id2 = null;
        const got = await pull(id);
        if (stopped) return;
        if (got.ok && !got.missing && got.rev > mine()) onRemote(got);
        id2 = setTimer(look, period);
      };

      id2 = setTimer(look, period);
      return () => {
        stopped = true;
        if (id2 !== null) clearTimer(id2);
        id2 = null;
      };
    },
  };
}
