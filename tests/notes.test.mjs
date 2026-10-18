// Notes on a recipe: the field has to survive being clicked.
//
// The bug this pins down: `data-note` was doing two unrelated jobs -- the note
// textarea on a recipe card, and the "Got it" button that dismisses a one-shot
// banner. Both were bound by `querySelectorAll('[data-note]')`, so clicking into
// the textarea ran the *dismiss* handler, which commits and re-renders, and the
// field you had just focused was replaced mid-click. Typing only worked if you
// held the mouse button down -- a `click` fires on mouseup, so holding it bought
// you the keystrokes before the re-render landed.
//
// It also wrote a junk top-level key named after the recipe (`state['d-x'] = null`),
// which was then saved and synced.

import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, emptyState } from '../src/store.js';
import { open, slotRow } from './harness.mjs';

// Everything the app is allowed to put at the top level of a save.
// `savedAt` is stamped by store.save, not by emptyState; the two notes are
// one-shot explanations the UI clears once they have been read.
const ALLOWED = new Set([...Object.keys(emptyState()), 'savedAt', 'migrationNote', 'mergeNote']);

const strayKeys = (state) => Object.keys(state).filter((k) => !ALLOWED.has(k));

/** Open a recipe card and return its note textarea. */
function noteField(app, day = 0, slot = 'dinner') {
  app.click(slotRow(app, day, slot).querySelector('[data-detail]'));
  const id = app.state().plan.days[day][slot].recipeId;
  const el = app.$(`[data-note="${id}"]`);
  assert.ok(el, 'the recipe card has no note field');
  return { el, id };
}

test('clicking into the note field leaves the field on the page', () => {
  const app = open();
  const { el } = noteField(app);

  // A real browser focuses on mousedown and fires click on mouseup, so this is
  // the order a person's single click actually arrives in.
  el.focus();
  el.click();

  assert.ok(el.isConnected, 'the note field was torn off the page by its own click');
  assert.equal(app.window.document.activeElement, el, 'the click moved focus out of the note field');
});

test('clicking the note field writes nothing to the save', () => {
  const app = open();
  const before = app.saved();
  const { el } = noteField(app);
  el.focus();
  el.click();

  assert.deepEqual(strayKeys(app.state()), [], 'clicking the note field invented a top-level key');
  assert.equal(app.state().plan.days[0].dinner.recipeId !== undefined, true, 'the plan survived');
  assert.ok(before, 'sanity: something was saved to begin with');
});

test('a note typed straight after clicking the field is kept', () => {
  const app = open();
  const { el, id } = noteField(app);

  // The whole workflow as a person does it: click in, type, click away.
  el.focus();
  el.click();
  app.set(el, 'Needed twice the chilli.');

  assert.equal(app.state().memory.notes[id], 'Needed twice the chilli.',
    'the note did not reach the save');
});

test('clearing a note removes it rather than storing an empty string', () => {
  const app = open();
  const { el, id } = noteField(app);
  app.set(el, 'Too salty.');
  assert.equal(app.state().memory.notes[id], 'Too salty.');

  const again = open({ stored: app.saved() });
  const { el: el2 } = noteField(again);
  again.set(el2, '   ');
  assert.equal(again.state().memory.notes[id], undefined, 'a blank note should be deleted, not saved');
});

test('the one-shot banner can still be dismissed', () => {
  const app = open();
  // A plan from an older engine is what raises the banner in the first place.
  const stale = { ...app.state(), plan: { ...app.state().plan, version: 0 } };
  const again = open({ stored: JSON.stringify(stale) });

  assert.ok(again.state().migrationNote, 'sanity: the migration banner was not raised');
  const notice = [...again.$$('.notice')].find((n) => /Got it/.test(n.textContent));
  assert.ok(notice, 'the banner has no dismiss button');

  again.click(notice.querySelector('button'));
  assert.equal(again.state().migrationNote, null, 'the banner could not be dismissed');
  assert.deepEqual(strayKeys(again.state()), [], 'dismissing the banner invented a top-level key');
});

test('a stray key left behind by the old bug is dropped on load', () => {
  // What the bug actually wrote: a key named after a recipe id, value null.
  const polluted = { ...emptyState(), 'd-moussaka': null, 'l-haehnchen-wrap': null };
  const cleaned = migrate(polluted);

  assert.deepEqual(strayKeys(cleaned), [], 'the junk keys were carried through the migration');
  assert.ok(cleaned.settings.people.length, 'the real state was kept');
});

test('migrate keeps every key the app legitimately writes', () => {
  const full = { ...emptyState(), migrationNote: 'rebuilt', mergeNote: 'merged' };
  const out = migrate(full);
  assert.equal(out.migrationNote, 'rebuilt');
  assert.equal(out.mergeNote, 'merged');
  for (const k of Object.keys(emptyState())) {
    assert.ok(k in out, `migrate dropped ${k}`);
  }
});
