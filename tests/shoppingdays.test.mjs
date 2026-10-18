// A shopping list for part of the week.
//
// You do not always shop for seven days. The list can be cut to a chosen set of
// days, and the rule that makes it honest is this: a reheat is not a thing you
// buy. A Monday lunch that is Sunday's leftovers was paid for in Sunday's
// ingredients, so it only belongs on the list when Sunday is in the slice too.
//
// Days are POSITIONS here, like everywhere else in the app, so this works
// unchanged whatever day the week starts on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSettings, generateWeek, shoppingSlice, planForDays, SLOT_KEYS, isEntry,
} from '../src/planner.js';
import { shoppingList, shoppingItems, shoppingByShop } from '../src/shopping.js';
import { migrate } from '../src/store.js';
import { open } from './harness.mjs';

const S = defaultSettings();
const plan = generateWeek(S, { banned: [] });
const ALL = [0, 1, 2, 3, 4, 5, 6];

const totalOf = (items) => items.reduce((a, i) => a + i.rawQty, 0);
const byId = (items) => new Map(items.map((i) => [i.id, i]));
/** Every entry on a day, flattening the per-person slots. */
const entriesOf = (day) => SLOT_KEYS.flatMap((k) => {
  const v = day[k];
  if (!v) return [];
  return isEntry(v) ? [v] : Object.values(v).filter(isEntry);
});

// ---------- the setting ----------

test('the whole week is on the list until days are deselected', () => {
  assert.deepEqual(S.shoppingDays, ALL);
  assert.deepEqual(shoppingSlice(S), ALL);
});

test('a missing or junk selection means the whole week, not an empty list', () => {
  for (const bad of [undefined, null, 'all', 3, {}]) {
    assert.deepEqual(shoppingSlice({ shoppingDays: bad }), ALL,
      `shoppingDays ${String(bad)} should read as the whole week`);
  }
  assert.deepEqual(shoppingSlice(undefined), ALL);
});

test('a deliberately empty selection stays empty, and junk inside is dropped', () => {
  // An empty array is a real state: it is what you see halfway through clearing
  // the row to pick two days. Only a MISSING setting means "all seven".
  assert.deepEqual(shoppingSlice({ shoppingDays: [] }), []);
  assert.deepEqual(shoppingSlice({ shoppingDays: [5, 5, 1, 9, -2, 'x', 1.5, 2] }), [1, 2, 5]);
});

// ---------- cutting the plan ----------

test('a slice keeps only the chosen days, and keeps them as positions', () => {
  const cut = planForDays(plan, [1, 4]);
  assert.deepEqual(cut.days.map((d) => d.index), [1, 4],
    'day.index must stay the position it is in the week');
  assert.deepEqual(cut.days.map((d) => d.name), [plan.days[1].name, plan.days[4].name]);
});

test('the whole week asked for is the whole week returned, untouched', () => {
  assert.equal(planForDays(plan, ALL), plan, 'a full week should not be rebuilt');
  assert.deepEqual(shoppingList(plan, { days: ALL }), shoppingList(plan),
    'selecting all seven days must match passing no selection at all');
});

test('a reheat is dropped when the day it was cooked is outside the slice', () => {
  // Find a day that eats something cooked on another day.
  const reheatDay = plan.days.find((d) => entriesOf(d).some((e) => Number.isInteger(e.from)));
  assert.ok(reheatDay, 'the fixture week has no leftovers or batches to test with');
  const carried = entriesOf(reheatDay).filter((e) => Number.isInteger(e.from));

  const alone = planForDays(plan, [reheatDay.index]);
  const kept = entriesOf(alone.days[0]).filter((e) => Number.isInteger(e.from));
  assert.deepEqual(kept, [],
    `${reheatDay.name} alone still buys ingredients for a meal cooked on another day`);

  // With its cook day in the slice, it comes back.
  const withCook = planForDays(plan, [...new Set([reheatDay.index, ...carried.map((e) => e.from)])]
    .sort((a, b) => a - b));
  const back = entriesOf(withCook.days.find((d) => d.index === reheatDay.index))
    .filter((e) => Number.isInteger(e.from));
  assert.equal(back.length, carried.length, 'the reheat should be back once its cook day is in');
});

test('a day cooked for is still bought for when the reheat day is left out', () => {
  // The other direction: dropping Monday's leftover lunch must not drop
  // Sunday's dinner, which is a real cook and a real shop.
  const cook = plan.days.find((d) => entriesOf(d).some((e) => e.kind === 'recipe'));
  const cut = planForDays(plan, [cook.index]);
  assert.ok(entriesOf(cut.days[0]).some((e) => e.kind === 'recipe'),
    'a freshly cooked meal was dropped from its own day');
});

// ---------- the list itself ----------

test('fewer days means a shorter list and less of everything', () => {
  const week = shoppingItems(plan);
  const two = shoppingItems(plan, { days: [2, 3] });
  assert.ok(two.length > 0, 'two days of food should still need shopping');
  assert.ok(two.length < week.length, `two days wanted ${two.length} lines, the week ${week.length}`);
  assert.ok(totalOf(two) < totalOf(week), 'the two-day list is not smaller in quantity');

  // And nothing is invented: every line, and every quantity, is inside the week's.
  const full = byId(week);
  for (const it of two) {
    const whole = full.get(it.id);
    assert.ok(whole, `${it.item} is on the two-day list but not on the week's`);
    assert.ok(it.rawQty <= whole.rawQty,
      `${it.item}: ${it.rawQty} for two days, ${whole.rawQty} for the week`);
  }
});

test('an empty selection asks you to buy nothing', () => {
  assert.deepEqual(shoppingList(plan, { days: [] }), []);
  assert.deepEqual(shoppingItems(plan, { days: [] }), []);
});

test('every day on its own adds up to roughly the whole week', () => {
  // Per-day lists round up to pack sizes seven times over, so they cannot be
  // less than the week's single rounding, and they should not be wildly more.
  const week = totalOf(shoppingItems(plan));
  const summed = ALL.reduce((a, d) => a + totalOf(shoppingItems(plan, { days: [d] })), 0);
  assert.ok(summed >= week * 0.5, `seven single days came to ${summed}, the week to ${week}`);
});

test('the selection reaches the per-shop split too', () => {
  // shoppingByShop rebuilds the list internally, which is exactly where an
  // option like this gets silently dropped.
  const week = shoppingByShop(plan, {});
  const two = shoppingByShop(plan, { days: [2, 3] });
  const count = (b) => b.reduce((a, s) => a + s.groups.reduce((n, g) => n + g.items.length, 0), 0);
  assert.ok(count(two) < count(week),
    `the shop split ignored the day selection: ${count(two)} vs ${count(week)}`);
});

// ---------- persistence ----------

test('a stored selection survives, and a corrupt one is repaired', () => {
  assert.deepEqual(migrate({ settings: { shoppingDays: [1, 2] } }).settings.shoppingDays, [1, 2]);
  assert.deepEqual(migrate({ settings: { shoppingDays: [9, 1, 'x'] } }).settings.shoppingDays, [1]);
  for (const bad of ['all', 3, null, {}]) {
    assert.deepEqual(migrate({ settings: { shoppingDays: bad } }).settings.shoppingDays, ALL,
      `stored shoppingDays ${String(bad)} should have been repaired to the whole week`);
  }
  assert.deepEqual(migrate({}).settings.shoppingDays, ALL);
});

// ---------- the app ----------

test('the shopping tab has a day row, one button per day of the week', () => {
  const app = open();
  app.tab('shopping');
  const btns = app.$$('[data-shopday]');
  assert.equal(btns.length, 7, 'there should be one button per day');
  assert.deepEqual(btns.map((b) => b.getAttribute('aria-pressed')), Array(7).fill('true'),
    'every day starts selected');
  assert.deepEqual(btns.map((b) => Number(b.dataset.shopday)), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(app.errors, []);
});

test('turning a day off shortens the list without re-rolling the meals', () => {
  const app = open();
  app.tab('shopping');
  const before = app.state().plan;
  const lines = () => app.$$('.shop-item').length;
  const was = lines();
  app.click('[data-shopday="6"]');
  assert.deepEqual(app.state().settings.shoppingDays, [0, 1, 2, 3, 4, 5],
    'the day was not deselected');
  assert.equal(app.$('[data-shopday="6"]').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(app.state().plan, before, 'choosing shopping days re-rolled the week');
  assert.ok(lines() < was, `the list did not shrink: ${lines()} vs ${was}`);
  assert.deepEqual(app.errors, []);
});

test('one button selects every day and clears every day', () => {
  const app = open();
  app.tab('shopping');
  app.click('[data-act="shopdays-all"]');
  assert.deepEqual(app.state().settings.shoppingDays, [],
    'with everything already selected, the button should clear the row');
  assert.deepEqual(app.$$('[data-shopday]').map((b) => b.getAttribute('aria-pressed')),
    Array(7).fill('false'));
  app.click('[data-act="shopdays-all"]');
  assert.deepEqual(app.state().settings.shoppingDays, ALL, 'the button should select every day');
  assert.deepEqual(app.errors, []);
});

test('a part-week list says which days it covers', () => {
  const app = open();
  app.tab('shopping');
  assert.ok(!app.text().includes('Covers'), 'a full week needs no coverage note');
  app.click('[data-shopday="6"]');
  app.click('[data-shopday="5"]');
  const t = app.text();
  assert.ok(t.includes('Covers'), 'a part-week list does not say what it covers');
  const names = app.state().plan.days;
  assert.ok(t.includes(names[0].name) && !t.split('Covers')[1].slice(0, 120).includes(names[6].name),
    `the coverage note does not name the right days: ${t.split('Covers')[1]?.slice(0, 120)}`);
  assert.deepEqual(app.errors, []);
});
