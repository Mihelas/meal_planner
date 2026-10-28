// Proof that RLS keeps households apart, run against the real project over HTTP.
//
// This deliberately shares no code with the app. It talks to PostgREST with bare
// fetch, as a stranger would, because a validator built on the same client as the
// thing it validates can only prove the two agree.
//
// What it is looking for is mostly *absence*: RLS filters rows rather than
// refusing requests, so a policy that is wide open and a policy that is airtight
// both answer 200. A test asserting "not 403" would pass against a database with
// no security at all. Every isolation check below asserts on the rows.
//
//   MP_A_EMAIL=... MP_A_PASSWORD=... MP_B_EMAIL=... MP_B_PASSWORD=... \
//     node tools/verify-isolation.mjs

const URL_BASE = 'https://xtcjakhoeehmrzdtzcvr.supabase.co';
// Public by design (A5). Security is the policies, not this string.
const KEY = 'sb_publishable_nxZzg-3P0__Ki-DwbTe5lA_c5a1R2EG';

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`missing ${name}. This needs two confirmed test accounts:\n`
      + '  MP_A_EMAIL / MP_A_PASSWORD / MP_B_EMAIL / MP_B_PASSWORD');
    process.exit(2);
  }
  return v;
};

async function api(path, { token, method = 'GET', body, prefer } = {}) {
  const headers = { apikey: KEY, 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${URL_BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not every error is JSON */ }
  return { status: res.status, json, text };
}

const rpc = (token, fn, args) =>
  api(`/rest/v1/rpc/${fn}`, { token, method: 'POST', body: args });

async function signIn(email, password) {
  const r = await api('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email, password },
  });
  if (!r.json?.access_token) {
    throw new Error(`could not sign in as ${email}: ${r.status} ${r.text.slice(0, 200)}`);
  }
  return r.json.access_token;
}

/**
 * Find this account's household by name, or make it.
 *
 * Idempotent on purpose: nothing can delete a household yet, so a script that
 * created one per run would silt the project up with rows no policy can reach.
 */
async function ensureHousehold(token, name, seat) {
  const mine = await api(`/rest/v1/households?select=id,name&name=eq.${encodeURIComponent(name)}`, { token });
  if (mine.json?.length) return mine.json[0].id;
  const made = await rpc(token, 'create_household', { household_name: name, seat });
  if (made.status >= 300 || typeof made.json !== 'string') {
    throw new Error(`create_household failed: ${made.status} ${made.text.slice(0, 200)}`);
  }
  return made.json;
}

/**
 * Undo a join. The "leave a household" policy in 0002 allows exactly this and
 * nothing more, so calling it doubles as a check that leaving works.
 */
async function leaveHousehold(token, userId, hid) {
  await api(`/rest/v1/household_members?household_id=eq.${hid}&user_id=eq.${userId}`,
    { token, method: 'DELETE' });
}

// --- the tiniest harness that still reports usefully

const results = [];
async function check(label, fn) {
  try {
    await fn();
    results.push({ label, ok: true });
    console.log(`  ok    ${label}`);
  } catch (err) {
    results.push({ label, ok: false, why: err.message });
    console.log(`  FAIL  ${label}\n          ${err.message}`);
  }
}
function expect(cond, why) {
  if (!cond) throw new Error(why);
}

// --- the run

const A = await signIn(need('MP_A_EMAIL'), need('MP_A_PASSWORD'));
const B = await signIn(need('MP_B_EMAIL'), need('MP_B_PASSWORD'));

const idOf = async (token) => (await api('/auth/v1/user', { token })).json?.id;
const AID = await idOf(A);
const BID = await idOf(B);

const HA = await ensureHousehold(A, 'Isolation test A', 'a-owner');
const HB = await ensureHousehold(B, 'Isolation test B', 'b-owner');
// A third household, never joined by A, so the isolation assertions above stay
// true after the invite tests have deliberately let A into one.
const HC = await ensureHousehold(B, 'Isolation test C', 'c-owner');

console.log(`\nA owns ${HA}\nB owns ${HB} and ${HC}\n`);
console.log('household isolation');

await check("A reads A's own plan", async () => {
  const r = await api(`/rest/v1/household_state?household_id=eq.${HA}&select=rev,doc`, { token: A });
  expect(r.status === 200, `status ${r.status}`);
  expect(r.json?.length === 1, `expected one row, got ${JSON.stringify(r.json)}`);
});

await check("A cannot read B's plan", async () => {
  const r = await api(`/rest/v1/household_state?household_id=eq.${HB}&select=rev,doc`, { token: A });
  // 200 with no rows is the correct answer; a 403 would also be fine, but [] is
  // what RLS actually does and the point is that the rows are not there.
  expect(r.json?.length === 0, `A was handed ${JSON.stringify(r.json)}`);
});

await check("A cannot write B's plan", async () => {
  const r = await api(`/rest/v1/household_state?household_id=eq.${HB}&rev=eq.0`, {
    token: A, method: 'PATCH', prefer: 'return=representation',
    body: { doc: { tampered: true }, rev: 1 },
  });
  expect(r.json?.length === 0 || r.status >= 400,
    `the patch touched ${JSON.stringify(r.json)}`);
  // And prove it from B's side rather than trusting the empty answer.
  const after = await api(`/rest/v1/household_state?household_id=eq.${HB}&select=doc,rev`, { token: B });
  expect(after.json?.[0]?.doc?.tampered === undefined, "B's plan was modified");
});

await check('A cannot add itself to B household', async () => {
  // A's real id, not a placeholder: a malformed uuid would be rejected on type
  // before any policy was consulted, and the test would pass having proved
  // nothing about the policy it is named after.
  const r = await api('/rest/v1/household_members', {
    token: A, method: 'POST', prefer: 'return=representation',
    body: { household_id: HB, user_id: AID, role: 'member', person_id: 'gatecrash' },
  });
  expect(r.status >= 400, `the insert returned ${r.status} ${r.text.slice(0, 120)}`);
  const mine = await api(`/rest/v1/household_members?household_id=eq.${HB}&select=person_id`, { token: B });
  expect(!mine.json?.some((m) => m.person_id === 'gatecrash'), 'A got in');
});

await check("A cannot read B's invite codes", async () => {
  const code = await rpc(B, 'create_invite', { target_household: HB, seat: 'spy-bait' });
  expect(typeof code.json === 'string', `create_invite gave ${code.text.slice(0, 120)}`);
  const r = await api(`/rest/v1/household_invites?select=code,person_id`, { token: A });
  const leaked = r.json?.some((i) => i.code === code.json);
  await api(`/rest/v1/household_invites?code=eq.${code.json}`, { token: B, method: 'DELETE' });
  expect(!leaked, 'A can read invites it has no part in');
});

await check('a signed-out caller reads nothing at all', async () => {
  for (const table of ['profiles', 'households', 'household_members', 'household_invites', 'household_state']) {
    const r = await api(`/rest/v1/${table}?select=*`, {});
    const rows = Array.isArray(r.json) ? r.json.length : 0;
    expect(rows === 0, `anon read ${rows} rows from ${table}`);
  }
  const r = await rpc(null, 'redeem_invite', { invite_code: 'ANYTHINGXX' });
  expect(r.status >= 400, `anon could call redeem_invite: ${r.status}`);
});

console.log('\noptimistic concurrency on rev');

await check('a push with the rev it last saw succeeds', async () => {
  const now = await api(`/rest/v1/household_state?household_id=eq.${HA}&select=rev`, { token: A });
  const rev = now.json[0].rev;
  const r = await api(`/rest/v1/household_state?household_id=eq.${HA}&rev=eq.${rev}`, {
    token: A, method: 'PATCH', prefer: 'return=representation',
    body: { doc: { at: new Date().toISOString() }, rev: rev + 1 },
  });
  expect(r.json?.length === 1, `expected one row updated, got ${r.text.slice(0, 160)}`);
  expect(r.json[0].rev === rev + 1, `rev is ${r.json[0].rev}, expected ${rev + 1}`);
});

await check('a push with a stale rev touches nothing', async () => {
  const now = await api(`/rest/v1/household_state?household_id=eq.${HA}&select=rev`, { token: A });
  const stale = now.json[0].rev - 1;
  const r = await api(`/rest/v1/household_state?household_id=eq.${HA}&rev=eq.${stale}`, {
    token: A, method: 'PATCH', prefer: 'return=representation',
    body: { doc: { stale: true }, rev: stale + 1 },
  });
  expect(r.json?.length === 0, 'a stale push went through, so an edit was lost');
});

await check('rev cannot jump', async () => {
  const now = await api(`/rest/v1/household_state?household_id=eq.${HA}&select=rev`, { token: A });
  const rev = now.json[0].rev;
  const r = await api(`/rest/v1/household_state?household_id=eq.${HA}&rev=eq.${rev}`, {
    token: A, method: 'PATCH', prefer: 'return=representation',
    body: { doc: { jumped: true }, rev: rev + 50 },
  });
  expect(r.status >= 400, `rev jumped to ${rev + 50} unchallenged`);
});

await check('an update that pushes nothing is refused', async () => {
  // The branch that lets account deletion work. An FK action nulls updated_by
  // without touching doc or rev, and enforce_rev has to let that through -- so
  // it must still refuse the same shape of update when a client sends it, or
  // updated_by becomes a field anybody in the household can hand-write.
  const before = await api(`/rest/v1/household_state?household_id=eq.${HA}&select=rev,updated_by`, { token: A });
  const seen = before.json[0];
  const r = await api(`/rest/v1/household_state?household_id=eq.${HA}&rev=eq.${seen.rev}`, {
    token: A, method: 'PATCH', prefer: 'return=representation',
    body: { updated_by: null },
  });
  expect(r.status >= 400, `a client blanked updated_by: ${r.text.slice(0, 160)}`);
  const after = await api(`/rest/v1/household_state?household_id=eq.${HA}&select=updated_by`, { token: A });
  expect(after.json[0].updated_by === seen.updated_by, 'updated_by changed despite the refusal');
});

console.log('\ninvites');

let joinCode = null;

await check('a valid invite lets A into C, and only C', async () => {
  await leaveHousehold(A, AID, HC);
  const made = await rpc(B, 'create_invite', { target_household: HC, seat: 'guest' });
  expect(typeof made.json === 'string', `create_invite gave ${made.text.slice(0, 160)}`);
  joinCode = made.json;
  expect(/^[A-HJ-NP-Z2-9]{10}$/.test(joinCode), `odd-looking code ${joinCode}`);

  const joined = await rpc(A, 'redeem_invite', { invite_code: joinCode });
  expect(joined.json === HC, `redeem returned ${joined.text.slice(0, 160)}`);

  const seen = await api(`/rest/v1/household_state?household_id=eq.${HC}&select=rev`, { token: A });
  expect(seen.json?.length === 1, 'A joined C but cannot read it');
  // Joining one household must not have opened the other.
  const nope = await api(`/rest/v1/household_state?household_id=eq.${HB}&select=rev`, { token: A });
  expect(nope.json?.length === 0, 'joining C also opened B');
});

await check('a spent invite cannot be redeemed again', async () => {
  const again = await rpc(B, 'redeem_invite', { invite_code: joinCode });
  expect(again.status >= 400, `a spent code was accepted: ${again.text.slice(0, 160)}`);
});

await check('an expired invite is refused', async () => {
  // The function clamps expiry to at least a day, so an expired one has to be
  // written directly -- which B is allowed to do for its own household.
  const code = `EXPIRED${Math.floor(Math.random() * 900 + 100)}`;
  const put = await api('/rest/v1/household_invites', {
    token: B, method: 'POST', prefer: 'return=representation',
    body: {
      code, household_id: HC, person_id: 'ghost',
      created_by: BID,
      expires_at: '2020-01-01T00:00:00Z',
    },
  });
  expect(put.status < 300, `could not write the expired invite: ${put.text.slice(0, 160)}`);
  const r = await rpc(A, 'redeem_invite', { invite_code: code });
  await api(`/rest/v1/household_invites?code=eq.${code}`, { token: B, method: 'DELETE' });
  expect(r.status >= 400, 'an expired invite was accepted');
});

await check('a nonsense code is refused the same way as a wrong one', async () => {
  const r = await rpc(A, 'redeem_invite', { invite_code: 'ZZZZZZZZZZ' });
  expect(r.status >= 400, 'a made-up code was accepted');
  expect(!/expired|already|redeemed/i.test(r.text),
    `the error distinguishes failure modes, which helps a guesser: ${r.text.slice(0, 160)}`);
});

console.log('');
console.log('ending a household');

await check('a plain member cannot delete the household', async () => {
  // A is a member of C by now, not its owner.
  const code = await rpc(B, 'create_invite', { target_household: HC, seat: 'guest' });
  if (typeof code.json === 'string') await rpc(A, 'redeem_invite', { invite_code: code.json });
  const r = await rpc(A, 'delete_household', { target_household: HC });
  expect(r.status >= 400, `a member deleted somebody else's household: ${r.status}`);
  const still = await api(`/rest/v1/household_state?household_id=eq.${HC}&select=rev`, { token: B });
  expect(still.json?.length === 1, "C's plan is gone");
});

await check('an owner cannot delete it out from under the other member', async () => {
  // A is in C, so B -- who owns it -- must be refused.
  const r = await rpc(B, 'delete_household', { target_household: HC });
  expect(r.status >= 400, 'B deleted a household A was still in');
  expect(/leave first/i.test(r.text), `refused, but not for that reason: ${r.text.slice(0, 160)}`);
});

await check('the last member leaving takes the household with it', async () => {
  // A throwaway of A's own, so nothing else depends on what happens to it.
  const doomed = await ensureHousehold(A, 'Isolation test reaper', 'only-me');
  const before = await api(`/rest/v1/household_state?household_id=eq.${doomed}&select=rev`, { token: A });
  expect(before.json?.length === 1, 'the throwaway household was never set up');

  await leaveHousehold(A, AID, doomed);

  // From here the client cannot tell "deleted" from "invisible to me" -- RLS
  // answers [] either way, and nobody is left who could see it. This asserts the
  // observable half; the physical half needs a count in the SQL editor.
  const after = await api(`/rest/v1/households?id=eq.${doomed}&select=id`, { token: A });
  expect(after.json?.length === 0, 'A can still see a household it walked out of');
});

await check('an owner walking out leaves an owner behind', async () => {
  // A throwaway, so the layout the isolation checks above rely on is untouched.
  const shared = await ensureHousehold(A, 'Isolation test handover', 'a-owner');
  const code = await rpc(A, 'create_invite', { target_household: shared, seat: 'b-guest' });
  expect(typeof code.json === 'string', `no invite was issued: ${code.text.slice(0, 160)}`);
  const joined = await rpc(B, 'redeem_invite', { invite_code: code.json });
  expect(joined.status < 300, `B could not join: ${joined.text.slice(0, 160)}`);

  // The owner leaves while B is still in it. 0002 allows exactly this, and 0007
  // is the only thing standing between it and a household nobody can manage.
  await leaveHousehold(A, AID, shared);

  const after = await api(
    `/rest/v1/household_members?household_id=eq.${shared}&select=user_id,role`,
    { token: B });
  expect(after.json?.length === 1, `expected B alone, got ${JSON.stringify(after.json)}`);
  expect(after.json[0].role === 'owner',
    `B was left as '${after.json[0].role}', so nothing can rename or delete this household again`);

  // And prove the role is load-bearing rather than cosmetic: the whole point of
  // promoting is that delete_household starts answering this account again.
  const binned = await rpc(B, 'delete_household', { target_household: shared });
  expect(binned.status < 300, `the promoted owner still cannot delete: ${binned.text.slice(0, 160)}`);
});

await check('an owner alone in a household can bin it', async () => {
  const doomed = await ensureHousehold(A, 'Isolation test delete', 'only-me');
  const r = await rpc(A, 'delete_household', { target_household: doomed });
  expect(r.status < 300, `an owner alone could not delete: ${r.text.slice(0, 160)}`);
  const after = await api(`/rest/v1/households?id=eq.${doomed}&select=id`, { token: A });
  expect(after.json?.length === 0, 'the household survived its own deletion');
});

// --- put it back the way the isolation checks above expect to find it

await leaveHousehold(A, AID, HC);

// Invites are the one thing the checks above leave lying around: create_invite
// writes a row per run, and an unredeemed code stays usable until it expires.
// Nine of them turned up in the test database before this existed.
for (const [token, hid] of [[A, HA], [B, HB], [B, HC]]) {
  await api(`/rest/v1/household_invites?household_id=eq.${hid}`, { token, method: 'DELETE' });
}

// --- verdict

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('\nfailures:');
  for (const f of failed) console.log(`  - ${f.label}: ${f.why}`);
  process.exit(1);
}
console.log('households are isolated.');
