// Energy + protein targets. Pure functions, no DOM — see tests/targets.test.mjs.
//
// Model (deliberately transparent, because every number here is an ESTIMATE with
// roughly +/-10% error; the weight log in the app is the real feedback loop):
//
//   BMR            Mifflin-St Jeor
//   maintenance    BMR x activity factor
//   deficit        min(500 kcal, 25% of maintenance)   <- the cap protects small people
//   daily target   maintenance - deficit, floored for safety, rounded to 50
//   exercise       eat back HALF the burn on sport days, so the day still nets a deficit
//
// Once the goal weight is reached the deficit logic stops being right, so each
// person carries a goal: 'lose' or 'maintain'. Maintenance eats AT maintenance and
// eats back the whole exercise burn, because there is nothing left to take off.

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const GOALS = ['lose', 'maintain'];

export const KCAL_PER_KG_FAT = 7700;
export const MAX_DEFICIT_KCAL = 500;
export const MAX_DEFICIT_FRACTION = 0.25;
export const EAT_BACK_FRACTION = 0.5;
export const PROTEIN_G_PER_KG = 1.5;

// Below these, a plan stops being a diet and starts being a deficiency.
export const SAFE_FLOOR_KCAL = { male: 1500, female: 1200 };

const SEX_OFFSET = { male: 5, female: -161 };

const round = (n, step) => Math.round(n / step) * step;

export const ACTIVITY_LEVELS = [
  { value: 1.2,   label: 'Sedentary — desk all day, little walking' },
  { value: 1.375, label: 'Lightly active — mostly desk, 1 sport session a week' },
  { value: 1.45,  label: 'On the move — daily walking, public transport, appointments' },
  { value: 1.55,  label: 'Moderately active — sport 3–5× a week' },
  { value: 1.725, label: 'Very active — hard training most days' },
];

export function bmr({ weightKg, heightCm, age, sex }) {
  const offset = SEX_OFFSET[sex];
  if (offset === undefined) throw new Error(`bmr: unknown sex "${sex}"`);
  for (const [name, value] of Object.entries({ weightKg, heightCm, age })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`bmr: ${name} must be a positive number, got ${value}`);
    }
  }
  return 10 * weightKg + 6.25 * heightCm - 5 * age + offset;
}

export function maintenance(person) {
  return round(bmr(person) * person.activityFactor, 10);
}

export const isMaintaining = (person) => person?.goal === 'maintain';

export function deficit(person) {
  if (isMaintaining(person)) return 0;
  return Math.min(MAX_DEFICIT_KCAL, Math.round(maintenance(person) * MAX_DEFICIT_FRACTION));
}

/**
 * How much of a sport day's burn goes back on the plate. Half while losing, so
 * the day still nets a deficit; all of it while maintaining, because replacing
 * what you burned IS maintenance.
 */
export function eatBackFraction(person) {
  return isMaintaining(person) ? 1 : EAT_BACK_FRACTION;
}

/** Has the log caught up with the goal? Used to offer the switch, never to force it. */
export function atGoalWeight(person) {
  const goal = person?.goalWeightKg;
  if (!Number.isFinite(goal) || goal <= 0) return false;
  return person.weightKg <= goal;
}

export const shouldSuggestMaintenance = (person) => !isMaintaining(person) && atGoalWeight(person);

export function dailyTarget(person) {
  // Losing targets are rounded to 50 so they are memorable. Maintenance is not:
  // rounding down to the nearest 50 would leave a ~20 kcal/day gap that the app
  // would then honestly report as continued weight loss, which is not what the
  // person asked for. maintenance() is already a multiple of 10.
  const raw = isMaintaining(person)
    ? maintenance(person)
    : round(maintenance(person) - deficit(person), 50);
  return Math.max(SAFE_FLOOR_KCAL[person.sex], raw);
}

// Rounded DOWN to the nearest 5: this is a floor to clear, so we must not invent a
// requirement above what 1.5 g/kg actually supports (102 kg -> 153 g -> 150 g).
export function proteinFloor(person) {
  return Math.floor((person.weightKg * PROTEIN_G_PER_KG) / 5) * 5;
}

/** Target for one specific day, eating back part of any exercise burn. */
export function dayTarget(person, { exerciseKcal = 0 } = {}) {
  const back = exerciseKcal * eatBackFraction(person);
  // Same reasoning as dailyTarget: exact while maintaining, memorable while losing.
  return dailyTarget(person) + (isMaintaining(person) ? Math.round(back) : round(back, 50));
}

/** Predicted weekly fat loss given each day's exercise burn. */
export function weeklyLossKg(person, exerciseKcalByDay = [0, 0, 0, 0, 0, 0, 0]) {
  const base = maintenance(person);
  const weekly = exerciseKcalByDay.reduce(
    (sum, burn) => sum + (base + burn - dayTarget(person, { exerciseKcal: burn })), 0);
  return weekly / KCAL_PER_KG_FAT;
}

// Dinner is the anchor: biggest meal, latest in the day, and it cooks tomorrow's lunch.
// The snack share is deliberately generous — a planned 22:00 snack beats an unplanned one.
const KCAL_SHARE    = { breakfast: 0.20, lunch: 0.27, snack: 0.19 };
const PROTEIN_SHARE = { breakfast: 0.25, lunch: 0.25, snack: 0.20 };

/**
 * Split a day's kcal/protein across the four slots. Dinner absorbs the rounding
 * remainder so the parts always sum EXACTLY to the day's target.
 */
export function slotBudget(dayKcal, dayProtein) {
  const kcal = {};
  const protein = {};
  for (const slot of ['breakfast', 'lunch', 'snack']) {
    kcal[slot] = round(dayKcal * KCAL_SHARE[slot], 10);
    protein[slot] = Math.round(dayProtein * PROTEIN_SHARE[slot]);
  }
  const sum = (o) => o.breakfast + o.lunch + o.snack;
  kcal.dinner = dayKcal - sum(kcal);
  protein.dinner = dayProtein - sum(protein);
  return { kcal, protein };
}

export function profile(person) {
  return {
    bmr: bmr(person),
    maintenance: maintenance(person),
    deficit: deficit(person),
    dailyTarget: dailyTarget(person),
    proteinFloor: proteinFloor(person),
    weeklyLossKg: weeklyLossKg(person, person.exerciseKcalByDay),
    goal: person.goal ?? 'lose',
    goalWeightKg: person.goalWeightKg ?? null,
    toGo: Number.isFinite(person.goalWeightKg)
      ? Math.round((person.weightKg - person.goalWeightKg) * 10) / 10 : null,
  };
}

export const DEFAULT_PEOPLE = [
  {
    id: 'nick', name: 'Nick', sex: 'male',
    weightKg: 102, heightCm: 180, age: 34,
    activityFactor: 1.375,
    // Football on Friday, which is position 4 in a week that starts on Monday, ~600 kcal for 90 minutes.
    exerciseKcalByDay: [0, 0, 0, 0, 600, 0, 0],
    eatsAtCanteen: true,
    // A first goal, not a final one: 90 kg is a BMI of 27.8, which is where the
    // next decision gets made. Editable in Settings.
    goal: 'lose', goalWeightKg: 90,
  },
  {
    id: 'partner', name: 'Partner', sex: 'female',
    weightKg: 70, heightCm: 160, age: 35,
    activityFactor: 1.45,
    exerciseKcalByDay: [0, 0, 0, 0, 0, 0, 0],
    eatsAtCanteen: false,
    goal: 'lose', goalWeightKg: 63,
  },
];

/** How much smaller her portion is from the same pot. Derived, never hardcoded. */
export function portionRatio(people = DEFAULT_PEOPLE) {
  const [a, b] = people;
  return dailyTarget(b) / dailyTarget(a);
}
