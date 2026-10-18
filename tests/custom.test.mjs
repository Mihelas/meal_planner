import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECIPES, allRecipes, customRecipes, isCustomRecipe, setCustomRecipes, recipeById,
  bySlot, byTag, parseIngredientLines, validateRecipe, slugify, INGREDIENT_UNITS,
  DEFAULT_SHOPS, AISLES, parseRecipeBlocks,
} from '../src/recipes.js';
import { defaultSettings, generateWeek, forEachEntry } from '../src/planner.js';
import { addCustomRecipe, removeCustomRecipe, importRecipes } from '../src/swap.js';
import { shoppingList } from '../src/shopping.js';

const DRAFT = {
  name: 'Omas Linsensuppe', slot: 'dinner', kcal: 480, protein: 26, minutes: 25,
  cuisine: 'northern', equipment: ['pot'],
  ingredients: [{ item: 'Linsen', qty: 120, unit: 'g', aisle: 'dry-goods' }],
  method: ['Alles in den Topf.', 'Kochen.'],
};

// The recipe library is module-level state, so every test puts it back.
test.afterEach(() => setCustomRecipes([]));

// ---------- Parsing what someone actually types ----------
test('ingredient lines parse the documented "Name | amount | unit | aisle" form', () => {
  const { items, errors } = parseIngredientLines('Magerquark | 250 | g | dairy\nHonig | 10 | g | pantry');
  assert.deepEqual(errors, []);
  assert.deepEqual(items, [
    { item: 'Magerquark', qty: 250, unit: 'g', aisle: 'dairy' },
    { item: 'Honig', qty: 10, unit: 'g', aisle: 'pantry' },
  ]);
});

test('ingredient lines survive a comma decimal, blank lines and Windows newlines', () => {
  const { items, errors } = parseIngredientLines('\r\nOlivenöl | 1,5 | ml | pantry\r\n\r\n');
  assert.deepEqual(errors, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 1.5);
});

test('ingredient lines report the line number of a mistake instead of dropping it silently', () => {
  const { items, errors } = parseIngredientLines('Quark | 250 | g\nHonig | lots | g');
  assert.equal(items.length, 1, 'the good line is still kept');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Line 2/);
});

test('an unknown aisle falls back to the pantry and says so', () => {
  const { items, errors } = parseIngredientLines('Quark | 250 | g | freezer-aisle');
  assert.equal(items[0].aisle, 'pantry');
  assert.match(errors[0], /not an aisle/);
});

test('an empty ingredient box is an error, because a recipe nobody can shop for is useless', () => {
  assert.match(parseIngredientLines('   ').errors.join(' '), /at least one ingredient/);
});

test('units offered to the user are the units the shopping list can add up', () => {
  for (const u of INGREDIENT_UNITS) {
    const { items } = parseIngredientLines(`Ding | 1 | ${u}`);
    assert.equal(items.length, 1, `unit ${u} should be accepted`);
  }
});

// ---------- Validation ----------
test('a good draft validates and gets a stable, readable id', () => {
  const { ok, errors, recipe } = validateRecipe(DRAFT);
  assert.ok(ok, errors.join(' '));
  assert.equal(recipe.id, 'u-omas-linsensuppe-480');
  assert.ok(recipe.tags.includes('custom'), 'must be marked as ours');
});

test('slugify handles German: umlauts and sharp s become letters, not gaps', () => {
  assert.equal(slugify('Käsespätzle mit Soße'), 'kaesespaetzle-mit-sosse');
  assert.equal(slugify('Grünkohl & Co.'), 'gruenkohl-co');
});

test('validation refuses nonsense rather than storing it', () => {
  const bad = validateRecipe({ name: 'X', slot: 'brunch', kcal: 9000, protein: -3, minutes: 0, ingredients: [] });
  assert.equal(bad.ok, false);
  assert.equal(bad.recipe, null);
  assert.ok(bad.errors.length >= 5, `expected an error per problem, got ${bad.errors.join(' | ')}`);
});

test('a custom lunch is tagged packable, or the planner would never pick it', () => {
  const { recipe } = validateRecipe({ ...DRAFT, slot: 'lunch' });
  assert.ok(recipe.tags.includes('packable'));
});

test('a custom recipe over 30 minutes is tagged weekend, keeping the weekday cap honest', () => {
  const { recipe } = validateRecipe({ ...DRAFT, minutes: 75 });
  assert.ok(recipe.tags.includes('weekend'));
  const quick = validateRecipe({ ...DRAFT, minutes: 25 }).recipe;
  assert.ok(!quick.tags.includes('weekend'));
});

test('method text typed as one block becomes numbered steps', () => {
  const { recipe } = validateRecipe({ ...DRAFT, method: 'Schneiden\nBraten\n\nServieren' });
  assert.deepEqual(recipe.method, ['Schneiden', 'Braten', 'Servieren']);
});

// ---------- Sanity bounds: catching a typo before it becomes a shopping list ----------

test('an impossible amount is refused, not shopped for', () => {
  const bad = validateRecipe({
    ...DRAFT,
    ingredients: [{ item: 'Hähnchenbrust', qty: 5000, unit: 'g', aisle: 'meat-fish' }],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /5000|amount|portion/i.test(e)), bad.errors.join(' | '));
});

test('a large but believable amount warns and still saves', () => {
  const res = validateRecipe({
    ...DRAFT, kcal: 700,
    ingredients: [{ item: 'Kartoffeln', qty: 1200, unit: 'g', aisle: 'produce' }],
  });
  assert.ok(res.ok, res.errors.join(' | '));
  assert.ok(res.warnings.length > 0, 'a kilo of potatoes in one portion deserves a second look');
});

test('a missing zero in the amount is caught by energy density', () => {
  // 480 kcal out of 12 g is 40 kcal per gram. Pure fat is 9.
  const bad = validateRecipe({
    ...DRAFT, kcal: 480,
    ingredients: [{ item: 'Linsen', qty: 12, unit: 'g', aisle: 'dry-goods' }],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /per gram/i.test(e)), bad.errors.join(' | '));
});

test('an extra zero in the amount is caught from the other direction', () => {
  const bad = validateRecipe({
    ...DRAFT, kcal: 100, protein: 5,
    ingredients: [{ item: 'Gurke', qty: 2500, unit: 'g', aisle: 'produce' }],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /per gram/i.test(e)), bad.errors.join(' | '));
});

test('protein that costs more calories than the recipe has is impossible', () => {
  // Protein is 4 kcal/g, so 30 g cannot fit inside 100 kcal.
  const bad = validateRecipe({ ...DRAFT, kcal: 100, protein: 30 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /protein/i.test(e)), bad.errors.join(' | '));
});

test('a recipe measured only in pieces is not falsely accused', () => {
  // Three eggs have no grams to divide into, so the density check must stand down.
  const res = validateRecipe({
    ...DRAFT, slot: 'breakfast', kcal: 180, protein: 14,
    ingredients: [{ item: 'Ei', qty: 3, unit: 'Stk', aisle: 'dairy' }],
  });
  assert.ok(res.ok, res.errors.join(' | '));
  assert.deepEqual(res.warnings, []);
});

test('a genuine weekend roast passes without complaint', () => {
  const res = validateRecipe({
    ...DRAFT, name: 'Schweinebraten', kcal: 1200, protein: 90, minutes: 150,
    ingredients: [
      { item: 'Schweinebraten', qty: 400, unit: 'g', aisle: 'meat-fish' },
      { item: 'Kartoffeln', qty: 300, unit: 'g', aisle: 'produce' },
    ],
  });
  assert.ok(res.ok, res.errors.join(' | '));
  assert.deepEqual(res.warnings, [], 'nothing here is actually wrong');
});

test('an over-the-top ingredient line reports its own line number', () => {
  const { items, errors, warnings } = parseIngredientLines(
    'Linsen | 120 | g | dry-goods\nHähnchenbrust | 5000 | g | meat-fish');
  assert.ok(errors.some((e) => /Line 2/.test(e)), errors.join(' | '));
  assert.equal(items.length, 1, 'the impossible line is dropped, the good one kept');
  assert.deepEqual(warnings, []);
});

test('a borderline ingredient line warns but is still bought', () => {
  const { items, errors, warnings } = parseIngredientLines('Kartoffeln | 1200 | g | produce');
  assert.deepEqual(errors, []);
  assert.equal(items.length, 1);
  assert.ok(warnings.some((w) => /Line 1/.test(w)), warnings.join(' | '));
});

test('the form is not told the same thing twice', () => {
  // The textarea already warned with a line number, so validateRecipe stays quiet
  // about the amount -- but still refuses one that is impossible.
  const big = [{ item: 'Rinderbraten', qty: 1200, unit: 'g', aisle: 'meat-fish' }];
  const loud = validateRecipe({ ...DRAFT, kcal: 950, protein: 70, minutes: 120, ingredients: big });
  const quiet = validateRecipe({ ...DRAFT, kcal: 950, protein: 70, minutes: 120, ingredients: big }, { amountsChecked: true });
  assert.equal(loud.ok, true);
  assert.ok(loud.warnings.some((w) => /1200 g of Rinderbraten/.test(w)), loud.warnings.join(' | '));
  assert.equal(quiet.ok, true);
  assert.deepEqual(quiet.warnings, []);

  const absurd = validateRecipe(
    { ...DRAFT, ingredients: [{ item: 'Linsen', qty: 5000, unit: 'g', aisle: 'dry-goods' }] },
    { amountsChecked: true },
  );
  assert.equal(absurd.ok, false, 'an impossible amount is refused even when the lines were checked');
});

test('an unusual calorie count for the slot warns without blocking', () => {
  const res = validateRecipe({ ...DRAFT, slot: 'snack', kcal: 900, protein: 40 });
  assert.ok(res.ok, res.errors.join(' | '));
  assert.ok(res.warnings.some((w) => /snack/i.test(w)), res.warnings.join(' | '));
});

// ---------- The live library ----------
test('the library is the built-ins until something is added', () => {
  assert.deepEqual(customRecipes(), []);
  assert.equal(allRecipes().length, RECIPES.length);
  assert.equal(allRecipes(), RECIPES, 'no copy is made when there is nothing to add');
});

test('an added recipe is findable everywhere the built-ins are', () => {
  const { recipe } = validateRecipe(DRAFT);
  setCustomRecipes([recipe]);
  assert.equal(recipeById(recipe.id).name, 'Omas Linsensuppe');
  assert.ok(bySlot('dinner').some((r) => r.id === recipe.id));
  assert.ok(byTag('custom').some((r) => r.id === recipe.id));
  assert.equal(isCustomRecipe(recipe.id), true);
  assert.equal(isCustomRecipe('b-skyr-beeren-nuss'), false);
});

test('rubbish in stored memory is dropped, not crashed on', () => {
  assert.deepEqual(setCustomRecipes([{ name: 'nope' }, null, 'x']), []);
  assert.deepEqual(setCustomRecipes(undefined), []);
  assert.equal(allRecipes().length, RECIPES.length);
});

test('two recipes with the same name get different ids, so neither is lost', () => {
  const a = validateRecipe({ ...DRAFT, id: null }).recipe;
  const b = validateRecipe({ ...DRAFT, id: null }).recipe;
  const stored = setCustomRecipes([a, b]);
  assert.equal(stored.length, 2);
  assert.equal(new Set(stored.map((r) => r.id)).size, 2);
  for (const r of stored) assert.equal(recipeById(r.id)?.id, r.id, 'both must be reachable');
});

test('a custom id can never shadow a built-in', () => {
  const stored = setCustomRecipes([{ ...DRAFT, id: 'b-skyr-beeren-nuss' }]);
  assert.ok(!stored.some((r) => r.id === 'b-skyr-beeren-nuss'));
  assert.equal(recipeById('b-skyr-beeren-nuss').name, RECIPES.find((r) => r.id === 'b-skyr-beeren-nuss').name);
});

// ---------- Through the memory verbs ----------
test('addCustomRecipe returns errors for the form instead of swallowing the input', () => {
  const res = addCustomRecipe({ custom: [] }, { name: '' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.length);
  assert.deepEqual(res.memory.custom, []);
});

test('addCustomRecipe puts it in memory AND in the live library in one step', () => {
  const { ok, memory, recipe } = addCustomRecipe({ custom: [] }, DRAFT);
  assert.ok(ok);
  assert.equal(memory.custom.length, 1);
  assert.equal(recipeById(recipe.id)?.name, 'Omas Linsensuppe');
});

test('editing a recipe replaces it rather than adding a near-duplicate', () => {
  const first = addCustomRecipe({ custom: [] }, DRAFT);
  const second = addCustomRecipe(first.memory, { ...DRAFT, id: first.recipe.id, protein: 33 });
  assert.equal(second.memory.custom.length, 1);
  assert.equal(recipeById(first.recipe.id).protein, 33);
});

test('removing a recipe takes it out of the library too', () => {
  const { memory, recipe } = addCustomRecipe({ custom: [] }, DRAFT);
  const after = removeCustomRecipe(memory, recipe.id);
  assert.deepEqual(after.custom, []);
  assert.equal(recipeById(recipe.id), undefined);
});

// ---------- It has to actually work end to end ----------
test('a custom recipe can be planned and lands on the shopping list', () => {
  // Ban every built-in dinner, so the only dinner left is ours.
  const { recipe } = validateRecipe({ ...DRAFT, kcal: 700, protein: 45 });
  setCustomRecipes([recipe]);
  const settings = defaultSettings();
  const banned = RECIPES.filter((r) => r.slot === 'dinner').map((r) => r.id);
  const plan = generateWeek(settings, { banned });
  let used = 0;
  forEachEntry(plan, (e) => { if (e.recipeId === recipe.id) used += 1; });
  assert.ok(used > 0, 'the only remaining dinner must get used');
  const items = shoppingList(plan).flatMap((g) => g.items.map((i) => i.item));
  assert.ok(items.includes('Linsen'), `Linsen missing from ${items.join(', ')}`);
});

// ---------- Shops ----------
test('the default shops cover every aisle exactly once', () => {
  const covered = DEFAULT_SHOPS.flatMap((s) => s.aisles);
  assert.deepEqual([...covered].sort(), [...AISLES].sort(), 'every aisle needs exactly one shop');
});

// ---------- Bulk import: typing twelve recipes one form at a time is how a feature dies ----------

const BLOCK = (over = {}) => [
  `Name: ${over.name ?? 'Ofen-Feta mit Tomaten'}`,
  `Meal: ${over.slot ?? 'dinner'}`,
  `Cuisine: ${over.cuisine ?? 'mediterranean'}`,
  `Minutes: ${over.minutes ?? 25}`,
  `Kcal: ${over.kcal ?? 640}`,
  `Protein: ${over.protein ?? 32}`,
  'Ingredients:',
  over.ingredients ?? 'Feta | 200 | g | dairy\nKirschtomaten | 400 | g | produce',
  'Method:',
  over.method ?? 'Heat the oven to 200 C.\nRoast everything for 20 minutes.',
].join('\n');

test('a pasted block of several recipes imports in one go', () => {
  const text = [
    BLOCK(),
    BLOCK({ name: 'Skyr mit Beeren', slot: 'breakfast', kcal: 380, protein: 30, minutes: 5, cuisine: 'northern', ingredients: 'Skyr | 300 | g | dairy', method: 'Umruehren.' }),
    BLOCK({ name: 'Harzer auf Roggen', slot: 'snack', kcal: 220, protein: 24, minutes: 3, cuisine: 'northern', ingredients: 'Harzer Kaese | 60 | g | dairy\nRoggenbrot | 40 | g | bakery', method: 'Belegen.' }),
  ].join('\n---\n');

  const { recipes, errors } = parseRecipeBlocks(text);
  assert.deepEqual(errors, []);
  assert.equal(recipes.length, 3);
  assert.deepEqual(recipes.map((r) => r.name), ['Ofen-Feta mit Tomaten', 'Skyr mit Beeren', 'Harzer auf Roggen']);
  assert.deepEqual(recipes.map((r) => r.slot), ['dinner', 'breakfast', 'snack']);
  assert.equal(recipes[0].ingredients.length, 2);
  assert.deepEqual(recipes[1].method, ['Umruehren.']);
  // The same silent tags the single form adds, for the same reason.
  assert.ok(recipes[0].tags.includes('custom'));
});

test('one bad recipe is named and the rest still import', () => {
  // setCustomRecipes drops anything invalid without a word, so an importer that
  // just handed it the batch would lose rows silently. That is the whole point.
  const text = [
    BLOCK(),
    BLOCK({ name: '', kcal: 500 }),
    BLOCK({ name: 'Linsendal', kcal: 520, protein: 28, ingredients: 'Rote Linsen | 100 | g | dry-goods', method: 'Kochen.' }),
  ].join('\n---\n');
  const { recipes, errors } = parseRecipeBlocks(text);
  assert.equal(recipes.length, 2, 'the two good ones must still arrive');
  assert.ok(errors.length >= 1);
  assert.ok(errors.some((e) => /recipe 2|line 1[0-9]/i.test(e)), errors.join(' | '));
});

test('a failing row says which line it is on, so it can be found in the paste', () => {
  const text = [BLOCK(), BLOCK({ name: 'Zu viel Huhn', ingredients: 'Haehnchenbrust | 5000 | g | meat-fish' })].join('\n---\n');
  const { recipes, errors } = parseRecipeBlocks(text);
  assert.equal(recipes.length, 1);
  assert.ok(errors.some((e) => /Zu viel Huhn/.test(e)), 'the recipe must be named');
  assert.ok(errors.some((e) => /line \d+/i.test(e)), 'and the line found');
  // Same bound, same words as the single-recipe form.
  assert.ok(errors.some((e) => /not possible/i.test(e)), errors.join(' | '));
});

test('a merely odd row warns and still imports', () => {
  const text = BLOCK({ name: 'Sonntagsbraten', minutes: 120, kcal: 950, protein: 70, ingredients: 'Rinderbraten | 1200 | g | meat-fish', method: 'Braten.' });
  const { recipes, errors, warnings } = parseRecipeBlocks(text);
  assert.deepEqual(errors, []);
  assert.equal(recipes.length, 1);
  assert.ok(warnings.some((w) => /1200 g/.test(w)), warnings.join(' | '));
  assert.ok(warnings.some((w) => /Sonntagsbraten/.test(w)), 'a warning must say which recipe');
});

test('an empty or unrecognisable paste explains itself', () => {
  assert.ok(parseRecipeBlocks('').errors.length > 0);
  assert.ok(parseRecipeBlocks('   \n\n  ').errors.length > 0);
  const junk = parseRecipeBlocks('just some notes I pasted by accident');
  assert.equal(junk.recipes.length, 0);
  assert.ok(junk.errors.length > 0, 'silence would look like it worked');
});

test('importing twice does not overwrite the first copy', () => {
  const text = BLOCK();
  const first = importRecipes({ custom: [] }, text);
  assert.equal(first.added, 1);
  const second = importRecipes(first.memory, text);
  assert.equal(second.added, 1);
  assert.equal(second.memory.custom.length, 2, 'the second paste must not replace the first');
  const ids = second.memory.custom.map((r) => r.id);
  assert.equal(new Set(ids).size, 2, `ids collided: ${ids.join(', ')}`);
});

test('an id that collides with a built-in recipe is given its own', () => {
  const builtIn = RECIPES[0];
  const text = BLOCK({
    name: builtIn.name, slot: builtIn.slot, kcal: builtIn.kcal,
    protein: builtIn.protein, minutes: builtIn.minutes,
  });
  const res = importRecipes({ custom: [] }, text);
  assert.equal(res.added, 1);
  assert.notEqual(res.memory.custom[0].id, builtIn.id);
  assert.ok(recipeById(builtIn.id), 'the built-in must still be findable');
});

test('the export file we already write imports as recipes', () => {
  // Moving a recipe between the two of us before increment C lands: export, send
  // the file, import. Pasting the whole state must not need a second format.
  const exported = JSON.stringify({
    schema: 3,
    memory: { custom: [validateRecipe({ ...DRAFT, name: 'Geteiltes Rezept' }).recipe], banned: [] },
    settings: { people: [] },
  });
  const { recipes, errors } = parseRecipeBlocks(exported);
  assert.deepEqual(errors, []);
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].name, 'Geteiltes Rezept');
});

test('a bare JSON array of recipes imports too', () => {
  const arr = JSON.stringify([
    validateRecipe({ ...DRAFT, name: 'Eins' }).recipe,
    validateRecipe({ ...DRAFT, name: 'Zwei', kcal: 500 }).recipe,
  ]);
  const { recipes, errors } = parseRecipeBlocks(arr);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes.map((r) => r.name), ['Eins', 'Zwei']);
});

test('a JSON file with nothing importable in it says so', () => {
  const { recipes, errors } = parseRecipeBlocks('{"settings":{"people":[]},"weights":[]}');
  assert.equal(recipes.length, 0);
  assert.ok(errors.some((e) => /recipe/i.test(e)), errors.join(' | '));
});

test('imported recipes are immediately usable by the planner', () => {
  const text = BLOCK({ name: 'Import-Teller', slot: 'dinner', kcal: 600, protein: 40, minutes: 20 });
  const res = importRecipes({ custom: [] }, text);
  assert.equal(res.added, 1);
  const id = res.memory.custom[0].id;
  assert.ok(recipeById(id), 'the live library must already know it');
  assert.ok(bySlot('dinner').some((r) => r.id === id));
});

test('a refused ingredient line is not also reported as a missing one', () => {
  const parsed = parseIngredientLines('Haehnchenbrust | 5000 | g | meat-fish');
  assert.deepEqual(parsed.items, [], 'an impossible amount must not reach the shopping list');

  const res = validateRecipe({ ...DRAFT, ingredients: parsed.items },
    { amountsChecked: true, ingredientsRejected: parsed.errors.length > 0 });
  assert.equal(res.ok, false, 'a recipe with nothing left to cook must still be refused');
  assert.ok(!res.errors.some((e) => /needs at least one ingredient/.test(e)),
    `the line was typed and refused -- calling it missing sends you looking in the wrong place: ${res.errors.join(' | ')}`);
  assert.ok(res.errors.some((e) => /None of the ingredient lines/.test(e)), res.errors.join(' | '));

  // With nothing typed at all, the plain message is still the right one.
  const empty = validateRecipe({ ...DRAFT, ingredients: [] }, { amountsChecked: true });
  assert.ok(empty.errors.some((e) => /at least one ingredient/.test(e)), empty.errors.join(' | '));
});

test('an impossible amount in a paste is explained once, not twice', () => {
  const { errors } = parseRecipeBlocks(BLOCK({ name: 'Zu viel Huhn', ingredients: 'Haehnchenbrust | 5000 | g | meat-fish' }));
  assert.ok(!errors.some((e) => /needs at least one ingredient/.test(e)),
    `the ingredient was typed, so "missing" is the wrong complaint: ${errors.join(' | ')}`);
  assert.ok(errors.some((e) => /None of the ingredient lines/.test(e)), errors.join(' | '));
  assert.ok(errors.some((e) => /not possible/.test(e)), errors.join(' | '));
});
