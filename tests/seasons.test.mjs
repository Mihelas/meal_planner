import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEASON, MONTHS, inSeason, seasonSplit, seasonPenalty, seasonNote, peakThisMonth,
  NO_GERMAN_SEASON,
  currentMonth, isMonth, SEASON_PENALTY, SEASON_BONUS,
} from '../src/seasons.js';
import { RECIPES } from '../src/recipes.js';

// ---------- The table ----------
test('every season entry names real months (1-12) and is non-empty', () => {
  for (const [item, months] of Object.entries(SEASON)) {
    assert.ok(Array.isArray(months) && months.length, `${item}: no months`);
    for (const m of months) assert.ok(isMonth(m), `${item}: bad month ${m}`);
  }
});

test('MONTHS has twelve names and currentMonth indexes into it (months are 1-12)', () => {
  assert.equal(MONTHS.length, 12);
  const m = currentMonth();
  assert.ok(isMonth(m), `currentMonth returned ${m}`);
  assert.ok(MONTHS[m - 1]);
  assert.equal(currentMonth(new Date('2026-05-14T12:00:00Z')), 5);
});

test('German seasons match reality: asparagus in May, not in October', () => {
  assert.equal(inSeason('Kirschtomaten', 8), true);
  assert.equal(inSeason('Kirschtomaten', 1), false);
  assert.equal(inSeason('Grünkohl', 12), true);
  assert.equal(inSeason('Grünkohl', 6), false);
});

test('an ingredient with no German season is never penalised', () => {
  // Rice and chickpeas have no German season; pretending they do would be noise.
  assert.equal(inSeason('Basmatireis', 0), null);
  assert.equal(seasonPenalty({ ingredients: [{ item: 'Basmatireis' }] }, 0), 0);
});

// ---------- Scoring ----------
test('seasonPenalty rewards in-season and penalises out-of-season produce', () => {
  const summer = { ingredients: [{ item: 'Kirschtomaten' }, { item: 'Zucchini' }] };
  assert.ok(seasonPenalty(summer, 8) < 0, 'August tomatoes should be a bonus');
  assert.ok(seasonPenalty(summer, 1) > 0, 'January tomatoes should be a penalty');
});

test('seasonPenalty stays inside its declared bounds, so it can never outweigh calories', () => {
  for (const r of RECIPES) {
    for (let m = 1; m <= 12; m++) {
      const p = seasonPenalty(r, m);
      assert.ok(p <= SEASON_PENALTY + 1e-9, `${r.id} month ${m}: ${p} too high`);
      assert.ok(p >= -SEASON_BONUS - 1e-9, `${r.id} month ${m}: ${p} too low`);
    }
  }
});

test('a null month means seasonality is switched off entirely, not "everything is out of season"', () => {
  const summer = { ingredients: [{ item: 'Kirschtomaten' }] };
  for (const m of [null, undefined, 0, 13, 'May']) {
    assert.equal(seasonPenalty(summer, m), 0, `month ${m} should not score`);
    assert.equal(seasonNote(summer, m), null, `month ${m} should not annotate`);
  }
  assert.deepEqual(peakThisMonth(null), []);
});

// ---------- Notes ----------
test('seasonSplit names which ingredients are in and out of season', () => {
  const r = { ingredients: [{ item: 'Grünkohl' }, { item: 'Zucchini' }, { item: 'Basmatireis' }] };
  const { now, off } = seasonSplit(r, 1);
  assert.deepEqual(now, ['Grünkohl']);
  assert.deepEqual(off, ['Zucchini']);
});

test('seasonNote names the month and the produce, and stays quiet when there is nothing to say', () => {
  const note = String(seasonNote({ ingredients: [{ item: 'Kirschtomaten' }] }, 1));
  assert.match(note, /January/);
  assert.match(note, /Kirschtomaten/);
  assert.equal(seasonNote({ ingredients: [{ item: 'Basmatireis' }] }, 5), null);
});

test('peakThisMonth lists what is best right now, and every month has something', () => {
  for (let m = 1; m <= 12; m++) {
    assert.ok(peakThisMonth(m).length > 0, `${MONTHS[m - 1]} has no produce at all`);
  }
  assert.ok(peakThisMonth(8).includes('Kirschtomaten'));
  assert.ok(!peakThisMonth(1).includes('Kirschtomaten'));
});

// ---------- The table against the library ----------
//
// SEASON is keyed on the exact item string, so a new spelling silently loses its
// seasonality. These two tests make the library and the table argue with each other
// at build time instead of in March, when the app quietly stops nudging.

/** Every produce item the library actually buys. */
const produce = () => {
  const items = new Set();
  for (const r of RECIPES) {
    for (const i of r.ingredients) if (i.aisle === 'produce') items.add(i.item);
  }
  return [...items];
};

test('every produce item is either seasonal or explicitly not', () => {
  const unaccounted = produce().filter((i) => !SEASON[i] && !NO_GERMAN_SEASON.has(i));
  assert.deepEqual(unaccounted, [],
    `add these to SEASON with their German months, or to NO_GERMAN_SEASON with the reason: ${unaccounted.join(', ')}`);
});

test('nothing is in both the season table and the no-season list', () => {
  const both = Object.keys(SEASON).filter((i) => NO_GERMAN_SEASON.has(i));
  assert.deepEqual(both, [], `one answer per item: ${both.join(', ')}`);
});

test('no two produce items are the same vegetable spelled two ways', () => {
  // German plurals are where this goes wrong: Möhre and Möhren in grams are one
  // thing on the shelf and two rows on the shopping list, two pantry ticks and two
  // "already have" boxes. Stemming is crude on purpose -- a false positive here
  // costs one deliberate spelling choice, a false negative costs a split row.
  const stem = (s) => s.toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 's')
    .replace(/[^a-z]/g, '')
    .replace(/(en|n|e)$/, '');
  const byStem = new Map();
  for (const item of produce()) {
    const k = stem(item);
    byStem.set(k, [...(byStem.get(k) ?? []), item]);
  }
  const clashes = [...byStem.values()].filter((v) => v.length > 1).map((v) => v.join(' / '));
  assert.deepEqual(clashes, [], `pick one spelling: ${clashes.join(' ; ')}`);
});

test('the season table has no entry the library never buys', () => {
  // A dead key is a spelling that used to exist, which is the first half of a
  // fragmentation bug: the recipe got renamed and the table kept the old name.
  const bought = new Set();
  for (const r of RECIPES) for (const i of r.ingredients) bought.add(i.item);
  const dead = Object.keys(SEASON).filter((i) => !bought.has(i));
  assert.deepEqual(dead, [], `SEASON keys nothing buys: ${dead.join(', ')}`);
});
