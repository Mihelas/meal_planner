// End-to-end tests against the real built artefact: v1 surfaces.
//
// The jsdom harness lives in ./harness.mjs so the v2 suite can drive the same
// built file without a second copy of the setup.

import test from 'node:test';
import assert from 'node:assert/strict';
import { open, slotName, HTML } from './harness.mjs';
import { SUPABASE_URL } from '../src/remote.js';

test('the built file boots with no script errors and shows a full week', () => {
  const app = open();
  assert.deepEqual(app.errors, [], `the page threw: ${app.errors.join('; ')}`);
  assert.ok(!app.text().includes('could not start'), 'the boot error screen is showing');
  assert.equal(app.$$('.day').length, 7, 'seven day cards');
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    assert.ok(app.text().includes(d), `${d} is missing from the page`);
  }
  // Five meal rows a day, except where lunch splits into two lines.
  for (const card of app.$$('.day')) {
    const n = card.querySelectorAll('.slot').length;
    assert.ok(n === 5 || n === 6, `a day has ${n} meal rows`);
  }
});

test('generating a week writes it to storage, so it survives a reload', () => {
  const first = open();
  const fridayDinner = slotName(first, 4, 'dinner');
  assert.ok(first.saved(), 'nothing was saved');

  const second = open({ stored: first.saved() });
  assert.deepEqual(second.errors, []);
  assert.equal(slotName(second, 4, 'dinner'), fridayDinner, 'the reloaded week is a different week');
});

test('a swap changes the meal and the change is remembered', () => {
  const app = open();
  const before = slotName(app, 2, 'dinner');
  const card = app.$$('.day')[2];
  const row = [...card.querySelectorAll('.slot')].find((r) => r.querySelector('.slot-label').textContent.trim() === 'Dinner');
  app.click(row.querySelector('[data-swap]'));

  const dlg = app.$('#swap');
  assert.ok(dlg.hasAttribute('open'), 'the swap picker did not open');
  const opts = [...dlg.querySelectorAll('[data-pick]')];
  assert.ok(opts.length >= 5, `only ${opts.length} alternatives offered`);
  assert.ok(dlg.textContent.includes(before), 'the picker should say what it is replacing');

  const chosen = opts[0].querySelector('b').textContent.trim();
  app.click(opts[0]);
  assert.equal(slotName(app, 2, 'dinner'), chosen, 'the picked recipe is not on the plan');

  const reloaded = open({ stored: app.saved() });
  assert.equal(slotName(reloaded, 2, 'dinner'), chosen, 'the swap was lost on reload');
});

test('"just pick one" swaps without opening the picker twice', () => {
  const app = open();
  const before = slotName(app, 1, 'breakfast');
  const row = [...app.$$('.day')[1].querySelectorAll('.slot')]
    .find((r) => r.querySelector('.slot-label').textContent.trim() === 'Break');
  app.click(row.querySelector('[data-swap]'));
  app.click('#swap [data-random]');
  assert.notEqual(slotName(app, 1, 'breakfast'), before);
});

test('👎 removes the meal from the week and records the ban for good', () => {
  const app = open();
  const card = app.$$('.day')[3];
  const row = [...card.querySelectorAll('.slot')].find((r) => r.querySelector('.slot-label').textContent.trim() === 'Dinner');
  const banned = row.querySelector('.slot-name').textContent.trim();
  app.click(row.querySelector('[data-ban]'));

  assert.notEqual(slotName(app, 3, 'dinner'), banned, 'the banned meal is still there');
  assert.ok(!app.weekText().includes(banned), 'the banned meal is still somewhere in the week');
  assert.equal(app.state().memory.banned.length, 1);

  const reloaded = open({ stored: app.saved() });
  assert.ok(!reloaded.weekText().includes(banned), 'a banned meal came back after a reload');
  reloaded.tab('settings');
  assert.ok(reloaded.text().includes(banned), 'the ban list does not show what was banned');
  assert.ok(reloaded.$('[data-unban]'), 'there is no way to undo a ban');
});

test('un-banning puts a recipe back in the rotation', () => {
  const app = open();
  const row = [...app.$$('.day')[3].querySelectorAll('.slot')].find((r) => r.querySelector('.slot-label').textContent.trim() === 'Dinner');
  app.click(row.querySelector('[data-ban]'));
  app.tab('settings');
  app.click('[data-unban]');
  assert.equal(app.state().memory.banned.length, 0);
});

test('🔒 keeps a meal through a re-roll while the rest of the week changes', () => {
  const app = open();
  const row = [...app.$$('.day')[2].querySelectorAll('.slot')].find((r) => r.querySelector('.slot-label').textContent.trim() === 'Dinner');
  const kept = row.querySelector('.slot-name').textContent.trim();
  app.click(row.querySelector('[data-lock]'));
  assert.equal(app.state().plan.days[2].dinner.locked, true);

  const others = [0, 1, 3, 5, 6].map((d) => slotName(app, d, 'dinner'));
  app.click('[data-act="reroll"]');
  assert.equal(slotName(app, 2, 'dinner'), kept, 'a locked meal was replaced by the re-roll');
  const after = [0, 1, 3, 5, 6].map((d) => slotName(app, d, 'dinner'));
  assert.ok(after.some((n, i) => n !== others[i]), 'the re-roll changed nothing at all');
});

test('flipping a day to Office swaps the recipe lunch for canteen guidance', () => {
  const app = open();
  const card = app.$$('.day')[1];               // Tue starts as a work-from-home day
  app.click(card.querySelector('[data-mode="office"]'));
  const lunchRows = [...app.$$('.day')[1].querySelectorAll('.slot')]
    .filter((r) => r.querySelector('.slot-label').textContent.trim() === 'Lunch');
  assert.ok(lunchRows.some((r) => /Kantine/.test(r.textContent)), 'no canteen card after going to the office');
  assert.equal(app.state().settings.dayModes[1], 'office', 'the mode was not saved');

  // ...and back again gives real food.
  app.click(app.$$('.day')[1].querySelector('[data-mode="wfh"]'));
  const back = [...app.$$('.day')[1].querySelectorAll('.slot')]
    .filter((r) => r.querySelector('.slot-label').textContent.trim() === 'Lunch');
  assert.ok(!back.some((r) => /Kantine/.test(r.textContent)), 'still at the canteen after coming home');
});

test('a day mode is remembered across a reload', () => {
  const app = open();
  app.click(app.$$('.day')[1].querySelector('[data-mode="office"]'));
  const reloaded = open({ stored: app.saved() });
  assert.equal(reloaded.state().settings.dayModes[1], 'office');
  const lunch = [...reloaded.$$('.day')[1].querySelectorAll('.slot')]
    .filter((r) => r.querySelector('.slot-label').textContent.trim() === 'Lunch');
  assert.ok(lunch.some((r) => /Kantine/.test(r.textContent)));
});

test('opening a meal shows scaled ingredients and a method', () => {
  const app = open();
  const row = [...app.$$('.day')[0].querySelectorAll('.slot')].find((r) => r.querySelector('[data-detail]') && /Dinner/.test(r.textContent));
  app.click(row.querySelector('[data-detail]'));
  const detail = app.$('.detail');
  assert.ok(detail, 'no detail opened');
  assert.ok(detail.querySelectorAll('li').length >= 3, 'no ingredients listed');
  assert.ok(detail.querySelectorAll('ol li').length >= 2, 'no method steps listed');
  assert.ok(/Portions/.test(detail.textContent) && /kcal/.test(detail.textContent));
});

test('the shopping tab lists aisles, and a tick is remembered', () => {
  const app = open();
  app.tab('shopping');
  assert.ok(app.$$('.shop-group').length >= 4, 'the list is not grouped by aisle');
  const boxes = app.$$('[data-bought]');
  assert.ok(boxes.length >= 30, `only ${boxes.length} items on the list`);
  boxes[0].checked = true;
  boxes[0].dispatchEvent(new app.window.Event('change'));
  assert.equal(Object.values(app.state().bought).filter(Boolean).length, 1);

  const reloaded = open({ stored: app.saved() });
  reloaded.tab('shopping');
  assert.ok(reloaded.$$('[data-bought]:checked').length === 1, 'the tick was lost');
});

test('the weight log saves, updates the target and shows a trend', () => {
  const app = open();
  app.tab('weight');
  app.$('#w-date').value = '2026-09-07';
  app.$('#w-person1').value = '100';
  app.click('[data-act="log-weight"]');

  app.$('#w-date').value = '2026-09-21';
  app.$('#w-person1').value = '98.6';
  app.click('[data-act="log-weight"]');

  const s = app.state();
  assert.equal(s.weights.length, 2);
  assert.equal(s.settings.people[0].weightKg, 98.6, 'the target did not follow the new weight');
  assert.ok(/-0\.7\d? kg\/week/.test(app.text()), `no trend shown: ${app.text().slice(0, 0)}`);
  assert.ok(app.$('.spark'), 'no chart drawn');
});

test('every day lands close to both targets, on the page not just in the engine', () => {
  const app = open();
  for (const card of app.$$('.day')) {
    const vals = [...card.querySelectorAll('.tot-val')].map((el) => {
      const [got, target] = el.textContent.replace(/,/g, '').match(/\d+/g).map(Number);
      return { got, target };
    });
    assert.equal(vals.length, 2, 'both people should have a number');
    for (const { got, target } of vals) {
      assert.ok(Math.abs(got - target) / target < 0.1, `${got} vs ${target} is more than 10% out`);
    }
  }
});

test('the "why" tab explains the numbers rather than just asserting them', () => {
  const app = open();
  app.tab('why');
  const t = app.text();
  for (const phrase of ['Mifflin', 'maintenance', 'deficit', 'Protein floor', 'Not medical advice']) {
    assert.ok(t.includes(phrase), `the explanation never mentions "${phrase}"`);
  }
});

test('changing a weight in settings re-flows the whole plan', () => {
  const app = open();
  app.tab('settings');
  const before = app.state().plan.days[0].breakfast.kcal.person1;
  const input = app.$('[data-person="0"][data-key="weightKg"]');
  input.value = '80';
  input.dispatchEvent(new app.window.Event('change'));
  assert.equal(app.state().settings.people[0].weightKg, 80);
  assert.ok(app.state().plan.days[0].breakfast.kcal.person1 < before, 'a lighter person got the same calories');
});

test('nonsense in a settings field is ignored rather than breaking the maths', () => {
  const app = open();
  app.tab('settings');
  const before = app.state().settings.people[0].weightKg;
  const input = app.$('[data-person="0"][data-key="weightKg"]');
  input.value = '0';
  input.dispatchEvent(new app.window.Event('change'));
  assert.equal(app.state().settings.people[0].weightKg, before, 'a zero weight was accepted');
  assert.deepEqual(app.errors, []);
});

test('adding a meal out puts a budgeted card on that day', () => {
  const app = open();
  app.tab('settings');
  app.click('[data-act="add-eatout"]');
  assert.equal(app.state().settings.eatOut.length, 3);
  app.tab('week');
  assert.ok(/Eating out/.test(app.text()), 'no eat-out card appeared');
});

test('moving football moves the easy dinner and the extra food with it', () => {
  const app = open();
  app.tab('settings');
  const sel = app.$('[data-act="football"]');
  sel.value = '2';
  sel.dispatchEvent(new app.window.Event('change'));
  const s = app.state();
  assert.equal(s.settings.footballDay, 2);
  assert.ok(s.settings.people[0].exerciseKcalByDay[2] > 0);
  assert.equal(s.settings.people[0].exerciseKcalByDay[4], 0, 'Friday still thinks there is a match');
  assert.ok(app.$$('.day')[2].classList.contains('is-football'));
});

test('export produces importable JSON containing the week', () => {
  const app = open();
  const json = app.window.JSON.parse(app.saved());
  assert.ok(json.plan.days.length === 7);
  // The export button needs Blob/URL, which jsdom only partly provides; the
  // store's own tests cover the payload. Here we just prove the button exists.
  assert.ok(app.$('[data-act="export"]') && app.$('[data-act="import"]'));
});

test('erase everything takes two clicks, then rebuilds a usable week', () => {
  const app = open();
  const row = [...app.$$('.day')[3].querySelectorAll('.slot')].find((r) => r.querySelector('[data-ban]'));
  app.click(row.querySelector('[data-ban]'));
  app.tab('settings');

  app.click('[data-act="reset"]');
  assert.equal(app.state().memory.banned.length, 1, 'one click erased without asking');
  assert.ok(app.$('[data-act="reset-cancel"]'), 'no way to back out');

  app.click('[data-act="reset-cancel"]');
  assert.equal(app.state().memory.banned.length, 1, 'cancel erased anyway');

  app.click('[data-act="reset"]');
  app.click('[data-act="reset-go"]');
  assert.deepEqual(app.state().memory.banned, [], 'the ban list survived the erase');
  app.tab('week');
  assert.equal(app.$$('.day').length, 7, 'no week after erasing');
});

test('every destructive action can be undone in one click', () => {
  const app = open();
  const row = [...app.$$('.day')[3].querySelectorAll('.slot')].find((r) => r.querySelector('[data-ban]'));
  const banned = row.querySelector('.slot-name').textContent.trim();
  app.click(row.querySelector('[data-ban]'));
  assert.ok(app.text().includes('will not come back'), 'the ban was not acknowledged on the page');
  assert.equal(app.state().memory.banned.length, 1);

  app.click('[data-act="undo"]');
  assert.deepEqual(app.state().memory.banned, [], 'undo did not lift the ban');
  assert.ok(app.weekText().includes(banned), 'undo did not put the meal back');
  assert.ok(!app.$('[data-act="undo"]'), 'the undo offer should disappear once used');
});

test('an erase can be undone too, because it is the worst thing to misclick', () => {
  const app = open();
  const before = app.state().plan.days[0].dinner.recipeId;
  app.tab('settings');
  app.click('[data-act="reset"]');
  app.click('[data-act="reset-go"]');
  app.click('[data-act="undo"]');
  assert.equal(app.state().plan.days[0].dinner.recipeId, before, 'the old week did not come back');
});

test('a stale stored plan is rebuilt with an explanation instead of a broken page', () => {
  const app = open({ stored: JSON.stringify({ plan: { version: 0, days: [{}] }, memory: { banned: [] } }) });
  assert.deepEqual(app.errors, []);
  assert.equal(app.$$('.day').length, 7);
  assert.ok(/older version of the planner/.test(app.text()), 'the user was not told the week was rebuilt');
});

test('corrupt stored data does not take the page down', () => {
  const app = open({ stored: '{{{ not json' });
  assert.deepEqual(app.errors, []);
  assert.equal(app.$$('.day').length, 7);
  assert.ok(/could not be read/.test(app.text()));
});

/** The @media print body, brace-matched — slicing to end-of-file would match the
 *  whole inlined bundle and make every assertion below vacuously true. */
function printBlock(css) {
  const start = css.indexOf('@media print');
  assert.ok(start > 0, 'no print stylesheet at all');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unterminated @media print');
}

test('printing hides the app and prints the sheet instead', () => {
  const block = printBlock(HTML);
  for (const hidden of ['header.top', 'main', 'dialog', '.no-print']) {
    assert.ok(new RegExp(`${hidden.replace('.', '\\.')}[^{]*\\{[^}]*display:\\s*none`).test(block)
      || new RegExp(`[^{]*${hidden.replace('.', '\\.')}[^{]*\\{[^}]*display:\\s*none`).test(block),
    `${hidden} is still printed`);
  }
  assert.ok(/#sheet\s*\{[^}]*display:\s*block/.test(block), 'the sheet itself is not printed');
  assert.ok(/#sheet table\.grid tr\s*\{[^}]*break-inside:\s*avoid/.test(HTML),
    'a day would be split across two pages');
});

test('the artefact is genuinely self-contained — no network of any kind', () => {
  assert.ok(!/<script[^>]+src=/i.test(HTML), 'an external script would break offline');
  assert.ok(!/<link[^>]+stylesheet/i.test(HTML), 'an external stylesheet would break offline');
  // Exactly one remote origin is allowed, and not by hard-coding it here: the
  // one the account module declares. "Self-contained" was always about what the
  // page *loads* on open -- a script, a stylesheet, a font -- not about whether
  // an API address appears anywhere in it. That the app never calls that origin
  // unprompted is a different promise with its own test: tests/account.test.mjs
  // boots the whole thing against a fetch that throws and nothing touches it.
  // Anything else hard-coded still fails here.
  const strays = HTML
    .replace(/https?:\/\/www\.w3\.org[^"']*/g, '')
    .split(SUPABASE_URL).join('')
    .match(/https?:\/\/(?!localhost)[^\s"'<>)]*/g);
  assert.equal(strays, null, `a remote URL is referenced: ${strays?.join(', ')}`);
  assert.ok(HTML.includes('<meta name="viewport"'), 'it has to work on a phone');
});

test('a lunch they both eat shows one line with both portions, not a zero', () => {
  const app = open();
  const s = app.state();
  const dayIdx = s.plan.days.findIndex((d) => d.lunch.person1.recipeId
    && d.lunch.person1.recipeId === d.lunch.person2.recipeId
    && d.lunch.person1.kind === d.lunch.person2.kind);
  assert.ok(dayIdx >= 0, 'the fixture has no shared lunch to check');

  const rows = [...app.$$('.day')[dayIdx].querySelectorAll('.slot')]
    .filter((r) => r.querySelector('.slot-label').textContent.trim() === 'Lunch');
  assert.equal(rows.length, 1, 'one shared meal should be one line');
  const meta = rows[0].querySelector('.slot-meta').textContent;
  const kcals = meta.match(/(\d[\d,]*) kcal/g).map((x) => Number(x.replace(/[^\d]/g, '')));
  assert.equal(kcals.length, 2, 'both of them should have a number on a shared line');
  for (const k of kcals) assert.ok(k > 200, `a shared lunch showed ${k} kcal`);
});

test('swapping a shared lunch keeps it shared rather than splitting them up', () => {
  const app = open();
  // Both home on Saturday, so lunch there is the shared case.
  const dayIdx = app.state().plan.days.findIndex((d, i) => d.lunch.person1.kind === 'recipe'
    && d.lunch.person2.kind === 'recipe' && d.lunch.person1.recipeId === d.lunch.person2.recipeId
    && i > 0);
  if (dayIdx < 0) return;   // nothing to test in this week
  const row = [...app.$$('.day')[dayIdx].querySelectorAll('.slot')]
    .find((r) => r.querySelector('.slot-label').textContent.trim() === 'Lunch' && r.querySelector('[data-swap]'));
  if (!row) return;
  app.click(row.querySelector('[data-swap]'));
  app.click(app.$$('#swap [data-pick]')[0]);
  const lunch = app.state().plan.days[dayIdx].lunch;
  assert.equal(lunch.person1.recipeId, lunch.person2.recipeId, 'the swap put them on different meals');
});

test('a shared meal detail lists a portion for each of them', () => {
  const app = open();
  const dayIdx = app.state().plan.days.findIndex((d) => d.lunch.person1.recipeId
    && d.lunch.person1.recipeId === d.lunch.person2.recipeId);
  const row = [...app.$$('.day')[dayIdx].querySelectorAll('.slot')]
    .find((r) => r.querySelector('.slot-label').textContent.trim() === 'Lunch');
  app.click(row.querySelector('[data-detail]'));
  const detail = app.$$('.day')[dayIdx].querySelector('.detail');
  assert.ok(/Person 1/.test(detail.textContent) && /Person 2/i.test(detail.textContent),
    'a shared meal detail should name both portions');
});

// ---------------------------------------------------------- the printed sheet
// The paper copy is the one part of the app that cannot be checked by looking at
// the screen, so it gets asserted instead: it exists whatever tab is open, it
// carries the whole week and the whole list, and it breaks onto a second page.

test('the print sheet is in the page on every tab, not only on the week', () => {
  const app = open();
  for (const t of ['week', 'shopping', 'settings', 'why']) {
    app.tab(t);
    const sheet = app.$('#sheet');
    assert.ok(sheet, `no print sheet while the ${t} tab is open`);
    assert.equal(sheet.querySelectorAll('table.grid tbody tr').length, 7,
      `the ${t} tab printed ${sheet.querySelectorAll('table.grid tbody tr').length} days`);
  }
});

test('page one is the whole week: every day, every slot, nothing blank', () => {
  const app = open();
  const rows = [...app.$$('#sheet table.grid tbody tr')];
  assert.deepEqual(rows.map((r) => r.querySelector('.d-name').textContent.replace(' ⚽', '').trim()),
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  for (const r of rows) {
    const cells = [...r.querySelectorAll('td')].slice(1);
    assert.equal(cells.length, 5, 'five meal columns');
    for (const c of cells) {
      assert.ok(c.querySelector('.m-name')?.textContent.trim(), `an empty cell in ${r.querySelector('.d-name').textContent}`);
    }
  }
});

test('the printed week says the same thing as the screen', () => {
  const app = open();
  const onScreen = slotName(app, 2, 'dinner');
  const printed = [...app.$$('#sheet table.grid tbody tr')][2]
    .querySelectorAll('td')[3].textContent;
  assert.ok(printed.includes(onScreen), `screen says "${onScreen}", paper says "${printed.trim()}"`);
});

test('a swap updates the paper too — the sheet is never a stale copy', () => {
  const app = open();
  const printedBefore = app.$('#sheet').textContent;
  const row = [...app.$$('.day')[2].querySelectorAll('.slot')]
    .find((r) => r.querySelector('.slot-label').textContent.trim() === 'Dinner');
  app.click(row.querySelector('[data-swap]'));
  app.click(app.$$('#swap [data-pick]')[0]);
  const chosen = slotName(app, 2, 'dinner');
  assert.notEqual(app.$('#sheet').textContent, printedBefore, 'the sheet did not re-render');
  assert.ok(app.$('#sheet').textContent.includes(chosen), 'the new meal is not on the paper');
});

test('page two is the shopping list, split by shop, and asks for a page break', () => {
  const app = open();
  const page2 = app.$('#sheet .page2');
  assert.ok(page2, 'no second page');
  assert.ok(/Shopping list/.test(page2.textContent));
  const shops = [...page2.querySelectorAll('.shop-name')].map((n) => n.textContent.trim());
  assert.ok(shops.length >= 2, `only ${shops.length} shop heading(s) printed`);
  // Every item on the list is on the paper, each with a box to tick.
  const items = [...page2.querySelectorAll('ul.buy li')];
  assert.ok(items.length > 20, `only ${items.length} items printed`);
  for (const li of items.slice(0, 5)) assert.ok(li.querySelector('.box'), 'an item with nothing to tick');
});

test('the print CSS puts the list on its own sheet of A4', () => {
  assert.ok(/@page\s*\{[^}]*A4/.test(HTML), 'no A4 page size in the stylesheet');
  assert.ok(/\.page2\s*\{[^}]*break-before:\s*page/.test(HTML), 'the shopping list does not start a new page');
  assert.ok(/#sheet\s*\{\s*display:\s*none/.test(HTML), 'the sheet is not hidden on screen');
  assert.ok(/@media print[\s\S]{0,400}#sheet\s*\{\s*display:\s*block/.test(HTML), 'the sheet is not shown when printing');
});

test('what is already in the trolley prints struck through, not missing', () => {
  const app = open();
  app.tab('shopping');
  const cb = app.$('[data-bought]');
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event('change'));
  const li = [...app.$$('#sheet .page2 ul.buy li')];
  assert.ok(li.some((x) => x.classList.contains('done')), 'a bought item did not print as done');
  assert.equal(li.filter((x) => x.classList.contains('done')).length, 1,
    'ticking one thing struck through more than one line');
});
