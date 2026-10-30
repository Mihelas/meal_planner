# Meal Planner

A weekly meal plan for two people with different calorie targets, built around one
constraint: **30 minutes of cooking on a weekday**. Dinner is cooked big and
tomorrow's lunch comes out of the same pot, which is the part that stops the week
collapsing into pizza and bread and cheese.

The deliverable is a single file — `dist/meal-planner.html`. Double-click it. No
server, no internet, no install. It remembers everything in the browser it was
opened in.

On a phone, open **[pikaeats.com](https://pikaeats.com)** and add it to the home
screen. Same app, installable, and it keeps working with no signal.

- **Android / Chrome** — a banner offers it, or ⋮ → **Install app**.
- **iPhone / Safari** — there is no prompt and there never will be: **Share** (the
  square with the arrow out of it) → **Add to Home Screen**. It has to be Safari;
  Chrome on iOS cannot install anything.

Installed, it opens with no browser bar and no address to mistype, and the service
worker means a shop with no signal is not a problem.

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

Two ways, and they run the same merge. An account is the one for phones; the shared
file is the one for two desktops and no account.

**With an account.** Settings → **Account** → type an email. The mail has a link *and*
a 6-digit code, and either signs in the browser it is used in — so open the link on the
phone you want signed in, or type the code there. No password, ever.

Sign-up is closed: an address with no account here is told so rather than sent a code
that would create one. The page is public — it is a static file, and any browser that
loads it has the whole app — but the mailbox behind it is not, which is the part that
costs money. Adding somebody is three steps in `supabase/dashboard.md`.

Then Settings → **Households** → **Start a household**, and **Invite** the other person:
that gives a code to send them however you like. They sign in on their own phone, type
the code into **Join with a code**, and from then on both phones plan the same week —
a swap on one shows up on the other within half a minute, and both work offline in
between. Settings → **The shared week** says, in one line, whether the last change
actually reached the household.

Joining a household does not hand your week over. The first time two weeks meet, the
app stops and asks which one to keep rather than guessing.

**With a shared file.** Settings → **Sharing**. Link both browsers to the same JSON file
in a shared folder (Dropbox, OneDrive, a synced drive) and the app merges rather than
overwrites. Needs Chrome or Edge; everywhere else Export/Import does the same job by
hand.

Either way, the week merges **meal by meal**: she swaps Tuesday's dinner while you log a pizza on
Thursday and both survive, because every plate carries the time it was last changed and
the later change wins on that plate alone. Bans, ticks, ratings, notes, your own
recipes, weigh-ins and the cupboard merge too, and a **deletion sticks** — un-banning a
recipe or un-ticking an item is recorded as a removal rather than quietly re-added from
the other copy. Settings are last-write-wins. If one of you re-rolls the whole week it
is no longer the same week, so the newer one replaces the other and the app says so.

Nobody has to press anything. The file side re-reads before it writes, and again when
you come back to the tab or every minute while it is open. The account side holds one
row per household behind a revision number: a change is only written if nothing has
changed underneath it, and if something has, the app pulls what landed, merges, and
pushes again.

### When sync disagrees

- **"The household has a newer week than this phone"** — somebody edited on the other
  phone in the same few seconds. Nothing is lost; it retries by itself. **Try again now**
  is there for impatience, not for repair.
- **"Saving to the household…" that does not go away** — the phone has no usable
  connection. The edit is on the phone and queued; it goes out on its own when the signal
  comes back, and it survives the app being closed.
- **Two weeks, one question** — only on the first sign-in, when both the phone and the
  household already hold a planned week. They share no history, so a merge would produce
  a week neither of you planned. Pick one. **Export your data** first if you want the
  other one kept.
- **A shared file that cannot be read or parsed is never written over** — fix or remove
  the file; the app will not overwrite what it could not understand.
- **"It is no longer the same week"** — one of you pressed **New week**. That replaces
  rather than merges, on purpose, and the app says so.

**Export your data** (Settings) before switching browser or clearing site data.
Without an account nothing is uploaded anywhere — the sync file is a file on your own
disk. With one, the week travels through your household's row in Supabase
(`supabase/migrations/`), and the browser copy is still the one the app reads.

## Where it lives

`pikaeats.com`, served by GitHub Pages from `dist/pwa/` on every push to `main`.
The domain is pointed by `pwa/CNAME`, which the build copies into the published
tree — Pages reads it from there, not from the repository, and a deploy replaces
that tree wholesale, so a CNAME that is only committed un-points the domain on
the next push. `tests/pwa.test.mjs` fails if the build stops copying it.

Every path in the app is relative (`start_url`, `scope`, the worker registration,
every asset). That is what let the app move from a project subpath to a domain
root without a code change, and it is what keeps the portable single file working
from a Downloads folder, where there is no origin at all.

Supabase's own settings — the ones that cannot live in a migration — are written
down in `supabase/dashboard.md`.

## Working on it

```
npm test      # 721 tests, no browser needed
npm run build # src/*.js -> dist/meal-planner.html (542 kB, 15 modules inlined)
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
- `src/remote.js` — the account: email sign-in by link or 6-digit code, the session
  in its own storage key, and silent refresh. Knows nothing about meals.
- `src/rest.js` — how a request is made and how a refusal becomes a sentence a person
  can read. One definition, because households and the shared week ask the same
  database the same way.
- `src/household.js` — membership: who shares a plan with whom, invites, seats. Almost
  all of the rule is in `supabase/migrations/0003` and `0004`; this asks and reports.
- `src/cloud.js` — the week itself travelling. One row per household guarded by a
  revision, a debounce so typing is one push, and a poll for what the other phone
  wrote. Knows nothing about the shape of the document — `merge` is handed in.
- `src/sync.js` — the shared-file link. Transport (File System Access API + a handle in
  IndexedDB) is separate from `mergeStates`, which is pure and knows nothing about files.
- `src/install.js` — the home-screen nudge, which is a different sentence on Android
  (an event to catch) than on iOS (no API at all, so prose).
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
