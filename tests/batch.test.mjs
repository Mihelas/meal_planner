import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAYS, SLOT_KEYS, defaultSettings, generateWeek, dayTotals, cookSessions, cookDayFor,
  sessionDays, cookPortions, COOKING_STYLES, forEachEntry, entriesIn, targetFor,
} from '../src/planner.js';
import { swapMeal, banAndReplace, toggleLock } from '../src/swap.js';
import { recipeById } from '../src/recipes.js';

const batchSettings = (over = {}) => ({
  ...defaultSettings(), cookingStyle: 'batch', cookDays: [0, 3], ...over,
});
const M = { banned: [] };
const dinnersOf = (plan) => plan.days.map((d) => d.dinner);

// ---------- Cook days ----------
test('cooking styles are exactly the two the UI offers', () => {
  assert.deepEqual(COOKING_STYLES, ['daily', 'batch']);
});

test('cook days are cleaned up: deduped, sorted, and nonsense dropped', () => {
  assert.deepEqual(cookSessions({ cookDays: [3, 0, 3, 9, -1, 'x', 2.5] }), [0, 3]);
});

test('an empty cook-day list falls back to Monday and Thursday rather than nothing', () => {
  assert.deepEqual(cookSessions({ cookDays: [] }), [0, 3]);
  assert.deepEqual(cookSessions({}), [0, 3]);
});

test('each day is fed by the most recent session on or before it', () => {
  const s = [0, 3];
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => cookDayFor(i, s)), [0, 0, 0, 3, 3, 3, 3]);
});

test('a day before the first session cooks for itself instead of going empty', () => {
  // Sessions on Wed and Sat: Mon and Tue have nothing to reheat.
  assert.equal(cookDayFor(0, [2, 5]), 0);
  assert.equal(cookDayFor(1, [2, 5]), 1);
  assert.equal(cookDayFor(2, [2, 5]), 2);
});

// ---------- What a batch week looks like ----------
test('daily mode is unchanged: nothing is a reheat', () => {
  const plan = generateWeek(defaultSettings(), M);
  assert.ok(!dinnersOf(plan).some((d) => d.kind === 'batch'), 'daily weeks must not reheat');
});

test('a batch week only cooks on the session days', () => {
  const plan = generateWeek(batchSettings(), M);
  const cooked = dinnersOf(plan)
    .map((d, i) => (d.kind === 'recipe' ? i : null))
    .filter((i) => i !== null);
  assert.deepEqual(cooked, [0, 3], `cooked on ${cooked.map((i) => DAYS[i]).join(', ')}`);
});

test('a batch week means five of seven evenings need no cooking at all', () => {
  const plan = generateWeek(batchSettings(), M);
  const free = dinnersOf(plan).filter((d) => d.kind !== 'recipe').length;
  assert.ok(free >= 5, `only ${free} evenings off`);
});

test('every reheat names the session it came from, and that session really cooked', () => {
  const plan = generateWeek(batchSettings(), M);
  plan.days.forEach((d, i) => {
    if (d.dinner.kind !== 'batch') return;
    const from = d.dinner.from;
    assert.ok(Number.isInteger(from) && from < i, `${DAYS[i]}: bad source ${from}`);
    assert.notEqual(plan.days[from].dinner.kind, 'batch', `${DAYS[i]} points at another reheat`);
    assert.equal(plan.days[from].dinner.recipeId, d.dinner.recipeId, `${DAYS[i]}: different recipe`);
  });
});

test('a reheat is still a real meal: same recipe, its own portions and numbers', () => {
  const plan = generateWeek(batchSettings(), M);
  const reheat = plan.days.find((d) => d.dinner.kind === 'batch').dinner;
  assert.ok(recipeById(reheat.recipeId), 'must point at a real recipe');
  for (const pid of Object.keys(reheat.portions)) {
    assert.ok(reheat.portions[pid] > 0);
    assert.ok(reheat.kcal[pid] > 0);
  }
});

test('a reheat tells you there is nothing to cook tonight', () => {
  const plan = generateWeek(batchSettings(), M);
  const reheat = plan.days.find((d) => d.dinner.kind === 'batch').dinner;
  assert.match(reheat.note, /Reheat of (Mon|Thu)/);
});

test('anything eaten more than 3 days after cooking must freeze, and says so', () => {
  // One session on Monday has to carry Thursday to Sunday.
  const plan = generateWeek(batchSettings({ cookDays: [0] }), M);
  const source = recipeById(plan.days[0].dinner.recipeId);
  assert.ok(source.tags.includes('freezes'), `${source.name} cannot be held for a week`);
  plan.days.forEach((d, i) => {
    if (d.dinner.kind === 'batch' && i - d.dinner.from > 3) {
      assert.match(d.dinner.note, /Freeze/, `${DAYS[i]}: no freezing instruction`);
    }
  });
});

test('the 30-minute weekday cap still holds on a batch cook night', () => {
  const plan = generateWeek(batchSettings({ cookDays: [1, 3] }), M);
  for (const i of [1, 3]) {
    const r = recipeById(plan.days[i].dinner.recipeId);
    assert.ok(r.minutes <= 30, `${DAYS[i]}: ${r.name} takes ${r.minutes} min on a weekday`);
  }
});

test('a batch week still hits each person day target as closely as a daily week', () => {
  const settings = batchSettings();
  const plan = generateWeek(settings, M);
  plan.days.forEach((d, i) => {
    const totals = dayTotals(d);
    for (const p of settings.people) {
      const target = targetFor(p, settings, i);
      const off = Math.abs(totals[p.id].kcal - target) / target;
      assert.ok(off < 0.12, `${DAYS[i]}/${p.id}: ${totals[p.id].kcal} vs ${target}`);
    }
  });
});

// ---------- Cook once, for how many? ----------
test('the cook card counts tonight plus every reheat and leftover lunch it feeds', () => {
  const settings = batchSettings();
  const plan = generateWeek(settings, M);
  const fed = sessionDays(plan, 0);
  assert.deepEqual(fed, [0, 1, 2], 'Mon session should feed Mon-Wed');
  const dinners = fed.reduce(
    (n, i) => n + Object.values(plan.days[i].dinner.portions).reduce((a, b) => a + b, 0), 0);
  const total = cookPortions(plan, 0);
  assert.ok(total >= dinners - 0.001, `cook card says ${total}, the evenings alone eat ${dinners}`);
  assert.ok(total > 2, 'a batch session must cook more than one evening of food');
});

test('cooking once for three evenings really is about three times one evening', () => {
  const plan = generateWeek(batchSettings(), M);
  const tonight = Object.values(plan.days[0].dinner.portions).reduce((a, b) => a + b, 0);
  assert.ok(cookPortions(plan, 0) >= tonight * 2.5, 'the multiplier has to be real');
});

test('non-session days have no cook card at all — that is the whole point', () => {
  const plan = generateWeek(batchSettings(), M);
  assert.equal(cookPortions(plan, 1), 0, 'Tuesday should not ask you to cook the reheat again');
  assert.equal(cookPortions(plan, 2), 0);
});

// ---------- Editing a batch week ----------
test('swapping a reheat swaps the session, so the week stays consistent', () => {
  const settings = batchSettings();
  const plan = generateWeek(settings, M);
  const before = plan.days[0].dinner.recipeId;
  const after = swapMeal(plan, settings, M, { day: 2, slot: 'dinner' });
  assert.notEqual(after.days[0].dinner.recipeId, before, 'the Monday session must change');
  assert.equal(after.days[2].dinner.recipeId, after.days[0].dinner.recipeId);
  assert.equal(after.days[1].dinner.recipeId, after.days[0].dinner.recipeId);
});

test('swapping a session rewrites all of its reheats, never leaving a stale one', () => {
  const settings = batchSettings();
  let plan = generateWeek(settings, M);
  const reheats = plan.days
    .map((d, i) => (d.dinner.kind === 'batch' && d.dinner.from === 3 ? i : null))
    .filter((i) => i !== null);
  assert.ok(reheats.length, 'the Thursday session must feed something');
  for (let n = 0; n < 4; n++) {
    plan = swapMeal(plan, settings, M, { day: 3, slot: 'dinner' });
    for (const i of reheats) {
      assert.equal(plan.days[i].dinner.recipeId, plan.days[3].dinner.recipeId, `swap ${n}: ${DAYS[i]} stale`);
      assert.equal(plan.days[i].dinner.kind, 'batch');
    }
  }
});

test('banning a batched dinner clears it from the whole week, reheats included', () => {
  const settings = batchSettings();
  const plan = generateWeek(settings, M);
  const id = plan.days[0].dinner.recipeId;
  const { plan: next, memory } = banAndReplace(plan, settings, M, { day: 1, slot: 'dinner' });
  assert.ok(memory.banned.includes(id));
  forEachEntry(next, (e, day, slot) => {
    assert.notEqual(e.recipeId, id, `${DAYS[day]}/${slot} still serves a banned recipe`);
  });
});

test('a locked session survives a re-roll, and so do the reheats hanging off it', () => {
  const settings = batchSettings();
  const first = generateWeek(settings, M);
  const locked = toggleLock(first, { day: 0, slot: 'dinner' });
  const again = generateWeek(settings, M, locked);
  assert.equal(again.days[0].dinner.recipeId, first.days[0].dinner.recipeId);
  again.days.forEach((d, i) => {
    if (d.dinner.kind !== 'batch' || d.dinner.from !== 0) return;
    assert.equal(d.dinner.recipeId, again.days[0].dinner.recipeId, `${DAYS[i]} lost its source`);
  });
});

// ---------- Leftovers still work ----------
test('a leftover lunch may come from a reheat day and still names a real dinner', () => {
  const settings = batchSettings();
  const plan = generateWeek(settings, M);
  plan.days.forEach((d, i) => {
    for (const e of entriesIn(d.lunch)) {
      if (e.kind !== 'leftover') continue;
      const src = plan.days[e.from]?.dinner;
      assert.ok(src, `${DAYS[i]}: leftover from nowhere`);
      assert.equal(src.recipeId, e.recipeId, `${DAYS[i]}: leftover of a different dinner`);
    }
  });
});

test('nothing in a batch week is left without the numbers the UI prints', () => {
  const plan = generateWeek(batchSettings({ cookDays: [2, 5] }), M);
  plan.days.forEach((d, i) => {
    for (const k of SLOT_KEYS) {
      for (const e of entriesIn(d[k])) {
        assert.ok(e.slot, `${DAYS[i]}/${k}: no slot`);
        for (const pid of Object.keys(e.portions)) assert.ok(e.kcal[pid] > 0, `${DAYS[i]}/${k}: no kcal`);
      }
    }
  });
});

// ---------- Honesty about settings that cannot work ----------
test('a cook day that is an eat-out night is called out, not silently ignored', () => {
  // Saturday is an eat-out evening by default, so it cannot be a cook session.
  const plan = generateWeek(batchSettings({ cookDays: [2, 5] }), M);
  assert.ok(plan.warnings.some((w) => /Sat/.test(w) && /eating out/.test(w)),
    `warnings were: ${plan.warnings.join(' | ')}`);
});

test('days before the first cook day are told they will be cooking', () => {
  const plan = generateWeek(batchSettings({ cookDays: [4] }), M);
  const warning = plan.warnings.find((w) => /before the first cook day/.test(w));
  assert.ok(warning, `warnings were: ${plan.warnings.join(' | ')}`);
  assert.match(warning, /Mon/);
  assert.match(warning, /Move a cook day earlier/);
  // And it is true: those days really do cook.
  for (const i of [0, 1, 2, 3]) assert.equal(plan.days[i].dinner.kind, 'recipe');
});

test('a well-set-up batch week has nothing to complain about', () => {
  assert.deepEqual(generateWeek(batchSettings({ cookDays: [0, 3] }), M).warnings, []);
});
