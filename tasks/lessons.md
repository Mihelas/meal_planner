# Lessons

Persistent knowledge base. Every entry: what went wrong, why, and the rule that
prevents it next time. No user corrections yet — these are all self-caught during
the v1/v2 build, and each one cost real time.

## A loose regex in a test can match the data, not the bug

**What went wrong.** A test asserted a batch-cook week had no reheat entries with
`/reheat/`. It failed. The app was right: the library contains a recipe literally
named *"Football-night chicken rice bowl (reheat only)"*, and the regex matched the
recipe name.

**Why.** The assertion was written against the concept ("is this a reheat?") instead
of the string the app actually produces for that concept ("reheat Nick's batch").
Recipe names are user-facing prose and will collide with any short keyword.

**Rule.** When asserting on rendered text, match the *template* the code emits, not a
word that could appear in content. Before believing a red test about app behaviour,
print what the app actually produced and check the test is asking the right question.

## Git Bash `/tmp` does not exist for Windows Python

**What went wrong.** Wrote a temp file to `/tmp/newcss.txt` from bash, then read it
from python: `FileNotFoundError`.

**Why.** Git Bash emulates `/tmp` inside its own MSYS root; `python.exe` is a native
Windows process and resolves `/tmp` against nothing.

**Rule.** Use the session scratchpad directory or the project cwd for temp files that
cross a bash/python boundary. Never a POSIX-looking absolute path.

## Windows console is cp1252

**What went wrong.** `print()` of a string containing an emoji or a real minus sign
crashed the script with `UnicodeEncodeError`.

**Why.** stdout encoding is cp1252, not UTF-8, so any non-Latin-1 character is
unencodable — even though writing the same string to a file with `encoding='utf-8'`
is fine.

**Rule.** Keep script output ASCII. Non-ASCII goes into files, never through stdout.

## Large bash heredocs fail

**What went wrong.** A multi-hundred-line heredoc died with `unexpected EOF`.

**Rule.** Above roughly 50 lines, write the file with the Write tool instead of
piping a heredoc.

## `node --test tests/` does not work here

**What went wrong.** Passing the directory found no tests.

**Rule.** Always bare `node --test` from the project root. A full run is >120 s, so
run it in the background.

## Re-render wholesale, with one deliberate exception

**Context, not a mistake — worth keeping.** `render()` rebuilds `innerHTML` and
`wire()` re-attaches handlers, so a single `sync.schedule()` at the end of `render()`
covers every mutation path. The custom-recipe form is the one place that must *not*
re-render on input, or the caret and the sibling fields are lost; it buffers into a
module-level `draft` instead.

**Rule.** If a new form needs per-keystroke state, buffer it — do not re-render.

## A jsdom timer nobody cleared hangs the suite

**What went wrong.** Calling `sync.watch()` at boot started a 60 s `setInterval` in
every jsdom window the tests open, and no test closes its window. jsdom timers are
real node timers, so the process never exited: `node --test tests/app-v2.test.mjs`
ran past 120 s with no output and looked like an infinite loop in the app.

**Why it happened.** I reached for "run it and see" without asking what the new code
leaves behind when the test ends. A hang reports nothing, so it costs far more to
diagnose than a failure does.

**Rule.** Any repeating timer added to page code needs two answers before the suite is
run: when does it stop, and who clears it in tests. Here both improved the design —
the timer is armed only while a file is actually linked, and `tests/harness.mjs` now
closes every window it opened in a `test.after` hook.

## Look at the real saved state, not just the tests

**Context, not a mistake — worth keeping.** The merge was green across 26 unit tests
while the actual browser profile held a week with no `plan.id`, because ids are
assigned at generation and that week predated them. The per-plate merge would have
done nothing until the next re-roll. Found by reading `localStorage` in the live page;
fixed by backfilling the id in `migrate()`.

**Rule.** After any schema change, read the real persisted state in the browser and
check every new field is actually populated — a passing suite only proves the fresh
path works.

## Check where `git` actually points before offering to commit

**What went wrong.** I closed v3 by offering to commit. There is no repo:
`Projects/meal-planner/` has no `.git` and never has. I had taken the session's
reported git status at face value — it came from `Projects/jacque-lendar`, a different
project the session was started in before the working directory was pointed here.

**Why it happened.** Treating ambient context as a fact about the directory I was
working in. A branch name and a clean tree say nothing about *which* tree.

**Rule.** Before any claim or offer involving git, confirm the repo root:
`git rev-parse --show-toplevel`. If it is not the directory being worked in, say so.

**And the live hazard:** `C:\Users\U1063190` is itself a git repo, so git run from
anywhere under the profile resolves there. `git add` from inside `meal-planner` would
stage the whole home directory, OneDrive included. Never run a staging or committing
command under the profile without checking the toplevel first.

## Never build an edit anchor from text you read through `iconv`

**What went wrong.** Several `Edit` calls failed with "matched 0" against files I had
only ever read through `iconv -f UTF-8 -t ASCII//TRANSLIT -c`. That pipe is needed
because the console is cp1252, but it rewrites the file as it prints: em dashes become
`-`, `ss` stands in for an eszett. I was pattern-matching against a lossy rendering and
calling it the file.

**Why it happened.** Treating a display transcoding as the source of truth. The prose in
this project is full of em dashes, so almost any sentence-shaped anchor is affected.

**Rule.** Anchor edits on pure-ASCII tokens only - expression text, attribute names,
function signatures - never on prose. When prose must be touched, replace a short ASCII
fragment inside it, or do the edit in Python and assert the match count first. A
`python -c "... assert t.count(old)==1 ..."` check turns a silent mis-edit into a loud
failure.

## Backticks inside a double-quoted bash string are command substitution

**What went wrong.** A `python -c "..."` call whose script contained Markdown code spans
produced twenty `command not found` errors and a Python syntax error. Bash expanded every
backtick before Python ever saw the script.

**Rule.** Any script containing backticks, `$`, or template literals goes in a file via
`Write` and is then run by path - not into `-c` through a double-quoted shell string.
That also makes the script re-runnable and reviewable.

## Check the declaration order before registering a handler

**What went wrong.** I registered `act('shopdays-all', ...)` next to the handler it was
most similar to, which sat ~80 lines ABOVE the `const act = ...` that defines it. `const`
is in a temporal dead zone until evaluated, so `wire()` threw
`ReferenceError: Cannot access 'act' before initialization` and the entire app render
died - not just the new feature.

**Why it happened.** Placing code by topical similarity rather than by what is in scope
at that point. The file is long enough that "near the related thing" and "after the
helper it uses" are different places.

**Rule.** When adding a call to a helper in a long function, grep for the helper's
declaration line and confirm it is above the insertion point. And trust a sudden mass
DOM-test failure: when every browser test breaks at once, the render is broken, not the
assertions.

## A positional index is not a weekday, and a label is not free

**What went wrong.** Implementing "start the week on any day" I replaced the twelve
positional `DAYS[...]` labels I had grepped for, declared the sweep complete, and missed
three `DAYS.map(...)` rows in settings (cook-up days, football, meals out). Those rows
are keyed by position, so they went on reading in Monday order while the week itself had
rotated - silently pointing the user at the wrong day.

**Why it happened.** I grepped for one spelling of the mistake (`DAYS[`) and assumed it
was the whole class.

**Rule.** When a change makes an index stop meaning what it used to, enumerate every
place that index is rendered, not every place one syntax appears: grep the identifier
itself (`DAYS`) and read each hit. Then write the test that would have caught the miss -
here, asserting the option text of every day picker in settings.

## Also worth keeping

- `$CLAUDE_SCRATCHPAD` is not set in the Bash tool. Use the absolute scratchpad path.
- Scratchpad `.mjs` files must import project modules by absolute
  `file:///C:/Users/.../src/x.js` URL; a relative path resolves against the temp dir and
  fails with `ERR_MODULE_NOT_FOUND`.
- Node's `console.log` has no printf width specifiers. `%5d` prints literally; use
  `padStart`/`padEnd`.
- `preview_start` resolves the launch config of the session's original project, which is
  `jacque-lendar`, not `meal-planner`. It served the wrong app and reported a different
  title. Check `document.title` before believing a preview, and serve this project with
  `node tools/serve.mjs` (port 4173) instead.
- Before accepting an inherited plan, verify its load-bearing assumptions in the source.
  The plan carried into this session (rotate `plan.days`, keep settings weekday-keyed)
  would have touched ~40 call sites and ~15 test files; checking that `day.index` is a
  position and that `isWeekday` reads that index turned it into a ~20-line change.

## A build that writes in place cannot be run twice at once

**What went wrong.** A full-suite run came back 32 red, every one a DOM test, with a
`SyntaxError` at a line of code I had never touched. I had just changed the planner, so
the obvious reading was that I had broken it. I had not: the test harness rebuilds the
single-file app on import, `node --test` runs test files in parallel, and the builds were
interleaving their writes into one output path. The file on disk was two builds spliced
together.

**Why it happened.** I read "many tests failed right after my edit" as "my edit broke
them" and started from the planner. The real tell was in the error itself - the broken
line was in `migrate`, nowhere near my change - and in the fact that the same file passed
when run alone.

**Rule.** When a mass failure points at code the change never touched, re-run the
suspect file in isolation before investigating the change. And any build step that other
processes may run concurrently writes to a temp path and renames: a rename is atomic, so
the worst case is a wasted build rather than a corrupt artifact. This also protects the
user - an interrupted build can no longer leave a half-written app on disk.

## Two people sharing a kitchen share the meal

**What went wrong.** Nothing I wrote - but worth keeping. The per-person meal slot made
"they each get their own lunch" the default, and it took a user question to notice. The
exclude list then actively enforced the wrong behaviour: because each pick was removed
from the pool before the next draw, the two plates could not coincide even by chance.

**Rule.** When a data shape is per-person, ask separately for each slot whether the
people are *supposed* to differ there, and whose budget decides. And watch for a
de-duplication list applied at the wrong loop level: an exclude meant to give variety
*across days* was being applied *within* a day, where it enforced divergence instead.

## A feature can pass every unit test and still be wrong at the week level

**What went wrong.** Vegetarian days shipped past 537 green tests while silently turning
*whole batch weeks* meatless. Each unit test asked a local question -- are the right days
chosen, is every meal on one of them vegetarian, is the count right -- and every answer
was yes. Nobody asked the week-level question: in batch mode a day's dinner is not its
own, one pot is reheated across its span, so choosing three scattered days handed a
vegetarian pot to the four days that asked for meat. Three asked for, seven served. The
only thing that found it was the independent audit, which generated 504 whole weeks and
classified each dinner from its German ingredient names.

**Root cause.** The tests were written from the implementation's own unit of work (a day)
rather than from the feature's unit of promise (a week). Batch mode is a different shape
of week, and no test varied `cookingStyle` while the feature was on.

**Rule.** For anything that selects across a structure, write at least one test that
asserts a property of the *whole* structure, and one that varies the structure's mode.
Then prove each regression test red: disable the fix, confirm the test fails, restore.
Two of the four batch tests caught their bug; the other two were pinning properties that a
different change had already fixed, and I only know which is which because I checked.

## A filter needs an answer for "nothing qualifies" that is not "give up"

**What went wrong.** The protein narrowing was written as `pool.filter(clears the ask)`
with `return enough.length ? enough : pool`. That fallback looks safe and is the bug: when
no dish can clear the ask, the narrowing switches itself off on exactly the slots carrying
the whole day's debt, and the slot goes back to a lottery among 3 g snacks. Tightening the
predicate made it *worse* -- more empty sets, more fallbacks, fewer slots actually
narrowed. Audit misses went 12 -> 15 when I made the filter stricter.

**Root cause.** A filter is the wrong shape when the question is "which of these is best".
Filtering has an empty case; ranking does not.

**Rule.** When narrowing a candidate set by a threshold, check what happens when nothing
meets it. If the honest answer is "take the best available", write it as a ranking
(`max` of a coverage score, keep everything tied or near it) rather than a filter with a
fallback. Same result when something qualifies, no cliff when nothing does.

## When the validator and the code disagree, find out which premise moved

**What went wrong.** After the batch fix the independent vegetarian-day audit went from
"all clear" to 13 failures, all of the form "only 3 meatless, expected >= 4". The
temptation is symmetric and both directions are wrong: trust the audit and revert a
correct fix, or trust the code and quietly relax the audit.

**Root cause.** The audit asserted `meatless >= min(want, eligible)`, which encodes an
assumption -- that any eligible day can be made meatless on its own -- that batch mode
had just made false by design. The audit was not wrong when written; a deliberate
decision had moved underneath it.

**Rule.** Before changing either side, name the premise the disagreement rests on and say
which decision moved it. If a decision did, update the validator *and* record why in a
comment at the assertion. If none did, the code is wrong. Never relax an assertion without
being able to point to the decision that invalidated it.

---

## Hand the user a command their shell can actually run

**What went wrong.** I gave Nick a verifier command written for bash -- `cd ... && VAR=x node ...`
-- and his terminal is PowerShell 5.1, which has neither `&&` nor an inline env-var prefix.
It died on a parser error that had nothing to do with the thing being tested, and cost a
round trip to work out.

**Root cause.** I have a Bash tool, so I write bash without noticing. The user's Terminal
panel is PowerShell. Those are two different shells and only one of them is his.

**Rule.** A command in a fenced block is for the *user's* shell: PowerShell on this machine.
`$env:VAR='x'; node ...`, `;` not `&&`. Better still, if the command needs environment
variables or several steps, run it myself with the Bash tool and paste the output -- there is
no reason to make him translate it.

---

## A validator that writes must be able to run twice

**What went wrong.** `tools/verify-isolation.mjs` had account A redeem an invite into a
household and then left it there. The run passed. The second run failed with "somebody is
already in that seat" -- against a database that was working perfectly -- and for a moment I
read a red line as a security finding.

**Root cause.** The check asserted on an outcome that its own previous run had made
impossible. Test state was shared, mutable and never cleaned up.

**Rule.** Any check that mutates a shared backend starts by putting the world into the state
it assumes, and ends by putting it back. `ensureHousehold` rather than `createHousehold`;
leave the household at the end of the test that joined it; delete the invite rows written by
hand. A validator that only passes on a clean database is a validator nobody will trust the
second time, and the fault it reports will be its own.

---

## Partially-selected SQL reports success

**What went wrong.** Three migrations "ran successfully" but the database had RLS enabled on
all five tables and not one policy -- the editor had run only the selected fragment of
`0002_rls.sql`, and reported that fragment's success.

**Root cause.** Two compounding things: a SQL editor runs a selection when there is one, and
`create policy` has no `or replace`, so a half-applied run could not be repaired by running
the file again.

**Rule.** Migrations meant to be pasted by hand must be idempotent from the top: `create
table if not exists`, `create or replace function`, `drop trigger if exists` before each
trigger, and a `do` block that drops the policies before recreating them. And never accept
"it ran fine" as evidence that a security migration applied -- query `pg_policies` and count.
