import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOALS, isMaintaining, eatBackFraction, atGoalWeight, shouldSuggestMaintenance,
  deficit, dailyTarget, dayTarget, maintenance, weeklyLossKg, profile, DEFAULT_PEOPLE,
  SAFE_FLOOR_KCAL, EAT_BACK_FRACTION,
} from '../src/targets.js';
import { defaultSettings, generateWeek, dayTotals, targetFor } from '../src/planner.js';

const NICK = DEFAULT_PEOPLE.find((p) => p.id === 'nick');
const GF = DEFAULT_PEOPLE.find((p) => p.id === 'partner');
const maintainer = { ...NICK, goal: 'maintain' };

// ---------- The switch ----------
test('there are exactly two goals, so the UI is a toggle', () => {
  assert.deepEqual(GOALS, ['lose', 'maintain']);
});

test('a person with no goal set is losing — the app was built for that', () => {
  assert.equal(isMaintaining({ ...NICK, goal: undefined }), false);
  assert.equal(isMaintaining(undefined), false);
  assert.equal(isMaintaining(maintainer), true);
});

test('maintaining means no deficit at all, not a smaller one', () => {
  assert.equal(deficit(maintainer), 0);
  assert.equal(dailyTarget(maintainer), maintenance(maintainer));
});

test('maintaining eats back the whole exercise burn, because there is nothing to take off', () => {
  assert.equal(eatBackFraction(maintainer), 1);
  assert.equal(eatBackFraction(NICK), EAT_BACK_FRACTION);
  assert.equal(dayTarget(maintainer, { exerciseKcal: 600 }), maintenance(maintainer) + 600);
});

test('a maintenance week really loses nothing — including football day', () => {
  const loss = weeklyLossKg(maintainer, maintainer.exerciseKcalByDay);
  assert.equal(loss, 0, `maintenance predicted ${loss} kg/week`);
});

test('switching to maintenance gives back the deficit (plus the rounding it was hiding)', () => {
  const back = dailyTarget(maintainer) - dailyTarget(NICK);
  assert.ok(Math.abs(back - deficit(NICK)) <= 50, `${back} kcal back, deficit is ${deficit(NICK)}`);
  assert.ok(back >= deficit(NICK), 'never hand back less than the deficit that was applied');
});

test('maintenance still respects the safety floor for a very small person', () => {
  const tiny = { ...GF, goal: 'maintain', weightKg: 40, heightCm: 140, age: 70, activityFactor: 1.2 };
  assert.ok(dailyTarget(tiny) >= SAFE_FLOOR_KCAL.female);
});

// ---------- Knowing when to offer it ----------
test('goal weight reached is goal weight reached, at or below', () => {
  assert.equal(atGoalWeight({ weightKg: 90, goalWeightKg: 90 }), true);
  assert.equal(atGoalWeight({ weightKg: 89.4, goalWeightKg: 90 }), true);
  assert.equal(atGoalWeight({ weightKg: 91, goalWeightKg: 90 }), false);
});

test('no goal weight set means nothing to reach, so nothing is claimed', () => {
  for (const g of [undefined, null, 0, -5, 'ninety']) {
    assert.equal(atGoalWeight({ weightKg: 70, goalWeightKg: g }), false, `goal ${g}`);
  }
});

test('maintenance is suggested once, and not to someone already maintaining', () => {
  assert.equal(shouldSuggestMaintenance({ weightKg: 89, goalWeightKg: 90, goal: 'lose' }), true);
  assert.equal(shouldSuggestMaintenance({ weightKg: 89, goalWeightKg: 90, goal: 'maintain' }), false);
  assert.equal(shouldSuggestMaintenance({ weightKg: 95, goalWeightKg: 90, goal: 'lose' }), false);
});

test('the profile carries the goal and how far there is still to go', () => {
  const p = profile(NICK);
  assert.equal(p.goal, 'lose');
  assert.equal(p.goalWeightKg, 90);
  assert.equal(p.toGo, 12);
  assert.equal(profile({ ...NICK, goalWeightKg: null }).toGo, null);
  assert.equal(profile(maintainer).weeklyLossKg, 0);
});

test('the default goals are a sane first target, not a crash diet', () => {
  for (const person of DEFAULT_PEOPLE) {
    assert.ok(GOALS.includes(person.goal));
    const drop = person.weightKg - person.goalWeightKg;
    assert.ok(drop > 0 && drop / person.weightKg < 0.2, `${person.id}: ${drop} kg is not a first target`);
  }
});

// ---------- A maintenance week ----------
test('one person can maintain while the other is still losing', () => {
  const base = defaultSettings();
  const settings = { ...base, people: [{ ...base.people[0], goal: 'maintain' }, base.people[1]] };
  const plan = generateWeek(settings, { banned: [] });
  const [him, her] = settings.people;
  assert.ok(targetFor(him, settings, 0) > targetFor(base.people[0], base, 0), 'he should eat more');
  assert.equal(targetFor(her, settings, 0), targetFor(base.people[1], base, 0), 'she is unchanged');
  plan.days.forEach((d, i) => {
    const totals = dayTotals(d);
    for (const p of settings.people) {
      const t = targetFor(p, settings, i);
      assert.ok(Math.abs(totals[p.id].kcal - t) / t < 0.12, `${i}/${p.id}: ${totals[p.id].kcal} vs ${t}`);
    }
  });
});

test('a maintenance week is bigger than a losing week, every day', () => {
  const base = defaultSettings();
  const settings = { ...base, people: base.people.map((p) => ({ ...p, goal: 'maintain' })) };
  const losing = generateWeek(base, { banned: [] });
  const keeping = generateWeek(settings, { banned: [] });
  const total = (plan, pid) => plan.days.reduce((s, d) => s + dayTotals(d)[pid].kcal, 0);
  for (const p of base.people) {
    assert.ok(total(keeping, p.id) > total(losing, p.id), `${p.id} did not get more food`);
  }
});
