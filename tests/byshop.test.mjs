import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shoppingList, shoppingItems, shoppingByShop, shopFor, pantryCheck, pantrySaving,
} from '../src/shopping.js';
import { defaultSettings, generateWeek, pantryKey } from '../src/planner.js';
import { DEFAULT_SHOPS, AISLES } from '../src/recipes.js';

const S = defaultSettings();
const plan = generateWeek(S, { banned: [] });
const items = shoppingItems(plan);
const flatten = (byShop) => byShop.flatMap((s) => s.groups.flatMap((g) => g.items));

// ---------- The keys have to agree ----------
test('a list item id IS its pantry key, so ticking one can never miss the other', () => {
  for (const i of items) {
    assert.equal(i.id, pantryKey({ item: i.item, unit: i.rawUnit }), `${i.item} keys disagree`);
  }
});

// ---------- Splitting the trip ----------
test('every item lands in exactly one shop, and nothing is lost on the way', () => {
  const byShop = shoppingByShop(plan, { shops: DEFAULT_SHOPS });
  const got = flatten(byShop).map((i) => i.id).sort();
  assert.deepEqual(got, items.map((i) => i.id).sort());
  assert.equal(new Set(got).size, got.length, 'nothing may appear in two shops');
});

test('both shops get a real share of the list — the split is worth making', () => {
  const byShop = shoppingByShop(plan, { shops: DEFAULT_SHOPS });
  for (const s of byShop) assert.ok(s.count > 0, `${s.shop.name} got nothing`);
  assert.equal(byShop.reduce((n, s) => n + s.count, 0), items.length);
});

test('shops keep their configured order, and aisles keep supermarket order inside them', () => {
  const byShop = shoppingByShop(plan, { shops: DEFAULT_SHOPS });
  assert.deepEqual(byShop.map((s) => s.shop.id), DEFAULT_SHOPS.map((s) => s.id));
  for (const s of byShop) {
    const order = s.groups.map((g) => g.aisle);
    assert.deepEqual(order, [...order].sort((a, b) => AISLES.indexOf(a) - AISLES.indexOf(b)),
      `${s.shop.name} aisles out of order`);
  }
});

test('staples go to the discounter and fresh food to the supermarket', () => {
  const byShop = shoppingByShop(plan, { shops: DEFAULT_SHOPS });
  const discount = byShop.find((s) => s.shop.id === 'discount');
  const superm = byShop.find((s) => s.shop.id === 'super');
  assert.ok(discount.groups.every((g) => ['dry-goods', 'pantry', 'frozen', 'drinks'].includes(g.aisle)));
  assert.ok(superm.groups.every((g) => ['produce', 'meat-fish', 'dairy', 'bakery'].includes(g.aisle)));
});

test('a per-item override beats the aisle rule, because real habits are not tidy', () => {
  const list = shoppingList(plan);
  const produce = list.find((g) => g.aisle === 'produce').items[0];
  const byShop = shoppingByShop(plan, { shops: DEFAULT_SHOPS, itemShop: { [produce.id]: 'discount' } });
  const discount = byShop.find((s) => s.shop.id === 'discount');
  assert.ok(flatten([discount]).some((i) => i.id === produce.id), 'override ignored');
  const superm = byShop.find((s) => s.shop.id === 'super');
  assert.ok(!flatten([superm]).some((i) => i.id === produce.id), 'item ended up in both shops');
});

test('an override naming a shop that no longer exists falls back instead of vanishing', () => {
  const byShop = shoppingByShop(plan, { shops: DEFAULT_SHOPS, itemShop: { [items[0].id]: 'turkish-shop' } });
  assert.equal(flatten(byShop).length, items.length);
});

test('shopFor is the single rule both the list and the settings screen use', () => {
  const one = { id: 'x-g', aisle: 'produce' };
  assert.equal(shopFor(one, DEFAULT_SHOPS), 'super');
  assert.equal(shopFor({ id: 'x-g', aisle: 'dry-goods' }, DEFAULT_SHOPS), 'discount');
  assert.equal(shopFor(one, DEFAULT_SHOPS, { 'x-g': 'discount' }), 'discount');
});

test('one shop configured means one list, not a broken one', () => {
  const single = [{ id: 'rewe', name: 'Rewe', aisles: AISLES }];
  const byShop = shoppingByShop(plan, { shops: single });
  assert.equal(byShop.length, 1);
  assert.equal(byShop[0].count, items.length);
});

test('a shop with no aisles at all still gets a heading, and nothing is dropped', () => {
  const shops = [{ id: 'kiosk', name: 'Kiosk', aisles: [] }, ...DEFAULT_SHOPS];
  const byShop = shoppingByShop(plan, { shops });
  assert.equal(byShop.length, 3);
  assert.equal(byShop.find((s) => s.shop.id === 'kiosk').count, 0);
  assert.equal(flatten(byShop).length, items.length);
});

test('no shops configured falls back to the defaults rather than an empty list', () => {
  assert.equal(flatten(shoppingByShop(plan, { shops: [] })).length, items.length);
  assert.equal(flatten(shoppingByShop(plan)).length, items.length);
});

test('an aisle nobody claimed still gets bought somewhere', () => {
  const shops = [{ id: 'a', name: 'A', aisles: ['produce'] }, { id: 'b', name: 'B', aisles: ['dairy'] }];
  const byShop = shoppingByShop(plan, { shops });
  assert.equal(flatten(byShop).length, items.length, 'orphaned aisles must not disappear');
});

// ---------- The pantry ----------
test('what you already have drops off the buy list', () => {
  const first = items[0];
  const pantry = { [first.id]: first.rawQty };
  const byShop = shoppingByShop(plan, { shops: DEFAULT_SHOPS, pantry });
  assert.ok(!flatten(byShop).some((i) => i.id === first.id), `${first.item} is still on the list`);
  assert.equal(flatten(byShop).length, items.length - 1);
});

test('it moves to "check you still have" rather than disappearing', () => {
  const first = items[0];
  const check = pantryCheck(plan, { pantry: { [first.id]: first.rawQty } });
  assert.equal(check.length, 1);
  assert.equal(check[0].id, first.id);
  assert.equal(check[0].short, false, 'you have enough, so it is only a check');
});

test('having less than the week needs is flagged, and flagged first', () => {
  const [a, b] = items;
  const check = pantryCheck(plan, { pantry: { [a.id]: 1, [b.id]: b.rawQty * 10 } });
  assert.equal(check.length, 2);
  assert.equal(check[0].id, a.id, 'the one you are short of has to be at the top');
  assert.equal(check[0].short, true);
  assert.equal(check[1].short, false);
});

test('the list carries how much you have, so the UI can say it', () => {
  const first = items[0];
  const list = shoppingList(plan, { pantry: { [first.id]: 3 } });
  const row = list.flatMap((g) => g.items).find((i) => i.id === first.id);
  assert.equal(row.have, 3);
});

test('a nonsense pantry amount is treated as not having it', () => {
  const first = items[0];
  for (const q of [0, -1, 'some', null, undefined]) {
    const row = shoppingItems(plan, { pantry: { [first.id]: q } }).find((i) => i.id === first.id);
    assert.equal(row.have, 0, `${q} should not count as stock`);
    assert.ok(flatten(shoppingByShop(plan, { pantry: { [first.id]: q } })).some((i) => i.id === first.id));
  }
});

test('no pantry at all means the list is exactly as it was before v2', () => {
  assert.equal(shoppingItems(plan).length, items.length);
  assert.deepEqual(pantryCheck(plan, {}), []);
  assert.ok(shoppingItems(plan).every((i) => i.have === 0));
});

test('the saving line adds up, so it can be trusted on screen', () => {
  const [a, b] = items;
  const saving = pantrySaving(plan, { pantry: { [a.id]: 5, [b.id]: 5 } });
  assert.equal(saving.total, items.length);
  assert.equal(saving.have, 2);
  assert.equal(saving.buy, items.length - 2);
});

test('having everything in means nothing to buy at all — and the app can say so', () => {
  const pantry = {};
  for (const i of items) pantry[i.id] = i.rawQty;
  assert.equal(flatten(shoppingByShop(plan, { pantry })).length, 0);
  assert.equal(pantryCheck(plan, { pantry }).length, items.length);
  assert.equal(pantrySaving(plan, { pantry }).buy, 0);
});
