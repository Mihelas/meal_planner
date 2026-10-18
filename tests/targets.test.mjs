import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bmr, maintenance, deficit, dailyTarget, proteinFloor, dayTarget,
  weeklyLossKg, slotBudget, profile, DEFAULT_PEOPLE, SLOTS,
  SAFE_FLOOR_KCAL, MAX_DEFICIT_KCAL,
} from '../src/targets.js';

const NICK = DEFAULT_PEOPLE.find(p => p.id === 'nick');
const PARTNER = DEFAULT_PEOPLE.find(p => p.id === 'partner');

// ---------- BMR (Mifflin-St Jeor) ----------
test('bmr: male matches Mifflin-St Jeor by hand (102kg/180cm/34)', () => {
  // 10*102 + 6.25*180 - 5*34 + 5 = 1020 + 1125 - 170 + 5
  assert.equal(bmr(NICK), 1980);
});

test('bmr: female matches Mifflin-St Jeor by hand (70kg/160cm/35)', () => {
  // 10*70 + 6.25*160 - 5*35 - 161 = 700 + 1000 - 175 - 161
  assert.equal(bmr(PARTNER), 1364);
});

test('bmr: throws on unknown sex rather than silently guessing', () => {
  assert.throws(() => bmr({ ...NICK, sex: 'other' }), /unknown sex/);
});

test('bmr: throws on non-positive or missing measurements', () => {
  assert.throws(() => bmr({ ...NICK, weightKg: 0 }), /weightKg/);
  assert.throws(() => bmr({ ...NICK, heightCm: undefined }), /heightCm/);
  assert.throws(() => bmr({ ...NICK, age: -1 }), /age/);
});

// ---------- Maintenance ----------
test('maintenance: bmr x activity factor, rounded to 10', () => {
  assert.equal(maintenance(NICK), 2720);    // 1980 * 1.375 = 2722.5
  assert.equal(maintenance(PARTNER), 1980); // 1364 * 1.45  = 1977.8
});

// ---------- Deficit ----------
test('deficit: capped at 500 kcal/day for a large maintenance', () => {
  assert.equal(deficit(NICK), MAX_DEFICIT_KCAL);
});

test('deficit: capped at 25% of maintenance for a small maintenance', () => {
  const tiny = { ...PARTNER, weightKg: 45, heightCm: 150, activityFactor: 1.2 };
  assert.ok(deficit(tiny) < MAX_DEFICIT_KCAL);
  assert.equal(deficit(tiny), Math.round(maintenance(tiny) * 0.25));
});

// ---------- Daily target ----------
test('daily target: matches the agreed brief for both of us', () => {
  assert.equal(dailyTarget(NICK), 2200);
  assert.equal(dailyTarget(PARTNER), 1500);
});

test('daily target: rounded to the nearest 50 so it is memorable', () => {
  for (const p of DEFAULT_PEOPLE) assert.equal(dailyTarget(p) % 50, 0);
});

test('daily target: never drops below the safe floor for the sex', () => {
  const tiny = { ...PARTNER, weightKg: 42, heightCm: 145, age: 60, activityFactor: 1.2 };
  assert.equal(dailyTarget(tiny), SAFE_FLOOR_KCAL.female);
});

// ---------- Protein ----------
test('protein floor: 1.5 g per kg bodyweight, rounded DOWN to 5', () => {
  // It is a floor, so round down — never state a requirement above the evidence.
  assert.equal(proteinFloor(NICK), 150);    // 102 * 1.5 = 153 -> 150
  assert.equal(proteinFloor(PARTNER), 105); // 70  * 1.5 = 105 -> 105
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
  assert.equal(dayTarget(NICK, { exerciseKcal: 0 }), 2200);
  assert.equal(dayTarget(NICK), 2200);
});

test('dayTarget: football day eats back half the burn (600 -> +300)', () => {
  assert.equal(dayTarget(NICK, { exerciseKcal: 600 }), 2500);
});

test('dayTarget: eating back half of a burn still deepens that day deficit', () => {
  const burn = 600;
  const netDeficit = maintenance(NICK) + burn - dayTarget(NICK, { exerciseKcal: burn });
  assert.ok(netDeficit > maintenance(NICK) - dailyTarget(NICK),
    'football day should lose more, not less');
});

// ---------- Weekly outcome ----------
test('weeklyLossKg: both of us land at roughly 0.4-0.55 kg per week', () => {
  const nickWeek = [0, 0, 0, 0, 600, 0, 0]; // football on Friday
  const nickLoss = weeklyLossKg(NICK, nickWeek);
  const partnerLoss = weeklyLossKg(PARTNER);
  for (const [who, loss] of [['nick', nickLoss], ['partner', partnerLoss]]) {
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
  assert.ok(slotBudget(2200, 150).kcal.snack >= 350, 'Nick gets a usable night snack');
  assert.ok(slotBudget(1500, 105).kcal.snack >= 200, 'Partner gets a usable night snack');
});

test('slotBudget: football day grows dinner most (post-match recovery)', () => {
  const normal = slotBudget(2200, 150).kcal;
  const football = slotBudget(2500, 150).kcal;
  const growth = SLOTS.map(s => football[s] - normal[s]);
  assert.equal(Math.max(...growth), football.dinner - normal.dinner);
});

// ---------- Profile ----------
test('profile: exposes every number the UI needs to explain itself', () => {
  const p = profile(NICK);
  assert.deepEqual(Object.keys(p).sort(), [
    'bmr', 'deficit', 'dailyTarget', 'maintenance', 'proteinFloor', 'weeklyLossKg',
    'goal', 'goalWeightKg', 'toGo',
  ].sort());
  assert.equal(p.dailyTarget, 2200);
  assert.equal(p.proteinFloor, 150);
});

// ---------- Portion ratio ----------
test('DEFAULT_PEOPLE: portion ratio is derived, so one pot feeds both correctly', () => {
  const ratio = dailyTarget(PARTNER) / dailyTarget(NICK);
  assert.ok(ratio > 0.6 && ratio < 0.75, `ratio was ${ratio}`);
});
