import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAppServer } from '../src/server.js';

// Scheduled Snoopy outfits from the dashboard (a day, an event), kept across restarts.

const ROOMS = [
  { id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: 'America/New_York' },
  { id: 'back', name: 'Back Conference Room', email: 'back@example.com', timeZone: 'America/New_York' }
];
const TOKEN = 'schedule-token';
const HOUR = 3600000, DAY = 24 * HOUR;
const quiet = { error() { }, warn() { }, log() { } };

async function start(t, { dataDir, logger = quiet } = {}) {
  const server = createAppServer({ env: { DEMO_MODE: 'true', ROOMS_JSON: JSON.stringify(ROOMS), ADMIN_TOKEN: TOKEN, WEATHER_ENABLED: 'false' }, startSubscriptions: false, logger, celebrations: { get: async () => ({ celebrations: [] }), holidayOn: () => null }, dataDir });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const stop = () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); });
  t.after(stop);
  const base = `http://127.0.0.1:${server.address().port}`;
  const control = (room, body) => fetch(`${base}/api/admin/rooms/${room}/control`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
  const now = async room => (await (await fetch(`${base}/api/config?room=${room}`)).json()).control;
  return { base, state: server.appState, control, now, stop };
}
const iso = ms => new Date(ms).toISOString();

test('a scheduled outfit is worn only during its time, a push beats it, and it can be removed', async t => {
  const { state, control, now } = await start(t);
  const from = Date.now() + 2 * HOUR, to = from + DAY;
  let response = await control('front', { action: 'scheduleOutfit', outfit: 'halloween', start: iso(from), end: iso(to) });
  assert.equal(response.status, 200);
  let front = await now('front');
  assert.equal(front.outfit, null, 'not yet');
  assert.equal(front.outfitSchedule.length, 1);
  const entry = front.outfitSchedule[0];
  assert.deepEqual([entry.outfit, entry.start, entry.end], ['halloween', iso(from), iso(to)]);
  assert.match(entry.label, /Halloween/);
  assert.equal((await now('back')).outfitSchedule.length, 0, 'the other room is not affected');

  const during = state.effectiveControl('front', from + HOUR);
  assert.deepEqual([during.outfit, during.outfitUntil, during.outfitSource, during.outfitScheduleId], ['halloween', iso(to), 'schedule', entry.id]);
  assert.equal(state.effectiveControl('front', to + 1).outfit, null, 'over afterwards');

  // A push from the dashboard wins while it lasts; "Back to automatic" ends the push, not the schedule.
  await control('front', { action: 'outfit', outfit: 'chef', ttlMinutes: 60 });
  assert.equal(state.effectiveControl('front', Date.now() + 60000).outfit, 'chef');
  assert.equal(state.effectiveControl('front', Date.now() + 60000).outfitSource, 'push');
  await control('front', { action: 'clearOutfit' });
  assert.equal(state.effectiveControl('front', from + HOUR).outfit, 'halloween', 'the schedule is still there');

  // Overlapping entries: the one that started last applies.
  await control('front', { action: 'scheduleOutfit', outfit: 'none', start: iso(from + 3 * HOUR), end: iso(from + 4 * HOUR) });
  assert.equal(state.effectiveControl('front', from + 3.5 * HOUR).outfit, 'none', '"No outfit" for an hour inside the day');
  assert.equal(state.effectiveControl('front', from + 5 * HOUR).outfit, 'halloween');

  response = await control('front', { action: 'unscheduleOutfit', id: entry.id });
  assert.equal(response.status, 200);
  front = await now('front');
  assert.deepEqual(front.outfitSchedule.map(e => e.outfit), ['none']);
  assert.equal((await control('front', { action: 'unscheduleOutfit', id: entry.id })).status, 404, 'removing twice says it is gone');
});

test('scheduling refuses what makes no sense, and changes nothing when it does', async t => {
  const { control, now } = await start(t);
  const soon = Date.now() + HOUR;
  for (const [body, message] of [
    [{ outfit: 'no-such-outfit', start: iso(soon), end: iso(soon + HOUR) }, /Unknown outfit/],
    [{ outfit: 'halloween', start: 'tomorrow', end: iso(soon) }, /when it starts and when it ends/],
    [{ outfit: 'halloween', start: iso(soon + HOUR), end: iso(soon) }, /end must be after the start/],
    [{ outfit: 'halloween', start: iso(Date.now() - 3 * HOUR), end: iso(Date.now() - HOUR) }, /already passed/],
    [{ outfit: 'halloween', start: iso(Date.now() + 400 * DAY), end: iso(Date.now() + 401 * DAY) }, /at most a year ahead/],
    [{ outfit: 'halloween', start: iso(soon), end: iso(soon + 15 * DAY) }, /at most 14 days/]
  ]) {
    const response = await control('front', { action: 'scheduleOutfit', ...body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).error, message);
  }
  assert.equal((await now('front')).outfitSchedule.length, 0);
  for (let i = 0; i < 30; i += 1) assert.equal((await control('front', { action: 'scheduleOutfit', outfit: 'chef', start: iso(soon + i * DAY), end: iso(soon + i * DAY + HOUR) })).status, 200);
  const full = await control('front', { action: 'scheduleOutfit', outfit: 'chef', start: iso(soon + 40 * DAY), end: iso(soon + 41 * DAY) });
  assert.equal(full.status, 400);
  assert.match((await full.json()).error, /already has 30 scheduled outfits/);
  const list = (await now('front')).outfitSchedule;
  assert.deepEqual(list.map(e => e.start), [...list.map(e => e.start)].sort(), 'kept in time order');
  const unauthorised = await fetch(`${(await start(t)).base}/api/admin/rooms/front/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'scheduleOutfit', outfit: 'chef', start: iso(soon), end: iso(soon + HOUR) }) });
  assert.equal(unauthorised.status, 401, 'no token, no schedule');
});

test('tablets are told when a scheduled outfit starts and ends', async t => {
  const { base, state, control } = await start(t);
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/stream?room=front`, { signal: controller.signal });
  let text = '';
  const reading = (async () => { try { for await (const chunk of stream.body) text += Buffer.from(chunk).toString(); } catch { } })();
  t.after(async () => { controller.abort(); await reading; });
  const from = Date.now() + 5000, to = from + HOUR;
  await control('front', { action: 'scheduleOutfit', outfit: 'halloween', start: iso(from), end: iso(to) });
  const sent = () => (text.match(/"action":"outfitSchedule"/g) || []).length;
  await new Promise(r => setTimeout(r, 100));
  state.checkOutfitSchedules(from - 1000);
  assert.equal(sent(), 0, 'nothing before it starts');
  state.checkOutfitSchedules(from + 1000);
  for (let i = 0; i < 50 && sent() < 1; i += 1) await new Promise(r => setTimeout(r, 20));
  assert.equal(sent(), 1, 'one message when it starts');
  assert.match(text.slice(text.lastIndexOf('event: room.control')), /"outfit":"halloween"/);
  state.checkOutfitSchedules(from + 2000);
  assert.equal(sent(), 1, 'no repeats while it lasts');
  state.checkOutfitSchedules(to + 1000);
  for (let i = 0; i < 50 && sent() < 2; i += 1) await new Promise(r => setTimeout(r, 20));
  assert.equal(sent(), 2, 'one message when it ends');
  assert.match(text.slice(text.lastIndexOf('event: room.control')), /"outfit":null/);
});

test('pushes and scheduled outfits survive a restart; old ones and a damaged file are dropped safely', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-display-data-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const first = await start(t, { dataDir });
  const from = Date.now() + DAY;
  await first.control('front', { action: 'scheduleOutfit', outfit: 'christmas', start: iso(from), end: iso(from + DAY) });
  await first.control('back', { action: 'outfit', outfit: 'chef', ttlMinutes: 120 });
  const file = path.join(dataDir, 'outfit-overrides.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.rooms.front.schedule[0].outfit, 'christmas');
  assert.equal(saved.rooms.back.push.outfit, 'chef');
  assert.ok(!fs.existsSync(`${file}.tmp`), 'no half-written file left behind');
  await first.stop();

  const second = await start(t, { dataDir });
  assert.equal((await second.now('front')).outfitSchedule[0].outfit, 'christmas', 'schedule kept');
  assert.equal((await second.now('back')).outfit, 'chef', 'push kept');
  await second.stop();

  // Expired entries are not brought back.
  saved.rooms.front.schedule[0].end = iso(Date.now() - 1000);
  saved.rooms.back.push.until = iso(Date.now() - 1000);
  fs.writeFileSync(file, JSON.stringify(saved));
  const third = await start(t, { dataDir });
  assert.equal((await third.now('front')).outfitSchedule.length, 0);
  assert.equal((await third.now('back')).outfit, null);
  await third.stop();

  // A damaged file: the server still starts, says so in the log, and works.
  fs.writeFileSync(file, '{ not json');
  const logged = [];
  const fourth = await start(t, { dataDir, logger: { ...quiet, error: m => logged.push(String(m)) } });
  assert.match(logged.join('\n'), /Could not read the saved outfit overrides/);
  assert.equal((await fourth.control('front', { action: 'scheduleOutfit', outfit: 'chef', start: iso(from), end: iso(from + HOUR) })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).rooms.front.schedule.length, 1, 'and saves a good file again');
});

test('the saved data folder is never deployed over, never committed, and the live server uses it', () => {
  const root = new URL('..', import.meta.url);
  const deploy = fs.readFileSync(new URL('scripts/deploy-on-server.sh', root), 'utf8');
  assert.match(deploy.match(/^EXCLUDES=\(.*\)$/m)[0], / --exclude \/data /);
  assert.match(fs.readFileSync(new URL('.gitignore', root), 'utf8'), /^\/data\/$/m);
  assert.match(fs.readFileSync(new URL('src/server.js', root), 'utf8'), /createAppServer\(\{ dataDir: process\.env\.DATA_DIR \|\| path\.join\(ROOT, 'data'\) \}\)/);
});

test('the dashboard can schedule an outfit for one room or all rooms, and remove it', () => {
  const js = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
  assert.match(js, /outfitControls\(room,data\.outfits\|\|\[\],data\.rooms\)/);
  assert.match(js, /action: 'scheduleOutfit', outfit: schedulePick\.value, start: new Date\(from\.value\)\.toISOString\(\), end: new Date\(to\.value\)\.toISOString\(\)/);
  assert.match(js, /everywhere\.checked \? \(rooms \|\| \[room\]\)\.map/);
  assert.match(js, /control\(room\.id, 'unscheduleOutfit', \{ id: e\.id \}\)/);
  assert.match(js, /from\.type = 'datetime-local'/);
  assert.match(js, /c\.outfitSource === 'schedule' \? 'Scheduled now: ' : 'Pushed: '/);
});
