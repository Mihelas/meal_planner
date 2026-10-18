// Two people at home eat the same lunch.
//
// The lunch slot is per-person, and it has to stay that way: he is at a canteen
// on office days and she packs a box, so the two plates genuinely differ most of
// the week. But when BOTH of them are eating out of the same kitchen, two
// separately cooked lunches contradicts the whole premise of the app - one pot,
// shared - and quietly doubles both the cooking and that day's shopping.
//
// Before this fix they only ever coincided by accident of sharing a source: the
// same leftover pot, the same canteen card, the same meal-out card. With no
// source to share - a Sunday after a Saturday spent eating out - each of them
// drew their own recipe, and `usedLunches` then GUARANTEED the two draws
// differed, because the first pick is excluded from the second.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, generateWeek, portionsByRecipe } from '../src/planner.js';
import { recipeById } from '../src/recipes.js';

const S = defaultSettings();
const NICK = S.people[0].id;
const GF = S.people[1].id;

/** What a lunch entry IS, for the purpose of "is this the same meal?" */
const identity = (e) => `${e.kind}|${e.recipeId ?? e.note ?? ''}`;
const isShared = (day) => new Set(Object.values(day.lunch).map(identity)).size === 1;
/** Both of them eating from the kitchen: nobody at a canteen, nobody booked out. */
const bothHome = (settings, day) => day.mode !== 'office'
  && !settings.eatOut.some((o) => o.day === day.index && o.slot === 'lunch');

/** The arrangements that decide whether a day has a pot to share. */
const ARRANGEMENTS = {
  'shipped defaults': S,
  // The repro: nothing is cooked on Saturday, so Sunday lunch has no leftovers.
  'both meals out at dinner': { ...S, eatOut: [{ day: 5, slot: 'dinner' }, { day: 6, slot: 'dinner' }] },
  'no meals out at all': { ...S, eatOut: [] },
  'every day at home': {
    ...S, dayModes: ['wfh', 'wfh', 'wfh', 'wfh', 'wfh', 'together', 'together'],
  },
  'batch cooking': { ...S, cookingStyle: 'batch' },
  'a week that starts on Thursday': { ...S, weekStart: 3 },
};

test('whenever both of them are home, they get one lunch between them', () => {
  for (const [label, settings] of Object.entries(ARRANGEMENTS)) {
    for (let seed = 1; seed <= 25; seed++) {
      const plan = generateWeek({ ...settings, seed }, { banned: [] });
      for (const day of plan.days) {
        if (!bothHome(settings, day)) continue;
        assert.ok(isShared(day),
          `${label} seed ${seed}: ${day.name} cooks two lunches - `
          + Object.entries(day.lunch).map(([p, e]) => `${p}=${identity(e)}`).join(' vs '));
      }
    }
  }
});

test('the Sunday that started this: a weekend with nothing to carry still shares', () => {
  // Saturday dinner is out, so Sunday lunch has no pot behind it and both of
  // them fall through to a fresh pick. That is the case that used to split.
  const settings = ARRANGEMENTS['both meals out at dinner'];
  for (let seed = 1; seed <= 40; seed++) {
    const sunday = generateWeek({ ...settings, seed }, { banned: [] }).days[6];
    assert.equal(sunday.lunch[NICK].kind, 'recipe', `seed ${seed}: Sunday lunch is not a cooked meal`);
    assert.equal(sunday.lunch[NICK].recipeId, sunday.lunch[GF].recipeId,
      `seed ${seed}: Sunday cooks ${sunday.lunch[NICK].recipeId} and ${sunday.lunch[GF].recipeId}`);
  }
});

test('office days still send him to the canteen and leave her a real lunch', () => {
  // The per-person slot has to survive: this is the behaviour that makes it
  // worth having, and a fix that shares everything would break it.
  const plan = generateWeek(S, { banned: [] });
  const office = plan.days.filter((d) => d.mode === 'office');
  assert.ok(office.length >= 2, 'the fixture week has no office days');
  for (const d of office) {
    assert.equal(d.lunch[NICK].kind, 'canteen', `${d.name}: he is not at the canteen`);
    assert.notEqual(d.lunch[GF].kind, 'canteen', `${d.name}: she was sent to his canteen`);
  }
});

test('a shared lunch is still portioned to each of them separately', () => {
  // One recipe, two appetites. He is 102 kg and she is 70 kg, so the same dish
  // must not arrive as the same amount of food.
  const settings = ARRANGEMENTS['both meals out at dinner'];
  const sunday = generateWeek({ ...settings, seed: 7 }, { banned: [] }).days[6];
  const his = sunday.lunch[NICK];
  const hers = sunday.lunch[GF];
  assert.equal(his.recipeId, hers.recipeId);
  assert.ok(his.portions[NICK] > 0 && hers.portions[GF] > 0, 'someone is eating nothing');
  assert.ok(his.portions[NICK] >= hers.portions[GF],
    `he gets ${his.portions[NICK]} and she gets ${hers.portions[GF]}`);
  // Each entry carries only its own eater, which is what the plate UI reads.
  assert.deepEqual(Object.keys(his.portions), [NICK]);
  assert.deepEqual(Object.keys(hers.portions), [GF]);
});

test('sharing a lunch buys it once, for two', () => {
  const settings = ARRANGEMENTS['both meals out at dinner'];
  const plan = generateWeek({ ...settings, seed: 7 }, { banned: [] });
  const sunday = plan.days[6];
  const id = sunday.lunch[NICK].recipeId;
  const wanted = sunday.lunch[NICK].portions[NICK] + sunday.lunch[GF].portions[GF];
  // Only Sunday is in the slice, so the whole demand for that recipe is theirs.
  const only = portionsByRecipe({ ...plan, days: [sunday] });
  assert.equal(only.get(id), wanted,
    `the list wants ${only.get(id)} portions where the two of them eat ${wanted}`);
});

test('variety across the week survives: no lunch is cooked fresh twice', () => {
  for (const [label, settings] of Object.entries(ARRANGEMENTS)) {
    const plan = generateWeek({ ...settings, seed: 3 }, { banned: [] });
    const fresh = plan.days
      .filter((d) => d.lunch[GF]?.kind === 'recipe')
      .map((d) => d.lunch[GF].recipeId);
    assert.equal(new Set(fresh).size, fresh.length, `${label}: a fresh lunch repeats - ${fresh}`);
  }
});

test('if one of them has a lunch locked, the other joins it', () => {
  // A lock is a deliberate "this plate stays". The other plate should come
  // along rather than becoming a second thing to cook.
  const settings = ARRANGEMENTS['both meals out at dinner'];
  const first = generateWeek({ ...settings, seed: 11 }, { banned: [] });
  const pinned = first.days[6].lunch[NICK].recipeId;
  const previous = {
    ...first,
    days: first.days.map((d, i) => (i === 6
      ? { ...d, lunch: { ...d.lunch, [NICK]: { ...d.lunch[NICK], locked: true } } }
      : d)),
  };
  // A different seed, so an unchanged pick cannot be a coincidence.
  const next = generateWeek({ ...settings, seed: 12 }, { banned: [] }, previous);
  assert.equal(next.days[6].lunch[NICK].recipeId, pinned, 'the locked lunch moved');
  assert.equal(next.days[6].lunch[GF].recipeId, pinned, 'she is cooking a second lunch');
});

test('a shared lunch is still a lunch: packable or no-cook, and inside the cap', () => {
  for (const [label, settings] of Object.entries(ARRANGEMENTS)) {
    for (let seed = 1; seed <= 10; seed++) {
      const plan = generateWeek({ ...settings, seed }, { banned: [] });
      for (const day of plan.days) {
        for (const e of Object.values(day.lunch)) {
          if (e.kind !== 'recipe') continue;
          const r = recipeById(e.recipeId);
          assert.ok(r.tags.includes('packable') || r.tags.includes('no-cook'),
            `${label} seed ${seed}: ${day.name} lunch ${r.id} is neither packable nor no-cook`);
        }
      }
    }
  }
});
