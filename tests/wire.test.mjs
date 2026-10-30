// Every control the app draws has to come back wired.
//
// `render()` rewrites the whole page and then calls `wire()` to re-attach every
// handler, so a button that renders but never gets bound is indistinguishable
// from a button that does nothing -- it is on the page, it looks enabled, and
// tapping it is silence. Nothing else in the suite asserts that directly: the
// other tests each click one known control, so a whole attribute going unwired
// would show up as a scattering of unrelated failures, or as none at all if the
// control happens to be one nothing clicks.
//
// This exists because `wire()` stopped asking the DOM 93 separate questions per
// render (one full-tree `querySelectorAll` per attribute, plus one per `act()`
// name) and started walking the tree once into buckets. That is a pure
// refactor, and this is the assertion that says so: not "this button works" but
// "nothing the app drew was left out".

import test from 'node:test';
import assert from 'node:assert/strict';
import { open, slotRow } from './harness.mjs';

// `data-panel` is markup, not a control -- it labels the account panel for CSS
// and for the tests, and wire() is right not to bind it. Anything else showing
// up unbound is a control the app drew and then forgot about.
const NOT_A_CONTROL = new Set(['data-panel']);

const isBound = (el) => Boolean(el.onclick || el.onchange || el.oninput);

/** Every `data-*` attribute in the rendered tree, and whether all its elements are bound. */
function survey(app) {
  const root = app.window.document.getElementById('app');
  const seen = new Map();
  for (const el of root.getElementsByTagName('*')) {
    for (let i = 0; i < el.attributes.length; i += 1) {
      const { name, value } = el.attributes[i];
      if (!name.startsWith('data-')) continue;
      const key = name === 'data-act' ? `data-act=${value}` : name;
      const rec = seen.get(key) ?? { total: 0, unbound: 0 };
      rec.total += 1;
      if (!isBound(el)) rec.unbound += 1;
      seen.set(key, rec);
    }
  }
  return seen;
}

const unboundIn = (app) => [...survey(app)]
  .filter(([key, rec]) => rec.unbound > 0 && !NOT_A_CONTROL.has(key))
  .map(([key, rec]) => `${key} (${rec.unbound}/${rec.total})`)
  .sort();

// Named rather than counted: a bare "more than N attributes were seen" would
// still pass if the week stopped rendering and the settings panel carried the
// count on its own. These are controls from different panels, so if the survey
// ever goes quiet it fails here rather than passing vacuously.
const MUST_BE_DRAWN = [
  'data-tab', 'data-swap', 'data-ate', 'data-detail', 'data-lock', // the week
  'data-bought', 'data-have', 'data-item-shop', 'data-shop-aisle', // shopping
  'data-mode', 'data-person', 'data-shopday', 'data-draft', // settings
  'data-act=reroll', 'data-act=export', 'data-act=log-weight', 'data-act=save-recipe',
];

test('every control the app draws comes back with a handler attached', () => {
  const app = open({});
  const seen = survey(app);

  for (const key of MUST_BE_DRAWN) {
    assert.ok(seen.has(key), `${key} was never drawn -- the survey is not seeing the app`);
  }
  assert.deepEqual(unboundIn(app), [], 'these controls rendered but were never wired');
  assert.deepEqual(app.errors, []);
});

test('controls that only exist once a card is open are wired too', () => {
  const app = open({});
  // The per-recipe controls -- note, rating, ban, unlog -- are not in the tree
  // until a card is expanded, so the first test cannot see them. They are also
  // the ones most likely to be missed: they arrive on a re-render triggered by
  // a click, which is exactly the path that has to re-wire correctly.
  app.click(slotRow(app, 0, 'dinner').querySelector('[data-detail]'));

  const seen = survey(app);
  for (const key of ['data-note', 'data-rate', 'data-ban']) {
    assert.ok(seen.has(key), `${key} did not appear when the card was opened`);
  }
  assert.deepEqual(unboundIn(app), [], 'these controls rendered but were never wired');
  assert.deepEqual(app.errors, []);
});

test('the swap sheet is wired when it opens', () => {
  const app = open({});
  app.click(slotRow(app, 0, 'dinner').querySelector('[data-swap]'));

  const dlg = app.$('#swap');
  assert.ok(dlg.hasAttribute('open'), 'the swap sheet did not open');
  const picks = [...dlg.querySelectorAll('[data-pick]')];
  assert.ok(picks.length > 0, 'the swap sheet offered nothing to pick');
  for (const b of picks) assert.ok(isBound(b), 'a swap option was drawn but not wired');
  assert.deepEqual(app.errors, []);
});
