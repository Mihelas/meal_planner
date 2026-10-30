// Sync without a server.
//
// Two people, two devices, one JSON file in a folder they both already share
// (Dropbox, OneDrive, a NAS, a USB stick). The page writes that file on every
// change and reads it on every start, and store.js's mergeStates() decides what
// wins field by field. There is no account, no server and nothing to keep
// running in five years' time — which is the only way a single HTML file stays
// useful that long.
//
// Three things make this honest rather than magic:
//   - The File System Access API only exists in Chromium browsers. Where it is
//     missing, say so and keep the manual Export/Import. Never pretend.
//   - A file handle survives a reload only if it is stored in IndexedDB (it
//     cannot be JSON-stringified into localStorage), and the browser still asks
//     for permission again after a restart. That question can only be asked from
//     a click, so the UI gets a "Reconnect" button rather than a silent failure.
//   - Two devices writing at the same second will still resolve to one of the
//     two weeks. mergeStates keeps the durable things from both; the week itself
//     is last-write-wins. That is a documented limit, not a bug to hide.

import { snapshot, mergeStates } from './store.js';

export const SYNC_FILE_NAME = 'meal-planner-shared.json';
const DB_NAME = 'mealplanner.sync';
const DB_STORE = 'handles';
const HANDLE_KEY = 'file';

/** Chromium has it; Safari and Firefox do not. Checked, never assumed. */
export const syncSupported = (win) => Boolean(win
  && typeof win.showSaveFilePicker === 'function'
  && typeof win.showOpenFilePicker === 'function');

/**
 * A handle store backed by IndexedDB.
 *
 * Injectable because everything else in this file is testable without a browser
 * and this is the one part that is not: the tests pass a plain in-memory store
 * with the same three methods.
 */
export function idbHandles(win) {
  const idb = win?.indexedDB;
  const open = () => new Promise((resolve, reject) => {
    if (!idb) { reject(new Error('This browser has no IndexedDB, so the link cannot be remembered.')); return; }
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened.'));
  });
  const tx = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction(DB_STORE, mode);
        const req = fn(t.objectStore(DB_STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB rejected the write.'));
      });
    } finally {
      db.close();
    }
  };
  return {
    get: () => tx('readonly', (s) => s.get(HANDLE_KEY)),
    set: (h) => tx('readwrite', (s) => s.put(h, HANDLE_KEY)),
    clear: () => tx('readwrite', (s) => s.delete(HANDLE_KEY)),
  };
}

/** In-memory fallback: sync still works for the session, it just forgets the link. */
export function memoryHandles() {
  let box;
  return {
    get: async () => box,
    set: async (h) => { box = h; },
    clear: async () => { box = undefined; },
  };
}

/**
 * Is the handle usable right now?
 * 'granted' = go ahead. 'prompt' = the browser will ask, so it needs a click.
 * 'denied' = it will not ask again this session.
 */
export async function permissionFor(handle, { request = false } = {}) {
  if (!handle) return 'denied';
  const opts = { mode: 'readwrite' };
  try {
    const current = handle.queryPermission ? await handle.queryPermission(opts) : 'granted';
    if (current === 'granted' || !request || !handle.requestPermission) return current;
    return await handle.requestPermission(opts);
  } catch {
    return 'denied';
  }
}

export async function readHandle(handle) {
  const file = await handle.getFile();
  return file.text();
}

export async function writeHandle(handle, text) {
  const w = await handle.createWritable();
  try {
    await w.write(text);
  } finally {
    // Nothing is on disk until close() resolves, so this cannot be skipped —
    // not even on the error path, or the file is left truncated and locked.
    await w.close();
  }
}

/** A short, plain sentence for the sync panel. No jargon, no timestamps in ms. */
export function describeSync(state, { supported = true, permission = 'granted', standDown = false } = {}) {
  const sync = state?.sync ?? {};
  // Before the support check, not after: a household already moves the week
  // between devices, so telling a Safari user to reach for Export and Import
  // would be advice for a problem they no longer have.
  if (standDown) {
    return sync.name
      ? {
        tone: 'info',
        text: `Paused. ${sync.name} is not being read or written while this device shares a week with a household — two routes into one plan is how something deleted on one comes back from the other. Unlink the file if you would rather share that way instead.`,
      }
      : { tone: 'info', text: 'The household is sharing this week; a shared file would be a second route into the same plan.' };
  }
  if (!supported) {
    return {
      tone: 'info',
      text: 'This browser cannot link a file (only Chrome and Edge can). Use Export and Import to move data between devices.',
    };
  }
  if (!sync.name) {
    return { tone: 'info', text: 'Not linked. Pick one file in a folder you both share and each device will read and write it.' };
  }
  if (permission === 'prompt') {
    return { tone: 'warn', text: `Linked to ${sync.name}, but the browser needs permission again after a restart. Press Reconnect.` };
  }
  if (permission === 'denied') {
    return { tone: 'bad', text: `Permission to use ${sync.name} was refused, so nothing is being shared. Press Reconnect to try again.` };
  }
  return {
    tone: 'good',
    text: `Linked to ${sync.name}. Last synced ${sync.at ? whenText(sync.at) : 'not yet'}${sync.writes ? ` · ${sync.writes} write${sync.writes === 1 ? '' : 's'}` : ''}.`,
  };
}

/** "3 minutes ago" beats an ISO timestamp on a phone in a kitchen. */
export function whenText(ms, now = Date.now()) {
  const secs = Math.max(0, Math.round((now - Number(ms)) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * A blank file is not corrupt data.
 *
 * The very first link creates an empty file — and the save picker truncates an
 * existing one — so "nothing in it yet" has to be a normal outcome rather than
 * an error the user has to interpret.
 */
export const isBlank = (text) => !text || !text.trim();

/**
 * The orchestrator.
 *
 * `store` is a store from createStore(); `handles` is a handle store; `onChange`
 * is called whenever the local state changed and the UI has to re-render. Every
 * method resolves to { ok, error? } and never throws at the caller — a sync that
 * blows up must not take the meal plan down with it.
 */
/** How often a visible tab re-reads the shared file. Often enough to feel live, rarely
 * enough that a synced folder is not being hammered. */
export const PULL_EVERY_MS = 60_000;

export function createSync({
  win, store, handles = null, onChange = () => {}, debounceMs = 1200,
  /**
   * One sharing mechanism at a time.
   *
   * The file and the household row are two merge paths into the same document.
   * Both are careful on their own, and both were still enough together to lose a
   * week: a merge folded in from the file left this device's note of the row
   * untouched, so her bans sat here until an unrelated edit happened to push
   * them. That particular hole is closed, but the shape of it is not -- any
   * future bug in either path gets a second door to come through, and a
   * household that works makes the file redundant anyway.
   *
   * A predicate rather than a flag because the answer changes mid-session: the
   * same tab joins a household, or leaves one. Defaulted here rather than passed
   * from app.js so that nothing has to remember to wire it up.
   */
  standDown = () => Boolean(store?.state?.cloud?.householdId),
}) {
  const box = handles ?? (win?.indexedDB ? idbHandles(win) : memoryHandles());
  let handle = null;
  let permission = 'prompt';
  let error = null;
  let busy = false;
  let timer = null;
  let pending = false;
  // Set when the shared file could not be read or parsed. While it is set,
  // nothing is written: a file we cannot read may hold the other person's week,
  // and overwriting it with ours would destroy data to tidy up an error message.
  let blocked = false;
  let poll = null;        // the visible-tab pull timer, only while linked
  let pollEvery = PULL_EVERY_MS;
  let watching = null;    // the focus/visibility listener, kept so it can be removed

  const ready = () => Boolean(handle) && permission === 'granted' && !standDown();
  /** No `document` at all (tests, a worker) counts as visible: there is nothing to hide. */
  const visible = () => (win?.document?.visibilityState ?? 'visible') !== 'hidden';

  const fail = (err, what) => {
    error = `${what} (${err?.message ?? err}).`;
    return { ok: false, error };
  };

  const stamp = (extra = {}) => {
    const s = store.state;
    store.save({ ...s, sync: { ...(s.sync ?? {}), ...extra } });
  };

  /** Pick up a link made in an earlier session, without asking anything. */
  async function restore() {
    if (!syncSupported(win)) return { ok: false };
    try {
      handle = (await box.get()) ?? null;
    } catch (err) {
      return fail(err, 'The saved file link could not be read');
    }
    if (!handle) return { ok: false };
    permission = await permissionFor(handle);
    // Only pull when the browser is already happy: asking needs a click, and a
    // click cannot happen during boot. ready() also covers standing down, so a
    // device that joined a household keeps the link visible -- and unlinkable --
    // without reading from it.
    if (!ready()) { onChange(); return { ok: false }; }
    const res = await pull();
    onChange();
    return res;
  }

  /** Link a file. `create: true` makes a new one, otherwise an existing one is chosen. */
  async function link({ create = false } = {}) {
    if (!syncSupported(win)) {
      error = 'This browser cannot link a file. Use Export and Import instead.';
      return { ok: false, error };
    }
    error = null;
    blocked = false;
    try {
      handle = create
        ? await win.showSaveFilePicker({
          suggestedName: SYNC_FILE_NAME,
          types: [{ description: 'Planner data', accept: { 'application/json': ['.json'] } }],
        })
        : (await win.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'Planner data', accept: { 'application/json': ['.json'] } }],
        }))[0];
    } catch (err) {
      // An abort is the user closing the picker. That is not an error to report.
      if (err?.name === 'AbortError') return { ok: false };
      return fail(err, 'The file could not be opened');
    }

    permission = await permissionFor(handle, { request: true });
    if (permission !== 'granted') {
      error = 'Without permission to write that file nothing can be shared.';
      return { ok: false, error };
    }
    try {
      await box.set(handle);
    } catch {
      // Not fatal: sync works for this session, it just will not survive a reload.
      error = 'The link works now but could not be remembered, so it will have to be re-linked next time.';
    }
    stamp({ name: handle.name ?? SYNC_FILE_NAME });
    // Merge whatever is already in the file, then write the result back, so both
    // devices end on the same content no matter which linked first. If the read
    // failed, stop here rather than writing over a file we did not understand.
    const got = await pull();
    if (!got.ok) { onChange(); return { ok: false, error }; }
    const put = await push({ force: true, fresh: true });
    onChange();
    return put;
  }

  /** Ask again for a file linked in an earlier session. Must come from a click. */
  async function reconnect() {
    if (!handle) {
      try { handle = (await box.get()) ?? null; } catch { handle = null; }
    }
    if (!handle) return link({ create: false });
    permission = await permissionFor(handle, { request: true });
    if (permission !== 'granted') {
      error = 'The browser refused access to the linked file.';
      onChange();
      return { ok: false, error };
    }
    error = null;
    blocked = false;
    const res = await pull();
    if (res.ok) await push({ force: true, fresh: true });
    onChange();
    return res;
  }

  async function pull() {
    if (!ready()) return { ok: false };
    armPoll();
    let text;
    try {
      text = await readHandle(handle);
    } catch (err) {
      blocked = true;
      return fail(err, 'The shared file could not be read, so nothing is being written to it either');
    }
    blocked = false;
    if (isBlank(text)) { error = null; return { ok: true, empty: true }; }
    try {
      const merged = mergeStates(store.state, JSON.parse(text));
      // `touch: false`: folding in the other device's file is not someone editing the
      // week here, and stamping it would make this device outrank theirs for ever.
      store.save(
        { ...merged, sync: { ...(merged.sync ?? {}), name: handle.name ?? SYNC_FILE_NAME, at: Date.now() } },
        { touch: false },
      );
      error = null;
      return { ok: true };
    } catch (err) {
      blocked = true;
      return fail(err, 'The shared file does not contain planner data, so it is being left alone rather than overwritten');
    }
  }

  async function push({ force = false, fresh = false } = {}) {
    if (!ready()) return { ok: false };
    if (blocked) return { ok: false, error };
    if (busy && !force) { pending = true; return { ok: false }; }
    busy = true;
    try {
      // Read, merge, then write. Both devices debounce on their own clock, so by the
      // time this fires the file may hold an edit this one has never seen -- and
      // writing straight over it is exactly how somebody's week disappeared. A failed
      // read leaves `blocked` set and nothing is written, which is the old behaviour.
      //
      // `fresh` is for the callers that just pulled (link, reconnect): the local view
      // cannot be stale yet, and reading the same file twice on the boot path buys
      // nothing.
      if (!fresh) {
        const got = await pull();
        if (!got.ok) return { ok: false, error };
      }
      const s = store.state;
      await writeHandle(handle, JSON.stringify(snapshot(s, s.sync?.device ?? null), null, 2));
      stamp({ name: handle.name ?? SYNC_FILE_NAME, at: Date.now(), writes: Number(s.sync?.writes ?? 0) + 1 });
      error = null;
      return { ok: true };
    } catch (err) {
      return fail(err, 'The shared file could not be written');
    } finally {
      busy = false;
      if (pending) { pending = false; schedule(); }
    }
  }

  /**
   * Called after every local change. Debounced, because typing a weight into a
   * field re-renders on each keystroke and none of those deserve a disk write.
   */
  function schedule() {
    if (!ready()) return;
    if (timer) win?.clearTimeout?.(timer);
    timer = win?.setTimeout?.(() => { timer = null; return push(); }, debounceMs);
  }

  /**
   * Keep up with the other device without anyone pressing a button.
   *
   * Nothing re-read the file after boot, so a tab left open all afternoon pushed its
   * increasingly stale week over the top of hers every time it was touched. Focus
   * covers coming back to the tab; the timer covers leaving it open on a second
   * screen. Both are gated on the tab being visible, because a background tab
   * polling a file in a synced folder is how a laptop spends a night at 100 % fan.
   */
  function watch({ everyMs = PULL_EVERY_MS } = {}) {
    if (!win?.addEventListener || watching) return;
    pollEvery = everyMs;
    watching = () => (ready() && visible() ? pull() : undefined);
    // Listeners cost nothing while unlinked, so they go on straight away and the
    // app does not have to call watch() again after a link.
    win.addEventListener('focus', watching);
    win.addEventListener('visibilitychange', watching);
    armPoll();
  }

  /**
   * The timer, unlike the listeners, is only started once there is a file.
   *
   * A repeating timer on a page with nothing shared is a timer that will never do
   * anything, and it keeps the page awake to do it. Armed from inside pull(), which
   * is the one thing every successful link, restore and reconnect goes through.
   */
  function armPoll() {
    if (!watching || poll || !ready()) return;
    poll = win?.setInterval?.(watching, pollEvery) ?? null;
  }

  function disarmPoll() {
    if (poll) { win?.clearInterval?.(poll); poll = null; }
  }

  function unwatch() {
    if (watching) {
      win?.removeEventListener?.('focus', watching);
      win?.removeEventListener?.('visibilitychange', watching);
      watching = null;
    }
    disarmPoll();
  }

  async function unlink() {
    disarmPoll();
    handle = null;
    permission = 'prompt';
    error = null;
    blocked = false;
    try { await box.clear(); } catch { /* the link is gone either way */ }
    stamp({ name: null, at: null, writes: 0 });
    onChange();
    return { ok: true };
  }

  return {
    get supported() { return syncSupported(win); },
    get linked() { return Boolean(handle); },
    get permission() { return permission; },
    get error() { return error; },
    /** True while the household is doing this job, so the file must not. */
    get standDown() { return standDown(); },
    get status() {
      return describeSync(store.state, {
        supported: syncSupported(win),
        permission: handle ? permission : 'granted',
        standDown: standDown(),
      });
    },
    restore, link, reconnect, pull, push, schedule, unlink, watch, unwatch,
    /** Flush anything the debounce is still holding, e.g. before the tab closes. */
    flush() { if (timer) { win?.clearTimeout?.(timer); timer = null; return push({ force: true }); } return Promise.resolve({ ok: true }); },
  };
}
