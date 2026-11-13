import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { createAppServer, failureAnswer, calendarProblemText } from '../src/server.js';
import { GraphCalendar, GraphTokenProvider, failureKind } from '../src/graph-calendar.js';

// When Microsoft 365 fails, the tablet and the alerts say plainly whose problem it is (Nov 12, 2026: Exchange Online
// was down for hours; the tablet said "Microsoft Graph request failed (502): Bad Gateway" and the alert said to
// check the app secret, which was fine).

const ROOM = { id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: 'America/New_York', allowQuickBooking: true };
const QUIET = { get: async () => ({ celebrations: [] }), holidayOn: () => null };
const fakeTokens = { getToken: async () => 'token' };
const graphAnswering = (status, body = {}) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function start(t) {
  const server = createAppServer({ env: { DEMO_MODE: 'true', ROOMS_JSON: JSON.stringify([ROOM]), ADMIN_TOKEN: 'x', WEATHER_ENABLED: 'false' }, startSubscriptions: false, logger: { error() { }, warn() { }, log() { } }, celebrations: QUIET });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { base: `http://127.0.0.1:${server.address().port}`, state: server.appState };
}
const failWith = (status, kind) => Object.assign(new Error(`Microsoft Graph request failed (${status}): Bad Gateway`), { status, kind });

test('Microsoft answers are sorted into outage, permission, missing mailbox and other', () => {
  for (const s of [500, 502, 503, 504, 429, 408]) assert.equal(failureKind(s), 'microsoft-down', String(s));
  for (const s of [401, 403]) assert.equal(failureKind(s), 'permission', String(s));
  assert.equal(failureKind(404), 'not-found');
  for (const s of [400, 409, 412]) assert.equal(failureKind(s), 'other', String(s));
});

test('the calendar reader tags each failure, gives up instead of hanging, and treats no answer as an outage', async () => {
  const calendar = fetchImpl => new GraphCalendar({}, ROOM, fakeTokens, fetchImpl);
  const failure = async fetchImpl => { try { await calendar(fetchImpl).listEvents(Date.now(), Date.now() + 3600000); } catch (e) { return e; } assert.fail('should have failed'); };
  let e = await failure(graphAnswering(502, { error: { code: 'UnknownError', message: '' } }));
  assert.equal(e.kind, 'microsoft-down'); assert.equal(e.status, 502);
  e = await failure(graphAnswering(403, { error: { message: 'Access is denied.' } }));
  assert.equal(e.kind, 'permission');
  e = await failure(async () => { throw new TypeError('fetch failed'); });
  assert.equal(e.kind, 'microsoft-down'); assert.equal(e.status, 503); assert.match(e.message, /did not answer \(fetch failed\)/);
  e = await failure(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
  assert.equal(e.kind, 'microsoft-down'); assert.match(e.message, /no answer within 20 seconds/);
  let signal = null;
  await calendar(async (url, init) => { signal = init.signal; return new Response('{"value":[]}', { status: 200 }); }).listEvents(Date.now(), Date.now() + 1);
  assert.ok(signal instanceof AbortSignal, 'every request has a time limit');
  // Signing in to Microsoft is covered too (an outage there looks the same).
  const tokens = new GraphTokenProvider({ tenantId: 't', clientId: 'c', clientSecret: 's' }, async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(tokens.getToken(), err => err.kind === 'microsoft-down');
  const refused = new GraphTokenProvider({ tenantId: 't', clientId: 'c', clientSecret: 's' }, graphAnswering(401, { error_description: 'AADSTS7000222: The provided client secret keys are expired.' }));
  await assert.rejects(refused.getToken(), err => err.kind === 'permission' && /expired/.test(err.message));
});

test('the tablet gets a plain sentence for each kind of failure, and booking says to use Outlook', () => {
  let answer = failureAnswer(failWith(502, 'microsoft-down'), '/api/events');
  assert.deepEqual(answer, { status: 503, body: { reason: 'microsoft-down', error: 'Microsoft 365 is not responding right now. The display is showing the last meetings it had.' } });
  answer = failureAnswer(failWith(504, 'microsoft-down'), '/api/bookings');
  assert.equal(answer.status, 503);
  assert.match(answer.body.error, /could not be booked\. Please try again in a few minutes, or book it in Outlook\./);
  assert.match(failureAnswer(failWith(403, 'permission'), '/api/events').body.error, /not allowed to read this room's calendar.*tell IT/);
  assert.match(failureAnswer(failWith(403, 'permission'), '/api/bookings').body.error, /not allowed to book this room/);
  assert.match(failureAnswer(failWith(404, 'not-found')).body.error, /mailbox was not found/);
  assert.deepEqual(failureAnswer(Object.assign(new Error('Booking duration must be between 15 and 120 minutes.'), { status: 400 })), { status: 400, body: { error: 'Booking duration must be between 15 and 120 minutes.' } }, 'our own messages pass through');
  assert.deepEqual(failureAnswer(new Error('boom')), { status: 502, body: { error: 'The room calendar is temporarily unavailable.' } });
  for (const kind of ['microsoft-down', 'permission', 'not-found']) assert.doesNotMatch(JSON.stringify(failureAnswer(failWith(502, kind), '/api/events')), /Bad Gateway|Graph/, 'no Microsoft jargon on the tablet');
});

test('during an outage the tablet\'s meetings and bookings answer with the plain message', async t => {
  const { base, state } = await start(t);
  const calendar = state.calendars.get('front');
  calendar.listEvents = async () => { throw failWith(502, 'microsoft-down'); };
  let response = await fetch(`${base}/api/events?room=front`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { reason: 'microsoft-down', error: 'Microsoft 365 is not responding right now. The display is showing the last meetings it had.' });
  const when = new Date(Math.ceil(Date.now() / 60000) * 60000 + 60000);
  response = await fetch(`${base}/api/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomId: 'front', subject: 'Reserved', start: when.toISOString(), end: new Date(when.getTime() + 30 * 60000).toISOString() }) });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /or book it in Outlook/);
});

test('the alert says when it is Microsoft\'s problem, and when it is ours', () => {
  const outage = calendarProblemText({ kind: 'microsoft-down', error: 'Microsoft Graph request failed (502): Bad Gateway' });
  assert.match(outage, /^Microsoft 365 is not responding \(Microsoft Graph request failed \(502\): Bad Gateway\)/);
  assert.match(outage, /nothing needs changing here/);
  assert.match(outage, /booking from the tablet fails until Microsoft recovers/);
  assert.match(outage, /https:\/\/status\.cloud\.microsoft/);
  assert.doesNotMatch(outage, /secret/, 'no advice to check the secret during an outage');
  const permission = calendarProblemText({ kind: 'permission', error: 'Microsoft Graph request failed (401): token expired' });
  assert.match(permission, /app secret \(CLIENT_SECRET, and whether it has expired\) and the app's permissions/);
  assert.match(calendarProblemText({ kind: 'not-found', error: '404' }), /email address in config\/rooms\.json/);
  assert.match(calendarProblemText({ error: 'x' }), /^the room calendar cannot be read \(x\)\. The display may be showing old meetings\.$/, 'unknown kinds stay neutral');
});

test('an outage alert reaches the dashboard after 10 minutes, worded as an outage', async t => {
  const { state } = await start(t);
  const TUESDAY_3PM = Date.parse('2026-11-10T20:00:00Z');
  state.calendarProblems.set('front', { since: TUESDAY_3PM - 12 * 60000, error: 'Microsoft Graph request failed (502): Bad Gateway', kind: 'microsoft-down' });
  state.tablets.set('front:t', { tabletId: 't', roomId: 'front', name: 'Front tablet', lastSeen: new Date(TUESDAY_3PM - 1000).toISOString(), wallTablet: true });
  await state.checkTablets(TUESDAY_3PM);
  const alert = state.alerts.find(a => /Microsoft 365 is not responding/.test(a.text));
  assert.ok(alert, 'one alert');
  assert.match(alert.text, /^Front Conference Room: Microsoft 365 is not responding/);
});

test('the tablet shows the outage plainly, keeps its meetings, and pops up the message once per problem', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const snoopy = fs.readFileSync(new URL('../public/snoopy.js', import.meta.url), 'utf8');
  const load = app.match(/async function loadEvents\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(app, /failure\.reason = data\.reason \|\| ''/, 'api() keeps the reason');
  assert.match(load, /kind === 'microsoft-down' \? outageText\(\) : 'Calendar temporarily unavailable'/);
  assert.match(load, /if \(state\.syncProblem !== kind\) showToast\(error\.message\);/, 'a message once, not every minute');
  assert.doesNotMatch(load.slice(load.indexOf('catch')), /state\.events\s*=/, 'the meetings on screen stay');
  assert.match(app, /'Microsoft 365 is not responding' \+ \(state\.lastGoodAt \? ' \\u00b7 showing meetings from ' \+ formatTime\(state\.lastGoodAt\)/);
  assert.match(snoopy, /\/unavailable\|not responding\/i\.test\(sync\.textContent\)\) return 'failed'/, 'Snoopy looks unhappy during an outage');
  assert.match(fs.readFileSync(new URL('../public/preview.html', import.meta.url), 'utf8'), /<option value="outage">Microsoft 365 not responding<\/option>/);
});
