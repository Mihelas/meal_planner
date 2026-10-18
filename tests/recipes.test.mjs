import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECIPES, AISLES, CUISINES, EQUIPMENT, bySlot, recipeById, validateRecipe,
} from '../src/recipes.js';
import { SLOTS } from '../src/targets.js';

const WEEKDAY_MINUTE_CAP = 30;   // the agreed hard constraint
const all = RECIPES;

// ---------- Shape & integrity ----------
test('every recipe has every field the planner and UI rely on', () => {
  const required = ['id', 'name', 'slot', 'kcal', 'protein', 'minutes', 'cuisine', 'equipment', 'tags', 'ingredients', 'method'];
  for (const r of all) {
    for (const f of required) {
      assert.ok(r[f] !== undefined && r[f] !== null, `${r.id ?? r.name}: missing "${f}"`);
    }
  }
});

test('recipe ids are unique (a duplicate would break swap + memory)', () => {
  const ids = all.map(r => r.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `duplicate ids: ${dupes.join(', ')}`);
});

test('ids are url/storage-safe slugs', () => {
  for (const r of all) assert.match(r.id, /^[a-z0-9-]+$/, `${r.id} is not a clean slug`);
});

test('every slot, cuisine, equipment and aisle value is from the known set', () => {
  for (const r of all) {
    assert.ok(SLOTS.includes(r.slot), `${r.id}: bad slot "${r.slot}"`);
    assert.ok(CUISINES.includes(r.cuisine), `${r.id}: bad cuisine "${r.cuisine}"`);
    for (const e of r.equipment) assert.ok(EQUIPMENT.includes(e), `${r.id}: unknown equipment "${e}"`);
    for (const i of r.ingredients) assert.ok(AISLES.includes(i.aisle), `${r.id}: bad aisle "${i.aisle}" on ${i.item}`);
  }
});

test('ingredients are complete and quantified (the shopping list depends on it)', () => {
  for (const r of all) {
    assert.ok(r.ingredients.length > 0, `${r.id}: no ingredients`);
    for (const i of r.ingredients) {
      assert.ok(i.item && typeof i.item === 'string', `${r.id}: ingredient without a name`);
      assert.ok(Number.isFinite(i.qty) && i.qty > 0, `${r.id}/${i.item}: qty must be > 0`);
      assert.ok(i.unit && typeof i.unit === 'string', `${r.id}/${i.item}: missing unit`);
    }
  }
});

test('every recipe has an actual method, not a placeholder', () => {
  for (const r of all) {
    assert.ok(r.method.length > 0, `${r.id}: no method`);
    for (const step of r.method) assert.ok(step.length > 15, `${r.id}: method step too thin: "${step}"`);
  }
});

// ---------- Nutrition plausibility ----------
test('kcal and protein are positive and physically possible', () => {
  for (const r of all) {
    assert.ok(r.kcal > 0, `${r.id}: kcal must be > 0`);
    assert.ok(r.protein > 0, `${r.id}: protein must be > 0`);
    // 4 kcal per gram of protein cannot exceed the dish's total energy.
    assert.ok(r.protein * 4 <= r.kcal, `${r.id}: ${r.protein}g protein impossible in ${r.kcal} kcal`);
  }
});

test('nothing is absurdly large or small for its slot', () => {
  const range = { breakfast: [250, 600], lunch: [350, 750], dinner: [400, 900], snack: [80, 320] };
  for (const r of all) {
    const [lo, hi] = range[r.slot];
    assert.ok(r.kcal >= lo && r.kcal <= hi, `${r.id}: ${r.kcal} kcal is outside ${lo}-${hi} for ${r.slot}`);
  }
});

test('every dinner clears 25 g protein (muscle protection is the point)', () => {
  for (const r of bySlot('dinner')) {
    assert.ok(r.protein >= 25, `${r.id}: only ${r.protein}g protein`);
  }
});

test('breakfasts are protein-led, not just carbs', () => {
  for (const r of bySlot('breakfast')) {
    assert.ok(r.protein >= 25, `${r.id}: only ${r.protein}g protein`);
  }
});

test('the snack library is genuinely high-protein on average', () => {
  const snacks = bySlot('snack');
  const avg = snacks.reduce((s, r) => s + r.protein, 0) / snacks.length;
  assert.ok(avg >= 10, `average snack protein was ${avg.toFixed(1)}g`);
});

// ---------- The agreed constraints ----------
test('NO recipe exceeds the 30-minute weekday cap unless tagged weekend', () => {
  for (const r of all) {
    if (r.tags.includes('weekend')) continue;
    assert.ok(r.minutes <= WEEKDAY_MINUTE_CAP, `${r.id}: ${r.minutes} min breaks the 30-min cap`);
  }
});

test('equipment is limited to what we actually own', () => {
  const owned = ['none', 'hob', 'oven', 'airfryer', 'pressure', 'slowcooker', 'sousvide', 'blender', 'mixer'];
  for (const r of all) {
    for (const e of r.equipment) assert.ok(owned.includes(e), `${r.id}: we do not own "${e}"`);
  }
});

// ---------- Enough choice for the swap button to be useful ----------
test('each slot has enough recipes that swapping never runs dry', () => {
  // poolSizeFor draws from the best-fitting max(5, n/4), so a slot of 12 is a
  // top-5 draw and the same five meals come round every fortnight. These floors
  // sit just under what the library actually ships, so losing one recipe to a
  // rewrite is allowed and losing a quarter of a slot is not.
  const min = { breakfast: 16, lunch: 22, dinner: 45, snack: 26 };
  for (const slot of SLOTS) {
    assert.ok(bySlot(slot).length >= min[slot],
      `${slot}: only ${bySlot(slot).length} recipes, need >= ${min[slot]}`);
  }
});

test('a plain Tuesday still has a deep dinner pool after the weekday filters', () => {
  // The slot count is not the pool. slotCandidates throws out `weekend`, anything
  // over 30 minutes, and every post-football dinner before a weekday even starts,
  // so the honest number is the one left standing.
  const tuesday = bySlot('dinner').filter((r) => !r.tags.includes('weekend')
    && r.minutes <= WEEKDAY_MINUTE_CAP && !r.tags.includes('post-football'));
  assert.ok(tuesday.length >= 30, `only ${tuesday.length} dinners survive the weekday filters`);
});

test('the weekend is allowed to cook for longer than the weekday cap', () => {
  // Without these, Saturday and Sunday draw from exactly the same pool as Tuesday,
  // and the 30-minute cap we agreed for work nights silently becomes a 7-day rule.
  const weekend = all.filter((r) => r.tags.includes('weekend') || r.minutes > WEEKDAY_MINUTE_CAP);
  assert.ok(weekend.length >= 4, `only ${weekend.length} recipes the weekend can do that a weekday cannot`);
});

test('all four agreed cuisines are represented in dinners', () => {
  const found = new Set(bySlot('dinner').map(r => r.cuisine));
  for (const c of ['mediterranean', 'middle-eastern', 'asian', 'northern']) {
    assert.ok(found.has(c), `no ${c} dinner`);
  }
});

// ---------- Friday football night ----------
test('there are real post-football dinners that need almost no cooking', () => {
  const pf = bySlot('dinner').filter(r => r.tags.includes('post-football'));
  // Friday is the one fixed night of the week, so a pool of three means the same
  // three meals forever. Eight is two months before a repeat is noticeable.
  assert.ok(pf.length >= 8, `only ${pf.length} post-football dinners`);
  for (const r of pf) assert.ok(r.minutes <= 10, `${r.id}: ${r.minutes} min is too slow for 22:00`);
});

test('there are pre-match snacks, plural', () => {
  const pre = bySlot('snack').filter(r => r.tags.includes('pre-football'));
  assert.ok(pre.length >= 5, `only ${pre.length} pre-football snacks`);
  // Reserved for Friday by slotCandidates, so it is also the whole Friday pool.
  for (const r of pre) assert.ok(r.minutes <= 10, `${r.id}: ${r.minutes} min before kick-off`);
});

// ---------- Leftovers: the anti-pizza mechanism ----------
test('most dinners are explicitly leftover-safe so lunch is pre-solved', () => {
  const din = bySlot('dinner');
  const ok = din.filter(r => r.tags.includes('leftover-ok'));
  // A ratio, not a count: the mechanism is "most dinners cover tomorrow's lunch",
  // and that stays true as the library grows only if the share is what is pinned.
  const share = ok.length / din.length;
  assert.ok(share >= 0.6, `only ${ok.length} of ${din.length} dinners are leftover-safe (${Math.round(share * 100)}%)`);
});

// ---------- Habits we promised to keep ----------
test('the Nesquik and the yoghurt-and-fruit habits survive, upgraded', () => {
  const b = bySlot('breakfast');
  assert.ok(b.some(r => r.tags.includes('habit-nesquik')), 'no chocolate-milk breakfast');
  assert.ok(b.some(r => r.tags.includes('habit-yoghurt')), 'no yoghurt-and-fruit breakfast');
});

test('grab-and-go breakfasts exist for rushed mornings', () => {
  const fast = bySlot('breakfast').filter(r => r.minutes <= 5);
  assert.ok(fast.length >= 4, `only ${fast.length} breakfasts take <= 5 min`);
});

// ---------- Night cravings, both directions ----------
test('the evening snack menu covers sweet AND savoury', () => {
  const evening = bySlot('snack').filter(r => r.when !== 'afternoon');
  for (const kind of ['sweet', 'savoury']) {
    assert.ok(evening.filter(r => r.tags.includes(kind)).length >= 4,
      `fewer than 4 evening ${kind} options`);
  }
});

test('there are no-effort evening snacks for zero-willpower nights', () => {
  const lazy = bySlot('snack').filter(r => r.minutes <= 2 && r.when !== 'afternoon');
  assert.ok(lazy.length >= 4, `only ${lazy.length} zero-effort evening snacks`);
});

// ---------- Lookup helpers ----------
test('every lunch can actually be scheduled', () => {
  // slotCandidates drops any lunch that is neither packable nor no-cook, so one
  // written without either tag is in the library, counted by the size test, and
  // unreachable forever. Two were.
  const dead = bySlot('lunch').filter(
    (r) => !r.tags.includes('packable') && !r.tags.includes('no-cook'));
  assert.deepEqual(dead.map((r) => r.id), [], 'lunches the planner can never choose');
});

test('the library meets the bounds it asks the user to meet', () => {
  // The same validator the custom-recipe form runs. If a built-in cannot pass it,
  // either the recipe is wrong or the bounds are too tight -- both worth knowing
  // before someone is told their own cooking is impossible.
  const flagged = [];
  for (const r of all) {
    const v = validateRecipe({ ...r, id: `u-${r.id}` });
    if (!v.ok) flagged.push(`${r.id}: ${v.errors.join(' / ')}`);
    else if (v.warnings.length) flagged.push(`${r.id} (warning): ${v.warnings.join(' / ')}`);
  }
  assert.deepEqual(flagged, []);
});

test('recipeById finds a recipe and returns undefined for a stale id', () => {
  assert.equal(recipeById(all[0].id).id, all[0].id);
  assert.equal(recipeById('deleted-recipe-from-an-old-plan'), undefined);
});
