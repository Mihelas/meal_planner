// The built artefact the end-to-end tests drive, built at most once.
//
// Thirteen test files need `dist/`: eleven through the jsdom harness, plus the
// two that read the installable tree. Each used to run the whole build in its
// own process -- thirteen builds producing identical bytes, five to seven
// seconds apiece, most of it spent rendering four PNGs through deflate level 9
// that only two of those files ever look at.
//
// This was never a correctness problem: `put()` in tools/build.mjs already
// writes through a per-pid temp file and renames, so a reader sees either the
// old file or the new one and never half of either. It was simply thirteen
// times the work.
//
// So build only when `dist/` is older than something it is built from. `npm test`
// builds once up front and every test file then finds the output fresh and skips
// it; running one file on its own still rebuilds, which is the whole reason the
// build was put here rather than left to be remembered by hand.
//
// Not a *.test.mjs file on purpose: the runner must not treat it as a suite.

import { execFileSync } from 'node:child_process';
import { statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything a build reads, and the outputs that prove it ran. `pwa/` is in here
// because sw.js and CNAME are copied through rather than generated, so editing
// one changes the output without changing a single module in src/.
const SOURCE_DIRS = ['src', 'tools', 'pwa'];
const OUTPUTS = [
  path.join('dist', 'meal-planner.html'),
  path.join('dist', 'pwa', 'index.html'),
  path.join('dist', 'pwa', 'sw.js'),
];

const mtime = (p) => {
  try { return statSync(p).mtimeMs; } catch { return NaN; }
};

function newestSource() {
  let newest = 0;
  for (const dir of SOURCE_DIRS) {
    for (const name of readdirSync(path.join(root, dir))) {
      const at = mtime(path.join(root, dir, name));
      if (at > newest) newest = at;
    }
  }
  return newest;
}

/** Build `dist/` unless it is already newer than every source it comes from. */
export function ensureBuilt() {
  // A missing output gives NaN, and NaN loses every comparison it is in -- so
  // check for a real number rather than trusting the `>` below to be false.
  const oldestOutput = Math.min(...OUTPUTS.map((p) => mtime(path.join(root, p))));
  if (Number.isFinite(oldestOutput) && oldestOutput > newestSource()) return;
  execFileSync(process.execPath, [path.join(root, 'tools', 'build.mjs')], { cwd: root, stdio: 'pipe' });
}
