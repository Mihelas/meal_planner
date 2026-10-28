// Accounts, so the plan can travel without a shared folder.
//
// Magic link rather than a password: there is nothing to forget, no reset flow
// to build, and nothing stored on the device that is worth stealing for long.
// Supabase emails a link that lands back on this page with the tokens in the URL
// *hash*, which is the only flow available to a static page with no backend of
// its own to receive a redirect.
//
// Four things make this honest rather than convenient:
//
//   - **The session is not part of the app state.** sync.js writes
//     snapshot(state) into a folder two people share and merges whatever it
//     finds there. A session kept in state would be written to that folder and
//     handed to the other device on the next pull -- a refresh token, in
//     Dropbox, in plain text. It gets its own localStorage key, outside
//     anything snapshot() can reach.
//   - **Offline is not the same as refused.** A refresh that fails on the
//     network keeps the session, because the stored token may well still be
//     good; only a server that actually rejects the refresh token signs you
//     out. Getting this backwards signs people out on every commute.
//   - **Sign-out always succeeds locally.** The server is told when it can be,
//     but the device is cleared either way -- otherwise you cannot sign out of
//     a borrowed phone without a signal.
//   - **Signed out is a working state, not a locked door.** Nothing here is on
//     the path to planning a week. The app is local-first and stays that way;
//     an account is how the plan reaches the other phone, nothing more.
//   - **A code, not only a link.** A corporate mailbox is why. Outlook Safe
//     Links and scanners like it *fetch* a link before anyone sees it, which
//     spends the one-time token; the human then clicks a link that is already
//     dead and is told, truthfully and uselessly, that it has expired. A code
//     cannot be spent by something that never types it -- and it involves no
//     redirect at all, so the whole allow-list failure mode goes with it.

export const SUPABASE_URL = 'https://xtcjakhoeehmrzdtzcvr.supabase.co';
// Public by design (A5), and it ships in the HTML. Security is the RLS policies
// in supabase/migrations/0002_rls.sql, never the secrecy of this string.
export const SUPABASE_KEY = 'sb_publishable_nxZzg-3P0__Ki-DwbTe5lA_c5a1R2EG';

// Its own key, deliberately not STORAGE_KEY. See the note at the top.
export const SESSION_KEY = 'mealplanner.session';

/**
 * The address a code was last sent to, kept outside the app state for exactly
 * the same reason as the session.
 *
 * It has to be written down rather than held in a closure: asking for a code
 * means leaving for the mail app, and a phone will happily evict the page while
 * you are gone. Coming back to a reloaded page that has forgotten who the code
 * was for makes the code in your hand worthless.
 */
export const PENDING_KEY = 'mealplanner.signin';

/**
 * How long an address waits for its code.
 *
 * Generous on purpose, and not a claim about the code: Supabase decides when
 * the code dies, and a dead one comes back with its own message. This only
 * decides how long "resend" works without retyping an address, so the failure
 * it prevents is a week-old sign-in box appearing out of nowhere.
 */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export const OTP_PATH = '/auth/v1/otp';
export const TOKEN_PATH = '/auth/v1/token';
export const LOGOUT_PATH = '/auth/v1/logout';
export const VERIFY_PATH = '/auth/v1/verify';
export const USER_PATH = '/auth/v1/user';

/**
 * How early to renew. Two minutes covers a slow request on a train plus any
 * clock skew between the phone and the server, and costs one extra refresh a
 * day at worst.
 */
export const REFRESH_SKEW_MS = 120_000;

const nowMs = () => Date.now();

// --------------------------------------------------------------- the shapes
/**
 * A wire payload as a session, with the clock units sorted out once.
 *
 * `expires_in` is seconds from now and `expires_at` is epoch seconds, while
 * everything else in this app is epoch milliseconds. Converting in one place
 * means an off-by-1000 can only happen here, where there are tests for it.
 */
export function normaliseSession(payload, now = nowMs()) {
  const at = payload?.access_token;
  if (!at || typeof at !== 'string') return null;
  const expiresAt = Number.isFinite(payload.expires_at)
    ? payload.expires_at * 1000
    : now + (Number(payload.expires_in) || 0) * 1000;
  return {
    accessToken: at,
    refreshToken: payload.refresh_token ?? null,
    expiresAt,
    email: payload.user?.email ?? null,
    userId: payload.user?.id ?? null,
  };
}

/**
 * Whether the token is past its expiry.
 *
 * Fails closed: no session, or an expiry that is not a number, counts as
 * expired. The alternative reading -- "no expiry means it never expires" --
 * turns one corrupt storage value into an app that never refreshes again.
 */
export function isExpired(session, now = nowMs()) {
  const at = session?.expiresAt;
  if (!Number.isFinite(at)) return true;
  return at <= now;
}

/** Signed: an expired session reads negative, which is more useful than zero. */
export function expiresInMs(session, now = nowMs()) {
  const at = session?.expiresAt;
  return Number.isFinite(at) ? at - now : 0;
}

/**
 * A code as typed, as the server wants it.
 *
 * People copy `123 456` and `123-456` out of an email, and a phone keyboard
 * adds a trailing space of its own accord. Rejecting those would be rejecting a
 * correct code, so the separators come out here rather than being sent.
 */
export const normaliseCode = (code) => String(code ?? '').replace(/[\s-]/g, '');

/** The tokens Supabase leaves in the fragment after an email link. */
export function sessionFromHash(hash, now = nowMs()) {
  const q = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  if (!q.get('access_token')) return null;
  return normaliseSession({
    access_token: q.get('access_token'),
    refresh_token: q.get('refresh_token'),
    expires_in: q.get('expires_in'),
    expires_at: Number(q.get('expires_at')) || undefined,
  }, now);
}

/** The failure half of the same fragment, which arrives for an expired link. */
export function errorFromHash(hash) {
  const q = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const desc = q.get('error_description') ?? q.get('error');
  return desc ? desc.replace(/\s+/g, ' ').trim() : null;
}

// -------------------------------------------------------------- the storage
/** A session that only lives as long as the tab. Used by the tests. */
export function memorySession(initial = null) {
  let box = initial;
  return {
    get: () => box,
    set: (s) => { box = s; },
    clear: () => { box = null; },
  };
}

/**
 * The session on its own localStorage key.
 *
 * Tolerant of rubbish on the way in: a half-written or hand-edited value must
 * read as "signed out", because the app works signed out and crashing on boot
 * over an auth detail would take the week with it.
 */
export function sessionStore(win) {
  const ls = (() => { try { return win?.localStorage ?? null; } catch { return null; } })();
  if (!ls) return memorySession();
  return {
    get() {
      try {
        const raw = ls.getItem(SESSION_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        return s?.accessToken ? s : null;
      } catch {
        return null;
      }
    },
    set(s) {
      try { ls.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* full or private mode */ }
    },
    clear() {
      try { ls.removeItem(SESSION_KEY); } catch { /* nothing to do about it */ }
    },
  };
}

/** A pending sign-in that only lives as long as the tab. Used by the tests. */
export function memoryPending(initial = null) {
  let box = initial;
  return {
    get: (now = nowMs()) => (box && now - box.at < PENDING_TTL_MS ? box : null),
    set: (v) => { box = v; },
    clear: () => { box = null; },
  };
}

/**
 * The pending sign-in on its own localStorage key.
 *
 * Same tolerance as the session store: anything unreadable means "no code is on
 * its way", because the app works signed out and an auth detail must never take
 * the boot down with it.
 */
export function pendingStore(win) {
  const ls = (() => { try { return win?.localStorage ?? null; } catch { return null; } })();
  if (!ls) return memoryPending();
  return {
    get(now = nowMs()) {
      try {
        const raw = ls.getItem(PENDING_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (!v?.email || !Number.isFinite(v.at)) return null;
        if (now - v.at >= PENDING_TTL_MS) { ls.removeItem(PENDING_KEY); return null; }
        return v;
      } catch {
        return null;
      }
    },
    set(v) {
      try { ls.setItem(PENDING_KEY, JSON.stringify(v)); } catch { /* full or private mode */ }
    },
    clear() {
      try { ls.removeItem(PENDING_KEY); } catch { /* nothing to do about it */ }
    },
  };
}

// -------------------------------------------------------------- the caption
/** What the account line says. One place, so the wording is consistent. */
export function describeRemote(session, { sent = false, sentTo = null, error = null } = {}, now = nowMs()) {
  const signedIn = Boolean(session?.accessToken);
  let text;
  if (signedIn) {
    text = `Signed in as ${session.email ?? 'this account'}`;
    if (isExpired(session, now)) text += ' — reconnecting';
  } else if (sent) {
    text = sentTo
      ? `Sent to ${sentTo} — open the link on this device, or type the 6-digit code from the same email.`
      : 'Sent — open the link on this device, or type the 6-digit code from the same email.';
  } else {
    text = 'Not signed in. The plan stays on this phone.';
  }
  if (error) text += ` ${error}`;
  return { signedIn, sent, sentTo, error, text };
}

// ------------------------------------------------------------------- errors
/** Supabase names the problem in one of four fields depending on the endpoint. */
function problemText(payload) {
  const p = payload ?? {};
  const msg = p.error_description ?? p.message ?? p.msg ?? p.error ?? null;
  return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
}

/**
 * Tell "the server said no" apart from "there was no server".
 *
 * A thrown fetch is a network problem, and a network problem must never be
 * reported as a rejected credential -- see the note about commutes at the top.
 */
const OFFLINE = 'You appear to be offline. The app still works; try signing in when you have a connection.';

// ------------------------------------------------------------------ the API
export function createRemote({
  win,
  fetch: doFetch = win?.fetch ? win.fetch.bind(win) : globalThis.fetch,
  session = sessionStore(win),
  pending = pendingStore(win),
  url = SUPABASE_URL,
  key = SUPABASE_KEY,
  now = nowMs,
  onChange = () => {},
} = {}) {
  let error = null;
  // The single in-flight refresh. Several widgets asking for a token in one
  // tick must share one request: Supabase rotates the refresh token on use, so
  // parallel refreshes race to invalidate each other.
  let refreshing = null;
  // The account id, when the session in hand did not come with one.
  // `sessionFromHash` builds a session out of URL fragments, and those carry no
  // user object: between following an email link and the first refresh, an
  // otherwise perfectly good session knows the email address and not the id.
  // Households are keyed on the id, so that gap is a real one. Cached because
  // it cannot change without a different session replacing this one.
  let knownId = null;

  // `sent` is derived rather than held: the stored address IS the fact that a
  // code is on its way, and deriving it means the code box is still there after
  // the phone reloads the page while the mail app is open.
  const waiting = () => pending.get(now());
  const state = () => {
    const p = waiting();
    return describeRemote(session.get(), { sent: Boolean(p), sentTo: p?.email ?? null, error }, now());
  };
  const changed = () => onChange(state());

  const store = (s) => { knownId = s?.userId ?? null; session.set(s); pending.clear(); changed(); };
  const forget = () => { knownId = null; session.clear(); changed(); };

  async function call(path, { method = 'POST', body, token } = {}) {
    const headers = { apikey: key, 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    let res;
    try {
      res = await doFetch(`${url}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, offline: true, status: 0, payload: null };
    }
    let payload = null;
    try { payload = await res.json(); } catch { /* 204, or HTML from a proxy */ }
    return { ok: res.status < 400, offline: false, status: res.status, payload };
  }

  /** Where the email link should come back to: this page, without the hash. */
  const redirectTo = () => {
    const l = win?.location;
    if (!l) return url;
    return `${l.origin ?? ''}${l.pathname ?? ''}` || String(l.href ?? url).split('#')[0];
  };

  return {
    session: () => session.get(),
    signedIn: () => Boolean(session.get()?.accessToken),
    status: state,
    /** The address a code was sent to, or null. Read by the UI, not by the server. */
    pendingEmail: () => waiting()?.email ?? null,

    /** Ask for a one-time link. Nothing is stored until the link is followed. */
    async signIn(email) {
      const addr = String(email ?? '').trim().toLowerCase();
      if (!addr || !addr.includes('@')) {
        error = 'That does not look like an email address.';
        changed();
        return { ok: false, error };
      }
      const r = await call(OTP_PATH, {
        body: { email: addr, options: { email_redirect_to: redirectTo() } },
      });
      if (r.offline) { error = OFFLINE; changed(); return { ok: false, error }; }
      if (!r.ok) {
        error = r.status === 429
          ? `Too many requests just now — ${problemText(r.payload) ?? 'give it a moment and try again.'}`
          : problemText(r.payload) ?? `The link could not be sent (${r.status}).`;
        changed();
        return { ok: false, error };
      }
      pending.set({ email: addr, at: now() });
      error = null;
      changed();
      return { ok: true };
    },

    /**
     * Trade the code from the email for a session.
     *
     * The address comes from storage rather than from the caller: it is the one
     * the code was actually sent to, and asking the UI to pass it again is one
     * more place for the two to disagree.
     */
    async verifyCode(code) {
      const token = normaliseCode(code);
      const addr = waiting()?.email ?? null;
      if (!addr) {
        error = 'Ask for a code first — there is no email address to check it against.';
        changed();
        return { ok: false, error };
      }
      if (!token) {
        error = 'Type the code from the email.';
        changed();
        return { ok: false, error };
      }
      // Two types, in order, because the email a code arrives in depends on
      // whether the account already existed: an established address gets the
      // Magic Link template and verifies as 'email', a brand-new one gets
      // Confirm signup. Rather than guess which, try the common case and fall
      // back once. A wrong code costs one extra request; guessing wrong would
      // cost a person their only way in.
      let r = await call(VERIFY_PATH, { body: { email: addr, token, type: 'email' } });
      if (!r.ok && !r.offline) {
        const second = await call(VERIFY_PATH, { body: { email: addr, token, type: 'signup' } });
        // Report the first failure if both fail: 'email' is the case that
        // matches the email we told them to look for, so its message is the one
        // that will make sense to read.
        if (second.ok || second.offline) r = second;
      }
      // Offline keeps the address, for the same reason a failed refresh keeps
      // the session: the code in their hand is probably still good.
      if (r.offline) { error = OFFLINE; changed(); return { ok: false, error }; }
      if (!r.ok) {
        error = problemText(r.payload) ?? `That code was not accepted (${r.status}).`;
        changed();
        return { ok: false, error };
      }
      const next = normaliseSession(r.payload, now());
      if (!next) { error = 'The server sent a session that could not be read.'; changed(); return { ok: false, error }; }
      error = null;
      store(next);
      return { ok: true };
    },

    /**
     * Pick up the tokens an email link left in the address bar.
     *
     * The hash is wiped either way. On success a token has no business sitting
     * in history or in a screenshot; on failure, leaving it there means every
     * reload retries a link that is already dead.
     */
    async completeFromUrl() {
      const hash = win?.location?.hash ?? '';
      if (!hash || hash === '#') return { ok: true, signedIn: false, error: null };

      const found = sessionFromHash(hash, now());
      const said = errorFromHash(hash);
      if (!found && !said) return { ok: true, signedIn: false, error: null };

      try {
        const back = redirectTo();
        win.history?.replaceState?.(null, '', back);
        if (win.location && win.location.hash) win.location.hash = '';
      } catch { /* an old browser keeping the hash is not worth failing over */ }

      if (found) { error = null; store(found); return { ok: true, signedIn: true, error: null }; }
      error = said;
      changed();
      return { ok: false, signedIn: false, error };
    },

    /**
     * A token good enough to send, or null.
     *
     * Null is an ordinary answer: signed out, or signed in but temporarily
     * unable to renew. Callers treat it as "not now", never as "signed out".
     */
    async accessToken() {
      const s = session.get();
      if (!s?.accessToken) return null;
      if (expiresInMs(s, now()) > REFRESH_SKEW_MS) return s.accessToken;
      const r = await this.refresh();
      return r.ok ? session.get()?.accessToken ?? null : null;
    },

    /**
     * Who is signed in, as the id the database keys membership on.
     *
     * Prefers what the session already carries and asks at most once per
     * sign-in. Null is an ordinary answer, and means the same as a null token:
     * not now. A caller that needs the id must treat null as "ask again later",
     * never as "this is somebody else".
     */
    async userId() {
      const s = session.get();
      if (s?.userId) return s.userId;
      if (knownId) return knownId;
      const token = await this.accessToken();
      if (!token) return null;
      const r = await call(USER_PATH, { method: 'GET', token });
      if (!r.ok) return null;
      knownId = r.payload?.id ?? null;
      return knownId;
    },

    /** Renew, once, however many callers ask at the same moment. */
    async refresh() {
      if (refreshing) return refreshing;
      const s = session.get();
      if (!s?.refreshToken) return { ok: false, error: 'There is nothing to refresh.' };

      refreshing = (async () => {
        const r = await call(`${TOKEN_PATH}?grant_type=refresh_token`, {
          body: { refresh_token: s.refreshToken },
        });
        if (r.offline) {
          // Keep the session. The stored token may still be valid, and the
          // next attempt costs nothing.
          error = OFFLINE;
          changed();
          return { ok: false, error };
        }
        if (!r.ok) {
          // The server has actually refused this token. Retrying it for ever
          // would mean every call in the app failing slowly instead of once.
          error = 'Your sign-in has expired. Sign in again to pick the plan back up.';
          forget();
          return { ok: false, error };
        }
        const next = normaliseSession(r.payload, now());
        if (!next) { error = 'The server sent a session that could not be read.'; changed(); return { ok: false, error }; }
        error = null;
        store(next);
        return { ok: true };
      })().finally(() => { refreshing = null; });

      return refreshing;
    },

    /**
     * Give up on a code and go back to the email box.
     *
     * Without this a mistyped address is a dead end for as long as the pending
     * record lasts: the panel would keep offering a code box for an email that
     * was never going to arrive, with no way back.
     */
    cancelSignIn() {
      pending.clear();
      error = null;
      changed();
      return { ok: true };
    },

    /** Always clears the device. The server is told when it can be reached. */
    async signOut() {
      const s = session.get();
      if (s?.accessToken) await call(LOGOUT_PATH, { token: s.accessToken });
      error = null;
      pending.clear();
      forget();
      return { ok: true };
    },
  };
}
