import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createAppServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

// Microsoft sign-in for the dashboard, against a fake Microsoft token endpoint (nothing leaves this machine).

const TENANT = '11111111-2222-3333-4444-555555555555';
const OTHER_TENANT = '99999999-2222-3333-4444-555555555555';
const SIGNIN_APP = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TOKEN = 'backup-admin-token';
const ROOMS = [{ id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: 'America/New_York' }];
const QUIET = { get: async () => ({ date: '2026-11-12', celebrations: [], holiday: null, nextHoliday: null }), holidayOn: () => null };
const BASE_ENV = {
  DEMO_MODE: 'true', ROOMS_JSON: JSON.stringify(ROOMS), ADMIN_TOKEN: TOKEN, WEATHER_ENABLED: 'false', TENANT_ID: TENANT,
  TEAMS_BOT_APP_ID: '12345678-1234-1234-1234-123456789012', TEAMS_BOT_APP_SECRET: 'bot-secret', TEAMS_ALERT_EMAILS: 'hermes@example.com, Kshitij@Example.com',
  DASHBOARD_SIGNIN_CLIENT_ID: SIGNIN_APP, DASHBOARD_SIGNIN_CLIENT_SECRET: 'signin-secret', DASHBOARD_SIGNIN_REDIRECT_URI: 'http://localhost:3000/auth/callback'
};
const jwt = claims => ['{"alg":"RS256","typ":"JWT"}', JSON.stringify(claims)].map(s => Buffer.from(s).toString('base64url')).join('.') + '.c2lnbmF0dXJl';
const goodClaims = nonce => ({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: SIGNIN_APP, tid: TENANT, nonce, exp: Math.floor(Date.now() / 1000) + 3600, nbf: Math.floor(Date.now() / 1000) - 10, name: 'Kshitij Sharma', preferred_username: 'kshitij@example.com', oid: 'oid-1' });

// The fake Microsoft: records what it was sent and answers with whatever the test says.
function fakeMicrosoft() {
  const calls = [];
  let answer = ({ nonce }) => ({ status: 200, body: { id_token: jwt(goodClaims(nonce)), token_type: 'Bearer' } });
  let nonceFor = () => '';
  const fetchImpl = async (url, init = {}) => {
    if (!String(url).startsWith('https://login.microsoftonline.com/')) throw new Error(`unexpected request to ${url}`);
    const form = new URLSearchParams(String(init.body || ''));
    calls.push({ url: String(url), form });
    const reply = answer({ form, nonce: nonceFor() });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls, answerWith: fn => { answer = fn; }, useNonce: fn => { nonceFor = fn; } };
}

async function start(t, env = {}) {
  const microsoft = fakeMicrosoft();
  const server = createAppServer({ env: { ...BASE_ENV, ...env }, startSubscriptions: false, logger: { error() { }, warn() { }, log() { } }, celebrations: QUIET, fetchImpl: microsoft.fetchImpl });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, state: server.appState, microsoft };
}
const get = (base, path, headers = {}) => fetch(base + path, { redirect: 'manual', headers });
const cookieValue = (response, name) => (response.headers.getSetCookie().find(c => c.startsWith(`${name}=`)) || '').split(';')[0];

// Runs /auth/login and /auth/callback like a browser would. Returns the session cookie and the responses.
async function signInFlow(base, microsoft, { changeCallback = q => q, browserCookie } = {}) {
  const login = await get(base, '/auth/login');
  assert.equal(login.status, 302);
  const authorize = new URL(login.headers.get('location'));
  microsoft.useNonce(() => authorize.searchParams.get('nonce'));
  const stateCookie = browserCookie ?? cookieValue(login, 'rd_signin');
  const query = changeCallback(new URLSearchParams({ code: 'the-code', state: authorize.searchParams.get('state') }));
  const callback = await get(base, `/auth/callback?${query}`, stateCookie ? { cookie: stateCookie } : {});
  return { login, authorize, callback, session: cookieValue(callback, 'rd_session') };
}

test('sign-in settings: off unless set, both IDs together, https (or localhost), the right path, and someone allowed', () => {
  const load = env => loadConfig({ DEMO_MODE: 'true', ROOMS_JSON: JSON.stringify(ROOMS), TENANT_ID: TENANT, ...env }).dashboardSignIn;
  assert.deepEqual(load({}), { enabled: false });
  const on = { DASHBOARD_SIGNIN_CLIENT_ID: SIGNIN_APP, DASHBOARD_SIGNIN_CLIENT_SECRET: 's', DASHBOARD_ADMIN_EMAILS: 'a@example.com', PUBLIC_BASE_URL: 'https://rooms.example.com' };
  const settings = load(on);
  assert.equal(settings.enabled, true);
  assert.equal(settings.redirectUri, 'https://rooms.example.com/auth/callback', 'defaults to PUBLIC_BASE_URL + /auth/callback');
  assert.equal(settings.tenantId, TENANT, 'defaults to TENANT_ID');
  assert.equal(settings.sessionHours, 8);
  assert.throws(() => load({ DASHBOARD_SIGNIN_CLIENT_ID: SIGNIN_APP }), /together/);
  assert.throws(() => load({ ...on, DASHBOARD_SIGNIN_CLIENT_ID: 'not-a-guid' }), /GUID/);
  assert.throws(() => load({ ...on, PUBLIC_BASE_URL: 'http://192.168.80.157' }), /must use https/);
  assert.equal(load({ ...on, DASHBOARD_SIGNIN_REDIRECT_URI: 'http://localhost:3000/auth/callback' }).redirectUri, 'http://localhost:3000/auth/callback', 'plain http only for localhost');
  assert.throws(() => load({ ...on, DASHBOARD_SIGNIN_REDIRECT_URI: 'https://rooms.example.com/somewhere' }), /\/auth\/callback/);
  assert.throws(() => load({ ...on, DASHBOARD_ADMIN_EMAILS: '' }), /needs someone/);
  assert.throws(() => load({ ...on, DASHBOARD_ADMIN_EMAILS: 'not-an-email' }), /invalid address/);
  assert.equal(load({ ...on, DASHBOARD_SESSION_HOURS: '99' }).sessionHours, 24, 'at most a day');
  assert.equal(load({ ...on, DASHBOARD_SESSION_HOURS: '2' }).sessionHours, 2);
});

test('who may sign in: the Teams alert people by default, DASHBOARD_ADMIN_EMAILS when set', () => {
  const load = env => loadConfig({ ...BASE_ENV, ...env }).dashboardSignIn;
  assert.deepEqual(load({}).allowedEmails, ['hermes@example.com', 'kshitij@example.com']);
  assert.equal(load({}).allowedFrom, 'TEAMS_ALERT_EMAILS');
  assert.deepEqual(load({ DASHBOARD_ADMIN_EMAILS: 'Boss@Example.com;it@example.com' }).allowedEmails, ['boss@example.com', 'it@example.com']);
  assert.equal(load({ DASHBOARD_ADMIN_EMAILS: 'boss@example.com' }).allowedFrom, 'DASHBOARD_ADMIN_EMAILS');
});

test('a person on the list signs in, uses the dashboard, and signs out', async t => {
  const { base, microsoft } = await start(t);
  assert.deepEqual(await (await get(base, '/api/auth/me')).json(), { signInEnabled: true, tokenEnabled: true, signedIn: false, name: '', email: '', expiresAt: null });

  const { login, authorize, callback, session } = await signInFlow(base, microsoft);
  // Step 1: off to Microsoft, with everything a safe sign-in needs.
  assert.equal(authorize.origin + authorize.pathname, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
  const q = authorize.searchParams;
  assert.equal(q.get('client_id'), SIGNIN_APP);
  assert.equal(q.get('redirect_uri'), 'http://localhost:3000/auth/callback');
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('scope'), 'openid profile email');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.ok(q.get('state').length >= 40 && q.get('nonce').length >= 40 && q.get('code_challenge').length === 43);
  const stateCookie = login.headers.getSetCookie().find(c => c.startsWith('rd_signin='));
  assert.match(stateCookie, /; Path=\/auth; Max-Age=600; HttpOnly; SameSite=Lax$/, 'short-lived, script cannot read it; no Secure flag on localhost');

  // Step 2: the code is swapped at Microsoft with the secret and the PKCE verifier that matches the challenge.
  assert.equal(microsoft.calls.length, 1);
  const form = microsoft.calls[0].form;
  assert.equal(microsoft.calls[0].url, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'the-code');
  assert.equal(form.get('client_secret'), 'signin-secret');
  assert.equal(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'), q.get('code_challenge'));
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/dashboard');
  assert.match(callback.headers.getSetCookie().find(c => c.startsWith('rd_session=')), /; Path=\/; Max-Age=28800; HttpOnly; SameSite=Lax$/, '8-hour session');
  assert.ok(callback.headers.getSetCookie().some(c => /^rd_signin=; Path=\/auth; Max-Age=0/.test(c)), 'the one-time cookie is cleared');

  // Signed in: the dashboard API works with the cookie alone.
  const me = await (await get(base, '/api/auth/me', { cookie: session })).json();
  assert.equal(me.signedIn, true);
  assert.equal(me.email, 'kshitij@example.com');
  assert.equal(me.name, 'Kshitij Sharma');
  assert.equal((await get(base, '/api/admin/overview', { cookie: session })).status, 200);
  const control = headers => fetch(`${base}/api/admin/rooms/front/control`, { method: 'POST', headers: { cookie: session, ...headers }, body: JSON.stringify({ action: 'refresh' }) });
  assert.equal((await control({ 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' })).status, 200, 'the dashboard page can make changes');

  // Sign out: the cookie stops working.
  const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: session, origin: base } });
  assert.equal(out.status, 200);
  assert.match(out.headers.getSetCookie()[0], /^rd_session=; Path=\/; Max-Age=0; HttpOnly/);
  assert.equal((await get(base, '/api/admin/overview', { cookie: session })).status, 401);
  assert.equal((await (await get(base, '/api/auth/me', { cookie: session })).json()).signedIn, false);
});

test('a signed-in session cannot be used by another website to make changes', async t => {
  const { base, microsoft } = await start(t);
  const { session } = await signInFlow(base, microsoft);
  const control = headers => fetch(`${base}/api/admin/rooms/front/control`, { method: 'POST', headers: { cookie: session, ...headers }, body: JSON.stringify({ action: 'displayOff' }) });
  assert.equal((await control({ 'content-type': 'text/plain' })).status, 403, 'a plain form post (no JSON) is refused');
  assert.equal((await control({ 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403, 'another origin is refused');
  assert.equal((await control({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).status, 403, 'a cross-site request is refused');
  assert.equal((await control({ 'content-type': 'application/json', 'sec-fetch-site': 'same-site' })).status, 403, 'a sibling site is refused too');
  assert.equal((await control({ 'content-type': 'application/json', origin: 'null' })).status, 403, 'a sandboxed page is refused');
  const config = await (await fetch(`${base}/api/config?room=front`)).json();
  assert.equal(config.control.displayEnabled, true, 'nothing was changed');
  const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: session, origin: 'https://evil.example' } });
  assert.equal(out.status, 403, 'another site cannot sign you out either');
  assert.equal((await get(base, '/api/admin/overview', { cookie: session })).status, 200, 'still signed in');
});

test('refused sign-ins: not on the list, other organisation, wrong app, wrong nonce, expired, Microsoft says no', async t => {
  const { base, microsoft } = await start(t);
  const refused = async (claims, pattern, status = 403) => {
    microsoft.answerWith(({ nonce }) => ({ status: 200, body: { id_token: jwt(claims(goodClaims(nonce))) } }));
    const { callback, session } = await signInFlow(base, microsoft);
    assert.equal(callback.status, status, String(pattern));
    assert.equal(session, '', 'no session cookie');
    assert.match(callback.headers.get('content-type'), /text\/html/);
    assert.match(await callback.text(), pattern);
  };
  await refused(c => ({ ...c, preferred_username: 'someone.else@example.com', email: undefined }), /someone\.else@example\.com is not allowed to use the dashboard/);
  await refused(c => ({ ...c, tid: OTHER_TENANT, iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` }), /different organisation/);
  await refused(c => ({ ...c, iss: 'https://sts.windows.net/' + TENANT + '/' }), /not from this organisation/);
  await refused(c => ({ ...c, aud: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee' }), /not issued for this dashboard/);
  await refused(c => ({ ...c, nonce: 'someone-elses-nonce' }), /does not belong to this sign-in/);
  await refused(c => ({ ...c, exp: Math.floor(Date.now() / 1000) - 3600 }), /expired/);

  microsoft.answerWith(({ nonce }) => ({ status: 200, body: { id_token: jwt({ ...goodClaims(nonce), preferred_username: 'KSHITIJ@EXAMPLE.COM' }) } }));
  assert.notEqual((await signInFlow(base, microsoft)).session, '', 'upper-case email from Microsoft is still on the list');
  microsoft.answerWith(({ nonce }) => ({ status: 200, body: { id_token: jwt({ ...goodClaims(nonce), preferred_username: 'kshitij_admin@example.com', email: 'hermes@example.com' }) } }));
  assert.notEqual((await signInFlow(base, microsoft)).session, '', 'the email claim also counts');

  microsoft.answerWith(() => ({ status: 400, body: { error: 'invalid_grant' } }));
  let { callback } = await signInFlow(base, microsoft);
  assert.equal(callback.status, 502); assert.match(await callback.text(), /Microsoft refused the sign-in \(invalid_grant\)/);
  microsoft.answerWith(() => new TypeError('fetch failed'));
  ({ callback } = await signInFlow(base, microsoft));
  assert.equal(callback.status, 502); assert.match(await callback.text(), /Could not reach Microsoft/);
  microsoft.answerWith(() => ({ status: 200, body: { access_token: 'x' } }));
  ({ callback } = await signInFlow(base, microsoft));
  assert.equal(callback.status, 502); assert.match(await callback.text(), /valid ID token/);
});

test('the one-time sign-in link: one use, this browser only, and Microsoft\'s own error shown safely', async t => {
  const { base, microsoft } = await start(t);
  const first = await signInFlow(base, microsoft);
  assert.notEqual(first.session, '');
  const replay = await get(base, `/auth/callback?code=the-code&state=${first.authorize.searchParams.get('state')}`, { cookie: cookieValue(first.login, 'rd_signin') });
  assert.equal(replay.status, 400, 'the same link cannot be used twice');
  assert.match(await replay.text(), /expired or was already used/);

  const noCookie = await signInFlow(base, microsoft, { browserCookie: '' });
  assert.equal(noCookie.callback.status, 400, 'a link opened in another browser (no cookie) is refused');
  assert.match(await noCookie.callback.text(), /different browser/);
  const otherCookie = await signInFlow(base, microsoft, { browserCookie: 'rd_signin=' + 'x'.repeat(43) });
  assert.equal(otherCookie.callback.status, 400);
  assert.equal(microsoft.calls.length, 1, 'Microsoft was only asked for the one good sign-in');

  const unknown = await get(base, '/auth/callback?code=c&state=made-up');
  assert.equal(unknown.status, 400);
  const denied = await signInFlow(base, microsoft, { changeCallback: () => new URLSearchParams({ error: 'access_denied', error_description: 'AADSTS50105: <script>alert(1)</script> not assigned', state: 'x' }) });
  assert.equal(denied.callback.status, 401);
  const page = await denied.callback.text();
  assert.match(page, /AADSTS50105: &lt;script&gt;alert\(1\)&lt;\/script&gt; not assigned/, 'shown, but as text');
  assert.doesNotMatch(page, /<script>/);
  assert.match(denied.callback.headers.get('content-security-policy'), /script-src 'self'/);
});

test('the administrator token still works as the backup, and sessions run out', async t => {
  const { base, state, microsoft } = await start(t);
  assert.equal((await get(base, '/api/admin/overview', { authorization: `Bearer ${TOKEN}` })).status, 200, 'backup token on the dashboard');
  const panel = await fetch(`${base}/api/admin/rooms/front/control`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'message', message: 'Hi' }) });
  assert.equal(panel.status, 200, 'the tablet message panel keeps working with the token');
  assert.equal((await get(base, '/api/admin/overview', { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await get(base, '/api/admin/overview', { cookie: 'rd_session=made-up' })).status, 401);
  assert.match((await (await get(base, '/api/admin/overview')).json()).error, /sign in with Microsoft/);

  const { session } = await signInFlow(base, microsoft);
  assert.equal((await get(base, '/api/admin/overview', { cookie: session })).status, 200);
  for (const value of state.signIn.sessions.values()) value.expires = Date.now() - 1;   // 8 hours later
  assert.equal((await get(base, '/api/admin/overview', { cookie: session })).status, 401, 'an old session is refused');
  assert.equal(state.signIn.sessions.size, 0, 'and forgotten');
});

test('without sign-in set up nothing changes: the token is the only way in and /auth/login says so', async t => {
  const { base } = await start(t, { DASHBOARD_SIGNIN_CLIENT_ID: '', DASHBOARD_SIGNIN_CLIENT_SECRET: '' });
  assert.equal((await get(base, '/auth/login')).status, 404);
  assert.equal((await get(base, '/auth/callback?code=x&state=y')).status, 404);
  const me = await (await get(base, '/api/auth/me')).json();
  assert.equal(me.signInEnabled, false);
  assert.equal(me.tokenEnabled, true);
  assert.match((await (await get(base, '/api/admin/overview')).json()).error, /valid dashboard token/);
  assert.equal((await get(base, '/api/admin/overview', { authorization: `Bearer ${TOKEN}` })).status, 200);
});

test('on HTTPS the cookies are marked Secure', async t => {
  const { base } = await start(t, { DASHBOARD_SIGNIN_REDIRECT_URI: 'https://rooms.example.com/auth/callback' });
  const login = await get(base, '/auth/login');
  assert.match(login.headers.getSetCookie()[0], /; HttpOnly; SameSite=Lax; Secure$/);
  assert.equal(new URL(login.headers.get('location')).searchParams.get('redirect_uri'), 'https://rooms.example.com/auth/callback');
});

test('the dashboard page offers Microsoft sign-in, keeps the token as the backup, and can sign out', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
  assert.match(html, /<a id="signin" class="signin hidden" href="\/auth\/login">Sign in with Microsoft<\/a>/);
  assert.match(html, /<label id="tokenLabel">Administrator token<input id="token"/);
  assert.match(html, /<button id="signout" type="button">Sign out<\/button>/);
  assert.match(js, /fetch\('\/api\/auth\/me'/);
  assert.match(js, /'Backup: administrator token'/);
  assert.match(js, /token\?\{'authorization':'Bearer '\+token\}:\{\}/, 'no empty Bearer header when signed in with Microsoft');
  assert.match(js, /fetch\('\/auth\/logout', \{ method: 'POST' \}\)/);
});
