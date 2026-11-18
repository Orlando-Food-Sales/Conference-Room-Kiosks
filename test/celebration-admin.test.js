import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAppServer } from '../src/server.js';
import { CelebrationAdmin, isOwnAnniversary, nextOccurrence, anniversarySubject, birthdaySubject } from '../src/celebration-admin.js';
// Dashboard control over birthdays and work anniversaries, against a fake Microsoft Graph (nothing leaves this machine).
const NY = 'America/New_York';
const TOKEN = 'secret-token';
const ROOMS = [{ id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: NY }];
const NOW = new Date('2026-11-10T17:00:00Z');            // noon in New York, 2026-11-10
const yearly = (id, subject, month, dayOfMonth, extra = {}) => ({
  id, subject, isAllDay: true, isCancelled: false, type: 'seriesMaster',
  start: { dateTime: `2019-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}T00:00:00.0000000`, timeZone: NY },
  end: { dateTime: `2019-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}T00:00:00.0000000`, timeZone: NY },
  recurrence: { pattern: { type: 'absoluteYearly', interval: 1, month, dayOfMonth }, range: { type: 'noEnd', startDate: '2019-01-01' } }, ...extra
});
const oneOff = (id, subject, date) => ({ id, subject, isAllDay: true, isCancelled: false, type: 'singleInstance', start: { dateTime: `${date}T00:00:00.0000000` }, end: { dateTime: `${date}T00:00:00.0000000` } });
const answer = (body, status = 200) => status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function events() {
  return [
    yearly('a1', 'Fred Mortati - Work Anniversary (since 1988)', 7, 5),
    yearly('a2', 'Jodi Andrade - Work Anniversary (since 2025)', 11, 17),
    yearly('a3', 'Sam Okafor - Work Anniversary (since 2019) \uD83C\uDF89', 12, 1),          // extra emoji: not the app's format
    yearly('b1', 'Maria Santos - Birthday', 11, 12),                                    // entered by someone else
    oneOff('b2', 'Jordan Lee - Birthday', '2026-12-24'),
    oneOff('b3', 'Old One - Birthday', '2020-01-01'),                                   // a past one-off
    { ...yearly('p1', 'Craig - PTO', 3, 3) },
    { ...yearly('w1', 'Anniversary party planning', 1, 1), recurrence: { pattern: { type: 'weekly', interval: 1 }, range: { type: 'noEnd' } } },
    { ...yearly('c1', 'Cancelled Person - Birthday', 2, 2), isCancelled: true }
  ];
}
// The fake Microsoft: records every call, can be told to fail.
function fakeGraph({ canEdit = true, list = events(), calendars = null, fail = null } = {}) {
  const state = { calls: [], events: list, canEdit, fail, calendars: calendars || [{ id: 'cal1', name: 'Calendar', canEdit }] };
  state.fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method || 'GET';
    state.calls.push({ method, path: parsed.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    if (parsed.hostname === 'login.microsoftonline.com') return answer({ access_token: 't', expires_in: 3600 });
    if (state.fail) { if (state.fail === 'throw') throw new TypeError('fetch failed'); return answer({ error: { message: 'x' } }, state.fail); }
    const p = parsed.pathname.replace(/^\/v1\.0\/users\/[^/]+/, '');
    if (method === 'GET' && p === '/calendars') return answer({ value: state.calendars });
    const one = p.match(/^\/calendars\/([^/]+)$/);
    if (method === 'GET' && one) return answer(state.calendars.find(c => c.id === decodeURIComponent(one[1])) || {}, state.calendars.some(c => c.id === decodeURIComponent(one[1])) ? 200 : 404);
    const list2 = p.match(/^\/calendars\/([^/]+)\/events$/);
    if (list2 && method === 'GET') return answer({ value: state.events });
    if (list2 && method === 'POST') { const created = { id: `new${state.events.length}`, ...JSON.parse(init.body) }; state.events.push({ ...created, type: 'seriesMaster' }); return answer(created, 201); }
    const item = p.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/);
    if (item) {
      const found = state.events.find(e => e.id === decodeURIComponent(item[2]));
      if (!found) return answer({ error: { message: 'gone' } }, 404);
      if (method === 'DELETE') { state.events.splice(state.events.indexOf(found), 1); return answer({}, 204); }
      return answer(found);
    }
    if (parsed.pathname.endsWith('/calendarView')) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(new Date());
      return answer({ value: [{ subject: 'Dana Cruz - Birthday', isAllDay: true, start: { dateTime: `${today}T00:00:00.0000000` }, end: { dateTime: `${addDay(today)}T00:00:00.0000000` } }] });
    }
    return answer({ value: [] });
  };
  return state;
}
const addDay = key => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const tmpDir = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'celeb-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const config = (birthdays = {}) => ({ demoMode: false, birthdays: { mailbox: 'cal@example.com', calendarId: '', calendarName: 'Calendar', nameStyle: 'full', timeZone: NY, ...birthdays } });
const admin = (graph, opts = {}, cfg = config()) => new CelebrationAdmin(cfg, { getToken: async () => 'token' }, graph.fetchImpl, { logger: { error() { }, warn() { } }, ...opts });
const writes = graph => graph.calls.filter(c => c.method !== 'GET' && !c.path.includes('oauth2'));
// ---- pure helpers ----
test('the next date of a yearly entry counts today and waits for leap years', () => {
  assert.deepEqual(nextOccurrence(11, 10, '2026-11-10'), { date: '2026-11-10', daysUntil: 0 });
  assert.deepEqual(nextOccurrence(11, 9, '2026-11-10'), { date: '2027-11-09', daysUntil: 364 });
  assert.equal(nextOccurrence(2, 29, '2026-03-01').date, '2028-02-29');
});
test('only the exact anniversary format counts as the app\'s own', () => {
  const own = yearly('x', 'Fred Mortati - Work Anniversary (since 1988)', 7, 5);
  assert.equal(isOwnAnniversary(own), true);
  assert.equal(isOwnAnniversary({ ...own, subject: 'Fred Mortati - Work Anniversary (since 1988) \uD83C\uDF89' }), false);
  assert.equal(isOwnAnniversary({ ...own, subject: 'Fred Mortati - Birthday' }), false);
  assert.equal(isOwnAnniversary({ ...own, type: 'singleInstance' }), false);
  assert.equal(isOwnAnniversary({ ...own, isAllDay: false }), false);
  assert.equal(isOwnAnniversary({ ...own, recurrence: { pattern: { type: 'weekly', interval: 1 } } }), false);
  assert.equal(isOwnAnniversary({ ...own, subject: 'Fred - Work Anniversary (since 1788)' }), false);
  assert.equal(anniversarySubject('Ann Lee', 2020), 'Ann Lee - Work Anniversary (since 2020)');
  assert.equal(birthdaySubject('Ann Lee'), 'Ann Lee - Birthday');
});
// ---- list ----
test('the list shows everyone, soonest first, with years, dates and what may be deleted', async () => {
  const graph = fakeGraph();
  const out = await admin(graph).list(NOW);
  assert.deepEqual(out.people.map(p => `${p.name}|${p.kind}|${p.nextDate}`), [
    'Maria Santos|birthday|2026-11-12', 'Jodi Andrade|anniversary|2026-11-17', 'Sam Okafor|anniversary|2026-12-01', 'Jordan Lee|birthday|2026-12-24', 'Fred Mortati|anniversary|2027-07-05'
  ]);
  const by = name => out.people.find(p => p.name === name);
  assert.equal(by('Jodi Andrade').upcomingYears, 1);
  assert.equal(by('Fred Mortati').upcomingYears, 39);
  assert.equal(by('Maria Santos').upcomingYears, null);
  assert.equal(by('Jodi Andrade').daysUntil, 7);
  assert.deepEqual(['Fred Mortati', 'Jodi Andrade', 'Sam Okafor', 'Maria Santos', 'Jordan Lee'].map(n => by(n).canDelete), [true, true, false, false, false]);
  assert.equal(out.skipped, 2, 'the weekly "Anniversary party planning" and the past one-off birthday are counted, not listed; PTO and cancelled entries are ignored');
  assert.deepEqual(out.writeCalendar, { name: 'Calendar', canEdit: true });
  assert.equal(by('Fred Mortati').calendarName, 'Calendar');
});
test('the list says so when birthdays are not set up', async () => {
  const out = await new CelebrationAdmin(config({ mailbox: '' }), null, fetch, { logger: {} }).list(NOW);
  assert.equal(out.enabled, false);
  assert.match(out.message, /BIRTHDAY_CALENDAR_MAILBOX/);
});
// ---- remove ----
test('remove deletes exactly one yearly anniversary series and nothing else', async () => {
  const graph = fakeGraph();
  await admin(graph).remove({ id: 'a2', calendarId: 'cal1' }, NOW);
  assert.deepEqual(writes(graph).map(c => `${c.method} ${c.path}`), ['DELETE /v1.0/users/cal%40example.com/calendars/cal1/events/a2']);
  assert.ok(!graph.events.some(e => e.id === 'a2') && graph.events.length === events().length - 1);
});
test('remove refuses anything that is not the app\'s own anniversary format', async () => {
  for (const id of ['a3', 'b1', 'b2', 'p1', 'w1']) {
    const graph = fakeGraph();
    await assert.rejects(admin(graph).remove({ id, calendarId: 'cal1' }, NOW), err => err.status === 409 && /not in the app/.test(err.message), id);
    assert.equal(writes(graph).length, 0, `${id}: no DELETE was sent`);
  }
});
test('remove re-reads the event and refuses one that changed since the list was shown', async () => {
  const graph = fakeGraph();
  const a = admin(graph);
  await a.list(NOW);
  graph.events.find(e => e.id === 'a1').subject = 'Fred Mortati - Birthday';
  await assert.rejects(a.remove({ id: 'a1', calendarId: 'cal1' }, NOW), err => err.status === 409);
  assert.equal(writes(graph).length, 0);
});
test('remove refuses an unknown calendar, an unknown entry and a read-only calendar', async () => {
  let graph = fakeGraph();
  await assert.rejects(admin(graph).remove({ id: 'a1', calendarId: 'other' }, NOW), err => err.status === 404);
  await assert.rejects(admin(graph).remove({ id: 'nope', calendarId: 'cal1' }, NOW), err => err.status === 404);
  await assert.rejects(admin(graph).remove({ id: '', calendarId: 'cal1' }, NOW), err => err.status === 400);
  graph = fakeGraph({ canEdit: false });
  await assert.rejects(admin(graph).remove({ id: 'a1', calendarId: 'cal1' }, NOW), err => err.status === 409 && /read-only/.test(err.message));
  assert.equal(writes(graph).length, 0);
});
// ---- add ----
test('add creates an all-day yearly event the door screens can read', async () => {
  const graph = fakeGraph();
  const done = await admin(graph).add({ kind: 'anniversary', name: '  Ann   Lee ', month: 3, day: 9, since: 2020 }, NOW);
  assert.equal(done.calendarName, 'Calendar');
  const [post] = writes(graph);
  assert.equal(post.method, 'POST');
  assert.equal(post.path, '/v1.0/users/cal%40example.com/calendars/cal1/events');
  assert.deepEqual(post.body, {
    subject: 'Ann Lee - Work Anniversary (since 2020)', isAllDay: true, showAs: 'free', isReminderOn: false,
    start: { dateTime: '2020-03-09T00:00:00', timeZone: NY }, end: { dateTime: '2020-03-10T00:00:00', timeZone: NY },
    recurrence: { pattern: { type: 'absoluteYearly', interval: 1, month: 3, dayOfMonth: 9 }, range: { type: 'noEnd', startDate: '2020-03-09' } }
  });
  assert.equal(done.person.upcomingYears, 7);
  await admin(graph).add({ kind: 'birthday', name: 'Bo Chen', month: 12, day: 31 }, NOW);
  const birthday = writes(graph)[1].body;
  assert.equal(birthday.subject, 'Bo Chen - Birthday');
  assert.equal(birthday.start.dateTime, '2026-12-31T00:00:00');
  assert.equal(birthday.recurrence.range.startDate, '2026-12-31');
});
test('add refuses names and dates the door screens would misread', async () => {
  const graph = fakeGraph();
  const a = admin(graph);
  const bad = (input, status = 400) => assert.rejects(a.add({ kind: 'anniversary', name: 'Ann Lee', month: 3, day: 9, since: 2020, ...input }, NOW), err => err.status === status, JSON.stringify(input));
  await bad({ name: 'A' });
  await bad({ name: 'Ann Birthday Lee' });
  await bad({ name: 'Work Lee' });
  await bad({ name: 'Ann 2 Lee' });
  await bad({ name: 'Mary-Jane Lee' });
  await bad({ name: `${'a'.repeat(61)}` });
  await bad({ name: '<b>Lee</b>' });
  await bad({ kind: 'party' });
  await bad({ month: 13 });
  await bad({ month: 2, day: 30 });
  await bad({ month: 2, day: 29 });
  await bad({ since: undefined });
  await bad({ since: 2027 });
  await bad({ since: 1949 });
  await bad({ since: 'abc' });
  await bad({ name: 'Fred Mortati', since: 1988 }, 409);
  await bad({ name: 'maria santos', kind: 'birthday' }, 409);
  assert.equal(writes(graph).length, 0, 'nothing was written');
});
test('add refuses a read-only calendar and an unclear write calendar', async () => {
  let graph = fakeGraph({ canEdit: false });
  await assert.rejects(admin(graph).add({ kind: 'birthday', name: 'Bo Chen', month: 5, day: 5 }, NOW), err => err.status === 409 && /read-only/.test(err.message));
  assert.equal(writes(graph).length, 0);
  graph = fakeGraph({ calendars: [{ id: 'c1', name: 'Team calendar', canEdit: true }, { id: 'c2', name: 'Birthday calendar', canEdit: true }] });
  const a = admin(graph, {}, config({ calendarName: 'calendar' }));
  await assert.rejects(a.add({ kind: 'birthday', name: 'Bo Chen', month: 5, day: 5 }, NOW), err => err.status === 409 && /BIRTHDAY_CALENDAR_ID/.test(err.message));
  assert.equal(writes(graph).length, 0);
  graph = fakeGraph({ calendars: [{ id: 'c1', name: 'Calendar', canEdit: true }, { id: 'c2', name: 'Calendar (old)', canEdit: true }] });
  await admin(graph).add({ kind: 'birthday', name: 'Bo Chen', month: 5, day: 5 }, NOW);
  assert.match(writes(graph)[0].path, /\/calendars\/c1\/events$/, 'the exact name wins over a partial match');
});
// ---- hide ----
test('hide is stored under the data folder, survives a restart and does not touch the calendar', async t => {
  const dir = tmpDir(t);
  const graph = fakeGraph();
  const seen = [];
  const first = admin(graph, { dataDir: dir, onHiddenChange: keys => seen.push([...keys]) });
  await first.setHidden({ kind: 'birthday', name: 'Maria Santos', hidden: true }, NOW);
  assert.deepEqual(seen, [['birthday:maria santos']]);
  assert.equal(writes(graph).length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'celebration-hidden.json'), 'utf8')).hidden, ['birthday:maria santos']);
  assert.ok(!fs.existsSync(path.join(dir, 'celebration-hidden.json.tmp')));
  const second = admin(graph, { dataDir: dir });
  assert.equal((await second.list(NOW)).people.find(p => p.name === 'Maria Santos').hidden, true);
  await assert.rejects(second.setHidden({ kind: 'birthday', name: 'Nobody Here', hidden: true }, NOW), err => err.status === 404);
  await second.setHidden({ kind: 'birthday', name: 'Maria Santos', hidden: false }, NOW);
  assert.equal(admin(graph, { dataDir: dir }).hiddenKeys.size, 0);
});
test('a broken hide file is ignored and removing a person also drops their hide', async t => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'celebration-hidden.json'), '{nope');
  const errors = [];
  const graph = fakeGraph();
  const a = admin(graph, { dataDir: dir, logger: { error: m => errors.push(m) } });
  assert.equal(a.hiddenKeys.size, 0);
  assert.equal(errors.length, 1);
  await a.setHidden({ kind: 'anniversary', name: 'Jodi Andrade', hidden: true }, NOW);
  await a.remove({ id: 'a2', calendarId: 'cal1' }, NOW);
  assert.equal(a.hiddenKeys.size, 0);
});
// ---- the server ----
async function startServer(t, { graph = fakeGraph(), env = {}, dataDir, logs = [], useRealDoor = false } = {}) {
  const server = createAppServer({
    env: { ROOMS_JSON: JSON.stringify(ROOMS), ADMIN_TOKEN: TOKEN, WEATHER_ENABLED: 'false', TENANT_ID: 'tenant', CLIENT_ID: 'client', CLIENT_SECRET: 'secret', BIRTHDAY_CALENDAR_MAILBOX: 'cal@example.com', BIRTHDAY_CALENDAR_NAME: 'Calendar', BIRTHDAY_NAME_STYLE: 'full', ...env },
    startSubscriptions: false, fetchImpl: graph.fetchImpl, dataDir, logger: { error() { }, warn: m => logs.push(`warn ${m}`), log: m => logs.push(m) },
    ...(useRealDoor ? {} : { celebrations: { get: async () => ({ celebrations: [] }), holidayOn: () => null } })
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, { method = 'GET', body, token = TOKEN, headers = {} } = {}) => fetch(base + route, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { base, call, graph, logs };
}
test('all four celebration routes need the administrator token', async t => {
  const { call, graph } = await startServer(t);
  const routes = [['GET', '/api/admin/celebrations'], ['POST', '/api/admin/celebrations/hide'], ['POST', '/api/admin/celebrations/add'], ['POST', '/api/admin/celebrations/remove']];
  for (const [method, route] of routes) {
    assert.equal((await call(route, { method, token: '', body: method === 'POST' ? { id: 'a1', calendarId: 'cal1' } : undefined })).status, 401, route);
    assert.equal((await call(route, { method, token: 'wrong', body: method === 'POST' ? { id: 'a1', calendarId: 'cal1' } : undefined })).status, 401, route);
  }
  assert.equal(graph.calls.filter(c => !c.path.includes('oauth2')).length, 0, 'Microsoft was never called');
});
test('list, add, hide and remove work through the server and each change is logged for Recent activity', async t => {
  const logs = [];
  const { call, graph } = await startServer(t, { logs });
  const listed = await (await call('/api/admin/celebrations')).json();
  assert.equal(listed.people.length, 5);
  assert.equal(listed.mailbox, 'cal@example.com');
  assert.equal((await call('/api/admin/celebrations/add', { method: 'POST', body: { kind: 'anniversary', name: 'Ann Lee', month: 3, day: 9, since: 2020 } })).status, 200);
  assert.equal((await call('/api/admin/celebrations/hide', { method: 'POST', body: { kind: 'birthday', name: 'Maria Santos', hidden: true } })).status, 200);
  assert.equal((await call('/api/admin/celebrations/hide', { method: 'POST', body: { kind: 'birthday', name: 'Maria Santos', hidden: false } })).status, 200);
  assert.equal((await call('/api/admin/celebrations/remove', { method: 'POST', body: { id: 'a2', calendarId: 'cal1' } })).status, 200);
  assert.deepEqual(logs.filter(l => l.startsWith('Celebrations:')), [
    'Celebrations: Ann Lee (Work Anniversary since 2020, 3/9) added to the calendar "Calendar" by the administrator token',
    'Celebrations: Maria Santos (Birthday) hidden from the door screens by the administrator token',
    'Celebrations: Maria Santos (Birthday) shown again on the door screens by the administrator token',
    'Celebrations: Jodi Andrade (Work Anniversary since 2025) removed from calendar "Calendar" by the administrator token'
  ]);
  const overview = await (await call('/api/admin/overview')).json();
  assert.equal(overview.activity.filter(a => a.text.startsWith('Celebrations:')).length, 4);
  for (const line of logs) assert.ok(!/cal@example\.com|cal1|a2|secret/.test(line), `no address, id or secret in: ${line}`);
  assert.ok(graph.events.some(e => e.subject === 'Ann Lee - Work Anniversary (since 2020)'));
});
test('the server refuses to delete what it cannot recognise and logs nothing for it', async t => {
  const logs = [];
  const { call, graph } = await startServer(t, { logs });
  const res = await call('/api/admin/celebrations/remove', { method: 'POST', body: { id: 'b1', calendarId: 'cal1' } });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /will not delete it/);
  assert.equal(writes(graph).length, 0);
  assert.deepEqual(logs.filter(l => l.startsWith('Celebrations:')), []);
});
test('a read-only calendar and Microsoft failures give plain-language answers', async t => {
  let ctx = await startServer(t, { graph: fakeGraph({ canEdit: false }) });
  let res = await ctx.call('/api/admin/celebrations/remove', { method: 'POST', body: { id: 'a1', calendarId: 'cal1' } });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /read-only/);
  const listed = await (await ctx.call('/api/admin/celebrations')).json();
  assert.equal(listed.writeCalendar.canEdit, false, 'the panel can show a read-only notice');
  assert.equal(listed.people.every(p => p.calendarCanEdit === false), true);
  for (const [fail, status, pattern] of [[503, 503, /not answering right now. Nothing was changed/], [403, 502, /Calendars\.ReadWrite/], [404, 404, /could not find that mailbox or calendar/], ['throw', 503, /not answering right now/]]) {
    ctx = await startServer(t, { graph: fakeGraph({ fail }) });
    res = await ctx.call('/api/admin/celebrations');
    assert.equal(res.status, status, String(fail));
    assert.match((await res.json()).error, pattern, String(fail));
  }
  ctx = await startServer(t);
  res = await ctx.call('/api/admin/celebrations/add', { method: 'POST', body: { kind: 'birthday', name: 'Bo 5', month: 5, day: 5 } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /person.s name/);
});
test('a hidden person disappears from the door screens at once and comes back when shown again', async t => {
  const dir = tmpDir(t);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(new Date());
  const graph = fakeGraph({ list: [yearly('d1', 'Dana Cruz - Birthday', Number(today.slice(5, 7)), Number(today.slice(8, 10)))] });
  const first = await startServer(t, { graph, dataDir: dir, useRealDoor: true });
  const door = async base => (await (await fetch(`${base}/api/celebrations?room=front`)).json()).celebrations.map(c => c.name);
  assert.deepEqual(await door(first.base), ['Dana Cruz']);
  assert.equal((await first.call('/api/admin/celebrations/hide', { method: 'POST', body: { kind: 'birthday', name: 'Dana Cruz', hidden: true } })).status, 200);
  assert.deepEqual(await door(first.base), [], 'gone from the door screens straight away');
  assert.equal(writes(graph).length, 0, 'the calendar was not touched');
  const second = await startServer(t, { graph, dataDir: dir, useRealDoor: true });
  assert.deepEqual(await door(second.base), [], 'a restarted server reads the saved hide file');
  assert.equal((await second.call('/api/admin/celebrations/hide', { method: 'POST', body: { kind: 'birthday', name: 'Dana Cruz', hidden: false } })).status, 200);
  assert.deepEqual(await door(second.base), ['Dana Cruz']);
});
// ---- demo mode ----
test('demo mode lists people, adds and removes without calling Microsoft', async t => {
  let called = 0;
  const logs = [];
  const server = createAppServer({ env: { DEMO_MODE: 'true', ROOMS_JSON: JSON.stringify(ROOMS), ADMIN_TOKEN: TOKEN, WEATHER_ENABLED: 'false' }, startSubscriptions: false, fetchImpl: async () => { called += 1; throw new Error('no network'); }, logger: { error() { }, warn() { }, log: m => logs.push(m) }, dataDir: tmpDir(t) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const call = (route, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${route}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const listed = await (await call('/api/admin/celebrations')).json();
  assert.equal(listed.demo, true);
  assert.ok(listed.people.length >= 6);
  assert.deepEqual(listed.people.map(p => p.daysUntil), [...listed.people.map(p => p.daysUntil)].sort((a, b) => a - b));
  const added = await (await call('/api/admin/celebrations/add', 'POST', { kind: 'anniversary', name: 'Ann Lee', month: 3, day: 9, since: 2020 })).json();
  assert.equal(added.person.canDelete, true);
  assert.equal((await (await call('/api/admin/celebrations')).json()).people.length, listed.people.length + 1);
  const birthday = listed.people.find(p => p.kind === 'birthday');
  assert.equal((await call('/api/admin/celebrations/remove', 'POST', { id: birthday.id, calendarId: birthday.calendarId })).status, 409, 'a birthday is hide-only, also in demo');
  assert.equal((await call('/api/admin/celebrations/remove', 'POST', { id: added.person.id, calendarId: 'demo' })).status, 200);
  assert.equal((await (await call('/api/admin/celebrations')).json()).people.length, listed.people.length);
  assert.equal((await call('/api/admin/celebrations/hide', 'POST', { kind: birthday.kind, name: birthday.name, hidden: true })).status, 200);
  assert.equal(called, 0, 'no request left the server');
  assert.equal(logs.filter(l => l.startsWith('Celebrations:')).length, 3);
});
