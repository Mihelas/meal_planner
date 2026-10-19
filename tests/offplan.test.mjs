import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAYS, defaultSettings, generateWeek, dayTotals, logOffPlan, dayHasOffPlan, weekLedger,
  rebalanceWeek, clearAdjust, reflow, targetFor, OFF_PLAN_PRESETS,
  MAX_DAY_ADJUST, entriesIn, rebalanceDeadband,
} from '../src/planner.js';
import { SAFE_FLOOR_KCAL, dayTarget, KCAL_PER_KG_FAT } from '../src/targets.js';

const S = defaultSettings();
const M = { banned: [] };
const plan = generateWeek(S, M);
const [P1, P2] = S.people;

// ---------- The presets ----------
test('the off-plan presets are the things they actually fall back on', () => {
  const labels = OFF_PLAN_PRESETS.map((p) => p.label.toLowerCase()).join(' ');
  for (const expected of ['pizza', 'döner', 'bread']) {
    assert.ok(labels.includes(expected), `no preset for ${expected}: ${labels}`);
  }
});

test('every preset carries a plausible kcal estimate, not a guess of zero', () => {
  for (const p of OFF_PLAN_PRESETS) {
    assert.ok(p.kcal >= 200 && p.kcal <= 1500, `${p.label}: ${p.kcal} kcal is not plausible`);
  }
});

// ---------- Logging one ----------
test('logging an off-plan dinner replaces that meal for everyone who ate it', () => {
  const next = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 900, label: 'Pizza' });
  const e = next.days[1].dinner;
  assert.equal(e.kind, 'off-plan');
  assert.equal(e.recipeId, null);
  assert.equal(e.estimated, true, 'the UI has to be able to say this is an estimate');
  assert.match(e.note, /Pizza/);
  assert.equal(e.kcal[P1.id], 900);
  assert.ok(e.kcal[P2.id] > 0 && e.kcal[P2.id] < 900, 'her share is smaller, not equal or missing');
});

test('an off-plan meal is locked, so re-rolling the week cannot erase what was eaten', () => {
  const next = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 900 });
  assert.equal(next.days[1].dinner.locked, true);
  const again = generateWeek(S, M, next);
  assert.equal(again.days[1].dinner.kind, 'off-plan');
  assert.equal(again.days[1].dinner.kcal[P1.id], 900);
});

test('logging for one person only touches that person', () => {
  const next = logOffPlan(plan, S, { day: 2, slot: 'lunch', person: P1.id, kcal: 700 });
  assert.equal(next.days[2].lunch[P1.id].kind, 'off-plan');
  assert.equal(next.days[2].lunch[P1.id].kcal[P1.id], 700);
  assert.notEqual(next.days[2].lunch[P2.id].kind, 'off-plan');
});

test('logging with nobody named means the household ate it', () => {
  const next = logOffPlan(plan, S, { day: 2, slot: 'lunch', kcal: 550 });
  assert.equal(next.days[2].lunch[P1.id].kind, 'off-plan');
  assert.equal(next.days[2].lunch[P2.id].kind, 'off-plan');
});

test('the original plan is untouched — logging returns a new plan', () => {
  const before = JSON.stringify(plan);
  logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 900 });
  assert.equal(JSON.stringify(plan), before);
});

test('an off-plan meal still carries a protein estimate, so the day still adds up', () => {
  const e = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 900 }).days[1].dinner;
  assert.ok(e.protein[P1.id] > 0, 'a pizza is not zero protein');
  assert.ok(e.protein[P1.id] < 900 * 0.15, 'nor is it a protein shake');
});

test('nonsense kcal becomes zero rather than NaN spreading through the week', () => {
  const e = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 'lots' }).days[1].dinner;
  assert.equal(e.kcal[P1.id], 0);
  const totals = dayTotals(logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 'lots' }).days[1]);
  assert.ok(Number.isFinite(totals[P1.id].kcal));
});

test('logging into a day that does not exist changes nothing instead of throwing', () => {
  assert.doesNotThrow(() => logOffPlan(plan, S, { day: 99, slot: 'dinner', kcal: 900 }));
  assert.doesNotThrow(() => logOffPlan(plan, S, { day: 1, slot: 'brunch', kcal: 900 }));
});

test('dayHasOffPlan knows which days have already gone off plan', () => {
  const next = logOffPlan(plan, S, { day: 3, slot: 'snackEvening', kcal: 600 });
  assert.equal(dayHasOffPlan(next.days[3]), true);
  assert.equal(dayHasOffPlan(next.days[2]), false);
});

// ---------- The week ledger ----------
test('a clean week is level: planned equals actual, near enough', () => {
  const ledger = weekLedger(plan, S);
  for (const p of S.people) {
    const row = ledger[p.id];
    assert.ok(Math.abs(row.surplus) < 500, `${p.id} drifted ${row.surplus} kcal over a clean week`);
    assert.equal(row.offPlanMeals, 0);
    assert.equal(row.offPlanKcal, 0);
  }
});

test('the ledger counts the off-plan meals and what they cost', () => {
  const next = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1100, label: 'Burger' });
  const ledger = weekLedger(next, S);
  assert.equal(ledger[P1.id].offPlanMeals, 1);
  assert.equal(ledger[P1.id].offPlanKcal, 1100);
  assert.ok(ledger[P1.id].surplus > 0, 'a burger instead of dinner must show as a surplus');
});

test('the ledger states the surplus in kg, because that is the question being asked', () => {
  const next = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1100 });
  const row = weekLedger(next, S)[P1.id];
  assert.ok(Math.abs(row.kgEquivalent - row.surplus / KCAL_PER_KG_FAT) < 0.01);
});

// ---------- Absorbing it ----------
test('rebalancing spreads the surplus over the days that are still ahead', () => {
  const logged = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1200, label: 'Pizza' });
  const { settings: next, report } = rebalanceWeek(logged, S, { fromDay: 1 });
  const surplus = weekLedger(logged, S)[P1.id].surplus;
  assert.ok(report[P1.id].absorbed > 0);
  assert.ok(report[P1.id].absorbed <= Math.round(surplus) + 1);
  // Nothing before or on the day itself is touched.
  for (const i of [0, 1]) assert.equal(next.adjust[i][P1.id] ?? 0, 0, `${DAYS[i]} should not move`);
  const cuts = [2, 3, 4, 5, 6].map((i) => next.adjust[i][P1.id] ?? 0);
  assert.ok(cuts.every((c) => c <= 0), 'absorbing a surplus means eating less, never more');
  assert.ok(cuts.some((c) => c < 0), 'something has to change');
});

test('no single day is cut by more than the cap, however big the blowout', () => {
  const logged = logOffPlan(plan, S, { day: 0, slot: 'dinner', kcal: 4000 });
  const { settings: next } = rebalanceWeek(logged, S, { fromDay: 0 });
  for (let i = 0; i < 7; i++) {
    const cut = next.adjust[i][P1.id] ?? 0;
    assert.ok(Math.abs(cut) <= MAX_DAY_ADJUST, `${DAYS[i]} cut by ${cut}`);
  }
});

test('rebalancing never pushes anyone below a safe intake', () => {
  const logged = logOffPlan(plan, S, { day: 0, slot: 'dinner', kcal: 5000 });
  const { settings: next } = rebalanceWeek(logged, S, { fromDay: 0 });
  for (const p of S.people) {
    for (let i = 0; i < 7; i++) {
      assert.ok(targetFor(p, next, i) >= SAFE_FLOOR_KCAL[p.sex],
        `${p.id} on ${DAYS[i]} would eat ${targetFor(p, next, i)}`);
    }
  }
});

test('a surplus too big to absorb is reported, not hidden', () => {
  const logged = logOffPlan(plan, S, { day: 0, slot: 'dinner', kcal: 6000 });
  const { report } = rebalanceWeek(logged, S, { fromDay: 0 });
  assert.ok(report[P1.id].left > 0, 'the leftover has to be visible somewhere');
  assert.equal(report[P1.id].surplus, report[P1.id].absorbed + report[P1.id].left);
});

test('rebalancing on the last day has nowhere to put it and says so', () => {
  const logged = logOffPlan(plan, S, { day: 6, slot: 'dinner', kcal: 1200 });
  const { report, settings: next } = rebalanceWeek(logged, S, { fromDay: 6 });
  assert.equal(report[P1.id].days, 0);
  assert.equal(report[P1.id].absorbed, 0);
  assert.ok(report[P1.id].left > 0);
  assert.deepEqual(next.adjust[6], {});
});

test('a clean week asks for no adjustment at all', () => {
  // A generated week lands a few dozen kcal either side of target because portions
  // move in quarters. Before the dead-band this test passed by luck: the library
  // happened to round under, and growing it was enough to make a clean week report
  // itself as needing correction.
  const { settings: next, report } = rebalanceWeek(plan, S, { fromDay: 0 });
  for (const p of S.people) {
    assert.equal(report[p.id].absorbed, 0, `${p.id} was adjusted on a clean week`);
    assert.equal(report[p.id].left, 0, `${p.id} was told kcal were left over on a clean week`);
  }
  for (let i = 0; i < 7; i++) assert.deepEqual(next.adjust[i], {});
});

test('rounding is ignored but a real overshoot is not', () => {
  // The dead-band must not become a place for a genuine surplus to hide, so both
  // halves are pinned: a clean week is inside it, and an off-plan meal is outside.
  const ledger = weekLedger(plan, S);
  for (const p of S.people) {
    const band = rebalanceDeadband(ledger[p.id].planned / 7, 7);
    assert.ok(Math.abs(ledger[p.id].surplus) < band,
      `${p.id}: a clean week drifted ${Math.round(ledger[p.id].surplus)} kcal, past a ${Math.round(band)} band`);
  }
  // The band scales with the person: he eats 2240 a day and she eats 1500, so a flat
  // kcal figure would be half a day's slack for one of them and rounding for the other.
  assert.ok(rebalanceDeadband(ledger[P1.id].planned / 7, 7)
    > rebalanceDeadband(ledger[P2.id].planned / 7, 7));
  // And it shrinks as the week runs out, so Thursday's pizza is not excused by Monday's room.
  assert.ok(rebalanceDeadband(300, 2) < rebalanceDeadband(300, 5));
  // 1800, not 1200: an off-plan meal's surplus is measured against what the slot
  // it replaced was already going to cost, and day 1's dinner has grown with the
  // library. At 1200 it replaces a 461 kcal portion of hers, leaving her a surplus
  // of nothing against a ~360 band -- correctly silent, which is the opposite of
  // what this half of the test pins. Anything that reads like a pizza clears the
  // band for both of us.
  const logged = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1800 });
  const { report } = rebalanceWeek(logged, S, { fromDay: 1 });
  for (const p of S.people) {
    assert.ok(report[p.id].surplus > 0, `${p.id}: a pizza is not rounding`);
    assert.ok(report[p.id].absorbed > 0, `${p.id}: a real surplus has to be absorbed`);
  }
});

test('rebalancing does not mutate the settings it was handed', () => {
  const before = JSON.stringify(S.adjust);
  const logged = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1200 });
  rebalanceWeek(logged, S, { fromDay: 1 });
  assert.equal(JSON.stringify(S.adjust), before);
});

test('clearAdjust wipes the slate for a new week', () => {
  const logged = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1200 });
  const { settings: adjusted } = rebalanceWeek(logged, S, { fromDay: 1 });
  const cleared = clearAdjust(adjusted);
  assert.equal(cleared.adjust.length, 7);
  for (const a of cleared.adjust) assert.deepEqual(a, {});
});

// ---------- Re-portioning, not re-rolling ----------
test('reflow keeps the same recipes and only changes the portions', () => {
  const logged = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1200 });
  const { settings: adjusted } = rebalanceWeek(logged, S, { fromDay: 1 });
  const after = reflow(logged, adjusted);
  after.days.forEach((d, i) => {
    for (const key of ['breakfast', 'dinner']) {
      assert.equal(d[key].recipeId, logged.days[i][key].recipeId, `${DAYS[i]}/${key} changed recipe`);
    }
  });
  // And the cut really does come out of the week. Not "out of the first cut day":
  // trimToTarget stops once a day is within 4 % of its target, so a day that was
  // already close keeps its portions and the next day absorbs more. Demanding that
  // one named day move is an assertion about which recipes the seed drew, not about
  // what reflow promises.
  const cutDays = [2, 3, 4, 5, 6].filter((i) => (adjusted.adjust[i][P1.id] ?? 0) < 0);
  assert.ok(cutDays.length, 'the rebalance should have cut something');
  const before = cutDays.reduce((s, i) => s + dayTotals(logged.days[i])[P1.id].kcal, 0);
  const afterSum = cutDays.reduce((s, i) => s + dayTotals(after.days[i])[P1.id].kcal, 0);
  assert.ok(afterSum < before, `the cut days did not come down: ${before} -> ${afterSum}`);
  // And no cut day moves the wrong way, which is the failure that would actually hurt.
  for (const i of cutDays) {
    assert.ok(dayTotals(after.days[i])[P1.id].kcal <= dayTotals(logged.days[i])[P1.id].kcal,
      `${DAYS[i]} went up after a downward adjustment`);
  }
});

test('a reflowed day lands on its adjusted target, not the original one', () => {
  const logged = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1200 });
  const { settings: adjusted } = rebalanceWeek(logged, S, { fromDay: 1 });
  const after = reflow(logged, adjusted);
  for (const i of [2, 3, 4, 5, 6]) {
    const target = targetFor(P1, adjusted, i);
    const actual = dayTotals(after.days[i])[P1.id].kcal;
    assert.ok(Math.abs(actual - target) / target < 0.15, `${DAYS[i]}: ${actual} vs ${target}`);
  }
});

test('the day of the blowout is left alone — shrinking a meal already eaten is a lie', () => {
  const logged = logOffPlan(plan, S, { day: 2, slot: 'lunch', kcal: 900 });
  const trimmed = reflow(logged, S);
  assert.equal(dayTotals(trimmed.days[2])[P1.id].kcal, dayTotals(logged.days[2])[P1.id].kcal);
});

test('off-plan kcal survive a reflow untouched: they are facts, not suggestions', () => {
  const logged = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1200 });
  const { settings: adjusted } = rebalanceWeek(logged, S, { fromDay: 1 });
  const after = reflow(logged, adjusted);
  assert.equal(after.days[1].dinner.kcal[P1.id], 1200);
  assert.equal(after.days[1].dinner.kind, 'off-plan');
});

// ---------- Per-day adjustment plumbing ----------
test('targetFor applies the adjustment for the right person on the right day', () => {
  const adjust = [{}, {}, { [P1.id]: -200 }, {}, {}, {}, {}];
  const settings = { ...S, adjust };
  assert.equal(targetFor(P1, settings, 2), dayTarget(P1, { exerciseKcal: 0 }) - 200);
  assert.equal(targetFor(P2, settings, 2), dayTarget(P2, { exerciseKcal: 0 }));
  assert.equal(targetFor(P1, settings, 1), dayTarget(P1, { exerciseKcal: 0 }));
});

test('an absurd stored adjustment still cannot breach the safety floor', () => {
  const settings = { ...S, adjust: [{ [P1.id]: -9000 }, {}, {}, {}, {}, {}, {}] };
  assert.equal(targetFor(P1, settings, 0), SAFE_FLOOR_KCAL.male);
});

test('football day keeps its exercise allowance through an adjustment', () => {
  const settings = { ...S, adjust: [{}, {}, {}, {}, { [P1.id]: -100 }, {}, {}] };
  assert.equal(targetFor(P1, settings, 4), dayTarget(P1, { exerciseKcal: 600 }) - 100);
});

// ---------- It has to hold together ----------
test('an off-plan week still produces a plan where every entry has numbers', () => {
  let logged = logOffPlan(plan, S, { day: 1, slot: 'dinner', kcal: 1200 });
  logged = logOffPlan(logged, S, { day: 4, slot: 'snackEvening', kcal: 600, person: P1.id });
  const { settings: adjusted } = rebalanceWeek(logged, S, { fromDay: 4 });
  const after = reflow(logged, adjusted);
  after.days.forEach((d, i) => {
    for (const key of ['breakfast', 'lunch', 'dinner', 'snackAfternoon', 'snackEvening']) {
      for (const e of entriesIn(d[key])) {
        for (const pid of Object.keys(e.portions)) {
          assert.ok(Number.isFinite(e.kcal[pid]), `${DAYS[i]}/${key}/${pid}: kcal is not a number`);
        }
      }
    }
  });
});
