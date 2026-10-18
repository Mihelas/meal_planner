# v5 — the approved batch: 57 recipes + 2 features

Selection reasoning lives in [todo-v4.md](todo-v4.md). This file tracks the build.

## Scope as approved

| group | n | slot | note |
|---|---|---|---|
| the 20 picks | 20 | 9 dinner, 5 lunch, 2 snack, 4 lamb | lamb 18–20 get `weekend` |
| chicken and pork skewers | 6 | dinner | in despite colliding with pick 9 / pick 1 |
| crumbed white fish | 4 | dinner | |
| cream-sauce chicken | 4 | dinner | |
| prawns — **mussels dish rebuilt with prawns** | 5 | dinner | 401 loses the mussels |
| wraps | 3 | lunch | |
| salads and sandwiches | 4 | lunch | |
| more fish dinners | 3 | dinner | |
| beans, beef, pasta | 3 | dinner | |
| Greek classics | 5 | 1 dinner, 4 lunch | spanakorizo, fasolada, soutzoukakia, fakés, pumpkin |
| **total** | **57** | | library 124 → **181** |

Dropped from the 49 as not requested: tinned tuna ×4, curry and chilli ×5,
fish soup ×3, egg whites ×3, sweets ×2 — 17 left out. No liver.

### Greek classics — which source recipe each is built from

| dish | source | src kcal / P | min | slot and why |
|---|---|---|---|---|
| Spanakorizo | pressure-cooker (7595), cross-checked against the canonical 5261 (4.8★/1,259) | 423 / 12 | 25 | lunch — feta and an egg carry the protein, which is how it is actually eaten |
| Fasoláda | 3098, **4.8★ from 2,272** | 344 / 17 | 110 | lunch, `weekend`; pressure cooker cuts the time |
| Soutzoukákia | 2534, **4.8★ from 2,644** | 487 / 24 | 35 | dinner — air fryer for the meatballs brings it to 30 |
| Fakés (lentil soup) | 3120, **4.9★ from 2,594** | 312 / 17 | 55 | lunch, pressure cooker |
| Pumpkin soup | 903 hearty pumpkin and red bean, 5.0★/45 | 305 / 26 | 45 | lunch — the only pumpkin soup on the site with real protein; plain pumpkin soup is 53 kcal |

## Increments

### 1 — two app features
- [x] Explore the day-ordering and shopping-export surfaces
- [x] Tests first: week-start rotation (15 tests), day-filtered shopping list (16 tests)
- [x] **A.** Choose the day the week starts on — must keep the weekday/weekend
      distinction, the 30-minute weekday cap and the Friday football logic correct
      when the week no longer begins on Monday
- [x] **B.** Pick which days go into the shopping-list export, with select/deselect all
- [x] Rebuild, verify both in the browser - 494/494 tests, 415 kB build, both features driven in the browser with zero console errors

**Result.** Both features are positional, so nothing else in the app had to learn
they exist.

- **A.** `weekStart` is the one setting that names a real weekday. `setWeekStart`
  rotates every position-keyed setting (day modes, corrections, exercise burn,
  football, cook-ups, shopping days, meals out) so each real day keeps its own
  facts, and `rotatePlan` moves the carried-over plan by the same shift so a
  locked Saturday roast cannot land on a Tuesday. `slotCandidates` now asks the
  calendar, not the column, which is what keeps the 30-minute cap, the `weekend`
  tag and the Friday football rule correct.
- Found and fixed while testing: three settings rows (cook-up days, football,
  meals out) are keyed by position but were labelled `DAYS[i]`, so they read in
  Monday order whatever the week start was. Now labelled with `dayName`. The
  week-start picker itself still names real weekdays, deliberately.
- **B.** `shoppingDays` + `shoppingSlice` + `planForDays`, threaded through
  `shoppingList`, `shoppingByShop`, `shoppingItems`, `pantryCheck`,
  `pantrySaving`, the shopping tab and the printable sheet. The honest rule: a
  reheat is not a thing you buy, so a portion only counts when the day it was
  cooked is in the slice too - otherwise a Monday-only list would ask for a whole
  Sunday roast.
- An empty selection is allowed here (the only day row in the app that may be
  empty), because clearing the row is how you get to picking two days. One button
  does both jobs, reading "Select all" or "Clear all".
- Caught by the tests: `act` is a `const` declared below where I first registered
  `shopdays-all`, which threw a temporal-dead-zone error and broke the whole
  render. Every DOM test failed at once, which is how it surfaced.

### 2 — 25 collision dinners
- [x] 6 skewers, 4 crumbed fish, 4 cream-sauce chicken, 5 prawn, 3 fish, 3 beans/beef/pasta

### 3 — 7 collision lunches
- [x] 3 wraps, 4 salads and sandwiches — every one needs `packable` or `no-cook`

### 4 — the 20 picks
- [x] 9 dinners, 5 lunches, 2 snacks, 4 lamb (3 of them `weekend`)

### 5 — 5 Greek classics
- [x] 1 dinner, 4 lunch

### 6 — close out
- [x] Every new `produce` item added to `SEASON` or `NO_GERMAN_SEASON`
      (known new: Thymian, Minze, Orange, plus whatever the conversions add)
- [x] Full suite green, including the zero-errors-**and**-zero-warnings guard
      - 463 tests, 463 pass, 0 fail after the re-cost.
- [x] Independent validator: re-read the source worksheet and check every record's
      macros against the quantities actually listed — not with the conversion code
      - `scratchpad/validate_v5.py` parses `src/recipes.js` with its own reader and
        recomputes every macro from a second nutrition table written blind. First
        run: **14 discrepancies**, traced to 6 ingredients where the two tables
        disagreed. Each settled against German own-brand labels
        (`scratchpad/reconcile.py` records the figure and the reason), then re-costed:
        32 of the 57 records moved. The worst was light coconut milk booked at the
        full-fat figure, +107 kcal/100 ml, about 100 kcal on two prawn dishes.
      - Second run: **0 problems**, mean kcal gap 4.6 (0.8 %), mean protein gap 0.6 g.
        Still independent after the reconciliation: the JS parsing, the arithmetic
        and the gate checks. Only the per-100 g figures are shared now, and they are
        shared because they were argued out rather than copied.
- [x] Rebuild `dist/meal-planner.html`, generate a week, confirm targets still hit
      - 404 kB, 10 modules inlined. Worst day 4.0 % off target (tolerance 4 %).
      - Tuesday now lands 2 g under the protein floor for both of us, where before
        the re-cost it cleared. That is the honest consequence of the turkey
        Aufschnitt correction (24 -> 20 g/100 g); the day's own meals are dense
        (souvlaki 38 g, soutzoukákia 50 g) and the gap is the low-protein snack
        pair. Inside the planner's designed 10 % slack, so the gate still passes,
        but `trimToTarget` only balances kcal -- nothing repairs protein.
- [x] README counts updated: 124 -> 181 (18 / 42 / 89 / 32).

## Conversion rules (unchanged from v4)

Ingredient proportions and technique from the source; **per-portion grams and
recomputed kcal/protein for the composition actually listed**, because the source's
figures cover only its quantified ingredients. Method lines written fresh in the
library's terse voice. German ingredient names. Their prose stays on their site.

Per-portion scaling is the main work: the source yields 4–6 family portions, the
library's are weight-loss portions, and the slot gates are hard —
dinner 400–900 kcal with protein ≥25, lunch 350–750, snack 80–320.

## Increment 2 - two people, one lunch (bug fix)

- [x] Reproduce "why do we get two separate lunches at the weekend?" - probe over
      40 seeds x 5 arrangements
- [x] Tests first: `tests/sharedlunch.test.mjs`, 8 tests
- [x] Share one lunch pick per day in the planner
- [x] Fix the torn-build race the verification exposed
- [x] Full suite + browser verification - 502/502 serial and parallel, 416 kB build

**What was wrong.** The lunch slot is per-person, and the two of them only ever
coincided by *sharing a source*: the same leftover pot, the same canteen card, the
same meal-out card. On a day with no source to share - a Sunday after a Saturday
spent eating out, so nothing was cooked to carry - each of them drew their own
recipe. Worse, they were then *guaranteed* to differ, because `usedLunches.push`
runs inside the person loop and `slotCandidates` hard-filters that exclude list:
the first pick was removed from the pool before the second draw. The shipped
default hid it by booking Sunday *lunch* as a meal out. Probe result: the
Sat+Sun-dinner-out arrangement split Sunday 40/40 seeds; every other arrangement
0/40.

**The fix.** One `shared` recipe per day, hoisted out of the person loop: the
first person to reach the fresh-pick branch draws, and the second serves the same
dish. Each still gets their own entry from `entryFromRecipe`, so portions scale to
each appetite (1.25 vs 0.75 on the repro day) and the per-person slot shape that
swap, locks, DOM ids and the shopping list all rely on is untouched. The existing
`continue`s mean office days need no extra guard - only she reaches the fresh
branch there, so his canteen card survives by itself. `shared` is also seeded from
a locked entry, so an unlocked plate joins a pinned one rather than becoming a
second thing to cook. Week-level variety improves: one pick per day enters
`usedLunches` instead of two.

**Found while verifying.** The first full-suite run came back 32 red, all of them
DOM tests. Not the fix: `tests/harness.mjs` rebuilds on import and `node --test`
runs files in parallel, so several builds were writing `dist/meal-planner.html` at
once and interleaving into a file that parses as nothing. `tools/build.mjs` now
writes to a pid-suffixed temp file and renames it into place, which is
all-or-nothing. Same parallel command: 502/502.
