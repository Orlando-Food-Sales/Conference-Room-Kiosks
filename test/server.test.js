import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../src/server.js';

const config = { port: 0, demoMode: true, adminToken: 'test-token', eventRefreshSeconds: 60, tabletOfflineSeconds: 120, rooms: [{ id: 'front', name: 'Front Room', email: 'front@example.com', timeZone: 'UTC', allowQuickBooking: false }] };

test('serves health, room UI, assets, and demo events', async t => {
  const server = createAppServer({ config, startSubscriptions: false, logger: { error() { } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/healthz`); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'ok');
  response = await fetch(`${base}/room/front`); assert.equal(response.status, 200); assert.match(await response.text(), /Room Display/);
  response = await fetch(`${base}/app.js`); assert.equal(response.status, 200); assert.match(await response.text(), /generateId/);
  response = await fetch(`${base}/styles.css`, { method: 'HEAD' }); assert.equal(response.status, 200);
  response = await fetch(`${base}/api/events?room=front`); assert.equal(response.status, 200); assert.ok(Array.isArray((await response.json()).events));
});

// ---------------------------------------------------------------------------------------------
// Helpers. Every test starts its own demo-mode server on a free port, with a stubbed holiday and
// weather service so nothing touches Microsoft or the internet.
// ---------------------------------------------------------------------------------------------

const ROOMS = [
  { id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: 'America/New_York', allowQuickBooking: true },
  { id: 'back', name: 'Back Conference Room', email: 'back@example.com', timeZone: 'America/New_York', allowQuickBooking: false, showCelebrations: false }
];
const QUIET = { get: async () => ({ date: '2026-11-10', celebrations: [], holiday: null, nextHoliday: null }), holidayOn: () => null };
const TOKEN = 'secret-token';

async function start(t, { env = {}, ...options } = {}) {
  const server = createAppServer({
    env: { DEMO_MODE: 'true', ROOMS_JSON: JSON.stringify(ROOMS), ADMIN_TOKEN: TOKEN, ...env },
    startSubscriptions: false, logger: { error() { }, warn() { } }, celebrations: QUIET, ...options
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { server, base: `http://127.0.0.1:${server.address().port}`, state: server.appState };
}
const json = (base, path, { token, method = 'GET', body, headers } = {}) => fetch(`${base}${path}`, {
  method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, what, ms = 2000) {
  for (let waited = 0; waited < ms; waited += 10) { if (check()) return; await sleep(10); }
  assert.fail(`timed out waiting for ${what}`);
}
async function listen(base, room) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/stream?room=${room}`, { signal: controller.signal });
  let text = '';
  const done = (async () => { try { for await (const chunk of response.body) text += Buffer.from(chunk).toString(); } catch { /* aborted */ } })();
  await waitFor(() => text.includes('event: connected'), 'the live connection');
  return { text: () => text, stop: async () => { controller.abort(); await done; } };
}
const minutesFromNow = minutes => new Date(Math.floor(Date.now() / 60000) * 60000 + minutes * 60000);
const booking = (room, start, minutes = 30, extra = {}) => ({ roomId: room, subject: 'Reserved', start: start.toISOString(), end: new Date(start.getTime() + minutes * 60000).toISOString(), ...extra });

// ---------------------------------------------------------------------------------------------
// Pages, headers and settings the display reads
// ---------------------------------------------------------------------------------------------

test('serves the dashboard, preview, outfit data and images with the right types', async t => {
  const { base } = await start(t);
  for (const page of ['/dashboard', '/preview.html', '/theme.css', '/theme.js', '/snoopy.js']) assert.equal((await fetch(`${base}${page}`)).status, 200, page);
  const outfits = await fetch(`${base}/snoopy/outfits.json`);
  assert.match(outfits.headers.get('content-type'), /application\/json/);
  assert.ok(Array.isArray((await outfits.json()).outfits));
  const image = await fetch(`${base}/snoopy/snoopy.png`);
  assert.equal(image.headers.get('content-type'), 'image/png');
});

test('sends security headers and makes browsers re-check scripts and styles', async t => {
  const { base } = await start(t);
  const page = await fetch(`${base}/room/front`);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN', 'only this site may frame the pages (the preview needs it)');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.equal((await fetch(`${base}/theme.css`)).headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`${base}/room/front`)).headers.get('cache-control'), 'no-store');
});

test('refuses to serve files outside the public folder', async t => {
  const { base } = await start(t);
  for (const path of ['/%2e%2e/package.json', '/..%2fpackage.json', '/src/server.js', '/.env']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
});

test('tells the display its room settings, office hours and unknown rooms get 404', async t => {
  const { base } = await start(t);
  const room = await (await json(base, '/api/config?room=front')).json();
  assert.equal(room.allowQuickBooking, true);
  assert.equal(room.showCelebrations, true);
  assert.deepEqual(room.officeHours, { startMinutes: 480, endMinutes: 1020, days: [1, 2, 3, 4, 5] });
  assert.equal(room.control.displayEnabled, true);
  assert.equal((await json(base, '/api/config?room=nowhere')).status, 404);
  const rooms = await (await json(base, '/api/rooms')).json();
  assert.deepEqual(rooms.rooms.map(r => r.id), ['front', 'back']);
  assert.equal(rooms.rooms[1].showCelebrations, false);
});

test('weather endpoint passes the reading through, or null when there is none', async t => {
  const reading = { condition: 'rain', temperatureC: 4, feelsLikeC: 1, isDay: true, source: 'nws KTEB' };
  const withWeather = await start(t, { weather: { get: async () => reading } });
  assert.deepEqual((await (await json(withWeather.base, '/api/weather')).json()).weather, reading);
  const without = await start(t, { weather: { get: async () => null } });
  assert.deepEqual(await (await json(without.base, '/api/weather')).json(), { weather: null });
});

test('birthdays can be hidden per room but a company holiday still applies', async t => {
  const today = { date: '2026-11-26', celebrations: [{ kind: 'birthday', name: 'Mabel' }], holiday: { name: 'Thanksgiving' }, nextHoliday: null };
  const { base } = await start(t, { celebrations: { get: async () => today, holidayOn: () => null } });
  const front = await (await json(base, '/api/celebrations?room=front')).json();
  assert.equal(front.celebrations.length, 1);
  const back = await (await json(base, '/api/celebrations?room=back')).json();
  assert.deepEqual(back.celebrations, [], 'the back room hides birthdays');
  assert.equal(back.holiday.name, 'Thanksgiving', 'but still knows it is a holiday');
});

// ---------------------------------------------------------------------------------------------
// Calendar fetching and instant change detection
// ---------------------------------------------------------------------------------------------

test('tablets share one calendar fetch for a few seconds; an explicit range is never cached', async t => {
  const { base, state } = await start(t);
  const calendar = state.calendars.get('front');
  let fetches = 0;
  const original = calendar.listEvents.bind(calendar);
  calendar.listEvents = async (...args) => { fetches += 1; return original(...args); };
  await json(base, '/api/events?room=front');
  await json(base, '/api/events?room=front');
  await json(base, '/api/events?room=front');
  assert.equal(fetches, 1, 'three tablets, one Microsoft request');
  const from = new Date().toISOString(), until = new Date(Date.now() + 3600000).toISOString();
  await json(base, `/api/events?room=front&start=${from}&end=${until}`);
  assert.equal(fetches, 2, 'a specific date range always asks again');
  assert.equal((await json(base, '/api/events?room=front&start=nonsense&end=nonsense')).status, 400);
});

test('a change made behind the server\'s back (for example in Outlook) is pushed to the tablets', async t => {
  const { base, state } = await start(t);
  const stream = await listen(base, 'front');
  t.after(() => stream.stop());
  await state.refreshRoom('front');
  assert.doesNotMatch(stream.text(), /calendar\.changed/, 'the first look is only a baseline');

  state.calendars.get('front').bookings.push({ id: 'outlook-1', subject: 'Booked in Outlook', organizer: 'Someone', isPrivate: false, start: minutesFromNow(300).toISOString(), end: minutesFromNow(360).toISOString() });
  await state.refreshRoom('front');
  await waitFor(() => stream.text().includes('event: calendar.changed'), 'the change event');
  assert.match(stream.text(), /change-detected/);

  const count = () => (stream.text().match(/event: calendar\.changed/g) || []).length;
  const before = count();
  await state.refreshRoom('front');
  await sleep(50);
  assert.equal(count(), before, 'no change, no new event');
  const events = (await (await json(base, '/api/events?room=front')).json()).events;
  assert.ok(events.some(event => event.id === 'outlook-1'), 'the next refresh includes the new meeting');
});

test('only the room that changed is told, and unknown rooms cannot be watched', async t => {
  const { base, state } = await start(t);
  const back = await listen(base, 'back');
  t.after(() => back.stop());
  await state.refreshRoom('front');
  state.calendars.get('front').bookings.push({ id: 'x', subject: 'x', organizer: '', isPrivate: false, start: minutesFromNow(300).toISOString(), end: minutesFromNow(330).toISOString() });
  await state.refreshRoom('front');
  await sleep(50);
  assert.doesNotMatch(back.text(), /calendar\.changed/);
  assert.equal((await json(base, '/api/stream?room=nowhere')).status, 404);
});

// ---------------------------------------------------------------------------------------------
// Quick booking
// ---------------------------------------------------------------------------------------------

test('books a room, refuses overlaps, and tells the other displays', async t => {
  const { base } = await start(t);
  const stream = await listen(base, 'front');
  t.after(() => stream.stop());
  const first = await json(base, '/api/bookings', { method: 'POST', body: booking('front', minutesFromNow(300), 30) });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).event.subject, 'Reserved');
  await waitFor(() => stream.text().includes('booking.created'), 'the booking event');
  const overlap = await json(base, '/api/bookings', { method: 'POST', body: booking('front', minutesFromNow(310), 30) });
  assert.equal(overlap.status, 409);
  assert.match((await overlap.json()).error, /overlaps/);
});

test('rejects bad bookings: disabled room, unknown room, bad times, wrong length, too far ahead', async t => {
  const { base } = await start(t);
  const post = body => json(base, '/api/bookings', { method: 'POST', body });
  assert.equal((await post(booking('back', minutesFromNow(300)))).status, 403, 'quick booking is off for the back room');
  assert.equal((await post(booking('nowhere', minutesFromNow(300)))).status, 404);
  assert.equal((await post({ roomId: 'front', start: 'x', end: 'y' })).status, 400);
  assert.equal((await post(booking('front', minutesFromNow(300), 10))).status, 400, 'shorter than 15 minutes');
  assert.equal((await post(booking('front', minutesFromNow(300), 180))).status, 400, 'longer than 2 hours');
  assert.equal((await post(booking('front', minutesFromNow(60 * 30)))).status, 400, 'more than a day ahead');
  assert.equal((await post(booking('front', minutesFromNow(-30)))).status, 400, 'in the past');
});

test('refuses to book a company holiday, but never blocks when the holiday check fails', async t => {
  const closed = await start(t, { celebrations: { get: async () => ({}), holidayOn: () => 'Thanksgiving' } });
  const refused = await json(closed.base, '/api/bookings', { method: 'POST', body: booking('front', minutesFromNow(300)) });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /closed for Thanksgiving/);

  const outage = await start(t, { celebrations: { get: async () => { throw new Error('graph is down'); }, holidayOn: () => null } });
  const allowed = await json(outage.base, '/api/bookings', { method: 'POST', body: booking('front', minutesFromNow(300)) });
  assert.equal(allowed.status, 201, 'a Microsoft outage must not stop people booking');
});

// ---------------------------------------------------------------------------------------------
// Tablets, notifications and the admin dashboard
// ---------------------------------------------------------------------------------------------

test('records tablet check-ins with their screen size and ignores junk screen values', async t => {
  const { base, state } = await start(t);
  const beat = body => json(base, '/api/tablets/heartbeat', { method: 'POST', body, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; SM-T220)' } });
  const ok = await beat({ roomId: 'front', tabletId: 't1', name: 'Front tablet', screen: '893x500 @1.5' });
  assert.equal(ok.status, 200);
  assert.equal(state.tablets.get('front:t1').screen, '893x500 @1.5');
  await beat({ roomId: 'front', tabletId: 't1', name: 'Front tablet', screen: '<script>alert(1)</script>' });
  assert.equal(state.tablets.get('front:t1').screen, '893x500 @1.5', 'junk is ignored and the last good value is kept');
  assert.equal((await beat({ roomId: 'nowhere', tabletId: 't1' })).status, 404);
  assert.equal((await beat({ roomId: 'front' })).status, 400);
});

test('only accepts Microsoft change notifications that carry the shared secret', async t => {
  const received = [];
  const subscriptions = { start: async () => { }, stop() { }, processNotifications: values => received.push(...values) };
  const { base } = await start(t, { env: { GRAPH_CLIENT_STATE: 'shared-secret' }, subscriptions });
  const post = value => json(base, '/api/notifications', { method: 'POST', body: { value } });
  assert.equal((await post([{ roomId: 'front', clientState: 'wrong' }])).status, 202, 'always answered quickly');
  assert.equal(received.length, 0, 'but a wrong secret is ignored');
  await post([{ roomId: 'front', clientState: 'shared-secret' }, { roomId: 'back', clientState: 'wrong' }]);
  assert.deepEqual(received.map(v => v.roomId), ['front']);
  const handshake = await fetch(`${base}/api/notifications?validationToken=abc123`, { method: 'POST' });
  assert.equal(await handshake.text(), 'abc123', 'Microsoft\'s validation handshake is echoed back');
});

test('the dashboard API needs the administrator token', async t => {
  const { base } = await start(t);
  assert.equal((await json(base, '/api/admin/overview')).status, 401);
  assert.equal((await json(base, '/api/admin/overview', { token: 'wrong' })).status, 401);
  assert.equal((await json(base, '/api/admin/overview', { token: TOKEN })).status, 200);
  const unconfigured = await start(t, { env: { ADMIN_TOKEN: '' } });
  assert.equal((await json(unconfigured.base, '/api/admin/overview', { token: 'anything' })).status, 503, 'with no token set the controls stay off');
});

test('the dashboard overview lists rooms, tablets, alerts and the current weather', async t => {
  const { base, state } = await start(t, { weather: { get: async () => ({ condition: 'clear', temperatureC: 16, source: 'nws KTEB' }) } });
  state.tablets.set('front:t1', { tabletId: 't1', roomId: 'front', name: 'Front tablet', lastSeen: new Date().toISOString(), connectedAt: new Date().toISOString(), ip: '10.0.0.5', userAgent: 'ua', screen: '893x500 @1.5' });
  const overview = await (await json(base, '/api/admin/overview', { token: TOKEN })).json();
  assert.deepEqual(overview.rooms.map(r => r.id), ['front', 'back']);
  assert.equal(overview.rooms[0].onlineTablets, 1);
  assert.equal(overview.rooms[0].tablets[0].screen, '893x500 @1.5');
  assert.equal(overview.rooms[1].onlineTablets, 0);
  assert.ok(Array.isArray(overview.alerts));
  assert.equal(overview.weather.source, 'nws KTEB');
});

test('admin controls: message, clear, display on and off, refresh, and unknown actions', async t => {
  const { base } = await start(t);
  const control = (room, body) => json(base, `/api/admin/rooms/${room}/control`, { method: 'POST', token: TOKEN, body });
  const state = async () => (await (await json(base, '/api/config?room=front')).json()).control;

  await control('front', { action: 'message', message: 'Lunch is in the kitchen', ttlMinutes: 15 });
  let now = await state();
  assert.equal(now.message, 'Lunch is in the kitchen');
  assert.ok(Date.parse(now.messageExpiresAt) > Date.now(), 'the message has an expiry time');
  await control('front', { action: 'clearMessage' });
  assert.equal((await state()).message, '');

  await control('front', { action: 'displayOff' });
  assert.equal((await state()).displayEnabled, false);
  await control('front', { action: 'displayOn' });
  assert.equal((await state()).displayEnabled, true);

  const revision = (await state()).revision;
  await control('front', { action: 'refresh' });
  assert.equal((await state()).revision, revision + 1, 'refresh bumps the revision so tablets reload');

  assert.equal((await control('front', { action: 'explode' })).status, 400);
  assert.equal((await control('nowhere', { action: 'refresh' })).status, 404);
  assert.equal((await json(base, '/api/admin/rooms/front/control', { method: 'POST', body: { action: 'refresh' } })).status, 401, 'no token, no control');
  await control('front', { action: 'message', message: 'x'.repeat(500) });
  assert.equal((await state()).message.length, 280, 'long messages are cut to 280 characters');
});

test('a message sent from the dashboard reaches the right tablets immediately', async t => {
  const { base } = await start(t);
  const front = await listen(base, 'front');
  const back = await listen(base, 'back');
  t.after(() => Promise.all([front.stop(), back.stop()]));
  await json(base, '/api/admin/rooms/front/control', { method: 'POST', token: TOKEN, body: { action: 'message', message: 'Fire drill' } });
  await waitFor(() => front.text().includes('event: room.control'), 'the control event');
  assert.match(front.text(), /Fire drill/);
  await sleep(50);
  assert.doesNotMatch(back.text(), /Fire drill/);
});

// ---------------------------------------------------------------------------------------------
// Tablet offline alerts
// ---------------------------------------------------------------------------------------------

const EST = iso => Date.parse(iso);                                   // all the times below are written in UTC; EST is UTC-5 in November
const TUESDAY_3PM = EST('2026-11-10T20:00:00Z');
const tablet = (room, id, name, lastSeenMs) => ({ tabletId: id, roomId: room, name, lastSeen: new Date(lastSeenMs).toISOString(), connectedAt: new Date(lastSeenMs - 3600000).toISOString() });

function withAlerts(t, { holiday = null, env = {}, failWebhook = false, teamsAlerts } = {}) {
  const posts = [];
  const fetchImpl = async (url, init) => {
    if (failWebhook) throw new Error('webhook unreachable');
    posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
  return start(t, { env: { ALERT_AFTER_MINUTES: '10', ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/abc', ...env }, fetchImpl, teamsAlerts, celebrations: { get: async () => ({}), holidayOn: () => holiday } }).then(s => ({ ...s, posts }));
}

test('a tablet that goes quiet during office hours raises one alert, and one when it returns', async t => {
  const { state, posts, base } = await withAlerts(t);
  state.tablets.set('front:t1', tablet('front', 't1', 'Front tablet', TUESDAY_3PM - 12 * 60000));
  state.tablets.set('back:t2', tablet('back', 't2', 'Back tablet', TUESDAY_3PM - 20000));

  await state.checkTablets(TUESDAY_3PM);
  assert.equal(state.alerts.length, 1);
  assert.match(state.alerts[0].text, /Front Conference Room: the tablet "Front tablet" has not checked in since 2:48 PM \(12 minutes\)/);
  assert.equal(posts.length, 1, 'also posted to the chat webhook');
  assert.equal(posts[0].url, 'https://hooks.example.invalid/abc');
  assert.match(posts[0].body.text, /Front tablet/);

  await state.checkTablets(TUESDAY_3PM + 60000);
  assert.equal(state.alerts.length, 1, 'no repeat while it stays quiet');

  state.tablets.get('front:t1').lastSeen = new Date(TUESDAY_3PM + 90000).toISOString();
  await state.checkTablets(TUESDAY_3PM + 120000);
  assert.equal(state.alerts.length, 2);
  assert.match(state.alerts[0].text, /back online/);

  const overview = await (await json(base, '/api/admin/overview', { token: TOKEN })).json();
  assert.equal(overview.alerts.length, 2, 'alerts show on the dashboard');
});

test('alerts stay quiet outside office hours, just after opening, on weekends and on holidays', async t => {
  const cases = [
    ['7:00 AM, before opening', EST('2026-11-10T12:00:00Z'), null, false],
    ['8:05 AM, still within the opening grace period', EST('2026-11-10T13:05:00Z'), null, false],
    ['8:15 AM, the office has been open a while', EST('2026-11-10T13:15:00Z'), null, true],
    ['3:00 PM on a normal day', TUESDAY_3PM, null, true],
    ['6:00 PM, after closing', EST('2026-11-10T23:00:00Z'), null, false],
    ['3:00 PM on a Saturday', EST('2026-11-14T20:00:00Z'), null, false],
    ['3:00 PM on a company holiday', TUESDAY_3PM, 'Thanksgiving', false]
  ];
  for (const [label, ms, holiday, shouldAlert] of cases) {
    const { state } = await withAlerts(t, { holiday });
    state.tablets.set('front:t1', tablet('front', 't1', 'Front tablet', ms - 3 * 3600000));
    state.tablets.set('back:t2', tablet('back', 't2', 'Back tablet', ms - 10000));
    await state.checkTablets(ms);
    assert.equal(state.alerts.length > 0, shouldAlert, label);
  }
});

test('alerts when a room has never had a tablet since the server started, once per room', async t => {
  const { state } = await withAlerts(t, { env: { OFFICE_HOURS: 'off' } });
  await state.checkTablets(Date.now() + 5 * 60000);
  assert.equal(state.alerts.length, 0, 'give tablets a few minutes to check in after a restart');
  await state.checkTablets(Date.now() + 11 * 60000);
  assert.equal(state.alerts.length, 2, 'one for each room');
  assert.match(state.alerts[0].text, /no tablet has checked in/);
  await state.checkTablets(Date.now() + 12 * 60000);
  assert.equal(state.alerts.length, 2, 'and no repeat');
});

test('forgets tablets that have been gone for a week', async t => {
  const { state } = await withAlerts(t);
  state.tablets.set('front:old', tablet('front', 'old', 'Old tablet', TUESDAY_3PM - 8 * 86400000));
  state.tablets.set('front:new', tablet('front', 'new', 'New tablet', TUESDAY_3PM - 1000));
  await state.checkTablets(TUESDAY_3PM);
  assert.equal(state.tablets.has('front:old'), false);
  assert.equal(state.tablets.has('front:new'), true);
});

test('works without a chat webhook, and survives a webhook that fails', async t => {
  const noHook = await withAlerts(t, { env: { ALERT_WEBHOOK_URL: '' } });
  noHook.state.tablets.set('front:t1', tablet('front', 't1', 'Front tablet', TUESDAY_3PM - 12 * 60000));
  await noHook.state.checkTablets(TUESDAY_3PM);
  assert.equal(noHook.state.alerts.length, 1);
  assert.equal(noHook.posts.length, 0);

  const broken = await withAlerts(t, { failWebhook: true });
  broken.state.tablets.set('front:t1', tablet('front', 't1', 'Front tablet', TUESDAY_3PM - 12 * 60000));
  await assert.doesNotReject(broken.state.checkTablets(TUESDAY_3PM));
  assert.equal(broken.state.alerts.length, 1, 'the alert still appears on the dashboard');
});

// ---------------------------------------------------------------------------------------------
// Alerts to named people in Teams, the dashboard's test button, and calendar-error alerts
// ---------------------------------------------------------------------------------------------

function fakeTeams({ recipients = ['a@example.com', 'b@example.com'], results } = {}) {
  const sent = [];
  return {
    enabled: true, recipients, sent,
    send: async (text, options) => { sent.push({ text, options }); return results || recipients.map(recipient => ({ recipient, ok: true })); }
  };
}

test('every alert is also sent to the people in Teams, with the default title', async t => {
  const teams = fakeTeams();
  const { state } = await withAlerts(t, { teamsAlerts: teams });
  state.tablets.set('front:t1', tablet('front', 't1', 'Front tablet', TUESDAY_3PM - 12 * 60000));
  await state.checkTablets(TUESDAY_3PM);
  assert.equal(teams.sent.length, 1);
  assert.match(teams.sent[0].text, /Front Conference Room: the tablet "Front tablet" has not checked in/);
  assert.equal(state.alerts.length, 1, 'and it is still listed on the dashboard');
});

test('a failure sending to Teams never stops the alert or the other channels', async t => {
  const failing = fakeTeams({ results: [{ recipient: 'a@example.com', ok: false, step: 'sending the message', error: 'blocked' }] });
  const broken = { enabled: true, recipients: ['a@example.com'], send: async () => { throw new Error('boom'); } };
  for (const teamsAlerts of [failing, broken]) {
    const { state, posts } = await withAlerts(t, { teamsAlerts });
    state.tablets.set('front:t1', tablet('front', 't1', 'Front tablet', TUESDAY_3PM - 12 * 60000));
    await assert.doesNotReject(state.checkTablets(TUESDAY_3PM));
    assert.equal(state.alerts.length, 1);
    assert.equal(posts.length, 1, 'the chat webhook still got it');
  }
});

test('the test button reports, per person, whether Teams delivered', async t => {
  const teams = fakeTeams({ results: [{ recipient: 'a@example.com', ok: true }, { recipient: 'b@example.com', ok: false, step: 'finding the chat', error: 'Microsoft could not find the person' }] });
  const { base, state, posts } = await withAlerts(t, { teamsAlerts: teams });
  assert.equal((await json(base, '/api/admin/test-alert', { method: 'POST' })).status, 401, 'needs the administrator token');
  const response = await json(base, '/api/admin/test-alert', { method: 'POST', token: TOKEN, body: {} });
  assert.equal(response.status, 200);
  const outcome = await response.json();
  assert.equal(outcome.teams.configured, true);
  assert.deepEqual(outcome.teams.results.map(r => r.ok), [true, false]);
  assert.match(outcome.teams.results[1].error, /could not find the person/);
  assert.equal(outcome.webhook.configured, true);
  assert.equal(outcome.webhook.ok, true);
  assert.match(teams.sent[0].text, /test alert/i);
  assert.equal(teams.sent[0].options.title, 'Room Display test alert');
  assert.equal(posts.length, 1);
  assert.match(state.alerts[0].text, /Test alert/, 'noted on the dashboard list too');
});

test('the test button says so when nothing but the dashboard is set up', async t => {
  const { base } = await start(t);
  const outcome = await (await json(base, '/api/admin/test-alert', { method: 'POST', token: TOKEN, body: {} })).json();
  assert.equal(outcome.teams.configured, false);
  assert.equal(outcome.webhook.configured, false);
});

test('the overview says where alerts go', async t => {
  const none = await start(t);
  assert.deepEqual((await (await json(none.base, '/api/admin/overview', { token: TOKEN })).json()).alertChannels, { webhook: false, teamsRecipients: 0 });
  const both = await withAlerts(t, { teamsAlerts: fakeTeams() });
  assert.deepEqual((await (await json(both.base, '/api/admin/overview', { token: TOKEN })).json()).alertChannels, { webhook: true, teamsRecipients: 2 });
});

test('alerts when a room calendar cannot be read for a while, and when it recovers', async t => {
  const teams = fakeTeams();
  const { state } = await withAlerts(t, { teamsAlerts: teams });
  state.calendarProblems.set('front', { since: TUESDAY_3PM - 3 * 60000, error: 'Microsoft Graph request failed (401): token expired' });
  await state.checkTablets(TUESDAY_3PM);
  assert.equal(state.alerts.length, 0, 'a short blip is not worth a message');

  state.calendarProblems.get('front').since = TUESDAY_3PM - 12 * 60000;
  await state.checkTablets(TUESDAY_3PM);
  const alert = state.alerts.find(a => /calendar cannot be read/.test(a.text));
  assert.ok(alert, 'alert after 10 minutes');
  assert.match(alert.text, /Front Conference Room.*\(Microsoft Graph request failed \(401\)/);
  assert.match(alert.text, /app secret and permissions/);
  await state.checkTablets(TUESDAY_3PM + 60000);
  assert.equal(state.alerts.filter(a => /cannot be read/.test(a.text)).length, 1, 'only once');

  state.calendarProblems.delete('front');
  await state.checkTablets(TUESDAY_3PM + 120000);
  assert.match(state.alerts[0].text, /calendar can be read again/);
  assert.ok(teams.sent.some(s => /cannot be read/.test(s.text)) && teams.sent.some(s => /read again/.test(s.text)), 'both reached Teams');
});

test('calendar-error alerts stay quiet outside office hours', async t => {
  const { state } = await withAlerts(t);
  const night = EST('2026-11-11T03:00:00Z');                       // 10 PM the evening before
  state.calendarProblems.set('front', { since: night - 3600000, error: 'down' });
  await state.checkTablets(night);
  assert.equal(state.alerts.length, 0);
});

test('the background check notes a calendar that cannot be read and clears it when it works again', async t => {
  const subscriptions = { start: async () => {}, stop() {}, processNotifications() {} };
  const { state } = await start(t, { env: { CHANGE_CHECK_SECONDS: '5' }, startSubscriptions: true, subscriptions });
  const calendar = state.calendars.get('front');
  const original = calendar.listEvents.bind(calendar);
  calendar.listEvents = async () => { throw new Error('Microsoft Graph request failed (503): unavailable'); };
  await waitFor(() => state.calendarProblems.has('front'), 'the first background check', 4000);
  assert.match(state.calendarProblems.get('front').error, /503/);
  calendar.listEvents = original;
  await state.refreshRoom('front');
  assert.equal(state.calendarProblems.has('front'), false, 'cleared as soon as a read works');
});

// ---------------------------------------------------------------------------------------------
// Client secret expiry reminders and the live-connection ping
// ---------------------------------------------------------------------------------------------

const DAY = 86400000;

test('reminds people as the client secret gets close to expiring, once per stage', async t => {
  const { state, posts } = await withAlerts(t, { env: { CLIENT_SECRET_EXPIRES: '2026-12-10' } });
  assert.deepEqual(state.secretStatus(TUESDAY_3PM), { expires: '2026-12-10', daysLeft: 30, stage: 30 });
  assert.equal(state.secretStatus(TUESDAY_3PM - DAY).stage, null, '31 days left: too early');

  await state.checkSecretExpiry(TUESDAY_3PM - DAY);
  assert.equal(state.alerts.length, 0);
  await state.checkSecretExpiry(TUESDAY_3PM);
  assert.equal(state.alerts.length, 1);
  assert.match(state.alerts[0].text, /secret expires in 30 days \(2026-12-10\)/);
  assert.match(state.alerts[0].text, /CLIENT_SECRET_EXPIRES/);
  assert.equal(posts.length, 1, 'also sent to the chat webhook');
  await state.checkSecretExpiry(TUESDAY_3PM + 60000);
  assert.equal(state.alerts.length, 1, 'no repeat within the same stage');

  await state.checkSecretExpiry(TUESDAY_3PM + 16 * DAY);       // Thursday 26 Nov, 14 days left
  assert.equal(state.alerts.length, 2);
  assert.match(state.alerts[0].text, /expires in 14 days/);
  await state.checkSecretExpiry(TUESDAY_3PM + 29 * DAY);       // 1 day left
  assert.match(state.alerts[0].text, /expires in 1 day \(/);
  await state.checkSecretExpiry(TUESDAY_3PM + 35 * DAY);       // 15 Dec
  assert.match(state.alerts[0].text, /expired on 2026-12-10/);
  assert.equal(state.alerts.length, 4);
});

test('stage thresholds: 14, 7, 3 and 1 days, then expired', async t => {
  const { state } = await withAlerts(t, { env: { CLIENT_SECRET_EXPIRES: '2026-12-10' } });
  const stage = days => state.secretStatus(Date.parse('2026-12-10T17:00:00Z') - days * DAY).stage;
  assert.deepEqual([31, 30, 15, 14, 8, 7, 4, 3, 2, 1, 0, -1].map(stage), [null, 30, 30, 14, 14, 7, 7, 3, 3, 1, 1, 'expired']);
});

test('secret reminders wait for office hours and do nothing when no date is set', async t => {
  const { state } = await withAlerts(t, { env: { CLIENT_SECRET_EXPIRES: '2026-11-12' } });
  await state.checkSecretExpiry(EST('2026-11-10T04:00:00Z'));            // 11 PM Monday night
  assert.equal(state.alerts.length, 0);
  await state.checkSecretExpiry(TUESDAY_3PM);                              // sent once the office is open
  assert.equal(state.alerts.length, 1);
  assert.match(state.alerts[0].text, /expires in 2 days/);

  const none = await withAlerts(t);
  assert.equal(none.state.secretStatus(TUESDAY_3PM), null);
  await none.state.checkSecretExpiry(TUESDAY_3PM);
  assert.equal(none.state.alerts.length, 0);
});

test('the live connection sends a named ping event so tablets can tell it is alive', async t => {
  const { base } = await start(t, { pingSeconds: 0.05 });
  const stream = await listen(base, 'front');
  await waitFor(() => stream.text().includes('event: ping'), 'a ping');
  await stream.stop();
});

// ---------------------------------------------------------------------------------------------
// Daylight saving time. New York moves clocks forward on 14 March 2027 and back on 7 November 2027.
// A server that assumed a fixed offset from UTC would be an hour off the Monday after each change.
// ---------------------------------------------------------------------------------------------

test('office-hours alerts follow the clock on the Monday after clocks go forward and back', async t => {
  const cases = [
    // [label, time in UTC, expect an alert]. The office opens at 8:00 local and alerts wait 10 minutes.
    ['Mon 15 Mar 2027, 8:05 AM EDT (just after spring forward)', '2027-03-15T12:05:00Z', false],
    ['Mon 15 Mar 2027, 8:20 AM EDT', '2027-03-15T12:20:00Z', true],
    ['Mon 15 Mar 2027, 7:20 AM EDT is not "8:20 EST"', '2027-03-15T11:20:00Z', false],
    ['Mon 8 Nov 2027, 8:05 AM EST (just after fall back)', '2027-11-08T13:05:00Z', false],
    ['Mon 8 Nov 2027, 8:20 AM EST', '2027-11-08T13:20:00Z', true],
    ['Mon 8 Nov 2027, 7:20 AM EST', '2027-11-08T12:20:00Z', false],
    ['Mon 8 Nov 2027, 4:55 PM EST, before closing', '2027-11-08T21:55:00Z', true],
    ['Mon 8 Nov 2027, 5:05 PM EST, after closing', '2027-11-08T22:05:00Z', false],
    ['Sun 14 Mar 2027, midday: weekend', '2027-03-14T17:00:00Z', false],
    ['Sun 7 Nov 2027, midday: weekend', '2027-11-07T17:00:00Z', false]
  ];
  for (const [label, iso, shouldAlert] of cases) {
    const { state } = await withAlerts(t);
    const ms = Date.parse(iso);
    state.tablets.set('front:t1', tablet('front', 't1', 'Front tablet', ms - 3 * 3600000));
    state.tablets.set('back:t2', tablet('back', 't2', 'Back tablet', ms - 10000));
    await state.checkTablets(ms);
    assert.equal(state.alerts.length > 0, shouldAlert, label);
  }
});

test('secret expiry counts calendar days in the room time zone across a clock change', async t => {
  const { state } = await withAlerts(t, { env: { CLIENT_SECRET_EXPIRES: '2027-03-15' } });
  const days = iso => state.secretStatus(Date.parse(iso)).daysLeft;
  assert.equal(days('2027-03-13T15:00:00Z'), 2, 'Saturday morning');
  assert.equal(days('2027-03-14T14:00:00Z'), 1, 'Sunday, after the clocks went forward');
  assert.equal(days('2027-03-15T16:00:00Z'), 0, 'Monday');
  assert.equal(days('2027-03-14T04:30:00Z'), 2, '11:30 PM Saturday in New York is still Saturday');
  assert.equal(days('2027-03-15T03:30:00Z'), 1, '11:30 PM Sunday EDT is still Sunday');
});
