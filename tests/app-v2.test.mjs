// End-to-end tests against the real built artefact: the v2 surfaces.
//
// Same rule as the v1 suite — drive the page, then read the page. These cover
// the things a person does when the week does not go to plan: logging what they
// actually ate, rating and annotating meals, the cupboard, splitting the shop,
// their own recipes, batch weeks, seasonality, maintenance and sharing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { open, slotRow, slotRows, slotName } from './harness.mjs';

/** Log an off-plan meal through the dialog, the way the buttons do it. */
function logAte(app, day, slot, { preset = 0, label = null, kcal = null } = {}) {
  app.click(slotRows(app, day, slot)[0].querySelector('[data-ate]'));
  const dlg = app.$('#ate');
  assert.ok(dlg.hasAttribute('open'), 'the log dialog did not open');
  if (label !== null) {
    app.set('#ate-label', label, 'input');
    app.set('#ate-kcal', kcal, 'input');
    app.click(dlg.querySelector('[data-custom]'));
  } else {
    app.click(dlg.querySelectorAll('[data-preset]')[preset]);
  }
}

// --------------------------------------------------------- 2. I ate something else
test('logging what was actually eaten replaces the meal with an honest estimate', () => {
  const app = open();
  const planned = slotName(app, 0, 'dinner');
  logAte(app, 0, 'dinner', { preset: 0 });

  const entry = app.state().plan.days[0].dinner;
  assert.equal(entry.kind, 'off-plan');
  assert.equal(entry.estimated, true);
  assert.equal(entry.recipeId, null);
  const row = slotRow(app, 0, 'dinner');
  assert.ok(/Off plan/.test(row.textContent), `the slot still says "${row.textContent.trim()}"`);
  assert.ok(!row.textContent.includes(planned), 'the planned meal is still showing');
  // The number must never pretend to be a measurement.
  assert.ok(/estimate/.test(row.textContent), 'the slot does not say it is an estimate');
  assert.ok(/≈/.test(row.textContent), 'no approximation sign on the calories');
  assert.deepEqual(app.errors, []);
});

test('a logged meal can be un-logged, and the planned meal comes back unlocked', () => {
  const app = open();
  logAte(app, 0, 'dinner', { preset: 0 });
  assert.equal(app.state().plan.days[0].dinner.locked, true, 'a log should pin the slot');

  app.click(slotRow(app, 0, 'dinner').querySelector('[data-unlog]'));
  const back = app.state().plan.days[0].dinner;
  assert.equal(back.kind, 'recipe');
  assert.ok(back.recipeId, 'no recipe came back');
  // regenerateSlot restores the flags it found, so the lock the log added has to
  // be cleared explicitly — otherwise the slot silently survives every re-roll.
  assert.equal(back.locked, false, 'the slot is still locked after un-logging');
});

test('a custom off-plan entry needs a number, and refuses to log without one', () => {
  const app = open();
  app.click(slotRows(app, 2, 'snackEvening')[0].querySelector('[data-ate]'));
  const dlg = app.$('#ate');
  app.set('#ate-label', 'Half a tub of ice cream', 'input');
  app.click(dlg.querySelector('[data-custom]'));
  assert.equal(app.state().plan.days[2].snackEvening.kind !== 'off-plan', true, 'logged with no calories');

  app.set('#ate-kcal', 450, 'input');
  app.click(dlg.querySelector('[data-custom]'));
  const e = app.state().plan.days[2].snackEvening;
  assert.equal(e.kind, 'off-plan');
  assert.ok(/ice cream/.test(e.note), `the note lost the label: ${e.note}`);
});

test('a logged meal survives a reload and prints as what was eaten', () => {
  const app = open();
  logAte(app, 1, 'dinner', { label: 'Döner on the way home', kcal: 800 });
  const again = open({ stored: app.saved() });
  assert.ok(/Döner on the way home/.test(slotRow(again, 1, 'dinner').textContent));
  const sheet = again.$('#sheet').textContent;
  assert.ok(/Döner on the way home/.test(sheet), 'the paper copy still shows the planned meal');
  assert.ok(/logged, estimated/.test(sheet), 'the paper copy does not say it is an estimate');
});

// ------------------------------------------------------------ 2b. the ledger
test('the week scoreboard only appears once something is off plan', () => {
  const app = open();
  assert.equal(app.$('.ledger'), null, 'an untouched week does not need a scoreboard');
  logAte(app, 0, 'dinner', { label: 'Pizza', kcal: 1600 });
  const led = app.$('.ledger');
  assert.ok(led, 'no scoreboard after going off plan');
  assert.ok(/1 meal off plan/.test(led.textContent), led.textContent.replace(/\s+/g, ' '));
  // kcal alone means nothing; the kg equivalent is the number that lands.
  assert.ok(/kg of the loss/.test(led.textContent), 'the surplus is not translated into kg');
});

test('rebalancing spreads the surplus over the days that are left, and says what it did', () => {
  const app = open();
  logAte(app, 0, 'dinner', { label: 'Pizza', kcal: 1800 });
  app.click('[data-act="rebalance"]');

  const adjust = app.state().settings.adjust;
  assert.deepEqual(adjust[0], {}, 'a day that has already happened was adjusted');
  const touched = adjust.slice(1).filter((a) => Object.keys(a).length > 0);
  assert.ok(touched.length >= 2, `only ${touched.length} later days absorbed anything`);
  for (const a of touched) {
    for (const v of Object.values(a)) {
      assert.ok(v < 0, 'an adjustment added calories instead of taking them off');
      assert.ok(Math.abs(v) <= 250, `one day was cut by ${Math.abs(v)} kcal, past the cap`);
    }
  }
  // The day card has to show the target it is actually cooking to.
  assert.ok(/corrected/.test(app.$$('.day')[1].textContent), 'the day card hides the correction');
  assert.ok(/spread over the days after it/.test(app.$('.ledger').textContent));

  app.click('[data-act="clear-adjust"]');
  assert.deepEqual(app.state().settings.adjust.filter((a) => Object.keys(a).length), []);
});

test('a re-roll clears last week corrections instead of carrying the debt over', () => {
  const app = open();
  logAte(app, 0, 'dinner', { label: 'Pizza', kcal: 1800 });
  app.click('[data-act="rebalance"]');
  assert.ok(app.state().settings.adjust.slice(1).some((a) => Object.keys(a).length));
  app.click('[data-act="reroll"]');
  assert.deepEqual(app.state().settings.adjust.filter((a) => Object.keys(a).length), [],
    'the new week inherited last week penance');
});

// ---------------------------------------------------- 3. learn from what is kept
test('a re-roll records what survived the week, so the planner can lean that way', () => {
  const app = open();
  const before = app.state().memory.stats.kept;
  assert.deepEqual(before, {}, 'nothing should be learned before the first re-roll');
  app.click('[data-act="reroll"]');
  const kept = app.state().memory.stats.kept;
  assert.ok(Object.keys(kept).length >= 5, `only ${Object.keys(kept).length} meals were credited`);
  assert.ok(Object.values(kept).every((n) => n > 0));
});

test('swapping a meal away is remembered as a soft no, and shows up in "why"', () => {
  const app = open();
  const dropped = app.state().plan.days[0].dinner.recipeId;
  app.click(slotRow(app, 0, 'dinner').querySelector('[data-swap]'));
  app.click(app.$('#swap').querySelector('[data-pick]'));

  const away = app.state().memory.stats.away;
  assert.equal(away[dropped], 1, `swap-away was recorded ${away[dropped]} times, not once`);
  app.tab('why');
  assert.ok(/Leaning away from/.test(app.text()));
});

// --------------------------------------------------------- 7. ratings and notes
test('rating a meal is remembered, shown on the slot, and clears on a second press', () => {
  const app = open();
  const row = slotRow(app, 0, 'dinner');
  const id = app.state().plan.days[0].dinner.recipeId;
  app.click(row.querySelector('[data-detail]'));

  const stars = app.$('.stars').querySelectorAll('button');
  assert.equal(stars.length, 5);
  app.click(stars[3]);                                  // four out of five
  assert.equal(app.state().memory.ratings[id], 4);
  assert.ok(/★★★★/.test(slotRow(app, 0, 'dinner').textContent), 'the rating is not shown on the slot');

  app.click(app.$('.stars').querySelectorAll('button')[3]);
  assert.equal(app.state().memory.ratings[id], undefined, 'pressing the same star did not clear it');
});

test('a note on a recipe survives a reload and comes back with the recipe', () => {
  const app = open();
  const id = app.state().plan.days[0].dinner.recipeId;
  app.click(slotRow(app, 0, 'dinner').querySelector('[data-detail]'));
  app.set(`[data-note="${id}"]`, 'Needed twice the chilli.');
  assert.equal(app.state().memory.notes[id], 'Needed twice the chilli.');

  const again = open({ stored: app.saved() });
  const row = slotRow(again, 0, 'dinner');
  assert.ok(row.querySelector('.note-flag'), 'no marker that a note exists');
  again.click(row.querySelector('[data-detail]'));
  assert.ok(/Needed twice the chilli/.test(again.$('.note-shown').textContent));
});

// ---------------------------------------------------------- 6. the cupboard
test('"I have this" takes an item off the list with the amount, not just a flag', () => {
  const app = open();
  app.tab('shopping');
  const before = app.$$('[data-bought]').length;
  const first = app.$('[data-have]');
  const [id, amount] = first.dataset.have.split('|');
  app.click(first);

  assert.equal(app.state().memory.pantry[id], Number(amount),
    'the cupboard stored a flag instead of an amount');
  assert.equal(app.$$('[data-bought]').length, before - 1, 'the item is still on the list');
  assert.ok(/In the cupboard/.test(app.text()));
  assert.ok(app.$$('[data-pantry-del]').length >= 1, 'no way to undo the tick');

  app.click(app.$('[data-pantry-del]'));
  assert.equal(app.state().memory.pantry[id], undefined);
  assert.equal(app.$$('[data-bought]').length, before, 'the item did not come back');
});

test('a cupboard entry the week no longer needs is still removable', () => {
  const app = open();
  app.tab('shopping');
  app.click(app.$('[data-have]'));
  // Force a completely different week: the ticked item is very likely no longer
  // needed, and it must not become invisible-but-permanent.
  for (let i = 0; i < 3; i++) app.click('[data-act="reroll"]');
  assert.equal(Object.keys(app.state().memory.pantry).length, 1);
  assert.ok(app.$$('[data-pantry-del]').length >= 1, 'the tick can no longer be removed');
  app.click(app.$('[data-pantry-del]'));
  assert.deepEqual(app.state().memory.pantry, {});
});

test('emptying the cupboard is one click and can be undone', () => {
  const app = open();
  app.tab('shopping');
  app.click(app.$$('[data-have]')[0]);
  app.click(app.$$('[data-have]')[0]);
  assert.equal(Object.keys(app.state().memory.pantry).length, 2);
  app.click('[data-act="clear-pantry"]');
  assert.deepEqual(app.state().memory.pantry, {});
  app.click('[data-act="undo"]');
  assert.equal(Object.keys(app.state().memory.pantry).length, 2, 'the undo did not restore the cupboard');
});

// ------------------------------------------------------- 9. shopping by shop
test('the list is split by shop, then by aisle', () => {
  const app = open();
  app.tab('shopping');
  const blocks = app.$$('.shop-block');
  assert.equal(blocks.length, 2, `expected two shops, got ${blocks.length}`);
  const names = blocks.map((b) => b.querySelector('h3').textContent.trim());
  assert.deepEqual(names, ['Aldi / Lidl', 'Rewe / Edeka']);
  for (const b of blocks) {
    assert.ok(b.querySelectorAll('.shop-group h4').length >= 1, `${b.querySelector('h3').textContent} has no aisles`);
    assert.ok(b.querySelectorAll('[data-bought]').length >= 3, 'a shop with almost nothing in it');
  }
});

test('moving an aisle to another shop moves its items, and only to one shop', () => {
  const app = open();
  app.tab('shopping');
  const aislesOf = (name) => app.$$('.shop-block')
    .find((b) => b.querySelector('h3').textContent.trim() === name)
    .querySelectorAll('.shop-group h4');
  const produce = [...aislesOf('Rewe / Edeka')].map((h) => h.textContent.trim())[0];

  app.tab('settings');
  app.click(`[data-shop-aisle="0|produce"]`);
  const shops = app.state().settings.shops;
  assert.ok(shops[0].aisles.includes('produce'), 'the aisle did not move');
  assert.ok(!shops[1].aisles.includes('produce'), 'the aisle is now on two shops at once');

  app.tab('shopping');
  assert.ok([...aislesOf('Aldi / Lidl')].some((h) => h.textContent.trim() === produce),
    `${produce} did not follow the aisle to the other shop`);
});

test('one item can be sent to a different shop without moving its whole aisle', () => {
  const app = open();
  app.tab('shopping');
  const superBlock = () => app.$$('.shop-block').find((b) => b.querySelector('h3').textContent.trim() === 'Rewe / Edeka');
  const discountBlock = () => app.$$('.shop-block').find((b) => b.querySelector('h3').textContent.trim() === 'Aldi / Lidl');
  const pick = superBlock().querySelector('[data-item-shop]');
  const id = pick.dataset.itemShop;
  const name = pick.closest('.shop-item').querySelector('label').textContent.trim();

  app.set(pick, 'discount');
  assert.equal(app.state().itemShop[id], 'discount');
  assert.ok([...discountBlock().querySelectorAll('.shop-item label')].some((l) => l.textContent.trim() === name),
    `${name} did not move shop`);
  assert.ok(![...superBlock().querySelectorAll('.shop-item label')].some((l) => l.textContent.trim() === name),
    `${name} is on both lists`);
});

test('a removed shop takes its per-item overrides with it', () => {
  const app = open();
  app.tab('shopping');
  app.set(app.$('[data-item-shop]'), 'discount');
  assert.equal(Object.keys(app.state().itemShop).length, 1);
  app.tab('settings');
  app.click('[data-del-shop="0"]');
  assert.equal(app.state().settings.shops.length, 1);
  assert.deepEqual(app.state().itemShop, {}, 'an override now points at a shop that does not exist');
  // The last shop cannot be removed, or nothing would have a list at all.
  assert.equal(app.$('[data-del-shop]'), null, 'the last shop can still be removed');
});

test('an aisle no shop covers is still bought somewhere, and the page says where', () => {
  const app = open();
  app.tab('settings');
  app.click('[data-shop-aisle="1|produce"]');          // take produce off its only shop
  assert.ok(/No shop covers/.test(app.text()), 'nothing warned that an aisle is homeless');
  app.tab('shopping');
  const first = app.$$('.shop-block')[0];
  assert.ok(first.querySelectorAll('[data-bought]').length >= 3);
  assert.ok(app.$$('[data-bought]').length >= 30, 'items vanished with their aisle');
});

// ------------------------------------------------------- 8. your own recipes
test('your own recipe joins the library and can be chosen in a swap', () => {
  const app = open();
  const kcal = app.state().plan.days[0].dinner.kcal[app.state().settings.people[0].id];
  app.tab('recipes');
  app.set('[data-draft="name"]', 'Ofen-Feta mit Tomaten');
  app.set('[data-draft="slot"]', 'dinner');
  app.set('[data-draft="minutes"]', '25');
  app.set('[data-draft="kcal"]', String(kcal));
  app.set('[data-draft="protein"]', '38');
  app.set('[data-draft="ingredients"]', 'Feta | 200 | g | dairy\nKirschtomaten | 400 | g | produce\nOlivenöl | 20 | ml | pantry');
  app.set('[data-draft="method"]', 'Heat the oven to 200 °C.\nRoast for 20 minutes.');
  app.click('[data-act="save-recipe"]');

  const mine = app.state().memory.custom;
  assert.equal(mine.length, 1, 'the recipe was not saved');
  assert.equal(mine[0].ingredients.length, 3, 'an ingredient line was dropped');
  assert.ok(mine[0].tags.includes('custom'));
  assert.ok(/Ofen-Feta mit Tomaten/.test(app.text()), 'it is not listed under "Mine"');
  assert.equal(app.$('[data-draft="name"]').value, '', 'the form was not cleared after saving');

  // The real test: the engine offers it.
  app.click(slotRow(app, 0, 'dinner').querySelector('[data-swap]'));
  const opts = [...app.$('#swap').querySelectorAll('[data-pick]')];
  const found = opts.find((o) => /Ofen-Feta mit Tomaten/.test(o.textContent));
  assert.ok(found, 'your own recipe is not offered as a swap');
  assert.ok(/yours/.test(found.textContent), 'nothing marks it as yours');

  app.click(found);
  assert.equal(slotName(app, 0, 'dinner'), 'Ofen-Feta mit Tomaten');
  app.tab('shopping');
  assert.ok(/Kirschtomaten/.test(app.text()), 'its ingredients never reached the shopping list');
});

test('a recipe survives a reload, and removing it takes it out of the library', () => {
  const app = open();
  app.tab('recipes');
  app.set('[data-draft="name"]', 'Linsensuppe');
  app.set('[data-draft="kcal"]', '520');
  app.set('[data-draft="protein"]', '30');
  app.set('[data-draft="minutes"]', '28');
  app.set('[data-draft="ingredients"]', 'Rote Linsen | 120 | g | dry-goods');
  app.click('[data-act="save-recipe"]');

  const again = open({ stored: app.saved() });
  again.tab('recipes');
  assert.ok(/Linsensuppe/.test(again.text()), 'the recipe did not survive a reload');
  again.click(again.$('[data-del-recipe]'));
  assert.deepEqual(again.state().memory.custom, []);
  again.click('[data-act="undo"]');
  assert.equal(again.state().memory.custom.length, 1, 'removing a recipe cannot be undone');
});

test('a bad recipe form explains what is wrong instead of failing quietly', () => {
  const app = open();
  app.tab('recipes');
  app.click('[data-act="save-recipe"]');
  const errs = app.$$('.notice.bad').map((n) => n.textContent).join(' ');
  assert.ok(/Give it a name/.test(errs), errs);
  assert.ok(/at least one ingredient/.test(errs), errs);
  assert.deepEqual(app.state().memory.custom, []);

  // A broken ingredient line is named by its line number, not silently dropped.
  app.set('[data-draft="name"]', 'Something');
  app.set('[data-draft="kcal"]', '400');
  app.set('[data-draft="protein"]', '20');
  app.set('[data-draft="ingredients"]', 'Feta | lots | g');
  app.click('[data-act="save-recipe"]');
  const errs2 = app.$$('.notice.bad').map((n) => n.textContent).join(' ');
  assert.ok(/1/.test(errs2) && /Feta|amount|number/i.test(errs2), errs2);
  assert.deepEqual(app.state().memory.custom, [], 'saved a recipe with a broken ingredient line');
});

// ------------------------------------------------- 8b. importing a batch of recipes

/** The paste format, as a person would type it. */
const PASTE = (over = {}) => [
  `Name: ${over.name ?? 'Ofen-Feta mit Tomaten'}`,
  `Meal: ${over.slot ?? 'dinner'}`,
  `Cuisine: ${over.cuisine ?? 'mediterranean'}`,
  `Minutes: ${over.minutes ?? 25}`,
  `Kcal: ${over.kcal ?? 640}`,
  `Protein: ${over.protein ?? 32}`,
  'Ingredients:',
  over.ingredients ?? 'Feta | 200 | g | dairy\nKirschtomaten | 400 | g | produce',
  'Method:',
  over.method ?? 'Heat the oven to 200 C.\nRoast everything for 20 minutes.',
].join('\n');

/** What the import card is saying — scoped, so another panel's notice cannot answer for it. */
const says = (app, kind = '') => app.$$(`#import .notice${kind}`).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ');

test('a pasted batch lands in the library and the page says how many', () => {
  const app = open();
  app.tab('recipes');
  app.set('[data-import]', [
    PASTE(),
    PASTE({ name: 'Skyr mit Beeren', slot: 'breakfast', kcal: 380, protein: 30, minutes: 5, ingredients: 'Skyr | 300 | g | dairy', method: 'Umrühren.' }),
    PASTE({ name: 'Harzer auf Roggen', slot: 'snack', kcal: 220, protein: 24, minutes: 3, ingredients: 'Harzer Käse | 60 | g | dairy', method: 'Belegen.' }),
  ].join('\n---\n'), 'input');
  app.click('[data-act="import-recipes"]');

  const mine = app.state().memory.custom;
  assert.equal(mine.length, 3, 'the batch did not arrive');
  assert.deepEqual(mine.map((r) => r.slot), ['dinner', 'breakfast', 'snack']);
  assert.ok(/3 recipes/.test(says(app, '.good')), `the card never said how many landed: ${says(app)}`);
  for (const n of ['Ofen-Feta mit Tomaten', 'Skyr mit Beeren', 'Harzer auf Roggen']) {
    assert.ok(app.text().includes(n), `${n} is not listed under "Mine"`);
  }
  assert.equal(app.$('[data-import]').value, '', 'the paste box was not cleared after a clean import');

  // The point of importing: they are usable immediately.
  app.click(slotRow(app, 0, 'dinner').querySelector('[data-swap]'));
  const opts = [...app.$('#swap').querySelectorAll('[data-pick]')];
  assert.ok(opts.some((o) => /Ofen-Feta mit Tomaten/.test(o.textContent)), 'an imported recipe is not offered as a swap');
});

test('one bad recipe in a paste is named and the rest still import', () => {
  const app = open();
  app.tab('recipes');
  app.set('[data-import]', [
    PASTE(),
    PASTE({ name: 'Zu viel Huhn', ingredients: 'Hähnchenbrust | 5000 | g | meat-fish' }),
  ].join('\n---\n'), 'input');
  app.click('[data-act="import-recipes"]');

  assert.equal(app.state().memory.custom.length, 1, 'the good one must still arrive');
  const bad = says(app, '.bad');
  assert.ok(/Zu viel Huhn/.test(bad), bad);
  assert.ok(/line \d+/i.test(bad), `the error must locate itself in the paste: ${bad}`);
  assert.ok(/1 recipe/.test(says(app, '.good')), 'the card should still say what did land');
  // The paste stays put when something failed: it is the only copy of the text.
  assert.ok(app.$('[data-import]').value.includes('Zu viel Huhn'), 'the paste was thrown away with its errors');
});

test('an exported file pastes back in as recipes', () => {
  const app = open();
  app.tab('recipes');
  app.set('[data-draft="name"]', 'Geteiltes Rezept');
  app.set('[data-draft="kcal"]', '540');
  app.set('[data-draft="protein"]', '36');
  app.set('[data-draft="minutes"]', '20');
  app.set('[data-draft="ingredients"]', 'Rote Linsen | 120 | g | dry-goods');
  app.click('[data-act="save-recipe"]');
  const exported = app.saved();

  // Her browser, his recipe: the export file is the transport until sync lands.
  const hers = open();
  hers.tab('recipes');
  hers.set('[data-import]', exported, 'input');
  hers.click('[data-act="import-recipes"]');
  const mine = hers.state().memory.custom;
  assert.equal(mine.length, 1, `the exported recipe did not import: ${says(hers)}`);
  assert.equal(mine[0].name, 'Geteiltes Rezept');
  assert.equal(says(hers, '.bad'), '', 'a clean import complained about something');
});

test('an empty or unreadable paste says so instead of doing nothing', () => {
  const app = open();
  app.tab('recipes');
  app.click('[data-act="import-recipes"]');
  assert.ok(/Nothing pasted/i.test(says(app, '.bad')), says(app));

  app.set('[data-import]', 'some notes I pasted by accident', 'input');
  app.click('[data-act="import-recipes"]');
  assert.ok(/looked like a recipe/i.test(says(app, '.bad')), says(app));
  assert.deepEqual(app.state().memory.custom, []);
});

// ---------------------------------------------------------- 5. batch weeks
test('a batch week cooks twice and reheats the rest, and names the cook-up days', () => {
  const app = open();
  app.set('[data-act="style"]', 'batch');
  assert.equal(app.state().settings.cookingStyle, 'batch');
  const kinds = app.state().plan.days.map((d) => d.dinner.kind);
  assert.ok(kinds.filter((k) => k === 'batch').length >= 3, `only ${kinds.filter((k) => k === 'batch').length} reheated dinners`);
  assert.ok(/reheat \w+'s batch/.test(app.weekText()), 'the week does not say which nights are reheats');
  app.tab('prep');
  assert.ok(/you cook on/.test(app.text()), 'the prep tab does not say when to cook');
  assert.ok(/Mon/.test(app.text()) && /Thu/.test(app.text()));
});

test('the cook-up days can be moved, but never emptied', () => {
  const app = open();
  app.set('[data-act="style"]', 'batch');
  app.click('[data-cookday="5"]');
  assert.deepEqual(app.state().settings.cookDays, [0, 3, 5]);
  app.click('[data-cookday="0"]');
  app.click('[data-cookday="3"]');
  assert.deepEqual(app.state().settings.cookDays, [5]);
  app.click('[data-cookday="5"]');
  assert.deepEqual(app.state().settings.cookDays, [5], 'the last cook-up day was removed, leaving no food');
});

test('going back to cooking fresh puts real dinners back', () => {
  const app = open();
  app.set('[data-act="style"]', 'batch');
  app.set('[data-act="style"]', 'daily');
  const kinds = app.state().plan.days.map((d) => d.dinner.kind);
  assert.equal(kinds.filter((k) => k === 'batch').length, 0, 'still reheating after going back to daily');
  // A loose /reheat/ would match a recipe actually named "... (reheat only)".
  assert.ok(!/reheat \w+'s batch/.test(app.weekText()), 'a reheat marker survived the switch');
});

// --------------------------------------------------------- 10. seasonality
test('an out-of-season ingredient is flagged on the meal, not hidden', () => {
  const app = open();
  app.tab('settings');
  app.set('[data-act="month"]', '1');                   // January
  assert.equal(app.state().settings.month, 1);

  // Pick a candidate the app itself says is out of season, then open it: this is
  // deterministic where "re-roll until something is out of season" would not be.
  app.tab('week');
  app.click(slotRow(app, 0, 'dinner').querySelector('[data-swap]'));
  const opts = [...app.$('#swap').querySelectorAll('[data-pick]')];
  const off = opts.find((o) => /out of season/.test(o.textContent));
  assert.ok(off, 'not one of fourteen January dinners was flagged out of season');
  app.click(off);

  app.click(slotRow(app, 0, 'dinner').querySelector('[data-detail]'));
  const note = app.$('.season-note');
  assert.ok(note, 'the meal detail says nothing about the season');
  assert.ok(/Out of season in January/.test(note.textContent), note.textContent);
  assert.ok(/imported, dearer/.test(note.textContent), 'it warns without saying why it matters');
});

test('the month can be pinned for planning ahead, and "why" says which one', () => {
  const app = open();
  app.tab('settings');
  app.set('[data-act="month"]', '7');
  app.tab('why');
  assert.ok(/Scoring for July/.test(app.text()));
  assert.ok(/Kirschtomaten/.test(app.text()), 'July peak produce is missing');
  app.tab('settings');
  app.set('[data-act="month"]', '');
  assert.equal(app.state().settings.month, null, 'the month did not go back to the calendar');
});

test('seasonality can be turned off, and then nothing is flagged anywhere', () => {
  const app = open();
  app.tab('settings');
  app.set('[data-act="month"]', '1');
  app.set('[data-act="season"]', 'off');
  assert.equal(app.state().settings.useSeason, false);
  app.tab('week');
  for (const row of app.$$('[data-detail]')) row.click();
  assert.equal(app.$('.season-note'), null, 'still flagging seasons after being told not to');
  app.tab('why');
  assert.ok(/Turned off in Settings/.test(app.text()));
});

// -------------------------------------------------------- 14. maintenance
test('reaching the goal weight offers maintenance rather than switching silently', () => {
  const app = open();
  app.tab('settings');
  assert.equal(app.$('[data-maintain]'), null, 'offering maintenance 12 kg early');
  app.set('[data-person="0"][data-key="weightKg"]', '89');
  assert.ok(app.$('[data-maintain="0"]'), 'nothing offered at the goal weight');

  const before = app.state().settings.people[0].goal;
  assert.equal(before, 'lose', 'the goal changed without being asked');
  app.click('[data-maintain="0"]');
  assert.equal(app.state().settings.people[0].goal, 'maintain');
});

test('maintenance removes the deficit, keeps the protein floor and says so', () => {
  const app = open();
  app.tab('settings');
  app.set('[data-person="0"][data-key="goal"]', 'maintain');
  const [him] = app.state().settings.people;
  assert.equal(him.goal, 'maintain');

  app.tab('why');
  const why = app.text();
  assert.ok(/on maintenance/.test(why), 'the explanation does not mention maintenance');
  assert.ok(/0\.00 kg\/week/.test(why), 'still predicting a loss while maintaining');
  // The plan has to actually feed more, not just relabel the goal.
  assert.ok(app.state().plan.days.some((d) => d.dinner.kcal[him.id] > 0));
  app.tab('settings');
  assert.ok(/maintenance/.test(app.$('[data-person="0"][data-key="goal"]').closest('fieldset').textContent));
});

test('a goal weight is editable and nonsense in the field is ignored', () => {
  const app = open();
  app.tab('settings');
  app.set('[data-person="1"][data-key="goalWeightKg"]', '60');
  assert.equal(app.state().settings.people[1].goalWeightKg, 60);
  app.set('[data-person="1"][data-key="goalWeightKg"]', 'abc');
  assert.equal(app.state().settings.people[1].goalWeightKg, 60, 'nonsense was saved');
});

// ------------------------------------------------------------- 1. sharing
test('where a browser cannot link a file, sharing names the fallback instead of failing', () => {
  const app = open();                                   // jsdom has no File System Access API
  app.tab('settings');
  const panel = app.$$('.card').find((c) => /Share with/.test(c.textContent));
  assert.ok(panel, 'no sharing panel at all');
  const t = panel.textContent.replace(/\s+/g, ' ');
  assert.ok(/Chrome and Edge/.test(t), t);
  assert.ok(/Export JSON/.test(t) && /Import JSON/.test(t), 'the fallback is not named');
  assert.equal(app.$('[data-act="sync-new"]'), null, 'offering a file picker that does not exist');
  assert.deepEqual(app.errors, [], `sharing threw on an unsupporting browser: ${app.errors.join('; ')}`);
});

test('an unsupported browser never claims the week is shared', () => {
  const app = open();
  app.tab('settings');
  const panel = app.$$('.card').find((c) => /Share with/.test(c.textContent));
  assert.ok(!/Last saved|linked/i.test(panel.textContent), panel.textContent.replace(/\s+/g, ' '));
  assert.equal(panel.querySelector('.notice.good'), null, 'a green light with nothing behind it');
});

// -------------------------------------------------------------- regressions
test('every new surface renders on a fresh boot without throwing', () => {
  const app = open();
  for (const [id] of [['week'], ['shopping'], ['prep'], ['recipes'], ['weight'], ['why'], ['settings']]) {
    app.tab(id);
    assert.ok(app.$(`.panel.active`), `no panel for ${id}`);
  }
  assert.deepEqual(app.errors, [], app.errors.join('; '));
});

test('the whole v2 state round-trips through export and import', () => {
  const app = open();
  // Big enough that no dinner in the library can silence it. 1200 used to work,
  // then the library grew, day 0 drew a 735 kcal souvlaki, and the surplus fell
  // inside the rebalance dead-band -- so there were no corrections left to
  // round-trip. The assertion below is about export/import, not about the
  // dead-band, so the input has to clear it by a margin.
  logAte(app, 0, 'dinner', { label: 'Pizza', kcal: 1800 });
  app.click('[data-act="rebalance"]');
  app.tab('shopping');
  app.click(app.$('[data-have]'));
  app.tab('recipes');
  app.set('[data-draft="name"]', 'Testgericht');
  app.set('[data-draft="kcal"]', '500');
  app.set('[data-draft="protein"]', '25');
  app.set('[data-draft="minutes"]', '20');
  app.set('[data-draft="ingredients"]', 'Reis | 100 | g | dry-goods');
  app.click('[data-act="save-recipe"]');

  const json = app.window.JSON.parse(app.saved());
  const again = open({ stored: JSON.stringify(json) });
  assert.equal(again.state().plan.days[0].dinner.kind, 'off-plan');
  assert.ok(again.state().settings.adjust.slice(1).some((a) => Object.keys(a).length));
  assert.equal(Object.keys(again.state().memory.pantry).length, 1);
  assert.equal(again.state().memory.custom.length, 1);
  assert.deepEqual(again.errors, []);
});

// ------------------------------------------- 1. sharing, on a browser that can
/**
 * A stand-in for one file on disk, plus the two pickers that hand it over.
 *
 * jsdom has no File System Access API, so the only way to test the panel's real
 * path is to supply one. The sync module's own tests cover the merge rules; what
 * these prove is that the buttons in Settings are wired to them.
 */
function fakeDisk({ content = null } = {}) {
  const disk = { content, writes: 0, picked: 0 };
  const handle = {
    name: 'meal-planner-shared.json',
    kind: 'file',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFile: async () => ({ text: async () => disk.content ?? '' }),
    createWritable: async () => ({
      write: async (d) => { disk.content = String(d); disk.writes += 1; },
      close: async () => {},
    }),
  };
  disk.install = (win) => {
    win.showSaveFilePicker = async () => { disk.picked += 1; return handle; };
    win.showOpenFilePicker = async () => { disk.picked += 1; return [handle]; };
  };
  return disk;
}

/** Let the promise chain inside link()/pull()/push() finish. */
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

test('creating the shared file writes the week and reports it plainly', async () => {
  const disk = fakeDisk();
  const app = open({ extend: disk.install });
  app.tab('settings');
  assert.ok(app.$('[data-act="sync-new"]'), 'no way to create the file on a browser that can');

  app.click('[data-act="sync-new"]');
  await settle();
  assert.equal(disk.picked, 1, 'the file picker was never opened');
  assert.ok(disk.writes >= 1, 'nothing was written to the file');
  const onDisk = JSON.parse(disk.content);
  assert.ok(onDisk.plan?.days?.length === 7, 'the week did not reach the file');

  app.tab('settings');
  const panel = app.$$('.card').find((c) => /Share with/.test(c.textContent));
  assert.ok(panel.querySelector('.notice.good'), 'linked, but the page does not say so');
  assert.ok(/meal-planner-shared\.json/.test(panel.textContent), panel.textContent.replace(/\s+/g, ' '));
  assert.ok(app.$('[data-act="sync-unlink"]'), 'no way to unlink again');
  assert.deepEqual(app.errors, []);
});

test('opening the other side file merges their bans and recipes instead of overwriting', async () => {
  // Build a realistic "other device" file by exporting from a second instance.
  const theirs = open();
  theirs.tab('recipes');
  theirs.set('[data-draft="name"]', 'Ihr Auflauf');
  theirs.set('[data-draft="kcal"]', '600');
  theirs.set('[data-draft="protein"]', '35');
  theirs.set('[data-draft="minutes"]', '28');
  theirs.set('[data-draft="ingredients"]', 'Kartoffeln | 400 | g | produce');
  theirs.click('[data-act="save-recipe"]');
  theirs.click(theirs.$('[data-ban]'));

  const disk = fakeDisk({ content: theirs.saved() });
  const app = open({ extend: disk.install });
  app.tab('recipes');
  app.set('[data-draft="name"]', 'Mein Auflauf');
  app.set('[data-draft="kcal"]', '600');
  app.set('[data-draft="protein"]', '35');
  app.set('[data-draft="minutes"]', '28');
  app.set('[data-draft="ingredients"]', 'Reis | 100 | g | dry-goods');
  app.click('[data-act="save-recipe"]');

  app.tab('settings');
  app.click('[data-act="sync-open"]');
  await settle();

  const names = app.state().memory.custom.map((r) => r.name).sort();
  assert.deepEqual(names, ['Ihr Auflauf', 'Mein Auflauf'], 'a recipe was lost in the merge');
  assert.ok(app.state().memory.banned.length >= 1, 'their ban did not arrive');
  const onDisk = JSON.parse(disk.content);
  assert.equal(onDisk.memory.custom.length, 2, 'the merged result was not written back');
  assert.deepEqual(app.errors, []);
});

test('a shared file that cannot be read is never written over', async () => {
  const disk = fakeDisk({ content: '{ this is not json' });
  const app = open({ extend: disk.install });
  app.tab('settings');
  app.click('[data-act="sync-open"]');
  await settle();

  assert.equal(disk.writes, 0, 'an unreadable file was overwritten');
  assert.equal(disk.content, '{ this is not json', 'the other week was destroyed to clear an error');
  // And it has to say so, on every tab, because the other person is not syncing.
  assert.ok(app.$('.notice.bad'), 'nothing warned that sharing is broken');
  app.tab('week');
  assert.ok(/left alone rather than overwritten/i.test(app.$('.notice.bad').textContent),
    app.$('.notice.bad').textContent);
  assert.ok(/Settings/.test(app.$('.notice.bad').textContent), 'it warns without saying where to fix it');
});

test('unlinking stops the writing and says the week is local again', async () => {
  const disk = fakeDisk();
  const app = open({ extend: disk.install });
  app.tab('settings');
  app.click('[data-act="sync-new"]');
  await settle();
  const before = disk.writes;

  app.click('[data-act="sync-unlink"]');
  await settle();
  app.click('[data-act="reroll"]');
  await settle();
  assert.equal(disk.writes, before, 'still writing to a file that was unlinked');
  app.tab('settings');
  const panel = app.$$('.card').find((c) => /Share with/.test(c.textContent));
  assert.equal(panel.querySelector('.notice.good'), null, 'still showing as shared after unlinking');
  assert.ok(app.$('[data-act="sync-new"]'), 'no way to link again');
});

// A removal has to be recorded where the merge can see it, and the shopping tick is
// the one people do dozens of times a week. Before v4 the merge unioned the ticks, so
// un-ticking the milk on his phone was silently re-ticked from her copy on the next
// sync and the item dropped off the list he was standing in the shop holding.
test('un-ticking a shopping item records the un-tick, so the other device cannot re-tick it', () => {
  const app = open();
  app.tab('shopping');
  const cb = app.$('[data-bought]');
  const id = cb.dataset.bought;

  cb.checked = true;
  cb.dispatchEvent(new app.window.Event('change'));
  assert.equal(app.state().bought[id], true);
  assert.equal(app.state().memory.removed.bought[id], undefined, 'ticking should not record a removal');

  const back = app.$(`[data-bought="${id}"]`);
  back.checked = false;
  back.dispatchEvent(new app.window.Event('change'));
  assert.equal(app.state().bought[id], undefined, 'the tick did not come off');
  assert.ok(app.state().memory.removed.bought[id] > 0,
    'nothing recorded the un-tick, so the other device will re-tick it');

  // And re-ticking withdraws the note, or the other device would un-tick it for you.
  const third = app.$(`[data-bought="${id}"]`);
  third.checked = true;
  third.dispatchEvent(new app.window.Event('change'));
  assert.equal(app.state().memory.removed.bought[id], undefined, 'the stale un-tick note survived');
  assert.deepEqual(app.errors, []);
});

test('the shared file is read again when the tab comes back, not only when it is written', async () => {
  // Nothing re-read the file after boot, so a tab left open all afternoon pushed its
  // increasingly stale week over the top of hers every time anything was touched.
  const theirs = open();
  theirs.click(theirs.$('[data-ban]'));
  const theirBan = theirs.state().memory.banned[0];
  assert.ok(theirBan, 'the other device did not ban anything to notice');

  const disk = fakeDisk();
  const app = open({ extend: disk.install });
  app.tab('settings');
  app.click('[data-act="sync-new"]');
  await settle();
  assert.ok(!app.state().memory.banned.includes(theirBan), 'the ban is here before it could arrive');

  // She saves from her device while this tab sits there doing nothing.
  disk.content = theirs.saved();
  app.window.dispatchEvent(new app.window.Event('focus'));
  await settle();

  assert.ok(app.state().memory.banned.includes(theirBan),
    'coming back to the tab did not pick up the other device');
  assert.deepEqual(app.errors, []);
});

test('a week replaced by the other device says so, once, and can be dismissed', async () => {
  const theirs = open();
  theirs.click('[data-act="reroll"]');          // a genuinely different week
  const theirPlanId = theirs.state().plan.id;

  const disk = fakeDisk();
  const app = open({ extend: disk.install });
  app.tab('settings');
  app.click('[data-act="sync-new"]');
  await settle();
  assert.notEqual(app.state().plan.id, theirPlanId, 'the two weeks are not actually different');

  disk.content = theirs.saved();
  app.window.dispatchEvent(new app.window.Event('focus'));
  await settle();

  assert.ok(app.state().mergeNote, 'two different weeks were reconciled in silence');
  app.tab('week');
  const notice = app.$$('.notice').find((n) => /different week/.test(n.textContent));
  assert.ok(notice, app.text().slice(0, 300));
  assert.ok(/kept|replaced/.test(notice.textContent), notice.textContent);

  // One-shot by nature: it explains something that already happened, so it has to go
  // away when read rather than sit on every tab for the rest of the month.
  app.click(notice.querySelector('[data-dismiss]'));
  assert.equal(app.state().mergeNote, null, 'the note could not be dismissed');
  assert.equal(app.$$('.notice').find((n) => /different week/.test(n.textContent)), undefined);
  assert.deepEqual(app.errors, []);
});
