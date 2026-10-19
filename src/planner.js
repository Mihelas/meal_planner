// The planner engine.
//
// Builds a whole week for two people with different calorie targets out of ONE
// cooking session per evening. The three ideas that make it work:
//
//   1. Dinner is chosen first and cooked big. Tomorrow's lunch is the same pot.
//      That is the anti-pizza mechanism: at 12:30 the food already exists.
//   2. Portions, not different meals. The second person eats ~0.68 of the first's
//      portion off the same tray -- derived, see targets.portionRatio.
//   3. The day mode decides lunch. Office -> a canteen card with what to pick,
//      because there is no kitchen. WFH / together -> the leftovers.
//
// Everything is a pure function of (settings, memory, previousPlan). No dates, no
// clock, no randomness that isn't seeded — so a reload shows the same week, and a
// test can assert on it.

import {
  DEFAULT_PEOPLE, dayTarget, proteinFloor, slotBudget, portionRatio, SAFE_FLOOR_KCAL,
  KCAL_PER_KG_FAT,
} from './targets.js';
import { RECIPES, bySlot, recipeById, DEFAULT_SHOPS } from './recipes.js';
import { seasonPenalty, currentMonth, isMonth } from './seasons.js';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The week need not begin on Monday, and almost nothing in the app has to know.
 *
 * Days are indexed by POSITION everywhere: `plan.days[2]` is the third day of
 * the week, `day.index` is 2, so is that day's entry in `dayModes` and the
 * number in a plate's DOM id, and the leftover chain still reads "position 3
 * eats what position 2 cooked". That is what keeps the swap, the batch chain,
 * the plan id and the merge out of this entirely — they are all about order,
 * and the order is unchanged.
 *
 * `weekStart` only decides which weekday position 0 lands on, so only two kinds
 * of thing consult it: what a day is called, and the handful of rules that are
 * genuinely about the calendar — the 30-minute cap and the weekend tag.
 */
export const weekStartOf = (settings) => {
  const w = settings?.weekStart;
  return Number.isInteger(w) && w >= 0 && w <= 6 ? w : 0;
};

/** The real weekday (0 = Mon) that a position in the week falls on. */
export const weekdayOf = (settings, position) => (weekStartOf(settings) + position) % 7;

/** What that position is called. */
export const dayName = (settings, position) => DAYS[weekdayOf(settings, position)];

/**
 * What to call a position in a note or a heading. The day already carries its
 * own name, so a note never has to be told where the week starts; the fallback
 * is for a stale index arriving from a DOM id after the plan was rebuilt.
 */
export const dayLabel = (plan, position) => plan?.days?.[position]?.name ?? DAYS[position % 7];
export const DAY_MODES = ['wfh', 'office', 'together'];
export const SLOT_KEYS = ['breakfast', 'lunch', 'dinner', 'snackAfternoon', 'snackEvening'];
export const COOKING_STYLES = ['daily', 'batch'];
// Bumped for v2: days carry cook sessions and entries can be kind 'batch' or
// 'off-plan', so a v1 plan would render with holes in it. store.migrate drops it.
export const PLAN_VERSION = 2;
export const MAX_DAY_ADJUST = 250;
/**
 * How close to a day's target counts as being on it.
 *
 * Portions move in quarters, so no day lands exactly. This is the resolution of the
 * whole system: trimToTarget stops here, and rebalanceWeek will not react to a weekly
 * drift that is inside it, because a day already this close is one the reflow would
 * then decline to touch -- we would write an adjustment, nothing would move, and the
 * week would report itself as corrected. One number, used at both ends, so the two
 * cannot drift apart.
 */
export const TARGET_TOLERANCE = 0.04;

/**
 * The smallest surplus the remaining days could actually absorb between them.
 *
 * Measured per remaining day, not per week: a surplus logged on Thursday has three days
 * to go into, and judging it against a seven-day allowance would let a real blowout pass
 * as rounding. Per-day also keeps this honest for two people whose days differ by 700
 * kcal -- a quarter portion is a much bigger share of hers than of his.
 */
export const rebalanceDeadband = (dayTargetKcal, daysLeft) =>
  TARGET_TOLERANCE * dayTargetKcal * daysLeft;

/** Which recipe category fills each slot of the day. */
const SLOT_SOURCE = {
  breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner',
  snackAfternoon: 'snack', snackEvening: 'snack',
};

// The evening snack gets the bigger share: 22:00 is when the plan is actually tested.
const SNACK_SPLIT = { snackAfternoon: 0.45, snackEvening: 0.55 };

const WEEKDAYS = [0, 1, 2, 3, 4];
const POST_FOOTBALL_MAX_MINUTES = 10;

/**
 * The caption under a day's mode buttons.
 *
 * A function rather than the constant this used to be, because the captions
 * name the people and a household names its own. It was a hardcoded object
 * naming one particular household's members, which read as nonsense for every
 * other household that installed the app.
 *
 * Index 0 is the one who goes to the canteen, matching generateWeek below:
 * `office` replaces that person's lunch and nobody else's.
 */
export function dayModeLabel(settings, mode) {
  const [a, b] = settings?.people ?? DEFAULT_PEOPLE;
  if (mode === 'wfh') return `${a.name} @ home, ${b.name} out`;
  if (mode === 'office') return `${a.name} @ office (Kantine)`;
  if (mode === 'together') return 'Both @ home';
  return '';
}

/** Canteen cards: what to build a tray out of, rather than a recipe we cannot cook. */
const CANTEEN_CARDS = [
  'Kantine: take the grilled protein (chicken, fish or Schnitzel without the breading), a double portion of vegetables or salad, and ONE starch portion. Skip the sauce boat and the dessert.',
  'Kantine: build the plate from the salad bar — leaves, plus every protein on offer (egg, tuna, chicken, beans, cheese) — and take bread on the side rather than dressing on top.',
  'Kantine: Tagesgericht is fine if you ask for the sauce beside it, then swap the fries for potatoes, rice or salad. Add a Quark or a yoghurt from the fridge for the protein.',
  'Kantine: soup plus a second protein (Putenbrust roll, boiled eggs or a Quark) beats any single main. Fill the rest with whatever raw vegetables they have.',
  'Kantine: if the only hot options are heavy, eat half the starch, all the protein, all the vegetables, and top up with a Skyr or Magerquark from the fridge.',
];

const EAT_OUT_CARDS = [
  'Eating out: pick the grilled or roasted protein dish, ask for vegetables or salad instead of half the starch, drink water or Cola Zero, and skip the bread basket — not the meal. This slot is budgeted for, so enjoy it.',
  'Eating out: starter-plus-main from the lighter half of the menu, or a main and share a dessert. Nothing is off limits here; this is the meal the rest of the week makes room for.',
  'Eating out: whatever you like, but order it with a salad or vegetable side and stop at one round of anything fried. The budget below is what a normal restaurant main actually costs.',
];

// --------------------------------------------------------------- seeded RNG
/** mulberry32 — tiny, deterministic, good enough for shuffling a menu. */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ settings
export function defaultSettings() {
  return {
    version: PLAN_VERSION,
    seed: 20260930,
    people: DEFAULT_PEOPLE.map((p) => ({ ...p, exerciseKcalByDay: [...p.exerciseKcalByDay] })),
    // ~2 office days, but every single day is switchable in the UI.
    dayModes: ['office', 'wfh', 'office', 'wfh', 'wfh', 'together', 'together'],
    // Which weekday the displayed week begins on (0 = Mon). Everything else
    // stays indexed by position, so this is the only field that names a weekday.
    weekStart: 0,
    footballDay: 4,
    // The two meals out, in the plan on purpose rather than as a weekly surprise.
    eatOut: [{ day: 5, slot: 'dinner' }, { day: 6, slot: 'lunch' }],
    // How many of the seven days this kitchen cooks meatless. A count, not a
    // list: which days is derived, so it follows the match night, the evenings
    // out and the week start on its own.
    vegetarianDays: 3,
    // 'daily' = cook each evening. 'batch' = two sessions cover the week.
    cookingStyle: 'daily',
    // The first and fourth day of the week, not the last: a cook-up on the final
    // day would be cooking for a week this plan does not cover.
    cookDays: [0, 3],
    // Which days the shopping list is for. The whole week by default; cut it
    // down when a trip only has to cover a few days.
    shoppingDays: [0, 1, 2, 3, 4, 5, 6],
    shops: DEFAULT_SHOPS.map((s) => ({ ...s, aisles: [...s.aisles] })),
    // Per-day, per-person kcal corrections, written by the off-plan rebalancer.
    adjust: [{}, {}, {}, {}, {}, {}, {}],
    // null = follow the real calendar. A fixed month exists so tests are stable.
    month: null,
    useSeason: true,
  };
}

/** The month seasonality should score against. */
export const planMonth = (settings) => (isMonth(settings?.month) ? settings.month : currentMonth());

/**
 * The kcal target for one person on one day, including any rebalance correction.
 * The safety floor is re-applied here, because an adjustment must never be able
 * to push a day below what is safe to eat, however much was eaten on Saturday.
 */
export function targetFor(person, settings, dayIndex) {
  const base = dayTarget(person, { exerciseKcal: person.exerciseKcalByDay[dayIndex] ?? 0 });
  const adj = settings.adjust?.[dayIndex]?.[person.id] ?? 0;
  return Math.max(SAFE_FLOOR_KCAL[person.sex], base + adj);
}

// --------------------------------------------------------------- portioning
/**
 * How many portions of `recipe` this person eats to fill `budget` kcal.
 * Quarter steps only, and never outside 0.5-1.5 — past that it stops being a
 * portion and starts being a lie about what is on the plate.
 */
export function portionsFor(recipe, budget) {
  const raw = budget / recipe.kcal;
  const stepped = Math.round(raw * 4) / 4;
  return Math.min(1.5, Math.max(0.5, stepped));
}

function entryFromRecipe(recipe, budgets, eaters, extra = {}) {
  const portions = {}; const kcal = {}; const protein = {};
  for (const p of eaters) {
    const n = portionsFor(recipe, budgets[p]);
    portions[p] = n;
    kcal[p] = Math.round(recipe.kcal * n);
    protein[p] = Math.round(recipe.protein * n);
  }
  return {
    slot: recipe.slot, kind: 'recipe', recipeId: recipe.id, from: null,
    locked: false, note: null, portions, kcal, protein, ...extra,
  };
}

function guidanceEntry(kind, note, budgets, proteinBudgets, eaters, slot) {
  const portions = {}; const kcal = {}; const protein = {};
  for (const p of eaters) {
    portions[p] = 1;
    kcal[p] = budgets[p];
    protein[p] = proteinBudgets[p];
  }
  return { slot, kind, recipeId: null, from: null, locked: false, note, portions, kcal, protein };
}

// ------------------------------------------------------------------ budgets
/** Per-person kcal/protein allowance for every slot of every day. */
function budgetTable(settings) {
  const table = [];
  for (let i = 0; i < 7; i++) {
    const row = { kcal: {}, protein: {} };
    for (const person of settings.people) {
      const b = slotBudget(targetFor(person, settings, i), proteinFloor(person));
      for (const key of SLOT_KEYS) {
        const src = SLOT_SOURCE[key];
        const share = key.startsWith('snack') ? SNACK_SPLIT[key] : 1;
        row.kcal[key] = row.kcal[key] || {};
        row.protein[key] = row.protein[key] || {};
        row.kcal[key][person.id] = Math.round(b.kcal[src] * share);
        row.protein[key][person.id] = Math.round(b.protein[src] * share);
      }
    }
    table.push(row);
  }
  return table;
}

// ----------------------------------------------------------------- scoring
/**
 * How well a recipe fits a slot: calorie miss plus a penalty for falling short
 * on protein. Lower is better. Scored against the first person, who is the
 * reference portion; the second's is derived from the same pot.
 */
function fitScore(recipe, kcalBudget, proteinBudget) {
  const n = portionsFor(recipe, kcalBudget);
  const kcalMiss = Math.abs(recipe.kcal * n - kcalBudget) / kcalBudget;
  const proteinGap = Math.max(0, proteinBudget - recipe.protein * n) / Math.max(1, proteinBudget);
  return kcalMiss + proteinGap * 1.5;
}

export const RATING_WEIGHT = 0.12;
export const SWAP_AWAY_WEIGHT = 0.10;
export const KEPT_WEIGHT = 0.06;
export const PANTRY_WEIGHT = 0.18;

/**
 * Everything we have learned about a recipe, as a penalty added to its fit score.
 * Positive is worse. Deliberately an order of magnitude smaller than a calorie
 * miss: preference reorders options that are all on budget, it never buys a
 * recipe that does not fit the day.
 *
 *   rating      an explicit 1-5. 3 is neutral, 5 pulls it forward, 1 pushes it back.
 *   swapped away  you replaced it without banning it, which is a soft "not that".
 *   kept        it survived a whole week on the board. Capped, so one favourite
 *               cannot take over the menu.
 *   pantry      fraction of its ingredients you already have. Uses up what is open.
 *   season      German seasonality, from the ingredient list (see seasons.js).
 */
export function preferencePenalty(recipe, memory = {}, opts = {}) {
  const rating = memory.ratings?.[recipe.id];
  const away = memory.stats?.away?.[recipe.id] ?? 0;
  const kept = memory.stats?.kept?.[recipe.id] ?? 0;

  let p = 0;
  if (Number.isFinite(rating) && rating >= 1 && rating <= 5) p += (3 - rating) * RATING_WEIGHT;
  p += Math.min(away, 4) * SWAP_AWAY_WEIGHT;
  p -= Math.min(kept, 3) * KEPT_WEIGHT;

  const pantry = opts.pantry;
  if (pantry && recipe.ingredients?.length) {
    const have = recipe.ingredients.filter((i) => pantry[pantryKey(i)]).length;
    p -= (have / recipe.ingredients.length) * PANTRY_WEIGHT;
  }
  if (opts.month) p += seasonPenalty(recipe, opts.month);
  return p;
}

/**
 * The pantry and the shopping list have to agree on what an item IS, or ticking
 * "I have olive oil" would never match the olive oil on the list. Both derive
 * their key from name + unit through this one function.
 */
export const pantryKey = (ing) => `${String(ing.item).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${ing.unit}`;

/**
 * The key `pantryKey` produced before it learned to transliterate. Kept only so
 * `migrate()` can move an existing cupboard across; nothing else should use it.
 */
export const legacyPantryKey = (ing) => `${String(ing.item).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${ing.unit}`;

const totalScore = (r, kcal, protein, memory, opts) =>
  fitScore(r, kcal, protein) + preferencePenalty(r, memory, opts);

/**
 * How many of the best-fitting candidates to pick from.
 *
 * This used to be a flat 5, which quietly capped variety at five recipes per slot
 * no matter how big the library got -- the same five kept winning every re-roll.
 * A quarter of the pool scales with the library; the floor keeps a thin slot from
 * becoming deterministic; the ceiling keeps it a shortlist rather than a lottery,
 * because the point of ranking is that the worst fits do not reach the plate.
 */
export const poolSizeFor = (n) => Math.max(0, Math.min(n, 12, Math.max(5, Math.round(n / 4))));

/** Pick from the best-fitting few, so the week varies without going off-budget. */
function choose(candidates, kcalBudget, proteinBudget, rand, memory = {}, opts = {}) {
  if (candidates.length === 0) return null;
  // Score once, then sort. Scoring inside the comparator re-walked every
  // ingredient list O(n log n) times per slot, which is most of the cost of
  // generating a week and gets worse as the library grows.
  const ranked = candidates
    .map((r) => ({ r, score: totalScore(r, kcalBudget, proteinBudget, memory, opts) }))
    .sort((a, b) => a.score - b.score);
  const pool = ranked.slice(0, poolSizeFor(ranked.length));
  return pool[Math.floor(rand() * pool.length)].r;
}

// -------------------------------------------------------------- candidates
const isBanned = (memory, id) => (memory?.banned ?? []).includes(id);

// --- removals
//
// A list can only ever say "and also this". The sync merge has to be able to say "not
// that any more" too, or un-banning a recipe on one device is undone by the other on
// the next sync -- which is what happened before v4. So every removal leaves a dated
// note behind in `memory.removed`, and putting the thing back rubs the note out.
//
// Here rather than in store.js because swap.js needs them and is built before it.

const REMOVED_EMPTY = { banned: {}, favourites: {}, custom: {}, bought: {} };
const removedBuckets = (memory) => {
  const r = memory?.removed && typeof memory.removed === 'object' ? memory.removed : {};
  const out = {};
  for (const k of Object.keys(REMOVED_EMPTY)) out[k] = (r[k] && typeof r[k] === 'object') ? { ...r[k] } : {};
  return out;
};

/** Record that `id` was taken out of `bucket`, with when. */
export function forget(memory, bucket, id, at = Date.now()) {
  const removed = removedBuckets(memory);
  removed[bucket] = { ...removed[bucket], [id]: at };
  return { ...memory, removed };
}

/** It is back. Drop the note, or the other device will delete it again. */
export function remember(memory, bucket, id) {
  const removed = removedBuckets(memory);
  if (!(id in removed[bucket])) return memory;
  delete removed[bucket][id];
  return { ...memory, removed };
}

const eatOutAt = (settings, day, slot) => (settings.eatOut ?? [])
  .some((o) => o.day === day && o.slot === slot);

/** The whole week, in principle, though two days of it can never qualify. */
export const MAX_VEGETARIAN_DAYS = 7;

/**
 * Which positions in the week this kitchen cooks meatless.
 *
 * Derived rather than stored, which is the whole design: only the count is a
 * setting, so the choice follows the match night, the evenings out and the week
 * start with nothing to migrate -- and a swap made on Tuesday honours the same
 * rule the generator did, because both of them ask this function.
 *
 * Two days can never be vegetarian. The match night draws from the reserved
 * post-football handful, and a night the dinner is eaten out has no kitchen to
 * make meatless. So the count is of days this kitchen actually cooks, and asking
 * for more than there are gets every one it can.
 */
export function vegetarianDaysOf(settings) {
  const asked = Math.trunc(Number(settings?.vegetarianDays));
  const want = Number.isFinite(asked) ? Math.min(Math.max(asked, 0), MAX_VEGETARIAN_DAYS) : 0;
  if (!want) return [];
  const eligible = [];
  for (let i = 0; i <= 6; i++) {
    if (i === settings.footballDay) continue;
    if (eatOutAt(settings, i, 'dinner')) continue;
    eligible.push(i);
  }
  if (want >= eligible.length) return eligible;
  if (settings.cookingStyle === 'batch') return batchVegetarianDays(settings, eligible, want);
  // Spread in REAL weekday order, not in position order. Start the week on
  // Thursday and the positions all move, but the promise setWeekStart makes
  // about every other day-indexed setting is that the real day keeps what was
  // chosen for it -- so Tuesday has to stay the meatless one, not whatever now
  // sits where Tuesday used to.
  eligible.sort((a, b) => weekdayOf(settings, a) - weekdayOf(settings, b));
  // Sampled at the middle of each band rather than at its start, so three days
  // out of five come out spread (1, 3, 6) instead of bunched (0, 2, 3). The
  // seeded rotation is what stops it being the same three days every week.
  const step = eligible.length / want;
  const offset = Math.floor(rng(settings.seed ^ 0x7f4a7c15)() * eligible.length);
  const picked = [];
  for (let k = 0; k < want; k++) {
    picked.push(eligible[(Math.round(k * step + step / 2) + offset) % eligible.length]);
  }
  return picked.sort((a, b) => a - b);
}

/**
 * The same question for a batch week, where it has a different answer.
 *
 * In batch mode a day's dinner is not its own: one pot is cooked at the session
 * and reheated until the next one. So a vegetarian pot makes its whole span
 * meatless and a meat pot makes its whole span meaty -- there is no third answer,
 * because there is only one pot. Picking three scattered days would either hand a
 * vegetarian pot to the four days that asked for meat (three asked for, a wholly
 * vegetarian week delivered) or make those three days cook fresh, which is a
 * five-cook week wearing a batch week's name.
 *
 * So the choice is made in whole sessions, and the count is honoured as closely
 * as the sessions allow: ask for two with sessions on Monday and Thursday and you
 * get the Monday session, which is three days. Asking for any at all always gets
 * at least one session, because "some" never means "none". The Settings page
 * names the days it picked, so the rounding is never a mystery.
 */
function batchVegetarianDays(settings, eligible, want) {
  const sessions = cookSessions(settings);
  const spans = sessions
    .map((start, k) => eligible.filter((d) => d >= start && d < (sessions[k + 1] ?? 7)))
    .filter((days) => days.length);
  if (!spans.length) return [];
  // Every combination of sessions, scored on how near it lands to the number
  // asked for. Taking sessions greedily in order is not good enough: with a
  // three-day session and a two-day one, asking for three has an exact answer and
  // greedy takes the two-day one first and stops at two. There are at most seven
  // sessions in a week, so checking all of them costs nothing.
  const combos = [];
  for (let mask = 1; mask < (1 << spans.length); mask++) {
    const days = spans.filter((_, k) => mask & (1 << k)).flat();
    combos.push({ days, miss: Math.abs(days.length - want) });
  }
  // Ties broken by a seeded rotation, so a week with two equally good answers does
  // not serve the same one every time.
  const rotate = Math.floor(rng(settings.seed ^ 0x7f4a7c15)() * combos.length);
  const best = combos
    .map((_, k) => combos[(k + rotate) % combos.length])
    .reduce((a, b) => (b.miss < a.miss ? b : a));
  return best.days.sort((a, b) => a - b);
}

export const isVegetarianDay = (settings, day) => vegetarianDaysOf(settings).includes(day);

/**
 * Everything we could legitimately put in this slot on this day.
 * `exclude` keeps a swap from handing back something already on the board.
 */
export function slotCandidates(settings, memory, { day, slot }, exclude = []) {
  const src = SLOT_SOURCE[slot];
  // The calendar, not the column: start the week on Thursday and Saturday sits
  // at position 2, where a 45-minute dinner is fine and a working Monday is not.
  const isWeekday = WEEKDAYS.includes(weekdayOf(settings, day));
  const isFootball = day === settings.footballDay;
  const meatless = isVegetarianDay(settings, day);
  return bySlot(src).filter((r) => {
    if (meatless && !r.tags.includes('vegetarian')) return false;
    if (isBanned(memory, r.id) || exclude.includes(r.id)) return false;
    if (isWeekday && r.tags.includes('weekend')) return false;
    if (isWeekday && r.minutes > 30) return false;
    if (slot === 'dinner' && isFootball) {
      return r.tags.includes('post-football') && r.minutes <= POST_FOOTBALL_MAX_MINUTES;
    }
    if (slot === 'dinner' && !isFootball && r.tags.includes('post-football')) return false;
    // The pre-match snack is reserved for Friday: it is timed around kick-off,
    // and spending it on a Tuesday means Friday has nothing left to reach for.
    if (slot === 'snackAfternoon') {
      if (isFootball) return r.tags.includes('pre-football');
      if (r.tags.includes('pre-football')) return false;
    }
    if (slot === 'snackEvening' && r.when === 'afternoon') return false;
    if (slot === 'snackAfternoon' && r.when === 'evening') return false;
    if (slot === 'lunch' && !r.tags.includes('packable') && !r.tags.includes('no-cook')) return false;
    return true;
  });
}

// ---------------------------------------------------------------- generation
/** An entry always carries `kind`; a per-person slot is a plain map of entries. */
export const isEntry = (v) => Boolean(v) && typeof v.kind === 'string';
export const entriesIn = (slotValue) => (isEntry(slotValue) ? [slotValue] : Object.values(slotValue ?? {}));

/**
 * A week's identity, derived from its content rather than from a clock.
 *
 * Two devices that generated from the same seed and the same settings are holding the
 * same week, so they are allowed to merge it cell by cell; a random or clock-based id
 * would call them strangers and throw one of the two away. And because the id is
 * assigned once at generation and never recomputed, editing a meal leaves the week
 * recognisable -- which is precisely what the merge needs to be told.
 *
 * FNV-1a over the recipe on every plate. Not a cryptographic hash and does not need to
 * be: the only question asked of it is "same week or not", between two devices.
 */
export function planId(seed, days) {
  let h = 0x811c9dc5;
  const eat = (text) => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  eat(String(seed));
  days.forEach((d, i) => {
    for (const key of SLOT_KEYS) {
      eat(`|${i}|${key}|`);
      for (const e of entriesIn(d[key])) eat(String(e?.recipeId ?? e?.kind ?? ''));
    }
  });
  return (h >>> 0).toString(36);
}

const lockedEntry = (previous, day, slot, person) => {
  const v = previous?.days?.[day]?.[slot];
  if (!v) return null;
  const e = isEntry(v) ? v : v[person];
  return e && e.locked ? e : null;
};

// -------------------------------------------------------------- batch weeks
/**
 * The cooking sessions, cleaned up: sorted, de-duplicated, inside the week.
 * An empty or nonsense setting falls back to Monday and Thursday.
 */
export function cookSessions(settings) {
  const raw = Array.isArray(settings.cookDays) ? settings.cookDays : [];
  const days = [...new Set(raw.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    .sort((a, b) => a - b);
  return days.length ? days : [0, 3];
}

/**
 * The days the shopping list covers, cleaned up: sorted, de-duplicated, inside
 * the week.
 *
 * A MISSING setting means the whole week, which is both the sane default and
 * what an older stored file needs. An EMPTY ARRAY is a real state the UI can be
 * in - it is what the row looks like halfway through clearing it to pick two
 * days - so it is left alone rather than treated as nonsense.
 */
export function shoppingSlice(settings) {
  const raw = settings?.shoppingDays;
  if (!Array.isArray(raw)) return [0, 1, 2, 3, 4, 5, 6];
  return [...new Set(raw.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    .sort((a, b) => a - b);
}

/**
 * Re-cut the week to start on a different day.
 *
 * Every day-indexed setting is keyed by position, so each one has to travel with
 * the real day it was written for: Monday's office mode stays on Monday, the
 * match stays on Friday, and a correction written against Tuesday stays against
 * Tuesday. Positions shift by the difference between the old start and the new,
 * so arrays gather from where the day used to sit and the settings that hold an
 * index scatter to where it sits now.
 */
export const weekShift = (settings, weekStart) => (weekStart - weekStartOf(settings) + 7) % 7;

export function setWeekStart(settings, weekStart) {
  if (!(Number.isInteger(weekStart) && weekStart >= 0 && weekStart <= 6)) return settings;
  const shift = weekShift(settings, weekStart);
  if (!shift) return { ...settings, weekStart };
  const gather = (arr, fill) => [...Array(7)].map((_, p) => arr?.[(p + shift) % 7] ?? fill());
  const scatter = (i) => (i - shift + 7) % 7;
  return {
    ...settings,
    weekStart,
    dayModes: gather(settings.dayModes, () => 'wfh'),
    adjust: gather(settings.adjust, () => ({})),
    people: settings.people.map((p) => ({
      ...p, exerciseKcalByDay: gather(p.exerciseKcalByDay, () => 0),
    })),
    footballDay: scatter(settings.footballDay),
    cookDays: cookSessions(settings).map(scatter).sort((a, b) => a - b),
    shoppingDays: shoppingSlice(settings).map(scatter).sort((a, b) => a - b),
    eatOut: (settings.eatOut ?? []).map((o) => ({ ...o, day: scatter(o.day) })),
  };
}

/**
 * Move a plan by the same shift, so food travels with the real day it was
 * chosen for. Feed this to generateWeek as the carry-over when the week start
 * changes: a locked Saturday roast is locked to Saturday, not to the third
 * column, and a reheat still points at the day its pot is actually cooked on.
 */
export function rotatePlan(plan, shift) {
  if (!plan?.days || !shift) return plan;
  const scatter = (i) => (i - shift + 7) % 7;
  const move = (v) => {
    if (!v) return v;
    if (!isEntry(v)) return Object.fromEntries(Object.entries(v).map(([k, e]) => [k, move(e)]));
    return Number.isInteger(v.from) ? { ...v, from: scatter(v.from) } : v;
  };
  const days = [...Array(7)].map((_, position) => {
    const was = plan.days[(position + shift) % 7];
    const day = { ...was, index: position };
    for (const key of SLOT_KEYS) day[key] = move(was[key]);
    return day;
  });
  return { ...plan, days };
}

/**
 * Which session feeds day `i`. Any day before the first session has to cook for
 * itself — the alternative is a day with no dinner, which is how a plan gets
 * abandoned. The user's setting is never rewritten to hide this.
 */
export function cookDayFor(i, sessions) {
  let owner = -1;
  for (const d of sessions) if (d <= i) owner = d;
  return owner === -1 ? i : owner;
}

/** How many days after the session this portion gets eaten. */
const gapFrom = (i, cookDay) => i - cookDay;

/**
 * The dinner pool for a batch session. Prefers recipes that are actually built
 * for it, and insists on freezer-safe ones when the session has to stretch past
 * three days, because "it was fine in the fridge since Monday" is not a plan.
 */
function batchPool(pool, span) {
  const needsFreezer = span > 3;
  const ideal = pool.filter((r) => r.tags.includes(needsFreezer ? 'freezes' : 'batch')
    || (!needsFreezer && r.tags.includes('freezes')));
  if (ideal.length) return ideal;
  const keeps = pool.filter((r) => r.tags.includes('leftover-ok'));
  return keeps.length ? keeps : pool;
}

function batchEntry(recipe, cookDay, cookName, dayIndex, budgets, eaters) {
  const e = entryFromRecipe(recipe, budgets, eaters);
  e.kind = 'batch';
  e.from = cookDay;
  const gap = gapFrom(dayIndex, cookDay);
  e.note = gap > 3
    ? `Reheat of ${cookName}'s batch. Freeze this portion on ${cookName} and move it to the fridge the night before — ${gap} days is past what a fridge should hold.`
    : `Reheat of ${cookName}'s batch. Nothing to cook tonight beyond warming it through.`;
  return e;
}

/**
 * Build a week.
 *
 * @param settings  see defaultSettings()
 * @param memory    { banned, ratings, notes, stats, pantry }
 * @param previous  a previous plan; any entry with locked:true is carried over verbatim
 */
export function generateWeek(settings, memory = { banned: [] }, previous = null) {
  const budgets = budgetTable(settings);
  const warnings = [];
  const days = DAYS.map((_, i) => ({
    index: i, name: dayName(settings, i), mode: settings.dayModes[i] ?? 'wfh',
    exerciseKcal: settings.people[0].exerciseKcalByDay[i] ?? 0,
  }));

  const kb = (i, slot) => budgets[i].kcal[slot];
  const pb = (i, slot) => budgets[i].protein[slot];
  // Positional, not named: index 0 is the reference portion and the canteen-goer.
  const refId = settings.people[0].id;
  const otherId = settings.people[1].id;
  const both = [refId, otherId];

  // What we have learned, folded into every choose() below.
  const opts = {
    pantry: memory.pantry,
    month: settings.useSeason === false ? null : planMonth(settings),
  };
  const batching = settings.cookingStyle === 'batch';
  const sessions = cookSessions(settings);

  // Meatless days, and what to do when one of them cannot be served. Relaxing
  // the rule is the LAST rung of every slot's ladder, below the no-repeat list:
  // a repeated snack is a smaller disappointment than a vegetarian Tuesday that
  // turns out to have chicken on it. Whichever days had to give it up are
  // collected and said out loud at the end, never swallowed.
  const veggieDays = vegetarianDaysOf(settings);
  const meatless = (i) => veggieDays.includes(i);
  const anyMeal = { ...settings, vegetarianDays: 0 };
  const relaxed = new Set();
  const relax = (i, slot, exclude = []) => {
    if (!meatless(i)) return [];
    const pool = slotCandidates(anyMeal, memory, { day: i, slot }, exclude);
    if (pool.length) relaxed.add(i);
    return pool;
  };

  // Protein on a meatless day, and why it needs its own accounting.
  //
  // The slot shares add up to the day's floor, so a day that hits every share
  // hits the floor. Out of the full library that happens by itself. In the
  // vegetarian pool the median dish carries about 10 g less, so slot after slot
  // lands a little short and the day finishes 15 g under -- which is the protein
  // floor failing on exactly the days it exists for.
  //
  // The fix is not to force each slot to the richest thing available: with three
  // qualifying vegetarian dinners that would serve the same three every week.
  // Instead each slot is asked for its share PLUS whatever the day is already
  // behind, and credited when it comes in over. The fill order is dinner, lunch,
  // breakfast, then the snacks, and the evening snacks have the most protein
  // headroom in the whole library, so the debt lands where there is room for it.
  //
  // Only the protein ask moves. The kcal budget is untouched, so the deficit this
  // plan exists for is never traded away for a protein number.
  //
  // The running total is read back off the plate rather than reported in by each
  // assignment, so a locked entry, a batch reheat and a packed leftover all count
  // without any of those branches having to remember to say so.
  const FILLED_BEFORE = {
    dinner: [],
    lunch: ['dinner'],
    breakfast: ['dinner', 'lunch'],
    snackAfternoon: ['dinner', 'lunch', 'breakfast'],
    snackEvening: ['dinner', 'lunch', 'breakfast', 'snackAfternoon'],
  };
  /** What a slot actually put in front of someone, however it got there. */
  const servedProtein = (day, slot, person) => {
    const v = day[slot];
    const e = isEntry(v) ? v : v?.[person];
    return e?.protein?.[person] ?? 0;
  };
  /**
   * This slot's protein share for one person, plus whatever their day is behind.
   *
   * Tracked per person rather than off the reference portion alone, because the
   * two portions are not the same multiple of the same dish: a kcal-dense,
   * protein-light recipe cut down to the smaller budget loses more protein than
   * it loses calories, so the smaller eater can finish under their floor on a
   * day the reference portion clears its own.
   */
  const askProtein = (i, slot, person = refId) => {
    const share = pb(i, slot)[person];
    if (!meatless(i)) return share;
    const behind = FILLED_BEFORE[slot]
      .reduce((sum, k) => sum + pb(i, k)[person] - servedProtein(days[i], k, person), 0);
    return Math.max(0, share + behind);
  };
  /**
   * Narrow a meatless day's shortlist to what best serves the ask -- but only
   * once the day has actually fallen behind.
   *
   * Raising the ask is not enough on its own, because choose() picks at random
   * inside the shortlist: five options with one good one still misses four weeks
   * in five. While the day is on budget this is a no-op and the shortlist keeps
   * all of its variety, so the narrowing only ever costs choice on the slots that
   * are paying off a debt.
   *
   * Ranked rather than filtered, which matters more than it sounds. A plain
   * "keep only what clears every ask" filter has to do something when nothing
   * clears it, and falling back to the unfiltered pool means the narrowing stops
   * working on precisely the slots that needed it most -- the ones carrying the
   * whole day's debt. Ranking has no empty case: the best available is always
   * kept, so a slot that cannot close the gap still picks the dish that gets
   * nearest instead of going back to a lottery.
   */
  const meetingAsk = (pool, i, slot, eaters, always = false) => {
    if (!meatless(i)) return pool;
    const asks = eaters.map((p) => ({ p, ask: askProtein(i, slot, p), kcal: kb(i, slot)[p] }));
    if (!always && asks.every(({ p, ask }) => ask <= pb(i, slot)[p])) return pool;
    // How well a dish serves the person it serves worst, as a fraction of what
    // was asked. Capped at 1 so overshooting his ask cannot buy a dish past
    // being short for hers: their portions are different multiples of the same
    // recipe, and a kcal-dense, protein-light dish portioned down to her budget
    // loses more protein than it loses calories.
    const cover = (r) => Math.min(...asks.map(({ ask, kcal }) => (ask <= 0 ? 1
      : Math.min(1, (r.protein * portionsFor(r, kcal)) / ask))));
    const best = Math.max(...pool.map(cover));
    // Everything that covers the ask, or near enough -- and when nothing comes
    // close, everything tied at whatever the pool's best is.
    return pool.filter((r) => cover(r) >= Math.min(best, 0.9));
  };

  // --- Dinners first: they drive the leftovers, so they cannot be an afterthought.
  const dinnerRand = rng(settings.seed);
  const usedDinners = [];
  for (const d of days) {
    const i = d.index;
    if (eatOutAt(settings, i, 'dinner')) {
      const card = EAT_OUT_CARDS[i % EAT_OUT_CARDS.length];
      d.dinner = guidanceEntry('eat-out', card, kb(i, 'dinner'), pb(i, 'dinner'), both, 'dinner');
      continue;
    }
    const held = lockedEntry(previous, i, 'dinner');
    if (held) {
      d.dinner = { ...held };
      if (held.recipeId) usedDinners.push(held.recipeId);
      continue;
    }

    // In batch mode only the session days cook; the rest reheat what that session
    // made. Which also quietly solves Friday: getting in at 22:00 to a reheat is
    // the best possible version of that evening.
    const owner = batching ? cookDayFor(i, sessions) : i;
    if (batching && owner !== i) {
      const source = days[owner]?.dinner;
      if (source && source.recipeId) {
        const r = recipeById(source.recipeId);
        if (r && (!meatless(i) || r.tags.includes('vegetarian'))) {
          d.dinner = batchEntry(r, owner, days[owner].name, i, kb(i, 'dinner'), both); continue;
        }
      }
      // Either the session produced no recipe (all banned, or a card), or what it
      // made has meat in it and this is a meatless day. Fall through and cook for
      // this day rather than serve an empty card or break the promise.
    }

    let pool = slotCandidates(settings, memory, { day: i, slot: 'dinner' }, usedDinners);
    if (batching) {
      // How many days this session has to cover, so we know whether the freezer
      // is involved.
      const nextSession = sessions.find((x) => x > i);
      const span = (nextSession === undefined ? 7 : nextSession) - i;
      pool = batchPool(pool, span);
    } else if (needsLeftoverTomorrow(settings, i)) {
      // If tomorrow's lunch is meant to come out of tonight's pot, insist on a
      // dinner that keeps. The anti-pizza mechanism, so it is a rule, not luck.
      const keeps = pool.filter((r) => r.tags.includes('leftover-ok'));
      if (keeps.length) pool = keeps;
    }
    if (!pool.length) pool = relax(i, 'dinner', usedDinners);
    const dinnerAsk = askProtein(i, 'dinner');
    // A batch pot is served every day of its span, so it has to clear the share on
    // its own merits: there is no later slot on day three to make up for a thin
    // Monday pot. Hence `always` -- the debt is still zero when the pot is picked,
    // but the shortfall it would cause is not.
    pool = meetingAsk(pool, i, 'dinner', both, batching && cookDayFor(i, sessions) === i);
    const pick = choose(pool, kb(i, 'dinner')[refId], dinnerAsk, dinnerRand, memory, opts);
    if (!pick) {
      warnings.push(`No dinner left for ${d.name} — too many recipes are banned or locked. Un-ban a few in Settings.`);
      d.dinner = guidanceEntry('eat-out', EAT_OUT_CARDS[0], kb(i, 'dinner'), pb(i, 'dinner'), both, 'dinner');
      continue;
    }
    usedDinners.push(pick.id);
    d.dinner = entryFromRecipe(pick, kb(i, 'dinner'), both);
    if (batching) d.cook = { span: (sessions.find((x) => x > i) ?? 7) - i };
  }

  // A batch week that still cooks six nights is a broken promise, so say why
  // rather than quietly handing one over. Both causes are the user's settings,
  // and both have a one-tap fix.
  if (batching) {
    const blocked = sessions.filter((i) => days[i].dinner?.kind !== 'recipe');
    if (blocked.length) {
      warnings.push(`Cook ${blocked.length > 1 ? 'days' : 'day'} ${blocked.map((i) => days[i].name).join(', ')} ${blocked.length > 1 ? 'are' : 'is'} not cooking — ${blocked.length > 1 ? 'those evenings are' : 'that evening is'} eating out. Pick another cook day.`);
    }
    const orphans = days.filter((d) => d.index < sessions[0] && d.dinner?.kind === 'recipe').map((d) => d.name);
    if (orphans.length) {
      warnings.push(`${orphans.join(', ')} ${orphans.length > 1 ? 'come' : 'comes'} before the first cook day (${days[sessions[0]].name}), so ${orphans.length > 1 ? 'they cook' : 'it cooks'} for ${orphans.length > 1 ? 'themselves' : 'itself'}. Move a cook day earlier to fix it.`);
    }
  }

  // --- Lunch: leftovers where there is a fridge, a canteen card where there isn't.
  const lunchRand = rng(settings.seed ^ 0x5bf03635);
  const usedLunches = [];
  for (const d of days) {
    const i = d.index;
    d.lunch = {};
    // The one lunch this day cooks. Both of them eat out of the same kitchen, so
    // a day that has no pot to share - no leftovers, nobody at a canteen - still
    // cooks once and splits it, rather than drawing a recipe each. Seeded from a
    // lock, so an unlocked plate joins a pinned one instead of becoming a second
    // thing to cook.
    let shared = both
      .map((p) => lockedEntry(previous, i, 'lunch', p))
      .find((e) => e?.kind === 'recipe' && e.recipeId);
    shared = shared ? recipeById(shared.recipeId) : null;
    for (const person of both) {
      const held = lockedEntry(previous, i, 'lunch', person);
      if (held) { d.lunch[person] = { ...held }; continue; }

      if (eatOutAt(settings, i, 'lunch')) {
        d.lunch[person] = guidanceEntry('eat-out', EAT_OUT_CARDS[(i + 1) % EAT_OUT_CARDS.length],
          kb(i, 'lunch'), pb(i, 'lunch'), [person], 'lunch');
        continue;
      }
      if (person === refId && d.mode === 'office') {
        d.lunch[person] = guidanceEntry('canteen', CANTEEN_CARDS[i % CANTEEN_CARDS.length],
          kb(i, 'lunch'), pb(i, 'lunch'), [person], 'lunch');
        continue;
      }
      const carried = leftoverSource(days, i);
      // A box of last night's chicken is not a vegetarian lunch. The pool filter
      // cannot see this one: a leftover is copied off the day before, so it has
      // to be refused at the point it would be carried over.
      if (carried && (!meatless(i) || carried.recipe.tags.includes('vegetarian'))) {
        d.lunch[person] = leftoverEntry(carried, days[carried.from].name, i, kb(i, 'lunch'), [person]);
        continue;
      }
      let lunchPool = slotCandidates(settings, memory, { day: i, slot: 'lunch' }, usedLunches);
      if (!lunchPool.length) lunchPool = relax(i, 'lunch', usedLunches);
      const lunchAsk = askProtein(i, 'lunch', person);
      lunchPool = meetingAsk(lunchPool, i, 'lunch', [person]);
      const pick = shared ?? choose(
        lunchPool, kb(i, 'lunch')[person], lunchAsk, lunchRand, memory, opts,
      );
      if (!pick) {
        warnings.push(`No lunch left for ${d.name} — un-ban a lunch recipe or switch the day to Office.`);
        d.lunch[person] = guidanceEntry('canteen', CANTEEN_CARDS[0], kb(i, 'lunch'), pb(i, 'lunch'), [person], 'lunch');
        continue;
      }
      if (!usedLunches.includes(pick.id)) usedLunches.push(pick.id);
      shared = pick;
      d.lunch[person] = entryFromRecipe(pick, kb(i, 'lunch'), [person]);
    }
  }

  // --- Breakfast: fast ones on office mornings, variety across the week.
  const bRand = rng(settings.seed ^ 0x1b873593);
  const usedBreakfasts = [];
  for (const d of days) {
    const i = d.index;
    const held = lockedEntry(previous, i, 'breakfast');
    if (held) { d.breakfast = { ...held }; if (held.recipeId) usedBreakfasts.push(held.recipeId); continue; }
    let pool = slotCandidates(settings, memory, { day: i, slot: 'breakfast' }, usedBreakfasts);
    if (d.mode === 'office') {
      const quick = pool.filter((r) => r.minutes <= 8);
      if (quick.length) pool = quick;
    }
    if (!pool.length) pool = slotCandidates(settings, memory, { day: i, slot: 'breakfast' });
    if (!pool.length) pool = relax(i, 'breakfast');
    const bAsk = askProtein(i, 'breakfast');
    pool = meetingAsk(pool, i, 'breakfast', both);
    const pick = choose(pool, kb(i, 'breakfast')[refId], bAsk, bRand, memory, opts);
    if (!pick) {
      warnings.push('Every breakfast is banned. Un-ban at least one in Settings.');
      d.breakfast = guidanceEntry('canteen', CANTEEN_CARDS[1], kb(i, 'breakfast'), pb(i, 'breakfast'), both, 'breakfast');
      continue;
    }
    usedBreakfasts.push(pick.id);
    d.breakfast = entryFromRecipe(pick, kb(i, 'breakfast'), both);
  }

  // --- Snacks: two a day, afternoon and evening, alternating sweet and savoury
  //     so the 22:00 craving is answered in whichever direction it arrives.
  const sRand = rng(settings.seed ^ 0x27d4eb2f);
  const usedSnacks = [];
  for (const key of ['snackAfternoon', 'snackEvening']) {
    for (const d of days) {
      const i = d.index;
      const held = lockedEntry(previous, i, key);
      if (held) { d[key] = { ...held }; if (held.recipeId) usedSnacks.push(held.recipeId); continue; }
      let pool = slotCandidates(settings, memory, { day: i, slot: key }, usedSnacks);
      if (key === 'snackEvening') {
        const want = i % 2 === 0 ? 'sweet' : 'savoury';
        const leaning = pool.filter((r) => r.tags.includes(want));
        if (leaning.length) pool = leaning;
      }
      if (!pool.length) pool = slotCandidates(settings, memory, { day: i, slot: key });
      if (!pool.length) pool = relax(i, key);
      const sAsk = askProtein(i, key);
      pool = meetingAsk(pool, i, key, both);
      const pick = choose(pool, kb(i, key)[refId], sAsk, sRand, memory, opts);
      if (!pick) {
        warnings.push(`No snack left for ${d.name} ${key === 'snackEvening' ? 'evening' : 'afternoon'} — every snack recipe is banned. Un-ban a few, or the night cravings win.`);
        d[key] = guidanceEntry('eat-out', 'Nothing planned: keep a High-Protein-Pudding or a Harzer in the fridge as the fallback. A banned list this long will cost you the evening.',
          kb(i, key), pb(i, key), both, 'snack');
        continue;
      }
      usedSnacks.push(pick.id);
      d[key] = entryFromRecipe(pick, kb(i, key), both);
    }
  }

  if (relaxed.size) {
    const names = [...relaxed].sort((a, b) => a - b).map((i) => days[i].name);
    warnings.push(`${names.join(', ')} could not be kept vegetarian - there was nothing meatless left to put in every slot. Un-ban some vegetarian recipes, or ask for fewer vegetarian days.`);
  }

  const plan = { version: PLAN_VERSION, id: planId(settings.seed, days), seed: settings.seed, days, warnings };
  return trimToTarget(plan, settings, budgets);
}

/**
 * Does tomorrow's lunch want to be tonight's leftovers? True unless tomorrow is
 * past the end of the week, tomorrow's lunch is a booked meal out, or everyone
 * eating tomorrow is somewhere without a fridge (the canteen-goer at the
 * canteen, with nobody else eating in).
 */
function needsLeftoverTomorrow(settings, i) {
  const t = i + 1;
  if (t > 6) return false;
  if (settings.eatOut.some((o) => o.day === t && o.slot === 'lunch')) return false;
  return true; // she always packs a lunch, so there is always a taker
}

/**
 * Yesterday's dinner, if it was cooked and is safe to carry.
 * A batch reheat counts: the food exists in the same quantity, and the box for
 * lunch comes off the same tray.
 */
function leftoverSource(days, i) {
  const prev = days[i - 1];
  if (!prev || !prev.dinner) return null;
  if (prev.dinner.kind !== 'recipe' && prev.dinner.kind !== 'batch') return null;
  const r = recipeById(prev.dinner.recipeId);
  return r && r.tags.includes('leftover-ok') ? { recipe: r, from: i - 1 } : null;
}

function leftoverEntry({ recipe, from }, fromName, i, budgets, eaters) {
  const e = entryFromRecipe(recipe, budgets, eaters);
  e.kind = 'leftover';
  e.slot = 'lunch';
  e.from = from;
  e.note = `Already cooked — this is ${fromName}'s dinner. Portion it into a box the moment you serve dinner, not the next morning.`;
  return e;
}

/** Visit every entry in the week, whichever shape its slot has. */
export function forEachEntry(plan, fn) {
  plan.days.forEach((d, i) => {
    for (const key of SLOT_KEYS) {
      const v = d[key];
      if (isEntry(v)) fn(v, i, key, null);
      else for (const pid of Object.keys(v ?? {})) fn(v[pid], i, key, pid);
    }
  });
}

/**
 * Refill exactly one slot and leave the rest of the week alone.
 *
 * Used when a day mode changes: flipping Wednesday to Office must turn that one
 * lunch into a canteen card without re-rolling six dinners the user already
 * swapped. Implemented by freezing the whole week, unfreezing the target, and
 * letting the same tested generator run — so there is no second code path that
 * can disagree with generateWeek about what is valid.
 */
export function regenerateSlot(plan, settings, memory, { day, slot, person = null }) {
  const frozen = JSON.parse(JSON.stringify(plan));
  const wasLocked = new Map();
  forEachEntry(frozen, (e, i, key, pid) => {
    wasLocked.set(`${i}|${key}|${pid}`, e.locked === true);
    const hit = i === day && key === slot && (person === null || pid === null || pid === person);
    e.locked = !hit;
  });
  const next = generateWeek(settings, memory, frozen);
  forEachEntry(next, (e, i, key, pid) => { e.locked = wasLocked.get(`${i}|${key}|${pid}`) ?? false; });
  next.warnings = plan.warnings ?? [];
  return next;
}

// ------------------------------------------------------------------- totals
export function dayTotals(day) {
  const out = {};
  for (const key of SLOT_KEYS) {
    for (const e of entriesIn(day[key])) {
      if (!e) continue;
      for (const p of Object.keys(e.kcal)) {
        out[p] = out[p] || { kcal: 0, protein: 0 };
        out[p].kcal += e.kcal[p];
        out[p].protein += e.protein[p];
      }
    }
  }
  return out;
}

export function weekTotals(plan) {
  const acc = {};
  for (const d of plan.days) {
    const t = dayTotals(d);
    for (const p of Object.keys(t)) {
      acc[p] = acc[p] || { kcal: 0, protein: 0 };
      acc[p].kcal += t[p].kcal;
      acc[p].protein += t[p].protein;
    }
  }
  return acc;
}

/**
 * Nudge the day onto target.
 *
 * Quarter-portion steps cannot hit an exact number, so after everything is
 * chosen we grow or shrink the snacks (the slot with the least structural
 * meaning) until each person is inside tolerance. Snacks first, then dinner.
 * This is why the daily numbers actually add up rather than "roughly".
 */
function trimToTarget(plan, settings, budgets) {
  const order = ['snackEvening', 'snackAfternoon', 'breakfast', 'dinner'];
  for (const d of plan.days) {
    for (const person of settings.people) {
      // A day with an off-plan meal in it is a record of what happened. Shrinking
      // Tuesday's breakfast at 21:00 to make Tuesday's pizza add up is a lie.
      if (dayHasOffPlan(d, person.id)) continue;
      const target = targetFor(person, settings, d.index);
      for (let pass = 0; pass < 12; pass++) {
        const now = dayTotals(d)[person.id].kcal;
        const off = now - target;
        if (Math.abs(off) / target <= TARGET_TOLERANCE) break;
        const step = off > 0 ? -0.25 : 0.25;
        let moved = false;
        for (const key of order) {
          const e = isEntry(d[key]) ? d[key] : d[key]?.[person.id];
          if (!e || e.kind !== 'recipe' || e.locked) continue;
          const r = recipeById(e.recipeId);
          const next = e.portions[person.id] + step;
          if (next < 0.5 || next > 1.5) continue;
          // Do not overshoot past the target in the other direction.
          const delta = Math.round(r.kcal * step);
          if (Math.abs(off + delta) >= Math.abs(off)) continue;
          e.portions[person.id] = next;
          e.kcal[person.id] = Math.round(r.kcal * next);
          e.protein[person.id] = Math.round(r.protein * next);
          moved = true;
          break;
        }
        if (!moved) break;
      }
    }
  }
  return plan;
}

/**
 * Total portions to cook tonight = what we eat tonight plus every leftover
 * portion carried into tomorrow's lunch. This is the number the UI shows on
 * the dinner card, because "cook 3.5 portions" is the whole trick.
 */
const sumPortions = (e) => Object.values(e.portions).reduce((a, b) => a + b, 0);

/**
 * Total portions to cook in this session = tonight, plus every lunch box carried
 * out of it, plus (in batch mode) every later evening that reheats it. This is
 * the number the UI puts on the dinner card, because "cook 7.5 portions" is the
 * whole trick.
 */
export function cookPortions(plan, dayIndex) {
  const d = plan.days[dayIndex];
  if (!d || !d.dinner || d.dinner.kind !== 'recipe') return 0;
  const id = d.dinner.recipeId;
  let total = sumPortions(d.dinner);
  plan.days.forEach((day, i) => {
    if (i === dayIndex) return;
    if (day.dinner?.kind === 'batch' && day.dinner.from === dayIndex && day.dinner.recipeId === id) {
      total += sumPortions(day.dinner);
    }
    for (const e of Object.values(day.lunch ?? {})) {
      if (e?.kind !== 'leftover' || e.recipeId !== id) continue;
      // A leftover lunch belongs to this session if it came from this evening,
      // or from a reheat that this session cooked.
      const src = plan.days[e.from]?.dinner;
      const owner = src?.kind === 'batch' ? src.from : e.from;
      if (owner === dayIndex) total += sumPortions(e);
    }
  });
  return Math.round(total * 100) / 100;
}

/** Which evenings a session feeds, for the "cook once, eat three times" card. */
export function sessionDays(plan, dayIndex) {
  const out = [dayIndex];
  plan.days.forEach((day, i) => {
    if (i !== dayIndex && day.dinner?.kind === 'batch' && day.dinner.from === dayIndex) out.push(i);
  });
  return out;
}

/**
 * The slice of the week a shopping list is for.
 *
 * Dropping the days you are not shopping for is most of the job, but not all of
 * it: a reheat is not a thing you buy. A Monday lunch that is Sunday's leftovers
 * was paid for in Sunday's ingredients, so it only belongs in the slice when
 * Sunday is in the slice too - otherwise a Monday-only list would quietly ask
 * for a whole Sunday roast. Entries that point at a cook day (`from`) outside
 * the slice are therefore removed, while the cook days themselves are untouched.
 *
 * Days are positions, so this is indifferent to which day the week starts on.
 */
export function planForDays(plan, days) {
  const inside = new Set(days ?? []);
  if (!plan?.days || inside.size >= 7) return plan;
  const prune = (v) => {
    if (!v) return v;
    if (!isEntry(v)) {
      // A per-person slot: keep the people whose portion survives.
      const kept = Object.entries(v).map(([k, e]) => [k, prune(e)]).filter(([, e]) => e);
      return kept.length ? Object.fromEntries(kept) : null;
    }
    return Number.isInteger(v.from) && !inside.has(v.from) ? null : v;
  };
  const kept = plan.days.filter((d) => inside.has(d.index)).map((d) => {
    const day = { ...d };
    for (const key of SLOT_KEYS) day[key] = prune(d[key]);
    return day;
  });
  return { ...plan, days: kept };
}

/** Everything the shopping list and the "cook this much" card need, per recipe. */
export function portionsByRecipe(plan) {
  const acc = new Map();
  for (const d of plan.days) {
    for (const key of SLOT_KEYS) {
      for (const e of entriesIn(d[key])) {
        if (!e || !e.recipeId) continue;
        const n = Object.values(e.portions).reduce((a, b) => a + b, 0);
        acc.set(e.recipeId, (acc.get(e.recipeId) ?? 0) + n);
      }
    }
  }
  return acc;
}

// ------------------------------------------------- "I ate something else"
//
// Deviating from the plan is not the failure mode. ABANDONING it is. Before this
// existed, one pizza on Tuesday left the week's numbers quietly wrong for five
// days, which is exactly when people stop opening the app. So an off-plan meal
// is a first-class entry: it says what was really eaten, the ledger shows the
// damage, and the rest of the week can be asked to absorb it.

/** Rough kcal for the things actually reached for. All estimates, all labelled as such. */
export const OFF_PLAN_PRESETS = [
  { label: 'Pizza (a whole one)', kcal: 900 },
  { label: 'Döner / kebab', kcal: 700 },
  { label: 'Burger and fries', kcal: 1100 },
  { label: 'Bread, cheese and butter', kcal: 550 },
  { label: 'Big bowl of pasta', kcal: 800 },
  { label: 'Restaurant main and a drink', kcal: 850 },
  { label: 'Crisps and chocolate, an evening of it', kcal: 600 },
  { label: 'Something small', kcal: 250 },
];

// Takeaway and restaurant food runs around 15% of calories from protein, so
// ~4 g per 100 kcal. Flagged `estimated` so the UI can show a tilde rather than
// pretend this number was measured.
const OFF_PLAN_PROTEIN_PER_KCAL = 0.04;

/**
 * Record what was actually eaten in one slot.
 *
 * For a shared slot both of them ate it, and the second portion is scaled by the
 * same ratio the whole app uses for one pot serving two (see portionRatio) —
 * consistent beats invented.
 */
export function logOffPlan(plan, settings, { day, slot, person = null, kcal, label = null }) {
  const next = JSON.parse(JSON.stringify(plan));
  const v = next.days[day]?.[slot];
  if (!v) return next;
  const amount = Math.max(0, Math.round(Number(kcal) || 0));
  const ratio = portionRatio(settings.people);
  const note = label ? `Off plan: ${label}.` : 'Off plan.';

  const build = (eaters, primary) => {
    const portions = {}; const k = {}; const pr = {};
    for (const pid of eaters) {
      const mine = pid === primary ? amount : Math.round(amount * ratio);
      portions[pid] = 1;
      k[pid] = mine;
      pr[pid] = Math.round(mine * OFF_PLAN_PROTEIN_PER_KCAL);
    }
    return {
      slot, kind: 'off-plan', recipeId: null, from: null, locked: true,
      note, portions, kcal: k, protein: pr, estimated: true,
    };
  };

  if (isEntry(v)) {
    next.days[day][slot] = build(Object.keys(v.portions), person ?? settings.people[0].id);
  } else if (person) {
    next.days[day][slot][person] = build([person], person);
  } else {
    // Nobody named: the whole household ate it.
    for (const pid of Object.keys(v)) next.days[day][slot][pid] = build([pid], settings.people[0].id);
  }
  return next;
}

/** Was any of this day's food off plan, for this person? */
export function dayHasOffPlan(day, personId) {
  for (const key of SLOT_KEYS) {
    for (const e of entriesIn(day[key])) {
      if (e?.kind === 'off-plan' && (personId === undefined || e.kcal[personId] !== undefined)) return true;
    }
  }
  return false;
}

/**
 * Planned vs actual for the week.
 *
 * `planned` is the ORIGINAL target with no rebalance corrections in it, so the
 * surplus does not vanish the moment you rebalance — it moves, and you can see
 * where it went.
 */
export function weekLedger(plan, settings) {
  const out = {};
  for (const person of settings.people) {
    let planned = 0; let adjusted = 0; let actual = 0; let offPlanKcal = 0; let offPlanMeals = 0;
    plan.days.forEach((d, i) => {
      planned += dayTarget(person, { exerciseKcal: person.exerciseKcalByDay[i] ?? 0 });
      adjusted += targetFor(person, settings, i);
      actual += dayTotals(d)[person.id]?.kcal ?? 0;
      for (const key of SLOT_KEYS) {
        for (const e of entriesIn(d[key])) {
          if (e?.kind === 'off-plan' && e.kcal[person.id] !== undefined) {
            offPlanMeals += 1;
            offPlanKcal += e.kcal[person.id];
          }
        }
      }
    });
    out[person.id] = {
      planned, adjusted, actual, surplus: actual - planned, offPlanKcal, offPlanMeals,
      kgEquivalent: Math.round(((actual - planned) / KCAL_PER_KG_FAT) * 100) / 100,
    };
  }
  return out;
}

/**
 * Ask the remaining days to absorb a surplus.
 *
 * Spread evenly over the days after `fromDay`, capped per day so no one day
 * becomes miserable, and hard-floored so it can never push anyone under a safe
 * intake. Whatever will not fit is returned rather than hidden: a week that
 * cannot absorb 1,400 kcal should say so, not quietly fail.
 */
export function rebalanceWeek(plan, settings, { fromDay = 0 } = {}) {
  const ledger = weekLedger(plan, settings);
  const next = { ...settings, adjust: (settings.adjust ?? []).map((a) => ({ ...a })) };
  while (next.adjust.length < 7) next.adjust.push({});
  const report = {};

  const remaining = [];
  for (let i = fromDay + 1; i <= 6; i++) remaining.push(i);

  for (const person of settings.people) {
    const real = Math.max(0, Math.round(ledger[person.id].surplus));
    // Reported as zero, not as an unabsorbed remainder: this report answers "what
    // should change about the rest of the week", and below the dead-band the answer
    // is nothing. weekLedger stays the one place that reports the true number.
    const deadband = rebalanceDeadband(ledger[person.id].planned / 7, remaining.length);
    // On the last day there is nothing to compare against and nothing to spread it over,
    // so the surplus stays whole and gets reported as left over rather than silenced.
    const surplus = remaining.length && real < deadband ? 0 : real;
    report[person.id] = { surplus, absorbed: 0, left: surplus, days: remaining.length };
    if (!surplus || !remaining.length) continue;

    const want = Math.min(MAX_DAY_ADJUST, Math.ceil(surplus / remaining.length));
    let absorbed = 0;
    for (const i of remaining) {
      const base = dayTarget(person, { exerciseKcal: person.exerciseKcalByDay[i] ?? 0 });
      const room = Math.max(0, base - SAFE_FLOOR_KCAL[person.sex]);
      const cut = Math.min(want, room, surplus - absorbed);
      if (cut <= 0) continue;
      next.adjust[i] = { ...next.adjust[i], [person.id]: -cut };
      absorbed += cut;
    }
    report[person.id] = { surplus, absorbed, left: surplus - absorbed, days: remaining.length };
  }
  return { settings: next, report };
}

/** Drop every correction — used by "New week" and by the clear button. */
export function clearAdjust(settings) {
  return { ...settings, adjust: [{}, {}, {}, {}, {}, {}, {}] };
}

/**
 * Re-portion an existing week onto (possibly changed) targets without choosing
 * different recipes. This is what a rebalance runs: the meals stay, the portions
 * move. Re-rolling the menu because of one pizza would be a punishment.
 */
export function reflow(plan, settings) {
  const next = JSON.parse(JSON.stringify(plan));
  return trimToTarget(next, settings, budgetTable(settings));
}

// ---------------------------------------------------- learning what sticks
export const STAT_CAP = 9;

const bump = (map, id) => ({ ...map, [id]: Math.min(STAT_CAP, (map?.[id] ?? 0) + 1) });

/** You replaced it but did not ban it: a soft "not that", worth remembering. */
export function recordSwapAway(memory, recipeId) {
  if (!recipeId) return memory;
  const stats = memory.stats ?? { away: {}, kept: {} };
  return { ...memory, stats: { ...stats, away: bump(stats.away, recipeId) } };
}

/**
 * Everything still on the board at the end of a week survived it: never swapped
 * away, never banned. That is the strongest signal the app gets without asking a
 * question, so it is recorded when the next week is generated.
 */
export function recordKept(memory, plan) {
  if (!plan) return memory;
  const stats = memory.stats ?? { away: {}, kept: {} };
  let kept = stats.kept ?? {};
  const seen = new Set();
  forEachEntry(plan, (e) => {
    if (!e?.recipeId || seen.has(e.recipeId)) return;
    seen.add(e.recipeId);
    kept = bump(kept, e.recipeId);
  });
  return { ...memory, stats: { ...stats, kept } };
}

/** The top of what the app has worked out, for the Why tab. */
export function learned(memory, limit = 6) {
  const stats = memory.stats ?? { away: {}, kept: {} };
  const rate = (id) => (stats.kept?.[id] ?? 0)
    - (stats.away?.[id] ?? 0) * 1.5
    + (memory.ratings?.[id] ? memory.ratings[id] - 3 : 0);
  const ids = new Set([
    ...Object.keys(stats.kept ?? {}), ...Object.keys(stats.away ?? {}), ...Object.keys(memory.ratings ?? {}),
  ]);
  const rows = [...ids]
    .map((id) => ({
      id, name: recipeById(id)?.name ?? id, score: Math.round(rate(id) * 10) / 10,
      kept: stats.kept?.[id] ?? 0, away: stats.away?.[id] ?? 0, rating: memory.ratings?.[id] ?? null,
    }))
    .filter((r) => r.kept || r.away || r.rating);
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    liked: rows.filter((r) => r.score > 0).slice(0, limit),
    disliked: rows.filter((r) => r.score < 0).slice(-limit).reverse(),
  };
}

export { CANTEEN_CARDS, EAT_OUT_CARDS, portionRatio, RECIPES };
