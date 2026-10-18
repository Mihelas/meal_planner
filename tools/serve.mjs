// A static server for `dist/`, used only to verify the built output in a browser.
// The portable artefact is opened from file:// — this exists because the preview
// tooling needs an http origin, and because the installable build cannot be
// checked any other way: a service worker will not register from a file, and a
// manifest will not load from one either.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT ?? 4173);

// A browser refuses a service worker served as anything but JavaScript, and
// ignores a manifest served as anything but JSON, both silently. Guessing from
// the extension is the whole job.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // Resolve inside dist and check it stayed there. This only ever serves a build
  // on a laptop, but "../../" is two keystrokes and the check is one line.
  const target = path.resolve(dist, `.${url.endsWith('/') ? `${url}index.html` : url}`);
  if (target !== dist && !target.startsWith(dist + path.sep)) {
    res.writeHead(403).end('outside dist');
    return;
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream',
      // Without this the service worker and the shell get cached by the browser
      // on top of being cached by the worker, and a rebuild appears to do nothing.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => {
  console.log(`serving dist on http://localhost:${port}`);
  console.log(`  portable file  http://localhost:${port}/meal-planner.html`);
  console.log(`  installable    http://localhost:${port}/pwa/`);
});
