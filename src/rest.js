// Talking to PostgREST, and turning its refusals back into English.
//
// Extracted from household.js when the plan itself started travelling: two
// modules now ask the same database the same way, and "the same way" is worth
// exactly one definition. What it knows is narrow on purpose -- a token, a URL,
// a key, and the house rule that a request without a token is not sent.
//
// The rule, restated because it is the whole reason this is not three lines of
// fetch at each call site: PostgREST answers an unauthenticated request as
// `anon`, and anon's answer to almost everything here is an empty list. An empty
// list is indistinguishable from "there is nothing", so a missing token has to
// stop the request rather than flavour it.

import { learn } from './clock.js';

const OFFLINE = 'You appear to be offline. The plan still works; try again when you have a connection.';
const SIGNED_OUT = 'Sign in first — a household lives in the account, not on this phone.';

export { OFFLINE, SIGNED_OUT };

/**
 * The messages Postgres writes for a log, and what a person should see instead.
 *
 * Deliberately short. Anything not matched here came from a `raise exception` in
 * 0003 or 0004, which are already written in English and already know which of
 * the four 42501s they are.
 */
const RAW = [
  [/could not find the function|schema cache/i,
    'The database is missing a function this needs — a migration in supabase/migrations/ has not been run yet.'],
  [/jwt expired|invalid jwt|jwserror|invalid claim/i,
    'Your sign-in has expired. Sign in again to pick the plan back up.'],
  [/violates row-level security policy/i,
    'That is not yours to change.'],
  [/duplicate key value violates unique constraint/i,
    'Somebody is already in that seat.'],
  [/violates foreign key constraint/i,
    'That household is already gone.'],
];

/**
 * A PostgREST error body as a sentence.
 *
 * Exported because it is the interesting half of this module and deserves its
 * own tests: everything else is a URL.
 */
export function humanise(payload, status = 400) {
  const said = typeof payload?.message === 'string' ? payload.message.trim() : '';
  for (const [pattern, text] of RAW) {
    if (pattern.test(said) || pattern.test(String(payload?.code ?? ''))) return text;
  }
  if (payload?.code === 'PGRST202') return RAW[0][1];
  if (status === 401 || status === 403) {
    return said || 'That is not yours to change.';
  }
  return said || `The database would not answer (${status}).`;
}

/**
 * A request function bound to one project and one session.
 *
 * Returns `{ ok, payload, status }` or `{ ok: false, error }` -- never throws,
 * because every caller is wired to a button or a timer, and a thrown error on a
 * phone is a blank panel.
 */
export function createRest({
  remote,
  fetch: doFetch = globalThis.fetch,
  url,
  key,
}) {
  async function rest(path, { method = 'GET', body, prefer } = {}) {
    const token = await remote.accessToken();
    if (!token) return { ok: false, error: SIGNED_OUT };

    const headers = {
      apikey: key,
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    };
    if (prefer) headers.prefer = prefer;

    let res;
    try {
      res = await doFetch(`${url}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, error: OFFLINE, offline: true };
    }

    // Every answer carries an HTTP `Date`, and the two phones need one clock
    // between them to decide whose edit is newer. Read here rather than in a
    // module of its own making its own request: this is the request the app is
    // already making, every thirty seconds, on both devices. Optional chaining
    // because a fetch fake -- and a cached response in some browsers -- has no
    // `headers`, and reading the clock must not break a request that worked.
    learn(res.headers?.get?.('date'));

    let payload = null;
    try { payload = await res.json(); } catch { /* 204, or HTML from a proxy */ }
    if (res.status >= 400) return { ok: false, error: humanise(payload, res.status), status: res.status };
    return { ok: true, payload, status: res.status };
  }

  const rpc = (fn, args) => rest(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });

  return { rest, rpc };
}
