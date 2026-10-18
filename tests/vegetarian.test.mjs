// The `vegetarian` tag is what the planner filters on, so the tag has to be
// true. This file derives veg-ness a second time, from the ingredient names
// alone, and fails if the two ever disagree.
//
// It deliberately shares no code with `src/`: the app trusts the tag and never
// reads a German product name to decide anything. If this scan and the tags
// drift apart, one of them is a bug and this is where it surfaces.
//
// House definition (agreed 2026-10-18): no meat, no fish, no shellfish, no
// fish-derived sauces. Eggs, dairy, ghee, paneer and Parmigiano all count as
// vegetarian, even where a strict rennet rule would not. That last one is a
// deliberate house call, not an oversight.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, SLOT_ORDER } from '../src/recipes.js';

// Matched as substrings of a lowercased German product name. Compounds are
// spelled out wherever a bare stem would collide with a plant: `hack` alone
// hits "Gehackte Tomaten", and a cauliflower schnitzel is not a schnitzel.
const FLESH = [
  // poultry
  'hähnchen', 'huhn', 'hühner', 'pute', 'puten', 'truthahn', 'ente', 'gans',
  // red meat
  'rind', 'kalb', 'lamm', 'schwein', 'kassler', 'kaninchen', 'wild',
  'hackfleisch', 'rinderhack', 'putenhack', 'lammhack', 'gehacktes',
  // cured and sausage
  'speck', 'bacon', 'pancetta', 'guanciale', 'schinken', 'prosciutto', 'salami',
  'chorizo', 'sucuk', 'pastirma', 'wurst', 'bratwurst', 'frikadelle', 'döner',
  'gyros', 'leber', 'niere', 'schmalz',
  // fish
  'lachs', 'thunfisch', 'fisch', 'kabeljau', 'dorsch', 'barsch', 'zander',
  'forelle', 'makrele', 'hering', 'scholle', 'seehecht', 'pangasius', 'tilapia',
  'sardell', 'anchovis', 'bonito', 'dashi',
  // shellfish
  'garnel', 'shrimp', 'krabben', 'muschel', 'tintenfisch', 'calamari', 'oktopus',
  'jakobsmuschel', 'surimi',
  // animal products that hide inside a bottle
  'fischsauce', 'austernsauce', 'worcester', 'gelatine', 'hühnerbrühe',
  'fleischbrühe', 'rinderbrühe', 'fischfond',
];

// Plants and dairy whose names contain a flesh stem. Checked first, so the
// stem list above can stay short without inventing false positives.
const NOT_FLESH = [
  'gehackte tomaten', 'tomaten gehackt', 'gemüsebrühe', 'wildreis',
];

/** Every ingredient whose name trips the flesh list, with the term that tripped it. */
function fleshHits(recipe) {
  const hits = [];
  for (const i of recipe.ingredients) {
    const name = i.item.toLowerCase();
    if (NOT_FLESH.some((ok) => name.includes(ok))) continue;
    const term = FLESH.find((f) => name.includes(f));
    if (term) hits.push(`${i.item} [${term}]`);
  }
  return hits;
}

const isTagged = (r) => r.tags.includes('vegetarian');

test('nothing tagged vegetarian contains meat, fish or shellfish', () => {
  const wrong = RECIPES.filter(isTagged).map((r) => ({ r, hits: fleshHits(r) }))
    .filter(({ hits }) => hits.length);
  assert.deepEqual(wrong.map(({ r, hits }) => `${r.id}: ${hits.join('; ')}`), [],
    'a recipe claims to be vegetarian and is not');
});

test('every meatless recipe carries the tag, so the filter never skips one', () => {
  // The planner selects *by tag*. An untagged meatless recipe is not wrong on
  // the card, it is simply invisible on a vegetarian day -- which is how the
  // library ended up with 15 meatless breakfasts the filter could not see.
  const untagged = RECIPES.filter((r) => !isTagged(r) && !fleshHits(r).length);
  assert.deepEqual(untagged.map((r) => `${r.slot} ${r.id}`), [],
    'meatless but untagged: add `vegetarian` to its tags');
});

test('every slot has enough vegetarian options to build a whole veggie day', () => {
  // Three vegetarian days a week means the dinner pool has to be deep enough
  // that the week-level no-repeat rule does not run it dry.
  const min = { breakfast: 6, lunch: 8, dinner: 12, snack: 10 };
  for (const slot of SLOT_ORDER) {
    const n = RECIPES.filter((r) => r.slot === slot && isTagged(r)).length;
    assert.ok(n >= min[slot], `only ${n} vegetarian ${slot} recipes, want ${min[slot]}`);
  }
});

test('the vegetarian dinner pool survives the weekday filters', () => {
  // A veggie Tuesday is the case that actually has to work: 30-minute cap,
  // nothing tagged weekend, and still enough left to not repeat across weeks.
  const weekday = RECIPES.filter((r) => r.slot === 'dinner' && isTagged(r)
    && r.minutes <= 30 && !r.tags.includes('weekend') && !r.tags.includes('post-football'));
  assert.ok(weekday.length >= 9,
    `only ${weekday.length} vegetarian dinners a weekday can cook`);
});

test('vegetarian dinners still clear the protein floor', () => {
  // The reason every imported vegetarian dish gained a legume or a cheese.
  for (const r of RECIPES.filter((x) => x.slot === 'dinner' && isTagged(x))) {
    assert.ok(r.protein >= 25, `${r.id}: ${r.protein}g protein on a meatless dinner`);
  }
});
