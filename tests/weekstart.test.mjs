// The week does not have to begin on Monday.
//
// The whole app indexes days by POSITION: `plan.days[2]` is the third day of the
// week, `day.index` is 2, `settings.dayModes[2]` is that day's mode, a plate's DOM
// id says 2, and the leftover chain means "position 3 eats what position 2 cooked".
// That stays true at every week start, which is why nothing in swap.js, the batch
// chain, the plan id or the merge needs to know this feature exists.
//
// What changes is the REAL WEEKDAY a position falls on, and only two things care:
// the labels, and the rules that are genuinely about weekdays — the 30-minute cap,
// the `weekend` tag, and football. Those must follow the calendar, not the column.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAYS, defaultSettings, generateWeek, setWeekStart, weekdayOf, dayName,
  slotCandidates, cookSessions,
} from '../src/planner.js';
import { recipeById } from '../src/recipes.js';
import { migrate } from '../src/store.js';
import { open } from './harness.mjs';

const S = defaultSettings();
const THU = 3;
const FRI = 4;
const namesOf = (plan) => plan.days.map((d) => d.name);
/** The position a given real weekday sits at, under these settings. */
const positionOf = (settings, weekday) => (weekday - (settings.weekStart ?? 0) + 7) % 7;

// ---------- the setting itself ----------

test('the week starts on Monday until told otherwise', () => {
  assert.equal(S.weekStart, 0);
  assert.deepEqual(namesOf(generateWeek(S, { banned: [] })), DAYS);
});

test('a position maps to the weekday it actually falls on', () => {
  for (let w = 0; w < 7; w++) {
    const s = { ...S, weekStart: w };
    assert.equal(weekdayOf(s, 0), w, `position 0 must be the chosen start day`);
    assert.equal(dayName(s, 0), DAYS[w]);
    // Seven positions, seven weekdays, no repeats and nothing missed.
    const seen = [...Array(7)].map((_, p) => weekdayOf(s, p));
    assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6],
      `week starting ${DAYS[w]} does not cover each weekday once: ${seen}`);
  }
});

test('missing or junk weekStart is read as Monday rather than breaking the week', () => {
  for (const bad of [undefined, null, '3', 7, -1, NaN, {}]) {
    assert.equal(weekdayOf({ weekStart: bad }, 2), 2, `weekStart ${String(bad)} should fall back to Monday`);
  }
  assert.equal(weekdayOf(undefined, 2), 2);
});

// ---------- generation ----------

test('the generated week reads from the chosen day round to the day before', () => {
  const s = setWeekStart(S, THU);
  assert.deepEqual(namesOf(generateWeek(s, { banned: [] })),
    ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
});

test('positions stay positions: index 0 is still the first day of the week', () => {
  const plan = generateWeek(setWeekStart(S, THU), { banned: [] });
  plan.days.forEach((d, i) => {
    assert.equal(d.index, i, `day.index must be the position, not the weekday`);
  });
});

// ---------- the rules that are really about weekdays ----------

test('the 30-minute cap follows the calendar, not the column', () => {
  const s = setWeekStart(S, THU);
  const plan = generateWeek(s, { banned: [] });
  // Thu-start puts Sat and Sun at positions 2 and 3, in the middle of the grid.
  const weekendPositions = [positionOf(s, 5), positionOf(s, 6)];
  assert.deepEqual(weekendPositions, [2, 3], 'Sat and Sun should sit mid-grid here');
  plan.days.forEach((d, i) => {
    if (weekendPositions.includes(i)) return;
    // Only a dinner cooked that evening: 'batch' and 'leftover' are reheats of
    // something already cooked, and the cap has nothing to say about those.
    if (d.dinner?.kind !== 'recipe') return;
    const { minutes } = recipeById(d.dinner.recipeId);
    assert.ok(minutes <= 30,
      `${d.name} (position ${i}) is a working day but wants ${minutes} min`);
  });
});

test('a weekend recipe is only offered on a real Saturday or Sunday', () => {
  const s = setWeekStart(S, THU);
  for (let p = 0; p < 7; p++) {
    const weekday = weekdayOf(s, p);
    const isWeekend = weekday >= 5;
    const offered = slotCandidates(s, { banned: [] }, { day: p, slot: 'dinner' });
    const long = offered.filter((r) => r.minutes > 30 || r.tags.includes('weekend'));
    if (isWeekend) {
      assert.ok(long.length > 0, `${DAYS[weekday]} is a weekend and should allow a longer cook`);
    } else {
      assert.equal(long.length, 0,
        `${DAYS[weekday]} (position ${p}) offered ${long.length} weekend dishes`);
    }
  }
});

test('football stays on Friday when the week is re-cut', () => {
  for (let w = 0; w < 7; w++) {
    const s = setWeekStart(S, w);
    assert.equal(s.footballDay, positionOf(s, FRI),
      `week starting ${DAYS[w]}: football moved off Friday`);
    const plan = generateWeek(s, { banned: [] });
    const match = plan.days[s.footballDay];
    assert.equal(match.name, 'Fri', `week starting ${DAYS[w]}: the match is on ${match.name}`);
    assert.equal(match.dinner.kind, 'recipe');
    const r = recipeById(match.dinner.recipeId);
    assert.ok(r.tags.includes('post-football'),
      `week starting ${DAYS[w]}: ${r.id} is not a post-football dinner`);
    assert.ok(r.minutes <= 10,
      `week starting ${DAYS[w]}: Friday dinner takes ${r.minutes} min, and we get in at 22:00`);
  }
});

// ---------- the rotation of everything that is keyed by position ----------

test('re-cutting the week carries each real day its own settings', () => {
  // Monday is an office day and Saturday is a together day. Start the week on
  // Thursday and those facts must not have moved to whatever is now in slot 0.
  const s = setWeekStart(S, THU);
  for (let weekday = 0; weekday < 7; weekday++) {
    assert.equal(s.dayModes[positionOf(s, weekday)], S.dayModes[weekday],
      `${DAYS[weekday]} lost its day mode`);
    assert.equal(s.people[0].exerciseKcalByDay[positionOf(s, weekday)],
      S.people[0].exerciseKcalByDay[weekday], `${DAYS[weekday]} lost its exercise burn`);
  }
  assert.deepEqual(cookSessions(s).sort((a, b) => a - b),
    cookSessions(S).map((d) => positionOf(s, d)).sort((a, b) => a - b),
    'the cook-up days are no longer the same weekdays');
  for (const o of S.eatOut) {
    assert.ok(s.eatOut.some((n) => n.day === positionOf(s, o.day) && n.slot === o.slot),
      `the meal out on ${DAYS[o.day]} ${o.slot} did not come along`);
  }
});

test('a correction already written against a day travels with that day', () => {
  const marked = { ...S, adjust: S.adjust.map((a, i) => (i === 0 ? { nick: -200 } : a)) };
  const s = setWeekStart(marked, THU);
  assert.deepEqual(s.adjust[positionOf(s, 0)], { nick: -200 }, "Monday's correction moved");
  assert.equal(s.adjust.length, 7);
  assert.equal(s.adjust.filter((a) => Object.keys(a).length).length, 1, 'the correction was duplicated');
});

test('re-cutting twice is the same as cutting once to the same day', () => {
  const direct = setWeekStart(S, 5);
  const viaThu = setWeekStart(setWeekStart(S, THU), 5);
  assert.deepEqual(viaThu.dayModes, direct.dayModes);
  assert.equal(viaThu.footballDay, direct.footballDay);
  assert.deepEqual(cookSessions(viaThu), cookSessions(direct));
  // And all the way round is a no-op.
  let s = S;
  for (let i = 0; i < 7; i++) s = setWeekStart(s, (s.weekStart + 1) % 7);
  assert.equal(s.weekStart, 0);
  assert.deepEqual(s.dayModes, S.dayModes, 'seven steps round the week changed the modes');
  assert.equal(s.footballDay, S.footballDay);
});

test('setWeekStart refuses a day that is not a day', () => {
  for (const bad of [7, -1, 'Thu', null, undefined, 1.5, NaN]) {
    assert.equal(setWeekStart(S, bad).weekStart, S.weekStart,
      `weekStart ${String(bad)} should have been refused`);
  }
});

// ---------- persistence ----------

test('a stored weekStart survives, and a corrupt one does not', () => {
  assert.equal(migrate({ settings: { weekStart: 4 } }).settings.weekStart, 4);
  for (const bad of [9, -2, 'Fri', null, 2.5]) {
    assert.equal(migrate({ settings: { weekStart: bad } }).settings.weekStart, 0,
      `stored weekStart ${String(bad)} should have been repaired to Monday`);
  }
  assert.equal(migrate({}).settings.weekStart, 0);
});

// ---------- the app ----------

test('choosing a start day re-cuts the week on screen', () => {
  const app = open();
  app.tab('settings');
  app.set('[data-act="weekstart"]', THU);
  assert.equal(app.state().settings.weekStart, THU, 'the choice was not saved');
  app.tab('week');
  const heads = app.$$('.day h2').map((n) => n.textContent.trim().split(/\s+/)[0]);
  assert.deepEqual(heads.slice(0, 3), ['Thu', 'Fri', 'Sat'],
    `the grid still reads ${heads.join(' ')}`);
  assert.deepEqual(app.$$('.day.is-football').length ? ['ok'] : [], ['ok'], 'football day lost its marker');
  const football = app.$$('.day').findIndex((n) => n.classList.contains('is-football'));
  assert.equal(heads[football], 'Fri', `the match ended up on ${heads[football]}`);
  assert.deepEqual(app.errors, []);
});

test('every day picker in settings is labelled by the day it really is', () => {
  // These rows are all keyed by POSITION, so labelling slot 0 "Mon" in a week
  // that starts on Thursday would quietly move the match and the office days.
  const app = open();
  app.tab('settings');
  const names = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'];
  app.set('[data-act="weekstart"]', THU);
  // The cook-up row only exists when the week is cooked in two sessions.
  app.set('[data-act="style"]', 'batch');
  app.tab('settings');

  assert.deepEqual(app.$$('[data-cookday]').map((b) => b.textContent.trim()), names,
    'the cook-up day row still reads in Monday order');
  const opts = (sel) => app.$$(`${sel} option`).map((o) => o.textContent.trim());
  assert.deepEqual(opts('[data-act="football"]'), names, 'the football picker reads in Monday order');
  assert.deepEqual(opts('[data-eatout="0"][data-field="day"]'), names,
    'the meals-out picker reads in Monday order');

  // And the selected option is still the real Friday.
  const picked = app.$('[data-act="football"]').value;
  assert.equal(names[Number(picked)], 'Fri', `football is set to ${names[Number(picked)]}`);
  // The week-start picker itself names real weekdays, so it does NOT rotate.
  assert.deepEqual(opts('[data-act="weekstart"]'), [...DAYS],
    'the week-start picker must keep naming real weekdays');
  assert.deepEqual(app.errors, []);
});
