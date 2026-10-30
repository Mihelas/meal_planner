// The jsdom harness for the end-to-end tests.
//
// Everything here drives dist/meal-planner.html the way a person does: click the
// button, then read the page. It is deliberately not testing the modules — they
// have their own tests. What it proves is that the bundler produced a file that
// actually boots and that the buttons are wired to the engine.
//
// Not a *.test.mjs file on purpose: the test runner must not treat it as a suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ensureBuilt, root } from './built.mjs';

export { root };

// Test the current source, not whatever was last built by hand.
ensureBuilt();
export const HTML = readFileSync(path.join(root, 'dist', 'meal-planner.html'), 'utf8');

export const STORAGE_KEY = 'mealplanner.v1';

/**
 * Open the built file. `stored` seeds localStorage first, which is how a reload
 * is simulated; `extend` gets the window before the app boots, which is how a
 * browser capability jsdom does not have gets faked.
 */
// Every window opened by a test file, closed when that file is done.
//
// jsdom timers are real node timers: one pending interval in a window nobody closed
// keeps the process alive after the last test, and the suite hangs rather than
// reporting. Closing the windows also stops 25 live DOMs from sitting in memory.
const OPENED = [];
test.after(() => {
  for (const w of OPENED) { try { w.close(); } catch { /* already gone */ } }
  OPENED.length = 0;
});

export function open({ stored = null, extend = null } = {}) {
  const errors = [];
  const dom = new JSDOM(HTML, {
    url: 'http://localhost/meal-planner.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      if (stored) win.localStorage.setItem(STORAGE_KEY, stored);
      win.addEventListener('error', (e) => errors.push(e.error ?? e.message));
      // jsdom has no <dialog> support in this version; the app already falls back
      // to the `open` attribute, but stub these so a missing method is not the failure.
      const proto = win.HTMLDialogElement?.prototype;
      if (proto && !proto.showModal) {
        proto.showModal = function () { this.setAttribute('open', ''); };
        proto.close = function () { this.removeAttribute('open'); };
      }
      win.print = () => {};
      // Hostile on purpose: a browser may suppress page dialogs, and a suppressed
      // confirm() returns false. Nothing in the app may depend on one.
      win.confirm = () => false;
      win.alert = () => {};
      extend?.(win);
    },
  });
  const { window } = dom;
  const $ = (sel) => window.document.querySelector(sel);
  const $$ = (sel) => [...window.document.querySelectorAll(sel)];
  const click = (sel) => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    assert.ok(el, `nothing to click for ${sel}`);
    el.click();
    return el;
  };
  const tab = (name) => click(`[data-tab="${name}"]`);
  // #app, not body: body.textContent would include the inlined <script> source,
  // so every recipe name in the bundle would look like it was on the page.
  const text = () => window.document.getElementById('app').textContent.replace(/\s+/g, ' ');
  // Every tab's panel is in the DOM at once (CSS hides the inactive ones), so an
  // assertion about "the week" has to look at the week grid, not the whole app.
  const weekText = () => [...window.document.querySelectorAll('.week')].map((n) => n.textContent).join(' ').replace(/\s+/g, ' ');
  const saved = () => window.localStorage.getItem(STORAGE_KEY);
  const state = () => JSON.parse(saved());
  /** Set a field and fire the event the app listens for. */
  const set = (sel, value, type = 'change') => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    assert.ok(el, `no field for ${sel}`);
    el.value = String(value);
    el.dispatchEvent(new window.Event(type));
    return el;
  };
  OPENED.push(window);
  return { dom, window, $, $$, click, tab, text, weekText, saved, state, set, errors };
}

const SLOT_LABEL = {
  breakfast: 'Break', lunch: 'Lunch', dinner: 'Dinner',
  snackAfternoon: 'Snack', snackEvening: 'Night',
};

/** Every row for a slot — lunch can be two rows, one per person. */
export function slotRows(app, day, slot) {
  const label = SLOT_LABEL[slot];
  assert.ok(label, `unknown slot ${slot}`);
  const card = app.$$('.day')[day];
  assert.ok(card, `no day card ${day}`);
  return [...card.querySelectorAll('.slot')]
    .filter((r) => r.querySelector('.slot-label')?.textContent.trim() === label);
}

/** The one row for a slot, asserting there is exactly one. */
export function slotRow(app, day, slot) {
  const rows = slotRows(app, day, slot);
  assert.equal(rows.length, 1, `expected one ${slot} row on day ${day}, got ${rows.length}`);
  return rows[0];
}

/** The name shown on a slot, e.g. slotName(app, 0, 'dinner'). */
export function slotName(app, day, slot) {
  return slotRows(app, day, slot)[0]?.querySelector('.slot-name')?.textContent.trim();
}
