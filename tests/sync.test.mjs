import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNC_FILE_NAME, syncSupported, memoryHandles, permissionFor, readHandle, writeHandle,
  describeSync, whenText, isBlank, createSync,
} from '../src/sync.js';
import { createStore, mergeStates, emptyState, snapshot } from '../src/store.js';
import { generateWeek, defaultSettings, forEachEntry } from '../src/planner.js';
import { rateRecipe, noteRecipe, setPantry, addCustomRecipe } from '../src/swap.js';
import { pantryKey } from '../src/planner.js';

// ---------------------------------------------------------------- the fakes
//
// A file handle is four methods and a name. Faking it exactly means the sync
// logic can be tested to the last branch with no browser anywhere — and the
// fakes can misbehave on purpose, which a real browser will not do on demand.

function fakeFile({ name = SYNC_FILE_NAME, text = '', permission = 'granted', failWrite = false, failRead = false } = {}) {
  const box = { name, text, writes: 0, asked: 0, permission };
  const handle = {
    name,
    async queryPermission() { return box.permission === 'granted' ? 'granted' : 'prompt'; },
    async requestPermission() {
      box.asked += 1;
      return box.permission === 'grant-on-ask' ? (box.permission = 'granted') : box.permission;
    },
    async getFile() {
      if (failRead) throw new Error('disk gone');
      return { text: async () => box.text };
    },
    async createWritable() {
      if (failWrite) throw new Error('read only');
      let buf = '';
      return {
        async write(chunk) { buf += chunk; },
        async close() { box.text = buf; box.writes += 1; },
      };
    },
  };
  return { handle, box };
}

function fakeWin(handle, { supported = true } = {}) {
  const win = {
    indexedDB: null,
    timers: [],
    setTimeout(fn) { win.timers.push(fn); return win.timers.length; },
    clearTimeout(id) { win.timers[id - 1] = null; },
    /** Run whatever the debounce is holding, the way a real timer eventually would. */
    async tick() {
      const due = win.timers.filter(Boolean);
      win.timers = [];
      for (const fn of due) await fn();
    },
    picked: 0,
  };
  if (supported) {
    win.showSaveFilePicker = async () => { win.picked += 1; return handle; };
    win.showOpenFilePicker = async () => { win.picked += 1; return [handle]; };
  }
  return win;
}

/** A store with no browser at all: createStore falls back to in-memory. */
const store = () => {
  const s = createStore(undefined);
  s.load();
  s.save({ ...s.state, plan: generateWeek(defaultSettings(), { banned: [] }) });
  return s;
};

const sync = (opts = {}) => {
  const { handle, box } = fakeFile(opts.file);
  const win = fakeWin(handle, opts);
  const st = opts.store ?? store();
  let renders = 0;
  const s = createSync({ win, store: st, handles: memoryHandles(), onChange: () => { renders += 1; } });
  return { s, st, win, box, handle, renders: () => renders };
};

// ---------------------------------------------------------------- capability
test('a browser without the file API is told so, not left guessing', () => {
  assert.equal(syncSupported(undefined), false);
  assert.equal(syncSupported({}), false);
  assert.equal(syncSupported({ showSaveFilePicker: () => {} }), false, 'both pickers are needed');
  assert.equal(syncSupported({ showSaveFilePicker: () => {}, showOpenFilePicker: () => {} }), true);
});

test('an unsupported browser is pointed at Export/Import instead', () => {
  const d = describeSync(emptyState(), { supported: false });
  assert.match(d.text, /Export/);
  assert.match(d.text, /Chrome|Edge/);
});

test('link on an unsupported browser fails with a sentence, not an exception', async () => {
  const { s } = sync({ supported: false });
  const res = await s.link({ create: true });
  assert.equal(res.ok, false);
  assert.match(res.error, /cannot link/i);
});

// ---------------------------------------------------------------- linking
test('linking a fresh file writes the whole state into it', async () => {
  const { s, box } = sync();
  const res = await s.link({ create: true });
  assert.equal(res.ok, true, res.error);
  const written = JSON.parse(box.text);
  assert.ok(written.plan, 'the week was not written');
  assert.ok(written.savedAt, 'nothing to merge against without a timestamp');
  assert.equal(box.writes, 1);
});

test('linking records the file name so the UI can say what it is linked to', async () => {
  const { s, st } = sync();
  await s.link({ create: true });
  assert.equal(st.state.sync.name, SYNC_FILE_NAME);
  assert.ok(st.state.sync.at, 'no sync time recorded');
  assert.equal(s.status.tone, 'good');
  assert.match(s.status.text, new RegExp(SYNC_FILE_NAME));
});

test('closing the picker is not an error — nothing is said and nothing breaks', async () => {
  const st = store();
  const win = fakeWin(null);
  win.showSaveFilePicker = async () => { const e = new Error('user cancelled'); e.name = 'AbortError'; throw e; };
  const s = createSync({ win, store: st, handles: memoryHandles() });
  const res = await s.link({ create: true });
  assert.equal(res.ok, false);
  assert.equal(res.error, undefined, `an abort must stay silent, got "${res.error}"`);
  assert.equal(s.error, null);
});

test('refusing permission is reported instead of failing quietly', async () => {
  const { s } = sync({ file: { permission: 'denied' } });
  const res = await s.link({ create: true });
  assert.equal(res.ok, false);
  assert.match(res.error, /permission/i);
  assert.equal(s.linked, true, 'the handle exists, it just cannot be used');
});

test('a browser that grants on asking works from the second attempt', async () => {
  const { s, box } = sync({ file: { permission: 'grant-on-ask' } });
  const res = await s.link({ create: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(box.asked, 1, 'permission should be requested exactly once');
});

// ---------------------------------------------------------------- merging
test('linking a file that already has the other phone in it merges both ways', async () => {
  // Her phone: two bans and a rating the laptop has never seen.
  const hers = store();
  let m = rateRecipe(hers.state.memory, 'x-fav', 5);
  m = noteRecipe(m, 'x-fav', 'more lemon');
  hers.save({ ...hers.state, memory: { ...m, banned: ['x-hated'] } });

  const mine = store();
  mine.save({ ...mine.state, memory: { ...mine.state.memory, banned: ['x-mine'] } });

  const { s, st, box } = sync({ store: mine, file: { text: JSON.stringify(snapshot(hers.state)) } });
  await s.link({ create: false });

  assert.deepEqual([...st.state.memory.banned].sort(), ['x-hated', 'x-mine'], 'a ban was lost');
  assert.equal(st.state.memory.ratings['x-fav'], 5, 'her rating did not arrive');
  assert.equal(st.state.memory.notes['x-fav'], 'more lemon');
  // ...and the merged result is written back, so her phone gets his ban next time.
  assert.deepEqual([...JSON.parse(box.text).memory.banned].sort(), ['x-hated', 'x-mine']);
});

test('an empty file is a normal first link, not corrupt data', async () => {
  const { s, box } = sync({ file: { text: '   \n' } });
  assert.equal(isBlank('   \n'), true);
  const res = await s.link({ create: true });
  assert.equal(res.ok, true, res.error);
  assert.ok(JSON.parse(box.text).plan, 'the state was not written over the blank file');
  assert.equal(s.error, null);
});

test('junk in the shared file is reported and the local week is untouched', async () => {
  const { s, st } = sync({ file: { text: 'not json at all' } });
  const before = JSON.stringify(st.state.plan);
  const res = await s.pull();
  assert.equal(res.ok, false);
  await s.link({ create: false });
  assert.match(s.error ?? '', /does not contain planner data/i);
  assert.equal(JSON.stringify(st.state.plan), before, 'a bad file must not damage the plan');
});

test('the pantry survives a merge as an amount, not as a tick', () => {
  const key = pantryKey({ item: 'Basmati Reis', unit: 'g' });
  const mine = { ...emptyState(), savedAt: 2, memory: { ...emptyState().memory, pantry: { [key]: 500 } } };
  const theirs = { ...emptyState(), savedAt: 1, memory: { ...emptyState().memory, pantry: { [key]: 1000, 'x-g': 200 } } };
  const merged = mergeStates(mine, theirs);
  assert.equal(merged.memory.pantry[key], 1000, 'the larger amount should win');
  assert.equal(merged.memory.pantry['x-g'], 200, 'their staple was dropped');
});

test('a custom recipe written on one device arrives on the other', async () => {
  const hers = store();
  const { memory, ok } = addCustomRecipe(hers.state.memory, {
    name: 'Omas Linsensuppe', slot: 'dinner', minutes: 25, kcal: 520, protein: 28,
    ingredients: [{ qty: 200, unit: 'g', item: 'Linsen', aisle: 'dry-goods' }],
    method: ['Alles kochen.'],
  });
  assert.equal(ok, true, 'the fixture recipe must be valid');
  hers.save({ ...hers.state, memory });

  const { s, st } = sync({ store: store(), file: { text: JSON.stringify(snapshot(hers.state)) } });
  await s.link({ create: false });
  assert.equal(st.state.memory.custom.length, 1);
  assert.equal(st.state.memory.custom[0].name, 'Omas Linsensuppe');
});

// ---------------------------------------------------------------- pushing
test('a local change is written to the file, once, after the debounce', async () => {
  const { s, st, win, box } = sync();
  await s.link({ create: true });
  const first = box.writes;

  st.save({ ...st.state, memory: { ...st.state.memory, banned: ['x-1'] } });
  s.schedule();
  st.save({ ...st.state, memory: { ...st.state.memory, banned: ['x-1', 'x-2'] } });
  s.schedule();
  assert.equal(box.writes, first, 'a write happened before the debounce elapsed');

  await win.tick();
  assert.equal(box.writes, first + 1, 'two quick changes should be one write');
  assert.deepEqual(JSON.parse(box.text).memory.banned, ['x-1', 'x-2']);
});

test('the write counter and the sync time are kept, so the panel can prove it works', async () => {
  const { s, st, win } = sync();
  await s.link({ create: true });
  const writes = st.state.sync.writes;
  st.save({ ...st.state, weights: [{ date: '2026-01-01', nick: 100 }] });
  s.schedule();
  await win.tick();
  assert.equal(st.state.sync.writes, writes + 1);
  assert.ok(Date.now() - st.state.sync.at < 5000);
});

test('nothing is written while there is no link — sync is opt-in', async () => {
  const { s, box } = sync();
  s.schedule();
  const res = await s.push();
  assert.equal(res.ok, false);
  assert.equal(box.writes, 0);
});

test('a read-only folder is reported and does not lose the local week', async () => {
  const { s, st } = sync({ file: { failWrite: true } });
  await s.link({ create: true });
  assert.match(s.error ?? '', /could not be written/i);
  assert.ok(st.state.plan, 'the plan is still here');
});

test('a file that disappeared is reported on the next read', async () => {
  const { s } = sync({ file: { failRead: true } });
  await s.link({ create: false });
  assert.match(s.error ?? '', /could not be read/i);
});

// ---------------------------------------------------------------- restoring
test('a link made last week comes back on its own when permission is still granted', async () => {
  const handles = memoryHandles();
  const { handle, box } = fakeFile({ text: JSON.stringify(snapshot({ ...emptyState(), savedAt: 1, memory: { ...emptyState().memory, banned: ['x-old'] } })) });
  const win = fakeWin(handle);
  await handles.set(handle);
  const st = store();
  const s = createSync({ win, store: st, handles });
  const res = await s.restore();
  assert.equal(res.ok, true, s.error ?? 'restore failed');
  assert.ok(st.state.memory.banned.includes('x-old'), 'the shared ban did not come back');
  assert.equal(win.picked, 0, 'restoring must not put a file picker in the user\'s face');
  assert.ok(box.text.length > 0);
});

test('a link whose permission lapsed asks for a click instead of failing silently', async () => {
  const handles = memoryHandles();
  const { handle } = fakeFile({ permission: 'grant-on-ask' });
  await handles.set(handle);
  const st = store();
  let renders = 0;
  const s = createSync({ win: fakeWin(handle), store: st, handles, onChange: () => { renders += 1; } });
  const res = await s.restore();
  assert.equal(res.ok, false, 'boot must not ask for permission by itself');
  assert.equal(s.permission, 'prompt');
  assert.ok(renders > 0, 'the UI was not told to show the Reconnect button');
  assert.equal(describeSync({ sync: { name: 'f.json' } }, { permission: 'prompt' }).tone, 'warn');

  // ...and the click works.
  const again = await s.reconnect();
  assert.equal(again.ok, true, s.error ?? 'reconnect failed');
  assert.equal(s.permission, 'granted');
});

test('with nothing stored, restore does nothing at all', async () => {
  const { s, win } = sync();
  const res = await s.restore();
  assert.equal(res.ok, false);
  assert.equal(win.picked, 0);
  assert.equal(s.linked, false);
});

test('unlinking forgets the file and stops writing to it', async () => {
  const { s, st, win, box } = sync();
  await s.link({ create: true });
  const writes = box.writes;
  await s.unlink();
  assert.equal(st.state.sync.name, null);
  assert.equal(s.linked, false);
  st.save({ ...st.state, memory: { ...st.state.memory, banned: ['x-after'] } });
  s.schedule();
  await win.tick();
  assert.equal(box.writes, writes, 'it kept writing after being unlinked');
  assert.equal(describeSync(st.state, {}).tone, 'info');
});

test('flush writes immediately, for the moment the tab is closing', async () => {
  const { s, st, box } = sync();
  await s.link({ create: true });
  const writes = box.writes;
  st.save({ ...st.state, memory: { ...st.state.memory, banned: ['x-last'] } });
  s.schedule();
  await s.flush();
  assert.equal(box.writes, writes + 1);
  assert.deepEqual(JSON.parse(box.text).memory.banned, ['x-last']);
});

// ---------------------------------------------------------------- plumbing
test('permissionFor treats a handle with no permission API as usable', async () => {
  assert.equal(await permissionFor({ }), 'granted');
  assert.equal(await permissionFor(null), 'denied');
  assert.equal(await permissionFor({ queryPermission: async () => { throw new Error('nope'); } }), 'denied');
});

test('read and write go through the handle exactly as the browser expects', async () => {
  const { handle, box } = fakeFile({ text: 'hello' });
  assert.equal(await readHandle(handle), 'hello');
  await writeHandle(handle, 'goodbye');
  assert.equal(box.text, 'goodbye');
  assert.equal(box.writes, 1, 'close() must be what commits the file');
});

test('the memory handle store behaves like the real one, so tests mean something', async () => {
  const h = memoryHandles();
  assert.equal(await h.get(), undefined);
  await h.set({ name: 'x' });
  assert.deepEqual(await h.get(), { name: 'x' });
  await h.clear();
  assert.equal(await h.get(), undefined);
});

test('the sync time reads as a sentence, not a timestamp', () => {
  const now = Date.now();
  assert.equal(whenText(now, now), 'just now');
  assert.equal(whenText(now - 120000, now), '2 minutes ago');
  assert.equal(whenText(now - 3600000 * 3, now), '3 hours ago');
  assert.equal(whenText(now - 86400000 * 2, now), '2 days ago');
});

test('the plan itself is last-write-wins, and the newer device wins', async () => {
  const older = { ...emptyState(), savedAt: 1000, plan: { version: 99, days: ['old'] } };
  const newer = { ...emptyState(), savedAt: 2000, plan: generateWeek(defaultSettings(), { banned: [] }) };
  const merged = mergeStates(older, newer);
  const ids = [];
  forEachEntry(merged.plan, (e) => { if (e.recipeId) ids.push(e.recipeId); });
  assert.ok(ids.length > 10, 'the newer week should have survived');
  assert.equal(mergeStates(newer, older).plan.version, newer.plan.version, 'an older file must not overwrite a newer week');
});

// ------------------------------------------------- never overwrite a bad read
// The shared file may hold the other person's only copy of the week. If it
// cannot be read or parsed, writing ours over it would destroy data in order to
// clear an error message. So a failed read stops all writing until it is fixed.

test('a file that cannot be parsed is left exactly as it was', async () => {
  const { s, st, win, box } = sync({ file: { text: '{ this is not planner data' } });
  const original = box.text;
  await s.link({ create: false });
  assert.equal(box.writes, 0, 'it wrote over a file it could not read');
  assert.equal(box.text, original);

  // ...and it stays that way: a later local change must not sneak a write in.
  st.save({ ...st.state, memory: { ...st.state.memory, banned: ['x-later'] } });
  s.schedule();
  await win.tick();
  await s.flush();
  assert.equal(box.writes, 0, 'a scheduled push overwrote the unreadable file');
  assert.match(s.error ?? '', /left alone/i);
});

test('once the file is readable again, syncing resumes', async () => {
  const { s, box } = sync({ file: { text: 'junk' } });
  await s.link({ create: false });
  assert.equal(box.writes, 0);
  box.text = '';                       // the other device wrote a clean file
  const res = await s.reconnect();
  assert.equal(res.ok, true, s.error ?? 'reconnect failed');
  assert.equal(box.writes, 1, 'it did not start writing again');
  assert.equal(s.error, null);
});
