# Meal Planner

A weekly meal plan for two people with different calorie targets, built around one
constraint: **30 minutes of cooking on a weekday**. Dinner is cooked big and
tomorrow's lunch comes out of the same pot, which is the part that stops the week
collapsing into pizza and bread and cheese.

The deliverable is a single file — `dist/meal-planner.html`. Double-click it. No
server, no internet, no install. It remembers everything in the browser it was
opened in.

## Using it

| Button | What it does |
| --- | --- |
| 🔄 | Swap that meal. Pick from a shortlist that fits the same slot and calorie budget, or let it choose. Your own recipes come first. |
| 👎 | Never again. Gone from this week and every future week. Un-ban in Settings. |
| 🔒 | Keep this one when you press **New week**. |
| 📝 | **I ate something else.** Log what actually happened — a preset or your own number. |
| ★★★★★ | Rate it 1–5. Good scores come back more often, bad ones fade out. |
| 🏠 | Already in the cupboard. Takes it off the shopping list and favours recipes that use it. |
| Home / Office / Both home | Per day. Office gives a canteen card instead of a recipe, because there is no kitchen at work. |

Tabs: the week, a shopping list split by shop and then aisle, jobs worth doing on
Sunday, your own recipes, a weight log, **Why this plan** — every number with its
derivation, including what it has learned about your taste — and Settings.

**Printing** gives two A4 pages: the week, then the shopping list. It does not depend
on which tab is open.

### When the week goes sideways
Log it with 📝 and the app shows what it cost — in kcal and in kg of the loss — then
offers to **spread it over the rest of the week**. Corrections are capped at 250
kcal/day and it will leave a residual uncorrected rather than prescribe a crash day.

### Cooking style
**Cook fresh daily** or **batch cook** — two cook-ups a week, the rest reheated. Cook
days are yours to move in Settings, as long as at least one is left.

### Sharing a plan between two people
Settings → **Sharing**. Link both browsers to the same JSON file in a shared folder
(Dropbox, OneDrive, a synced drive) and the app merges rather than overwrites.

The week merges **meal by meal**: she swaps Tuesday's dinner while you log a pizza on
Thursday and both survive, because every plate carries the time it was last changed and
the later change wins on that plate alone. Bans, ticks, ratings, notes, your own
recipes, weigh-ins and the cupboard merge too, and a **deletion sticks** — un-banning a
recipe or un-ticking an item is recorded as a removal rather than quietly re-added from
the other copy. Settings are last-write-wins. If one of you re-rolls the whole week it
is no longer the same week, so the newer one replaces the other and the app says so.

Each side re-reads the file before writing it, and reads it again when you come back to
the tab or every minute while it is open — so neither of you has to press anything.

Needs Chrome or Edge. Everywhere else, Export/Import does the same job by hand. A
shared file that cannot be read or parsed is **never written over**.

**Export your data** (Settings) before switching browser or clearing site data.
Nothing is uploaded anywhere — the sync file is a file on your own disk.

## Working on it

```
npm test      # 448 tests, no browser needed
npm run build # src/*.js -> dist/meal-planner.html (355 kB, 10 modules inlined)
npm run serve # http://localhost:4173, for poking at it
```

- `src/targets.js` — BMR, deficits, protein floors, portion ratio, maintenance mode. No
  food in here.
- `src/recipes.js` — the library: 181 recipes (18 breakfast · 42 lunch · 89 dinner · 32
  snack). Calories and quantities are **per portion, where one portion is the bigger
  person's slot budget**; the other person eats ~0.68×.
- `src/seasons.js` — what is in season in Germany each month; pushes out-of-season
  produce down the list and flags it on the meal.
- `src/planner.js` — builds a week: day modes, leftover chaining, batch weeks, football
  day, meals out.
- `src/swap.js` — swap, ban, lock, off-plan logging, ratings and notes, the learned
  preference score, and the leftover repair that a dinner swap triggers.
- `src/shopping.js` — list by shop then aisle, pack rounding, the cupboard, prep jobs.
- `src/store.js` — localStorage with defensive migration, export/import, weight log,
  your own recipes.
- `src/sync.js` — the shared-file link. Transport (File System Access API + a handle in
  IndexedDB) is separate from `mergeStates`, which is pure and knows nothing about files.
- `src/ui.js` / `src/app.js` — stylesheet and shell / all the DOM.
- `tools/build.mjs` — inlines the modules into one file (`file://` blocks ES imports).

`tests/app.test.mjs` and `tests/app-v2.test.mjs` drive the **built artefact** in jsdom,
so the thing that gets tested is the thing that gets delivered. `tests/harness.mjs` is
their shared jsdom setup and is deliberately not named `*.test.mjs`, so the runner
ignores it.

Run the suite with bare `node --test` from the project root — passing it a directory
finds nothing on this setup.

Nutrition numbers are formula estimates, not measurements, and this is not medical
advice. Off-plan meals you log are guesses stacked on those estimates. After three
weeks the weight log is the better authority than the formula.
