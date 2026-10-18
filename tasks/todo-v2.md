# Meal Planner v2 — approved scope

Eleven features, requested explicitly: 1, 2, 3, 5, 6, 7, 8, 9, 10, 13, 14.
Not in scope (deliberately declined earlier): 4 cook mode, 11 restaurant guidance,
12 body composition.

Order is data → logic → output → sync, because every later increment depends on the
shape of the earlier one.

## Increment A — data & scoring foundations
- [x] **14 Maintenance mode** — `person.goal: 'lose' | 'maintain'` + `goalWeightKg`.
      Maintain ⇒ zero deficit, protein floor unchanged. Suggest the switch when the
      log crosses the goal weight. (`src/targets.js`)
- [x] **7 Ratings & notes** — `memory.ratings[id]` 1–5, `memory.notes[id]` free text.
- [x] **6 Pantry** — `state.pantry[itemKey]` for staples you always have.
- [x] **8 Custom recipes** — `state.customRecipes[]`, validated, merged into the library.
- [x] **10 Seasonality** — `src/seasons.js`: peak months per German produce item;
      a recipe's seasonal score is derived from its ingredients, so no per-recipe data.
- [x] **3 Preference learning** — `memory.stats.away[id]` / `.kept[id]`.
- [x] Tests first for each of the above.

## Increment B — planner
- [x] **3 + 6 + 7 + 10 scoring** — one `preferenceScore()` folding rating, swap-away
      history, pantry coverage and seasonality into the existing fit score.
- [x] **5 Batch-cook weeks** — `settings.cookingStyle: 'daily' | 'batch'` and
      `settings.cookDays`. In batch mode 2–3 dinners cover the week, chosen from
      `batch`/`freezes` recipes, and every other dinner is a reheat of one of them.
- [x] **2 Off-plan logging** — `logOffPlan()` replaces a slot with what was actually
      eaten; `rebalanceWeek()` spreads the surplus over the remaining days, capped,
      never below the safe floor, and says plainly what it could not absorb.

## Increment C — shopping & print
- [x] **9 By shop** — `settings.shops[]` mapping aisles to Aldi/Lidl/Rewe/Edeka, with
      a per-item override. Grouped shop → aisle.
- [x] **6 Pantry in the list** — pantry items shown separately as "check you still have".
- [x] **13 A4 sheet** — always-rendered print section: week on page 1, page break,
      shopping list on page 2. Printing must not depend on which tab is open.

## Increment D — sync & UI
- [x] **1 File sync** — link a JSON file in a shared folder (File System Access API,
      handle persisted in IndexedDB). Field-level merge: bans, weights, ticks, ratings,
      notes, custom recipes and pantry union; plan and settings last-write-wins.
      Manual Export/Import stays as the fallback where the API is missing.
- [x] UI for all of the above: rating stars + notes in the meal detail, "I ate something
      else", pantry tab, custom recipe form, shop settings, maintenance toggle, sync panel.
- [x] Full test pass + browser verification + Risks & Edge Cases.

## Review — v2 complete

**Shipped.** All eleven requested features are in `dist/meal-planner.html` (278 kB, one
file, no network of any kind). 377 tests, all passing: 338 module/v1 tests plus 39 new
end-to-end tests driving the built artefact in jsdom.

**What v2 added, in the order a person meets it**

| # | Feature | Where it lives |
|---|---------|----------------|
| 2 | "I ate something else" — 📝 on any meal, eight presets or your own number, labelled as an estimate everywhere | `logOffPlan`, `#ate` dialog |
| 2 | Planned-vs-actual scoreboard with kg equivalent, and **Spread it over the rest of the week** | `weekLedger`, `rebalanceWeek`, `reflow` |
| 7 | 1–5 stars and a free-text note per recipe, shown on the slot and in the detail | `rateRecipe`, `noteRecipe` |
| 3 | Learns from ratings, swap-aways and what survived a whole week; explained in **Why this plan** | `preferencePenalty`, `recordKept`, `learned` |
| 6 | Cupboard: 🏠 stores the *amount*, not a flag; items drop off the list and score recipes up | `setPantry`, `pantryCheck`, `pantrySaving` |
| 8 | **My recipes** tab: your own recipes join the same pool, get portioned, shopped and offered in swaps | `parseIngredientLines`, `addCustomRecipe` |
| 9 | Shopping list split by shop, then aisle, with a per-item override | `shoppingByShop`, `shopFor` |
| 10 | Seasonality: out-of-season produce pushed down the list and flagged on the meal | `src/seasons.js` |
| 5 | Batch weeks: two cook-ups, the rest reheated, cook days movable but never empty | `cookSessions`, `repairBatch` |
| 14 | Maintenance mode: no deficit, full eat-back, offered — not forced — at the goal weight | `isMaintaining`, `shouldSuggestMaintenance` |
| 13 | A4 sheet: week on page 1, shopping list on page 2, independent of the open tab | `viewSheet`, `@page` |
| 1 | One shared JSON file via the File System Access API, field-level merge, never writes a file it could not read | `src/sync.js` |

**Two real bugs the tests caught**

1. `candidatesFor` returns the library in file order and the swap dialog cut it to
   fourteen, so a recipe you typed in yourself — appended at the end — could *never*
   be reached. The dialog now sorts by `preferencePenalty` with your own recipes
   pinned first, which also means the best-liked and in-season options come first.
2. Un-logging an off-plan meal left `locked: true` behind, because `regenerateSlot`
   restores the flags it finds. The slot would have survived every future re-roll
   silently. Now cleared explicitly.

**Verified in Chrome**, not just jsdom: logging 1,500 kcal on Monday produced
`+692 kcal over for the week — about 0.09 kg of the loss`; rebalancing spread it as
−116/day across six days and the day cards show the corrected target (2,084, not
2,200); 🏠 on Bulgur took it off the list and into the cupboard with `need 100 g ·
have 100`; a saved custom recipe appeared first in the Tuesday swap list marked
*yours*; the print sheet carried the off-plan meal and 73 items across two shops with
no blank cells. No console errors.
