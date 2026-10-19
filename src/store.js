// Memory.
//
// Everything the app knows lives in one JSON blob in localStorage: the current
// week, the ban list, the locks (they live inside the plan), the per-day modes,
// the settings and the weight log. Plus export/import, because data trapped in
// one browser profile is data you will lose.
//
// Every read is defensive: a blocked localStorage (private window, disabled
// storage, quota full) degrades to an in-memory store for the session rather
// than taking the app down. A stored blob from an older version is migrated
// or dropped, never trusted as-is.

import {
  PLAN_VERSION, defaultSettings, COOKING_STYLES, pantryKey, legacyPantryKey,
  SLOT_KEYS, isEntry, planId, shoppingSlice, MAX_VEGETARIAN_DAYS,
} from './planner.js';
import {
  setCustomRecipes, DEFAULT_SHOPS, AISLES, RECIPES, INGREDIENT_UNITS,
} from './recipes.js';

export const STORAGE_KEY = 'mealplanner.v1';
export const SCHEMA_VERSION = 4;

/**
 * How long a deletion is remembered.
 *
 * A tombstone has to outlive the longest either device will go without opening the
 * app, or the other one resurrects what was deleted. Three months covers a holiday
 * and a forgotten laptop; keeping them for ever would grow the shared file without
 * bound for no benefit, since by then both copies agree.
 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** The shape of `memory.removed`: one `{ id: when }` map per bucket that can shrink. */
export const REMOVED_BUCKETS = ['banned', 'favourites', 'custom', 'bought'];

/** Drop removals older than the window, and anything whose stamp cannot be compared. */
export function pruneRemoved(removed, now = Date.now()) {
  const out = {};
  for (const bucket of REMOVED_BUCKETS) {
    out[bucket] = {};
    for (const [id, when] of Object.entries(removed?.[bucket] ?? {})) {
      const at = Number(when);
      if (Number.isFinite(at) && at > 0 && now - at <= TOMBSTONE_TTL_MS) out[bucket][id] = at;
    }
  }
  return out;
}

/** A short, stable name for this browser, so every write is attributable. */
export const newDeviceId = () => `d${Math.random().toString(36).slice(2, 8)}`;

/** Fallback used when localStorage throws — the app still works, it just forgets. */
function memoryBackend() {
  let box = null;
  return {
    available: false,
    get: () => box,
    set: (v) => { box = v; },
    clear: () => { box = null; },
  };
}

function localBackend(storage) {
  return {
    available: true,
    get: () => storage.getItem(STORAGE_KEY),
    set: (v) => storage.setItem(STORAGE_KEY, v),
    clear: () => storage.removeItem(STORAGE_KEY),
  };
}

/** Probe rather than assume: Safari private mode has localStorage that throws on write. */
export function detectBackend(win = typeof window !== 'undefined' ? window : undefined) {
  try {
    const s = win?.localStorage;
    if (!s) return memoryBackend();
    const probe = `${STORAGE_KEY}.probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return localBackend(s);
  } catch {
    return memoryBackend();
  }
}

export function emptyState() {
  return {
    schema: SCHEMA_VERSION,
    settings: defaultSettings(),
    // `memory` is the durable bucket: everything here is meant to outlive any
    // single week, and it is what the file-sync merge unions rather than
    // overwrites. The plan is the ephemeral part.
    memory: {
      banned: [],
      favourites: [],
      ratings: {},       // recipeId -> 1..5
      notes: {},         // recipeId -> free text, resurfaced next time it appears
      stats: { away: {}, kept: {} },
      custom: [],        // user-authored recipes
      pantry: {},        // pantryKey -> true, the things always in the cupboard
      // Deletions, so the merge can say "not that any more" and not just "and also
      // this". `{ id: when }` per bucket, pruned after TOMBSTONE_TTL_MS.
      removed: { banned: {}, favourites: {}, custom: {}, bought: {} },
    },
    plan: null,
    bought: {},          // shopping item id -> true when it is already in the trolley
    itemShop: {},        // shopping item id -> shop id, overriding the aisle default
    weights: [],         // [{ date: 'YYYY-MM-DD', person1: 100, person2: 65 }]
    ui: { tab: 'week' },
    sync: { name: null, at: null, writes: 0, device: null },
  };
}

/** Sane defaults for everything memory gained in v3, without touching what is there. */
function repairMemory(m, base) {
  const out = { ...base, ...(m ?? {}) };
  if (!Array.isArray(out.banned)) out.banned = [];
  if (!Array.isArray(out.favourites)) out.favourites = [];
  if (!Array.isArray(out.custom)) out.custom = [];
  if (!out.ratings || typeof out.ratings !== 'object') out.ratings = {};
  if (!out.notes || typeof out.notes !== 'object') out.notes = {};
  if (!out.pantry || typeof out.pantry !== 'object') out.pantry = {};
  out.removed = pruneRemoved(out.removed);
  const stats = out.stats && typeof out.stats === 'object' ? out.stats : {};
  out.stats = {
    away: stats.away && typeof stats.away === 'object' ? stats.away : {},
    kept: stats.kept && typeof stats.kept === 'object' ? stats.kept : {},
  };
  // A rating outside 1-5 would skew the scoring silently, so drop it.
  for (const [id, v] of Object.entries(out.ratings)) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > 5) delete out.ratings[id];
    else out.ratings[id] = n;
  }
  return out;
}

/** Shops must cover real aisles and have ids, or the shopping list loses items. */
function repairShops(shops) {
  const list = (Array.isArray(shops) ? shops : [])
    .filter((s) => s && typeof s.name === 'string' && s.name.trim())
    .map((s, i) => ({
      id: String(s.id ?? `shop${i}`),
      name: s.name.trim(),
      aisles: (Array.isArray(s.aisles) ? s.aisles : []).filter((a) => AISLES.includes(a)),
    }));
  return list.length ? list : DEFAULT_SHOPS.map((s) => ({ ...s, aisles: [...s.aisles] }));
}

/**
 * Bring an older or partial blob up to the current shape.
 * Anything unrecognised is replaced with the default rather than half-trusted.
 */
export function migrate(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;

  const state = {
    ...base,
    ...raw,
    schema: SCHEMA_VERSION,
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    memory: { ...base.memory, ...(raw.memory ?? {}) },
    ui: { ...base.ui, ...(raw.ui ?? {}) },
  };

  // People must be complete, or every calorie number downstream is wrong.
  const people = Array.isArray(state.settings.people) ? state.settings.people : [];
  state.settings.people = base.settings.people.map((d, i) => ({ ...d, ...(people[i] ?? {}) }));
  if (!Array.isArray(state.settings.dayModes) || state.settings.dayModes.length !== 7) {
    state.settings.dayModes = base.settings.dayModes;
  }
  if (!Array.isArray(state.settings.eatOut)) state.settings.eatOut = base.settings.eatOut;
  state.memory = repairMemory(state.memory, base.memory);
  if (!Array.isArray(state.weights)) state.weights = [];
  if (!state.bought || typeof state.bought !== 'object') state.bought = {};
  if (!state.itemShop || typeof state.itemShop !== 'object') state.itemShop = {};
  if (!state.sync || typeof state.sync !== 'object') state.sync = { ...base.sync };

  // --- v3 settings
  if (!COOKING_STYLES.includes(state.settings.cookingStyle)) state.settings.cookingStyle = 'daily';
  if (!Array.isArray(state.settings.cookDays) || !state.settings.cookDays.length) {
    state.settings.cookDays = base.settings.cookDays;
  }
  // A week start outside 0..6 would rotate the whole plan into nonsense, and it
  // can only arrive from a hand-edited file or an older sync partner.
  if (!Number.isInteger(state.settings.weekStart)
    || state.settings.weekStart < 0 || state.settings.weekStart > 6) {
    state.settings.weekStart = 0;
  }
  // A missing selection is the whole week, which is what every file written
  // before this feature existed needs. A stored array is cleaned, not replaced:
  // an empty one is a real choice and has to survive a reload.
  state.settings.shoppingDays = Array.isArray(state.settings.shoppingDays)
    ? shoppingSlice(state.settings)
    : [0, 1, 2, 3, 4, 5, 6];
  state.settings.shops = repairShops(state.settings.shops);
  if (!Array.isArray(state.settings.adjust) || state.settings.adjust.length !== 7) {
    state.settings.adjust = base.settings.adjust;
  }
  state.settings.adjust = state.settings.adjust.map((a) => (a && typeof a === 'object' ? a : {}));
  // Only the count is stored; which days is derived at read time, so nothing
  // here has to move when the match night or an evening out does. Zero is a real
  // choice and has to survive a reload, so the guard tests the value, not truth.
  const veg = state.settings.vegetarianDays;
  if (!Number.isInteger(veg) || veg < 0 || veg > MAX_VEGETARIAN_DAYS) {
    state.settings.vegetarianDays = base.settings.vegetarianDays;
  }
  if (state.settings.useSeason !== false) state.settings.useSeason = true;
  if (!Number.isInteger(state.settings.month) || state.settings.month < 1 || state.settings.month > 12) {
    state.settings.month = null;
  }
  for (const person of state.settings.people) {
    if (person.goal !== 'maintain') person.goal = 'lose';
    const g = Number(person.goalWeightKg);
    person.goalWeightKg = Number.isFinite(g) && g > 30 && g < 300 ? g : null;
  }

  remapPantryKeys(state);

  // A plan from an older engine may not have the slots the UI reads, so drop it
  // and regenerate rather than render half a week.
  if (state.plan && (state.plan.version !== PLAN_VERSION || !Array.isArray(state.plan.days) || state.plan.days.length !== 7)) {
    state.plan = null;
    state.migrationNote = 'Your saved week was made by an older version of the planner, so it was rebuilt. Your bans, locks settings and weight log were kept.';
  }
  // A week saved before plan ids existed. Backfilling it rather than leaving it blank
  // is what makes the per-plate merge work on the week they are in the middle of,
  // instead of only on the next one they generate -- and because the id is derived
  // from the content, both devices arrive at the same answer without talking.
  if (state.plan && !state.plan.id) state.plan.id = planId(state.plan.seed, state.plan.days);

  // Keep only the keys that mean something. `{ ...base, ...raw }` above carries
  // anything the blob happens to hold, which is how a bug that wrote a key named
  // after a recipe id got saved -- and then synced to the other device. The two
  // notes are one-shot explanations the UI clears once read; `savedAt` is the
  // merge's tie-breaker and is stamped on save rather than created here.
  const keep = new Set([...Object.keys(base), 'savedAt', 'migrationNote', 'mergeNote']);
  for (const key of Object.keys(state)) if (!keep.has(key)) delete state[key];
  return state;
}

/**
 * `pantryKey` used to drop umlauts instead of transliterating them, so `Olivenöl`
 * keyed as `oliven-l-ml`. Three persisted maps are keyed that way -- the cupboard,
 * the shopping ticks and the per-item shop -- and leaving them would read as "the
 * app forgot what I own" the first time someone opened it after an update.
 *
 * Rebuilt from the ingredient lists rather than from the keys, because a key cannot
 * be reversed. Every known item name is crossed with every unit, so a tick stored
 * under a unit the recipe no longer uses still moves. Runs unconditionally with no
 * schema gate: it is idempotent, since a key already in the new form is never what
 * the old function produced for it.
 *
 * What it cannot reach: a key whose item name appears nowhere in the library any
 * more -- a tick left by a recipe since deleted. That entry stays under its old key,
 * where nothing reads it. It costs a stale boolean, not a wrong shopping list.
 */
function remapPantryKeys(state) {
  const moves = new Map();
  const own = Array.isArray(state?.memory?.custom) ? state.memory.custom : [];
  const names = new Set();
  for (const r of [...RECIPES, ...own]) {
    for (const ing of (r?.ingredients ?? [])) if (ing?.item) names.add(ing.item);
  }
  for (const item of names) {
    for (const unit of INGREDIENT_UNITS) {
      const was = legacyPantryKey({ item, unit });
      const now = pantryKey({ item, unit });
      if (was !== now) moves.set(was, now);
    }
  }
  if (!moves.size) return state;

  for (const field of ['pantry', 'bought', 'itemShop']) {
    const src = field === 'pantry' ? state.memory?.pantry : state[field];
    if (!src || typeof src !== 'object') continue;
    const out = {};
    for (const [k, v] of Object.entries(src)) out[moves.get(k) ?? k] = v;
    if (field === 'pantry') state.memory.pantry = out; else state[field] = out;
  }
  return state;
}

/**
 * Push the user's own recipes into the recipe library.
 *
 * Called from every path that changes state — load, save, reset — rather than
 * once at boot, because a stale library is the kind of bug that shows up as
 * "the planner ignores my recipe" or, worse, a shopping list that buys for a
 * recipe nobody can see. One place, impossible to forget.
 */
function syncLibrary(state) {
  setCustomRecipes(state?.memory?.custom ?? []);
  return state;
}

export function createStore(win = typeof window !== 'undefined' ? window : undefined) {
  const backend = detectBackend(win);
  let state = emptyState();
  let lastError = null;   // transient: the most recent failed save
  let loadError = null;   // sticky: why the saved week did not come back

  function load() {
    try {
      const raw = backend.get();
      state = syncLibrary(migrate(raw ? JSON.parse(raw) : null));
      // Every write becomes attributable for free, and `sync.device` was already
      // threaded through snapshot() waiting for someone to fill it in.
      if (!state.sync.device) state.sync = { ...state.sync, device: newDeviceId() };
    } catch (err) {
      // Sticky, not transient: the app regenerates and saves a week immediately
      // after this, and a successful save must not quietly erase the explanation
      // for why the user's previous week disappeared.
      loadError = `Saved data could not be read (${err.message}), so the planner started fresh.`;
      state = syncLibrary(emptyState());
    }
    return state;
  }

  /**
   * `touch: false` for a save that came from a sync rather than from a person.
   *
   * `savedAt` is the merge's tie-breaker, and pulling used to stamp it -- so a device
   * that merely *looked* at the week outranked the one actually being used, for ever.
   * It now means what it says: somebody changed something here.
   */
  function save(next = state, { touch = true, at = Date.now() } = {}) {
    const device = next?.sync?.device ?? state?.sync?.device ?? null;
    // Stamped here rather than at each mutation site, so no future mutation can
    // forget to do it. save() is the one chokepoint every change already goes through.
    const plan = stampChangedEntries(state?.plan ?? null, next?.plan ?? null, at, device);
    state = syncLibrary(touch ? { ...next, plan, savedAt: at } : { ...next, plan });
    try {
      backend.set(JSON.stringify(state));
      lastError = null;
    } catch (err) {
      // Most likely the quota. Say so instead of silently forgetting.
      lastError = err.name === 'QuotaExceededError'
        ? 'Browser storage is full, so this change was not saved. Export your data and clear some site storage.'
        : `This change could not be saved (${err.message}). Use Export to keep a copy.`;
    }
    return state;
  }

  return {
    get state() { return state; },
    get persistent() { return backend.available; },
    get error() { return lastError; },
    get loadError() { return loadError; },
    load,
    save,
    update(fn, opts) { return save(fn(state), opts); },
    reset() {
      backend.clear();
      state = syncLibrary(emptyState());
      lastError = null; loadError = null;
      return state;
    },
    exportJSON() { return JSON.stringify(snapshot(state), null, 2); },
    importJSON(text) {
      const parsed = JSON.parse(text); // throws on junk; the caller shows the message
      if (!parsed || typeof parsed !== 'object') throw new Error('That file does not contain planner data.');
      return save(migrate(parsed));
    },
    /** Take the shared copy of a synced file and fold it into what is here. */
    mergeJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('That file does not contain planner data.');
      return save(mergeStates(state, migrate(parsed)));
    },
  };
}

/** Everything but the stamp, so a re-stamp is not itself seen as a change. */
const bareEntry = (e) => {
  if (!e || typeof e !== 'object') return null;
  const { touched, ...rest } = e;
  return rest;
};
const sameEntry = (a, b) => JSON.stringify(bareEntry(a)) === JSON.stringify(bareEntry(b));

/**
 * Stamp `touched: { at, device }` on the entries that differ from the previous save.
 *
 * A structural diff rather than a per-mutation hook: swapMeal, banAndReplace, the
 * off-plan log and the rebalance all rewrite parts of the week through different code
 * paths, and any of them could forget to stamp. What they cannot do is avoid save().
 *
 * Returns `next` untouched when there is nothing to compare against -- a brand new
 * week has no previous version, and stamping all 35 plates would tell the merge that
 * every one of them was just edited by hand.
 */
export function stampChangedEntries(prev, next, at, device) {
  if (!next?.days || !prev?.days || !prev.id || prev.id !== next.id) return next;
  const out = JSON.parse(JSON.stringify(next));
  for (let i = 0; i < out.days.length; i++) {
    for (const slot of SLOT_KEYS) {
      const was = prev.days[i]?.[slot];
      const now = out.days[i]?.[slot];
      if (!now) continue;
      if (isEntry(now)) {
        if (!sameEntry(was, now)) now.touched = { at, device };
        continue;
      }
      for (const pid of Object.keys(now)) {
        const before = isEntry(was) ? was : was?.[pid];
        if (!sameEntry(before, now[pid])) now[pid].touched = { at, device };
      }
    }
  }
  return out;
}

/** What goes into an export or a sync file: the state plus when and from where. */
export function snapshot(state, device = null) {
  return {
    ...state,
    exportedAt: new Date().toISOString(),
    savedAt: state?.savedAt ?? Date.now(),
    device: device ?? state?.sync?.device ?? null,
  };
}

// ------------------------------------------------------------------- merge
//
// Two devices, one file in a shared folder, no server. A blind last-write-wins
// on the whole blob would silently throw away the bans she added on her phone
// while he was looking at the week on his laptop. So the durable things are
// UNIONED and only the week itself is last-write-wins:
//
//   banned / favourites   union — "never again" must survive from either side
//   ratings / notes       newest file wins per recipe
//   stats                 max of each count, so neither side's learning is lost
//   custom recipes        union by id
//   pantry                union, keeping the larger amount of each staple
//   bought                union of what is already in the trolley
//   weights               union by date
//   plan / settings       whichever file was saved later
//
// This is not a CRDT and does not pretend to be: simultaneous edits to the SAME
// recipe's note will keep one of them. It is the right amount of machinery for
// two people and one week.

const newer = (a, b) => (Number(b?.savedAt ?? 0) > Number(a?.savedAt ?? 0));
const unionArr = (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])];
const maxCounts = (a, b) => {
  const out = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = Math.max(Number(out[k] ?? 0), Number(v) || 0);
  return out;
};
const unionFlags = (a, b) => {
  const out = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) if (v) out[k] = true;
  return out;
};

// --- deletions
//
// A union can only ever say "and also this". It cannot say "not that any more", so
// before v4 un-banning a recipe on one device was undone by the other on the next
// sync, and so was un-ticking a shopping item and deleting one of your own recipes.
// A removal is a fact and has to be stored as one.
//
// `memory.removed` holds `{ id: when }` per bucket. A removal wins unless the id is
// back on a side that was saved later -- that side's own `savedAt` being the best
// evidence available for when it got there, since the lists themselves carry no
// per-id clock. Coarse, and right for the case that exists: two people, two devices.

/** Keep the later of two removals, and drop anything that cannot be compared. */
const removedUnion = (a, b) => {
  const out = {};
  for (const side of [a, b]) {
    for (const [k, v] of Object.entries(side ?? {})) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = Math.max(out[k] ?? 0, n);
    }
  }
  return out;
};

/** `sides` are the two copies: who still lists the id, and when they last saved. */
const survives = (id, removed, sides) => {
  const gone = Number(removed?.[id] ?? 0);
  if (!gone) return true;
  const claimed = Math.max(0, ...sides.filter((s) => s.has.has(id)).map((s) => s.at));
  return claimed > gone;
};

/**
 * The pantry holds amounts, not flags: "500 g of rice" has to survive a merge as
 * 500, not collapse to true. Where both sides claim a different amount the larger
 * wins, because the cupboard is shared and the higher figure is the one somebody
 * actually counted.
 */
const amount = (v) => (Number(v) > 0 ? Number(v) : (v ? 1 : 0));
const unionAmounts = (a, b) => {
  const out = {};
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const best = Math.max(amount(a?.[k]), amount(b?.[k]));
    if (best > 0) out[k] = best;
  }
  return out;
};

// --- the week itself
//
// Resolving the whole plan last-write-wins sounds conservative and is not: they share
// one week, so "both touched it" is the normal case, and somebody's afternoon was
// thrown away every time. Entries carry a `touched` stamp written by store.save(),
// and the merge runs per plate.

/** The merge key. Exported because it is the thing the whole merge turns on. */
export const planAddress = (day, slot, person) => `${day}|${slot}|${person ?? '*'}`;

const stampAt = (e) => Number(e?.touched?.at ?? 0);

/**
 * Merge two copies of the SAME week, plate by plate. Different ids mean two
 * independently generated weeks, and those cannot be reconciled: cell-merging them
 * would invent a week neither person chose, with leftovers chaining to meals that
 * were never cooked. So the later one wins entire and the other person is told.
 */
function mergePlans(mine, theirs, remoteWins) {
  const base = remoteWins ? theirs : mine;
  const other = remoteWins ? mine : theirs;
  const mergeable = Boolean(mine?.id) && mine.id === theirs?.id
    && Array.isArray(mine.days) && Array.isArray(theirs.days);
  if (!mergeable) {
    // Only worth saying when there genuinely were two different weeks. A device with
    // no plan yet, or one whose week predates ids, is not a conflict -- it is a
    // first sync, and announcing one would be alarming for no reason.
    const clash = Boolean(mine?.id) && Boolean(theirs?.id) && mine.id !== theirs.id;
    // Which way it went changes what the person needs to know: that their week was
    // just replaced, or that the other person's is about to be.
    const note = remoteWins
      ? 'The other device had generated a different week, and theirs was the newer one, so it replaced the week here. Your bans, ticks, ratings, notes, your own recipes and your weight log were all kept.'
      : 'The other device had generated a different week. Yours is the newer one, so it is the week being kept — theirs will be replaced the next time they sync.';
    return { plan: base ?? null, note: clash ? note : null };
  }
  const out = JSON.parse(JSON.stringify(base));
  for (let i = 0; i < out.days.length; i++) {
    for (const slot of SLOT_KEYS) {
      const keep = out.days[i]?.[slot];
      const challenger = other.days?.[i]?.[slot];
      if (!keep || !challenger) continue;
      // One side holds a shared entry and the other a per-person map: that is a
      // different shape of day, and half-merging it would leave one person without
      // a meal. Keep the winner's whole slot.
      if (isEntry(keep) !== isEntry(challenger)) continue;
      if (isEntry(keep)) {
        if (stampAt(challenger) > stampAt(keep)) out.days[i][slot] = challenger;
        continue;
      }
      for (const pid of Object.keys(challenger)) {
        if (!keep[pid] || stampAt(challenger[pid]) > stampAt(keep[pid])) {
          out.days[i][slot][pid] = challenger[pid];
        }
      }
    }
  }
  return { plan: out, note: null };
}

export function mergeStates(mine, theirs) {
  if (!theirs || typeof theirs !== 'object') return mine;
  const remoteWins = newer(mine, theirs);
  const a = mine.memory ?? {};
  const b = theirs.memory ?? {};
  const mineAt = Number(mine.savedAt ?? 0);
  const theirsAt = Number(theirs.savedAt ?? 0);
  const removed = pruneRemoved({
    banned: removedUnion(a.removed?.banned, b.removed?.banned),
    favourites: removedUnion(a.removed?.favourites, b.removed?.favourites),
    custom: removedUnion(a.removed?.custom, b.removed?.custom),
    bought: removedUnion(a.removed?.bought, b.removed?.bought),
  });

  const sidesOf = (x, y) => [
    { has: new Set(x ?? []), at: mineAt },
    { has: new Set(y ?? []), at: theirsAt },
  ];
  const live = (ids, bucket, sides) => ids.filter((id) => survives(id, removed[bucket], sides));

  const customById = new Map();
  for (const r of [...(a.custom ?? []), ...(b.custom ?? [])]) if (r?.id) customById.set(r.id, r);
  const customSides = sidesOf((a.custom ?? []).map((r) => r?.id), (b.custom ?? []).map((r) => r?.id));

  const boughtSides = sidesOf(
    Object.keys(mine.bought ?? {}).filter((k) => mine.bought[k]),
    Object.keys(theirs.bought ?? {}).filter((k) => theirs.bought[k]),
  );
  const bought = {};
  for (const k of Object.keys(unionFlags(mine.bought, theirs.bought))) {
    if (survives(k, removed.bought, boughtSides)) bought[k] = true;
  }

  const weightsByDate = new Map();
  for (const w of [...(mine.weights ?? []), ...(theirs.weights ?? [])]) if (w?.date) weightsByDate.set(w.date, w);

  const week = mergePlans(mine.plan, theirs.plan, remoteWins);

  return migrate({
    ...(remoteWins ? theirs : mine),
    plan: week.plan,
    mergeNote: week.note,
    memory: {
      banned: live(unionArr(a.banned, b.banned), 'banned', sidesOf(a.banned, b.banned)),
      favourites: live(unionArr(a.favourites, b.favourites), 'favourites', sidesOf(a.favourites, b.favourites)),
      ratings: remoteWins ? { ...a.ratings, ...b.ratings } : { ...b.ratings, ...a.ratings },
      notes: remoteWins ? { ...a.notes, ...b.notes } : { ...b.notes, ...a.notes },
      stats: {
        away: maxCounts(a.stats?.away, b.stats?.away),
        kept: maxCounts(a.stats?.kept, b.stats?.kept),
      },
      custom: [...customById.values()].filter((r) => survives(r.id, removed.custom, customSides)),
      pantry: unionAmounts(a.pantry, b.pantry),
      removed,
    },
    bought,
    itemShop: remoteWins ? { ...mine.itemShop, ...theirs.itemShop } : { ...theirs.itemShop, ...mine.itemShop },
    weights: [...weightsByDate.values()].sort((x, y) => x.date.localeCompare(y.date)),
    // The tab you are looking at is not shared data.
    ui: mine.ui,
    sync: { ...(mine.sync ?? {}), at: Date.now() },
  });
}

// ------------------------------------------------------------- weight log
/** Newest first, de-duplicated by date, so two entries on one day do not both count. */
export function addWeight(weights, entry) {
  const rest = weights.filter((w) => w.date !== entry.date);
  return [...rest, entry].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Trend over the log, in kg/week. Uses first vs last over the elapsed days
 * rather than a fit, because with a handful of points a fit just invents precision.
 */
export function weightTrend(weights, personId) {
  const pts = weights.filter((w) => typeof w[personId] === 'number');
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const days = (new Date(b.date) - new Date(a.date)) / 86400000;
  if (days <= 0) return null;
  return { kgPerWeek: ((b[personId] - a[personId]) / days) * 7, days, from: a[personId], to: b[personId] };
}
