# v6 — a real app: installable on both phones, accounts and households

**Goal.** One URL that installs to the home screen on an iPhone and an Android,
with real accounts, households you invite someone into, and a plan that stays in
step across every device — and that still works with no signal in a supermarket.

**Decided with Nick:** mixed iPhone + Android · full accounts and households ·
Supabase.

---

## Architecture — the calls, and why

### A1. No bundler, no npm dependency. Talk to Supabase over plain `fetch`.

The app is ten zero-dependency modules inlined by a 144-line build, and that is
most of why it is still pleasant to work on. `supabase-js` would force a bundler
in and take the single-file property with it. It buys nothing here: Supabase *is*
PostgREST plus GoTrue, and both are plain HTTP — an `apikey` header and a bearer
JWT. A `remote.js` of roughly 250 lines covers sign-in, refresh and the document
read/write.

Kept as a result: the build, the 502 tests, and a `meal-planner.html` that still
works as a local-only file for anyone who never makes an account.

### A2. The week stays a JSON document. Membership becomes real tables.

A generated week is one atomic thing — nothing queries it relationally, and
normalising it into `days`/`entries` tables would touch all ten modules and most
of the test suite to buy nothing.

Membership is the opposite: Row Level Security policies are SQL, and they are the
entire security model, so who-is-in-which-household has to be relational.

```
profiles            (id -> auth.users, display_name)
households          (id, name, created_at, created_by)
household_members   (household_id, user_id, role, person_id)
household_invites   (code, household_id, person_id, expires_at, redeemed_by)
household_state     (household_id, doc jsonb, rev int, updated_at, updated_by)
```

`household_members.person_id` is the join between an account and a person inside
the plan (`nick` / `partner`), which is how someone logs in and sees themselves
rather than a seat number.

### A3. Offline first. `localStorage` stays the working copy.

This gets used in a Rewe with no signal. The server is a sync point, not the
source of truth. The UI never waits on the network, and `mergeStates` already
resolves divergence with tombstones.

### A4. Optimistic concurrency on `rev`, not last-write-wins.

Push sends the `rev` it last saw; if the server moved, pull, merge, retry. The
existing file sync documents last-write-wins as a known limit — on two phones
that limit becomes real, so it gets fixed here rather than carried forward.

### A5. The anon key is public on purpose.

It ships in a public HTML file because that is what it is for. Security is RLS in
Postgres, which the client cannot talk its way around. Worth writing down so it is
never mistaken for a leak and "fixed" by hiding it somewhere useless.

---

## Increment 1 — installable, offline, thumb-sized

- [x] `manifest.webmanifest` — name, `display: standalone`, theme colour, icons
- [x] Icons: 192/512 PNG + maskable + `apple-touch-icon` — drawn in code by
      `tools/icons.mjs`, so every size renders from one ~30-line description
- [x] Service worker: cache the shell, serve it offline, update on new version
- [x] Android: a real Install button from `beforeinstallprompt`
- [x] iOS: Safari gives no prompt, so detect and show the Share → Add to Home
      Screen hint instead of silently offering nothing
- [x] Touch targets to 44 px (`.btn.small` is ~24 px today) and safe-area insets
      for the notch — with one documented exception, below
- [x] `tools/build.mjs` emits **both**: `dist/meal-planner.html` (one portable
      file, unchanged) and `dist/pwa/` (shell + manifest + sw + icons)
- [x] Tests: manifest and SW are well-formed; the single file still boots
      (`tests/pwa.test.mjs` 13, `tests/install.test.mjs` 10,
      `tests/phone.test.mjs` 11, `tests/sw.test.mjs` 11)

**Verifiable:** installs on both phones, launches fullscreen with no browser
chrome, and loads with the network off. No backend involved yet.

### What was verified, and how

- **Touch targets, measured in a real browser** against the served build: every
  control now has a 44 px hit box. The tab strip, the day-card mode switch, the
  meal name and the star ratings grew; the four action icons on a meal row
  (swap/note/ban/lock) stayed 32 px **wide** and reach 44 px tall through a
  pseudo-element that grows into the padding between rows. They cannot grow
  sideways: four 44 px squares plus the slot label leave no room for a legible
  meal name on a 375 px screen. Making that row work at 44×44 means redesigning
  it — an overflow menu, or icons that appear only on the expanded detail — which
  is a deliberate piece of design work, not part of this increment.
- **The service worker's behaviour**, not just its syntax: `tests/sw.test.mjs`
  loads the built worker into a stub global and drives install/activate/fetch/
  message. It proves a cold start offline serves the app, a deep link offline
  falls back to the shell, a cache hit does not wait on the network, a changed
  asset is announced exactly once, and — the one that matters most later — that
  the worker never answers a cross-origin request or a POST, so Supabase traffic
  passes straight through it.
- **Not** verified in a browser: service-worker registration itself. The embedded
  browser pane refuses to register any worker, including a three-line no-op, so
  this is an environment limit rather than an app one. First real check is
  installing it on a phone.

### Shipped

Commit `44c7c20` on `main`, pushed to github.com/Mihelas/meal_planner
(private) on 2026-10-18 — 56 files, 18,788 lines, the whole app as one
initial commit. Not split into engine-then-PWA: Increment 1 edits `ui.js`
and `app.js` in place, so a first commit without `install.js` would not
have built. `.gitattributes` pins LF, because the build hashes the shell
into the service worker's cache name and a CRLF checkout would stamp a
different version on every machine.

## Increment 2 — the backend, proven to keep people apart

- [ ] Supabase project, schema from A2, migrations committed as SQL
- [ ] RLS: read/write `household_state` only for members of that household
- [ ] `redeem_invite(code)` as a Postgres function — a joining user cannot yet
      read the household, so this cannot be done client-side
- [ ] Prove isolation with two real users via curl: A cannot read B's household,
      cannot write it, and cannot redeem a spent invite

**Verifiable:** the isolation test output, not an assurance that RLS is on.

## Increment 3 — sign in

- [ ] `src/remote.js`: magic-link sign-in, token store, silent refresh, sign-out
- [ ] Injectable `fetch` so it is testable with a fake, like `sync.js` injects `win`
- [ ] Account UI: signed-out stays fully usable, local-only
- [ ] Tests: expiry, refresh, a rejected token, an offline sign-in attempt

**Verifiable:** log in on both phones; the app still works logged out.

## Increment 4 — the plan travels

- [ ] `remote.js` gains the `createSync` interface: `pull`, `push`, `schedule`,
      `watch`, `flush`, `status`
- [ ] `rev` concurrency per A4, with pull-merge-retry on conflict
- [ ] First sign-in asks **keep this device's week, or take the household's?** —
      explicitly, because silently picking one eats a week of someone's edits
- [ ] Tests: concurrent edits converge; an offline edit survives and pushes later

**Verifiable:** edit on the iPhone, watch it land on the Android.

## Increment 5 — households

- [ ] Create a household; invite by code; join; members list; roles; leave
- [ ] Map each member to a person in the plan (`person_id`)
- [ ] Guard the last admin leaving, and a revoked invite
- [ ] Tests: the join flow end to end, and every guard

**Verifiable:** partner joins from her own phone and appears as Partner in the plan.

## Increment 6 — ship it

- [ ] Cloudflare Pages, custom domain, HTTPS
- [ ] Offline QA on both phones: airplane mode, cold start, background for a day
- [ ] Data-loss review: every path that can overwrite a week, written down
- [ ] Migrate the current `file://` data across once via Export → Import
- [ ] README: install, invite, what to do when sync disagrees

**Verifiable:** both phones running the installed app against the live backend.

---

## Known risks

- **Origin change loses the current data.** `localStorage` is per-origin, so the
  week and weight log on `file://` do not follow to `https://`. One deliberate
  Export → Import, done once, as a step — not discovered later.
- **It breaks the one-file property.** A service worker cannot be inlined; it has
  to be separately fetchable. Hence two build outputs rather than converting the
  single file into a folder and losing it.
- **Supabase free tier pauses after 7 days of no requests.** Daily use never
  trips it; a holiday might, and then it needs a manual unpause.
- **iOS install is invisible.** No prompt, Safari only — if it is not explained in
  the app, it does not happen.
- **`app.js` is 1,664 lines** and gains auth, households and invites. If it starts
  to sprawl, the account surface moves to its own module rather than growing it.
