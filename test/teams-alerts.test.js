import test from 'node:test';
import assert from 'node:assert/strict';
import { TeamsAlerts } from '../src/teams-alerts.js';

const APP_ID = '11111111-2222-3333-4444-555555555555';
const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CATALOG = '99999999-8888-7777-6666-555555555555';
const SECRET = 'super-secret-value-123';
const settings = (extra = {}) => ({ enabled: true, appId: APP_ID, appSecret: SECRET, tenantId: TENANT, recipients: ['a@example.com', 'b@example.com'], serviceUrl: 'https://smba.trafficmanager.net/teams/', catalogId: '', ...extra });

// A fake Microsoft: the sign-in service, Microsoft Graph (users, installed apps, chats, app catalog) and the Bot Connector.
function microsoft({ known = ['a@example.com', 'b@example.com'], installed = [], catalog = [{ id: CATALOG }], blockedChats = [], connectorFailures = [], loginFails = null, graph401Once = false, slowListing = 0, graphForbidden = false } = {}) {
  const state = { installed: new Set(installed), logins: [], graphCalls: [], installs: [], posts: [], listings: 0, graph401: graph401Once, connectorFailures: [...connectorFailures] };
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body ?? {} });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const auth = init.headers?.authorization || '';
    if (u.hostname === 'login.microsoftonline.com') {
      const form = new URLSearchParams(String(init.body));
      state.logins.push({ tenant: u.pathname.split('/')[1], scope: form.get('scope'), id: form.get('client_id'), secret: form.get('client_secret') });
      if (loginFails) return reply(loginFails.status, loginFails.body);
      const kind = form.get('scope').includes('graph') ? 'graph' : 'bot';
      return reply(200, { access_token: `${kind}-token-${state.logins.length}`, expires_in: 3600 });
    }
    if (u.hostname === 'graph.microsoft.com') {
      state.graphCalls.push(`${init.method || 'GET'} ${u.pathname}`);
      if (state.graph401) { state.graph401 = false; return reply(401, { error: { message: 'token expired' } }); }
      if (graphForbidden) return reply(403, { error: { message: 'Insufficient privileges' } });
      const userPath = u.pathname.match(/\/users\/([^/]+)\/teamwork\/installedApps(?:\/([^/]+)\/chat)?$/);
      if (u.pathname.endsWith('/appCatalogs/teamsApps')) return reply(200, { value: catalog });
      if (userPath) {
        const email = decodeURIComponent(userPath[1]);
        if (!known.includes(email)) return reply(404, { error: { message: `Resource '${email}' does not exist` } });
        if (userPath[2]) return reply(200, { id: `19:chat-${email}@unq.gbl.spaces` });
        if (init.method === 'POST') { state.installs.push({ email, body: JSON.parse(init.body) }); state.installed.add(email); return reply(201); }
        state.listings += 1;
        const visible = state.installed.has(email) && (state.listings > slowListing || installed.includes(email));
        return reply(200, { value: visible ? [{ id: `installation-${email}` }] : [] });
      }
    }
    if (u.hostname === 'smba.trafficmanager.net') {
      const chat = decodeURIComponent(u.pathname.match(/conversations\/([^/]+)\/activities/)[1]);
      state.posts.push({ chat, auth, body: JSON.parse(init.body), path: u.pathname });
      if (state.connectorFailures.length) { const failure = state.connectorFailures.shift(); return reply(failure.status, failure.body); }
      if (blockedChats.includes(chat)) return reply(403, { errorCode: 209, message: '{"subCode":"MessageWritesBlocked"}' });
      return reply(200, { id: 'activity-1' });
    }
    return reply(500, { error: 'unexpected request to ' + url });
  };
  return { fetchImpl, state };
}
const make = (ms, extra = {}) => new TeamsAlerts(settings(extra), ms.fetchImpl, { sleep: async () => {} });

test('installs the app for people who do not have it, finds their chat, and posts the alert', async () => {
  const ms = microsoft();
  const results = await make(ms).send('Front Conference Room: the tablet is offline.');
  assert.deepEqual(results.map(r => [r.recipient, r.ok]), [['a@example.com', true], ['b@example.com', true]]);

  assert.equal(ms.state.installs.length, 2);
  assert.match(ms.state.installs[0].body['teamsApp@odata.bind'], new RegExp(`/appCatalogs/teamsApps/${CATALOG}$`));

  assert.equal(ms.state.posts.length, 2);
  const [first] = ms.state.posts;
  assert.equal(first.chat, '19:chat-a@example.com@unq.gbl.spaces', 'the message goes into that person\'s own chat');
  assert.match(first.path, /\/teams\/v3\/conversations\/19%3Achat-a%40example\.com%40unq\.gbl\.spaces\/activities$/);
  assert.match(first.auth, /^Bearer bot-token-/, 'the Bot Connector gets the bot token');
  assert.equal(first.body.type, 'message');
  assert.match(first.body.text, /^\*\*Room Display alert\*\*\n\nFront Conference Room: the tablet is offline\.$/);
  assert.equal(first.body.channelData.notification.alert, true, 'flagged as an alert');
});

test('signs in as the bot\'s own app in the right tenant, once per kind of token', async () => {
  const ms = microsoft();
  await make(ms).send('x');
  assert.equal(ms.state.logins.length, 2, 'one Graph token and one Bot Connector token, shared by both people');
  for (const login of ms.state.logins) assert.deepEqual([login.tenant, login.id, login.secret], [TENANT, APP_ID, SECRET]);
  assert.deepEqual(ms.state.logins.map(l => l.scope).sort(), ['https://api.botframework.com/.default', 'https://graph.microsoft.com/.default']);
});

test('does not reinstall an app that is already there, and remembers each chat', async () => {
  const ms = microsoft({ installed: ['a@example.com', 'b@example.com'] });
  const alerts = make(ms);
  await alerts.send('first');
  assert.equal(ms.state.installs.length, 0);
  const graphCallsAfterFirst = ms.state.graphCalls.length;
  await alerts.send('second');
  assert.equal(ms.state.graphCalls.length, graphCallsAfterFirst, 'the second alert needs no Graph calls at all');
  assert.equal(ms.state.posts.length, 4);
});

test('looks the app up in the app catalog unless its id was given', async () => {
  const lookup = microsoft();
  await make(lookup).send('x');
  assert.ok(lookup.state.graphCalls.some(call => call.endsWith('/appCatalogs/teamsApps')));

  const given = microsoft();
  await make(given, { catalogId: CATALOG }).send('x');
  assert.ok(!given.state.graphCalls.some(call => call.endsWith('/appCatalogs/teamsApps')), 'no lookup, so no catalog permission needed');

  const missing = microsoft({ catalog: [] });
  const [result] = await make(missing).send('x');
  assert.equal(result.ok, false);
  assert.match(result.error, /not in your organisation's app catalog.*Teams admin center/);
});

test('waits for Teams to finish installing, and says so if it never does', async () => {
  const slow = microsoft({ slowListing: 2 });
  const results = await make(slow).send('x');
  assert.ok(results.every(r => r.ok), 'it kept checking until the installation showed up');

  const never = microsoft({ slowListing: 1000 });
  const [result] = await make(never).send('x');
  assert.equal(result.ok, false);
  assert.match(result.error, /has not finished setting it up/);
});

test('one person failing does not stop the others', async () => {
  const ms = microsoft({ known: ['a@example.com'] });
  const results = await make(ms).send('x');
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /could not find the person/);
  assert.match(results[1].error, /sign-in name/);
});

test('says plainly when someone has blocked the bot, and does not keep retrying', async () => {
  const ms = microsoft({ blockedChats: ['19:chat-b@example.com@unq.gbl.spaces'] });
  const results = await make(ms).send('x');
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /blocked or muted the bot/);
  assert.equal(ms.state.posts.filter(p => p.chat.includes('b@')).length, 1, 'no retry for a deliberate block');
});

test('recovers when a remembered chat has gone stale', async () => {
  const ms = microsoft({ installed: ['a@example.com'] });
  const alerts = make(ms, { recipients: ['a@example.com'] });
  assert.equal((await alerts.send('first'))[0].ok, true);
  ms.state.connectorFailures.push({ status: 403, body: { message: 'ForbiddenOperationException' } });
  const graphBefore = ms.state.graphCalls.length;
  const [second] = await alerts.send('second');
  assert.equal(second.ok, true, 'it looked the chat up again and delivered');
  assert.ok(ms.state.graphCalls.length > graphBefore, 'by asking Graph for the chat again');
  assert.equal(ms.state.posts.length, 3);
});

test('explains sign-in problems without ever revealing the secret', async () => {
  const ms = microsoft({ loginFails: { status: 401, body: { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: abc\r\nCorrelation ID: def' } } });
  const results = await make(ms).send('x');
  for (const result of results) {
    assert.equal(result.ok, false);
    assert.equal(result.step, 'sign-in');
    assert.match(result.error, /AADSTS7000215/);
  }
  assert.doesNotMatch(JSON.stringify(results), new RegExp(SECRET), 'the secret never appears in a result');
  assert.doesNotMatch(JSON.stringify(results), /Trace ID/, 'only the first line of Microsoft\'s message is kept');
});

test('asks for a fresh token once when Microsoft rejects the old one', async () => {
  const ms = microsoft({ graph401Once: true });
  const results = await make(ms, { recipients: ['a@example.com'] }).send('x');
  assert.equal(results[0].ok, true);
  assert.equal(ms.state.logins.filter(l => l.scope.includes('graph')).length, 2, 'a second Graph token was requested');
});

test('names the missing permission when Graph refuses', async () => {
  const [result] = await make(microsoft({ graphForbidden: true }), { recipients: ['a@example.com'] }).send('x');
  assert.equal(result.ok, false);
  assert.match(result.error, /TeamsAppInstallation\.ReadWriteSelfForUser\.All/);
});

test('does nothing at all unless fully set up', async () => {
  const ms = microsoft();
  for (const incomplete of [{ enabled: false }, { appSecret: '' }, { recipients: [] }, { tenantId: '' }]) {
    const alerts = make(ms, incomplete);
    assert.equal(alerts.enabled, false);
    assert.deepEqual(await alerts.send('x'), []);
  }
  assert.equal(ms.state.logins.length, 0, 'not even a sign-in attempt');
  assert.deepEqual(new TeamsAlerts(undefined).recipients, []);
});

test('uses a custom title and a custom service address when given', async () => {
  const ms = microsoft({ installed: ['a@example.com'] });
  await make(ms, { recipients: ['a@example.com'], serviceUrl: 'https://smba.trafficmanager.net/teams' }).send('hello', { title: 'Room Display test alert' });
  assert.match(ms.state.posts[0].body.text, /^\*\*Room Display test alert\*\*/);
  assert.match(ms.state.posts[0].path, /^\/teams\/v3\/conversations\//, 'no double slash even when the address has no trailing slash');
});
