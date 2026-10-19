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

export const SUPABASE_URL = 'https://xtcjakhoeehmrzdtzcvr.supabase.co';
// Public by design (A5), and it ships in the HTML. Security is the RLS policies
// in supabase/migrations/0002_rls.sql, never the secrecy of this string.
export const SUPABASE_KEY = 'sb_publishable_nxZzg-3P0__Ki-DwbTe5lA_c5a1R2EG';

// Its own key, deliberately not STORAGE_KEY. See the note at the top.
export const SESSION_KEY = 'mealplanner.session';

export const OTP_PATH = '/auth/v1/otp';
export const TOKEN_PATH = '/auth/v1/token';
export const LOGOUT_PATH = '/auth/v1/logout';

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

// -------------------------------------------------------------- the caption
/** What the account line says. One place, so the wording is consistent. */
export function describeRemote(session, { sent = false, error = null } = {}, now = nowMs()) {
  const signedIn = Boolean(session?.accessToken);
  let text;
  if (signedIn) {
    text = `Signed in as ${session.email ?? 'this account'}`;
    if (isExpired(session, now)) text += ' — reconnecting';
  } else if (sent) {
    text = 'Link sent — check your email on this device, and open it here.';
  } else {
    text = 'Not signed in. The plan stays on this phone.';
  }
  if (error) text += ` ${error}`;
  return { signedIn, sent, error, text };
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
  url = SUPABASE_URL,
  key = SUPABASE_KEY,
  now = nowMs,
  onChange = () => {},
} = {}) {
  let sent = false;
  let error = null;
  // The single in-flight refresh. Several widgets asking for a token in one
  // tick must share one request: Supabase rotates the refresh token on use, so
  // parallel refreshes race to invalidate each other.
  let refreshing = null;

  const changed = () => onChange(describeRemote(session.get(), { sent, error }, now()));

  const store = (s) => { session.set(s); sent = false; changed(); };
  const forget = () => { session.clear(); changed(); };

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
    status: () => describeRemote(session.get(), { sent, error }, now()),

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
      sent = true;
      error = null;
      changed();
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

    /** Always clears the device. The server is told when it can be reached. */
    async signOut() {
      const s = session.get();
      if (s?.accessToken) await call(LOGOUT_PATH, { token: s.accessToken });
      error = null;
      sent = false;
      forget();
      return { ok: true };
    },
  };
}
