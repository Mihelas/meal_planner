import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bmr, maintenance, deficit, dailyTarget, proteinFloor, dayTarget,
  weeklyLossKg, slotBudget, profile, DEFAULT_PEOPLE, SLOTS,
  SAFE_FLOOR_KCAL, MAX_DEFICIT_KCAL,
} from '../src/targets.js';

// The shipped defaults, which are round synthetic numbers chosen partly so the
// hand arithmetic below stays legible. Asserting against them couples these
// tests to the defaults, so where a number below is hand-computed the inputs are
// spelled out in the test name -- change the defaults and these names are the
// first thing that has to be corrected.
const P1 = DEFAULT_PEOPLE.find(p => p.id === 'person1');
const P2 = DEFAULT_PEOPLE.find(p => p.id === 'person2');

// ---------- BMR (Mifflin-St Jeor) ----------
test('bmr: male matches Mifflin-St Jeor by hand (100kg/180cm/30)', () => {
  // 10*100 + 6.25*180 - 5*30 + 5 = 1000 + 1125 - 150 + 5
  assert.equal(bmr(P1), 1980);
});

test('bmr: female matches Mifflin-St Jeor by hand (65kg/168cm/30)', () => {
  // 10*65 + 6.25*168 - 5*30 - 161 = 650 + 1050 - 150 - 161
  assert.equal(bmr(P2), 1389);
});

test('bmr: throws on unknown sex rather than silently guessing', () => {
  assert.throws(() => bmr({ ...P1, sex: 'other' }), /unknown sex/);
});

test('bmr: throws on non-positive or missing measurements', () => {
  assert.throws(() => bmr({ ...P1, weightKg: 0 }), /weightKg/);
  assert.throws(() => bmr({ ...P1, heightCm: undefined }), /heightCm/);
  assert.throws(() => bmr({ ...P1, age: -1 }), /age/);
});

// ---------- Maintenance ----------
test('maintenance: bmr x activity factor, rounded to 10', () => {
  assert.equal(maintenance(P1), 2720);    // 1980 * 1.375 = 2722.5
  assert.equal(maintenance(P2), 2010);    // 1389 * 1.45  = 2014.05
});

// ---------- Deficit ----------
test('deficit: capped at 500 kcal/day for a large maintenance', () => {
  assert.equal(deficit(P1), MAX_DEFICIT_KCAL);
});

test('deficit: capped at 25% of maintenance for a small maintenance', () => {
  const tiny = { ...P2, weightKg: 45, heightCm: 150, activityFactor: 1.2 };
  assert.ok(deficit(tiny) < MAX_DEFICIT_KCAL);
  assert.equal(deficit(tiny), Math.round(maintenance(tiny) * 0.25));
});

// ---------- Daily target ----------
test('daily target: matches the agreed brief for both of us', () => {
  assert.equal(dailyTarget(P1), 2200);
  assert.equal(dailyTarget(P2), 1500);
});

test('daily target: rounded to the nearest 50 so it is memorable', () => {
  for (const p of DEFAULT_PEOPLE) assert.equal(dailyTarget(p) % 50, 0);
});

test('daily target: never drops below the safe floor for the sex', () => {
  const tiny = { ...P2, weightKg: 42, heightCm: 145, age: 60, activityFactor: 1.2 };
  assert.equal(dailyTarget(tiny), SAFE_FLOOR_KCAL.female);
});

// ---------- Protein ----------
test('protein floor: 1.5 g per kg bodyweight, rounded DOWN to 5', () => {
  // It is a floor, so round down — never state a requirement above the evidence.
  assert.equal(proteinFloor(P1), 150);    // 100 * 1.5 = 150 -> 150
  assert.equal(proteinFloor(P2), 95);     // 65  * 1.5 = 97.5 -> 95
});

test('protein floor: never rounds a requirement upwards', () => {
  for (const kg of [51, 62, 77, 83, 102]) {
    const p = proteinFloor({ weightKg: kg });
    assert.ok(p <= kg * 1.5, `${kg}kg -> ${p}g must not exceed 1.5 g/kg`);
    assert.ok(kg * 1.5 - p < 5, `${kg}kg -> ${p}g must stay within 5g of the target`);
  }
});

// ---------- Exercise eat-back ----------
test('dayTarget: a normal day is just the daily target', () => {
  assert.equal(dayTarget(P1, { exerciseKcal: 0 }), 2200);
  assert.equal(dayTarget(P1), 2200);
});

test('dayTarget: football day eats back half the burn (600 -> +300)', () => {
  assert.equal(dayTarget(P1, { exerciseKcal: 600 }), 2500);
});

test('dayTarget: eating back half of a burn still deepens that day deficit', () => {
  const burn = 600;
  const netDeficit = maintenance(P1) + burn - dayTarget(P1, { exerciseKcal: burn });
  assert.ok(netDeficit > maintenance(P1) - dailyTarget(P1),
    'football day should lose more, not less');
});

// ---------- Weekly outcome ----------
test('weeklyLossKg: both of us land at roughly 0.4-0.55 kg per week', () => {
  const nickWeek = [0, 0, 0, 0, 600, 0, 0]; // football on Friday
  const nickLoss = weeklyLossKg(P1, nickWeek);
  const partnerLoss = weeklyLossKg(P2);
  for (const [who, loss] of [['person1', nickLoss], ['person2', partnerLoss]]) {
    assert.ok(loss > 0.4 && loss < 0.55, `${who} loss was ${loss.toFixed(3)} kg/week`);
  }
});

// ---------- Slot budgets ----------
test('slotBudget: kcal split sums EXACTLY to the day target (no drift)', () => {
  for (const day of [2200, 1500, 2500, 1350]) {
    const { kcal } = slotBudget(day, 150);
    assert.equal(SLOTS.reduce((s, k) => s + kcal[k], 0), day);
  }
});

test('slotBudget: protein split sums EXACTLY to the day protein floor', () => {
  for (const g of [150, 105, 90]) {
    const { protein } = slotBudget(2200, g);
    assert.equal(SLOTS.reduce((s, k) => s + protein[k], 0), g);
  }
});

test('slotBudget: dinner is the biggest meal, snack the smallest', () => {
  const { kcal } = slotBudget(2200, 150);
  assert.ok(kcal.dinner > kcal.lunch, 'dinner > lunch');
  assert.ok(kcal.lunch > kcal.breakfast, 'lunch > breakfast');
  assert.ok(kcal.breakfast > kcal.snack, 'breakfast > snack');
});

test('slotBudget: the evening snack is a real, planned allowance', () => {
  assert.ok(slotBudget(2200, 150).kcal.snack >= 350, 'Person 1 gets a usable night snack');
  assert.ok(slotBudget(1500, 95).kcal.snack >= 200, 'Person 2 gets a usable night snack');
});

test('slotBudget: football day grows dinner most (post-match recovery)', () => {
  const normal = slotBudget(2200, 150).kcal;
  const football = slotBudget(2500, 150).kcal;
  const growth = SLOTS.map(s => football[s] - normal[s]);
  assert.equal(Math.max(...growth), football.dinner - normal.dinner);
});

// ---------- Profile ----------
test('profile: exposes every number the UI needs to explain itself', () => {
  const p = profile(P1);
  assert.deepEqual(Object.keys(p).sort(), [
    'bmr', 'deficit', 'dailyTarget', 'maintenance', 'proteinFloor', 'weeklyLossKg',
    'goal', 'goalWeightKg', 'toGo',
  ].sort());
  assert.equal(p.dailyTarget, 2200);
  assert.equal(p.proteinFloor, 150);
});

// ---------- Portion ratio ----------
test('DEFAULT_PEOPLE: portion ratio is derived, so one pot feeds both correctly', () => {
  const ratio = dailyTarget(P2) / dailyTarget(P1);
  assert.ok(ratio > 0.6 && ratio < 0.75, `ratio was ${ratio}`);
});
