// Vegetarian days: three of the seven, picked by the planner rather than by hand.
//
// The count is a setting; *which* days is derived, so it never needs migrating
// and it follows the week start, the football night and the evenings out on its
// own. The tests below are mostly about that derivation holding its shape, and
// about one thing that is easy to get wrong: a meatless day that packs
// yesterday's chicken for lunch is not a meatless day.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSettings, generateWeek, setWeekStart, slotCandidates,
  vegetarianDaysOf, isVegetarianDay, SLOT_KEYS, entriesIn, weekdayOf, DAYS, dayTotals,
  cookSessions,
} from '../src/planner.js';
import { recipeById, RECIPES, setCustomRecipes, customRecipes } from '../src/recipes.js';
import { proteinFloor, dayTarget } from '../src/targets.js';
import { migrate } from '../src/store.js';
import { open } from './harness.mjs';

const S = defaultSettings();
const M = { banned: [] };
test.afterEach(() => setCustomRecipes([]));

const isVeg = (id) => Boolean(recipeById(id)?.tags.includes('vegetarian'));

/** Every entry on a day that came from a recipe, with the slot it sits in. */
const cookedEntries = (day) => SLOT_KEYS.flatMap((k) => entriesIn(day[k]).map((e) => ({ slot: k, e })))
  .filter(({ e }) => e.recipeId);

// ---------- How many, and which ----------
test('three days of the week are vegetarian out of the box', () => {
  assert.equal(S.vegetarianDays, 3);
  assert.equal(vegetarianDaysOf(S).length, 3);
});

test('asking for n days gets n days, for every value the control can produce', () => {
  for (let n = 0; n <= 7; n++) {
    const days = vegetarianDaysOf({ ...S, vegetarianDays: n });
    // Five of the seven are eligible by default: Friday is football and Saturday
    // night is out. Asking for more than that gets every day it can cook.
    assert.equal(days.length, Math.min(n, 5), `asked for ${n}, got ${days.length}`);
    assert.equal(new Set(days).size, days.length, `${n} produced a duplicate day`);
  }
});

test('football night and the evening out are never made vegetarian', () => {
  for (let n = 0; n <= 7; n++) {
    for (const day of vegetarianDaysOf({ ...S, vegetarianDays: n })) {
      assert.notEqual(day, S.footballDay, 'the match night cannot cook from the veggie pool');
      assert.ok(!S.eatOut.some((o) => o.day === day && o.slot === 'dinner'),
        `day ${day} eats out: there is no kitchen to make vegetarian`);
    }
  }
});

test('the vegetarian days are spread across the week, not bunched together', () => {
  // Measured in the eligible days, cyclically: the gaps between picks may differ
  // by one, because 3 does not divide 5, but never by more.
  const eligible = [0, 1, 2, 3, 6];
  const picked = vegetarianDaysOf(S).map((d) => eligible.indexOf(d));
  assert.ok(picked.every((p) => p >= 0), 'a vegetarian day landed on an ineligible day');
  const gaps = picked.map((p, k) => (k ? p - picked[k - 1] : p + eligible.length - picked.at(-1)));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `uneven spread: gaps ${gaps.join(',')}`);
});

test('the same seed always picks the same days, a different one need not', () => {
  assert.deepEqual(vegetarianDaysOf(S), vegetarianDaysOf({ ...S }));
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) seen.add(vegetarianDaysOf({ ...S, seed }).join(','));
  assert.ok(seen.size > 1, 'every seed picks the same three days - the rotation is dead');
});

// ---------- What the pool does with them ----------
test('a vegetarian day offers nothing but vegetarian recipes, in every slot', () => {
  const day = vegetarianDaysOf(S)[0];
  for (const slot of SLOT_KEYS) {
    const pool = slotCandidates(S, M, { day, slot });
    assert.ok(pool.length, `nothing at all to put in ${slot} on a vegetarian day`);
    const meat = pool.filter((r) => !r.tags.includes('vegetarian'));
    assert.deepEqual(meat.map((r) => r.id), [], `${slot} offered meat on a vegetarian day`);
  }
});

test('the days in between are untouched, and still offer the whole library', () => {
  const day = [0, 1, 2, 3, 6].find((d) => !isVegetarianDay(S, d));
  assert.ok(day !== undefined, 'every eligible day went vegetarian');
  assert.ok(slotCandidates(S, M, { day, slot: 'dinner' }).some((r) => !r.tags.includes('vegetarian')),
    'a day that is not vegetarian lost its meat anyway');
});

// ---------- The whole week ----------
test('every meal a vegetarian day cooks is meatless, leftovers included', () => {
  const plan = generateWeek(S, M);
  for (const day of vegetarianDaysOf(S)) {
    for (const { slot, e } of cookedEntries(plan.days[day])) {
      assert.ok(isVeg(e.recipeId),
        `${plan.days[day].name} ${slot}: ${e.recipeId} (${e.kind}) is not vegetarian`);
    }
  }
});

test('yesterday\'s meat dinner is not packed as today\'s vegetarian lunch', () => {
  // The case the pool filter cannot see: a leftover is copied from the day
  // before, so it has to be refused at the point it is carried over.
  const plan = generateWeek(S, M);
  for (const day of vegetarianDaysOf(S)) {
    for (const e of entriesIn(plan.days[day].lunch)) {
      if (e.kind !== 'leftover' && e.kind !== 'batch') continue;
      assert.ok(isVeg(e.recipeId), `${plan.days[day].name} carried over ${e.recipeId}`);
    }
  }
});

test('a vegetarian office day still sends him to the canteen', () => {
  const settings = { ...S, dayModes: S.dayModes.map(() => 'office') };
  const plan = generateWeek(settings, M);
  const [nick] = settings.people;
  for (const day of vegetarianDaysOf(settings)) {
    const lunch = plan.days[day].lunch[nick.id];
    assert.equal(lunch.kind, 'canteen',
      `${plan.days[day].name}: a vegetarian day replaced the canteen card`);
  }
});

test('a vegetarian week still does not repeat a dinner', () => {
  const plan = generateWeek(S, M);
  const ids = plan.days.map((d) => d.dinner.recipeId).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, `repeated dinner: ${ids.join(', ')}`);
});

test('turning it off gives back the plan we had before the feature existed', () => {
  const off = { ...S, vegetarianDays: 0 };
  assert.deepEqual(vegetarianDaysOf(off), []);
  const plan = generateWeek(off, M);
  assert.ok(plan.days.some((d) => d.dinner.recipeId && !isVeg(d.dinner.recipeId)),
    'with the feature off, the week is still all vegetarian');
});

test('the week still fills every slot when the vegetarian pool runs dry', () => {
  // Ban every vegetarian recipe there is. A meatless day then cannot be served,
  // so it has to cook something rather than hand back an empty plate -- and it
  // has to say out loud that it gave up, instead of quietly serving meat.
  const banned = RECIPES.filter((r) => r.tags.includes('vegetarian')).map((r) => r.id);
  const plan = generateWeek(S, { banned });
  for (const day of vegetarianDaysOf(S)) {
    for (const slot of SLOT_KEYS) {
      for (const e of entriesIn(plan.days[day][slot])) {
        assert.ok(e, `${plan.days[day].name} ${slot} is empty`);
      }
    }
  }
  assert.ok(plan.warnings.some((w) => /vegetarian/i.test(w)),
    `no warning that the vegetarian days could not be honoured: ${plan.warnings.join(' | ')}`);
});

// ---------- It travels with the week ----------
test('the vegetarian days follow the real weekdays when the week start moves', () => {
  const before = vegetarianDaysOf(S).map((d) => weekdayOf(S, d)).sort((a, b) => a - b);
  const moved = setWeekStart(S, 3);
  const after = vegetarianDaysOf(moved).map((d) => weekdayOf(moved, d)).sort((a, b) => a - b);
  assert.deepEqual(after, before, 're-cutting the week moved which real days are meatless');
});

// ---------- Saved files ----------
test('a file saved before the feature gets three days, and nonsense is repaired', () => {
  assert.equal(migrate({ settings: {} }).settings.vegetarianDays, 3);
  for (const bad of [-1, 8, 2.5, 'three', null, undefined, NaN]) {
    const n = migrate({ settings: { vegetarianDays: bad } }).settings.vegetarianDays;
    assert.equal(n, 3, `${String(bad)} was not repaired, got ${n}`);
  }
  // Zero is a real choice and has to survive a reload.
  assert.equal(migrate({ settings: { vegetarianDays: 0 } }).settings.vegetarianDays, 0);
  assert.equal(migrate({ settings: { vegetarianDays: 7 } }).settings.vegetarianDays, 7);
});

// ---------- The control ----------
test('the settings control shows the count and names the days it chose', () => {
  const app = open();
  app.tab('settings');
  const sel = app.$('[data-act="vegdays"]');
  assert.ok(sel, 'no vegetarian-days control in settings');
  assert.equal(sel.value, '3');
  assert.equal(sel.querySelectorAll('option').length, 8, 'the control should offer none through 7');
  // The line under it has to name the actual days, or the setting is a mystery.
  const help = sel.closest('label').nextElementSibling.textContent;
  for (const day of vegetarianDaysOf(app.state().settings)) {
    assert.ok(help.includes(DAYS[day]), `${DAYS[day]} is vegetarian but is not named: ${help}`);
  }
  assert.deepEqual(app.errors, [], app.errors.join('; '));
});

test('changing the count rebuilds the week and survives a reload', () => {
  const app = open();
  app.tab('settings');
  app.set('[data-act="vegdays"]', '5');
  assert.equal(app.state().settings.vegetarianDays, 5);

  const again = open({ stored: app.saved() });
  assert.equal(again.state().settings.vegetarianDays, 5);
  const veg = vegetarianDaysOf(again.state().settings);
  for (const day of veg) {
    for (const { slot, e } of cookedEntries(again.state().plan.days[day])) {
      assert.ok(isVeg(e.recipeId), `${slot} on a vegetarian day is ${e.recipeId}`);
    }
  }
  assert.deepEqual(again.errors, [], again.errors.join('; '));
});

test('turning it off in settings puts meat back on the menu', () => {
  const app = open();
  app.tab('settings');
  app.set('[data-act="vegdays"]', '0');
  assert.equal(app.state().settings.vegetarianDays, 0);
  assert.match(app.$('[data-act="vegdays"]').closest('label').nextElementSibling.textContent,
    /whole library/, 'the help line still describes vegetarian days with the feature off');
  assert.ok(app.state().plan.days.some((d) => d.dinner.recipeId && !isVeg(d.dinner.recipeId)),
    'the week is still entirely vegetarian after switching it off');
});

// ---------- Recipes the user typed in ----------
//
// Nobody is asked for tags when they add a recipe, so a custom one arrives
// untagged and a meatless day cannot see it -- your own recipe quietly missing
// from your own week. Veg-ness is inferred from the aisles instead: a recipe
// that buys nothing from the meat-and-fish counter is meatless.
test('a meat-free recipe you typed in is offered on a vegetarian day', () => {
  const day = vegetarianDaysOf(S)[0];
  setCustomRecipes([{
    name: 'Ofen-Feta mit Tomaten', slot: 'dinner', kcal: 700, protein: 40, minutes: 25,
    ingredients: [
      { item: 'Feta', qty: 200, unit: 'g', aisle: 'dairy' },
      { item: 'Kirschtomaten', qty: 400, unit: 'g', aisle: 'produce' },
    ],
    method: ['Backofen auf 200 Grad.'],
  }]);
  const mine = customRecipes()[0];
  assert.ok(mine, 'the recipe did not validate');
  assert.ok(mine.tags.includes('vegetarian'), `tags: ${mine.tags.join(', ')}`);
  assert.ok(slotCandidates(S, M, { day, slot: 'dinner' }).some((r) => r.id === mine.id),
    'a meat-free recipe of your own is not offered on a vegetarian day');
});

test('a recipe you typed in that buys meat is not offered on a vegetarian day', () => {
  const day = vegetarianDaysOf(S)[0];
  setCustomRecipes([{
    name: 'Haehnchen vom Blech', slot: 'dinner', kcal: 700, protein: 55, minutes: 25,
    ingredients: [
      { item: 'Haehnchenbrust', qty: 200, unit: 'g', aisle: 'meat-fish' },
      { item: 'Brokkoli', qty: 300, unit: 'g', aisle: 'produce' },
    ],
    method: ['Backofen auf 200 Grad.'],
  }]);
  const mine = customRecipes()[0];
  assert.ok(!mine.tags.includes('vegetarian'), 'chicken was called vegetarian');
  assert.ok(!slotCandidates(S, M, { day, slot: 'dinner' }).some((r) => r.id === mine.id),
    'a meat recipe of your own reached a vegetarian day');
});

test('a vegetarian tag you typed yourself is kept even if an aisle says otherwise', () => {
  // Aisles are chosen by hand and the list is short: tofu and halloumi both end
  // up under meat-fish in some shops. An explicit tag is a statement, not a guess,
  // so inference only ever adds the tag -- it never takes one away.
  setCustomRecipes([{
    name: 'Tofu-Pfanne', slot: 'dinner', kcal: 650, protein: 40, minutes: 20,
    tags: ['vegetarian'],
    ingredients: [{ item: 'Raeuchertofu', qty: 200, unit: 'g', aisle: 'meat-fish' }],
    method: ['Anbraten.'],
  }]);
  assert.ok(customRecipes()[0].tags.includes('vegetarian'), 'the tag was taken away');
});

// ---------- The nutrition the feature has to not break ----------
test('a vegetarian day still clears the protein floor, for both of us', () => {
  // The whole point of the floor is that it holds on the hard days, and meatless
  // is the hard case: the veg pool's median protein is well under the library's,
  // so a selection tuned on the full library will undershoot here. Several seeds,
  // because one lucky week proves nothing.
  for (let seed = 1; seed <= 12; seed++) {
    const settings = { ...S, seed };
    const plan = generateWeek(settings, M);
    for (const day of vegetarianDaysOf(settings)) {
      const t = dayTotals(plan.days[day]);
      for (const person of settings.people) {
        const floor = proteinFloor(person);
        assert.ok(t[person.id].protein >= floor * 0.9,
          `seed ${seed} ${plan.days[day].name}/${person.id}: ${t[person.id].protein} g vs floor ${floor} g`);
      }
    }
  }
});

test('the kcal target still holds on a vegetarian day', () => {
  // Chasing protein must not be allowed to blow the calorie budget: the deficit
  // is the reason the plan exists at all.
  for (let seed = 1; seed <= 12; seed++) {
    const settings = { ...S, seed };
    const plan = generateWeek(settings, M);
    for (const day of vegetarianDaysOf(settings)) {
      const t = dayTotals(plan.days[day]);
      for (const person of settings.people) {
        const target = dayTarget(person, { exerciseKcal: person.exerciseKcalByDay[day] });
        const off = Math.abs(t[person.id].kcal - target) / target;
        assert.ok(off <= 0.10,
          `seed ${seed} ${plan.days[day].name}/${person.id}: ${t[person.id].kcal} kcal vs ${target} (off ${(off * 100).toFixed(1)}%)`);
      }
    }
  }
});

// --- Batch mode: one pot feeds several days, which changes the question.
//
// This block exists because the bug it pins was invisible to all 537 tests and
// turned up only in a week-level audit. In batch mode a day's dinner is not its
// own -- one pot is cooked at the session and reheated until the next one -- so
// a vegetarian pot makes its whole span meatless. With the days picked
// independently of the sessions, both sessions could land on vegetarian days and
// the entire week went meatless: three asked for, seven served.

test('a batch week does not quietly go vegetarian end to end', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const settings = { ...S, cookingStyle: 'batch', seed };
    const plan = generateWeek(settings, M);
    const cooked = plan.days
      .map((d) => recipeById(d.dinner?.recipeId))
      .filter(Boolean);
    const meatless = cooked.filter((r) => r.tags.includes('vegetarian'));
    assert.ok(meatless.length < cooked.length,
      `seed ${seed}: every dinner in a batch week is meatless, and only ${S.vegetarianDays} were asked for`);
  }
});

test('a batch week goes meatless in whole cooking sessions', () => {
  // The alignment itself, stated as the invariant rather than as a day count:
  // every day served out of the same pot has to agree about whether it is a
  // vegetarian day, because there is only one pot.
  for (let seed = 1; seed <= 12; seed++) {
    const settings = { ...S, cookingStyle: 'batch', seed };
    const veg = vegetarianDaysOf(settings);
    const sessions = cookSessions(settings);
    for (const [k, start] of sessions.entries()) {
      const span = [];
      for (let i = start; i < (sessions[k + 1] ?? 7); i++) span.push(i);
      const cooking = span.filter((i) => !(settings.eatOut ?? [])
        .some((o) => o.day === i && o.slot === 'dinner'));
      const split = cooking.filter((i) => veg.includes(i));
      assert.ok(split.length === 0 || split.length === cooking.length,
        `seed ${seed}: the session starting ${DAYS[weekdayOf(settings, start)]} is `
        + `vegetarian on ${split.length} of its ${cooking.length} cooking days`);
    }
  }
});

test('a batch week honours the count as closely as its sessions allow', () => {
  // Two sessions cannot produce exactly three meatless days out of seven, so the
  // count rounds to whole sessions. What it must not do is round to nothing, or
  // round so far that "three" becomes the whole week.
  for (let seed = 1; seed <= 12; seed++) {
    const settings = { ...S, cookingStyle: 'batch', seed };
    const veg = vegetarianDaysOf(settings);
    const longest = Math.max(...cookSessions(settings).map((start, k, all) =>
      (all[k + 1] ?? 7) - start));
    assert.ok(veg.length > 0, `seed ${seed}: asked for ${S.vegetarianDays}, got none`);
    assert.ok(Math.abs(veg.length - S.vegetarianDays) < longest,
      `seed ${seed}: asked for ${S.vegetarianDays}, got ${veg.length}, `
      + `off by a whole ${longest}-day session`);
  }
});

test('a batch pot clears the protein floor on every day it is reheated', () => {
  // A thin pot is not a thin day once, it is a thin day two to four times, and
  // there is no later slot on day three to make up for a thin Monday.
  for (let seed = 1; seed <= 12; seed++) {
    const settings = { ...S, cookingStyle: 'batch', seed };
    const plan = generateWeek(settings, M);
    for (const day of vegetarianDaysOf(settings)) {
      const t = dayTotals(plan.days[day]);
      for (const person of settings.people) {
        const floor = proteinFloor(person);
        assert.ok(t[person.id].protein >= floor * 0.9,
          `seed ${seed} ${plan.days[day].name}/${person.id}: ${t[person.id].protein} g vs floor ${floor} g`);
      }
    }
  }
});
