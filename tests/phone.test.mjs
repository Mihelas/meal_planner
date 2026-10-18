// The app as a thing on a phone, driven through the built file.
//
// src/install.js has its own unit tests for the capability detection. What this
// file checks is the half that cannot be unit tested: that the detection is
// actually wired to something a thumb can press, that the two phones in this
// household each get the route that works for them, and that the chrome of the
// app survives a notch and a 44px fingertip.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { open, root } from './harness.mjs';

const CSS = readFileSync(path.join(root, 'src', 'ui.js'), 'utf8');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0.0.0 Mobile Safari/537.36';

/** Pose as a given phone. jsdom's userAgent is a prototype getter, so this shadows it. */
const pose = (ua, extra = {}) => (win) => {
  Object.defineProperty(win.navigator, 'userAgent', { value: ua, configurable: true });
  for (const [k, v] of Object.entries(extra)) {
    Object.defineProperty(win.navigator, k, { value: v, configurable: true });
  }
};

/** The install event Chrome fires, with the two members the app uses. */
function offerInstall(win, outcome = 'accepted') {
  const calls = { prompts: 0 };
  const ev = new win.Event('beforeinstallprompt');
  ev.prompt = () => { calls.prompts++; return Promise.resolve(); };
  ev.userChoice = Promise.resolve({ outcome });
  win.dispatchEvent(ev);
  return calls;
}

// --- Android: a real button, but only when the browser allows one.

test('no install button until the browser says an install is possible', () => {
  // Chrome will not honour a prompt it did not offer, so a button rendered
  // before the event is a button that silently does nothing when pressed.
  const app = open({ extend: pose(ANDROID) });
  assert.deepEqual(app.errors, []);
  assert.equal(app.$('[data-act="install"]'), null, 'offered an install before the browser did');
});

test('the install button appears when Chrome offers, and installs when pressed', async () => {
  const app = open({ extend: pose(ANDROID) });
  const calls = offerInstall(app.window);

  const btn = app.$('[data-act="install"]');
  assert.ok(btn, 'Chrome offered an install and the app never showed a button');
  assert.match(app.text(), /home screen/i, 'the button never says what it is for');

  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.prompts, 1, 'the button did not replay the captured event');
  // Spent event: Chrome refuses a second use, so the button must go rather than
  // stay on as a no-op.
  assert.equal(app.$('[data-act="install"]'), null, 'the button stayed after a successful install');
});

test('a declined install leaves the button, because Chrome will offer again', async () => {
  const app = open({ extend: pose(ANDROID) });
  offerInstall(app.window, 'dismissed');
  app.$('[data-act="install"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(app.$('[data-act="install"]'), 'a "not now" removed the button for good');
});

// --- iOS: no event will ever come, so it has to be said in words.

test('an iPhone is told the one route Safari has', () => {
  // There is no API at all on iOS. If the app does not spell out Share -> Add to
  // Home Screen, one of the two phones this is built for never installs it.
  const app = open({ extend: pose(IPHONE) });
  assert.deepEqual(app.errors, []);
  const text = app.text();
  assert.match(text, /Share/i, 'no mention of the Share button');
  assert.match(text, /Add to Home Screen/i, 'no mention of Add to Home Screen');
  // And no button, because there is nothing for one to do.
  assert.equal(app.$('[data-act="install"]'), null, 'offered an install button Safari cannot honour');
});

test('the iOS hint can be put away, and stays away after a reload', () => {
  const app = open({ extend: pose(IPHONE) });
  const dismiss = app.$('[data-dismiss-install]');
  assert.ok(dismiss, 'the hint has no way to be dismissed, so it nags for ever');
  dismiss.click();
  assert.ok(!/Add to Home Screen/i.test(app.text()), 'the hint is still there after dismissing it');

  const again = open({ stored: app.saved(), extend: pose(IPHONE) });
  assert.ok(!/Add to Home Screen/i.test(again.text()), 'the dismissed hint came back on reload');
});

test('an app already on the home screen says nothing about installing', () => {
  const app = open({ extend: pose(IPHONE, { standalone: true }) });
  assert.ok(!/Add to Home Screen/i.test(app.text()), 'nagging an app that is already installed');
  assert.equal(app.$('[data-act="install"]'), null);
});

test('a desktop browser is not nagged about a phone app', () => {
  const app = open();
  assert.ok(!/Add to Home Screen/i.test(app.text()));
  assert.equal(app.$('[data-act="install"]'), null);
});

// --- A new version landing in the cache.

test('a waiting update offers a reload rather than taking one', () => {
  // The service worker caches a new build in the background. Swapping the app out
  // mid-edit would lose the edit, so the decision belongs to whoever is holding
  // the phone -- which means the app has to ask.
  const messages = [];
  const app = open({
    extend: (win) => {
      Object.defineProperty(win.navigator, 'serviceWorker', {
        configurable: true,
        value: { controller: { postMessage: (m) => messages.push(m) }, addEventListener() {} },
      });
    },
  });
  assert.ok(!/newer version/i.test(app.text()), 'announced an update before one arrived');

  app.window.dispatchEvent(new app.window.CustomEvent('mp:update-ready'));
  assert.match(app.text(), /newer version/i, 'a cached update was never mentioned');

  const reload = app.$('[data-act="reload-app"]');
  assert.ok(reload, 'the update notice has no way to take it');
  reload.click();
  // Without this the waiting worker never activates and the next launch is the
  // old app again.
  assert.deepEqual(messages, ['skip-waiting'], 'the waiting worker was never told to take over');
});

test('nothing about updates breaks a browser with no service worker at all', () => {
  const app = open({
    extend: (win) => {
      Object.defineProperty(win.navigator, 'serviceWorker', { value: undefined, configurable: true });
    },
  });
  app.window.dispatchEvent(new app.window.CustomEvent('mp:update-ready'));
  app.$('[data-act="reload-app"]').click();
  assert.deepEqual(app.errors, [], `the page threw: ${app.errors.join('; ')}`);
});

// --- The chrome of the app on a real handset.

test('every button is big enough to hit with a thumb', () => {
  // 44px is Apple's floor and about where mis-taps stop. There is no layout
  // engine here, so this reads the declarations rather than the computed box --
  // which is enough, because the only way to end up under the floor is for some
  // rule to say so.
  // Found by string search rather than a built regex: every selector here starts
  // a line and contains dots, and escaping them into a pattern is more ways to be
  // wrong than it is worth.
  const rule = (sel) => {
    const at = CSS.indexOf(`\n${sel} {`);
    assert.ok(at >= 0, `no CSS rule for ${sel}`);
    const body = CSS.slice(at + sel.length + 3);
    return body.slice(0, body.indexOf('}'));
  };
  const floor = (sel) => {
    const found = rule(sel).match(/min-height:\s*(\d+)px/);
    return found ? Number(found[1]) : null;
  };

  // Every control a finger goes for. The week grid ones matter most and were the
  // ones missed first time round: the action icons on a meal row were 32px, the
  // meal name itself 20px tall, and the stars 18px square.
  for (const sel of ['.btn', 'nav.tabs button', '.modes button', '.slot-name', '.stars button']) {
    assert.ok((floor(sel) ?? 0) >= 44, `${sel} has no 44px floor`);
  }

  // `.btn.small` is the one that regresses: it is defined by taking the padding
  // off, which on its own would drag the whole control under the line. Either it
  // leaves the inherited floor alone or it restates it -- it may not lower it.
  const small = floor('.btn.small');
  assert.ok(small === null || small >= 44, `.btn.small lowers the floor to ${small}px`);
  // Height alone is not enough for a one-glyph button: 44x26 is still a mis-tap.
  for (const sel of ['.btn.small', '.stars button']) {
    assert.match(rule(sel), /min-width:\s*(4[4-9]|[5-9]\d)px/,
      `${sel} has no width floor, so the icon buttons stay thin`);
  }

  // The four icons on a meal row are the one exception, and it is a deliberate
  // one: at 44px wide, four of them plus the label leave no room for the meal
  // name on a phone. They stay 32px painted and reach 44 through a pseudo-element
  // that grows into the padding between rows -- vertically only, because widening
  // them would put each one on top of its neighbour's glyph.
  assert.match(CSS, /\.slot-acts button::after \{[^}]*height: 44px/,
    'the meal-row icons have neither a 44px box nor a 44px hit area');
  assert.match(rule('.slot-acts button'), /position: relative/,
    'the hit-area overlay has nothing to position against, so it will not line up');
});

test('the layout keeps clear of the notch and the home indicator', () => {
  // viewport-fit=cover is what lets the page use the whole screen; without the
  // insets it also puts the header under the notch and the last button under the
  // home bar, where iOS swallows the tap.
  assert.match(CSS, /env\(safe-area-inset-top/, 'nothing accounts for the notch');
  assert.match(CSS, /env\(safe-area-inset-bottom/, 'nothing accounts for the home indicator');
  for (const side of ['left', 'right']) {
    assert.match(CSS, new RegExp(`env\\(safe-area-inset-${side}`), `nothing accounts for the ${side} inset in landscape`);
  }
});
