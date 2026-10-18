// The shopping list.
//
// One pass over the week: every recipe's per-portion ingredients multiplied by the
// portions the plan actually cooks, merged by (item, unit), rounded up to something
// you can put in a trolley, and grouped in the order you walk a German supermarket.
//
// Leftovers cost nothing extra here, because a leftover lunch and the dinner it
// came from share one recipe id — the portions simply add up.
//
// Two v2 additions, both of which only ever REMOVE work from the trip:
//   - by shop: the discounter run and the supermarket run are different errands,
//     so the list splits into them (aisle -> shop, with a per-item override).
//   - pantry: anything already ticked in drops off the buy list and moves to a
//     short "check you still have" list, because buying rice you own is the
//     failure mode of every shopping app.

import { recipeById, AISLES, AISLE_LABEL, DEFAULT_SHOPS } from './recipes.js';
import { portionsByRecipe, planForDays, pantryKey } from './planner.js';

/** Smallest increment worth writing on a list. No one buys 137 g of anything. */
export function packSize(unit) {
  switch (unit) {
    case 'g': return 50;
    case 'ml': return 50;
    case 'Stk': return 1;
    default: return 1;
  }
}

export function roundUpToPack(qty, unit) {
  const step = packSize(unit);
  return Math.ceil((qty - 1e-9) / step) * step;
}

/** 1400 g reads better as 1.4 kg. */
function display(qty, unit) {
  if (unit === 'g' && qty >= 1000) return { qty: Math.round((qty / 1000) * 100) / 100, unit: 'kg' };
  if (unit === 'ml' && qty >= 1000) return { qty: Math.round((qty / 1000) * 100) / 100, unit: 'l' };
  return { qty: Math.round(qty * 100) / 100, unit };
}

/**
 * @param plan a plan from generateWeek
 * @param opts { pantry } — what you already have, keyed as in the pantry tab
 * @param opts { days } - the day positions to shop for. Absent means the whole
 *   week; an empty array means nothing is selected, so nothing is on the list.
 * @returns [{ aisle, label, items: [{ id, item, qty, unit, aisle, recipes[], rawQty, rawUnit, have }] }]
 */
export function shoppingList(plan, { pantry = null, days = null } = {}) {
  // An absent selection is the whole week. An EMPTY array is a real choice:
  // nothing selected, so there is nothing to buy.
  const portions = portionsByRecipe(days ? planForDays(plan, days) : plan);
  const merged = new Map();

  for (const [recipeId, n] of portions) {
    const r = recipeById(recipeId);
    if (!r) continue; // a guidance card, or a recipe removed by an update
    for (const ing of r.ingredients) {
      const key = `${ing.item}|${ing.unit}`;
      const row = merged.get(key) ?? {
        item: ing.item, unit: ing.unit, aisle: ing.aisle, qty: 0, recipes: [],
      };
      row.qty += ing.qty * n;
      if (!row.recipes.includes(recipeId)) row.recipes.push(recipeId);
      merged.set(key, row);
    }
  }

  const groups = new Map();
  for (const row of merged.values()) {
    const rawQty = roundUpToPack(row.qty, row.unit);
    const shown = display(rawQty, row.unit);
    // The id IS the pantry key: one function, so ticking "I have olive oil" can
    // never fail to match the olive oil on the list.
    const id = pantryKey(row);
    const item = {
      id,
      item: row.item,
      qty: shown.qty,
      unit: shown.unit,
      rawQty,
      rawUnit: row.unit,
      aisle: row.aisle,
      recipes: row.recipes,
      have: Number(pantry?.[id]) > 0 ? Number(pantry[id]) : 0,
    };
    if (!groups.has(row.aisle)) groups.set(row.aisle, []);
    groups.get(row.aisle).push(item);
  }

  return AISLES
    .filter((a) => groups.has(a))
    .map((a) => ({
      aisle: a,
      label: AISLE_LABEL[a],
      items: groups.get(a).sort((x, y) => x.item.localeCompare(y.item, 'de')),
    }));
}

/** Flat view, for the "already have" checkbox state and for export. */
export function shoppingItems(plan, opts = {}) {
  return shoppingList(plan, opts).flatMap((g) => g.items);
}

// ------------------------------------------------------------------- by shop
/** Which shop an item belongs to: the per-item override first, then its aisle. */
export function shopFor(item, shops = DEFAULT_SHOPS, itemShop = {}) {
  const override = itemShop?.[item.id];
  if (override && shops.some((s) => s.id === override)) return override;
  const byAisle = shops.find((s) => (s.aisles ?? []).includes(item.aisle));
  return byAisle?.id ?? shops[0]?.id ?? 'super';
}

/**
 * The same list, split into the errands it actually is.
 *
 * Shops keep the order they are configured in — the discounter first by default,
 * because that is the order the trip happens in and the staples are the bulk of
 * the trolley. Aisles keep supermarket order within each shop.
 *
 * @returns [{ shop, groups: [...aisle groups], count }]
 */
export function shoppingByShop(
  plan, { shops = DEFAULT_SHOPS, itemShop = {}, pantry = null, days = null } = {},
) {
  const list = shops.length ? shops : DEFAULT_SHOPS;
  const buckets = new Map(list.map((s) => [s.id, new Map()]));

  for (const group of shoppingList(plan, { pantry, days })) {
    for (const item of group.items) {
      if (item.have > 0) continue; // it is in the cupboard; see pantryCheck()
      const shopId = shopFor(item, list, itemShop);
      const byAisle = buckets.get(shopId) ?? buckets.get(list[0].id);
      if (!byAisle.has(group.aisle)) byAisle.set(group.aisle, []);
      byAisle.get(group.aisle).push(item);
    }
  }

  return list.map((shop) => {
    const byAisle = buckets.get(shop.id) ?? new Map();
    const groups = AISLES
      .filter((a) => byAisle.has(a))
      .map((a) => ({ aisle: a, label: AISLE_LABEL[a], items: byAisle.get(a) }));
    return { shop, groups, count: groups.reduce((n, g) => n + g.items.length, 0) };
  });
}

/**
 * What the week needs that you have already ticked as in stock. Shown as a short
 * "check you still have" list rather than dropped silently, because a half-empty
 * jar of tahini is the difference between a plan and a takeaway.
 */
export function pantryCheck(plan, { pantry = null, days = null } = {}) {
  if (!pantry) return [];
  return shoppingItems(plan, { pantry, days })
    .filter((i) => i.have > 0)
    .map((i) => ({ ...i, short: i.rawQty > i.have }))
    .sort((a, b) => Number(b.short) - Number(a.short) || a.item.localeCompare(b.item, 'de'));
}

/** How much of the trip the pantry saved, for the one line above the list. */
export function pantrySaving(plan, { pantry = null, days = null } = {}) {
  const items = shoppingItems(plan, { pantry, days });
  const have = items.filter((i) => i.have > 0).length;
  return { total: items.length, have, buy: items.length - have };
}

/**
 * The cook-ahead summary: what to batch and when, so Friday at 22:00 and every
 * "we have no time" lunch are already solved before the week starts.
 */
export function prepPlan(plan) {
  const jobs = [];
  for (const d of plan.days) {
    if (d.dinner.kind !== 'recipe') continue;
    const r = recipeById(d.dinner.recipeId);
    if (!r) continue;
    if (r.tags.includes('post-football')) {
      jobs.push({
        day: d.index, recipeId: r.id,
        what: `Make ${r.name} ahead of time and leave it in the fridge.`,
        why: 'You get in at 22:00 after football. This only works if the food already exists.',
      });
    }
    if (r.tags.includes('batch')) {
      jobs.push({
        day: d.index, recipeId: r.id,
        what: `${r.name} batches well — cook the full pot and freeze the spare portions.`,
        why: 'A freezer portion is the answer the week after next, when the plan slips.',
      });
    }
  }
  for (const d of plan.days) {
    const b = d.breakfast;
    if (b.kind === 'recipe' && recipeById(b.recipeId)?.tags.includes('make-ahead')) {
      jobs.push({
        day: d.index, recipeId: b.recipeId,
        what: `${recipeById(b.recipeId).name} is made the night before.`,
        why: 'Five minutes on Sunday evening removes a decision from a rushed morning.',
      });
    }
  }
  return jobs;
}
