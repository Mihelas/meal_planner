// Households: who shares a plan with whom.
//
// Its own module rather than more of remote.js. That file is about holding a
// session -- getting one, keeping it alive, giving it up. This is about what an
// account does once it has one, and the only thing it knows about auth is a
// two-method interface: give me a token, and tell me who I am.
//
// Almost all of the work is already in the database. supabase/migrations/0003
// and 0004 hold create_household, create_invite, redeem_invite and
// delete_household, each of them `security definer` and each re-checking
// membership by hand; 0002 holds the policies that decide what a plain select
// can see. Nothing here enforces anything. What it does is:
//
//   - **Ask as the signed-in user, or not at all.** PostgREST answers an
//     unauthenticated request as `anon`, and anon's answer to most of these
//     queries is an empty list -- which reads exactly like "you are in no
//     households". A missing token has to stop the request, not flavour it.
//   - **Keep one definition of each rule.** The invite code is normalised in SQL
//     (normalise_invite_code), so a code is passed through from here untouched.
//     Two normalisers would be two things that can disagree, and the one that
//     decides is the one the primary key is compared against.
//   - **Not rewrite a sentence the database already wrote for a person.** 0003
//     and 0004 raise messages meant to be read. Four different things raise
//     42501, so mapping by errcode would mean picking one of them and being
//     wrong three times. Only the messages Postgres itself writes get replaced.
//   - **Tell offline apart from refused**, by the same rule as remote.js: a
//     network problem reported as a refusal teaches people to re-type things
//     that were never wrong.
//
// How a request is made, and how a refusal becomes a sentence, both live in
// rest.js -- cloud.js asks the same database the same way, and that is worth
// exactly one definition.

import { SUPABASE_URL, SUPABASE_KEY } from './remote.js';
import { createRest, OFFLINE, SIGNED_OUT } from './rest.js';

export function createHouseholds({
  remote,
  fetch: doFetch = globalThis.fetch,
  url = SUPABASE_URL,
  key = SUPABASE_KEY,
} = {}) {
  const { rest, rpc } = createRest({ remote, fetch: doFetch, url, key });

  const clean = (s) => String(s ?? '').trim();
  const q = encodeURIComponent;

  return {
    /**
     * The households this account is in, each with *this* account's role and
     * seat in it.
     *
     * Filtered by user_id on the way out rather than sorted out on arrival: the
     * select policy in 0002 deliberately returns your household-mates' rows too,
     * so that the members list below works, and a client that took the first row
     * it was handed would show you somebody else's seat as your own.
     */
    async mine() {
      const me = await remote.userId();
      // A missing id has two causes and they want different sentences: no
      // session at all, or a session whose id could not be fetched -- which is
      // the same failure as any other read that never reached the server, and
      // saying "sign in first" to somebody who is signed in sends them to undo
      // the one thing that is working.
      if (!me) return { ok: false, error: remote.signedIn?.() ? OFFLINE : SIGNED_OUT };
      const r = await rest(
        '/rest/v1/household_members'
        + '?select=role,person_id,joined_at,households(id,name)'
        + `&user_id=eq.${q(me)}&order=joined_at`,
      );
      if (!r.ok) return r;
      return {
        ok: true,
        households: (r.payload ?? [])
          // The embedded household is dropped when RLS filters the row it points
          // at -- a race against somebody leaving, not something to render as
          // `undefined` in a list.
          .filter((row) => row?.households?.id)
          .map((row) => ({
            id: row.households.id,
            name: row.households.name,
            role: row.role,
            seat: row.person_id,
            joinedAt: row.joined_at,
          })),
      };
    },

    /** Start one. Returns its id, which is the only thing the caller needs. */
    async create(name, seat) {
      // Trimmed here as well as in SQL, and not as belt-and-braces: the
      // untrimmed string is what an optimistic card shows until the next read.
      // An *empty* name is left alone, so create_household's 'Home' default
      // stays the only place that default is written down.
      const r = await rpc('create_household', {
        household_name: clean(name),
        seat: clean(seat),
      });
      return r.ok ? { ok: true, id: r.payload } : r;
    },

    /** Rename it. Owners only -- enforced by the policy, reported here. */
    async rename(householdId, name) {
      const r = await rest(`/rest/v1/households?id=eq.${q(householdId)}`, {
        method: 'PATCH',
        body: { name: clean(name) },
        // Load-bearing. An update that matches no row is not an error in
        // PostgREST -- it is a 200 and an empty body. Without the representation
        // to count, a plain member renaming a household would be told it worked
        // and would see the new name until the next reload.
        prefer: 'return=representation',
      });
      if (!r.ok) return r;
      if (!Array.isArray(r.payload) || r.payload.length === 0) {
        return { ok: false, error: 'Only an owner can rename a household.' };
      }
      return { ok: true, name: r.payload[0]?.name ?? clean(name) };
    },

    /** Everybody in it, in the order they joined, named the way the plan names them. */
    async members(householdId) {
      const me = await remote.userId();
      const r = await rest(
        '/rest/v1/household_members'
        + '?select=user_id,role,person_id,joined_at,profiles(display_name)'
        + `&household_id=eq.${q(householdId)}&order=joined_at`,
      );
      if (!r.ok) return r;
      return {
        ok: true,
        members: (r.payload ?? []).map((row) => ({
          userId: row.user_id,
          role: row.role,
          seat: row.person_id,
          // Both, because the two callers want different things. `name` is the
          // safe one for anything that just needs a label. `displayName` is what
          // they actually typed, empty until they type it -- the app has a
          // better fallback than this module does, because a seat is a person in
          // the plan and the plan already has a name for them.
          displayName: clean(row.profiles?.display_name),
          name: clean(row.profiles?.display_name) || row.person_id,
          you: Boolean(me) && row.user_id === me,
          joinedAt: row.joined_at,
        })),
      };
    },

    /** A code for somebody to type on their own phone. */
    async invite(householdId, seat, days = 7) {
      const r = await rpc('create_invite', {
        target_household: householdId,
        seat: clean(seat),
        valid_days: days,
      });
      return r.ok ? { ok: true, code: r.payload } : r;
    },

    /**
     * The codes still worth showing.
     *
     * Both conditions are in the query rather than applied afterwards: a
     * household running for a year has a row per invite ever issued, and all but
     * a couple are spent. An expired one is not "pending" -- redeem_invite will
     * refuse it, so listing it as live would be the app lying to its owner.
     */
    async invites(householdId) {
      const r = await rest(
        '/rest/v1/household_invites'
        + '?select=code,person_id,expires_at'
        + `&household_id=eq.${q(householdId)}`
        + '&redeemed_by=is.null&expires_at=gt.now()&order=expires_at',
      );
      if (!r.ok) return r;
      return {
        ok: true,
        invites: (r.payload ?? []).map((row) => ({
          code: row.code,
          seat: row.person_id,
          expiresAt: row.expires_at,
        })),
      };
    },

    /** Take a code back. */
    async revoke(code) {
      const r = await rest(`/rest/v1/household_invites?code=eq.${q(clean(code))}`,
        { method: 'DELETE' });
      return r.ok ? { ok: true } : r;
    },

    /** Use one. Returns the household it let you into. */
    async join(code) {
      if (!clean(code)) return { ok: false, error: 'Type the invite code you were sent.' };
      // Passed through exactly as typed. normalise_invite_code() in 0003 is the
      // single definition of what a code is, and it already forgives case,
      // spaces and the dashes people add to read one aloud.
      const r = await rpc('redeem_invite', { invite_code: String(code) });
      return r.ok ? { ok: true, id: r.payload } : r;
    },

    /**
     * Walk out of one.
     *
     * No user filter on purpose. `leave a household` in 0002 is
     * `using (user_id = auth.uid())`, so this deletes exactly one row however it
     * is addressed. Naming the account here would add a second thing that has to
     * be right, and a stale id would delete nothing while reporting success.
     */
    async leave(householdId) {
      const r = await rest(`/rest/v1/household_members?household_id=eq.${q(householdId)}`,
        { method: 'DELETE' });
      return r.ok ? { ok: true } : r;
    },

    /** Bin it. Owner only, and only once everybody else has left -- see 0004. */
    async remove(householdId) {
      const r = await rpc('delete_household', { target_household: householdId });
      return r.ok ? { ok: true } : r;
    },
  };
}
