// The app: all the DOM, and nothing else.
//
// Every decision worth testing lives in targets/recipes/planner/swap/shopping/store.
// This file only turns that state into HTML and turns clicks back into calls on
// those modules. Rendering is "rebuild the innerHTML of the active panel" — with
// seven day cards that is well under a frame, and it removes a whole class of
// stale-DOM bugs for free.

import {
  DAYS, DAY_MODES, dayModeLabel, SLOT_KEYS, defaultSettings, generateWeek,
  dayTotals, weekTotals, cookPortions, regenerateSlot, isEntry, entriesIn, targetFor,
  OFF_PLAN_PRESETS, logOffPlan, dayHasOffPlan, weekLedger, rebalanceWeek, clearAdjust,
  reflow, recordKept, recordSwapAway, learned, cookSessions, planMonth, MAX_DAY_ADJUST,
  preferencePenalty, forget, remember, dayLabel, setWeekStart, weekStartOf,
  weekShift, rotatePlan, dayName, shoppingSlice, vegetarianDaysOf, MAX_VEGETARIAN_DAYS,
} from './planner.js';
import {
  candidatesFor, swapMeal, swapAndLearn, banAndReplace, unbanRecipe, toggleLock,
  RATINGS, rateRecipe, noteRecipe, setPantry, clearPantry,
  addCustomRecipe, removeCustomRecipe, importRecipes,
} from './swap.js';
import {
  recipeById, RECIPES, bySlot, AISLES, AISLE_LABEL, SLOT_ORDER, CUISINES,
  INGREDIENT_UNITS, parseIngredientLines,
} from './recipes.js';
import {
  shoppingList, shoppingByShop, pantryCheck, pantrySaving, prepPlan,
} from './shopping.js';
import {
  createStore, addWeight, weightTrend, migrate, mergeStates, cloudDoc, sameDoc,
} from './store.js';
import { createRemote, describeRemote } from './remote.js';
import { createHouseholds } from './household.js';
import { createCloud } from './cloud.js';
import { createSync } from './sync.js';
import { seasonNote, peakThisMonth, MONTHS } from './seasons.js';
import {
  dailyTarget, dayTarget, maintenance, bmr, deficit, proteinFloor, weeklyLossKg,
  portionRatio, shouldSuggestMaintenance, isMaintaining, ACTIVITY_LEVELS, profile,
} from './targets.js';
import { createInstaller } from './install.js';
import { SLOT_LABEL, SLOT_FULL, MODE_SHORT } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => Math.round(n).toLocaleString('en-GB');
const qty = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const today = () => new Date().toISOString().slice(0, 10);
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf(Math.abs(n))}`;

const TABS = [
  ['week', 'This week'],
  ['shopping', 'Shopping'],
  ['prep', 'Prep ahead'],
  ['recipes', 'My recipes'],
  ['weight', 'Weight'],
  ['why', 'Why this plan'],
  ['settings', 'Settings'],
];

/** An empty custom-recipe form. Kept outside render so typing survives a re-render. */
const emptyDraft = () => ({
  name: '', slot: 'dinner', minutes: '25', kcal: '', protein: '',
  cuisine: 'mediterranean', ingredients: '', method: '',
});

/** The paste format, spelled out: nobody guesses field names, and a wrong guess looks like a bug. */
const IMPORT_EXAMPLE = [
  'Name: Ofen-Feta mit Tomaten',
  'Meal: dinner',
  'Cuisine: mediterranean',
  'Minutes: 25',
  'Kcal: 640',
  'Protein: 32',
  'Ingredients:',
  'Feta | 200 | g | dairy',
  'Kirschtomaten | 400 | g | produce',
  'Method:',
  'Heat the oven to 200 \u00b0C.',
  'Roast everything for 20 minutes.',
  '---',
  'Name: Skyr mit Beeren',
  'Meal: breakfast',
  '... and so on',
].join('\n');

export function createApp({ root, win = typeof window !== 'undefined' ? window : undefined }) {
  const store = createStore(win);
  store.load();
  let open = new Set();          // expanded meal details, keyed day|slot|person
  let swapTarget = null;         // the slot the swap dialog is choosing for
  let ateTarget = null;          // the slot the off-plan dialog is logging
  let undo = null;               // { label, state } — one step back, see undoable()
  let confirming = null;         // an in-page confirmation waiting for a second click
  let draft = emptyDraft();      // the custom-recipe form, mid-typing
  let draftErrors = [];          // what was wrong with it, shown instead of swallowed
  let draftWarnings = [];        // and what was merely odd -- said out loud, but saved anyway
  let importText = '';           // the paste box, mid-paste
  let importReport = null;       // { added, errors, warnings } from the last import
  let rebalanceReport = null;    // what the last rebalance managed to absorb
  let sync = null;               // the shared-file syncer, created at the end of setup
  let remote = null;             // the account, created at the end of setup too
  let accountEmail = '';         // the sign-in box, mid-typing
  let accountCode = '';          // the code-from-the-email box, mid-typing
  let houses = null;             // the household client, created with the account
  // `null` is "not asked yet" and `[]` is "asked, and in none" -- two states the
  // card has to tell apart, because one of them is a reason to ask and the other
  // is a reason to offer a Start button.
  let hhList = null;
  let hhMembers = {};            // household id -> the people in it
  let hhInvites = {};            // household id -> the codes still out
  let hhError = null;
  let hhAsked = false;           // asked once for this sign-in, right or wrong
  let hhBusy = false;            // the guard that keeps render() from fetching twice
  let hhName = '';               // the new-household box, mid-typing
  let hhRename = '';             // the rename box, mid-typing
  let hhCode = '';               // the join box, mid-typing
  // The invite just made, kept where a failed re-read cannot lose it: the code
  // comes back from create_invite once and once only, and an invite nobody saw
  // is worse than none -- it holds the seat, and you cannot revoke what you
  // were never shown.
  let hhFresh = null;            // {id, seat, code}
  let hhCopied = null;           // the code last put on the clipboard
  let cloud = null;              // the shared-week client, created with the account
  // The one question this app refuses to answer on anybody's behalf: an account
  // signing in on a phone that already has a week, into a household that also
  // has one. Held here until it is answered, and neither week is touched first.
  let cloudAsk = null;           // {id, rev, doc}
  let cloudAsked = false;        // asked the row once for this household, right or wrong
  let cloudBusy = false;         // the guard that keeps render() from fetching twice
  let cloudStop = null;          // the watcher's off switch
  let cloudWatching = null;      // the household it is watching, so it is not restarted
  let updateReady = false;       // a newer build is sitting in the service worker's cache

  /**
   * Home-screen install, where there is anything to offer.
   *
   * Null without a window, the same way the store and the syncer degrade: the
   * module tests import this file directly and there is nothing to install into.
   */
  const installer = win ? createInstaller(win) : null;
  // Chrome decides when an install becomes possible, which can be seconds after
  // boot. Without this the button only appears on the next render for some other
  // reason, which on a tab left open is never.
  installer?.onChange(() => render());

  // Dispatched by the service worker registration in the PWA shell, which is the
  // only part of the page the single-file build does not have. Nothing here knows
  // what a service worker is -- it is a DOM event like any other.
  win?.addEventListener?.('mp:update-ready', () => { updateReady = true; render(); });

  /**
   * Snapshot before a destructive change and offer one step back.
   *
   * This replaces window.confirm() throughout. A browser is allowed to suppress
   * page dialogs — Chrome does it after a few in a row — and a suppressed
   * confirm() returns false, which made the 👎 button silently do nothing.
   * Undo-after-the-fact never lies about whether it worked, and is less annoying.
   */
  function undoable(label, fn) {
    const before = JSON.parse(JSON.stringify(store.state));
    fn();
    undo = { label, state: before };
    render();
  }

  if (!store.state.plan) regenerate();

  // ------------------------------------------------------------- state edits
  function commit(fn, opts) {
    store.update((s) => fn({ ...s }), opts);
    render();
  }

  function regenerate(bumpSeed = false) {
    const s = store.state;
    const settings = bumpSeed ? { ...s.settings, seed: (s.settings.seed + 1) >>> 0 } : s.settings;
    const plan = generateWeek(settings, s.memory, s.plan);
    store.save({ ...s, settings, plan });
  }

  function personOf(slotValue, wantedId) {
    if (isEntry(slotValue)) return null;
    return wantedId ?? Object.keys(slotValue)[0];
  }

  /** The entry a slot id points at, whichever shape the slot has. */
  function entryAt(plan, t) {
    const v = plan.days[t.day]?.[t.slot];
    if (!v) return null;
    return isEntry(v) ? v : v[t.person ?? Object.keys(v)[0]];
  }

  // --------------------------------------------------------------- rendering
  function render() {
    // Before the HTML, and outside it: the card needs data this may have to go
    // and get, and a render triggered by that arriving must find the flag
    // already set or the two would call each other for ever.
    householdFollowsAccount();
    cloudFollowsAccount();
    const s = store.state;
    const tab = s.ui.tab ?? 'week';
    root.innerHTML = `
      <header class="top"><div class="wrap">
        <div class="top-row">
          <div class="brand">Meal Planner<small>${esc(s.settings.people[0].name)} &amp; ${esc(s.settings.people[1].name)} · one pot, two portions</small></div>
          <div class="spacer"></div>
          <div class="btn-row no-print">
            <button class="btn" data-act="reroll">🎲 New week</button>
            <button class="btn ghost" data-act="print">🖨 Print</button>
          </div>
        </div>
        <nav class="tabs" role="tablist">
          ${TABS.map(([id, label]) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}">${label}</button>`).join('')}
        </nav>
      </div></header>
      <main class="wrap">
        ${banner()}
        <section class="panel ${tab === 'week' ? 'active' : ''}">${viewWeek()}</section>
        <section class="panel ${tab === 'shopping' ? 'active' : ''}">${viewShopping()}</section>
        <section class="panel ${tab === 'prep' ? 'active' : ''}">${viewPrep()}</section>
        <section class="panel ${tab === 'recipes' ? 'active' : ''}">${viewRecipes()}</section>
        <section class="panel ${tab === 'weight' ? 'active' : ''}">${viewWeight()}</section>
        <section class="panel ${tab === 'why' ? 'active' : ''}">${viewWhy()}</section>
        <section class="panel ${tab === 'settings' ? 'active' : ''}">${viewSettings()}</section>
      </main>
      ${viewSheet()}
      <dialog id="swap"></dialog>
      <dialog id="ate"></dialog>`;
    wire();
    // Every state change lands here, so these two lines cover every path that
    // could need writing to the shared file or the shared row. Both debounce,
    // and the cloud one also checks that something actually changed -- a render
    // is not an edit, and a revision is not free.
    sync?.schedule();
    cloudTick();
  }

  function banner() {
    const s = store.state;
    const out = [];
    if (!store.persistent) {
      out.push(`<div class="notice bad">This browser will not let the page save anything, so the plan is forgotten when you close the tab. Usually a private window or blocked site data. Use <b>Export</b> in Settings to keep a copy.</div>`);
    }
    if (store.loadError) out.push(`<div class="notice bad">${esc(store.loadError)}</div>`);
    if (store.error) out.push(`<div class="notice bad">${esc(store.error)}</div>`);
    // A sync problem belongs on every tab, not buried in Settings: it means the
    // other person is not seeing your week, which is silent until it is said.
    if (sync?.error) out.push(`<div class="notice bad">${esc(sync.error)} <span class="faint">See Settings → Share.</span></div>`);
    // Both are one-shot explanations of something that already happened, so they
    // come with a way to say "yes, I read it" -- otherwise they sit there for ever.
    for (const key of ['migrationNote', 'mergeNote']) {
      if (!s[key]) continue;
      out.push(`<div class="notice"><span>${esc(s[key])}</span>
        <button class="btn ghost small no-print" data-dismiss="${key}" style="margin-left:.6rem">Got it</button></div>`);
    }
    // Above everything, including the update: it is the only notice in this app
    // that is a question, and the only one where guessing costs a week of
    // somebody's planning.
    if (cloudAsk) out.push(cloudQuestion());
    // Above the plan warnings: this one is about the app itself, and it is the
    // only notice here that stops being true if it is ignored long enough.
    if (updateReady) {
      out.push(`<div class="notice good no-print"><span>A newer version is ready.</span>
        <button class="btn small" data-act="reload-app" style="margin-left:.6rem">Reload</button></div>`);
    }
    out.push(installNotice());
    for (const w of s.plan?.warnings ?? []) out.push(`<div class="notice">${esc(w)}</div>`);
    if (undo) {
      out.push(`<div class="notice good no-print"><span>${esc(undo.label)}</span>
        <button class="btn ghost small" data-act="undo" style="margin-left:.6rem">↩ Undo</button></div>`);
    }
    const shown = out.filter(Boolean);
    return shown.length ? `<div class="stack" style="margin-bottom:1rem">${shown.join('')}</div>` : '';
  }

  /**
   * The nudge to put the app on a home screen, which is a different sentence on
   * each of the two phones it is written for.
   *
   * Android gets a button, because `beforeinstallprompt` gives one something to
   * do. iOS gets prose, because Safari has no API at all and Share -> Add to Home
   * Screen is not a thing anybody finds on their own. Either way it is dismissible
   * and the dismissal is saved: a notice that cannot be put away is an advert.
   */
  function installNotice() {
    if (store.state.ui.installHint === 'off') return '';
    const state = installer?.state() ?? 'installed';
    if (state === 'can-prompt') {
      return `<div class="notice good no-print"><span>Add this to your home screen and it opens like an app, with no browser bar — and keeps working in a shop with no signal.</span>
        <span class="btn-row" style="margin-left:.6rem">
          <button class="btn small primary" data-act="install">Add it</button>
          <button class="btn small ghost" data-dismiss-install="1">Not now</button>
        </span></div>`;
    }
    if (state === 'ios-hint') {
      return `<div class="notice no-print"><span>To keep this handy: tap <b>Share</b> (the square with the arrow up), then <b>Add to Home Screen</b>. It then opens like an app, and still works in a shop with no signal.</span>
        <button class="btn small ghost" data-dismiss-install="1" style="margin-left:.6rem">Got it</button></div>`;
    }
    // 'installed', or a desktop browser that is never going to offer.
    return '';
  }

  // ------------------------------------------------------------------- week
  function viewWeek() {
    const s = store.state;
    const wk = weekTotals(s.plan);
    const [him, her] = s.settings.people;
    return `
      <div class="card pad no-print" style="margin-bottom:1rem">
        <div class="btn-row">
          <span class="small muted">This week:</span>
          <span class="pill him">${esc(him.name)} ${nf(wk[him.id].kcal / 7)} kcal/day · ${nf(wk[him.id].protein / 7)} g protein</span>
          <span class="pill her">${esc(her.name)} ${nf(wk[her.id].kcal / 7)} kcal/day · ${nf(wk[her.id].protein / 7)} g protein</span>
          <span class="spacer"></span>
          <span class="tiny faint">🔄 swap · 📝 I ate something else · 👎 never again · 🔒 keep on re-roll</span>
        </div>
      </div>
      ${ledgerBar()}
      <div class="week">${s.plan.days.map(dayCard).join('')}</div>`;
  }

  /**
   * What actually happened this week versus what was planned.
   *
   * Only shown once something is off plan or corrected — an untouched week does
   * not need a scoreboard. The surplus is quoted in kcal and in kg, because
   * "1,600 kcal over" means nothing and "a fifth of a kilo" means everything.
   */
  function ledgerBar() {
    const s = store.state;
    const led = weekLedger(s.plan, s.settings);
    const logged = s.settings.people.some((p) => led[p.id].offPlanMeals > 0);
    const corrected = (s.settings.adjust ?? []).some((a) => Object.keys(a ?? {}).length > 0);
    if (!logged && !corrected) return '';

    const rows = s.settings.people.map((p) => {
      const l = led[p.id];
      const meals = l.offPlanMeals
        ? `${l.offPlanMeals} meal${l.offPlanMeals === 1 ? '' : 's'} off plan (${signed(l.offPlanKcal)} kcal)`
        : 'nothing off plan';
      const where = l.surplus > 40
        ? `<b>${signed(Math.round(l.surplus))} kcal</b> over for the week — about ${l.kgEquivalent.toFixed(2)} kg of the loss`
        : l.surplus < -40 ? `<b>${signed(Math.round(l.surplus))} kcal</b> under for the week, which is fine`
          : 'the week still adds up';
      return `<li><span class="pill ${p.id === s.settings.people[0].id ? 'him' : 'her'}">${esc(p.name)}</span> ${meals} · ${where}</li>`;
    });

    const report = rebalanceReport ? s.settings.people.map((p) => {
      const r = rebalanceReport[p.id];
      if (!r || !r.surplus) return '';
      if (!r.absorbed) return `<li>${esc(p.name)}: nothing could be taken off without going under a safe day.</li>`;
      return `<li>${esc(p.name)}: ${nf(r.absorbed)} kcal spread over the days after it${r.left > 0
        ? `, and ${nf(r.left)} kcal written off — taking more off would push a day under what is safe to eat.` : '.'}</li>`;
    }).filter(Boolean).join('') : '';

    return `
      <div class="card pad no-print ledger" style="margin-bottom:1rem">
        <div class="btn-row">
          <h2 style="font-size:1rem">Planned vs actual</h2>
          <span class="spacer"></span>
          <button class="btn" data-act="rebalance">⚖ Spread it over the rest of the week</button>
          ${corrected ? '<button class="btn ghost" data-act="clear-adjust">Clear the corrections</button>' : ''}
        </div>
        <ul class="small" style="margin:.6rem 0 0">${rows.join('')}</ul>
        ${report ? `<ul class="small" style="margin:.5rem 0 0">${report}</ul>` : ''}
        <p class="tiny faint" style="margin:.5rem 0 0">A correction is capped at ${MAX_DAY_ADJUST} kcal a day and never drops a day below a safe intake. One heavy day is not worth a miserable week.</p>
      </div>`;
  }

  function dayCard(day) {
    const s = store.state;
    const t = dayTotals(day);
    const football = day.index === s.settings.footballDay;
    return `
      <article class="card day ${football ? 'is-football' : ''}">
        <header>
          <div class="day-title"><h2>${day.name}</h2>
            <span class="tiny faint">${esc(dayModeLabel(s.settings, day.mode))}</span></div>
          <div class="modes no-print" role="group" aria-label="${day.name} mode">
            ${DAY_MODES.map((m) => `<button data-mode="${m}" data-day="${day.index}" aria-pressed="${day.mode === m}">${MODE_SHORT[m]}</button>`).join('')}
          </div>
        </header>
        <div class="totals">
          ${s.settings.people.map((p, i) => {
    // targetFor, not dayTarget: if the week was rebalanced, the bar has to show
    // the target that is actually being cooked to, or the plan looks broken.
    const target = targetFor(p, s.settings, day.index);
    const adj = s.settings.adjust?.[day.index]?.[p.id] ?? 0;
    const got = t[p.id] ?? { kcal: 0, protein: 0 };
    const pct = Math.min(115, (got.kcal / target) * 100);
    const floor = proteinFloor(p);
    return `<div>
              <div class="tot-name ${i === 0 ? 'him' : 'her'}">${esc(p.name)}</div>
              <div class="tot-val">${nf(got.kcal)} <span class="faint">/ ${nf(target)}</span></div>
              <div class="bar ${i === 0 ? 'him' : 'her'} ${pct > 105 ? 'over' : ''}"><i style="width:${pct}%"></i></div>
              <div class="tiny ${got.protein >= floor ? 'faint' : 'muted'}">${nf(got.protein)} g protein ${got.protein >= floor ? '✓' : `(floor ${floor})`}${adj ? ` · <span class="adj">${signed(adj)} corrected</span>` : ''}</div>
            </div>`;
  }).join('')}
        </div>
        <ul class="slots">${SLOT_KEYS.map((k) => slotRow(day, k)).join('')}</ul>
      </article>`;
  }

  function slotRow(day, key) {
    const v = day[key];
    if (isEntry(v)) return slotLine(day, key, v, null, null);
    // Lunch is per person: one line each when they differ, one shared line when they match.
    const ids = Object.keys(v);
    const same = ids.length === 2 && v[ids[0]].recipeId && v[ids[0]].recipeId === v[ids[1]].recipeId
      && v[ids[0]].kind === v[ids[1]].kind;
    if (!same) return ids.map((id) => slotLine(day, key, v[id], id, null)).join('');
    // Merge the two entries so one line can still show two portions and two
    // calorie figures — each person's numbers only exist on their own entry.
    const merged = { ...v[ids[0]], portions: {}, kcal: {}, protein: {}, locked: ids.every((id) => v[id].locked) };
    for (const id of ids) {
      merged.portions[id] = v[id].portions[id];
      merged.kcal[id] = v[id].kcal[id];
      merged.protein[id] = v[id].protein[id];
    }
    return slotLine(day, key, merged, null, ids);
  }

  function slotLine(day, key, entry, personId, sharedIds) {
    const s = store.state;
    const r = entry.recipeId ? recipeById(entry.recipeId) : null;
    const id = `${day.index}|${key}|${personId ?? (sharedIds ? '*' : '')}`;
    const people = s.settings.people;
    const nameOf = (pid) => people.find((p) => p.id === pid)?.name ?? pid;
    const rating = r ? s.memory.ratings?.[r.id] : null;
    const note = r ? s.memory.notes?.[r.id] : null;

    const numbers = (sharedIds ?? (personId ? [personId] : Object.keys(entry.kcal)))
      .map((pid) => `${nameOf(pid)} ${entry.estimated ? '≈' : ''}${nf(entry.kcal[pid] ?? 0)} kcal`).join(' · ');

    const title = r ? esc(r.name)
      : entry.kind === 'off-plan' ? `📝 ${esc(entry.note ?? 'Off plan')}`
        : entry.kind === 'canteen' ? '🍽 Kantine — pick from the tray'
          : '🍴 Eating out (budgeted)';

    const meta = [];
    if (personId) meta.push(`<span class="pill ${personId === people[0].id ? 'him' : 'her'}">${esc(nameOf(personId))}</span>`);
    if (entry.kind === 'leftover') meta.push(`<span class="leftover-tag">♻ ${dayLabel(s.plan, entry.from)}'s dinner — already cooked</span>`);
    if (entry.kind === 'batch') meta.push(`<span class="leftover-tag">♻ reheat ${dayLabel(s.plan, entry.from)}'s batch</span>`);
    if (entry.kind === 'off-plan') meta.push('<span class="off-tag">logged — an estimate, not a measurement</span>');
    if (r && entry.kind === 'recipe') meta.push(`${r.minutes} min`);
    if (r && key === 'dinner' && entry.kind === 'recipe') {
      const cp = cookPortions(s.plan, day.index);
      if (cp > Object.values(entry.portions).reduce((a, b) => a + b, 0) + 1e-9) {
        meta.push(`<span class="leftover-tag">cook ${qty(cp)} portions</span>`);
      }
    }
    if (rating) meta.push(`<span class="rated" title="You gave it ${rating} of 5">${'★'.repeat(rating)}</span>`);
    if (note) meta.push('<span class="note-flag" title="You left a note on this one">📝</span>');
    meta.push(numbers);

    const canSwap = entry.kind !== 'leftover' && entry.kind !== 'off-plan';
    const canBan = entry.kind === 'recipe';
    const offPlan = entry.kind === 'off-plan';
    return `
      <li class="slot ${entry.locked ? 'locked' : ''} ${r ? '' : 'guidance'} ${offPlan ? 'is-offplan' : ''}">
        <div class="slot-head">
          <div class="slot-label">${SLOT_LABEL[key]}</div>
          <div class="slot-body">
            <button class="slot-name" data-detail="${id}" title="${r ? 'Show ingredients and method' : 'Show the guidance'}">${title}</button>
            <div class="slot-meta">${meta.join('<span class="faint">·</span>')}</div>
          </div>
          <div class="slot-acts no-print">
            ${canSwap ? `<button data-swap="${id}" title="Swap this for something else">🔄</button>` : ''}
            ${offPlan
    ? `<button data-unlog="${id}" title="Put the planned meal back">↩</button>`
    : `<button data-ate="${id}" title="I ate something else — log what it actually was">📝</button>`}
            ${canBan ? `<button data-ban="${id}" title="Never again — remove it from every future week">👎</button>` : ''}
            <button class="lock" data-lock="${id}" title="${entry.locked ? 'Unlock' : 'Keep this when I re-roll the week'}">${entry.locked ? '🔒' : '🔓'}</button>
          </div>
        </div>
        ${open.has(id) ? detail(day, key, entry, r) : ''}
      </li>`;
  }

  function detail(day, key, entry, r) {
    const s = store.state;
    if (!r) return `<div class="note">${esc(entry.note ?? '')}</div>`;
    const cp = key === 'dinner' && entry.kind === 'recipe' ? cookPortions(s.plan, day.index) : null;
    const scale = cp ?? Object.values(entry.portions).reduce((a, b) => a + b, 0);
    const per = s.settings.people.map((p) => (entry.portions[p.id] === undefined ? null
      : `${esc(p.name)}: ${qty(entry.portions[p.id])} portion${entry.portions[p.id] === 1 ? '' : 's'} — ${nf(entry.kcal[p.id])} kcal, ${nf(entry.protein[p.id])} g protein`))
      .filter(Boolean);
    const note = s.memory.notes?.[r.id] ?? '';
    const rating = s.memory.ratings?.[r.id] ?? 0;
    const season = s.settings.useSeason === false ? null : seasonNote(r, planMonth(s.settings));
    return `
      <div class="detail">
        ${note ? `<p class="note-shown">📝 ${esc(note)}</p>` : ''}
        ${entry.kind === 'leftover'
    ? `<p class="cook-note" style="margin:.1rem 0 .6rem">♻ Nothing to cook — this is ${dayLabel(s.plan, entry.from)}'s dinner out of the fridge.</p>` : ''}
        ${entry.kind === 'batch'
    ? `<p class="cook-note" style="margin:.1rem 0 .6rem">♻ Nothing to cook — reheat a box from ${dayLabel(s.plan, entry.from)}'s cook-up.</p>` : ''}
        <h4>Portions</h4>
        <ul>${per.map((x) => `<li>${x}</li>`).join('')}
        ${cp && cp > 0 ? `<li class="cook-note">Cook ${qty(cp)} portions in total tonight — the extra is tomorrow's lunch.</li>` : ''}</ul>
        <h4>Ingredients ${scale !== 1 ? `<span class="faint">(for ${qty(scale)} portions)</span>` : ''}</h4>
        <ul>${r.ingredients.map((i) => `<li>${qty(Math.round(i.qty * scale * 10) / 10)} ${esc(i.unit)} ${esc(i.item)}</li>`).join('')}</ul>
        ${season ? `<p class="season-note">🌱 ${esc(season)}</p>` : ''}
        <h4>Method · ${r.minutes} min · ${esc(r.cuisine)}</h4>
        <ol>${r.method.map((m) => `<li>${esc(m)}</li>`).join('')}</ol>
        <div class="tiny faint">${r.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}</div>
        <div class="likes no-print">
          <div class="stars" role="group" aria-label="Rate ${esc(r.name)}">
            ${RATINGS.map((n) => `<button data-rate="${esc(r.id)}|${n}" aria-pressed="${rating >= n}" title="${n} out of 5">★</button>`).join('')}
            <span class="tiny faint">${rating ? `${rating}/5 — tap the same star to clear it` : 'Rate it and the planner leans towards what you liked'}</span>
          </div>
          <label class="field"><span>Note — comes back every time this recipe does</span>
            <textarea data-note="${esc(r.id)}" rows="2" placeholder="Needed more chilli. Double the yoghurt.">${esc(note)}</textarea></label>
        </div>
      </div>`;
  }

  // --------------------------------------------------------------- shopping
  function viewShopping() {
    const s = store.state;
    const pantry = s.memory.pantry ?? {};
    const shops = s.settings.shops;
    const days = shoppingSlice(s.settings);
    const byShop = shoppingByShop(s.plan, { shops, itemShop: s.itemShop, pantry, days });
    const check = pantryCheck(s.plan, { pantry, days });
    const saving = pantrySaving(s.plan, { pantry, days });
    const all = byShop.flatMap((sh) => sh.groups.flatMap((g) => g.items));
    const left = all.filter((i) => !s.bought[i.id]).length;

    const row = (i) => `
      <div class="shop-item ${s.bought[i.id] ? 'done' : ''}">
        <input type="checkbox" id="b-${esc(i.id)}" data-bought="${esc(i.id)}" ${s.bought[i.id] ? 'checked' : ''}>
        <label for="b-${esc(i.id)}">${esc(i.item)}</label>
        <span class="qty">${qty(i.qty)} ${esc(i.unit)}</span>
        <button class="ico no-print" data-have="${esc(i.id)}|${i.rawQty}" title="Already in the cupboard — take it off the list">🏠</button>
        ${shops.length > 1 ? `<select class="shop-pick no-print" data-item-shop="${esc(i.id)}" title="Buy this somewhere else">
          ${shops.map((sh) => `<option value="${esc(sh.id)}" ${s.itemShop?.[i.id] === sh.id ? 'selected' : ''}>${esc(sh.name)}</option>`).join('')}
        </select>` : ''}
      </div>`;

    return `
      <div class="card pad" style="margin-bottom:1rem">
        <div class="btn-row">
          <h2 style="font-size:1rem">Shopping list</h2>
          <span class="pill">${left} of ${all.length} still to buy</span>
          ${saving.have ? `<span class="pill good">${saving.have} already in</span>` : ''}
          <span class="spacer"></span>
          <button class="btn ghost no-print" data-act="clear-bought">Reset ticks</button>
          <button class="btn ghost no-print" data-act="print">🖨 Print</button>
        </div>
        <div class="no-print" style="margin-top:.75rem">
          <span class="tiny faint" style="text-transform:uppercase;letter-spacing:.04em">Days this list is for</span>
          <div class="btn-row" style="margin-top:.35rem;align-items:center">
            <div class="modes" role="group" aria-label="Days to shop for">
              ${s.plan.days.map((d) => `<button data-shopday="${d.index}" aria-pressed="${days.includes(d.index)}">${esc(d.name)}</button>`).join('')}
            </div>
            <button class="btn ghost" data-act="shopdays-all">${days.length === 7 ? 'Clear all' : 'Select all'}</button>
          </div>
          ${days.length > 0 && days.length < 7 ? `<p class="tiny faint" style="margin:.45rem 0 0">Covers ${days.map((d) => esc(s.plan.days[d]?.name ?? '')).join(', ')}. A meal reheated from a day outside that list is left off, because its ingredients were bought for the day it is cooked on.</p>` : ''}
        </div>
        <p class="small muted" style="margin:.7rem 0 0">Split by shop, then by aisle, in the order the trip happens. Quantities are ${days.length === 7 ? 'for the whole week' : `for ${days.length} day${days.length === 1 ? '' : 's'}`} for both of you, rounded up to something a shop actually sells — leftover lunches are already included, which is why the meat looks like a lot.</p>
      </div>
      ${byShop.filter((sh) => sh.count > 0).map((sh) => `
        <div class="card pad shop-block">
          <div class="btn-row"><h3 style="font-size:.95rem">${esc(sh.shop.name)}</h3>
            <span class="pill">${sh.count} item${sh.count === 1 ? '' : 's'}</span></div>
          ${sh.groups.map((g) => `
            <div class="shop-group">
              <h4>${esc(g.label)}</h4>
              ${g.items.map(row).join('')}
            </div>`).join('')}
        </div>`).join('')}
      ${days.length === 0 ? '<div class="card pad"><p class="muted small">No days are selected, so there is nothing to buy. Pick the days this trip has to cover.</p></div>' : ''}
      ${all.length === 0 && days.length > 0 ? '<div class="card pad"><p class="muted small">Nothing to buy — the week is covered by what is already in the cupboard.</p></div>' : ''}
      ${byShop.some((sh) => sh.count === 0) ? `<p class="tiny faint" style="margin:.4rem 0 .9rem">Nothing needed from ${byShop.filter((sh) => sh.count === 0).map((sh) => esc(sh.shop.name)).join(' or ')} this week.</p>` : ''}
      ${viewPantry(check, pantry)}`;
  }

  /**
   * The cupboard.
   *
   * Two lists on purpose: what this week needs and you say you have (worth a
   * glance before leaving, because a half-empty jar of tahini is the difference
   * between a plan and a takeaway), and everything else you have ticked, which
   * would otherwise be impossible to un-tick once the week moved on.
   */
  function viewPantry(check, pantry) {
    const needed = new Set(check.map((i) => i.id));
    const others = Object.keys(pantry).filter((k) => !needed.has(k));
    const pretty = (key) => {
      const m = /^(.*)-(g|ml|Stk)$/.exec(key);
      return m ? `${m[1].replace(/-/g, ' ')} (${m[2]})` : key.replace(/-/g, ' ');
    };
    return `
      <div class="card pad stack" style="margin-top:.9rem">
        <div class="btn-row">
          <h2 style="font-size:1rem">In the cupboard</h2>
          <span class="spacer"></span>
          ${Object.keys(pantry).length ? '<button class="btn ghost no-print" data-act="clear-pantry">Empty the list</button>' : ''}
        </div>
        ${Object.keys(pantry).length === 0
    ? '<p class="small muted">Press 🏠 on anything above that you already have. It comes off the list, and the planner starts preferring recipes that use it up.</p>'
    : ''}
        ${check.length ? `
          <div>
            <h4 style="font-size:.8rem">Needed this week — check you really still have it</h4>
            ${check.map((i) => `
              <div class="shop-item ${i.short ? 'short' : ''}">
                <span class="ico-flat">${i.short ? '⚠' : '✓'}</span>
                <label>${esc(i.item)}${i.short ? ' — running low' : ''}</label>
                <span class="qty">need ${qty(i.rawQty)} ${esc(i.rawUnit)} · have ${qty(i.have)}</span>
                <button class="ico no-print" data-pantry-del="${esc(i.id)}" title="I do not actually have this">✕</button>
              </div>`).join('')}
          </div>` : ''}
        ${others.length ? `
          <div>
            <h4 style="font-size:.8rem">Also ticked as in stock</h4>
            <div class="chips">${others.map((k) => `<button class="chip no-print" data-pantry-del="${esc(k)}" title="Remove from the cupboard">${esc(pretty(k))} ✕</button>`).join('')}</div>
          </div>` : ''}
        <p class="tiny faint">Pantry ticks go stale fast — empty the list after a big shop rather than trusting last month's guess.</p>
      </div>`;
  }

  // ------------------------------------------------------------------- prep
  function viewPrep() {
    const s = store.state;
    const jobs = prepPlan(s.plan);
    const byDay = new Map();
    for (const j of jobs) {
      if (!byDay.has(j.day)) byDay.set(j.day, []);
      byDay.get(j.day).push(j);
    }
    const batch = s.settings.cookingStyle === 'batch';
    const sessions = cookSessions(s.settings);
    return `
      <div class="card pad stack">
        <h2 style="font-size:1rem">Prep ahead</h2>
        <p class="small muted">The plan survives a bad week only if the food exists before the willpower runs out. These are the jobs worth doing early.</p>
        ${batch
    ? `<div class="notice good">Batch weeks: you cook on <b>${sessions.map((d) => dayLabel(s.plan, d)).join(' and ')}</b> and eat out of the fridge in between. Cook the full number of portions on the card — the rest of the week depends on it.</div>`
    : '<div class="notice good">Sunday, 45 minutes: boil six eggs, cut the vegetable sticks into water, make two jars of overnight oats, and cook the Friday football dinner. That is four decisions you will not have to make at 22:00.</div>'}
        ${jobs.length === 0 ? '<p class="muted small">Nothing to batch this week.</p>' : ''}
        ${[...byDay.entries()].map(([d, list]) => `
          <div>
            <h3 style="font-size:.85rem">${dayLabel(s.plan, d)}</h3>
            <ul class="small">${list.map((j) => `<li><b>${esc(j.what)}</b><br><span class="faint">${esc(j.why)}</span></li>`).join('')}</ul>
          </div>`).join('')}
      </div>`;
  }

  // -------------------------------------------------------------- my recipes
  function viewRecipes() {
    const s = store.state;
    const mine = s.memory.custom ?? [];
    return `
      <div class="grid2">
        <div class="card pad stack">
          <h2 style="font-size:1rem">Add one of your own</h2>
          <p class="small muted">Your recipes go into the same pool as the built-in ones: they get chosen, portioned, put on the shopping list and offered in swaps. Per portion, not per pot — the app does the scaling.</p>
          ${draftErrors.length ? `<div class="notice bad"><ul style="margin:0;padding-left:1.1rem">${draftErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
          ${draftWarnings.length ? `<div class="notice"><strong>${draftErrors.length ? 'Worth a second look' : 'Saved — worth a second look'}</strong><ul style="margin:.3rem 0 0;padding-left:1.1rem">${draftWarnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
          <label class="field"><span>Name</span><input data-draft="name" value="${esc(draft.name)}" placeholder="Ofen-Feta mit Tomaten"></label>
          <div class="grid2">
            <label class="field"><span>Which meal</span><select data-draft="slot">
              ${SLOT_ORDER.map((sl) => `<option value="${sl}" ${draft.slot === sl ? 'selected' : ''}>${SLOT_FULL[sl] ?? sl}</option>`).join('')}
            </select></label>
            <label class="field"><span>Cuisine</span><select data-draft="cuisine">
              ${CUISINES.map((c) => `<option value="${c}" ${draft.cuisine === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select></label>
            <label class="field"><span>Minutes</span><input type="number" data-draft="minutes" value="${esc(draft.minutes)}"></label>
            <label class="field"><span>kcal per portion</span><input type="number" data-draft="kcal" value="${esc(draft.kcal)}"></label>
            <label class="field"><span>Protein per portion (g)</span><input type="number" data-draft="protein" value="${esc(draft.protein)}"></label>
          </div>
          <label class="field"><span>Ingredients — one per line, <code>Name | amount | unit | aisle</code></span>
            <textarea class="mono" data-draft="ingredients" rows="6" placeholder="Feta | 200 | g | dairy&#10;Kirschtomaten | 400 | g | produce&#10;Olivenöl | 20 | ml | pantry">${esc(draft.ingredients)}</textarea></label>
          <p class="tiny faint">Units: ${INGREDIENT_UNITS.join(', ')}. Aisles: ${AISLES.join(', ')} — leave the aisle off and it lands in Vorrat.</p>
          <label class="field"><span>Method — one step per line</span>
            <textarea data-draft="method" rows="4" placeholder="Heat the oven to 200 °C.&#10;Roast everything for 20 minutes.">${esc(draft.method)}</textarea></label>
          <div class="btn-row">
            <button class="btn primary" data-act="save-recipe">Save it</button>
            <button class="btn ghost" data-act="clear-draft">Clear the form</button>
          </div>
          <p class="tiny faint">A lunch is tagged packable automatically, and anything over 30 minutes is tagged weekend — otherwise the planner would accept it and then never choose it.</p>
        </div>

        <div class="card pad stack">
          <h2 style="font-size:1rem">Mine (${mine.length})</h2>
          ${mine.length === 0 ? '<p class="small muted">Nothing yet. The built-in library is 100-odd recipes, so there is no rush.</p>' : `
            <table><tbody>${mine.map((r) => `<tr>
              <td><b>${esc(r.name)}</b><br><span class="tiny faint">${esc(SLOT_FULL[r.slot] ?? r.slot)} · ${r.minutes} min · ${nf(r.kcal)} kcal · ${nf(r.protein)} g</span></td>
              <td class="num"><button class="btn ghost tiny" data-del-recipe="${esc(r.id)}">remove</button></td>
            </tr>`).join('')}</tbody></table>`}
          <div class="notice">Removing a recipe takes it out of the library. Anything it is currently filling stays until the next re-roll, so the week does not develop a hole while you are looking at it.</div>
          <h3 style="font-size:.85rem">The library</h3>
          <p class="small muted">${RECIPES.length} built-in recipes${mine.length ? ` plus your ${mine.length}` : ''}: ${SLOT_ORDER.map((sl) => `${bySlot(sl).length} ${sl}`).join(', ')}.</p>
        </div>
        <div class="card pad stack" id="import">
          <h2 style="font-size:1rem">Or paste a batch</h2>
          <p class="small muted">Typing twelve recipes one form at a time is how this stops happening. Paste them all at once with a line of <code>---</code> between them — or paste a file one of us exported from Settings, which is how a recipe moves from my browser to yours.</p>
          ${importReport ? `
            ${importReport.added ? `<div class="notice good">Imported ${importReport.added} recipe${importReport.added === 1 ? '' : 's'}. ${importReport.errors.length ? 'The rest are below.' : 'They are in the pool from now on.'}</div>` : ''}
            ${importReport.errors.length ? `<div class="notice bad"><strong>${importReport.added ? 'Not imported' : 'Nothing imported'}</strong><ul style="margin:.3rem 0 0;padding-left:1.1rem">${importReport.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
            ${importReport.warnings.length ? `<div class="notice"><strong>Imported — worth a second look</strong><ul style="margin:.3rem 0 0;padding-left:1.1rem">${importReport.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}` : ''}
          <label class="field"><span>Paste the recipes here</span>
            <textarea class="mono" data-import rows="10" placeholder="${esc(IMPORT_EXAMPLE).replace(/\n/g, '&#10;')}">${esc(importText)}</textarea></label>
          <div class="btn-row">
            <button class="btn primary" data-act="import-recipes">Import them</button>
            <button class="btn ghost" data-act="clear-import">Clear the box</button>
          </div>
          <p class="tiny faint">The format, in case the box is already full:</p>
          <div class="example">${esc(IMPORT_EXAMPLE)}</div>
          <p class="tiny faint">Only <code>Name</code>, <code>Meal</code>, <code>Minutes</code>, <code>Kcal</code>, <code>Protein</code> and <code>Ingredients</code> are needed; the rest are optional. <code>Calories</code>, <code>Time</code>, <code>Steps</code> and <code>Title</code> work too, and so do the German meal names. Anything that does not add up is listed above with the line it is on, and everything else still imports.</p>
        </div>
      </div>`;
  }

  // ----------------------------------------------------------------- weight
  function viewWeight() {
    const s = store.state;
    const rows = [...s.weights].reverse();
    return `
      <div class="grid2">
        <div class="card pad stack">
          <h2 style="font-size:1rem">Log a weigh-in</h2>
          <p class="small muted">Same day of the week, first thing, after the loo, before breakfast. Day-to-day noise is water; only the multi-week line means anything.</p>
          <label class="field"><span>Date</span><input type="date" id="w-date" value="${today()}"></label>
          <div class="grid2">
            ${s.settings.people.map((p) => `<label class="field"><span>${esc(p.name)} (kg)</span><input type="number" step="0.1" id="w-${esc(p.id)}" placeholder="${p.weightKg}"></label>`).join('')}
          </div>
          <div class="btn-row"><button class="btn primary" data-act="log-weight">Save weigh-in</button></div>
        </div>
        <div class="card pad stack">
          <h2 style="font-size:1rem">Trend</h2>
          ${s.settings.people.map((p) => {
    const t = weightTrend(s.weights, p.id);
    const predicted = weeklyLossKg(p, p.exerciseKcalByDay);
    return `<div>
              <div class="kv"><span>${esc(p.name)} — predicted</span><b>${predicted.toFixed(2)} kg/week</b></div>
              <div class="kv"><span>${esc(p.name)} — actual</span><b>${t ? `${t.kgPerWeek >= 0 ? '+' : ''}${t.kgPerWeek.toFixed(2)} kg/week` : '—'}</b></div>
              ${t ? `<p class="tiny faint" style="margin:.3rem 0 .8rem">${t.from} → ${t.to} kg over ${Math.round(t.days)} days.${Math.abs(t.kgPerWeek - -predicted) > 0.35 ? ' That is far enough from the prediction to adjust the calorie target in Settings rather than trust the formula.' : ' Close enough to the prediction — leave the targets alone.'}</p>` : '<p class="tiny faint" style="margin:.3rem 0 .8rem">Two weigh-ins at least a week apart, then this becomes useful.</p>'}
              ${spark(s.weights, p.id)}
            </div>`;
  }).join('')}
        </div>
      </div>
      <div class="card pad" style="margin-top:.9rem">
        <h2 style="font-size:1rem;margin-bottom:.6rem">History</h2>
        ${rows.length === 0 ? '<p class="muted small">Nothing logged yet.</p>' : `
        <table><thead><tr><th>Date</th>${s.settings.people.map((p) => `<th class="num">${esc(p.name)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${rows.map((w) => `<tr><td>${esc(w.date)}</td>${s.settings.people.map((p) => `<td class="num">${w[p.id] ?? '—'}</td>`).join('')}<td class="num"><button class="btn ghost tiny no-print" data-del-weight="${esc(w.date)}">remove</button></td></tr>`).join('')}</tbody></table>`}
      </div>`;
  }

  function spark(weights, personId) {
    const pts = weights.filter((w) => typeof w[personId] === 'number');
    if (pts.length < 2) return '';
    const xs = pts.map((w) => new Date(w.date).getTime());
    const ys = pts.map((w) => w[personId]);
    const x0 = Math.min(...xs); const xr = Math.max(1, Math.max(...xs) - x0);
    const y0 = Math.min(...ys); const yr = Math.max(0.5, Math.max(...ys) - y0);
    const d = pts.map((w, i) => `${((xs[i] - x0) / xr) * 100},${30 - ((ys[i] - y0) / yr) * 26}`).join(' L');
    return `<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path d="M${d}" fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".8"/></svg>`;
  }

  // -------------------------------------------------------------------- why
  function viewWhy() {
    const s = store.state;
    const ratio = portionRatio(s.settings.people);
    const lore = learned(s.memory);
    const month = planMonth(s.settings);
    const peak = peakThisMonth(month);
    return `
      <div class="card pad stack">
        <h2 style="font-size:1rem">Where the numbers come from</h2>
        <p class="small muted">Nothing here is a secret formula. If a number looks wrong, change the inputs in Settings and it all re-flows.</p>
        <table>
          <thead><tr><th>Step</th>${s.settings.people.map((p) => `<th class="num">${esc(p.name)}</th>`).join('')}</tr></thead>
          <tbody>
            ${[
    ['Resting burn (Mifflin–St Jeor BMR)', (p) => `${nf(bmr(p))} kcal`],
    ['× activity, i.e. maintenance', (p) => `${nf(maintenance(p))} kcal`],
    ['− deficit (capped at 500 kcal / 25%)', (p) => `−${nf(deficit(p))} kcal`],
    ['= daily target', (p) => `<b>${nf(dailyTarget(p))} kcal</b>`],
    ['Protein floor (1.5 g per kg)', (p) => `<b>${nf(proteinFloor(p))} g</b>`],
    ['Predicted loss', (p) => `${weeklyLossKg(p, p.exerciseKcalByDay).toFixed(2)} kg/week`],
  ].map(([label, fn]) => `<tr><td>${label}</td>${s.settings.people.map((p) => `<td class="num">${fn(p)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
        <div class="notice">Her portion is <b>${ratio.toFixed(2)}×</b> his, derived from the two targets rather than guessed. One pot, two portion sizes — nobody cooks twice.</div>
        ${s.settings.people.some(isMaintaining) ? `<div class="notice good">${s.settings.people.filter(isMaintaining).map((p) => esc(p.name)).join(' and ')} ${s.settings.people.filter(isMaintaining).length === 1 ? 'is' : 'are'} on maintenance: no deficit, and all of a sport day's burn goes back on the plate. The predicted loss is 0.00 kg/week on purpose.</div>` : ''}

        <h3 style="font-size:.9rem">What the app has worked out about you</h3>
        ${lore.liked.length === 0 && lore.disliked.length === 0
    ? '<p class="small muted">Nothing yet. Ratings, swaps and the meals that survive a whole week all feed this — it takes a couple of weeks before it says anything interesting.</p>'
    : `<div class="grid2">
            <div>
              <h4 style="font-size:.8rem">Leaning towards</h4>
              ${lore.liked.length ? `<ul class="small">${lore.liked.map((r) => `<li>${esc(r.name)} <span class="tiny faint">kept ${r.kept}×${r.rating ? ` · ${r.rating}/5` : ''}</span></li>`).join('')}</ul>` : '<p class="small muted">Nothing strong enough yet.</p>'}
            </div>
            <div>
              <h4 style="font-size:.8rem">Leaning away from</h4>
              ${lore.disliked.length ? `<ul class="small">${lore.disliked.map((r) => `<li>${esc(r.name)} <span class="tiny faint">swapped away ${r.away}×${r.rating ? ` · ${r.rating}/5` : ''}</span></li>`).join('')}</ul>` : '<p class="small muted">Nothing strong enough yet.</p>'}
            </div>
          </div>
          <p class="tiny faint">A preference nudges the choice, it never overrules the calorie budget or the time cap. Nothing here is permanent — 👎 is the permanent one.</p>`}

        <h3 style="font-size:.9rem">Seasonality</h3>
        ${s.settings.useSeason === false
    ? '<p class="small muted">Turned off in Settings, so every recipe scores the same whatever the month.</p>'
    : `<p class="small muted">Scoring for <b>${esc(MONTHS[month - 1])}</b>. Out-of-season produce is not banned, only pushed down the list — it will be imported, dearer and less sweet.</p>
          ${peak.length ? `<p class="small">At its best right now: ${peak.map((i) => `<span class="pill">${esc(i)}</span>`).join(' ')}</p>` : ''}`}

        <h3 style="font-size:.9rem">The decisions behind the plan</h3>
        <ul class="small">
          <li><b>Dinner is cooked big and tomorrow's lunch comes out of the same pot.</b> This is the whole point. The pizza and the bread-and-cheese happen at the moment there is no food and no time; a box in the fridge removes that moment.</li>
          <li><b>The evening snack is planned, not resisted.</b> A budgeted 150–250 kcal at 22:00 beats an unbudgeted 600. Both sweet and savoury options are in the rotation.</li>
          <li><b>Friday gets extra food, not less.</b> Football burns roughly 600 kcal; half of it is eaten back, so the day still nets a deeper deficit than a normal one — and the dinner needs about five minutes, because you get in at 22:00.</li>
          <li><b>Two meals out are in the plan.</b> Budgeted at the slot's calories with guidance on ordering, rather than pretended away and then blamed.</li>
          <li><b>Office days give a canteen card instead of a recipe.</b> There is no kitchen at work, so the useful thing is what to put on the tray.</li>
          <li><b>A bad evening is logged, not hidden.</b> 📝 on any meal records what you actually ate; the week can then absorb it over the days that are left instead of the whole plan being abandoned.</li>
          <li><b>Protein is a floor, not a target.</b> ${nf(proteinFloor(s.settings.people[0]))} g and ${nf(proteinFloor(s.settings.people[1]))} g are what 1.5 g/kg supports; going over is fine and keeps you full.</li>
        </ul>
        <div class="notice">These are estimates from a formula, not measurements. After three weeks the weight log is the better authority — if the actual loss is well off the prediction, change the target in Settings and trust the scale.</div>
        <p class="tiny faint">Not medical advice. Rapid loss, a health condition, pregnancy or medication changes the sums — that is a conversation with a doctor, not with a web page.</p>
      </div>`;
  }

  // --------------------------------------------------------------- settings
  function viewSettings() {
    const s = store.state;
    const banned = s.memory.banned.map((id) => recipeById(id)).filter(Boolean);
    const batch = s.settings.cookingStyle === 'batch';
    const sessions = cookSessions(s.settings);
    const vegWant = s.settings.vegetarianDays ?? 0;
    const vegDays = vegetarianDaysOf(s.settings);
    return `
      <div class="grid2">
        <div class="card pad stack">
          <h2 style="font-size:1rem">Us</h2>
          ${s.settings.people.map((p, i) => `
            <fieldset style="border:1px solid var(--line);border-radius:10px;padding:.8rem">
              <legend class="tiny faint">&nbsp;${esc(p.name)}&nbsp;</legend>
              <label class="field"><span>Name</span><input data-person="${i}" data-key="name" value="${esc(p.name)}"></label>
              <div class="grid2">
                <label class="field"><span>Weight (kg)</span><input type="number" step="0.5" data-person="${i}" data-key="weightKg" value="${p.weightKg}"></label>
                <label class="field"><span>Height (cm)</span><input type="number" data-person="${i}" data-key="heightCm" value="${p.heightCm}"></label>
                <label class="field"><span>Age</span><input type="number" data-person="${i}" data-key="age" value="${p.age}"></label>
                <label class="field"><span>Sex (for BMR)</span><select data-person="${i}" data-key="sex">
                  <option value="male" ${p.sex === 'male' ? 'selected' : ''}>male</option>
                  <option value="female" ${p.sex === 'female' ? 'selected' : ''}>female</option>
                </select></label>
              </div>
              <label class="field"><span>Daily activity</span><select data-person="${i}" data-key="activityFactor">
                ${ACTIVITY_LEVELS.map((a) => `<option value="${a.factor}" ${Math.abs(a.factor - p.activityFactor) < 1e-9 ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
              </select></label>
              <div class="grid2">
                <label class="field"><span>Right now</span><select data-person="${i}" data-key="goal">
                  <option value="lose" ${p.goal !== 'maintain' ? 'selected' : ''}>losing weight</option>
                  <option value="maintain" ${p.goal === 'maintain' ? 'selected' : ''}>holding steady</option>
                </select></label>
                <label class="field"><span>Goal weight (kg)</span><input type="number" step="0.5" data-person="${i}" data-key="goalWeightKg" value="${p.goalWeightKg ?? ''}"></label>
              </div>
              ${shouldSuggestMaintenance(p) ? `<div class="notice good">${esc(p.name)} is at ${p.goalWeightKg} kg — the goal.
                <button class="btn small" data-maintain="${i}" style="margin-left:.5rem">Switch to holding steady</button></div>` : ''}
              <div class="kv"><span>Daily target</span><b>${nf(dailyTarget(p))} kcal</b>${isMaintaining(p) ? ' <span class="tiny faint">maintenance</span>' : ''}</div>
              <div class="kv"><span>Protein floor</span><b>${nf(proteinFloor(p))} g</b></div>
            </fieldset>`).join('')}
        </div>

        <div class="card pad stack">
          <h2 style="font-size:1rem">The week</h2>
          <label class="field"><span>How you want to cook</span><select data-act="style">
            <option value="daily" ${!batch ? 'selected' : ''}>cook fresh most evenings</option>
            <option value="batch" ${batch ? 'selected' : ''}>two big cook-ups, eat out of the fridge</option>
          </select></label>
          ${batch ? `<div>
            <span class="tiny faint" style="text-transform:uppercase;letter-spacing:.04em">Cook-up days</span>
            <div class="modes" role="group" aria-label="Cooking days" style="margin-top:.35rem">
              ${DAYS.map((_, i) => `<button data-cookday="${i}" aria-pressed="${sessions.includes(i)}">${dayName(s.settings, i)}</button>`).join('')}
            </div>
            <p class="tiny faint" style="margin:.35rem 0 0">Anything before the first cook-up has to cook for itself — a cook-up on the last day of the week would be cooking for a week this plan does not cover.</p>
          </div>` : ''}
          <label class="field"><span>The week starts on</span><select data-act="weekstart">
            ${DAYS.map((d, i) => `<option value="${i}" ${weekStartOf(s.settings) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <p class="tiny faint" style="margin:-.2rem 0 0">Everything moves with its own day: the match stays on Friday, the office days stay where they are, and a long cook stays on the weekend.</p>
          <label class="field"><span>Football day (+ half the burn eaten back)</span>
            <select data-act="football">${DAYS.map((_, i) => `<option value="${i}" ${s.settings.footballDay === i ? 'selected' : ''}>${dayName(s.settings, i)}</option>`).join('')}</select></label>
          <label class="field"><span>Football burn (kcal)</span>
            <input type="number" step="50" data-act="burn" value="${s.settings.people[0].exerciseKcalByDay[s.settings.footballDay] ?? 600}"></label>
          <div>
            <span class="tiny faint" style="text-transform:uppercase;letter-spacing:.04em">Meals out (budgeted, not pretended away)</span>
            <table style="margin-top:.35rem"><tbody>
              ${s.settings.eatOut.map((o, i) => `<tr>
                <td><select data-eatout="${i}" data-field="day">${DAYS.map((_, di) => `<option value="${di}" ${o.day === di ? 'selected' : ''}>${dayName(s.settings, di)}</option>`).join('')}</select></td>
                <td><select data-eatout="${i}" data-field="slot">${['lunch', 'dinner'].map((sl) => `<option value="${sl}" ${o.slot === sl ? 'selected' : ''}>${SLOT_FULL[sl]}</option>`).join('')}</select></td>
                <td class="num"><button class="btn ghost tiny" data-del-eatout="${i}">remove</button></td></tr>`).join('')}
            </tbody></table>
            <div class="btn-row" style="margin-top:.4rem"><button class="btn ghost small" data-act="add-eatout">+ Add a meal out</button></div>
          </div>
          <label class="field"><span>Vegetarian days a week</span>
            <select data-act="vegdays">${[...Array(MAX_VEGETARIAN_DAYS + 1)].map((_, n) => `<option value="${n}" ${vegWant === n ? 'selected' : ''}>${n === 0 ? 'none' : `${n} of 7`}</option>`).join('')}</select></label>
          <p class="tiny faint" style="margin:-.2rem 0 0">${vegWant === 0
    ? 'Off - every day cooks from the whole library.'
    : `This week that is <b>${vegDays.map((i) => dayName(s.settings, i)).join(', ')}</b>. Every meal this kitchen cooks on those days is meatless. A canteen lunch and a meal out are not ours to change, so ${dayName(s.settings, s.settings.footballDay)} and the evenings out are never picked.${vegWant === vegDays.length ? ''
      : batch ? ` A batch week reheats one pot for several days, so the choice is made in whole cooking sessions: ${vegDays.length} ${vegDays.length === 1 ? 'day' : 'days'} is the nearest a session lands to ${vegWant}.`
        : ` Only ${vegDays.length} ${vegDays.length === 1 ? 'day' : 'days'} of this week cook at home, so that is as many as there are to give.`}`}</p>
          <div class="grid2">
            <label class="field"><span>Seasonality</span><select data-act="season">
              <option value="on" ${s.settings.useSeason !== false ? 'selected' : ''}>prefer what is in season</option>
              <option value="off" ${s.settings.useSeason === false ? 'selected' : ''}>ignore the season</option>
            </select></label>
            <label class="field"><span>Month to score against</span><select data-act="month">
              <option value="" ${!s.settings.month ? 'selected' : ''}>follow the calendar (${esc(MONTHS[planMonth({}) - 1])})</option>
              ${MONTHS.map((m, i) => `<option value="${i + 1}" ${s.settings.month === i + 1 ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select></label>
          </div>
          <div class="notice">Changing anything here rebuilds the week. Anything you locked with 🔒 is kept.</div>
        </div>
      </div>

      <div class="card pad stack" style="margin-top:.9rem">
        <h2 style="font-size:1rem">Where you shop</h2>
        <p class="small muted">The split is not snobbery, it is where the money and the quality actually differ: staples, frozen and drinks cost less at a discounter, while produce, meat, fish and cheese are where the supermarket has a range the discounter does not. An aisle belongs to one shop — pressing it here moves it.</p>
        ${s.settings.shops.map((sh, i) => `
          <div class="shop-edit">
            <div class="btn-row">
              <input class="grow" data-shop="${i}" data-field="name" value="${esc(sh.name)}" aria-label="Shop name">
              ${s.settings.shops.length > 1 ? `<button class="btn ghost tiny" data-del-shop="${i}">remove</button>` : ''}
            </div>
            <div class="chips">${AISLES.map((a) => `<button class="chip" data-shop-aisle="${i}|${a}" aria-pressed="${(sh.aisles ?? []).includes(a)}">${esc(AISLE_LABEL[a])}</button>`).join('')}</div>
          </div>`).join('')}
        <div class="btn-row"><button class="btn ghost small" data-act="add-shop">+ Add a shop</button></div>
        ${(() => {
    const covered = new Set(s.settings.shops.flatMap((sh) => sh.aisles ?? []));
    const loose = AISLES.filter((a) => !covered.has(a));
    return loose.length
      ? `<div class="notice">No shop covers ${loose.map((a) => esc(AISLE_LABEL[a])).join(', ')}, so those items go on the <b>${esc(s.settings.shops[0].name)}</b> list.</div>`
      : '';
  })()}
      </div>

      ${viewSyncPanel()}

      ${viewAccountPanel()}

      ${viewHouseholdPanel()}

      ${viewCloudPanel()}

      <div class="card pad stack" style="margin-top:.9rem">
        <h2 style="font-size:1rem">Never again (${banned.length})</h2>
        ${banned.length === 0 ? '<p class="muted small">Nothing banned yet. The 👎 button on any meal puts it here for good.</p>' : `
          <p class="small muted">These never come back. If a slot starts running dry, un-ban a few.</p>
          <table><tbody>${banned.map((r) => `<tr><td>${esc(r.name)}</td><td class="faint small">${esc(r.slot)}</td><td class="num"><button class="btn ghost tiny" data-unban="${esc(r.id)}">un-ban</button></td></tr>`).join('')}</tbody></table>`}
        ${slotHealth()}
      </div>

      <div class="card pad stack" style="margin-top:.9rem">
        <h2 style="font-size:1rem">Your data</h2>
        <p class="small muted">${(hhList ?? []).length
    ? 'The week, your recipes, bans and weight log are shared with your household, and a copy stays in this browser. Nothing else leaves this phone.'
    : 'Everything lives in this browser only — nothing is uploaded anywhere.'} Export before you switch browser or clear site data, or it is gone.</p>
        <div class="btn-row">
          <button class="btn" data-act="export">⬇ Export JSON</button>
          <button class="btn" data-act="import">⬆ Import JSON</button>
          <span class="spacer"></span>
          ${confirming === 'reset'
    ? `<span class="small">Erase the week, the bans, the settings and the weight log?</span>
             <button class="btn danger" data-act="reset-go">Yes, erase it</button>
             <button class="btn ghost" data-act="reset-cancel">Cancel</button>`
    : '<button class="btn danger ghost" data-act="reset">Erase everything</button>'}
        </div>
        <input type="file" id="importfile" accept="application/json,.json" style="display:none">
        <p class="tiny faint">Storage: ${store.persistent ? 'saving to this browser ✓' : 'unavailable — this session will be forgotten'}</p>
      </div>`;
  }

  /**
   * Sharing without a server.
   *
   * One JSON file in a folder both of you already sync (Dropbox, OneDrive, a
   * NAS). Each device reads it before writing, so bans, ratings, notes, your own
   * recipes and the cupboard merge instead of overwriting. Chrome and Edge only:
   * everywhere else the honest answer is Export/Import, said by name.
   */
  function viewSyncPanel() {
    const s = store.state;
    const st = sync?.status ?? { tone: 'info', text: 'Sharing is still starting up.' };
    const tone = st.tone === 'good' ? 'good' : st.tone === 'bad' ? 'bad' : '';
    const supported = sync?.supported ?? false;
    const linked = sync?.linked ?? false;
    const needsAsk = linked && sync?.permission !== 'granted';
    return `
      <div class="card pad stack" style="margin-top:.9rem">
        <h2 style="font-size:1rem">Share with ${esc(s.settings.people[1].name)}</h2>
        <div class="notice ${tone}">${esc(st.text)}</div>
        ${sync?.error && sync.error !== st.text ? `<div class="notice bad">${esc(sync.error)}</div>` : ''}
        ${supported ? `
          <div class="btn-row">
            ${needsAsk ? '<button class="btn primary" data-act="sync-reconnect">🔓 Reconnect</button>' : ''}
            <button class="btn ${linked ? 'ghost' : 'primary'}" data-act="sync-new">📄 ${linked ? 'Link a different file' : 'Create the shared file'}</button>
            <button class="btn ghost" data-act="sync-open">📂 Use a file that exists</button>
            ${linked ? '<button class="btn ghost" data-act="sync-now">↻ Sync now</button>' : ''}
            <span class="spacer"></span>
            ${linked ? '<button class="btn ghost" data-act="sync-unlink">Unlink</button>' : ''}
          </div>
          <p class="small muted">One of you creates the file in a shared folder; the other opens that same file with <b>Use a file that exists</b>. After that it reads and writes itself whenever something changes.</p>
          <p class="tiny faint">Merged meal by meal: if she swaps Tuesday's dinner while you log a pizza on Thursday, both survive — the later change wins on any one plate. Bans, favourites, ratings, notes, your own recipes, the cupboard and the trolley merge too, and deleting something now sticks instead of coming back on the next sync. Settings are last-save-wins. If one of you regenerates the whole week, the newer week replaces the other and you are told. A file that cannot be read is never written over.</p>
        ` : `
          <p class="small muted">Only Chrome and Edge can link a file from a web page. Everywhere else, <b>Export JSON</b> below and <b>Import JSON</b> on the other device does the same job by hand.</p>
        `}
      </div>`;
  }

  /**
   * Two weeks met. Which one survives?
   *
   * Asked, rather than resolved: a merge would be the clever answer and the
   * wrong one. The two weeks have no history in common -- this phone has never
   * seen that row and that row has never seen this phone -- so a union would
   * produce a week neither person planned, out of two they did.
   */
  function cloudQuestion() {
    const when = Number(cloudAsk.doc?.savedAt ?? 0);
    const days = when ? Math.floor((Date.now() - when) / 86400000) : null;
    const age = days === null ? '' : days <= 0 ? ' (changed today)' : days === 1 ? ' (changed yesterday)' : ` (changed ${days} days ago)`;
    return `<div class="notice no-print stack">
      <div><b>This phone has a week, and so does the household${esc(age)}.</b> Only one of them can be the shared week from here on — the other is replaced.</div>
      <div class="btn-row">
        <button class="btn primary" data-act="cloud-keep">Keep this phone's week</button>
        <button class="btn" data-act="cloud-take">Take the household's week</button>
      </div>
      <p class="tiny faint">Nothing has been written yet, in either direction. Export in Settings first if you would rather keep both.</p>
    </div>`;
  }

  /**
   * Whether the week is safe, in one line.
   *
   * The whole point of this card is that it is boring. A shared week that works
   * is invisible, and the only way to tell invisible-and-working from
   * invisible-and-stuck is to say which it is.
   */
  function viewCloudPanel() {
    if (!remote?.signedIn?.()) return '';
    const s = store.state;
    const st = cloud?.status() ?? { state: 'idle' };
    const id = s.cloud?.householdId;
    const house = (hhList ?? []).find((h) => h.id === id);

    let tone = '';
    let text;
    let retry = false;
    if (!(hhList ?? []).length) {
      text = 'The week is on this phone only. Start a household above and it travels with the account.';
    } else if (cloudAsk) {
      text = 'Two weeks are waiting on an answer — see the question at the top of the page.';
    } else if (!id) {
      text = cloudBusy ? 'Looking…' : 'The shared week has not started yet.';
    } else if (st.state === 'offline' || st.state === 'error' || st.state === 'conflict') {
      tone = 'bad';
      text = st.error ?? 'The last change did not reach the household.';
      retry = true;
    } else if (st.waiting || st.state === 'saving' || st.state === 'pending') {
      text = 'Saving to the household…';
    } else {
      tone = 'good';
      text = `Saved to ${esc(house?.name ?? 'the household')} — revision ${Number(s.cloud.rev ?? 0)}.`;
    }

    return `
      <div class="card pad stack" style="margin-top:.9rem" data-panel="cloud">
        <h2 style="font-size:1rem">The shared week</h2>
        <div class="notice ${tone}">${text}</div>
        ${retry ? '<div class="btn-row"><button class="btn primary" data-act="cloud-retry">↻ Try again now</button></div>' : ''}
        <p class="tiny faint">Everyone in the household plans the same week: a swap on one phone shows up on the other within half a minute, and both phones work offline in the meantime. Bans, favourites, notes, your own recipes and the cupboard merge from both sides — the week itself is whoever changed it last, meal by meal.</p>
      </div>`;
  }

  /**
   * The account.
   *
   * The smallest card in Settings, and last, because it is the least important:
   * nothing above this line needs one. A link in an email rather than a
   * password -- there is nothing to remember, no reset flow to build, and
   * nothing kept on the phone that is worth stealing for long. src/remote.js
   * has the rest: why the session lives outside the app state, and why being
   * offline is not treated as having been refused.
   */
  function viewAccountPanel() {
    const st = remote?.status() ?? describeRemote(null);
    const tone = st.signedIn ? 'good' : st.error ? 'bad' : '';
    return `
      <div class="card pad stack" style="margin-top:.9rem" data-panel="account">
        <h2 style="font-size:1rem">Account</h2>
        <div class="notice ${tone}">${esc(st.text)}</div>
        ${st.signedIn ? `
          <div class="btn-row"><button class="btn ghost" data-act="account-signout">Sign out</button></div>
          <p class="small muted">Signing out changes nothing on this phone. The week, the list and the weigh-ins stay exactly where they are — it only stops this device talking to the server.</p>
        ` : st.sent ? `
          <label class="field"><span>Code from the email</span><input id="account-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" value="${esc(accountCode)}"></label>
          <div class="btn-row">
            <button class="btn primary" data-act="account-verify">Sign in with this code</button>
            <span class="spacer"></span>
            <button class="btn ghost" data-act="account-resend">Send another</button>
            <button class="btn ghost" data-act="account-cancel">Different address</button>
          </div>
          <p class="small muted">The link in that email works too, on this device. Use the code if the link says it has expired before you ever clicked it — some work email scans links on the way in, which spends them.</p>
        ` : `
          <label class="field"><span>Email</span><input id="account-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(accountEmail)}"></label>
          <div class="btn-row"><button class="btn primary" data-act="account-signin">✉️ Email me a link</button></div>
          <p class="small muted">No password. The email has both a link and a 6-digit code; either one signs in the browser it is used in, so use them <b>on this device</b>.</p>
        `}
        <p class="tiny faint">Signed out is a perfectly good way to use this. The week, the shopping list and the weigh-ins all live on this phone either way; an account is only how a plan reaches a second one.</p>
      </div>`;
  }

  // ----------------------------------------------------------------- household
  //
  // The card is read-through: it asks once per sign-in, and again after anything
  // it changes. The load is driven by the account rather than by the card
  // appearing, because render() runs on every keystroke -- a fetch anywhere
  // inside it would be a fetch per keystroke, and a render() at the end of that
  // fetch would be a loop.

  /** The plan's own name for a seat. Nobody answers to `person2`. */
  function seatName(seat) {
    return store.state.settings.people.find((p) => p.id === seat)?.name || seat;
  }

  /** The seats nobody holds and nobody has been offered. */
  function freeSeats(id) {
    const taken = new Set([
      ...(hhMembers[id] ?? []).map((m) => m.seat),
      ...(hhInvites[id] ?? []).map((i) => i.seat),
    ]);
    return store.state.settings.people.map((p) => p.id).filter((pid) => !taken.has(pid));
  }

  /** How long an invite has left, in the unit a person would say it in. */
  function invitePeriod(iso) {
    const left = Date.parse(iso) - Date.now();
    if (!Number.isFinite(left) || left <= 0) return 'expiring now';
    const days = Math.round(left / 86_400_000);
    if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;
    const hours = Math.max(1, Math.round(left / 3_600_000));
    return `${hours} hour${hours === 1 ? '' : 's'} left`;
  }

  /**
   * One pass: the households, then what is in each.
   *
   * Members and invites go out together per household rather than one after the
   * other, because they are independent reads and the card needs both before it
   * can say anything. Invites are only asked for where you are the owner --
   * `pending invites, to the owner` in 0002 answers a member with an empty list,
   * which is indistinguishable from there being none.
   */
  async function loadHouseholds({ keepError = false } = {}) {
    if (!houses || hhBusy) return;
    hhBusy = true;
    hhAsked = true;
    try {
      const got = await houses.mine();
      if (!got.ok) { hhError = got.error; return; }
      const members = {};
      const invites = {};
      let trouble = null;
      await Promise.all(got.households.map(async (h) => {
        const [m, i] = await Promise.all([
          houses.members(h.id),
          h.role === 'owner' ? houses.invites(h.id) : Promise.resolve({ ok: true, invites: [] }),
        ]);
        if (m.ok) members[h.id] = m.members; else trouble ??= m.error;
        if (i.ok) invites[h.id] = i.invites; else trouble ??= i.error;
      }));
      hhList = got.households;
      hhMembers = members;
      hhInvites = invites;
      if (!keepError) hhError = trouble;
    } finally {
      hhBusy = false;
      render();
    }
  }

  /**
   * Run one household call, then show what the server now thinks.
   *
   * A refused call is not followed by a re-read: nothing changed, so there is
   * nothing new to read, and reading anyway would be one more chance to lose the
   * sentence that explains the refusal.
   */
  function household(fn, done) {
    if (hhBusy) return;
    hhBusy = true;
    hhError = null;
    // Any other action puts the last code away; the one that made it puts it
    // back in `done` below.
    hhFresh = null;
    render();
    Promise.resolve(fn())
      .then((r) => {
        hhBusy = false;
        if (!r?.ok) { hhError = r?.error ?? 'That did not work.'; render(); return undefined; }
        confirming = null;
        done?.(r);
        return loadHouseholds();
      })
      .catch((e) => {
        hhBusy = false;
        hhError = String(e?.message ?? e);
        render();
      });
  }

  /** Ask when the account arrives, and forget when it goes. */
  function householdFollowsAccount() {
    if (!remote?.signedIn?.()) {
      if (hhAsked || hhList) {
        hhAsked = false; hhList = null; hhMembers = {}; hhInvites = {};
        hhError = null; hhCode = ''; hhName = ''; hhRename = ''; hhFresh = null;
        hhCopied = null;
      }
      return;
    }
    if (!hhAsked && !hhBusy) Promise.resolve(loadHouseholds()).catch(() => {});
  }

  // ------------------------------------------------------------ shared week
  //
  // One row per household, guarded by a revision; src/cloud.js is the transport
  // and store.js owns the document. What lives here is the three decisions that
  // need a person or a screen:
  //
  //   - which household's row this phone's week belongs in;
  //   - what happens the first time two weeks meet;
  //   - whether the person can see that the week is safe.

  /**
   * The household whose row holds the week.
   *
   * The bookmarked one while the account is still in it, so a phone does not
   * change rows under somebody who joined a second household; the first one
   * otherwise. Nobody here is in two households yet, and a picker for a case
   * that does not exist is a picker that is wrong by the time it does.
   */
  function cloudHousehold() {
    const list = hhList ?? [];
    if (!list.length) return null;
    const was = store.state.cloud?.householdId;
    return list.some((h) => h.id === was) ? was : list[0].id;
  }

  /** Write down where this device now stands, without claiming an edit. */
  function cloudMark(id, rev, at) {
    const s = store.state;
    store.save({ ...s, cloud: { householdId: id, rev, at } }, { touch: false });
  }

  /**
   * The push, as a job cloud.js can retry without knowing what it is pushing.
   *
   * `read` returning null is what keeps a render from costing a revision: every
   * keystroke re-renders, and only a save moves `savedAt`.
   */
  function cloudJob(id) {
    return {
      read() {
        const s = store.state;
        if (s.cloud?.householdId !== id) return null;
        if (s.cloud.at != null && s.cloud.at === Number(s.savedAt ?? 0)) return null;
        return { doc: cloudDoc(s), rev: Number(s.cloud.rev ?? 0) };
      },
      // A lost race is resolved here and kept here. Pushing a merge this device
      // did not adopt would mean pushing the un-merged week again on the next
      // keystroke, and her changes would bounce straight back out of the row.
      merge(mineDoc, theirsDoc) {
        store.save(mergeStates(store.state, theirsDoc), { touch: false });
        return cloudDoc(store.state);
      },
      write(doc, rev) {
        cloudMark(id, rev, Number(doc.savedAt ?? store.state.savedAt ?? 0));
        render();
      },
    };
  }

  /** Called at the end of every render, like the file syncer. */
  function cloudTick() {
    const id = store.state.cloud?.householdId;
    if (!cloud || !id || !remote?.signedIn?.()) return;
    if (!cloudJob(id).read()) return;
    cloud.schedule(id, cloudJob(id));
  }

  /**
   * A week written by the other phone.
   *
   * Merged rather than taken: she may have banned something while this phone
   * added a recipe, and both are meant to survive. The bookmark is cleared
   * unless the row already holds the merged result -- that one comparison is
   * what stops two phones pushing each other's merges back and forth for ever.
   */
  function cloudArrived(id, got) {
    store.save(mergeStates(store.state, got.doc ?? {}), { touch: false });
    const settled = sameDoc(cloudDoc(store.state), got.doc ?? {});
    cloudMark(id, got.rev, settled ? Number(store.state.savedAt ?? 0) : null);
    render();
  }

  /** One watcher per household, started once. */
  function cloudWatch(id) {
    if (cloudWatching === id) return;
    cloudStop?.();
    cloudWatching = id;
    cloudStop = cloud.watch(id, (got) => cloudArrived(id, got), {
      // Asked each time, never captured: this phone's revision moves with every
      // push, and a watcher holding the one it started with would report this
      // phone's own writes back to it as news, for ever.
      rev: () => Number(store.state.cloud?.rev ?? 0),
    });
  }

  function cloudForget() {
    cloudStop?.();
    cloudStop = null; cloudWatching = null;
    cloudAsk = null; cloudAsked = false;
  }

  /**
   * Ask the row about itself, once, when the household first becomes known.
   *
   * An empty row is adopted without a word: there is no second week, so there
   * is nothing to choose between. A row with a week in it is a question, and it
   * is asked before anything is written -- including before the bookmark is
   * set, because the bookmark is what licenses the next push.
   */
  function cloudFollowsAccount() {
    if (!cloud || !remote?.signedIn?.()) {
      if (cloudWatching || cloudAsk || cloudAsked) cloudForget();
      return;
    }
    const id = cloudHousehold();
    if (!id) return;
    if (store.state.cloud?.householdId === id) { cloudWatch(id); return; }
    if (cloudAsked || cloudBusy) return;

    cloudAsked = true;
    cloudBusy = true;
    cloud.pull(id).then((got) => {
      cloudBusy = false;
      if (!got.ok) { render(); return; }
      const theirs = got.missing ? null : got.doc;
      if (!theirs || !Object.keys(theirs).length) {
        // Nothing there to lose, so this phone's week becomes the household's.
        cloudMark(id, got.rev, null);
      } else {
        cloudAsk = { id, rev: got.rev, doc: theirs };
      }
      render();
    }).catch(() => { cloudBusy = false; render(); });
  }

  /**
   * The household.
   *
   * Only for an account, because it is the only thing in Settings that cannot
   * work without one. A member's seat is a person in the plan, so everybody is
   * named the way the week names them rather than by the address they signed up
   * with -- this card is read by two people who know each other.
   */
  function viewHouseholdPanel() {
    if (!remote?.signedIn?.()) return '';
    const unknown = hhList === null;
    return `
      <div class="card pad stack" style="margin-top:.9rem" data-panel="household">
        <h2 style="font-size:1rem">Household</h2>
        ${hhError ? `<div class="notice bad">${esc(hhError)}</div>` : ''}
        ${unknown
    ? (hhBusy
      ? '<p class="small muted">Looking…</p>'
      : '<div class="btn-row"><button class="btn ghost" data-act="hh-retry">Try again</button></div>')
    : hhList.length === 0
      ? '<p class="small muted">You are <b>not in a household</b> yet. Start one and invite her, or type in the code she sent you.</p>'
      : hhList.map(viewOneHousehold).join('')}
        ${unknown ? '' : viewHouseholdForms()}
        <p class="tiny faint">A household is who a plan is shared with. The week on this phone is yours either way — joining one does not hand it over.</p>
      </div>`;
  }

  function viewOneHousehold(h) {
    const owner = h.role === 'owner';
    const people = hhMembers[h.id] ?? [];
    const out = hhInvites[h.id] ?? [];
    const fresh = hhFresh?.id === h.id ? hhFresh : null;
    // Only where there is a clipboard to copy to. The code is on screen either
    // way, and a Copy button that cannot copy is worse than no button.
    const copy = (code) => (win?.navigator?.clipboard
      ? `<button class="btn ghost tiny" data-act="hh-copy" data-code="${esc(code)}">${hhCopied === code ? 'Copied' : 'Copy'}</button>`
      : '');
    // Only an owner can invite, so only an owner is offered a free seat. The
    // seats already spoken for include the invites still out: offering one of
    // those again would be a guaranteed 23505 two taps later.
    const free = owner ? freeSeats(h.id) : [];
    const asking = confirming === `hh-leave:${h.id}` ? 'leave'
      : confirming === `hh-delete:${h.id}` ? 'delete'
        : confirming === `hh-rename:${h.id}` ? 'rename' : null;
    return `
      <div class="stack" data-household="${esc(h.id)}">
        <div class="btn-row">
          <b class="grow">${esc(h.name)}</b>
          <span class="tiny faint">${owner ? 'you are the owner' : 'you are a member'}</span>
        </div>
        ${people.length ? `<table><tbody>${people.map((m) => `
          <tr>
            <td>${esc(m.displayName || seatName(m.seat))}${m.you ? ' <span class="tiny faint">(you)</span>' : ''}</td>
            <td class="faint small">${esc(seatName(m.seat))}</td>
            <td class="faint small num">${esc(m.role)}</td>
          </tr>`).join('')}</tbody></table>` : ''}
        ${fresh ? `<div class="notice good">Her code is <b>${esc(fresh.code)}</b> ${copy(fresh.code)} — read it out or send it over. It is for ${esc(seatName(fresh.seat))}, works once, and lasts a week.</div>` : ''}
        ${out.map((i) => `
          <div class="btn-row">
            <b class="grow">${esc(i.code)}</b>
            <span class="tiny faint">for ${esc(seatName(i.seat))} · ${esc(invitePeriod(i.expiresAt))}</span>
            ${copy(i.code)}
            <button class="btn ghost tiny" data-act="hh-revoke" data-code="${esc(i.code)}">revoke</button>
          </div>`).join('')}
        ${free.length ? `<div class="btn-row">${free.map((seat) => `
          <button class="btn ghost small" data-act="hh-invite" data-id="${esc(h.id)}" data-seat="${esc(seat)}">Invite ${esc(seatName(seat))}</button>`).join('')}</div>` : ''}
        ${asking === 'rename' ? `
          <div class="btn-row">
            <input class="grow" id="hh-rename" value="${esc(hhRename)}" placeholder="${esc(h.name)}" aria-label="New name">
            <button class="btn primary small" data-act="hh-rename-go" data-id="${esc(h.id)}">Save</button>
            <button class="btn ghost small" data-act="hh-cancel">Cancel</button>
          </div>` : asking === 'leave' ? `
          <div class="btn-row">
            <span class="small grow">Leave ${esc(h.name)}? The week on this phone stays exactly as it is.</span>
            <button class="btn danger" data-act="hh-leave-go" data-id="${esc(h.id)}">Yes, leave</button>
            <button class="btn ghost" data-act="hh-cancel">Cancel</button>
          </div>` : asking === 'delete' ? `
          <div class="btn-row">
            <span class="small grow">Delete ${esc(h.name)} for everyone? The shared plan goes with it.</span>
            <button class="btn danger" data-act="hh-delete-go" data-id="${esc(h.id)}">Yes, delete it</button>
            <button class="btn ghost" data-act="hh-cancel">Cancel</button>
          </div>` : `
          <div class="btn-row">
            ${owner ? `<button class="btn ghost small" data-act="hh-rename" data-id="${esc(h.id)}" data-name="${esc(h.name)}">Rename</button>` : ''}
            <span class="spacer"></span>
            <button class="btn ghost small" data-act="hh-leave" data-id="${esc(h.id)}">Leave</button>
            ${owner ? `<button class="btn danger ghost small" data-act="hh-delete" data-id="${esc(h.id)}">Delete</button>` : ''}
          </div>`}
      </div>`;
  }

  /** Start one, or join one. Always both: more than one household is allowed. */
  function viewHouseholdForms() {
    const some = (hhList ?? []).length > 0;
    return `
      <div class="stack" style="margin-top:.4rem">
        ${some ? '<p class="tiny faint">Another household, if somebody else wants to share a week with you:</p>' : ''}
        <div class="btn-row">
          <input class="grow" id="hh-name" value="${esc(hhName)}" placeholder="Home" aria-label="Name for a new household">
          <button class="btn ${some ? 'ghost' : 'primary'} small" data-act="hh-create">Start${some ? ' another' : ' a household'}</button>
        </div>
        <div class="btn-row">
          <input class="grow" id="hh-code" value="${esc(hhCode)}" placeholder="Invite code" autocomplete="off" aria-label="Invite code">
          <button class="btn ${some ? 'ghost' : 'primary'} small" data-act="hh-join">Join with a code</button>
        </div>
      </div>`;
  }

  /** Warn before a ban list makes a slot impossible, rather than after. */
  function slotHealth() {
    const s = store.state;
    const rows = [['breakfast', 'breakfast'], ['lunch', 'lunch'], ['dinner', 'dinner'], ['snack', 'snack']]
      .map(([label, slot]) => {
        const total = bySlot(slot).length;
        const left = bySlot(slot).filter((r) => !s.memory.banned.includes(r.id)).length;
        return { label, left, total, thin: left < 8 };
      });
    if (!rows.some((r) => r.thin)) return '';
    return `<div class="notice ${rows.some((r) => r.left < 4) ? 'bad' : ''}">Running low: ${rows.filter((r) => r.thin).map((r) => `<b>${r.label}</b> has ${r.left} of ${r.total} left`).join(', ')}. Below about four the week starts repeating itself.</div>`;
  }

  // ------------------------------------------------------------ printed sheet
  //
  // The paper copy is its own markup, always in the page and hidden on screen
  // (see #sheet in ui.js). Printing the visible app instead would mean the paper
  // depended on which tab happened to be open, and would put calorie bars on the
  // fridge. Two pages, in the order they get used: the week, then the list.

  /** One slot as printed: name plus the one thing worth knowing about it. */
  function sheetLines(day, key) {
    const s = store.state;
    const v = day[key];
    const people = s.settings.people;
    const label = (entry) => {
      const r = entry.recipeId ? recipeById(entry.recipeId) : null;
      if (r) return r.name;
      if (entry.kind === 'canteen') return 'Kantine';
      if (entry.kind === 'off-plan') return entry.note ?? 'Off plan';
      return 'Eating out';
    };
    const sub = (entry) => {
      const r = entry.recipeId ? recipeById(entry.recipeId) : null;
      if (entry.kind === 'leftover') return `♻ ${dayLabel(s.plan, entry.from)}'s dinner`;
      if (entry.kind === 'batch') return `♻ reheat ${dayLabel(s.plan, entry.from)}'s batch`;
      if (entry.kind === 'off-plan') return 'logged, estimated';
      // For a canteen tray or a restaurant there is no recipe to follow, so the
      // budget IS the instruction. For a recipe, the time is.
      if (!r) {
        const kcals = Object.values(entry.kcal ?? {});
        return kcals.length ? `≈ ${nf(Math.max(...kcals))} kcal` : '';
      }
      const cp = key === 'dinner' && entry.kind === 'recipe' ? cookPortions(s.plan, day.index) : null;
      const cooked = cp && cp > Object.values(entry.portions).reduce((a, b) => a + b, 0) + 1e-9
        ? ` · cook ${qty(cp)} portions` : '';
      return `${r.minutes} min${cooked}`;
    };

    if (isEntry(v)) return [{ who: null, name: label(v), sub: sub(v) }];
    const ids = Object.keys(v);
    const same = ids.length === 2 && v[ids[0]].kind === v[ids[1]].kind
      && v[ids[0]].recipeId === v[ids[1]].recipeId && label(v[ids[0]]) === label(v[ids[1]]);
    if (same) return [{ who: null, name: label(v[ids[0]]), sub: sub(v[ids[0]]) }];
    return ids.map((id) => ({
      who: people.find((p) => p.id === id)?.name ?? id,
      name: label(v[id]),
      sub: sub(v[id]),
    }));
  }

  function viewSheet() {
    const s = store.state;
    const people = s.settings.people;
    const sheetDays = shoppingSlice(s.settings);
    const byShop = shoppingByShop(s.plan, {
      shops: s.settings.shops, itemShop: s.itemShop, pantry: s.memory.pantry, days: sheetDays,
    });
    const check = pantryCheck(s.plan, { pantry: s.memory.pantry, days: sheetDays });
    const jobs = prepPlan(s.plan).slice(0, 4);
    const buy = byShop.reduce((n, sh) => n + sh.count, 0);

    const cell = (day, key) => sheetLines(day, key).map((l) => `<div class="m">
        <span class="m-name">${l.who ? `${esc(l.who)}: ` : ''}${esc(l.name)}</span>
        <span class="m-sub">${esc(l.sub)}</span></div>`).join('');

    return `<section id="sheet">
      <div class="sheet-head">
        <h1>${esc(people[0].name)} &amp; ${esc(people[1].name)} — the week</h1>
        <span class="grow"></span>
        <span class="sheet-sub">printed ${today()} · targets ${people.map((p) => `${esc(p.name)} ${nf(dailyTarget(p))}`).join(' / ')} kcal</span>
      </div>
      <table class="grid">
        <colgroup><col class="c-day">${SLOT_KEYS.map(() => '<col>').join('')}</colgroup>
        <thead><tr><th>Day</th>${SLOT_KEYS.map((k) => `<th>${SLOT_LABEL[k]}</th>`).join('')}</tr></thead>
        <tbody>
          ${s.plan.days.map((day) => {
    const t = dayTotals(day);
    return `<tr>
              <td>
                <div class="d-name">${day.name}${day.index === s.settings.footballDay ? ' ⚽' : ''}</div>
                <div class="d-sub">${esc(MODE_SHORT[day.mode] ?? day.mode)}</div>
                ${people.map((p) => `<div class="d-sub">${esc(p.name)} ${nf(t[p.id]?.kcal ?? 0)} / ${nf(targetFor(p, s.settings, day.index))}</div>`).join('')}
              </td>
              ${SLOT_KEYS.map((k) => `<td>${cell(day, k)}</td>`).join('')}
            </tr>`;
  }).join('')}
        </tbody>
      </table>
      ${jobs.length ? `<div class="sheet-notes"><b>Before the week starts:</b>
        <ul>${jobs.map((j) => `<li>${dayLabel(s.plan, j.day)} — ${esc(j.what)}</li>`).join('')}</ul></div>` : ''}
      <div class="sheet-foot">Dinner is cooked big and tomorrow's lunch comes out of the same pot — that is why some portions look large. Shopping list on the back.</div>

      <div class="page2">
        <div class="sheet-head">
          <h1>Shopping list</h1>
          <span class="grow"></span>
          <span class="sheet-sub">${buy} item${buy === 1 ? '' : 's'} · whole week, both of you</span>
        </div>
        <div class="cols">
          ${byShop.filter((sh) => sh.count > 0).map((sh) => `<div class="block">
            <div class="shop-name">${esc(sh.shop.name)} <span class="sheet-sub">(${sh.count})</span></div>
            ${sh.groups.map((g) => `<div class="aisle-name">${esc(g.label)}</div>
              <ul class="buy">${g.items.map((i) => `<li class="${s.bought[i.id] ? 'done' : ''}">
                <span class="box"></span><span>${esc(i.item)}</span>
                <span class="q">${qty(i.qty)} ${esc(i.unit)}</span></li>`).join('')}</ul>`).join('')}
          </div>`).join('')}
          ${check.length ? `<div class="block">
            <div class="shop-name">Check you still have</div>
            <ul class="buy">${check.map((i) => `<li><span class="box"></span>
              <span>${esc(i.item)}${i.short ? ' — running low' : ''}</span>
              <span class="q">need ${qty(i.qty)} ${esc(i.unit)}</span></li>`).join('')}</ul>
          </div>` : ''}
          ${buy === 0 && check.length === 0 ? '<p class="sheet-sub">Nothing to buy — the week is covered by what is already in.</p>' : ''}
        </div>
        <div class="sheet-foot">Quantities are rounded up to what a shop actually sells. Leftover lunches are already counted.</div>
      </div>
    </section>`;
  }

  // ------------------------------------------------------------------ events
  // '*' means one line stands for both of them, so an action has to apply to both.
  function parseId(str) {
    const [d, slot, person] = str.split('|');
    return { day: Number(d), slot, person: person === '*' || !person ? null : person, shared: person === '*' };
  }

  function wire() {
    // `touch: false`: which tab you are looking at is not an edit. It is not
    // shared data either -- the merge drops it -- so stamping savedAt here
    // would spend a revision of the household's week on a tap, and outrank
    // the phone that was actually being used.
    root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => commit(
      (s) => ({ ...s, ui: { ...s.ui, tab: b.dataset.tab } }), { touch: false },
    ));

    root.querySelectorAll('[data-detail]').forEach((b) => b.onclick = () => {
      const id = b.dataset.detail;
      if (open.has(id)) open.delete(id); else open.add(id);
      render();
    });

    root.querySelectorAll('[data-swap]').forEach((b) => b.onclick = () => openSwap(parseId(b.dataset.swap)));
    root.querySelectorAll('[data-ate]').forEach((b) => b.onclick = () => openAte(parseId(b.dataset.ate)));

    // Un-log: rebuild that one slot from the planner and drop the lock the log
    // put on it, so the slot goes back to being a normal, re-rollable meal.
    root.querySelectorAll('[data-unlog]').forEach((b) => b.onclick = () => {
      const t = parseId(b.dataset.unlog);
      const s = store.state;
      undoable('The planned meal is back.', () => {
        const plan = regenerateSlot(s.plan, s.settings, s.memory, {
          day: t.day, slot: t.slot, person: t.person ?? null,
        });
        for (const e of entriesIn(plan.days[t.day][t.slot])) e.locked = false;
        store.save({ ...s, plan });
      });
    });

    root.querySelectorAll('[data-ban]').forEach((b) => b.onclick = () => {
      const t = parseId(b.dataset.ban);
      const s = store.state;
      const v = s.plan.days[t.day][t.slot];
      const entry = isEntry(v) ? v : v[t.person ?? Object.keys(v)[0]];
      const r = recipeById(entry.recipeId);
      undoable(`“${r?.name ?? 'That meal'}” will not come back.`, () => {
        const res = banAndReplace(s.plan, s.settings, s.memory, { day: t.day, slot: t.slot, person: t.person ?? undefined });
        store.save({ ...s, plan: res.plan, memory: res.memory });
      });
    });

    root.querySelectorAll('[data-lock]').forEach((b) => b.onclick = () => {
      const t = parseId(b.dataset.lock);
      commit((s) => ({ ...s, plan: toggleLock(s.plan, { day: t.day, slot: t.slot, person: t.person ?? undefined }) }));
    });

    root.querySelectorAll('[data-rate]').forEach((b) => b.onclick = () => {
      const [id, stars] = b.dataset.rate.split('|');
      commit((s) => ({ ...s, memory: rateRecipe(s.memory, id, Number(stars)) }));
    });

    // change, not input: a note is finished when you leave the field, and
    // re-rendering on every keystroke would move the cursor out from under you.
    root.querySelectorAll('[data-note]').forEach((el) => el.onchange = () => {
      commit((s) => ({ ...s, memory: noteRecipe(s.memory, el.dataset.note, el.value) }));
    });

    root.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
      const day = Number(b.dataset.day);
      const mode = b.dataset.mode;
      const s = store.state;
      if (s.settings.dayModes[day] === mode) return;
      const settings = { ...s.settings, dayModes: s.settings.dayModes.map((m, i) => (i === day ? mode : m)) };
      let plan = { ...s.plan, days: s.plan.days.map((d, i) => (i === day ? { ...d, mode } : d)) };
      // Only the lunch of that day depends on the mode, so only that is rebuilt.
      for (const p of settings.people) plan = regenerateSlot(plan, settings, s.memory, { day, slot: 'lunch', person: p.id });
      store.save({ ...s, settings, plan });
      render();
    });

    // `data-dismiss`, not `data-note`: the note textarea on a recipe card uses
    // `data-note` too, and binding a click handler to both meant clicking into
    // the field ran this, re-rendered, and replaced the field mid-click.
    root.querySelectorAll('[data-dismiss]').forEach((b) => b.onclick = () => {
      commit((s) => ({ ...s, [b.dataset.dismiss]: null }));
    });

    root.querySelectorAll('[data-bought]').forEach((cb) => cb.onchange = () => {
      const id = cb.dataset.bought;
      // The tick itself lives in `bought`, but un-ticking needs a note in memory as
      // well: the merge unions the ticks, so without one the other device's copy of
      // the tick comes straight back and the item drops off the list again.
      commit((s) => ({
        ...s,
        bought: { ...s.bought, [id]: cb.checked || undefined },
        memory: cb.checked ? remember(s.memory, 'bought', id) : forget(s.memory, 'bought', id),
      }));
    });

    // "I have this already": stored with the quantity the week needs, because
    // "some rice" and "1 kg of rice" shop differently.
    root.querySelectorAll('[data-have]').forEach((b) => b.onclick = () => {
      const [id, amount] = b.dataset.have.split('|');
      commit((s) => ({ ...s, memory: setPantry(s.memory, id, Number(amount)) }));
    });
    root.querySelectorAll('[data-pantry-del]').forEach((b) => b.onclick = () => {
      commit((s) => ({ ...s, memory: setPantry(s.memory, b.dataset.pantryDel, 0) }));
    });
    root.querySelectorAll('[data-item-shop]').forEach((sel) => sel.onchange = () => {
      const id = sel.dataset.itemShop;
      commit((s) => ({ ...s, itemShop: { ...s.itemShop, [id]: sel.value } }));
    });

    root.querySelectorAll('[data-person]').forEach((inp) => inp.onchange = () => {
      const i = Number(inp.dataset.person);
      const key = inp.dataset.key;
      const raw = inp.value;
      const numeric = ['weightKg', 'heightCm', 'age', 'activityFactor', 'goalWeightKg'].includes(key);
      const value = numeric ? Number(raw) : raw;
      if (numeric && !(value > 0)) { render(); return; }
      const s = store.state;
      const people = s.settings.people.map((p, pi) => (pi === i ? { ...p, [key]: value } : p));
      const settings = { ...s.settings, people };
      store.save({ ...s, settings, plan: generateWeek(settings, s.memory, s.plan) });
      render();
    });

    root.querySelectorAll('[data-maintain]').forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.maintain);
      const s = store.state;
      const people = s.settings.people.map((p, pi) => (pi === i ? { ...p, goal: 'maintain' } : p));
      applySettings({ ...s.settings, people });
    });

    root.querySelectorAll('[data-cookday]').forEach((b) => b.onclick = () => {
      const s = store.state;
      const i = Number(b.dataset.cookday);
      const days = new Set(cookSessions(s.settings));
      if (days.has(i)) days.delete(i); else days.add(i);
      // Zero sessions means zero food. Refuse rather than silently substitute.
      if (days.size === 0) return;
      applySettings({ ...s.settings, cookDays: [...days].sort((a, b) => a - b) });
    });

    root.querySelectorAll('[data-shop]').forEach((inp) => inp.onchange = () => {
      const i = Number(inp.dataset.shop);
      const name = inp.value.trim();
      if (!name) { render(); return; }
      commit((s) => ({
        ...s,
        settings: { ...s.settings, shops: s.settings.shops.map((sh, si) => (si === i ? { ...sh, name } : sh)) },
      }));
    });
    root.querySelectorAll('[data-shop-aisle]').forEach((b) => b.onclick = () => {
      const [idx, aisle] = b.dataset.shopAisle.split('|');
      const i = Number(idx);
      const s = store.state;
      const has = (s.settings.shops[i].aisles ?? []).includes(aisle);
      // One aisle, one shop: shopFor() takes the first match, so leaving an
      // aisle on two shops would make the second one dead configuration.
      const shops = s.settings.shops.map((sh, si) => ({
        ...sh,
        aisles: si === i
          ? (has ? sh.aisles.filter((a) => a !== aisle) : [...(sh.aisles ?? []), aisle])
          : (sh.aisles ?? []).filter((a) => a !== aisle),
      }));
      commit((s2) => ({ ...s2, settings: { ...s2.settings, shops } }));
    });
    root.querySelectorAll('[data-del-shop]').forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.delShop);
      const s = store.state;
      if (s.settings.shops.length < 2) return;
      const shops = s.settings.shops.filter((_, si) => si !== i);
      // The removed shop's per-item overrides would point at nothing, so drop them.
      const gone = s.settings.shops[i].id;
      const itemShop = Object.fromEntries(Object.entries(s.itemShop ?? {}).filter(([, v]) => v !== gone));
      commit((s2) => ({ ...s2, itemShop, settings: { ...s2.settings, shops } }));
    });

    root.querySelectorAll('[data-eatout]').forEach((sel) => sel.onchange = () => {
      const i = Number(sel.dataset.eatout);
      const s = store.state;
      const eatOut = s.settings.eatOut.map((o, oi) => (oi === i
        ? { ...o, [sel.dataset.field]: sel.dataset.field === 'day' ? Number(sel.value) : sel.value } : o));
      applySettings({ ...s.settings, eatOut });
    });
    root.querySelectorAll('[data-del-eatout]').forEach((b) => b.onclick = () => {
      const s = store.state;
      applySettings({ ...s.settings, eatOut: s.settings.eatOut.filter((_, i) => i !== Number(b.dataset.delEatout)) });
    });
    root.querySelectorAll('[data-unban]').forEach((b) => b.onclick = () => {
      const s = store.state;
      const memory = unbanRecipe(s.memory, b.dataset.unban);
      store.save({ ...s, memory, plan: generateWeek(s.settings, memory, s.plan) });
      render();
    });
    root.querySelectorAll('[data-del-weight]').forEach((b) => b.onclick = () => commit((s) => ({
      ...s, weights: s.weights.filter((w) => w.date !== b.dataset.delWeight),
    })));

    // The recipe form writes to a draft on every keystroke and does NOT
    // re-render: rebuilding the panel mid-sentence would throw away the other
    // fields and the caret with them.
    root.querySelectorAll('[data-draft]').forEach((el) => {
      const set = () => { draft = { ...draft, [el.dataset.draft]: el.value }; };
      el.oninput = set;
      el.onchange = set;
    });
    const box = root.querySelector('[data-import]');
    if (box) box.oninput = () => { importText = box.value; };
    const emailBox = root.querySelector('#account-email');
    if (emailBox) emailBox.oninput = () => { accountEmail = emailBox.value; };
    const codeBox = root.querySelector('#account-code');
    if (codeBox) codeBox.oninput = () => { accountCode = codeBox.value; };
    // Kept outside the DOM for the same reason as the sign-in boxes: render()
    // rebuilds this panel on every change, and a value only in the input is a
    // value that disappears when somebody else's sync lands mid-sentence.
    for (const [sel, set] of [
      ['#hh-name', (v) => { hhName = v; }],
      ['#hh-code', (v) => { hhCode = v; }],
      ['#hh-rename', (v) => { hhRename = v; }],
    ]) {
      const box = root.querySelector(sel);
      if (box) box.oninput = () => set(box.value);
    }

    root.querySelectorAll('[data-del-recipe]').forEach((b) => b.onclick = () => {
      const s = store.state;
      undoable('That recipe was removed from the library.', () => {
        store.save({ ...s, memory: removeCustomRecipe(s.memory, b.dataset.delRecipe) });
      });
    });

    const act = (name, fn) => root.querySelectorAll(`[data-act="${name}"]`).forEach((el) => {
      if (el.tagName === 'SELECT' || el.tagName === 'INPUT') el.onchange = () => fn(el);
      else el.onclick = () => fn(el);
    });

    // A new week is also the moment to learn: everything that survived the old
    // one was never swapped away and never banned, which is the strongest signal
    // the app gets without asking a question. Corrections do not carry over.
    act('reroll', () => {
      const s = store.state;
      const memory = recordKept(s.memory, s.plan);
      const settings = clearAdjust({ ...s.settings, seed: (s.settings.seed + 1) >>> 0 });
      store.save({ ...s, memory, settings, plan: generateWeek(settings, memory, s.plan) });
      open = new Set();
      rebalanceReport = null;
      render();
    });
    act('print', () => win?.print?.());

    act('install', async (el) => {
      // The event is single-use, so a double tap must not fire two prompts.
      el.disabled = true;
      await installer?.prompt();
      render();
    });

    act('reload-app', () => {
      // A new sw.js installs a worker that then waits for the old one to let go.
      // Without this nudge the reload is served by the old worker and lands on the
      // old app, which looks exactly like the button not working.
      win?.navigator?.serviceWorker?.controller?.postMessage?.('skip-waiting');
      win?.location?.reload?.();
    });

    root.querySelectorAll('[data-dismiss-install]').forEach((b) => b.onclick = () => {
      commit((s) => ({ ...s, ui: { ...s.ui, installHint: 'off' } }));
    });
    act('clear-bought', () => commit((s) => ({ ...s, bought: {} })));

    // Which days the shopping list covers. This is the only day row in the app
    // that is allowed to be empty: clearing it is a step on the way to picking
    // two days, not a nonsense state, and an empty list is a coherent answer.
    root.querySelectorAll('[data-shopday]').forEach((b) => b.onclick = () => {
      const picked = new Set(shoppingSlice(store.state.settings));
      const i = Number(b.dataset.shopday);
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      // commit, not applySettings: what you are shopping for says nothing about
      // what to eat, so this must never re-roll the week.
      commit((s) => ({
        ...s,
        settings: { ...s.settings, shoppingDays: [...picked].sort((a, b) => a - b) },
      }));
    });

    act('shopdays-all', () => {
      const full = shoppingSlice(store.state.settings).length === 7;
      commit((s) => ({
        ...s,
        settings: { ...s.settings, shoppingDays: full ? [] : [0, 1, 2, 3, 4, 5, 6] },
      }));
    });
    act('clear-pantry', () => {
      const s = store.state;
      undoable('The cupboard list was emptied.', () => store.save({ ...s, memory: clearPantry(s.memory) }));
    });

    act('rebalance', () => {
      const s = store.state;
      // Absorb into the days AFTER the last thing that went off plan: asking
      // Monday to pay for Saturday's pizza is not something anyone can do.
      let fromDay = 0;
      s.plan.days.forEach((d, i) => { if (dayHasOffPlan(d)) fromDay = i; });
      const { settings, report } = rebalanceWeek(s.plan, s.settings, { fromDay });
      rebalanceReport = report;
      undoable('The rest of the week was adjusted.', () => {
        store.save({ ...s, settings, plan: reflow(s.plan, settings) });
      });
    });
    act('clear-adjust', () => {
      const s = store.state;
      const settings = clearAdjust(s.settings);
      rebalanceReport = null;
      undoable('The corrections were cleared.', () => {
        store.save({ ...s, settings, plan: reflow(s.plan, settings) });
      });
    });

    act('style', (el) => {
      const s = store.state;
      applySettings({ ...s.settings, cookingStyle: el.value === 'batch' ? 'batch' : 'daily' });
    });
    act('season', (el) => {
      const s = store.state;
      applySettings({ ...s.settings, useSeason: el.value !== 'off' });
    });
    act('vegdays', (el) => {
      const s = store.state;
      const n = Number(el.value);
      applySettings({
        ...s.settings,
        vegetarianDays: Number.isInteger(n) && n >= 0 && n <= MAX_VEGETARIAN_DAYS ? n : 0,
      });
    });
    act('month', (el) => {
      const s = store.state;
      const m = Number(el.value);
      applySettings({ ...s.settings, month: m >= 1 && m <= 12 ? m : null });
    });
    act('weekstart', (el) => {
      const s = store.state;
      const weekStart = Number(el.value);
      const shift = weekShift(s.settings, weekStart);
      const settings = setWeekStart(s.settings, weekStart);
      if (settings === s.settings) return;
      // Anything locked was locked for a real day, so the old week is moved by the
      // same shift before it is offered back as the carry-over.
      applySettings(settings, rotatePlan(s.plan, shift));
    });
    act('football', (el) => {
      const s = store.state;
      const day = Number(el.value);
      const burn = s.settings.people[0].exerciseKcalByDay.find((k) => k > 0) ?? 600;
      const people = s.settings.people.map((p, i) => (i === 0
        ? { ...p, exerciseKcalByDay: DAYS.map((_, di) => (di === day ? burn : 0)) } : p));
      applySettings({ ...s.settings, footballDay: day, people });
    });
    act('burn', (el) => {
      const s = store.state;
      const burn = Math.max(0, Number(el.value) || 0);
      const people = s.settings.people.map((p, i) => (i === 0
        ? { ...p, exerciseKcalByDay: DAYS.map((_, di) => (di === s.settings.footballDay ? burn : 0)) } : p));
      applySettings({ ...s.settings, people });
    });
    act('add-eatout', () => {
      const s = store.state;
      applySettings({ ...s.settings, eatOut: [...s.settings.eatOut, { day: 5, slot: 'dinner' }] });
    });
    act('add-shop', () => {
      const s = store.state;
      const id = `shop${Date.now().toString(36)}`;
      commit((s2) => ({
        ...s2,
        settings: { ...s2.settings, shops: [...s.settings.shops, { id, name: 'New shop', aisles: [] }] },
      }));
    });

    act('save-recipe', () => {
      const s = store.state;
      const parsed = parseIngredientLines(draft.ingredients);
      const res = addCustomRecipe(s.memory, {
        name: draft.name,
        slot: draft.slot,
        cuisine: draft.cuisine,
        minutes: Number(draft.minutes),
        kcal: Number(draft.kcal),
        protein: Number(draft.protein),
        ingredients: parsed.items,
        method: draft.method,
      }, { amountsChecked: true, ingredientsRejected: parsed.rejected });
      // Both sets of complaints, together: a bad ingredient line and a missing
      // name are one fix each, not two round trips.
      draftErrors = [...parsed.errors.filter(() => true), ...res.errors];
      // Warnings survive a successful save on purpose: the form is cleared, so this
      // notice is the only chance to say "that 900 kcal snack looked like a pot".
      draftWarnings = [...parsed.warnings, ...(res.warnings ?? [])];
      if (res.ok && parsed.errors.length === 0) {
        draftErrors = [];
        draft = emptyDraft();
        store.save({ ...s, memory: res.memory });
      } else if (res.ok) {
        // Saved, but some ingredient lines were dropped — say which.
        draft = { ...draft };
        store.save({ ...s, memory: res.memory });
      }
      render();
    });
    act('clear-draft', () => { draft = emptyDraft(); draftErrors = []; draftWarnings = []; render(); });

    act('import-recipes', () => {
      const s = store.state;
      const res = importRecipes(s.memory, importText);
      importReport = { added: res.added, errors: res.errors, warnings: res.warnings };
      // The box is only emptied when the whole paste landed. If anything failed it
      // is the only copy of that text, and making someone retype eleven recipes
      // because the twelfth had a typo is not a trade worth making.
      if (res.added && !res.errors.length) importText = '';
      if (res.added) store.save({ ...s, memory: res.memory });
      render();
    });
    act('clear-import', () => { importText = ''; importReport = null; render(); });

    // Both of these report through remote's onChange, which is render(); the
    // catch is only so a thrown promise cannot become an unhandled rejection.
    act('account-signin', () => { Promise.resolve(remote?.signIn(accountEmail)).catch(() => {}); });
    act('account-verify', () => { Promise.resolve(remote?.verifyCode(accountCode)).catch(() => {}); });
    // Resending goes to the stored address, not to whatever is in the email box:
    // that box is not even on screen in this state, so reading it would send the
    // code somewhere the person never asked for.
    act('account-resend', () => { Promise.resolve(remote?.signIn(remote?.pendingEmail())).catch(() => {}); });
    act('account-cancel', () => { accountCode = ''; remote?.cancelSignIn(); });
    act('account-signout', () => { accountCode = ''; Promise.resolve(remote?.signOut()).catch(() => {}); });

    // The shared week. Both answers to the question write a bookmark and nothing
    // else: the push that follows is the ordinary one at the end of render().
    act('cloud-keep', () => {
      const ask = cloudAsk;
      if (!ask) return;
      cloudAsk = null;
      // `at: null` is "the row does not hold this phone's week yet", which is
      // exactly what makes the next render push it.
      cloudMark(ask.id, ask.rev, null);
      render();
    });
    act('cloud-take', () => {
      const ask = cloudAsk;
      if (!ask) return;
      cloudAsk = null;
      const s = store.state;
      // Through migrate(), because this document was written by a version of the
      // app that may not be this one, and `sync` is kept because a file link is
      // this phone's business and has nothing to do with whose week won.
      const taken = migrate({ ...ask.doc, sync: s.sync, cloud: s.cloud });
      store.save(
        { ...taken, cloud: { householdId: ask.id, rev: ask.rev, at: Number(taken.savedAt ?? 0) } },
        { touch: false },
      );
      render();
    });
    act('cloud-retry', () => { Promise.resolve(cloud?.flush?.()).then(render).catch(() => {}); });

    // The household. Everything that changes something goes through household(),
    // which is the single place a refusal is turned into a sentence on screen
    // rather than a button that looked like it worked.
    act('hh-retry', () => { hhError = null; Promise.resolve(loadHouseholds()).catch(() => {}); });
    // The creator takes the first seat in the plan and invites into the others.
    // Seats are per household, so her own household has her in seat one too.
    act('hh-create', () => household(
      () => houses?.create(hhName, store.state.settings.people[0].id),
      () => { hhName = ''; },
    ));
    act('hh-join', () => household(() => houses?.join(hhCode), () => { hhCode = ''; }));
    act('hh-invite', (el) => household(
      () => houses?.invite(el.dataset.id, el.dataset.seat),
      (r) => { hhFresh = { id: el.dataset.id, seat: el.dataset.seat, code: r.code }; },
    ));
    act('hh-revoke', (el) => household(() => houses?.revoke(el.dataset.code)));
    // Two presses rather than a confirm(), for the reason given above `reset`.
    act('hh-leave', (el) => { confirming = `hh-leave:${el.dataset.id}`; render(); });
    act('hh-leave-go', (el) => household(() => houses?.leave(el.dataset.id)));
    act('hh-delete', (el) => { confirming = `hh-delete:${el.dataset.id}`; render(); });
    act('hh-delete-go', (el) => household(() => houses?.remove(el.dataset.id)));
    act('hh-rename', (el) => {
      // Seeded with the current name so renaming is an edit, not a retype.
      hhRename = el.dataset.name ?? '';
      confirming = `hh-rename:${el.dataset.id}`;
      render();
    });
    act('hh-rename-go', (el) => household(
      () => houses?.rename(el.dataset.id, hhRename),
      () => { hhRename = ''; },
    ));
    act('hh-cancel', () => { confirming = null; hhRename = ''; render(); });
    act('hh-copy', (el) => {
      const code = el.dataset.code ?? '';
      const clip = win?.navigator?.clipboard;
      if (!clip?.writeText) return;
      Promise.resolve(clip.writeText(code))
        .then(() => { hhCopied = code; render(); })
        // A refused clipboard does not deserve a sentence: the code is on the
        // screen it was copied from, and reading it out was always the fallback.
        .catch(() => {});
    });

    act('sync-new', () => sync?.link({ create: true }));
    act('sync-open', () => sync?.link({ create: false }));
    act('sync-now', async () => {
      await sync?.pull();
      await sync?.push({ force: true });
      render();
    });
    act('sync-reconnect', () => sync?.reconnect());
    act('sync-unlink', () => sync?.unlink());

    act('log-weight', () => {
      const s = store.state;
      const date = root.querySelector('#w-date')?.value || today();
      const entry = { date };
      let any = false;
      for (const p of s.settings.people) {
        const v = Number(root.querySelector(`#w-${p.id}`)?.value);
        if (v > 0) { entry[p.id] = v; any = true; }
      }
      if (!any) return;
      // A new weigh-in is the best estimate of body weight, so the targets follow it.
      const people = s.settings.people.map((p) => (entry[p.id] ? { ...p, weightKg: entry[p.id] } : p));
      const settings = { ...s.settings, people };
      store.save({
        ...s, settings, weights: addWeight(s.weights, entry),
        plan: generateWeek(settings, s.memory, s.plan),
      });
      render();
    });
    act('export', () => {
      const blob = new win.Blob([store.exportJSON()], { type: 'application/json' });
      const a = root.ownerDocument.createElement('a');
      a.href = win.URL.createObjectURL(blob);
      a.download = `meal-planner-${today()}.json`;
      a.click();
      win.URL.revokeObjectURL(a.href);
    });
    act('import', () => root.querySelector('#importfile')?.click());
    // Two clicks in the page rather than a confirm(): a suppressed dialog would
    // make this button either do nothing or, worse, look like it did nothing.
    act('reset', () => { confirming = 'reset'; render(); });
    act('reset-cancel', () => { confirming = null; render(); });
    act('reset-go', () => {
      undoable('Everything was erased.', () => { store.reset(); regenerate(); });
      confirming = null;
      open = new Set();
      render();
    });
    act('undo', () => {
      const back = undo.state;
      undo = null;
      store.save(back);
      render();
    });

    const file = root.querySelector('#importfile');
    if (file) {
      file.onchange = async () => {
        const f = file.files?.[0];
        if (!f) return;
        try {
          store.importJSON(await f.text());
          if (!store.state.plan) regenerate();
        } catch (err) {
          win?.alert?.(`That file could not be read as planner data.\n\n${err.message}`);
        }
        render();
      };
    }
  }

  function applySettings(settings, previous = null) {
    const s = store.state;
    const plan = generateWeek(settings, s.memory, previous ?? s.plan);
    // The day-mode strip is rendered from the plan, so keep the two in step.
    plan.days.forEach((d, i) => { d.mode = settings.dayModes[i]; });
    store.save({ ...s, settings, plan });
    render();
  }

  // ------------------------------------------------- "I ate something else"
  /**
   * Log what was actually eaten.
   *
   * The presets exist because nobody weighs a döner. They are labelled as
   * estimates everywhere they appear, and logging one is deliberately cheaper
   * than one click on 🎲 — an unrecorded pizza is the thing that ends a plan,
   * not the pizza itself.
   */
  function openAte(target) {
    const s = store.state;
    const dlg = root.querySelector('#ate');
    ateTarget = target;
    const v = s.plan.days[target.day][target.slot];
    const shared = isEntry(v) || target.shared;
    const who = target.person
      ? s.settings.people.find((p) => p.id === target.person)?.name ?? target.person
      : 'both of you';

    dlg.innerHTML = `
      <div class="pad" style="border-bottom:1px solid var(--line)">
        <div class="btn-row"><h2 style="font-size:1rem">${dayLabel(s.plan, target.day)} · ${SLOT_FULL[target.slot] ?? SLOT_LABEL[target.slot]}</h2>
        <span class="spacer"></span><button class="btn ghost" data-close>Close</button></div>
        <p class="small muted" style="margin:.5rem 0 0">What did you actually eat? Logged for <b>${esc(who)}</b>${shared ? ' — this slot is one meal for the household' : ''}. Every figure is a rough estimate and is shown as one.</p>
      </div>
      <div style="max-height:55vh;overflow:auto">
        ${OFF_PLAN_PRESETS.map((p) => `<button class="swap-opt" data-preset="${esc(p.label)}|${p.kcal}">
          <span><b>${esc(p.label)}</b></span><span class="swap-num">≈ ${nf(p.kcal)} kcal</span></button>`).join('')}
      </div>
      <div class="pad stack" style="border-top:1px solid var(--line)">
        <div class="grid2">
          <label class="field"><span>Something else</span><input id="ate-label" placeholder="Curry from the Thai place"></label>
          <label class="field"><span>Roughly how many kcal</span><input type="number" id="ate-kcal" step="50" placeholder="700"></label>
        </div>
        <div class="btn-row"><button class="btn primary" data-custom>Log it</button></div>
      </div>`;

    const log = (label, kcal) => {
      const cur = store.state;
      undoable(`${label} logged for ${dayLabel(cur.plan, target.day)}.`, () => {
        store.save({
          ...cur,
          plan: logOffPlan(cur.plan, cur.settings, {
            day: target.day, slot: target.slot, person: target.person ?? null, kcal, label,
          }),
        });
      });
      dlg.close();
    };

    dlg.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => {
      const [label, kcal] = b.dataset.preset.split('|');
      log(label, Number(kcal));
    });
    dlg.querySelector('[data-custom]').onclick = () => {
      const kcal = Number(dlg.querySelector('#ate-kcal')?.value);
      const label = dlg.querySelector('#ate-label')?.value.trim() || 'Something off plan';
      if (!(kcal > 0)) return;   // a log with no number would be worse than none
      log(label, kcal);
    };
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // ------------------------------------------------------------ swap dialog
  function openSwap(target) {
    const s = store.state;
    const v = s.plan.days[target.day][target.slot];
    const entry = isEntry(v) ? v : v[target.person ?? Object.keys(v)[0]];
    const dlg = root.querySelector('#swap');
    swapTarget = target;

    if (entry.kind === 'canteen' || entry.kind === 'eat-out') {
      // No kitchen and no recipe — cycle the guidance instead.
      commit((s2) => ({ ...s2, plan: swapMeal(s2.plan, s2.settings, s2.memory, { day: target.day, slot: target.slot, person: target.person ?? undefined }) }));
      return;
    }

    const month = s.settings.useSeason === false ? null : planMonth(s.settings);
    // Best first, and your own recipes above everything.
    //
    // candidatesFor returns the library in file order, so a list cut to fourteen
    // used to be "the first fourteen the author happened to write" — and a recipe
    // you typed in yourself, appended at the end, could never be reached at all.
    const opts = candidatesFor(s.plan, s.settings, s.memory, {
      day: target.day, slot: target.slot, person: target.person ?? undefined,
    })
      .map((r) => ({
        r,
        mine: r.tags.includes('custom') ? 0 : 1,
        p: preferencePenalty(r, s.memory, { pantry: s.memory.pantry, ...(month ? { month } : {}) }),
      }))
      .sort((a, b) => a.mine - b.mine || a.p - b.p)
      // Twenty, not fourteen: the sheet is scrollable, and a cut that is tighter
      // than the library means recipes you own can never be offered.
      .slice(0, 20)
      .map((x) => x.r);

    dlg.innerHTML = `
      <div class="pad" style="border-bottom:1px solid var(--line)">
        <div class="btn-row"><h2 style="font-size:1rem">${dayLabel(s.plan, target.day)} · ${SLOT_FULL[target.slot]}</h2>
        <span class="spacer"></span><button class="btn ghost" data-close>Close</button></div>
        <p class="small muted" style="margin:.5rem 0 0">Replacing <b>${esc(recipeById(entry.recipeId)?.name ?? '')}</b>. Everything here fits the same slot and the same calorie budget.</p>
      </div>
      <div style="max-height:55vh;overflow:auto">
        ${opts.length === 0 ? '<p class="pad muted small">Nothing left for this slot — too much is banned. Un-ban something in Settings.</p>'
    : opts.map((r) => {
      const rating = s.memory.ratings?.[r.id];
      const season = month ? seasonNote(r, month) : null;
      return `<button class="swap-opt" data-pick="${esc(r.id)}">
            <span><b>${esc(r.name)}</b>${rating ? ` <span class="rated">${'★'.repeat(rating)}</span>` : ''}${r.tags.includes('custom') ? ' <span class="pill">yours</span>' : ''}<br>
            <span class="tiny faint">${r.minutes} min · ${esc(r.cuisine)}${r.tags.includes('leftover-ok') ? ' · keeps for lunch' : ''}${season && season.startsWith('Out of season') ? ' · out of season' : ''}</span></span>
            <span class="swap-num">${nf(r.kcal)} kcal<br>${nf(r.protein)} g</span></button>`;
    }).join('')}
      </div>
      <div class="pad btn-row" style="border-top:1px solid var(--line)">
        <button class="btn" data-random>🎲 Just pick one</button>
      </div>`;

    dlg.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { applySwap(b.dataset.pick); dlg.close(); });
    dlg.querySelector('[data-random]').onclick = () => {
      const s2 = store.state;
      const who = whoFor(s2.plan, target);
      // swapAndLearn, not swapMeal: replacing something without banning it is a
      // soft "not that", and it is the cheapest preference signal there is.
      const res = swapAndLearn(s2.plan, s2.settings, s2.memory, { day: target.day, slot: target.slot, person: who[0] });
      let plan = res.plan;
      // Keep a shared meal shared: whatever the first person got, the other gets.
      const picked = plan.days[target.day][target.slot][who[0]]?.recipeId;
      for (const pid of who.slice(1)) plan = forceRecipe(plan, s2, target, pid, picked);
      store.save({ ...s2, plan, memory: res.memory });
      render();
      dlg.close();
    };
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  /**
   * Put a specific recipe in a slot. The engine is handed the id by name, so
   * the leftover repair and the budget recalculation stay in one place, and a
   * pick from the bottom of a long shortlist arrives as surely as one from the
   * top. It used to re-run the swap until the choice came round, which stopped
   * being reliable the moment a slot had more candidates than the loop had goes.
   */
  function applySwap(recipeId) {
    const t = swapTarget;
    const s = store.state;
    const before = entryAt(s.plan, t)?.recipeId;
    let plan = s.plan;
    for (const pid of whoFor(s.plan, t)) plan = forceRecipe(plan, s, t, pid, recipeId);
    // One "not that" for the thing being replaced, recorded once rather than
    // per eater: a shared meal asks the engine twice and means it once.
    const memory = before && before !== recipeId ? recordSwapAway(s.memory, before) : s.memory;
    store.save({ ...s, plan, memory });
    render();
  }

  /** One shared line covers both of them, so the action has to cover both too. */
  function whoFor(plan, t) {
    if (t.shared) return Object.keys(plan.days[t.day][t.slot]);
    return [t.person ?? undefined];
  }

  function forceRecipe(plan, s, t, pid, recipeId) {
    return swapMeal(plan, s.settings, s.memory,
      { day: t.day, slot: t.slot, person: pid, recipeId });
  }

  // The syncer is built last: it calls render() on every change, so everything
  // it can touch has to exist first. restore() is deliberately quiet — a browser
  // will not re-grant file permission without a click, so a lapsed link shows a
  // Reconnect button instead of an error nobody asked for.
  sync = createSync({ win, store, onChange: render });
  Promise.resolve(sync.restore()).catch(() => {});
  // Writing was already automatic; reading was not, so a tab left open all day
  // pushed an ever-staler week over the top of hers. Now it reads back too.
  sync.watch();
  // A debounced write could still be in flight when the tab goes away.
  win?.addEventListener?.('pagehide', () => { sync?.flush?.(); cloud?.flush?.(); });

  // The account, built for the same reason as the syncer: it renders on every
  // change. completeFromUrl() is the one thing that has to happen on boot -- a
  // link from an email arrives as a page load with tokens in the fragment, and
  // nothing else is listening for them. With no fragment and no stored session
  // it returns without touching the network, which is what keeps a cold boot
  // offline-clean.
  remote = createRemote({ win, onChange: render });
  // The households client is the account with a different question asked of it:
  // it holds no state, so it is built here rather than lazily, and it shares the
  // window's fetch so a test that fakes one fakes both.
  houses = createHouseholds({ remote, fetch: win?.fetch ? win.fetch.bind(win) : globalThis.fetch });
  // And the shared week on top of both: it needs the account for a token and
  // the household list for a row to write to, and it is harmless until it has
  // them -- cloudTick() returns on the first line without a bookmark.
  cloud = createCloud({
    remote,
    fetch: win?.fetch ? win.fetch.bind(win) : globalThis.fetch,
    setTimer: (fn, ms) => win?.setTimeout?.(fn, ms),
    clearTimer: (id) => win?.clearTimeout?.(id),
  });
  Promise.resolve(remote.completeFromUrl()).catch(() => {});

  render();
  return { render, store, sync, remote, get state() { return store.state; } };
}
