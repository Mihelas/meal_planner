// Getting the app onto a home screen, which is two unrelated problems wearing
// one name.
//
// Android fires `beforeinstallprompt` before showing its own banner. Calling
// preventDefault() on it suppresses the banner and hands you the event, which can
// be replayed later from a button of your own. That is the whole API, and it is
// single-use: Chrome will not honour the same event twice.
//
// iOS has none of this. Safari fires no event, exposes no API, and the only route
// is Share -> Add to Home Screen. There is nothing to hook, so the app has to say
// it in words or it does not happen. Of the two phones this is built for, one is
// each, so neither path is the edge case.
//
// Everything takes `win` rather than touching the global, the same way sync.js
// does, so all of it is testable without a browser.

/** True for anything running WebKit-on-iOS, including the iPads that lie. */
function isIOS(win) {
  const ua = win.navigator?.userAgent ?? '';
  if (/iphone|ipod|ipad/i.test(ua)) return true;
  // iPadOS 13 onward reports a desktop Mac user agent. A Mac that claims touch
  // points is the giveaway -- no actual Mac reports more than one.
  return /macintosh/i.test(ua) && (win.navigator?.maxTouchPoints ?? 0) > 1;
}

/** True once the app is launched from the home screen rather than a browser tab. */
function isStandalone(win) {
  // Two ways to be installed, and a phone only ever answers one of them: the
  // standard media query, and the flag Safari shipped years before it.
  if (win.matchMedia?.('(display-mode: standalone)')?.matches) return true;
  return win.navigator?.standalone === true;
}

/**
 * What, if anything, to say about installing -- before any browser event.
 *
 * `installed` nothing to offer, it is already on the home screen.
 * `ios-hint`  no API exists; show the Share -> Add to Home Screen instructions.
 * `none`      a desktop browser, or an Android that has not offered yet.
 */
export function installState(win) {
  if (isStandalone(win)) return 'installed';
  if (isIOS(win)) return 'ios-hint';
  return 'none';
}

/**
 * Watches for the Android install event and replays it on demand.
 *
 * `state()` is `installState` plus the one thing it cannot know: whether the
 * browser has actually offered an install yet. The button is rendered off
 * `can-prompt` and nothing else, because a button rendered before the event
 * arrives is a button that silently does nothing -- worse than no button.
 */
export function createInstaller(win) {
  let deferred = null;
  let installed = false;
  const watchers = new Set();
  const notify = () => watchers.forEach((fn) => fn());

  const onPrompt = (ev) => {
    // Suppresses Chrome's own banner, which would otherwise appear at whatever
    // moment it liked, on top of whatever the user was reading.
    ev.preventDefault?.();
    deferred = ev;
    notify();
  };
  const onInstalled = () => {
    // Fires however the install happened, including from the browser's own menu,
    // so the button goes away even when it was not the thing that was pressed.
    installed = true;
    deferred = null;
    notify();
  };

  win.addEventListener('beforeinstallprompt', onPrompt);
  win.addEventListener('appinstalled', onInstalled);

  return {
    state() {
      if (installed) return 'installed';
      const base = installState(win);
      return base === 'none' && deferred ? 'can-prompt' : base;
    },
    /** Returns an unsubscribe, so a re-render cannot stack duplicate watchers. */
    onChange(fn) {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    /**
     * Show the browser's install dialog. `accepted` puts the button away for
     * good; `dismissed` leaves it, because Chrome re-fires the event later and a
     * "not now" is not a "never".
     */
    async prompt() {
      if (!deferred) return 'unavailable';
      const ev = deferred;
      await ev.prompt?.();
      const outcome = (await ev.userChoice)?.outcome ?? 'dismissed';
      if (outcome === 'accepted') {
        installed = true;
        deferred = null;
      }
      notify();
      return outcome;
    },
    stop() {
      win.removeEventListener('beforeinstallprompt', onPrompt);
      win.removeEventListener('appinstalled', onInstalled);
      watchers.clear();
    },
  };
}
