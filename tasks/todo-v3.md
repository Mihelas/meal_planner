# Meal Planner v3 — plan

Three increments, picked from the v2 close-out. Sequenced so each makes the next
easier, which is not the order they were chosen in:

| | Increment | Why it goes here |
|---|---|---|
| A | Recipe sanity bounds | Small, purely defensive, and the bulk importer must reuse exactly this validation. Doing it first means the importer inherits it. |
| B | Library growth + bulk import | Split into B1/B2/B3 — see below, because the naive version of this would have achieved nothing. |
| C | Plan merge that doesn't lose a week | Independent of A and B, and the largest. Fixes three live defects. |

**Status: all three increments delivered. 448 tests green, dist 355 kB.**

Two surveys fed this plan. Both turned up live defects that were not on anyone's list,
and they are folded into the increments below rather than filed for later.

---

## Increment A — recipe sanity bounds

A typed quantity is checked only for being finite and positive
([src/recipes.js:924](../src/recipes.js:924)). `Hähnchenbrust | 2000 | g` is accepted
silently, flows into the shopping list, and never contradicts the stated calories,
because kcal and ingredients are validated independently and never compared.

The survey also showed `validateRecipe` is far looser than the standard the built-in
library is held to: it does **not** enforce `protein × 4 ≤ kcal`, the per-slot kcal
bands, or the protein floors, all of which `tests/recipes.test.mjs` enforces for
built-ins. Protein at 4 kcal/g is a physical constant, so a recipe claiming 50 kcal and
30 g protein is not a preference, it is impossible — and it currently saves cleanly.

### Design
Two tiers, because a hard cap on a legitimately large recipe would be its own bug:
**errors** block the save, **warnings** are shown and the save proceeds.
`validateRecipe` already returns `{ ok, errors, recipe }`, so `warnings` is additive
with no call-site churn.

1. **Physical impossibility → error.** `protein × 4 > kcal`. Same rule the library
   already lives under.
2. **Per-unit ceilings** on one portion — error above `g 3000`, `ml 3000`, `Stk 50`;
   warn above `g 800`, `ml 1000`, `Stk 12`.
3. **Energy-density cross-check**, the part that actually catches a typo'd zero.
   Nothing exceeds ~9 kcal/g (pure fat) or falls below ~0.1 kcal/g (watery veg), so
   `kcal ÷ total mass` is a physical bound rather than an arbitrary one. Error outside
   `[0.1, 9]`, warn outside `[0.3, 6]`.
   - **Known limitation, stated rather than hidden:** `Stk` carries no mass, so "3 Stk
     Ei" has nothing to divide by. **Built as a pieces check, not the planned 50 g
     floor:** a floor also skipped `480 kcal from 12 g`, which is impossible and was
     exactly the typo the check exists for. If every line is weighed or poured the mass
     is the whole dish and the ratio holds at any scale; one `Stk` anywhere and the
     recipe falls back to the per-unit ceiling alone. That is the honest trade; the
     alternative is a nutrition database.
5. **One owner per message.** The parser warns about a big amount *with its line
   number*; `validateRecipe` does the same for callers that never saw a textarea. The
   app passes `{ amountsChecked: true }` so the form is not told the same thing twice,
   while the matching **error** still runs in both places.
4. **Per-slot kcal bands as warnings, not errors** — a 900 kcal breakfast is unusual,
   not wrong, and this is their app.
6. Messages name the line and the likely fix, in the existing parser's voice:
   `Line 3: 2000 g in one portion is unusual — did you mean 200?`

### Tasks
- [x] `tests/custom.test.mjs` FIRST: an absurd quantity is rejected; a merely large one
      warns and still saves; the extra-zero typo is caught by density; `protein × 4 >
      kcal` is refused; an all-`Stk` recipe is not falsely accused; a legitimate
      1,200 kcal weekend roast passes clean.
- [x] `src/recipes.js` — `INGREDIENT_LIMITS`, the density check, the protein check,
      `warnings` in the return value.
- [x] `src/app.js` — render warnings as a plain `.notice`, visually distinct from the
      existing `.notice.bad` error list.
- [x] **Verify:** 388 tests green; both cases typed in Chrome and screenshotted — the
      density error refuses and keeps the form, the 1,200 g roast saves with one warning.

---

## Increment B — library growth + bulk import

### The finding that reshaped this
**Adding recipes alone would not have made the week more varied.** The planner ranks
candidates and then takes a fixed top five — `poolSize = 5` at
[src/planner.js:241](../src/planner.js:241) — and the swap sheet caps at
`.slice(0, 14)` ([src/app.js:1447](../src/app.js:1447)). Triple the library and the
same five best-fitting recipes per slot keep winning. So the constants have to move
first, or the work is invisible.

Three more live defects from the same survey:

1. **Two lunches are unreachable.** `l-halloumi-linsen-salat` and
   `l-linsensuppe-harzer-brot` carry neither `packable` nor `no-cook`, and
   [src/planner.js:272](../src/planner.js:272) requires one of them. The planner can
   never schedule them and the swap sheet never offers them. The real lunch pool is
   **13, not 15**, and the size test happily counts 15.
2. **Friday is the least varied night in the app and adding dinners won't help.**
   Friday draws only from `post-football`, of which there are **exactly 3** — and the
   pre-match snack has **exactly 1** candidate, so it is the same snack every single
   week.
3. **`pantryKey` doesn't transliterate umlauts** ([src/planner.js:230](../src/planner.js:230)),
   unlike `slugify`. `Olivenöl` → `oliven-l-g`, `Weiße Bohnen (Dose)` →
   `wei-e-bohnen-dose-g`. No collisions today across 161 pairs, but two item names
   differing only by an umlaut would silently merge into one shopping line and one
   pantry entry. The risk scales directly with library size.

### B1 — make growth actually count (do this first, it is small)
- [x] Test FIRST: with a doubled library, a generated week contains strictly more
      distinct recipes than with the current one. This is the test that proves the whole
      increment is worth doing. **Measured across 8 re-rolls: 50 → 69 distinct recipes
      when the library doubles.** Before this increment both numbers were the same.
- [x] Test FIRST: every lunch carries `packable` or `no-cook` — the guard that stops
      dead entries recurring as the library grows. Plus a second guard: every built-in
      recipe must pass increment A's own bounds, so B3 cannot add one that the form
      would refuse.
- [x] Fix the two dead lunches — both tagged `packable` (fried halloumi and a pressure-
      cooked soup are neither of them `no-cook`). The lunch pool is now 15/15, and both
      appear in every lunch swap sheet for both people. They are still rarely picked
      *automatically*, which is not a defect: only **one** fresh lunch is drawn per week,
      the other nine entries being dinner leftovers and canteen cards by design.
- [x] `poolSizeFor(n)` = quarter of candidates, floor 5, ceiling 12, never more than
      there are; exported and pinned by a monotonicity test. The five `choose()` call
      sites no longer pass a literal `5`. Swap sheet 14 → 20 (verified: a dinner sheet
      shows exactly 20).
- [x] Score once, then sort, in `choose()` and `swap.js` `rankOptions`. **`generateWeek`
      is now 0.49 ms at 77 recipes and 1.08 ms at 154**, against the survey's 4.8 ms at 77.
      `app.js:1440` needed no change — it was already a map-then-sort; the survey was
      wrong about that one.
- [x] `pantryKey` transliterates; `legacyPantryKey` kept solely so `migrate()` can move
      an existing cupboard, the shopping ticks **and** the per-item shop across. Rebuilt
      from ingredient *names* crossed with every unit, so a tick stored under a unit the
      recipe no longer uses still moves. No schema bump — the remap is idempotent.
      Injectivity test added. Verified in Chrome: a planted `oliven-l-g` came back as
      `olivenoel-g` and the cupboard card reads "Olivenöl — running low".

### B2 — bulk import ✅
- [x] Test FIRST: a pasted block of several recipes imports; one bad row is **reported
      by name with its line number** and the rest still import; a duplicate name gets a
      suffixed id rather than overwriting; a row that fails increment A's bounds is
      refused with the same message the form gives.
- [x] Paste-in format, recipes separated by `---`, reusing `parseIngredientLines`
      verbatim for the ingredient block so there is one parser, not two.
- [x] The importer calls `validateRecipe` per row and collects errors itself.
      `setCustomRecipes` currently **silently drops** anything invalid
      ([src/recipes.js:846](../src/recipes.js:846)) and returns nothing — importing
      through it unchanged would lose rows without saying so.
- [x] `Set`-based id collision check for the bulk path; the current nested scan is
      O(n×m) per import.
- [x] Also accept the app's own export JSON, so a recipe can move between the two of you
      before increment C lands.
- [x] The paste box in the UI: a card on My recipes with the worked format beside it,
      `Import them` / `Clear the box`, and a three-part report — how many landed, what
      was refused (named + located), what imported but is worth a second look.

**What it does.** `parseRecipeBlocks(text)` in [src/recipes.js](../src/recipes.js) takes
either the `Name: / Meal: / Ingredients:` text format with `---` between recipes, or a
JSON file this app exported, and returns `{ recipes, errors, warnings }`. Field names have
aliases (`Calories`, `Time`, `Steps`, `Title`, and the German meal names) because being
told "unknown field" is a pointless defeat. `importRecipes(memory, text)` in
[src/swap.js](../src/swap.js) merges the good ones and counts what actually landed —
`stored.length - before.length`, not what it hoped for, because `setCustomRecipes`
validates a second time and drops failures without a word.

**Deviations from the plan, and why**
1. **A fourth message owner had to be settled.** A line like `Hähnchenbrust | 5000 | g` is
   refused by the parser *and* excluded from `items`, so `validateRecipe` then said "It
   needs at least one ingredient" — about an ingredient the person had plainly typed.
   Two messages, one of them false. Fixed by making `parseIngredientLines` return
   `rejected` (lines were typed and not one survived) and `validateRecipe` take
   `opts.ingredientsRejected`, which changes the wording to "None of the ingredient lines
   could be used — fix the amounts above" instead of suppressing it. Suppressing it was
   the first idea and it was wrong: with no error left, `ok` would have flipped to true
   and the form would have saved a recipe with zero ingredients.
2. **The box is not cleared when anything failed.** It is the only copy of that text.
   Making someone retype eleven recipes because the twelfth had a typo is not a trade
   worth making, so the paste survives and the errors appear above it.
3. **Both pipe-delimited textareas are monospace now** (`.mono`), the new paste box and
   the existing ingredients box. Columns only line up if the font does, and a long paste
   is read by scanning columns. `.field textarea` sets `font: inherit`, so the rule needs
   the extra selector to win on specificity.
4. **A third card, not a wrapper.** The import card is the recipes grid's third child, so
   it lands under the add-form on desktop and after "Mine" on mobile. Re-indenting the
   whole form into a column wrapper would have been a 20-line diff for the same layout.

**Verified:** 412 tests green; in Chrome at 298 kB — a three-recipe paste (all three
land, named in Mine, offered in a swap immediately), a paste with one impossible amount
(the other two land, the bad one named with the paste line number, the text kept), a
paste with a merely-odd 1200 g amount (imports, warned), an exported state file (2
recipes in, ids slugged and transliterated), an empty click and a junk paste (both
explain themselves), and mobile at 375 px (no sideways scroll, example box does not
overflow).

### B3 — the recipes themselves (delivered in batches, not one drop)
Priority order is by *effect*, not by count — the scarce pools first:

- [x] `post-football` dinners 3 → 8, and `pre-football` snacks 1 → 5. Biggest felt
      change for the least work: Friday stops repeating.
- [x] Dinners 30 → 50, keeping `leftover-ok` above 60% so lunch stays pre-solved.
      38/50 = 76%. Pinned as a **ratio** rather than the count it used to be, so the
      "dinner pre-solves tomorrow's lunch" mechanism survives the next batch too.
- [x] Lunches 15 → 26, every one `packable` or `no-cook`.
- [x] Breakfasts 12 → 18, snacks 20 → 30.
- [x] Test FIRST, before the recipes: every `produce`-aisle item is either in `SEASON`
      ([src/seasons.js:15](../src/seasons.js:15)) or on an explicit "no German season"
      allowlist. Four tests, written first, and they earned it: 9 new produce decisions
      (`Blumenkohl`, `Rosenkohl`, `Lauch`, `Fenchel`, `Rote Bete`, `Hokkaido-Kürbis`,
      `Blattspinat (frisch)`, `Rosmarin`, `Aubergine` → no-season).
- [x] Update `README.md` (it said 77) and the per-slot floors in
      `tests/recipes.test.mjs`. README now 124 / 419 tests / 338 kB.

**Done: 77 → 124 recipes (18 breakfast · 26 lunch · 50 dinner · 30 snack)**, in four
shown batches. Every record passes `validateRecipe` with zero errors *and* zero
warnings — increment A's bounds hold the library to a stricter standard than they hold
the user, and that is deliberate.

Four things came up that weren't in the plan:

1. **The library had no weekend-only recipes at all.** `slotCandidates` drops `weekend`
   and anything over 30 minutes on a weekday, so with none of either, Saturday drew from
   exactly the same pool as Tuesday and the 30-minute *weekday* cap was silently a 7-day
   rule. Added 3 weekend dinners and 2 weekend breakfasts, and pinned the capability
   with a test. The Sunday roast and the pulled-chicken batch deliberately stock
   `Hähnchenbrust (gegart)`, which the Friday dürüm and three lunches then consume.
2. **A new "what can a plain Tuesday actually draw?" test.** The slot count overstates
   the pool: 50 dinners is 39 after the weekend, >30-minute and post-football filters.
   The honest number is the one now asserted.
3. **A shopping-list fragmentation bug of my own making.** `Za'atar` written with an
   ASCII apostrophe in 3 new recipes against the library's typographic `Za’atar` — two
   rows on the shopping list for one jar. Caught by the existing `pantryKey` uniqueness
   test, not by eye.
4. **`rebalanceWeek` was missing the dead-band `trimToTarget` already had.** A clean
   generated week drifts a little from quarter-portion rounding (nick 34 kcal, partner
   133), and growing the library was enough to make the rebalance offer to "correct" it —
   writing an adjustment the reflow would then decline to act on, so the week reported
   itself as fixed while nothing moved. Extracted `trimToTarget`'s 4 % into
   `TARGET_TOLERANCE` and derived `rebalanceDeadband(dayTarget, daysLeft)` from it, so
   there is one number with one reason. It is per-day and per-remaining-day on purpose:
   a flat kcal figure is rounding for his 2240-kcal day and real food for her 1500, and a
   Thursday pizza must not be excused by the room Monday had.

_Delivered: 124 recipes, 419 tests green, dist 338 kB._

---

## Increment C — a plan merge that doesn't lose a week

### What is actually broken today
1. **Deletions cannot be expressed.** `banned` merges as a set union
   ([src/store.js:324](../src/store.js:324)), so un-banning on one device is undone by
   the other on the next sync. Identical shape for un-ticking a bought item
   (`unionFlags`, [src/store.js:288](../src/store.js:288)) and for deleting a custom
   recipe.
2. **Pulling promotes you to permanent winner.** `pull()` → `save()` stamps
   `savedAt = Date.now()` ([src/store.js:209](../src/store.js:209)) and `push()` copies
   it into the shared file, so a device that merely syncs outranks a genuinely newer
   week on the other laptop for ever. No test covers this.
3. **`push()` writes without reading** ([src/sync.js:296](../src/sync.js:296)). Both
   edit offline, both debounces fire, second write wins, first person's week is gone.
   `blocked` only guards *unparseable* files, not stale ones. Nothing re-reads on focus
   or a timer, so a tab open all afternoon pushes forever and never pulls.

### Why not the operation log that was asked for
Replay needs determinism and most mutations lack it: `swapMeal` walks a ranked list
that depends on `memory` and a persisted `swapIndex` cursor, `banAndReplace` cascades
through every slot re-swapping each appearance, and `rebalanceWeek`'s payload is derived
from a ledger scan. Replayed against a different base state each gives a different
answer, so the log would have to record outcomes rather than intents — at which point it
is not a log, it is a stamped state. So: stamp the state.

### Design
1. **Plan identity.** `generateWeek` stamps `plan.id`. Same `id` means the same week and
   merges cell by cell; different `id` means two genuinely different weeks and falls
   back to whole-plan last-write-wins — nothing can reconcile those, and pretending
   otherwise would invent a week neither person chose.
2. **Per-entry stamps written at one chokepoint.** `store.save()` structurally diffs
   `prev.plan` against `next.plan` and stamps `touched: { at, device }` on changed
   entries. In `save()` rather than at each mutation site, so no new mutation can forget.
3. **Per-slot merge** in `mergeStates`, keyed by the existing stable `day|slot|person`
   address: newer stamp wins per cell, unstamped falls back to today's behaviour. She
   swaps Tuesday dinner, you log Monday off-plan, both survive. Today one is destroyed.
4. **Tombstones** — `memory.removed: { banned, custom, bought }` as `{ id: at }` maps,
   consulted by the union merges, pruned after 90 days. Additive, so `migrate()` repairs
   old states with a default.
5. **`savedAt` means "a human changed something".** `store.save(next, { touch: false })`
   for sync-originated saves, so pulling stops inflating the clock.
6. **Read-merge-write in `push()`** — re-read, merge remote into local, write the
   result, save it locally. `blocked` stays exactly as it is.
7. **Pull on focus and every 60 s while visible**, debounced, so sync is bidirectional
   without anyone pressing a button.
8. `SCHEMA_VERSION` → 4, `migrate()` defaulting every new field.
9. **`sync.device` already exists** and is read at
   [src/sync.js:303](../src/sync.js:303) but written nowhere — a replica id slot already
   threaded through `snapshot()`. Populate it at store creation and every write becomes
   attributable for free.

### Tasks
- [x] `tests/merge.test.mjs` FIRST: a swap on A and an off-plan log on B both survive;
      un-ban propagates; un-tick propagates; a deleted custom recipe stays deleted;
      pulling without editing does not win a later comparison; a concurrent write is
      merged rather than discarded; two different weeks resolve deterministically and
      the loser is told. _26 tests._
- [x] `src/store.js` — stamps, per-slot merge, tombstones, `touch: false`, schema 4.
- [x] `src/planner.js` — `plan.id`.
- [x] `src/sync.js` — read-merge-write, focus/interval pull, write `sync.device`.
- [x] `src/app.js` — say "your copy of this week was replaced by the newer one" rather
      than letting a week vanish silently.
- [x] **Verify:** 447 tests green; live page checked against the real build (below).
      _Not done: two real browser profiles against one shared folder. The File System
      Access handle cannot be driven from a script, so this is the one claim resting on
      unit tests plus a single-profile walkthrough rather than on the real thing._

### What came out differently
1. **A fourth tombstone bucket.** The plan said `{ banned, custom, bought }`;
   `favourites` is the identical defect (un-favouriting undone by the other device) and
   an empty map costs nothing, so there are four. It has no UI write path yet — the
   bucket is there for when favourites become removable.
2. **`forget`/`remember` live in `src/planner.js`, not `src/store.js`.** `swap.js` needs
   them and is built *before* `store.js`, so importing store there breaks the bundle.
   They sit next to `isBanned`, which is the same kind of helper.
3. **`push({ fresh: true })`.** Read-merge-write in `push()` added async hops to
   `link()`, which overran the 25-microtask `settle()` in the app tests. The fix went in
   the production code rather than the test: `link()` and `reconnect()` have *just*
   pulled, so the second read bought nothing and is skipped.
4. **The stamp follows the leftover chain, and that is correct.** Swapping Tuesday's
   dinner rewrites Wednesday's lunch, so both get stamped. Stamping only the clicked
   plate would let a merge take the new dinner while keeping a lunch made of the old
   one's leftovers. The test asserts the pair, and nothing outside it.
5. **The poll timer only runs while linked.** An unconditional 60 s interval kept the
   page awake to do nothing, and in jsdom it kept node alive so the app suite hung
   instead of reporting. It is armed from inside `pull()` — the one path every
   successful link, restore and reconnect goes through — and the harness now closes
   its windows after each file.
6. **`plan.id` is backfilled on migration.** Found by looking at the real saved state in
   the browser: without it the per-plate merge would only start working on the *next*
   week generated, and the week that matters is the one they are already in. Derived
   from content, so both devices reach the same id from the stored week alone.
7. **Both one-shot notices are now dismissible.** `mergeNote` would otherwise sit on
   every tab for ever; the same was already true of `migrationNote`.

_Delivered: 448 tests green, dist 355 kB._

---

## Risks to settle before building
- **Clock skew between two laptops** still decides per-cell winners in C. A device id
  breaks ties deterministically, but a badly wrong clock can still win wrongly. Better
  said in the UI than papered over.
- **Tombstones grow.** 90-day pruning is a guess; if it is wrong the symptom is a
  resurrected ban — exactly the bug being fixed.
- **Schema 4 must not strand a v3 export.** `migrate()` is "repair to current shape",
  not stepwise, so this should hold, but it needs a test against a real v3 export file.
- **Changing `pantryKey` orphans existing cupboard entries** unless the remap in B1 is
  right. The orphan UI from v2 is the safety net, not the plan.
- **Bundle size** goes from 278 kB to roughly 370 kB at 124 recipes. Fine for a
  double-clickable file; worth knowing before anyone imports thousands.
- **B3 is hand-written data**, which is where silent errors live. The two guard tests
  (season coverage, lunch reachability) are written *before* the recipes for that reason.
