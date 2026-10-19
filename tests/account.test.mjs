// The account surface, driven against the real built file.
//
// The one guarantee worth more than the rest is the first test: the app plans a
// week with no account, no session and a `fetch` that throws if anything touches
// it. Local-first is not a slogan here -- it is the reason this thing works in a
// supermarket basement, and an account must never become a precondition for it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from './harness.mjs';

/** A fetch that records, and answers from a queue. */
function fakeFetch(replies = []) {
  const calls = [];
  const queue = [...replies];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const { status = 200, payload = {} } = next ?? {};
    return { ok: status < 400, status, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  fn.calls = calls;
  return fn;
}

const withFetch = (fn) => ({ extend: (win) => { win.fetch = fn; } });

test('the whole app works with no account and a network that would throw', () => {
  let touched = 0;
  const app = open({
    extend: (win) => {
      win.fetch = () => { touched += 1; throw new Error('the app went to the network to plan a week'); };
    },
  });

  assert.deepEqual(app.errors, [], `the page threw: ${app.errors.join('; ')}`);
  assert.equal(app.$$('.day').length, 7, 'seven day cards');
  assert.ok(app.saved(), 'the week was not saved locally');
  assert.equal(touched, 0, 'something called fetch on a cold boot with no session');
});

test('settings offers an account, and says plainly that signed out is fine', () => {
  const app = open(withFetch(fakeFetch()));
  app.tab('settings');
  const panel = app.$('[data-panel="account"]');
  assert.ok(panel, 'there is no account panel in Settings');
  assert.match(panel.textContent, /not signed in/i);
  assert.match(panel.textContent, /stays on this phone/i, 'it does not say what signed out means');
  assert.ok(app.$('#account-email'), 'nowhere to type an email address');
});

test('asking for a link sends one request and then tells you to go and read your email', async () => {
  const fetch = fakeFetch([{ status: 200, payload: {} }]);
  const app = open(withFetch(fetch));
  app.tab('settings');
  app.set('#account-email', 'someone@example.com', 'input');
  app.click('[data-act="account-signin"]');
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(fetch.calls.length, 1, `${fetch.calls.length} requests went out`);
  assert.match(fetch.calls[0].url, /\/auth\/v1\/otp$/);
  assert.equal(fetch.calls[0].body.email, 'someone@example.com');
  const panel = app.$('[data-panel="account"]').textContent;
  assert.match(panel, /someone@example\.com/, 'it does not say where the email was sent');
  assert.match(panel, /code/i, 'it does not mention the code, which is the half that survives a link scanner');
});

test('a send that fails offline says so, and the week is still there', async () => {
  const app = open({ extend: (win) => { win.fetch = () => { throw new TypeError('Failed to fetch'); }; } });
  app.tab('settings');
  app.set('#account-email', 'someone@example.com', 'input');
  app.click('[data-act="account-signin"]');
  await new Promise((r) => setTimeout(r, 0));

  assert.match(app.$('[data-panel="account"]').textContent, /offline/i);
  assert.equal(app.$$('.day').length, 7, 'the week went away over a failed sign-in');
  assert.deepEqual(app.errors, []);
});

test('an email link signs you in, and the token does not stay in the address bar', async () => {
  const app = open({
    extend: (win) => {
      win.fetch = fakeFetch();
      win.location.hash = '#access_token=at-h&refresh_token=rt-h&expires_in=3600&token_type=bearer';
    },
  });
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(app.errors, []);
  app.tab('settings');
  assert.match(app.$('[data-panel="account"]').textContent, /signed in/i);
  assert.equal(app.window.location.hash, '', 'the access token is still in the URL');
  assert.equal(app.saved().includes('rt-h'), false, 'the refresh token went into the saved week');
});

test('once a link is sent there is somewhere to type the code from the email', async () => {
  const fetch = fakeFetch([
    { status: 200, payload: {} },
    { status: 200, payload: { access_token: 'at-c', refresh_token: 'rt-c', expires_in: 3600, user: { email: 'someone@example.com' } } },
  ]);
  const app = open(withFetch(fetch));
  app.tab('settings');
  app.set('#account-email', 'someone@example.com', 'input');
  app.click('[data-act="account-signin"]');
  await new Promise((r) => setTimeout(r, 0));

  const box = app.$('#account-code');
  assert.ok(box, 'no code box after a link was sent');
  app.set('#account-code', '123456', 'input');
  app.click('[data-act="account-verify"]');
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(fetch.calls.length, 2, `${fetch.calls.length} requests went out`);
  assert.match(fetch.calls[1].url, /\/auth\/v1\/verify$/);
  assert.deepEqual(fetch.calls[1].body, { email: 'someone@example.com', token: '123456', type: 'email' });
  assert.match(app.$('[data-panel="account"]').textContent, /signed in/i);
  assert.deepEqual(app.errors, []);
});

test('a code survives the page being thrown away while the mail app was open', async () => {
  // The realistic failure: ask for a code on a phone, switch to the mail app,
  // and come back to a page the OS has reloaded from the service worker. The
  // address must still be there or the code in your hand is worthless.
  const first = fakeFetch([{ status: 200, payload: {} }]);
  const one = open(withFetch(first));
  one.tab('settings');
  one.set('#account-email', 'someone@example.com', 'input');
  one.click('[data-act="account-signin"]');
  await new Promise((r) => setTimeout(r, 0));
  const carried = one.window.localStorage.getItem('mealplanner.signin');
  assert.ok(carried, 'nothing was kept for after the reload');

  const second = fakeFetch([{ status: 200, payload: { access_token: 'at-c', expires_in: 3600 } }]);
  const two = open({
    extend: (win) => {
      win.fetch = second;
      win.localStorage.setItem('mealplanner.signin', carried);
    },
  });
  two.tab('settings');
  assert.ok(two.$('#account-code'), 'the reloaded page forgot a code was on its way');
  two.set('#account-code', '123456', 'input');
  two.click('[data-act="account-verify"]');
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(second.calls[0].body.email, 'someone@example.com');
  assert.match(two.$('[data-panel="account"]').textContent, /signed in/i);
});

test('signing out returns to the signed-out panel and leaves the week alone', async () => {
  const app = open({
    extend: (win) => {
      win.fetch = fakeFetch([{ status: 204, payload: {} }]);
      win.location.hash = '#access_token=at-h&refresh_token=rt-h&expires_in=3600';
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  app.tab('settings');

  const before = app.$$('.day').length;
  app.click('[data-act="account-signout"]');
  await new Promise((r) => setTimeout(r, 0));

  assert.match(app.$('[data-panel="account"]').textContent, /not signed in/i);
  assert.equal(app.$$('.day').length, before, 'the week went with the session');
  assert.deepEqual(app.errors, []);
});
