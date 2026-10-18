// Installing the app is two completely different experiences and the app has to
// know which one it is in.
//
// Android fires `beforeinstallprompt`, which can be captured and replayed from a
// real button. iOS Safari fires nothing, offers no API, and the only route is
// Share -> Add to Home Screen, which nobody discovers on their own. So on iOS the
// app has to say so in words. Get this wrong and one of the two phones in this
// household simply never installs it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installState, createInstaller } from '../src/install.js';

/** A window with only the bits installState looks at. */
function fakeWin({ ua = '', standalone = false, matches = false, prompt = false } = {}) {
  const listeners = {};
  return {
    navigator: { userAgent: ua, ...(standalone === null ? {} : { standalone }) },
    matchMedia: () => ({ matches }),
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
    fire: (type, ev = {}) => (listeners[type] ?? []).forEach((f) => f(ev)),
    listenerCount: (type) => (listeners[type] ?? []).length,
    __prompt: prompt,
  };
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0.0.0 Safari/537.36';

test('an iPhone is told how to install, because Safari will never offer', () => {
  assert.equal(installState(fakeWin({ ua: IPHONE })), 'ios-hint');
});

test('an iPad is an iPhone for this purpose, however it reports itself', () => {
  // iPadOS 13 onward sends a desktop Mac user agent. The giveaway is a Mac that
  // reports touch points, which no real Mac does.
  const ipad = fakeWin({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' });
  ipad.navigator.maxTouchPoints = 5;
  assert.equal(installState(ipad), 'ios-hint');
});

test('an already-installed app says nothing about installing', () => {
  // Two ways to be installed: the standards one, and Safari's own flag.
  assert.equal(installState(fakeWin({ ua: ANDROID, matches: true })), 'installed');
  assert.equal(installState(fakeWin({ ua: IPHONE, standalone: true })), 'installed');
});

test('a desktop browser is not nagged to install a phone app', () => {
  assert.equal(installState(fakeWin({ ua: DESKTOP })), 'none');
});

test('Android offers a real button only once the browser says it can', () => {
  // The event is the permission. Showing a button before it arrives gives a
  // button that does nothing, which is worse than no button.
  const win = fakeWin({ ua: ANDROID });
  const inst = createInstaller(win);
  assert.equal(inst.state(), 'none', 'offered an install before the browser allowed one');

  let changed = 0;
  inst.onChange(() => { changed++; });
  win.fire('beforeinstallprompt', { preventDefault() { this.defaultPrevented = true; } });
  assert.equal(inst.state(), 'can-prompt');
  assert.equal(changed, 1, 'the UI was not told the button became available');
});

test('the captured event is replayed on the button, and only once', async () => {
  const win = fakeWin({ ua: ANDROID });
  const inst = createInstaller(win);
  let prompts = 0;
  const ev = {
    preventDefault() {},
    prompt() { prompts++; return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  };
  win.fire('beforeinstallprompt', ev);

  assert.equal(await inst.prompt(), 'accepted');
  assert.equal(prompts, 1);
  // Chrome will not honour the same event twice, so the app must not pretend it
  // can: the button goes away rather than becoming a no-op.
  assert.equal(inst.state(), 'installed');
  assert.equal(await inst.prompt(), 'unavailable', 'replayed a spent prompt event');
  assert.equal(prompts, 1);
});

test('a declined install leaves the button there to try again', () => {
  // Chrome re-fires beforeinstallprompt later, so a "not now" is not final.
  const win = fakeWin({ ua: ANDROID });
  const inst = createInstaller(win);
  win.fire('beforeinstallprompt', {
    preventDefault() {},
    prompt: () => Promise.resolve(),
    userChoice: Promise.resolve({ outcome: 'dismissed' }),
  });
  return inst.prompt().then((outcome) => {
    assert.equal(outcome, 'dismissed');
    assert.equal(inst.state(), 'can-prompt', 'a dismissed prompt removed the button');
  });
});

test('installing through the browser menu also puts the button away', () => {
  const win = fakeWin({ ua: ANDROID });
  const inst = createInstaller(win);
  win.fire('beforeinstallprompt', { preventDefault() {}, prompt: () => Promise.resolve() });
  assert.equal(inst.state(), 'can-prompt');
  win.fire('appinstalled', {});
  assert.equal(inst.state(), 'installed');
});

test('pressing the button with no captured event does not throw', async () => {
  // The button should never be visible then, but a stale render or a fast tap
  // must not take the whole app down with an exception.
  const inst = createInstaller(fakeWin({ ua: ANDROID }));
  assert.equal(await inst.prompt(), 'unavailable');
});

test('stopping the installer leaves no listeners behind', () => {
  const win = fakeWin({ ua: ANDROID });
  const inst = createInstaller(win);
  assert.ok(win.listenerCount('beforeinstallprompt') > 0);
  inst.stop();
  assert.equal(win.listenerCount('beforeinstallprompt'), 0);
  assert.equal(win.listenerCount('appinstalled'), 0);
});
