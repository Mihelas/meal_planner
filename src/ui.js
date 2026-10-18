// The look of the thing: stylesheet and the static shell.
//
// Kept as strings in a module so `tools/build.mjs` can inline it into one
// double-clickable HTML file, and so the CSS sits next to the markup that uses it.
//
// Three constraints shaped this:
//   - She will open it on a phone in the supermarket -> mobile first, big tap targets.
//   - It gets printed and stuck on the fridge -> a real print stylesheet.
//   - It runs from file:// with no internet -> system fonts, no CDN, no icon font.

export const CSS = `
*, *::before, *::after { box-sizing: border-box; }
:root {
  --bg: #11131a;
  --card: #1a1d27;
  --card-2: #212533;
  --line: #2c3142;
  --ink: #e8eaf2;
  --ink-dim: #9aa1b8;
  --ink-faint: #6b7288;
  --accent: #6ee7a8;
  --accent-ink: #06281a;
  --warn: #f5b971;
  --bad: #f07f7f;
  --him: #7cc4ff;
  --her: #f0a3d0;
  --radius: 14px;
  --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.25);
  color-scheme: dark;
}
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  /* The viewport is set to cover the display, so the page owns the whole screen --
     including the strip the home indicator sits on, where iOS eats the tap. */
  padding-bottom: calc(4rem + env(safe-area-inset-bottom, 0px));
}
h1, h2, h3 { line-height: 1.25; margin: 0; font-weight: 650; letter-spacing: -.01em; }
a { color: var(--accent); }
button { font: inherit; color: inherit; cursor: pointer; }

/* ---------------- layout ---------------- */
.wrap {
  max-width: 1180px; margin: 0 auto;
  /* max(), not +: on a phone held upright both insets are 0 and this is the 1rem
     it always was; turned on its side the notch takes a bite out of one edge. */
  padding-left: max(1rem, env(safe-area-inset-left, 0px));
  padding-right: max(1rem, env(safe-area-inset-right, 0px));
}
header.top {
  position: sticky; top: 0; z-index: 20;
  background: rgba(17,19,26,.92); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
  /* Pushes the brand clear of the notch, and -- because the background is on this
     element rather than the row inside it -- keeps the blur running up behind it
     instead of leaving a clear band at the top of the screen. */
  padding-top: env(safe-area-inset-top, 0px);
}
.top-row { display: flex; align-items: center; gap: .75rem; padding: .7rem 0; flex-wrap: wrap; }
.brand { font-size: 1.05rem; font-weight: 700; }
.brand small { display: block; font-weight: 400; font-size: .72rem; color: var(--ink-faint); letter-spacing: .02em; }
.spacer { flex: 1 1 auto; }
nav.tabs { display: flex; gap: .3rem; overflow-x: auto; padding-bottom: .55rem; scrollbar-width: none; }
nav.tabs::-webkit-scrollbar { display: none; }
nav.tabs button {
  flex: 0 0 auto; background: transparent; border: 1px solid transparent;
  padding: .42rem .8rem; border-radius: 999px; color: var(--ink-dim); font-size: .88rem; white-space: nowrap;
  display: inline-flex; align-items: center; min-height: 44px;
}
nav.tabs button:hover { color: var(--ink); background: var(--card-2); }
nav.tabs button[aria-selected="true"] { background: var(--accent); color: var(--accent-ink); font-weight: 650; }
/* On a phone the tabs wrap instead of scrolling: a hidden scrollbar hides the
   fact that Settings exists at all. */
@media (max-width: 700px) {
  nav.tabs { flex-wrap: wrap; overflow-x: visible; }
  nav.tabs button { font-size: .84rem; padding: .45rem .7rem; }
}

main { padding-top: 1.1rem; }
.panel { display: none; }
.panel.active { display: block; }

/* ---------------- generic bits ---------------- */
.btn {
  background: var(--card-2); border: 1px solid var(--line); color: var(--ink);
  border-radius: 10px; padding: .5rem .85rem; font-size: .88rem;
  /* 44px is Apple's floor and about where mis-taps stop. inline-flex rather than
     inline-block because a min-height on its own leaves the label pinned to the
     top of the taller box. */
  display: inline-flex; align-items: center; justify-content: center; gap: .35rem;
  min-height: 44px;
}
.btn:hover { border-color: var(--ink-faint); }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; font-weight: 650; }
.btn.ghost { background: transparent; }
.btn.danger { color: var(--bad); }
.btn.danger:not(.ghost) { background: var(--bad); color: #1a1416; border-color: transparent; font-weight: 650; }
/* Small is about how much room the label takes, not how hard it is to hit: the
   padding comes off, the 44px does not. Most of these are one-glyph buttons on a
   meal row -- swap, lock, ban -- which is exactly what a thumb goes for, so they
   get a width floor too. */
.btn.small { padding: .25rem .55rem; font-size: .78rem; min-width: 44px; }
.btn-row { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
.muted { color: var(--ink-dim); }
.faint { color: var(--ink-faint); }
.small { font-size: .82rem; }
.tiny { font-size: .74rem; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
.pad { padding: 1rem; }
.stack > * + * { margin-top: .9rem; }
.notice { border-left: 3px solid var(--warn); background: var(--card-2); padding: .7rem .9rem; border-radius: 8px; font-size: .88rem; }
.notice.bad { border-left-color: var(--bad); }
.notice.good { border-left-color: var(--accent); }
/* Pipe-delimited lines only line up if the font does. The second selector is there
   because .field textarea sets font: inherit, which would win on specificity. */
.mono, .field textarea.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; }
.example { background: var(--card-2); border: 1px solid var(--line); border-radius: 8px; padding: .6rem .8rem; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .72rem; line-height: 1.5; color: var(--ink-dim); overflow-x: auto; }
.pill { display: inline-block; padding: .1rem .48rem; border-radius: 999px; background: var(--card-2); font-size: .7rem; color: var(--ink-dim); border: 1px solid var(--line); }
.pill.him { color: var(--him); } .pill.her { color: var(--her); }

/* ---------------- week grid ---------------- */
.week { display: grid; gap: .9rem; grid-template-columns: 1fr; }
@media (min-width: 900px) { .week { grid-template-columns: repeat(2, minmax(0,1fr)); } }
@media (min-width: 1300px) { .week { grid-template-columns: repeat(3, minmax(0,1fr)); } }

.day { display: flex; flex-direction: column; }
.day > header { padding: .8rem 1rem .6rem; border-bottom: 1px solid var(--line); }
.day-title { display: flex; align-items: baseline; gap: .5rem; }
.day-title h2 { font-size: 1rem; }
.day.is-football .day-title h2::after { content: " ⚽"; }
.modes { display: flex; gap: .25rem; margin-top: .55rem; }
.modes button {
  flex: 1 1 0; background: transparent; border: 1px solid var(--line); color: var(--ink-dim);
  border-radius: 8px; padding: .34rem .2rem; font-size: .72rem; min-height: 44px;
}
.modes button[aria-pressed="true"] { background: var(--card-2); color: var(--ink); border-color: var(--ink-faint); font-weight: 650; }

.totals { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; padding: .6rem 1rem; border-bottom: 1px solid var(--line); }
.tot-name { font-size: .72rem; letter-spacing: .04em; text-transform: uppercase; }
.tot-name.him { color: var(--him); } .tot-name.her { color: var(--her); }
.tot-val { font-size: .86rem; font-variant-numeric: tabular-nums; }
.bar { height: 5px; border-radius: 3px; background: var(--card-2); overflow: hidden; margin-top: .3rem; }
.bar > i { display: block; height: 100%; background: var(--accent); }
.bar.over > i { background: var(--warn); }
.bar.him > i { background: var(--him); } .bar.her > i { background: var(--her); }

.slots { list-style: none; margin: 0; padding: .25rem .4rem .5rem; }
.slot { border-radius: 10px; padding: .45rem .6rem; }
.slot + .slot { margin-top: .1rem; }
.slot:hover { background: var(--card-2); }
.slot-head { display: flex; align-items: flex-start; gap: .5rem; }
.slot-label { flex: 0 0 3.1rem; font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); padding-top: .2rem; }
.slot-body { flex: 1 1 auto; min-width: 0; }
.slot-name {
  background: none; border: 0; padding: 0; text-align: left;
  font-size: .92rem; font-weight: 550; line-height: 1.35;
  /* The biggest target on the row and it was 20px tall. A name that wraps is
     already taller than this; a short one now reaches down to meet the thumb. */
  display: flex; align-items: center; min-height: 44px;
}
.slot-name:hover { color: var(--accent); }
.slot-meta { font-size: .72rem; color: var(--ink-faint); margin-top: .12rem; display: flex; flex-wrap: wrap; gap: .45rem; }
.slot-acts { flex: 0 0 auto; display: flex; gap: .1rem; }
.slot-acts button {
  background: transparent; border: 0; border-radius: 8px; width: 2rem; height: 2rem;
  font-size: .95rem; opacity: .45; line-height: 1;
  position: relative;
}
/* Painted 32px, hit at 44.
   Four of these plus a label plus a legible meal name is already everything a
   360px phone has across, so the squares cannot grow sideways -- but nothing is
   listening in the padding above and below the row, so the hit area reaches into
   it. Vertical only on purpose: widening them would have each one covering its
   neighbour's icon, which is worse than a small target. */
.slot-acts button::after {
  content: ''; position: absolute; left: 0; right: 0; top: 50%;
  height: 44px; transform: translateY(-50%);
}
.slot-acts button:hover { opacity: 1; background: var(--card); }
.slot.locked { background: rgba(110,231,168,.06); }
.slot.locked .slot-acts button.lock { opacity: 1; }
.slot.guidance .slot-name { font-weight: 500; color: var(--ink-dim); font-style: italic; }
.note { font-size: .78rem; color: var(--ink-dim); margin-top: .4rem; padding: .5rem .6rem; background: var(--card-2); border-radius: 8px; }
.leftover-tag { color: var(--accent); }

.detail { margin-top: .55rem; padding: .7rem; background: var(--card-2); border-radius: 10px; font-size: .84rem; }
.detail h4 { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); margin: 0 0 .35rem; }
.detail ul, .detail ol { margin: 0 0 .7rem; padding-left: 1.1rem; }
.detail li { margin-bottom: .18rem; }
.detail .cook-note { color: var(--accent); font-weight: 600; }

/* ---------------- lists / tables ---------------- */
table { width: 100%; border-collapse: collapse; font-size: .88rem; }
th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid var(--line); }
th { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-faint); font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

.shop-group { margin-bottom: 1.1rem; }
.shop-group h3 { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); margin-bottom: .4rem; }
.shop-item { display: flex; align-items: center; gap: .65rem; padding: .48rem .3rem; border-bottom: 1px solid var(--line); }
.shop-item input { width: 1.15rem; height: 1.15rem; accent-color: var(--accent); flex: 0 0 auto; }
.shop-item .qty { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--ink-dim); font-size: .85rem; white-space: nowrap; }
.shop-item.done label { text-decoration: line-through; color: var(--ink-faint); }
.shop-item label { flex: 1 1 auto; cursor: pointer; }

.grid2 { display: grid; gap: .9rem; grid-template-columns: 1fr; }
@media (min-width: 760px) { .grid2 { grid-template-columns: 1fr 1fr; } }
.field { display: block; margin-bottom: .7rem; }
.field span { display: block; font-size: .74rem; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-faint); margin-bottom: .22rem; }
.field input, .field select {
  width: 100%; background: var(--bg); color: var(--ink); border: 1px solid var(--line);
  border-radius: 9px; padding: .5rem .6rem; font: inherit;
}
.kv { display: flex; justify-content: space-between; gap: 1rem; padding: .35rem 0; border-bottom: 1px solid var(--line); font-size: .88rem; }
.kv b { font-variant-numeric: tabular-nums; }

.spark { display: block; width: 100%; height: 70px; }

dialog {
  border: 1px solid var(--line); background: var(--card); color: var(--ink);
  border-radius: var(--radius); padding: 0; max-width: 34rem; width: calc(100% - 2rem);
  box-shadow: var(--shadow);
}
dialog::backdrop { background: rgba(0,0,0,.6); }
.swap-opt { display: flex; gap: .7rem; align-items: center; width: 100%; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--line); padding: .65rem .9rem; }
.swap-opt:hover { background: var(--card-2); }
.swap-opt .swap-num { margin-left: auto; text-align: right; font-size: .74rem; color: var(--ink-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ---------------- v2 surfaces ---------------- */
.grow { flex: 1 1 auto; min-width: 0; }

/* Planned vs actual. Amber down the side: it is a warning, not a failure. */
.ledger { border-left: 3px solid var(--warn); }
.ledger ul { list-style: none; margin: 0; padding: 0; }
.ledger li + li { margin-top: .3rem; }
.adj { color: var(--warn); }

/* A logged meal reads as a fact about the past, so it is dimmed, not alarming. */
.slot.is-offplan { background: rgba(240,180,90,.06); }
.slot.is-offplan .slot-name { font-weight: 500; }
.off-tag { color: var(--warn); }
.rated { color: var(--warn); letter-spacing: -.04em; }
.note-flag { color: var(--accent); }

.note-shown { margin: 0 0 .6rem; padding: .45rem .6rem; background: var(--bg); border-left: 2px solid var(--accent); border-radius: 6px; font-size: .8rem; color: var(--ink-dim); }
.season-note { margin: -.3rem 0 .7rem; font-size: .76rem; color: var(--ink-faint); }

.likes { margin-top: .6rem; padding-top: .6rem; border-top: 1px solid var(--line); }
.stars { display: flex; align-items: center; gap: .1rem; margin-bottom: .5rem; }
/* 18px glyphs, so the padding does the work: the stars look the same and the
   row they sit in is 44px tall, which is all a thumb needs. */
.stars button {
  background: none; border: 0; padding: 0 .35rem; font-size: 1.1rem; line-height: 1;
  color: var(--ink-faint); opacity: .5;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 44px; min-height: 44px;
}
.stars button[aria-pressed="true"] { color: var(--warn); opacity: 1; }
.stars button:hover { opacity: 1; }
.stars .tiny { margin-left: .5rem; }
.field textarea {
  width: 100%; background: var(--bg); color: var(--ink); border: 1px solid var(--line);
  border-radius: 9px; padding: .5rem .6rem; font: inherit; resize: vertical;
}

/* Shopping: one block per shop, aisles inside it. */
.shop-block + .shop-block { margin-top: .9rem; }
.shop-group h4 { font-size: .74rem; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); margin: 0 0 .3rem; }
.shop-item.short { border-bottom-color: var(--warn); }
.shop-item .ico { background: none; border: 0; padding: .1rem .3rem; border-radius: 7px; opacity: .45; font-size: .9rem; flex: 0 0 auto; }
.shop-item .ico:hover { opacity: 1; background: var(--card-2); }
.shop-item .ico-flat { flex: 0 0 1.15rem; text-align: center; color: var(--ink-faint); }
.shop-item.short .ico-flat { color: var(--warn); }
.shop-item .shop-pick { flex: 0 0 auto; background: var(--bg); color: var(--ink-dim); border: 1px solid var(--line); border-radius: 7px; padding: .1rem .25rem; font-size: .72rem; max-width: 8rem; }

.chips { display: flex; flex-wrap: wrap; gap: .3rem; }
.chip { background: var(--card-2); border: 1px solid var(--line); color: var(--ink-dim); border-radius: 999px; padding: .2rem .55rem; font-size: .74rem; }
.chip:hover { border-color: var(--ink-faint); color: var(--ink); }
.chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: transparent; font-weight: 600; }
.shop-edit { border: 1px solid var(--line); border-radius: 10px; padding: .7rem; }
.shop-edit + .shop-edit { margin-top: .6rem; }
.shop-edit .btn-row { margin-bottom: .5rem; }
.shop-edit input { background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 9px; padding: .4rem .55rem; font: inherit; }

/* ---------------- print: the fridge copy ----------------
   The printed sheet is its own markup, always in the page and hidden on screen.
   Printing the visible app instead would mean the paper depended on which tab
   happened to be open — and would print a calorie bar chart nobody can read in
   a kitchen. Two pages by design: the week to stick on the fridge, the shopping
   list on the back to take to the shop.                                       */
@page { size: A4 portrait; margin: 12mm 11mm; }

#sheet { display: none; }

@media print {
  body { background: #fff; color: #000; padding: 0; font: 9pt/1.35 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  header.top, main, dialog, .no-print { display: none !important; }
  #sheet { display: block !important; }
  a { color: #000; text-decoration: none; }
}

#sheet h1 { font-size: 13pt; }
#sheet h2 { font-size: 10.5pt; }
#sheet .sheet-head { display: flex; align-items: baseline; gap: 6pt; border-bottom: 1.2pt solid #000; padding-bottom: 3pt; margin-bottom: 6pt; }
#sheet .sheet-head .grow { flex: 1 1 auto; }
#sheet .sheet-sub { font-size: 7.5pt; color: #444; }
#sheet table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
#sheet table.grid th, #sheet table.grid td { border: .4pt solid #9aa0ad; padding: 2.4pt 3pt; vertical-align: top; text-align: left; }
#sheet table.grid thead th { background: #edeef1; font-size: 6.8pt; text-transform: uppercase; letter-spacing: .05em; }
#sheet table.grid col.c-day { width: 13%; }
#sheet table.grid tr { break-inside: avoid; }
#sheet .d-name { font-size: 8.5pt; font-weight: 700; }
#sheet .d-sub { font-size: 6.6pt; color: #555; }
#sheet .m { font-size: 7.4pt; }
#sheet .m-name { display: block; font-weight: 600; }
#sheet .m-sub { color: #555; font-size: 6.6pt; }
#sheet .m + .m { margin-top: 2pt; padding-top: 2pt; border-top: .3pt dotted #b9bec9; }
#sheet .sheet-notes { margin-top: 5pt; font-size: 7.2pt; color: #333; }
#sheet .sheet-notes li { margin-bottom: 1pt; }
#sheet .page2 { break-before: page; padding-top: 2pt; }
#sheet .cols { columns: 2; column-gap: 9mm; }
#sheet .block { break-inside: avoid; margin-bottom: 6pt; }
#sheet .shop-name { font-size: 9.5pt; font-weight: 700; border-bottom: .8pt solid #000; padding-bottom: 1pt; margin-bottom: 2pt; }
#sheet .aisle-name { font-size: 6.8pt; text-transform: uppercase; letter-spacing: .06em; color: #444; margin: 3pt 0 1pt; }
#sheet ul.buy { list-style: none; margin: 0; padding: 0; }
#sheet ul.buy li { display: flex; align-items: baseline; gap: 3pt; font-size: 7.6pt; padding: .6pt 0; }
#sheet ul.buy li .q { margin-left: auto; color: #333; font-variant-numeric: tabular-nums; white-space: nowrap; }
#sheet ul.buy li.done { color: #8a8f99; text-decoration: line-through; }
#sheet .box { flex: 0 0 auto; display: inline-block; width: 7.5pt; height: 7.5pt; border: .5pt solid #444; border-radius: 1pt; }
#sheet .sheet-foot { margin-top: 6pt; border-top: .4pt solid #9aa0ad; padding-top: 3pt; font-size: 6.8pt; color: #555; }
`;

export const HTML_HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>Meal Planner</title>
__HEAD__<style>__CSS__</style>
</head>
<body>
<div id="app"></div>
<script>__JS__</script>
</body>
</html>
`;

/** The one place that decides how a slot is named in the UI. */
export const SLOT_LABEL = {
  breakfast: 'Break', lunch: 'Lunch', dinner: 'Dinner',
  snackAfternoon: 'Snack', snackEvening: 'Night',
};

export const SLOT_FULL = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
  snackAfternoon: 'Afternoon snack', snackEvening: 'Evening snack',
};

export const MODE_SHORT = { wfh: 'Home', office: 'Office', together: 'Both home' };
