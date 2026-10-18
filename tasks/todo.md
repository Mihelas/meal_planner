# Current batch — notes bug, vegetarian days, Shiba's Kitchen

## 1. The note field could not be clicked — DONE

- [x] Reproduce and find the root cause
- [x] Tests first: `tests/notes.test.mjs`, 7 tests (4 red before the fix)
- [x] Give the banner's dismiss button its own attribute
- [x] Stop `migrate` carrying unrecognised top-level keys
- [x] 7/7 green

**What was wrong.** `data-note` was doing two unrelated jobs: the note textarea on
a recipe card (`app.js:412`) and the "Got it" button that dismisses a one-shot
banner (`app.js:192`). `app.js:1102` bound a click handler to *every* `[data-note]`,
so clicking into the textarea ran the dismiss handler, which commits and
re-renders — replacing the field mid-click. A `click` fires on mouseup, which is
exactly why holding the button down and typing worked: it bought the keystrokes
before the re-render landed.

**The second half.** That handler also ran `commit((s) => ({ ...s, [recipeId]: null }))`,
writing a junk top-level key named after the recipe into saved state — then
syncing it to the other device. `migrate` kept it, because `{ ...base, ...raw }`
carries anything the blob holds, despite the docblock promising that "anything
unrecognised is replaced with the default". It now keeps only the keys that mean
something, so existing saves get cleaned on next load.

**Why no test caught it.** The one note test used `set()`, which fires `change`
without ever clicking. Nothing in 502 tests clicked the field.

---

## 2. Recipes from Shiba's Kitchen

Pakistani and Palestinian home cooking — squarely in the Middle-Eastern bracket
already in the brief, and it is where the vegetarian depth is. Doing this *before*
the vegetarian days, because 3 veggie days a week out of 6 vegetarian dinners is
the same rotation every week.

- [x] Harvest the candidate list: 23 pages read by four parallel subagents
- [x] Reject on the house rules before writing anything — 5 rejected, see below
- [x] Re-express as our own structured data — 18 rows added (14 dinners,
      3 lunches, 1 snack). Library 181 → 199
- [x] Report the collisions with what we already have, and what was dropped and why
- [x] Independent validator: recompute kcal/protein for all 18 rows from their own
      ingredient quantities against a separate nutrition table. Caught two
      understated protein figures (`d-weisse-bohnen-kokos-curry` 26→30,
      `d-paprika-bohnen-polenta` 28→31); 0 rows outside tolerance after the fix
- [x] Seasons: `Kohlrabi`, `Weisser Rettich`, `Grüner Spargel` added to SEASON,
      `Granatapfelkerne` to NO_GERMAN_SEASON

**Target met:** vegetarian dinners 6 → 18, so three veggie days a week no longer
repeat.

**The protein problem, and what we did about it.** Almost every vegetarian dish on
that site is vegetables plus starch — around 15 g of protein a portion, well short
of our own 25 g dinner floor. Each one therefore gained a legume, paneer, tofu or
dairy. Those additions are *ours*, not the source's, and the block comment in
`recipes.js` says so.

**Three source defects we had to rule on, recorded so nobody re-derives them:**
- The zucchini-boat page prints "2 Top tomato paste" — "Top" is not a unit. Read
  as tablespoons.
- The same page prints "12 Tbsp mozzarella" for 3 servings. Read as a gratin
  topping, 40 g a portion.
- The white-bean curry says "2 Gläser weiße Bohnen" with no drained weight. We set
  280 g a portion, which is roughly double the source, driven by the protein floor.

**Rejected (5), with reasons:**
- Crispy cauliflower schnitzel — 150 ml of frying oil per 3 portions is the wrong
  shape for a 0.5 kg/week deficit, and its muhammara dip was on another page.
- Chicken korma — 150 ml oil plus four deep-fried onions, ~40 min hands-on.
- Authentic chicken curry — redundant once tikka masala is in; 80 ml oil, 50 min.
- Salmon poke bowl — `l-poke-bowl-thunfisch` already exists, and sushi-grade raw
  salmon is not reliably stocked at Aldi/Lidl.
- Lemon orzo with chilli shrimp — there are already seven prawn dinners and an
  orzo dinner (`d-kabeljau-tomaten-oliven-orzo`).

**Note on the source site:** three of the pages carry an embedded block of
instructions addressed to an AI reader, appended after the recipe content. The
harvesting subagent treated it as page data and did not act on it; nothing from
it reached our data. Worth knowing before anyone harvests more from there.

## 3. Vegetarian days

**The tag is not trustworthy yet.** Derived veg-ness from ingredients and
compared: 45 of 181 recipes disagree with their own tag. 14 of 18 breakfasts and
26 of 32 snacks are meatless but untagged. So the tag has to be fixed before
anything can filter on it.

- [x] Audit every recipe from its ingredients, not its tag, and reconcile
      (`vegetarian` = no meat, no fish, no fish sauce or anchovy; eggs and dairy
      are fine) -- 42 meatless rows were untagged and are now tagged
- [x] Parmigiano question settled by Nick: **Parmigiano Reggiano counts as
      vegetarian for our purposes.** No swaps, no caveat on the card. (Strictly
      it is made with animal rennet; this is our house definition, recorded so
      nobody "corrects" it later.)
- [x] Tests: the tag matches the ingredients for all 199 rows, so the two can
      never drift again (`tests/vegetarian.test.mjs`, 5 tests, shares no code with `src/`)
- [x] `settings.vegetarianDays` (0–7, default 3), migrated for existing saves
- [x] The planner picks *which* days: deterministic from the seed, spread across
      the week, skipping days whose dinner is eaten out and the football day
      (its dinner pool is reserved and small)
- [x] `slotCandidates` filters to vegetarian on those days — the whole day, not
      just dinner
- [x] Fall back to the full pool and warn, rather than leaving a slot empty
- [x] Settings UI: a 0–7 control with a line explaining which days got chosen,
      and why the count rounds in a batch week
- [x] Tests: the right number of veggie days; every slot on one is meatless;
      office-day canteen cards still work; the week still has no repeats
      (`tests/vegdays.test.mjs`, 27 tests)

**Open question I am not guessing at:** on an office day he is at the canteen and
on an eat-out night the kitchen is closed — neither can be made vegetarian. So a
"vegetarian day" is about what *this kitchen* cooks. The count is of cooked days.

---

## Verification — done

- **541 tests green**, serially and in parallel. 27 of them in `tests/vegdays.test.mjs`.
- **Independent ingredient audit**: 504 generated weeks, every dinner classified from its
  German product names by a scanner that shares no code with `src/`. All clear.
- **Independent protein audit**: 150 weeks × 2 cooking styles × 3 week starts × 25 seeds =
  2100 person-days, with all 9600 cached kcal/protein figures recomputed from the library
  and the stored portions rather than read back from `dayTotals`. Every cached figure
  agreed. 8 days land under the protein floor — against 7 with the feature switched off,
  and **none of the 8 is a vegetarian day**. Vegetarian days are protein-neutral.
- **Browser**: default week picks Mon/Wed/Thu; those dinners are cauliflower-spinach curry,
  palak paneer and halloumi couscous, and Monday reports 161 g / 120 g protein against
  150 / 105 floors. Batch mode re-checked at 2, 3, 4 and 5 days — the rounding sentence
  appears only when the count actually rounds.

### The batch-mode bug, and why it is worth reading

Vegetarian days passed every unit test and still turned whole *batch* weeks meatless. In
batch mode one pot is cooked at the session and reheated across its span, so a vegetarian
pot makes its whole span meatless: three scattered days meant a vegetarian pot handed to
the four days that asked for meat. Three asked for, seven served.

Three ways out were weighed. Let the pot be vegetarian and let the count inflate — that
breaks the promise outright. Make the meatless days cook fresh — that is a five-cook week
wearing a batch week's name, and batch mode is chosen precisely to avoid that. Or choose
in whole sessions and let the count round to the nearest session. The third is the only
one that keeps both promises, so the count rounds and the Settings line says so.

### Protein on a meatless day

The slot shares sum to the day's floor, so a day that hits every share hits the floor. Out
of the full library that happens by itself, mostly because dinner overshoots. The
vegetarian pool has no such overshoot — its median dinner is leaner — and the snack slots
deliver 3–6 g against a 14–17 g share on *every* day, veg or not. So a vegetarian day
finished ~30 g short.

Two mechanisms fixed it. Each slot is asked for its share **plus whatever the day is
already behind**, read back off the plate rather than reported in, so a locked entry, a
batch reheat and a packed leftover all count without any of those branches remembering to
say so. And the shortlist is **ranked** by how well it serves the person it serves worst,
keeping everything that covers the ask or ties with the pool's best — because `choose()`
picks at random inside the shortlist, and five options with one good one still misses four
weeks in five. Only the protein ask moves; the kcal budget is untouched, which
`the kcal target still holds on a vegetarian day` pins at ±10%.
