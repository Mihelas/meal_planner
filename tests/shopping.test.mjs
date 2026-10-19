import test from 'node:test';
import assert from 'node:assert/strict';
import { shoppingList, packSize, roundUpToPack } from '../src/shopping.js';
import { defaultSettings, generateWeek, portionsByRecipe } from '../src/planner.js';
import { recipeById, AISLES, AISLE_LABEL } from '../src/recipes.js';

const S = defaultSettings();
const plan = generateWeek(S, { banned: [] });
const list = shoppingList(plan);
const flat = list.flatMap((g) => g.items);

test('the list is grouped by supermarket aisle, in walk order', () => {
  for (const g of list) {
    assert.ok(AISLES.includes(g.aisle), `unknown aisle ${g.aisle}`);
    assert.equal(g.label, AISLE_LABEL[g.aisle]);
    assert.ok(g.items.length > 0, `empty aisle group ${g.aisle}`);
  }
  const order = list.map((g) => g.aisle);
  assert.deepEqual(order, [...order].sort((a, b) => AISLES.indexOf(a) - AISLES.indexOf(b)));
});

test('every line has a name, a quantity, a unit and a stable id', () => {
  const ids = new Set();
  for (const it of flat) {
    assert.ok(it.item && it.item.length > 1, 'nameless line');
    assert.ok(it.qty > 0, `${it.item}: qty ${it.qty}`);
    assert.ok(it.unit, `${it.item}: no unit`);
    assert.ok(it.id && !ids.has(it.id), `${it.item}: duplicate or missing id`);
    ids.add(it.id);
  }
});

test('the same ingredient from different recipes is merged into one line', () => {
  const names = flat.map((i) => `${i.item}|${i.unit}`);
  assert.equal(new Set(names).size, names.length, 'the same item appears on two lines');
  const merged = flat.filter((i) => i.recipes.length > 1);
  assert.ok(merged.length >= 3, `only ${merged.length} merged lines — the merge is not working`);
});

test('each line says which meals it is for, so a cut can be traced', () => {
  for (const it of flat) {
    assert.ok(Array.isArray(it.recipes) && it.recipes.length > 0, `${it.item}: no source recipes`);
    for (const id of it.recipes) assert.ok(recipeById(id), `${it.item}: unknown source ${id}`);
  }
});

test('quantities are the week\'s portions, not one portion', () => {
  const portions = portionsByRecipe(plan);
  // Pick a recipe that is definitely cooked, and check one of its ingredients scaled up.
  const dinner = plan.days.find((d) => d.dinner.kind === 'recipe').dinner;
  const r = recipeById(dinner.recipeId);
  const n = portions.get(r.id);
  assert.ok(n > 1, 'a dinner should be cooked for more than one portion');
  const ing = r.ingredients[0];
  // Match on rawUnit: the display unit may have rolled up from g to kg.
  const line = flat.find((i) => i.item === ing.item && i.rawUnit === ing.unit);
  assert.ok(line, `${ing.item} never made it onto the list`);
  assert.ok(line.rawQty >= Math.floor(ing.qty * n), `${ing.item}: ${line.rawQty} is less than the ${n} portions need`);
});

test('nothing on the list is unattached to a meal in the plan', () => {
  const planned = new Set([...portionsByRecipe(plan).keys()]);
  for (const it of flat) {
    for (const id of it.recipes) assert.ok(planned.has(id), `${it.item} comes from ${id}, which is not in the plan`);
  }
});

test('grams roll up into kilos so the list reads like a shopping list', () => {
  for (const it of flat) {
    if (it.unit === 'g') assert.ok(it.qty < 1000, `${it.item}: ${it.qty} g should be shown in kg`);
    if (it.unit === 'ml') assert.ok(it.qty < 1000, `${it.item}: ${it.qty} ml should be shown in l`);
  }
  assert.ok(flat.some((i) => i.unit === 'kg' || i.unit === 'l'), 'nothing rolled up at all');
});

test('quantities round up to something you can actually buy', () => {
  assert.equal(roundUpToPack(137, 'g'), 150);
  assert.equal(roundUpToPack(1040, 'g'), 1050);
  assert.equal(roundUpToPack(2.3, 'Stk'), 3);
  assert.equal(roundUpToPack(0.4, 'Stk'), 1);
  assert.ok(packSize('g') > 0 && packSize('ml') > 0);
});

test('eat-out and canteen meals buy nothing', () => {
  const s = { ...S, eatOut: [{ day: 0, slot: 'dinner' }, { day: 1, slot: 'dinner' }] };
  const p = generateWeek(s, { banned: [] });
  const l = shoppingList(p).flatMap((g) => g.items);
  assert.ok(l.length > 0, 'the rest of the week still needs shopping');
  for (const it of l) assert.ok(it.recipes.every((id) => recipeById(id)), 'a guidance card generated a shopping line');
});

test('a leftover lunch does not buy the ingredients twice', () => {
  const day = plan.days.findIndex((d) => d.lunch.person1.kind === 'leftover');
  assert.ok(day > 0, 'the fixture has no leftover lunch to check');
  const id = plan.days[day].lunch.person1.recipeId;
  const r = recipeById(id);
  const portions = portionsByRecipe(plan).get(id);
  const ing = r.ingredients[0];
  const line = flat.find((i) => i.item === ing.item && i.rawUnit === ing.unit);
  const others = plan.days.flatMap((d) => [d.breakfast, d.dinner, d.snackAfternoon, d.snackEvening,
    d.lunch.person1, d.lunch.person2])
    .filter((e) => e.recipeId && recipeById(e.recipeId).ingredients.some((x) => x.item === ing.item));
  // If this ingredient is unique to this recipe, the line must equal exactly its portions.
  if (others.every((e) => e.recipeId === id)) {
    const expected = roundUpToPack(ing.qty * portions, ing.unit);
    assert.ok(Math.abs(line.rawQty - expected) < 1, `${ing.item}: ${line.rawQty} vs expected ${expected}`);
  }
});

test('the list has a sane size for a week for two', () => {
  assert.ok(flat.length >= 30, `only ${flat.length} items for a whole week`);
  assert.ok(flat.length <= 120, `${flat.length} items is not a shopping list, it is a novel`);
});

test('a banned-out plan still produces a usable list', () => {
  const p = generateWeek(S, { banned: plan.days.map((d) => d.dinner.recipeId).filter(Boolean) });
  assert.ok(shoppingList(p).flatMap((g) => g.items).length > 10);
});
