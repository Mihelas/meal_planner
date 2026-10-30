// Swap / ban / lock — the "replace a recipe we don't like" engine.
//
// This is the feature the app was actually asked for, so it is a tested module
// rather than three lines of DOM code. Three verbs:
//
//   swapMeal  — give me a different one for this slot, still on budget
//   banRecipe — never again, for good, across all future weeks
//   toggleLock — keep this one when I re-roll the week
//
// It also owns the smaller memory verbs (rating, notes, pantry, own recipes),
// because they are the same kind of thing: a pure function from memory to a NEW
// memory, which the generator then reads back as preference.
//
// All three are pure: they take a plan and return a NEW plan. Nothing mutates,
// so undo is free and the store can just keep the last object it was handed.

import {
  dayLabel, SLOT_KEYS, slotCandidates, portionsFor, isEntry, entriesIn, cookPortions,
  CANTEEN_CARDS, EAT_OUT_CARDS, preferencePenalty, recordSwapAway, targetFor, planMonth,
  sessionDays, forget, remember,
} from './planner.js';
import {
  recipeById, validateRecipe, setCustomRecipes, parseRecipeBlocks,
} from './recipes.js';
import { proteinFloor, slotBudget } from './targets.js';

const clone = (plan) => JSON.parse(JSON.stringify(plan));

const SNACK_SPLIT = { snackAfternoon: 0.45, snackEvening: 0.55 };
const SLOT_SOURCE = {
  breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner',
  snackAfternoon: 'snack', snackEvening: 'snack',
};

/** The kcal/protein allowance for one person in one slot on one day. */
function budgetFor(settings, day, slot, personId) {
  const person = settings.people.find((p) => p.id === personId) ?? settings.people[0];
  const b = slotBudget(targetFor(person, settings, day), proteinFloor(person));
  const src = SLOT_SOURCE[slot];
  const share = slot.startsWith('snack') ? SNACK_SPLIT[slot] : 1;
  return { kcal: Math.round(b.kcal[src] * share), protein: Math.round(b.protein[src] * share) };
}

/** Swap ordering: fit to the budget first, then everything we have learned. */
function rankOptions(options, settings, memory, budget) {
  const opts = {
    pantry: memory?.pantry,
    month: settings.useSeason === false ? null : planMonth(settings),
  };
  const miss = (r) => Math.abs(r.kcal * portionsFor(r, budget.kcal) - budget.kcal) / Math.max(1, budget.kcal);
  // Scored once rather than inside the comparator: preferencePenalty walks every
  // ingredient, and a comparator runs it O(n log n) times for the same recipe.
  return options
    .map((r) => ({ r, score: miss(r) + preferencePenalty(r, memory ?? {}, opts) }))
    .sort((x, y) => x.score - y.score)
    .map((x) => x.r);
}

/** Everything else on the board in the same slot — we don't want a duplicate. */
function inUse(plan, slot, exceptDay) {
  const ids = [];
  plan.days.forEach((d, i) => {
    if (i === exceptDay) return;
    for (const e of entriesIn(d[slot])) if (e?.recipeId) ids.push(e.recipeId);
  });
  // A dinner must be unique across the whole week, including as a leftover lunch.
  if (slot === 'dinner') {
    plan.days.forEach((d, i) => {
      if (i === exceptDay) return;
      if (d.dinner?.recipeId) ids.push(d.dinner.recipeId);
    });
  }
  return ids;
}

/**
 * What could go in this slot instead. Excludes the current pick, anything banned,
 * and anything already used elsewhere in the same slot that week.
 */
export function candidatesFor(plan, settings, memory, { day, slot, person }) {
  const v = plan.days[day][slot];
  const current = isEntry(v) ? v : v[person ?? settings.people[0].id];
  const exclude = [...inUse(plan, slot, day)];
  if (current?.recipeId) exclude.push(current.recipeId);
  return slotCandidates(settings, memory, { day, slot }, exclude);
}

function rebuiltEntry(recipe, settings, day, slot, eaters, previous) {
  const portions = {}; const kcal = {}; const protein = {};
  for (const p of eaters) {
    const n = portionsFor(recipe, budgetFor(settings, day, slot, p).kcal);
    portions[p] = n;
    kcal[p] = Math.round(recipe.kcal * n);
    protein[p] = Math.round(recipe.protein * n);
  }
  return {
    slot: recipe.slot, kind: 'recipe', recipeId: recipe.id, from: null,
    locked: previous?.locked ?? false, note: null, portions, kcal, protein,
  };
}

/**
 * Replace one meal with a different one.
 *
 * A canteen or eat-out card has no recipe to swap, so instead we hand over a
 * different suggestion for the same tray — there is still no kitchen at the office.
 *
 * Pass `recipeId` to name the replacement — that is what the swap sheet does.
 * Leave it out and the slot steps one place along its own shortlist, which is
 * what the “just pick one” button and a second click on the same slot want.
 */
export function swapMeal(plan, settings, memory, { day, slot, person, recipeId }) {
  // A reheat is not a meal you can change on its own — it is a portion of a
  // batch that was cooked on another day. Swapping it has to mean swapping the
  // session, or the two would silently disagree about what is in the fridge.
  const clicked = plan.days[day]?.[slot];
  const clickedEntry = isEntry(clicked) ? clicked : clicked?.[person ?? settings.people[0].id];
  if (clickedEntry?.kind === 'batch' && Number.isInteger(clickedEntry.from) && clickedEntry.from !== day) {
    return swapMeal(plan, settings, memory, { day: clickedEntry.from, slot, person, recipeId });
  }

  const next = clone(plan);
  const v = next.days[day][slot];
  const personId = person ?? settings.people[0].id;
  const target = isEntry(v) ? v : v[personId];
  if (!target) return next;

  if (target.kind === 'canteen' || target.kind === 'eat-out') {
    const cards = target.kind === 'canteen' ? CANTEEN_CARDS : EAT_OUT_CARDS;
    const at = cards.indexOf(target.note);
    target.note = cards[(at + 1 + cards.length) % cards.length];
    return next;
  }

  const eaters = Object.keys(target.portions);
  const options = candidatesFor(next, settings, memory, { day, slot, person: personId });
  if (options.length === 0) {
    next.warnings = [...(next.warnings ?? []),
      `Nothing left to swap into ${dayLabel(next, day)} ${slot}. Un-ban a recipe in Settings.`];
    return next;
  }

  // A named recipe is applied as named. Without one, walk the shortlist in fit
  // order so repeated clicks cycle instead of bouncing between the same two
  // dishes. The caller used to have to re-run this until the cycle happened to
  // reach its own choice, which broke in silence as soon as a slot had more
  // candidates than the caller had patience — dinner crossed that line at
  // seventy, and the click then left whatever the last attempt had landed on.
  const b = budgetFor(settings, day, slot, personId);
  const ranked = rankOptions(options, settings, memory, b);
  const step = recipeId
    ? ranked.findIndex((r) => r.id === recipeId)
    : ((target.swapIndex ?? 0) + 1) % ranked.length;
  // Named something this slot cannot have: banned, already on the board, or of
  // the wrong slot entirely. A stale button is no reason to rewrite the week.
  if (step < 0) return next;
  const pick = ranked[step];

  const built = rebuiltEntry(pick, settings, day, slot, eaters, target);
  built.swapIndex = step;
  if (isEntry(v)) next.days[day][slot] = built;
  else next.days[day][slot][personId] = built;

  if (slot === 'dinner') {
    repairBatch(next, day);
    // A batch session feeds several evenings, and EACH of those evenings can be
    // the source of the next day's lunch box. Repairing only tomorrow would
    // leave Wednesday's lunch claiming to be a dinner nobody cooked.
    for (const fed of sessionDays(next, day)) repairLeftovers(next, settings, memory, fed);
  }
  return next;
}

/**
 * Swap and remember. The plain swapMeal stays pure so the generator and the
 * repair paths can use it freely; this is the version the buttons call, because
 * a user replacing a meal is the most useful signal the app ever gets and
 * throwing it away would be a waste.
 */
export function swapAndLearn(plan, settings, memory, target) {
  const v = plan.days[target.day]?.[target.slot];
  const e = isEntry(v) ? v : v?.[target.person ?? settings.people[0].id];
  const nextMemory = e?.kind === 'recipe' || e?.kind === 'batch'
    ? recordSwapAway(memory, e.recipeId) : memory;
  return { plan: swapMeal(plan, settings, memory, target), memory: nextMemory };
}

/**
 * After a session's dinner changes, every evening that reheats it has to follow.
 * Leaving them pointed at the old recipe would put food in the fridge that
 * nobody cooked — the exact failure the batch mode exists to avoid.
 */
export function repairBatch(plan, cookDay) {
  const source = plan.days[cookDay]?.dinner;
  plan.days.forEach((d, i) => {
    if (i === cookDay || d.dinner?.kind !== 'batch' || d.dinner.from !== cookDay) return;
    if (d.dinner.locked) return;
    if (source?.kind !== 'recipe' || !recipeById(source.recipeId)) {
      // The session no longer cooks anything (swapped to a card, or banned out).
      // Drop the reheat back to a plain copy of whatever the session became.
      d.dinner = { ...source, from: cookDay, note: source?.note ?? null };
      return;
    }
    const gap = i - cookDay;
    d.dinner = {
      ...d.dinner,
      recipeId: source.recipeId,
      portions: { ...source.portions },
      kcal: { ...source.kcal },
      protein: { ...source.protein },
      note: gap > 3
        ? `Reheat of ${dayLabel(plan, cookDay)}'s batch. Freeze this portion on ${dayLabel(plan, cookDay)} and move it to the fridge the night before — ${gap} days is past what a fridge should hold.`
        : `Reheat of ${dayLabel(plan, cookDay)}'s batch. Nothing to cook tonight beyond warming it through.`,
    };
  });
  return plan;
}

/**
 * A dinner swap invalidates tomorrow's lunch: the box in the fridge is now a
 * different meal, or the new dinner is not safe to keep at all. Fix it rather
 * than leaving a lunch card that points at food nobody cooked.
 */
export function repairLeftovers(plan, settings, memory, changedDay) {
  const tomorrow = plan.days[changedDay + 1];
  if (!tomorrow) return plan;
  const source = plan.days[changedDay].dinner;
  const safe = (source.kind === 'recipe' || source.kind === 'batch')
    && recipeById(source.recipeId)?.tags.includes('leftover-ok');

  for (const personId of Object.keys(tomorrow.lunch)) {
    const e = tomorrow.lunch[personId];
    if (e.locked) continue;
    if (e.kind !== 'leftover' || e.from !== changedDay) continue;

    if (safe) {
      const r = recipeById(source.recipeId);
      const rebuilt = rebuiltEntry(r, settings, changedDay + 1, 'lunch', [personId], e);
      rebuilt.kind = 'leftover';
      rebuilt.slot = 'lunch';
      rebuilt.from = changedDay;
      rebuilt.note = `Already cooked — this is ${dayLabel(plan, changedDay)}'s dinner. Portion it into a box the moment you serve dinner, not the next morning.`;
      tomorrow.lunch[personId] = rebuilt;
    } else {
      // Nothing to carry: fall back to a packable lunch recipe.
      const opts = slotCandidates(settings, memory, { day: changedDay + 1, slot: 'lunch' },
        inUse(plan, 'lunch', changedDay + 1));
      const b = budgetFor(settings, changedDay + 1, 'lunch', personId);
      const pick = rankOptions(opts, settings, memory, b)[0];
      if (pick) {
        tomorrow.lunch[personId] = rebuiltEntry(pick, settings, changedDay + 1, 'lunch', [personId], e);
      } else {
        tomorrow.lunch[personId] = {
          ...e, kind: 'canteen', recipeId: null, from: null,
          note: CANTEEN_CARDS[0],
        };
      }
    }
  }
  return plan;
}

// ---------------------------------------------------------------- ban / lock
export function banRecipe(memory, recipeId) {
  // `remember` first: the id is going back on the list, and a stale "removed from
  // banned" note would have the other device take it off again on the next sync.
  const next = remember(memory, 'banned', recipeId);
  const banned = next?.banned ?? [];
  if (banned.includes(recipeId)) return { ...next, banned };
  return { ...next, banned: [...banned, recipeId] };
}

export function unbanRecipe(memory, recipeId) {
  const next = forget(memory, 'banned', recipeId);
  return { ...next, banned: (memory?.banned ?? []).filter((id) => id !== recipeId) };
}

export function toggleLock(plan, { day, slot, person }) {
  const next = clone(plan);
  const v = next.days[day][slot];
  if (isEntry(v)) v.locked = !v.locked;
  else if (person) v[person].locked = !v[person].locked;
  else for (const e of Object.values(v)) e.locked = !e.locked;
  return next;
}

/**
 * Ban a recipe AND take it out of the current week in one action — which is
 * what "never again" means when you are looking at it on tonight's card.
 */
export function banAndReplace(plan, settings, memory, { day, slot, person }) {
  const v = plan.days[day][slot];
  const target = isEntry(v) ? v : v[person ?? settings.people[0].id];
  const id = target?.recipeId;
  const nextMemory = id ? banRecipe(memory, id) : memory;
  let nextPlan = plan;

  // Replace every appearance of the banned recipe, not just the one clicked.
  if (id) {
    plan.days.forEach((d, i) => {
      for (const key of SLOT_KEYS) {
        const sv = nextPlan.days[i][key];
        if (isEntry(sv)) {
          // Reheats are not swapped directly: swapping the session they came
          // from rewrites them, and doing both would swap twice.
          if (sv.recipeId === id && sv.kind !== 'batch') {
            nextPlan = swapMeal(nextPlan, settings, nextMemory, { day: i, slot: key });
          }
        } else {
          for (const pid of Object.keys(sv)) {
            const k = sv[pid].kind;
            if (sv[pid].recipeId === id && k !== 'leftover' && k !== 'batch') {
              nextPlan = swapMeal(nextPlan, settings, nextMemory, { day: i, slot: key, person: pid });
            }
          }
        }
      }
    });
    // Leftovers referencing a banned dinner are repaired by the dinner swap above.
  }
  return { plan: nextPlan, memory: nextMemory };
}

export { cookPortions };

// ------------------------------------------------------- rating, notes, pantry
export const RATINGS = [1, 2, 3, 4, 5];

/**
 * Rate a recipe 1-5. Rating the same value again clears it, so the stars are a
 * toggle and a mis-tap is one tap to undo.
 */
export function rateRecipe(memory, recipeId, stars) {
  const ratings = { ...(memory?.ratings ?? {}) };
  const n = Math.round(Number(stars));
  const clearing = !RATINGS.includes(n) || ratings[recipeId] === n;
  if (clearing) delete ratings[recipeId];
  else ratings[recipeId] = n;
  // Both maps merge by spread, which cannot tell an absent key from a deleted
  // one: without the note the side that still holds a score wins whichever phone
  // was saved later, and a rating somebody cleared keeps steering the planner.
  const next = clearing
    ? forget({ ...memory, ratings }, 'ratings', recipeId)
    : remember({ ...memory, ratings }, 'ratings', recipeId);
  return next;
}

/** A free-text note that resurfaces every time the recipe comes back. */
export function noteRecipe(memory, recipeId, text) {
  const notes = { ...(memory?.notes ?? {}) };
  const clean = String(text ?? '').trim().slice(0, 400);
  if (clean) notes[recipeId] = clean;
  else delete notes[recipeId];
  return clean
    ? remember({ ...memory, notes }, 'notes', recipeId)
    : forget({ ...memory, notes }, 'notes', recipeId);
}

/**
 * Tick something you already have in. Stored by pantryKey (item + unit) so it
 * matches whatever the shopping list computed, and with the quantity you have,
 * because "some rice" and "1 kg of rice" buy differently.
 */
export function setPantry(memory, key, qty) {
  const pantry = { ...(memory?.pantry ?? {}) };
  const n = Number(qty);
  const have = Number.isFinite(n) && n > 0;
  if (have) pantry[key] = n;
  else delete pantry[key];
  // The cupboard merges on `Math.max`, which has no way to say "I have none":
  // without the note, taking the last of the rice out here has the other phone
  // put it back, and then the shopping list leaves rice off.
  return have
    ? remember({ ...memory, pantry }, 'pantry', key)
    : forget({ ...memory, pantry }, 'pantry', key);
}

export function togglePantry(memory, key, qty = 1) {
  return (memory?.pantry ?? {})[key] ? setPantry(memory, key, 0) : setPantry(memory, key, qty);
}

/**
 * Pantry entries go stale fast; this is the "shopping done" reset.
 *
 * One note per staple, not one for the act: the merge resolves per key, and a
 * bulk delete that records nothing is the same bug once per item.
 */
export function clearPantry(memory) {
  let next = { ...memory, pantry: {} };
  for (const key of Object.keys(memory?.pantry ?? {})) next = forget(next, 'pantry', key);
  return next;
}

/**
 * "Reset ticks" — the shopping list, emptied.
 *
 * Same shape as clearPantry and for the same reason: one note per item. A
 * wholesale `bought: {}` records nothing, so every tick comes back from the
 * other phone on the next sync and the list reads as already shopped.
 */
export function clearBought(memory, bought) {
  let next = memory;
  for (const [id, on] of Object.entries(bought ?? {})) if (on) next = forget(next, 'bought', id);
  return next;
}

// ------------------------------------------------------------- own recipes
/**
 * Add a recipe typed in the app. Returns the validation result as well as the
 * new memory so the form can show errors instead of silently dropping input.
 * The live library is updated immediately, so the new recipe can be chosen by
 * the very next swap rather than only after a reload.
 */
export function addCustomRecipe(memory, draft, opts = {}) {
  const result = validateRecipe(draft, opts);
  const warnings = result.warnings ?? [];
  if (!result.ok) return { ok: false, errors: result.errors, warnings, memory };
  const list = [...(memory?.custom ?? []).filter((r) => r.id !== result.recipe.id), result.recipe];
  const stored = setCustomRecipes(list);
  const recipe = stored[stored.length - 1] ?? result.recipe;
  // Re-adding a recipe you had deleted: drop the deletion note along with it.
  const next = remember(memory, 'custom', recipe.id);
  return { ok: true, errors: [], warnings, recipe, memory: { ...next, custom: stored } };
}

/**
 * Import a pasted blob of recipes in one go.
 *
 * Everything that parses is added; everything that does not is reported by name
 * and line. Nothing already in the library is replaced -- `setCustomRecipes`
 * suffixes a colliding id -- because an import is an addition, and someone
 * pasting a shared file should not silently lose their own version of a recipe.
 */
export function importRecipes(memory, text) {
  const { recipes, errors, warnings } = parseRecipeBlocks(text);
  if (!recipes.length) return { ok: false, added: 0, errors, warnings, memory };
  const stored = setCustomRecipes([...(memory?.custom ?? []), ...recipes]);
  // setCustomRecipes drops anything that fails validation a second time, so count
  // what actually landed rather than what we hoped would.
  const added = stored.length - (memory?.custom ?? []).length;
  // Anything on the list is by definition not deleted, so no id here keeps a
  // tombstone -- re-importing a file you had pruned from should restore it.
  let next = memory;
  for (const r of stored) next = remember(next, 'custom', r.id);
  return {
    ok: added > 0, added, errors, warnings,
    memory: { ...next, custom: stored },
  };
}

export function removeCustomRecipe(memory, recipeId) {
  const stored = setCustomRecipes((memory?.custom ?? []).filter((r) => r.id !== recipeId));
  return { ...forget(memory, 'custom', recipeId), custom: stored };
}
