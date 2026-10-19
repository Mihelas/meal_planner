import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAYS, DAY_MODES, SLOT_KEYS, defaultSettings, generateWeek, dayTotals, cookPortions,
  regenerateSlot, forEachEntry, isVegetarianDay,
} from '../src/planner.js';
import { candidatesFor, swapMeal, banRecipe, unbanRecipe, toggleLock } from '../src/swap.js';
import {
  recipeById, bySlot, allRecipes, setCustomRecipes,
} from '../src/recipes.js';
import { pantryKey, poolSizeFor } from '../src/planner.js';
import { dailyTarget, proteinFloor, dayTarget } from '../src/targets.js';

const S = defaultSettings();
const emptyMemory = { banned: [] };
const plan = generateWeek(S, emptyMemory);
const [P1, P2] = S.people;
const eachDay = (fn) => plan.days.forEach((d, i) => fn(d, i));
const entriesOf = (day) => SLOT_KEYS.flatMap((k) => {
  const v = day[k];
  return v && v.person1 ? [v.person1, v.person2] : [v];
}).filter(Boolean);

// ---------- Shape ----------
test('a week is 7 days, each with every slot filled for both of us', () => {
  assert.equal(plan.days.length, 7);
  eachDay((d, i) => {
    assert.equal(d.name, DAYS[i]);
    for (const k of SLOT_KEYS) assert.ok(d[k], `${d.name}: slot "${k}" is empty`);
    assert.ok(d.lunch.person1 && d.lunch.person2, `${d.name}: lunch must be per person`);
  });
});

test('every entry carries the numbers the UI shows, for each person it feeds', () => {
  eachDay((d) => {
    for (const e of entriesOf(d)) {
      const eaters = Object.keys(e.portions);
      assert.ok(eaters.length > 0, `${d.name}/${e.slot}: feeds nobody`);
      for (const p of eaters) {
        assert.ok(e.portions[p] > 0, `${d.name}/${e.slot}: portion for ${p} must be > 0`);
        assert.ok(e.kcal[p] > 0, `${d.name}/${e.slot}: no kcal for ${p}`);
        assert.ok(e.protein[p] >= 0, `${d.name}/${e.slot}: no protein for ${p}`);
      }
      assert.ok(['recipe', 'leftover', 'canteen', 'eat-out'].includes(e.kind), `bad kind ${e.kind}`);
      if (e.kind === 'recipe' || e.kind === 'leftover') {
        assert.ok(recipeById(e.recipeId), `${d.name}/${e.slot}: dangling recipe id ${e.recipeId}`);
      } else {
        assert.ok(e.note && e.note.length > 20, `${d.name}/${e.slot}: ${e.kind} needs real guidance`);
      }
    }
  });
});

test('portions stay in a range a human would actually serve', () => {
  eachDay((d) => {
    for (const e of entriesOf(d)) {
      for (const p of Object.keys(e.portions)) {
        assert.ok(e.portions[p] >= 0.5 && e.portions[p] <= 1.5,
          `${d.name}/${e.slot}: ${e.portions[p]} portions for ${p} is not realistic`);
        assert.equal(e.portions[p] * 4 % 1, 0, `${d.name}/${e.slot}: portions must be quarter steps`);
      }
    }
  });
});

test('recipes land in the slot they were written for', () => {
  const want = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snackAfternoon: 'snack', snackEvening: 'snack' };
  eachDay((d) => {
    for (const k of SLOT_KEYS) {
      const list = d[k].person1 ? [d[k].person1, d[k].person2] : [d[k]];
      for (const e of list) {
        if (e.kind !== 'recipe') continue;
        const r = recipeById(e.recipeId);
        // Leftover lunches legitimately use a dinner recipe; plain recipe picks must match.
        assert.equal(r.slot, want[k], `${d.name}/${k}: ${e.recipeId} is a ${r.slot} recipe`);
      }
    }
  });
});

// ---------- Hitting the targets ----------
test('each of us lands within 10% of our calorie target every single day', () => {
  eachDay((d, i) => {
    const t = dayTotals(d);
    for (const person of S.people) {
      const target = dayTarget(person, { exerciseKcal: person.exerciseKcalByDay[i] });
      const off = Math.abs(t[person.id].kcal - target) / target;
      assert.ok(off <= 0.10,
        `${d.name}/${person.id}: ${t[person.id].kcal} kcal vs target ${target} (off by ${(off * 100).toFixed(1)}%)`);
    }
  });
});

test('the protein floor is cleared every day, for both of us', () => {
  eachDay((d) => {
    const t = dayTotals(d);
    for (const person of S.people) {
      const floor = proteinFloor(person);
      assert.ok(t[person.id].protein >= floor * 0.9,
        `${d.name}/${person.id}: ${t[person.id].protein}g protein vs floor ${floor}g`);
    }
  });
});

test('nobody is asked to eat below a safe minimum on any day', () => {
  eachDay((d) => {
    const t = dayTotals(d);
    assert.ok(t.person1.kcal >= 1500, `${d.name}: Person 1 at ${t.person1.kcal} kcal`);
    assert.ok(t.person2.kcal >= 1200, `${d.name}: person2 at ${t.person2.kcal} kcal`);
  });
});

test('she eats less than him from the same pot, but not dramatically less', () => {
  eachDay((d) => {
    const t = dayTotals(d);
    assert.ok(t.person2.kcal < t.person1.kcal, `${d.name}: portions did not scale down`);
    assert.ok(t.person2.kcal / t.person1.kcal > 0.55, `${d.name}: her day is implausibly small`);
  });
});

// ---------- The 30-minute promise ----------
test('no weekday evening asks for more than 30 minutes of cooking', () => {
  plan.days.slice(0, 5).forEach((d) => {
    const e = d.dinner;
    if (e.kind !== 'recipe') return;
    assert.ok(recipeById(e.recipeId).minutes <= 30, `${d.name}: dinner takes too long`);
  });
});

test('weekend-only recipes never appear on a weekday', () => {
  plan.days.slice(0, 5).forEach((d) => {
    for (const e of entriesOf(d)) {
      if (e.kind !== 'recipe') continue;
      assert.ok(!recipeById(e.recipeId).tags.includes('weekend'),
        `${d.name}: ${e.recipeId} is tagged weekend`);
    }
  });
});

// ---------- Leftover chaining: the anti-pizza mechanism ----------
test('most lunches are yesterday\'s dinner, already in the fridge', () => {
  const lunches = plan.days.flatMap((d) => [d.lunch.person1, d.lunch.person2]);
  const leftovers = lunches.filter((e) => e.kind === 'leftover');
  assert.ok(leftovers.length >= 6, `only ${leftovers.length} of ${lunches.length} lunches are leftovers`);
});

test('a leftover lunch always points back at a real dinner that was leftover-safe', () => {
  eachDay((d, i) => {
    for (const e of [d.lunch.person1, d.lunch.person2]) {
      if (e.kind !== 'leftover') continue;
      assert.equal(e.from, i - 1, `${d.name}: leftover should come from the previous day`);
      const source = plan.days[e.from].dinner;
      assert.equal(source.recipeId, e.recipeId, `${d.name}: leftover does not match that dinner`);
      assert.ok(recipeById(e.recipeId).tags.includes('leftover-ok'),
        `${d.name}: ${e.recipeId} is not tagged leftover-ok`);
    }
  });
});

test('cookPortions tells us to cook tonight\'s dinner AND tomorrow\'s lunch in one go', () => {
  eachDay((d, i) => {
    if (d.dinner.kind !== 'recipe') return;
    const tonight = Object.values(d.dinner.portions).reduce((a, b) => a + b, 0);
    const claimed = cookPortions(plan, i);
    assert.ok(claimed >= tonight - 1e-9, `${d.name}: cookPortions is less than what we eat tonight`);
    const tomorrow = plan.days[i + 1];
    if (tomorrow) {
      const carried = [tomorrow.lunch.person1, tomorrow.lunch.person2]
        .filter((e) => e.kind === 'leftover' && e.from === i)
        .reduce((a, e) => a + Object.values(e.portions).reduce((x, y) => x + y, 0), 0);
      assert.ok(Math.abs(claimed - (tonight + carried)) < 1e-9,
        `${d.name}: cookPortions ${claimed} != tonight ${tonight} + carried ${carried}`);
    }
  });
});

// ---------- Day modes ----------
test('on an office day Person 1 gets canteen guidance instead of a packed lunch', () => {
  // eatOut is cleared so this tests the day mode alone — a booked meal out
  // correctly outranks the canteen, which is asserted separately below.
  const s = { ...S, eatOut: [], dayModes: DAYS.map(() => 'office') };
  const p = generateWeek(s, emptyMemory);
  p.days.forEach((d) => {
    assert.equal(d.lunch.person1.kind, 'canteen', `${d.name}: expected a canteen card`);
    assert.ok(d.lunch.person1.note.includes('Kantine') || /canteen/i.test(d.lunch.person1.note),
      `${d.name}: canteen note should say what to pick`);
    assert.ok(d.lunch.person2.kind !== 'canteen', `${d.name}: she has no canteen`);
  });
});

test('a booked meal out beats the canteen on an office day', () => {
  const s = { ...S, dayModes: DAYS.map(() => 'office'), eatOut: [{ day: 2, slot: 'lunch' }] };
  const p = generateWeek(s, emptyMemory);
  assert.equal(p.days[2].lunch.person1.kind, 'eat-out');
  assert.equal(p.days[1].lunch.person1.kind, 'canteen');
});

test('flipping a day to WFH gives Person 1 real food again, and the rest of the week is untouched', () => {
  const office = { ...S, dayModes: S.dayModes.map((_, i) => (i === 2 ? 'office' : S.dayModes[i])) };
  const wfh = { ...office, dayModes: office.dayModes.map((m, i) => (i === 2 ? 'wfh' : m)) };
  const a = generateWeek(office, emptyMemory);
  const b = generateWeek(wfh, emptyMemory);
  assert.equal(a.days[2].lunch.person1.kind, 'canteen');
  assert.notEqual(b.days[2].lunch.person1.kind, 'canteen');
  for (const i of [0, 1, 3, 4, 5, 6]) {
    assert.equal(a.days[i].dinner.recipeId, b.days[i].dinner.recipeId,
      `changing one day's mode reshuffled ${DAYS[i]}`);
  }
});

test('every day mode is one we support', () => {
  for (const m of S.dayModes) assert.ok(DAY_MODES.includes(m), `unknown day mode ${m}`);
});

// ---------- Friday football ----------
test('Friday dinner needs almost no cooking, because we get in at 22:00', () => {
  const fri = plan.days[S.footballDay];
  assert.equal(fri.dinner.kind, 'recipe');
  const r = recipeById(fri.dinner.recipeId);
  assert.ok(r.tags.includes('post-football'), `Friday dinner ${r.id} is not a post-football recipe`);
  assert.ok(r.minutes <= 10, `Friday dinner takes ${r.minutes} min`);
});

test('Friday afternoon has a pre-match snack and Person 1 gets his football calories back', () => {
  const fri = plan.days[S.footballDay];
  assert.ok(recipeById(fri.snackAfternoon.recipeId).tags.includes('pre-football'),
    'no pre-match snack on Friday');
  const t = dayTotals(fri);
  const normal = dayTotals(plan.days[1]);
  assert.ok(t.person1.kcal > normal.person1.kcal, 'Friday should give Person 1 more food, not less');
  assert.ok(t.person1.kcal > dailyTarget(P1), 'the eat-back never arrived');
});

// ---------- Eating out ----------
test('the two meals out are in the plan and budgeted, not pretended away', () => {
  const out = plan.days.flatMap((d, i) => SLOT_KEYS.flatMap((k) => {
    const list = d[k].person1 ? [d[k].person1, d[k].person2] : [d[k]];
    return list.filter((e) => e.kind === 'eat-out').map((e) => ({ i, k }));
  }));
  const slots = new Set(out.map((o) => `${o.i}-${o.k}`));
  assert.equal(slots.size, S.eatOut.length, 'wrong number of eat-out slots');
  for (const o of S.eatOut) assert.ok(slots.has(`${o.day}-${o.slot}`), `missing eat-out at ${DAYS[o.day]} ${o.slot}`);
});

test('an eat-out slot still counts calories, so the week stays honest', () => {
  const { day, slot } = S.eatOut[0];
  const e = plan.days[day][slot].person1 ? plan.days[day][slot].person1 : plan.days[day][slot];
  assert.ok(e.kcal.person1 > 200, 'an eat-out meal cannot cost zero calories');
});

// ---------- Variety ----------
test('no dinner repeats inside the same week', () => {
  const ids = plan.days.map((d) => d.dinner.recipeId).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, `repeated dinner: ${ids.join(', ')}`);
});

test('breakfasts and snacks vary instead of being the same thing seven times', () => {
  const b = new Set(plan.days.map((d) => d.breakfast.recipeId));
  const s = new Set(plan.days.flatMap((d) => [d.snackAfternoon.recipeId, d.snackEvening.recipeId]));
  assert.ok(b.size >= 4, `only ${b.size} different breakfasts`);
  assert.ok(s.size >= 7, `only ${s.size} different snacks`);
});

test('the evening snack is always an evening one, never an afternoon-only snack', () => {
  eachDay((d) => {
    const r = recipeById(d.snackEvening.recipeId);
    assert.notEqual(r.when, 'afternoon', `${d.name}: ${r.id} is an afternoon snack`);
  });
});

test('the week covers several cuisines rather than one on repeat', () => {
  const c = new Set(plan.days.map((d) => d.dinner.recipeId).filter(Boolean).map((id) => recipeById(id).cuisine));
  assert.ok(c.size >= 3, `only ${c.size} cuisines across the week`);
});

// ---------- Determinism & re-rolling ----------
test('the same seed gives the same week (so a reload is not a surprise)', () => {
  const a = generateWeek({ ...S, seed: 42 }, emptyMemory);
  const b = generateWeek({ ...S, seed: 42 }, emptyMemory);
  assert.deepEqual(a.days.map((d) => d.dinner.recipeId), b.days.map((d) => d.dinner.recipeId));
});

test('a different seed gives a different week', () => {
  const a = generateWeek({ ...S, seed: 1 }, emptyMemory).days.map((d) => d.dinner.recipeId);
  const b = generateWeek({ ...S, seed: 999 }, emptyMemory).days.map((d) => d.dinner.recipeId);
  assert.notDeepEqual(a, b);
});

// ---------- Swap: the button the whole app was asked for ----------
test('swapping a dinner gives a different recipe that still fits the slot', () => {
  const before = plan.days[1].dinner.recipeId;
  const after = swapMeal(plan, S, emptyMemory, { day: 1, slot: 'dinner' });
  const now = after.days[1].dinner;
  assert.notEqual(now.recipeId, before, 'swap returned the same recipe');
  assert.equal(recipeById(now.recipeId).slot, 'dinner');
  assert.ok(now.kcal.person1 > 0 && now.protein.person1 > 0, 'swap did not recompute the numbers');
});

test('swapping does not touch any other day', () => {
  const after = swapMeal(plan, S, emptyMemory, { day: 3, slot: 'dinner' });
  for (const i of [0, 1, 2, 5, 6]) {
    assert.equal(after.days[i].dinner.recipeId, plan.days[i].dinner.recipeId, `${DAYS[i]} changed`);
  }
});

test('swapping never re-introduces a dinner already used that week', () => {
  let p = plan;
  for (let n = 0; n < 8; n++) {
    p = swapMeal(p, S, emptyMemory, { day: 2, slot: 'dinner' });
    const ids = p.days.map((d) => d.dinner.recipeId).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, `swap #${n} created a duplicate dinner`);
  }
});

test('swapping a leftover-safe dinner for an unsafe one repairs tomorrow\'s lunch', () => {
  let p = plan;
  // Force day 1's dinner onto something not leftover-ok and check day 2 still has lunch.
  for (let n = 0; n < 12; n++) {
    p = swapMeal(p, S, emptyMemory, { day: 1, slot: 'dinner' });
    for (const e of [p.days[2].lunch.person1, p.days[2].lunch.person2]) {
      if (e.kind !== 'leftover') continue;
      assert.equal(e.from, 1);
      assert.equal(e.recipeId, p.days[1].dinner.recipeId, 'stale leftover pointing at the old dinner');
      assert.ok(recipeById(e.recipeId).tags.includes('leftover-ok'), 'kept an unsafe leftover');
    }
    assert.ok(p.days[2].lunch.person1.kcal.person1 > 0, 'day 2 lunch lost its calories');
  }
});

test('the Friday swap stays inside the post-football shortlist', () => {
  let p = plan;
  for (let n = 0; n < 4; n++) {
    p = swapMeal(p, S, emptyMemory, { day: S.footballDay, slot: 'dinner' });
    assert.ok(recipeById(p.days[S.footballDay].dinner.recipeId).tags.includes('post-football'),
      'Friday got a dinner we have no time to cook');
  }
});

test('an office lunch cannot be swapped into cooked food (there is no kitchen)', () => {
  const s = { ...S, dayModes: S.dayModes.map((m, i) => (i === 0 ? 'office' : m)) };
  const p = generateWeek(s, emptyMemory);
  const after = swapMeal(p, s, emptyMemory, { day: 0, slot: 'lunch', person: 'person1' });
  assert.equal(after.days[0].lunch.person1.kind, 'canteen');
  assert.notEqual(after.days[0].lunch.person1.note, p.days[0].lunch.person1.note,
    'swapping a canteen card should at least offer a different suggestion');
});

test('swapping her lunch leaves his alone', () => {
  const after = swapMeal(plan, S, emptyMemory, { day: 0, slot: 'lunch', person: 'person2' });
  assert.equal(after.days[0].lunch.person1.recipeId, plan.days[0].lunch.person1.recipeId);
});

// ---------- Ban: "never again" ----------
test('banning a recipe removes it from the plan and from future candidates', () => {
  const victim = plan.days[2].dinner.recipeId;
  const mem = banRecipe(emptyMemory, victim);
  assert.ok(mem.banned.includes(victim));
  const p = generateWeek(S, mem);
  assert.ok(!p.days.some((d) => d.dinner.recipeId === victim), 'banned dinner came back');
  assert.ok(!candidatesFor(p, S, mem, { day: 2, slot: 'dinner' }).some((r) => r.id === victim),
    'banned recipe is still offered as a candidate');
});

test('banning is idempotent and reversible', () => {
  const once = banRecipe(emptyMemory, 'd-huehner-ramen');
  const twice = banRecipe(once, 'd-huehner-ramen');
  assert.deepEqual(once.banned, twice.banned);
  assert.deepEqual(unbanRecipe(twice, 'd-huehner-ramen').banned, []);
});

test('banning everything in a slot is reported, not crashed through', () => {
  const allSnacksBanned = { banned: bySlot('snack').map((r) => r.id) };
  const p = generateWeek(S, allSnacksBanned);
  assert.equal(p.days.length, 7, 'the planner gave up entirely');
  assert.ok(Array.isArray(p.warnings), 'a plan must be able to carry warnings');
  assert.ok(p.warnings.length > 0, 'banning every snack should produce a warning');
  assert.ok(p.warnings.join(' ').includes('snack'), 'the warning should name the slot that ran dry');
});

// ---------- Lock: survives a re-roll ----------
test('a locked meal survives regenerating the week', () => {
  const locked = toggleLock(plan, { day: 3, slot: 'dinner' });
  assert.equal(locked.days[3].dinner.locked, true);
  const re = generateWeek({ ...S, seed: S.seed + 1 }, emptyMemory, locked);
  assert.equal(re.days[3].dinner.recipeId, plan.days[3].dinner.recipeId, 'the lock was ignored');
  assert.equal(re.days[3].dinner.locked, true, 'the lock itself was lost');
});

test('an unlocked meal does get re-rolled', () => {
  const re = generateWeek({ ...S, seed: S.seed + 7 }, emptyMemory, plan);
  const changed = plan.days.filter((d, i) => d.dinner.recipeId !== re.days[i].dinner.recipeId);
  assert.ok(changed.length > 0, 'nothing changed on a re-roll');
});

test('toggling a lock twice returns to unlocked', () => {
  const a = toggleLock(plan, { day: 3, slot: 'dinner' });
  const b = toggleLock(a, { day: 3, slot: 'dinner' });
  assert.equal(b.days[3].dinner.locked, false);
});

// ---------- Candidates ----------
test('there is always something to swap to', () => {
  eachDay((d, i) => {
    for (const slot of ['breakfast', 'dinner', 'snackEvening']) {
      const c = candidatesFor(plan, S, emptyMemory, { day: i, slot });
      assert.ok(c.length >= 2, `${d.name}/${slot}: only ${c.length} candidates`);
    }
  });
});

test('candidates respect the day\'s constraints, not just the slot', () => {
  const fri = candidatesFor(plan, S, emptyMemory, { day: S.footballDay, slot: 'dinner' });
  for (const r of fri) assert.ok(r.minutes <= 10, `${r.id} cannot be cooked at 22:00`);
  const wed = candidatesFor(plan, S, emptyMemory, { day: 2, slot: 'dinner' });
  for (const r of wed) assert.ok(r.minutes <= 30, `${r.id} breaks the weekday cap`);
});

// ---------- Changing one day without losing the week ----------
test('switching a day to Office rewrites only that lunch, keeping every swap', () => {
  const swapped = swapMeal(swapMeal(plan, S, emptyMemory, { day: 0, slot: 'dinner' }),
    S, emptyMemory, { day: 6, slot: 'breakfast' });
  const s2 = { ...S, dayModes: S.dayModes.map((m, i) => (i === 3 ? 'office' : m)) };
  const after = regenerateSlot(swapped, s2, emptyMemory, { day: 3, slot: 'lunch', person: 'person1' });

  assert.equal(after.days[3].lunch.person1.kind, 'canteen', 'the mode change did not take effect');
  assert.equal(after.days[0].dinner.recipeId, swapped.days[0].dinner.recipeId, 'a swapped dinner was lost');
  assert.equal(after.days[6].breakfast.recipeId, swapped.days[6].breakfast.recipeId, 'a swapped breakfast was lost');
  for (let i = 0; i < 7; i++) {
    assert.equal(after.days[i].dinner.recipeId, swapped.days[i].dinner.recipeId, `${DAYS[i]} dinner moved`);
  }
});

test('regenerating a slot does not silently lock everything it touched', () => {
  const locked = toggleLock(plan, { day: 2, slot: 'dinner' });
  const after = regenerateSlot(locked, S, emptyMemory, { day: 4, slot: 'snackEvening' });
  assert.equal(after.days[2].dinner.locked, true, 'a real lock was dropped');
  let stray = 0;
  forEachEntry(after, (e) => { if (e.locked) stray++; });
  assert.equal(stray, 1, `${stray} entries came back locked, expected 1`);
});

// ---------- Variety: the reason to grow the library at all ----------

/** Every recipe the planner reaches for across `weeks` different re-rolls. */
const distinctOver = (weeks) => {
  const ids = new Set();
  for (let k = 0; k < weeks; k += 1) {
    forEachEntry(generateWeek({ ...S, seed: 1000 + k * 7919 }, emptyMemory), (e) => {
      if (e.recipeId) ids.add(e.recipeId);
    });
  }
  return ids;
};

test('a bigger library makes the weeks less repetitive', () => {
  // This is the test that justifies increment B. `choose` used to take a fixed top
  // five, so a library of 77 and a library of 154 produced the same menu -- the
  // same five best-fitting recipes kept winning every slot, every week.
  //
  // The clones score identically to their originals, so nothing but a wider pool
  // can surface them. If this fails, adding recipes is wasted work.
  const before = distinctOver(8).size;
  const clones = allRecipes()
    .filter((r) => !r.tags.includes('custom'))
    .map((r, n) => ({ ...r, id: `u-clone-${n}`, name: `${r.name} II` }));
  try {
    setCustomRecipes(clones);
    const after = distinctOver(8).size;
    assert.ok(after > before, `doubling the library gave ${after} distinct recipes, not more than ${before}`);
  } finally {
    setCustomRecipes([]);
  }
});

test('the pool grows with the library but never swallows it whole', () => {
  // A quarter of the candidates, so variety scales -- but floored so a thin slot
  // still has somewhere to turn, and capped so the worst-fitting half of a big
  // library never reaches the plate.
  assert.equal(poolSizeFor(0), 0);
  assert.equal(poolSizeFor(3), 3, 'never more than there are');
  assert.equal(poolSizeFor(12), 5, 'floor holds for a small library');
  assert.ok(poolSizeFor(60) > 5, 'a bigger pool must actually be bigger');
  assert.ok(poolSizeFor(400) <= 12, 'and must stay a shortlist, not a lottery');
  for (let n = 1; n < 400; n += 1) {
    assert.ok(poolSizeFor(n) >= poolSizeFor(n - 1), `not monotonic at ${n}`);
    assert.ok(poolSizeFor(n) <= n, `pool bigger than the pool at ${n}`);
  }
});

test('a named recipe goes straight into the slot, however long the shortlist gets', () => {
  // The swap sheet offers the top twenty by preference; swapMeal's own ordering
  // is by budget fit, so the pick can sit anywhere in its shortlist. The UI used
  // to run the engine forty times hoping the cycle would land on the chosen id,
  // which quietly stopped working the week dinner passed forty candidates: the
  // click then left whatever the fortieth step happened to be. An explicit pick
  // has to be honoured in one call, whatever the library grows to.
  const person = P1.id;
  // Any day the kitchen cooks meat on: a vegetarian day's dinner shortlist is
  // legitimately short (the veg pool is a fraction of the library), and this test
  // is about what happens when the shortlist is LONG.
  const day = [0, 1, 2, 3, 6].find((d) => !isVegetarianDay(S, d));
  const at = { day, slot: 'dinner', person };
  const options = candidatesFor(plan, S, emptyMemory, at);
  assert.ok(options.length > 40,
    `only ${options.length} dinner candidates -- the deep end of the list is untested`);
  for (const r of options) {
    const next = swapMeal(plan, S, emptyMemory, { ...at, recipeId: r.id });
    const v = next.days[day].dinner;
    const got = (v?.recipeId ?? v?.[person]?.recipeId);
    assert.equal(got, r.id, `asked for ${r.id} and got ${got}`);
  }
});

test('a named recipe that is not on offer is refused, not forced in', () => {
  // data-pick comes off the DOM, and the slot's own rules (banned, already on
  // the board, wrong slot) are the only thing standing between a stale button
  // and a week with porridge for dinner.
  const person = P1.id;
  const at = { day: 2, slot: 'dinner', person };
  const before = plan.days[2].dinner.recipeId;
  for (const id of ['b-skyr-beeren-nuss', 'no-such-recipe', before]) {
    const next = swapMeal(plan, S, emptyMemory, { ...at, recipeId: id });
    assert.equal(next.days[2].dinner.recipeId, before, `${id} should have changed nothing`);
  }
});

test('pantryKey tells every item in the library apart', () => {
  // The pantry and the shopping list both key on this. Two different items that
  // collapse to one key would merge into one shopping line, and ticking "I have
  // it" would quietly remove the other. Umlauts were the way in: Olivenoel and
  // Olivenol both used to reduce to "oliven-l-ml".
  const seen = new Map();
  for (const r of allRecipes()) {
    for (const ing of r.ingredients) {
      const k = pantryKey(ing);
      const label = `${ing.item} (${ing.unit})`;
      const prior = seen.get(k);
      if (prior && prior !== label) assert.fail(`"${label}" and "${prior}" both key to "${k}"`);
      seen.set(k, label);
    }
  }
  assert.ok(seen.size > 100, `only ${seen.size} distinct keys -- something collapsed`);
  for (const k of seen.keys()) {
    // Lower-case ASCII name, then the unit verbatim. Anything else means a
    // character survived into a key that is stored, exported and compared as text.
    assert.match(k, /^[a-z0-9-]+-(g|ml|Stk)$/, `key "${k}" is not a stable key`);
  }
});
