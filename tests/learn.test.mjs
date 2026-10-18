import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAYS, defaultSettings, generateWeek, forEachEntry, preferencePenalty, pantryKey,
  recordSwapAway, recordKept, learned, STAT_CAP,
  RATING_WEIGHT, SWAP_AWAY_WEIGHT, KEPT_WEIGHT, PANTRY_WEIGHT,
} from '../src/planner.js';
import {
  rateRecipe, noteRecipe, setPantry, togglePantry, clearPantry, swapAndLearn, RATINGS,
} from '../src/swap.js';
import { recipeById, RECIPES } from '../src/recipes.js';
import { SEASON_PENALTY } from '../src/seasons.js';

const S = defaultSettings();
const M = { banned: [] };
const R = RECIPES.find((r) => r.slot === 'dinner' && r.ingredients.length >= 3);

// ---------- Rating ----------
test('rating a recipe stores it, and rating the same stars again clears it', () => {
  const once = rateRecipe({}, 'x', 5);
  assert.equal(once.ratings.x, 5);
  assert.equal(rateRecipe(once, 'x', 5).ratings.x, undefined, 'a second tap is an undo');
  assert.equal(rateRecipe(once, 'x', 2).ratings.x, 2, 'a different tap re-rates');
});

test('only 1-5 is a rating; anything else is ignored rather than stored', () => {
  for (const bad of [0, 6, -1, 'five', null, NaN]) {
    assert.equal(rateRecipe({}, 'x', bad).ratings.x, undefined, `${bad} should not be a rating`);
  }
  for (const good of RATINGS) assert.equal(rateRecipe({}, 'x', good).ratings.x, good);
  assert.equal(rateRecipe({}, 'x', '4').ratings.x, 4, 'a string from a DOM value still works');
  assert.equal(rateRecipe({}, 'x', 4.4).ratings.x, 4, 'a stray fraction rounds to a real star');
});

test('rating is pure: the memory handed in is never modified', () => {
  const memory = { ratings: { x: 3 } };
  rateRecipe(memory, 'y', 5);
  assert.deepEqual(memory.ratings, { x: 3 });
});

test('a 5 pulls a recipe forward and a 1 pushes it back, by a known amount', () => {
  const base = preferencePenalty(R, {});
  assert.equal(base, 0, 'an unknown recipe starts neutral');
  assert.ok(preferencePenalty(R, { ratings: { [R.id]: 5 } }) < 0);
  assert.ok(preferencePenalty(R, { ratings: { [R.id]: 1 } }) > 0);
  assert.equal(preferencePenalty(R, { ratings: { [R.id]: 3 } }), 0, '3 is neutral, not mildly bad');
  assert.equal(preferencePenalty(R, { ratings: { [R.id]: 1 } }), 2 * RATING_WEIGHT);
});

test('preference can never outweigh a calorie miss — it only reorders equal options', () => {
  // Worst case: rated 1, swapped away four times, out of season, nothing in the pantry.
  const worst = { ratings: { [R.id]: 1 }, stats: { away: { [R.id]: 9 }, kept: {} } };
  const p = preferencePenalty(R, worst, { month: 1 });
  const ceiling = 2 * RATING_WEIGHT + 4 * SWAP_AWAY_WEIGHT + SEASON_PENALTY;
  assert.ok(p <= ceiling + 1e-9, `${p} exceeds the declared ceiling ${ceiling}`);
  assert.ok(p < 1, 'a 100% calorie miss must always dominate preference');
});

// ---------- Notes ----------
test('a note is kept, trimmed, and clearing it removes the key', () => {
  const m = noteRecipe({}, 'x', '  too salty, use half the soy  ');
  assert.equal(m.notes.x, 'too salty, use half the soy');
  assert.equal(noteRecipe(m, 'x', '   ').notes.x, undefined);
});

test('a note cannot grow without limit', () => {
  const long = noteRecipe({}, 'x', 'a'.repeat(5000));
  assert.ok(long.notes.x.length <= 400);
});

// ---------- Swapping away and keeping ----------
test('swapping a meal away is remembered against that recipe', () => {
  const plan = generateWeek(S, M);
  const before = plan.days[0].dinner.recipeId;
  const { memory } = swapAndLearn(plan, S, M, { day: 0, slot: 'dinner' });
  assert.equal(memory.stats.away[before], 1);
});

test('swapping away repeatedly counts up, but is capped so one week cannot dominate', () => {
  let memory = { banned: [] };
  for (let i = 0; i < 50; i++) memory = recordSwapAway(memory, 'x');
  assert.equal(memory.stats.away.x, STAT_CAP);
});

test('a swap-away with no recipe (a canteen card) records nothing', () => {
  assert.deepEqual(recordSwapAway({ banned: [] }, null), { banned: [] });
});

test('everything still on the board at the end of the week counts as kept', () => {
  const plan = generateWeek(S, M);
  const memory = recordKept({ banned: [] }, plan);
  const ids = new Set();
  forEachEntry(plan, (e) => { if (e.recipeId) ids.add(e.recipeId); });
  for (const id of ids) assert.equal(memory.stats.kept[id], 1, `${id} was not credited`);
});

test('a recipe served twice in one week is only credited once', () => {
  const plan = generateWeek({ ...S, cookingStyle: 'batch', cookDays: [0, 3] }, M);
  const memory = recordKept({ banned: [] }, plan);
  for (const [, n] of Object.entries(memory.stats.kept)) assert.equal(n, 1);
});

test('recordKept with no plan yet is a no-op, not a crash', () => {
  assert.deepEqual(recordKept({ banned: [] }, null), { banned: [] });
});

test('kept recipes come forward, swapped-away recipes go back', () => {
  const kept = preferencePenalty(R, { stats: { kept: { [R.id]: 3 }, away: {} } });
  const away = preferencePenalty(R, { stats: { kept: {}, away: { [R.id]: 3 } } });
  assert.equal(kept, -3 * KEPT_WEIGHT);
  assert.equal(away, 3 * SWAP_AWAY_WEIGHT);
  assert.ok(kept < away);
});

test('a favourite cannot take over the menu: the kept bonus stops growing', () => {
  const three = preferencePenalty(R, { stats: { kept: { [R.id]: 3 }, away: {} } });
  const nine = preferencePenalty(R, { stats: { kept: { [R.id]: 9 }, away: {} } });
  assert.equal(three, nine);
});

test('learning actually changes what gets planned', () => {
  const plan = generateWeek(S, M);
  const dinners = new Set();
  forEachEntry(plan, (e, d, slot) => { if (slot === 'dinner' && e.recipeId) dinners.add(e.recipeId); });
  // Rate every planned dinner 1: the next week should look different.
  let memory = { banned: [] };
  for (const id of dinners) memory = rateRecipe(memory, id, 1);
  const after = generateWeek(S, memory);
  const afterDinners = new Set();
  forEachEntry(after, (e, d, slot) => { if (slot === 'dinner' && e.recipeId) afterDinners.add(e.recipeId); });
  const overlap = [...afterDinners].filter((id) => dinners.has(id)).length;
  assert.ok(overlap < dinners.size, `nothing changed: still ${overlap}/${dinners.size} the same`);
});

// ---------- The Why tab ----------
test('learned separates what worked from what did not, best first', () => {
  let memory = { banned: [], stats: { kept: {}, away: {} } };
  memory = recordKept(memory, generateWeek(S, M));
  memory = rateRecipe(memory, R.id, 5);
  memory = recordSwapAway(memory, 'b-skyr-beeren-nuss');
  memory = recordSwapAway(memory, 'b-skyr-beeren-nuss');
  memory = rateRecipe(memory, 'b-skyr-beeren-nuss', 1);
  const { liked, disliked } = learned(memory);
  assert.ok(liked.length, 'something should be liked');
  assert.equal(liked[0].name, recipeById(liked[0].id).name);
  assert.ok(liked[0].score >= liked[liked.length - 1].score, 'best first');
  assert.ok(disliked.some((r) => r.id === 'b-skyr-beeren-nuss'),
    'a recipe rated 1 and swapped away twice belongs in disliked');
});

test('learned says nothing at all before anything has been learned', () => {
  const { liked, disliked } = learned({});
  assert.deepEqual(liked, []);
  assert.deepEqual(disliked, []);
});

test('learned respects the limit it is given, so the Why tab cannot run away', () => {
  const memory = recordKept({ banned: [] }, generateWeek(S, M));
  assert.ok(learned(memory, 3).liked.length <= 3);
});

// ---------- Pantry ----------
test('the pantry key matches on name and unit, ignoring case and punctuation', () => {
  assert.equal(pantryKey({ item: 'Olivenöl', unit: 'ml' }), pantryKey({ item: 'olivenöl', unit: 'ml' }));
  assert.equal(pantryKey({ item: 'Basmati Reis', unit: 'g' }), pantryKey({ item: 'basmati-reis', unit: 'g' }));
  assert.notEqual(pantryKey({ item: 'Reis', unit: 'g' }), pantryKey({ item: 'Reis', unit: 'Stk' }),
    '500 g of rice and 500 pieces of rice are not the same thing');
});

test('ticking and unticking the pantry is one function and its inverse', () => {
  const key = pantryKey({ item: 'Reis', unit: 'g' });
  const on = togglePantry({}, key, 500);
  assert.equal(on.pantry[key], 500);
  assert.equal(togglePantry(on, key).pantry[key], undefined);
});

test('a zero or negative amount means "I do not have it", not "I have none of it"', () => {
  const key = 'reis-g';
  for (const q of [0, -5, 'some', null]) {
    assert.equal(setPantry({ pantry: { [key]: 1 } }, key, q).pantry[key], undefined, `${q} should clear`);
  }
});

test('clearing the pantry after shopping empties it completely', () => {
  assert.deepEqual(clearPantry({ pantry: { a: 1, b: 2 } }).pantry, {});
});

test('having the ingredients in already pulls a recipe forward, by its coverage', () => {
  const pantry = {};
  for (const i of R.ingredients) pantry[pantryKey(i)] = 1;
  assert.equal(preferencePenalty(R, {}, { pantry }), -PANTRY_WEIGHT, 'all of it in = the full bonus');
  const half = { [pantryKey(R.ingredients[0])]: 1 };
  const p = preferencePenalty(R, {}, { pantry: half });
  assert.ok(p < 0 && p > -PANTRY_WEIGHT, 'part of it in = part of the bonus');
});

test('an empty pantry changes nothing', () => {
  assert.equal(preferencePenalty(R, {}, { pantry: {} }), 0);
  assert.equal(preferencePenalty(R, {}, {}), 0);
});

test('the pantry really does steer the planner towards using things up', () => {
  // A nudge, not a rule: stock a handful of dinners and more of them get planned.
  // Measured over several seeds, because one week is a coin toss by design.
  const stocked = RECIPES.filter((r) => r.slot === 'dinner' && r.minutes <= 30).slice(0, 6);
  const ids = new Set(stocked.map((r) => r.id));
  const pantry = {};
  for (const r of stocked) for (const i of r.ingredients) pantry[pantryKey(i)] = 1;

  const countStocked = (memory, seed) => {
    const plan = generateWeek({ ...S, seed }, memory);
    let n = 0;
    forEachEntry(plan, (e, day, slot) => { if (slot === 'dinner' && ids.has(e.recipeId)) n += 1; });
    return n;
  };
  let withPantry = 0;
  let without = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    withPantry += countStocked({ banned: [], pantry }, seed);
    without += countStocked({ banned: [] }, seed);
  }
  assert.ok(withPantry > without,
    `pantry made no difference: ${withPantry} stocked dinners with, ${without} without`);
});

test('seasonality is off when the setting says so, and on by default', () => {
  const winter = { ...S, month: 1 };
  const off = generateWeek({ ...winter, useSeason: false }, M);
  const on = generateWeek(winter, M);
  const ids = (p) => {
    const out = [];
    forEachEntry(p, (e) => { if (e.recipeId) out.push(e.recipeId); });
    return out.join(',');
  };
  assert.notEqual(ids(off), ids(on), 'the seasonality switch has to actually do something');
});
