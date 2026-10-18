# v4 — Greek recipes from akispetretzikis.com

**Status: approved. Building 57 new recipes + 2 app features.**

Why this source is worth using: the site server-renders a structured data blob with
**per-portion kcal and protein**, ingredient quantities in grams, and prep/bake times.
So the numbers that go into the library are the source's own figures, not my guesses —
which matters, because every other recipe in the library was hand-costed against the
same bands.

## What the library is short of

| | count | note |
|---|---|---|
| breakfast | 18 | fine — you both want these *simpler*, not more varied |
| lunch | 26 | thin, and heavily Turkish/Asian |
| dinner | 50 | healthy count, but only 17 of all 124 are `mediterranean` |
| snack | 30 | almost entirely Northern (Skyr, Harzer, Hüttenkäse) |

Greek specifically is a hole: no souvlaki, no gyro, no tzatziki, no sea bass or bream,
no Greek shrimp dishes, no lemon-rice chicken soup. Mediterranean is the brief's first
listed cuisine and its least-served one.

## The gate the candidates had to pass

- `make_time + bake_time ≤ 30` — the weekday cap, applied to the source's own times.
- `protein ÷ kcal ≥ 0.070 g/kcal` — the library runs at a median of **0.079**; below
  that a dish cannot be portioned into a weight-loss week without eating the budget.
- kcal per portion between 120 and 1100 — sanity, not selection.
- Ingredients buyable at Rewe/Edeka/Aldi/Lidl, checked ingredient by ingredient.

All 5,393 English recipes scraped (3 pages errored). **89 passed** at the stricter
0.085 g/kcal bar. The full pass was worth it: sea bass en papillote, acqua pazza,
cod plaki and the Greek kebabs only surfaced in the second half.

## The shortlist — 16 picks

The kcal/protein columns are the source's own per-portion figures, which is what the
picking was done on. Our portions get re-derived at conversion time. Every ingredient
checked against Rewe/Edeka/Aldi/Lidl ranges.

### Dinner — 9, all Mediterranean, all inside the weekday cap

| # | dish | src kcal / P | min | kit | why this one |
|---|---|---|---|---|---|
| 1 | Greek pork souvlaki skewers | 327 / 42 | 30 | oven, airfryer | the library has no souvlaki at all; 4.96★ from 233 |
| 2 | Quick chicken gyro with tzatziki | 253 / 28 | 20 | hob | most-rated dish that passed the gate — 4.9★ from 1,485 |
| 3 | Sea bass en papillote, capers and lemon | 315 / 56 | 30 | oven | best protein density of any fish on the site; no sea bass in the library |
| 4 | Fish acqua pazza with courgette and olives | 302 / 36 | 25 | hob | poached, not fried; 4.84★ from 179 |
| 5 | Cod in spiced tomato sauce with broccoli | 143 / 20 | 18 | hob | one pot, leanest dinner on the list |
| 6 | Crispy baked cod with yoghurt tartare | 412 / 60 | 28 | airfryer | 4.9★ from 299; no breaded fish in the library |
| 7 | Oven shrimp with oregano and parmesan crumb | 293 / 35 | 22 | oven | Greek *garídes*; only one prawn dinner exists today |
| 8 | Pork tenderloin with spinach and feta | 467 / 51 | 30 | hob | pork appears once in 50 dinners |
| 9 | Greek chicken and pepper kebabs | 342 / 44 | 20 | oven, airfryer | 4.88★ from 83; different marinade from the souvlaki |

### Lunch — 5, the thinnest slot at 26

| # | dish | src kcal / P | min | why this one |
|---|---|---|---|---|
| 10 | Chicken and cucumber salad with tzatziki yoghurt | 484 / 70 | 25 | highest protein per portion anywhere on the site |
| 11 | Light Caesar with chicken and yoghurt dressing | 380 / 43 | 18 | 4.78★ from 349; yoghurt instead of mayonnaise |
| 12 | Turkey, apple and yoghurt salad | 232 / 41 | 15 | no-cook, eats leftover turkey |
| 13 | Warm prawn and green bean salad | 535 / 59 | 25 | 10 g fibre a portion |
| 14 | Greek lemon chicken soup with rice | 271 / 32 | 25 | pressure cooker, batch-cooks, freezes |

### Snack — 2, against 30 that are almost all Northern

| # | dish | src kcal / P | min | why this one |
|---|---|---|---|---|
| 15 | Tzatziki with vegetable sticks | 105 / 5.5 | 10 | savoury night craving; the Greek twin of the hummus sticks. Needs more yoghurt than theirs to clear the snack protein average |
| 16 | Two-minute tuna bread | 172 / 27 | 7 | savoury, and under 10 minutes so it can also be a pre-match snack |

### Lamb — 4, because the library has zero lamb in 124 recipes

Lamb is slow food. Of 65 lamb recipes on the site, exactly **one** fits the 30-minute
weekday cap; the rest run 40–350 minutes. The library's tests allow a `weekend` tag and
the weekend pool is thin (8 recipes today), so the long ones go there rather than being
thrown out.

| # | dish | src kcal / P | min | tag | kit | why this one |
|---|---|---|---|---|---|---|
| 17 | Lamb souvlaki, yoghurt-mint-tahini marinade (3124) | 223 / 19 | 25 | weekday | hob, airfryer | the only lamb dish inside the cap; 5.0★ from 50 |
| 18 | Greek lamb kebab — *giaourtlou* (912) | 304 / 23 | 40 | `weekend` | hob | most-rated lamb dish under an hour — 4.8★ from **721** |
| 19 | Pressure-cooker lamb fricassée (4756) | 391 / 34 | 55 | `weekend` | pressure | 4.9★; avgolemono with lettuce, spring onion, dill — and it uses the pressure cooker |
| 20 | Greek roast leg of lamb, mustard and herb (4387) | 486 / 75 | 90 | `weekend` | oven | **0.154 g protein per kcal** — the best density of any lamb on the site, and a real Sunday roast |

Portions get re-derived: the souvlaki's 19 g protein is ~100 g of lamb per portion at
their yield, so ours goes to ~170 g to clear the 25 g dinner floor.

Two lamb dishes I deliberately did *not* take, so you can overrule me:

- **Greek lamb fricassée (3108)** — 486 / P46, 50 min, 4.9★ from 549. The same dish as
  pick 19 in a casserole instead of the pressure cooker. One of them, not both.
- **Roasted leg of lamb with potatoes (3215)** — 579 / P40, 4.8★ from **1,173**, the
  most-rated lamb on the site. It is 250 minutes. Mostly unattended, but it owns a day.
- *Optional snack:* **lamb, feta and olive meatballs (888)** — 98 kcal / 7.6 g protein
  *per meatball*, batch of 12, air fryer instead of their frying pan. Two is a 196 kcal
  savoury night snack. Say the word and it becomes pick 21.

Library after: breakfast 18, lunch **31**, dinner **63**, snack **32** — 144 total.
`mediterranean` goes from 17 of 124 to **37 of 144**, and the `weekend` pool from 8 to 11.

## Where the other 69 went

The gate was mechanical; the cut from 89 down was judgement, so here is all of it.

| | n | |
|---|---|---|
| picked | 20 | 16 from the gate, plus tzatziki and 3 lamb dishes reached from outside it |
| already covered | **49** | the library already does this job |
| not shoppable here | 10 | |
| offal | 4 | |
| treat food | 4 | |
| **runners-up** | **6** | lamb souvlaki was the seventh; it is now pick 17 |

### Already covered (49) — every one, with what it collides with

The library is 124 recipes deep, so most of what cleared the gate lands on something
already in it. Source's own per-portion figures.

**Chicken and pork skewers — 6.** I took one chicken marinade (pick 9) and one pork (pick 1).

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Lemon pepper chicken skewers (8436) | 126 / 24 | 27 | 5.0★/10 | pick 9 |
| Chicken souvlaki with peppers (4260) | 176 / 23 | 25 | 5.0★/50 | pick 9 |
| Chicken kebabs with bbq sauce (3827) | 331 / 44 | 22 | 5.0★/100 | pick 9 |
| Grilled pineapple chicken (8374) | 311 / 42 | 30 | 5.0★/10 | pick 9 |
| Indian chicken souvlaki (3122) | 168 / 25 | 25 | 5.0★/75 | pick 9; marinade duplicates *Thai green chicken curry* |
| Greek pork souvlaki with peppers (2987) | 124 / 18 | 18 | 4.9★/348 | pick 1 |

**Crumbed white fish — 4.** Pick 6 is the fifth one of these; one is enough.

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Fish fingers (5957) | 294 / 26 | 30 | 4.6★/41 | pick 6 |
| Tuna burgers (945) | 240 / 23 | 25 | 4.8★/391 | pick 6 |
| Speedy Greek fish and chips (3191) | 578 / 52 | 25 | 4.9★/473 | pick 6, and it arrives with chips |
| Parmesan-crusted baked fish (5784) | 252 / 32 | 30 | 4.4★/62 | pick 6 |

**Cream-sauce chicken — 4.** All four land on the same library recipe.

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Chicken à la crème (2897) | 214 / 20 | 20 | **4.9★/2,969** | *Creamy Skyr chicken and mushroom pasta* — still a runner-up |
| One-pan chicken à la crème (7481) | 372 / 34 | 20 | 4.8★/82 | *Creamy Skyr chicken and mushroom pasta* |
| Chicken in white wine with mushrooms (9263) | 344 / 32 | 30 | 4.5★/36 | *Creamy Skyr chicken and mushroom pasta* |
| Healthy chicken cacciatore (5525) | 483 / 43 | 26 | 4.9★/200 | *Creamy Skyr chicken and mushroom pasta* |

**Tinned tuna — 4.** The library already has five tuna dishes.

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Tuna with green salad (4175) | 433 / 40 | 25 | 5.0★/15 | *Tuna and white bean salad* |
| Tuna salad, guacamole dressing (2752) | 299 / 27 | 20 | 4.8★/148 | *Tuna poke-style bowl* |
| Tuna tartare with avocado (5067) | 214 / 20 | 10 | 4.8★/19 | *Tuna quinoa bowl with avocado* |
| Healthy tuna sandwich (4841) | 273 / 30 | 15 | 4.6★/129 | *Turkey and Hüttenkäse sandwich*, *Skyr egg salad on rye* |

**Curry and chilli — 5.** The Asian shelf is the library's deepest.

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Quick chicken tikka masala (5537) | 134 / 15 | 20 | 4.9★/209 | *Cauliflower and chicken curry with rice* |
| Chicken tikka masala wraps (7744) | 472 / 46 | 25 | 4.9★/44 | *Thai green chicken curry* |
| Satay chicken with peanut sauce (1565) | 435 / 43 | 30 | 4.8★/155 | *Peanut noodles with edamame* |
| Turkey chilli con carne (6172) | 397 / 41 | 28 | 4.5★/76 | *Turkey chilli* |
| Quick chilli con carne (5452) | 180 / 17 | 15 | 5.0★/30 | *Football-night chilli con carne* |

**Fish soup — 3.** I took the chicken one (pick 14) because lemon-rice soup is the dish that was missing.

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Pressure-cooker fish soup (5079) | 340 / 34 | 30 | 4.8★/162 | pick 14 |
| Pressure-cooker velvety fish soup (6088) | 278 / 31 | 25 | 4.7★/128 | pick 14 — still a runner-up |
| Seafood and vegetable soup (4423) | 359 / 34 | 30 | 4.4★/22 | pick 14 |

**Prawns and mussels — 5.** Picks 7 and 13 are already two prawn dishes.

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Shrimp souvlaki (3703) | 351 / 30 | 15 | 4.9★/123 | picks 7 and 13 |
| Shrimp souvlaki with bacon (3828) | 363 / 34 | 21 | 5.0★/25 | picks 7 and 13 |
| Spicy coconut shrimp, turmeric (4758) | 559 / 49 | 15 | 4.8★/130 | picks 7 and 13, and it is Asian |
| Mussels in coconut ginger sauce (401) | 273 / 31 | 25 | 5.0★/114 | *Thai green curry*, *gochujang pork* |
| Healthy shrimp pasta (4727) | 482 / 42 | 17 | 4.8★/158 | *Prawn aglio e olio with courgette noodles* |

**Wraps, eggs and sweets — 8.**

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Spinach tortilla wraps, turkey (9235) | 286 / 31 | 21 | unrated | *Mini turkey wrap*, *Turkey and cheese roll-ups* |
| Quick chicken avocado burritos (3500) | 691 / 62 | 20 | 4.9★/74 | *Köfte wrap with yoghurt sauce* |
| Chicken and avocado tacos (6916) | 295 / 28 | 25 | 4.8★/58 | *Air-fryer fish tacos with slaw* |
| Egg white and chicken sausage omelette (7537) | 232 / 23 | 17 | 4.4★/31 | *Air-fryer egg and turkey muffins* |
| Egg white omelette, cream cheese, turkey (9107) | 287 / 26 | 18 | 5.0★/30 | *Oven frittata with spinach and potato*, *Menemen with feta* |
| Chicken and potato stir-fry with eggs (5482) | 303 / 31 | 25 | 4.2★/25 | *Oyakodon — chicken and egg rice bowl* |
| Chocolate protein pudding (8637) | 167 / 17 | 15 | 4.4★/31 | *Chocolate quark mousse*, *High-protein pudding* |
| Frozen yoghurt (9221) | 135 / 16 | 10 | 5.0★/15 | *Skyr berry "ice cream"* |

**Salads and sandwiches — 4.**

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Light chef salad (6651) | 364 / 39 | 15 | 4.7★/70 | pick 11 |
| Chicken salad, yoghurt dressing (2708) | 134 / 15 | 20 | 4.8★/266 | pick 10 |
| Leftover spicy chicken salad (7464) | 294 / 32 | 10 | 4.7★/14 | *Leftover chicken wrap with garlic Skyr* |
| Coronation sandwich on wholewheat (2970) | 443 / 50 | 10 | 4.8★/81 | *Skyr egg salad on rye* |

**More fish dinners — 3.** Picks 3, 4 and 5 are already three fish dinners.

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Sea bass fricassée (4096) | 374 / 34 | 19 | 4.5★/86 | picks 3, 4 and 5 |
| Sea bass with lentils (4075) | 404 / 39 | 30 | 4.9★/54 | pick 3, plus *Red lentil dal with spinach* |
| Marinated salmon and lemon skewers (3830) | 205 / 18 | 18 | 3.8★/15 | five salmon dishes already in the library — and the only sub-4★ thing in this whole list |

**Beans, beef, pasta — 3.**

| dish | kcal / P | min | rating | collides with |
|---|---|---|---|---|
| Chicken with veggies and beans (5028) | 511 / 48 | 30 | 4.7★/89 | *Turkish white beans (fasulye)*, *Baked cod with fennel and white beans* |
| Beef with peppers and quinoa (4442) | 440 / 38 | 30 | 4.8★/91 | *Beef skewers with grilled vegetables*, *Sous-vide chicken with herb quinoa* |
| Greek chicken and vegetable pasta (6967) | 557 / 51 | 25 | 4.8★/57 | *Creamy Skyr chicken and mushroom pasta*, *Spaghetti with tuna* |

That is 6+4+4+4+5+3+5+8+4+3+3 = **49**. Four of them are rated above 4.8★ with more
than 200 votes, so "already covered" is a judgement about *your* library, not about the
food. If any named collision above is a library recipe you two don't actually like, the
Greek version is the better swap and I'll make the trade.

### Not shoppable here (10)

Whitebait — *atherína* — twice (88, 5508): not sold in German supermarkets, and
deep-fried. Octopus (5359), fresh squid (3159), fresh mussels (5831), scallops (4934),
lobster (4330). Sole meunière (3604) is buyable but £-a-portion, floured and fried, and
677 kcal. "Sea bream in wine" (3459) is really *gópes*, a fish you cannot get here —
I had this on the shortlist until I read the ingredient list, which is the reason to
read ingredient lists. Salted cured skipjack (84) cures for days and is a preserve.

### Offal (4) and treat food (4)

Beef liver three ways (5377 — 4.8★ from 537, the highest-rated thing I threw out —
8656, 3367) and pan-fried chicken liver (6661). I assumed no; if you two actually eat
liver, *riganato* is 126 kcal for 16 g protein in 15 minutes and I should put it in.
Steak pizza (7063), chicken and waffles (5476), stuffed cheeseburger (3832), pork belly
in Asian marinade (4015) — all fine food, none of it a weight-loss weeknight.

### Runners-up (7) — the honest answer to "why not these"

Nothing wrong with any of these. They were cut to keep the first batch reviewable.

| dish | kcal / P | min | rating | what it adds |
|---|---|---|---|---|
| Chicken à la crème (2897) | 214 / 20 | 20 | **4.9★ from 2,969** | the most-rated recipe of all 89 by a factor of two |
| Grilled Greek burgers — *biftéki* (6732) | 214 / 21 | 25 | 4.8★ from 201 | there is no biftéki in the library, and it is a Greek staple |
| Prosciutto-wrapped turkey (8741) | 281 / 47 | 25 | 5.0★ from 5 | best protein-per-calorie of anything not picked |
| Chicken stuffed with mozzarella and sun-dried tomato (4021) | 585 / 61 | 30 | 4.9★ from 44 | a big Saturday dinner, which the weekend pool is thin on |
| Pressure-cooker velvety fish soup (6088) | 278 / 31 | 25 | 4.7★ from 128 | second use for the pressure cooker, and it blends |
| Tuna tagliata with pomegranate (4422) | 854 / 112 | 20 | 4.8★ from 29 | the highest protein on the site, at steak prices |

## Tasks

- [x] Confirm the site exposes structured, per-portion macros (it does, plus grams)
- [x] Pull the sitemap, scrape the candidate set, gate it on time and protein density
- [x] Work out what the library is actually short of
- [x] Full-site scrape pass (all 5,393), re-rank, finalise the shortlist
- [x] Pull all 65 lamb recipes, check their ingredient lists, fold 4 into the shortlist
- [x] **Your go-ahead** — approved all 20, no liver, plus 32 of the 49 "collisions"
      and 5 Greek classics. Final batch: **57 new recipes**.
- [ ] Write tests first: every new recipe passes `validateRecipe` with zero errors
      *and* zero warnings, and each new id is unique
- [ ] Convert the approved picks into library records
- [ ] Run the full suite, rebuild `dist/meal-planner.html`
- [ ] Generate a week and confirm the planner still hits targets with the bigger pool
- [ ] Update README counts

## How each one gets converted

Not copied. For each dish I take the ingredient proportions and the technique, then
write the record with **explicit per-portion gram amounts** and recompute kcal and
protein for the composition I actually list — because the source's figures cover only
the quantified ingredients (their gyro's 253 kcal is the meat alone; the pita, the
tzatziki and the chips are listed without amounts). The source's per-portion numbers
then act as a cross-check on the parts they do cover. Method lines are written fresh in
the library's own terse voice; their prose stays on their site.
