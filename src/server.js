import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { loadConfig, publicRoom } from './config.js';
import { DemoCalendar } from './demo-calendar.js';
import { GraphCalendar, GraphTokenProvider } from './graph-calendar.js';
import { SubscriptionManager } from './subscription-manager.js';
import { WeatherService } from './weather.js';
import { CelebrationService } from './celebrations.js';
import { TeamsAlerts } from './teams-alerts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
// The version in package.json, shown by /healthz and on the dashboard so you can tell which release is running.
const VERSION = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || 'unknown'); } catch { return 'unknown'; } })();
const PING_SECONDS = 25;   // how often the live connection to each tablet gets a "ping" event (tablets reconnect when they stop)

function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'self'");
  res.setHeader('cache-control', 'no-store');
}

function sendJson(res, status, value, head = false) {
  securityHeaders(res);
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(head ? undefined : body);
}

function sendText(res, status, value, type = 'text/plain; charset=utf-8') {
  securityHeaders(res);
  res.writeHead(status, { 'content-type': type });
  res.end(value);
}

async function readJson(req, maxBytes = 32768) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > maxBytes) throw Object.assign(new Error('Request body too large.'), { status: 413 });
  }
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

function safeEqual(value, expected) {
  const a = Buffer.from(value || '');
  const b = Buffer.from(expected || '');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function roomWindow() {
  const now = Date.now();
  return { start: new Date(now - 60 * 60 * 1000).toISOString(), end: new Date(now + 18 * 60 * 60 * 1000).toISOString() };
}

function eventSummary(events, now = Date.now()) {
  const current = events.find(e => new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now) || null;
  const next = events.find(e => new Date(e.start).getTime() > now) || null;
  return { available: !current, current, next };
}

function validateBooking(body) {
  const subject = String(body.subject || 'Reserved').trim().slice(0, 100) || 'Reserved';
  const start = new Date(body.start);
  const end = new Date(body.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw Object.assign(new Error('Valid start and end values are required.'), { status: 400 });
  const duration = end.getTime() - start.getTime();
  if (start.getTime() < Date.now() - 60000 || start.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw Object.assign(new Error('Booking must begin within the next 24 hours.'), { status: 400 });
  if (duration < 15 * 60000 || duration > 120 * 60000) throw Object.assign(new Error('Booking duration must be between 15 and 120 minutes.'), { status: 400 });
  return { subject, start: start.toISOString(), end: end.toISOString(), organizer: String(body.organizer || '').trim().slice(0, 100) };
}

function serveStatic(req, res, file) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  const full = path.resolve(PUBLIC, file);
  if (!full.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  securityHeaders(res);
  const stat = fs.statSync(full);
  res.writeHead(200, { 'content-type': types[path.extname(full)] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': path.extname(full) === '.html' ? 'no-store' : (['.js', '.css', '.json'].includes(path.extname(full)) ? 'no-cache' : 'public, max-age=300') });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(full).pipe(res);
  return true;
}

export function createAppServer(options = {}) {
  const config = options.config || loadConfig(options.env || process.env, options.cwd || ROOT);
  const logger = options.logger || console;
  const calendars = new Map();
  const tokenProvider = config.demoMode ? null : new GraphTokenProvider(config, options.fetchImpl || fetch);
  config.rooms.forEach((room, index) => calendars.set(room.id, config.demoMode ? new DemoCalendar(room, index) : new GraphCalendar(config, room, tokenProvider, options.fetchImpl || fetch)));

  const weather = options.weather || new WeatherService(config, options.fetchImpl || fetch);
  const teams = options.teamsAlerts || new TeamsAlerts(config.teamsAlerts, options.fetchImpl || fetch);
  const celebrations = options.celebrations || new CelebrationService(config, tokenProvider, options.fetchImpl || fetch);
  const sseClients = new Set();
  const tablets = new Map();
  const controls = new Map(config.rooms.map(room => [room.id, { displayEnabled: true, message: '', messageExpiresAt: null, revision: 0 }]));
  const roomById = new Map(config.rooms.map(room => [room.id, room]));

  function notifyRoom(roomId, type, detail = {}) {
    const data = JSON.stringify({ roomId, detail, at: new Date().toISOString() });
    for (const client of sseClients) if (client.roomId === roomId || client.roomId === '*') client.res.write(`event: ${type}\ndata: ${data}\n\n`);
  }

  // Latest events per room. One fetch serves every tablet for a few seconds, and any difference from the
  // previous fetch is pushed to the tablets straight away (this is what makes updates feel instant).
  const latest = new Map();
  const calendarProblems = new Map();       // roomId -> { since, error } while the room calendar cannot be read
  async function refreshRoom(roomId) {
    const window = roomWindow();
    const events = await calendars.get(roomId).listEvents(window.start, window.end);
    calendarProblems.delete(roomId);
    const key = JSON.stringify(events.map(e => [e.id, e.subject, e.start, e.end, e.organizer, e.isPrivate]));
    const previous = latest.get(roomId);
    latest.set(roomId, { at: Date.now(), events, key });
    if (previous && previous.key !== key) notifyRoom(roomId, 'calendar.changed', { reason: 'change-detected' });
    return events;
  }
  async function cachedEvents(roomId, maxAgeMs = 8000) {
    const hit = latest.get(roomId);
    return hit && Date.now() - hit.at < maxAgeMs ? hit.events : refreshRoom(roomId);
  }
  // ---- Tablet offline alerts ----
  // A tablet that stops checking in during office hours raises one alert (and one "back online" when it returns).
  // Alerts always show on the dashboard; if ALERT_WEBHOOK_URL is set they are also posted there as {"text": "..."}.
  const alerts = [];
  const alertState = new Map();            // key -> alerted?
  const startedAt = Date.now();
  // Delivers one alert to every channel that is set up and reports what happened to each.
  // It never throws: a broken channel must not stop the others or the server.
  async function deliver(text, { title = 'Room Display alert' } = {}) {
    const outcome = { webhook: { configured: Boolean(config.alertWebhookUrl) }, teams: { configured: teams.enabled, results: [] } };
    if (config.alertWebhookUrl) {
      try {
        const response = await (options.fetchImpl || fetch)(config.alertWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) });
        outcome.webhook.ok = response.ok;
        if (!response.ok) { outcome.webhook.error = `The webhook answered ${response.status}.`; logger.error?.(`Alert webhook answered ${response.status}`); }
      } catch (error) { outcome.webhook.ok = false; outcome.webhook.error = error.message; logger.error?.(`Alert webhook failed: ${error.message}`); }
    }
    if (teams.enabled) {
      try { outcome.teams.results = await teams.send(text, { title }); }
      catch (error) { outcome.teams.results = [{ recipient: '(all)', ok: false, error: error.message }]; }
      for (const result of outcome.teams.results) if (!result.ok) logger.error?.(`Teams alert to ${result.recipient} failed (${result.step || 'sending'}): ${result.error}`);
    }
    return outcome;
  }
  async function sendAlert(text) {
    alerts.unshift({ at: new Date().toISOString(), text });
    alerts.length = Math.min(alerts.length, 20);
    logger.warn?.(`ALERT: ${text}`);
    await deliver(text);
  }
  function localClock(timeZone, ms) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const part = type => parts.find(p => p.type === type).value;
    return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday')), minutes: Number(part('hour')) * 60 + Number(part('minute')) };
  }
  // True once the office has been open for at least the alert delay (so nothing fires the moment the doors open).
  function officeSettled(room, ms) {
    const hours = config.officeHours;
    if (hours) {
      const clock = localClock(room.timeZone, ms);
      if (!hours.days.includes(clock.day) || clock.minutes < hours.startMinutes + config.alertAfterMinutes || clock.minutes >= hours.endMinutes) return false;
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: room.timeZone }).format(new Date(ms));
    return !celebrations.holidayOn?.(today);
  }
  function clockText(room, ms) { return new Intl.DateTimeFormat('en-US', { timeZone: room.timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); }
  async function checkTablets(ms = Date.now()) {
    const delay = config.alertAfterMinutes * 60000;
    for (const [key, tablet] of [...tablets]) {          // forget tablets that have been gone for a week
      if (ms - Date.parse(tablet.lastSeen) > 7 * 86400000) { tablets.delete(key); alertState.delete(key); }
    }
    for (const room of config.rooms) {
      if (!officeSettled(room, ms)) continue;
      const roomTablets = [...tablets.values()].filter(t => t.roomId === room.id);
      for (const tablet of roomTablets) {
        const key = `${room.id}:${tablet.tabletId}`;
        const quietFor = ms - Date.parse(tablet.lastSeen);
        if (quietFor >= delay && !alertState.get(key)) {
          alertState.set(key, true);
          await sendAlert(`${room.name}: the tablet "${tablet.name}" has not checked in since ${clockText(room, Date.parse(tablet.lastSeen))} (${Math.round(quietFor / 60000)} minutes). It may be off, asleep or disconnected.`);
        } else if (quietFor < config.tabletOfflineSeconds * 1000 && alertState.get(key)) {
          alertState.delete(key);
          await sendAlert(`${room.name}: the tablet "${tablet.name}" is back online.`);
        }
      }
      const calendarKey = `${room.id}:calendar`;
      const problem = calendarProblems.get(room.id);
      if (problem && ms - problem.since >= delay && !alertState.get(calendarKey)) {
        alertState.set(calendarKey, true);
        await sendAlert(`${room.name}: the room calendar cannot be read (${problem.error}). The display may be showing old meetings. Check the Microsoft 365 app secret and permissions.`);
      } else if (!problem && alertState.get(calendarKey)) {
        alertState.delete(calendarKey);
        await sendAlert(`${room.name}: the room calendar can be read again.`);
      }
      const noneKey = `${room.id}:none`;
      if (!roomTablets.length && ms - startedAt >= delay && !alertState.get(noneKey)) {
        alertState.set(noneKey, true);
        await sendAlert(`${room.name}: no tablet has checked in since the server started ${Math.round((ms - startedAt) / 60000)} minutes ago.`);
      } else if (roomTablets.length && alertState.get(noneKey)) {
        alertState.delete(noneKey);
        await sendAlert(`${room.name}: a tablet has checked in again.`);
      }
    }
  }
  // Reminds people before the Microsoft 365 client secret expires (CLIENT_SECRET_EXPIRES). One alert each time the
  // remaining time drops to 30, 14, 7, 3 or 1 days, and one when it has expired. Sent during office hours only.
  // After a restart the current stage is announced once more; that is deliberate, a reminder is better than silence.
  function secretStatus(ms = Date.now()) {
    if (!config.clientSecretExpires) return null;
    const zone = config.rooms[0]?.timeZone || 'UTC';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(ms));
    const daysLeft = Math.round((Date.parse(`${config.clientSecretExpires}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    const stage = daysLeft < 0 ? 'expired' : [1, 3, 7, 14, 30].find(limit => daysLeft <= limit) || null;
    return { expires: config.clientSecretExpires, daysLeft, stage };
  }
  async function checkSecretExpiry(ms = Date.now()) {
    const status = secretStatus(ms);
    if (!status || !status.stage || alertState.get('secret') === status.stage) return;
    if (config.rooms[0] && !officeSettled(config.rooms[0], ms)) return;
    alertState.set('secret', status.stage);
    const when = status.daysLeft < 0 ? `expired on ${status.expires}` : status.daysLeft === 0 ? `expires today (${status.expires})` : `expires in ${status.daysLeft} ${status.daysLeft === 1 ? 'day' : 'days'} (${status.expires})`;
    await sendAlert(`The Microsoft 365 app secret ${when}. ${status.daysLeft < 0 ? 'Room calendars stop updating until it is replaced.' : 'Room calendars stop updating when it expires.'} Create a new client secret in Microsoft Entra (App registrations > Certificates & secrets), put it in CLIENT_SECRET${config.teamsAlerts?.enabled ? ' (and TEAMS_BOT_APP_SECRET if the bot uses the same app)' : ''}, set CLIENT_SECRET_EXPIRES to its new date and restart the service.`);
  }
  // Official weather warnings for the location (empty when off, outside the US, or unreachable). Never throws.
  async function currentWeatherAlerts() {
    try { return (await weather.alerts?.()) || []; } catch { return []; }
  }
  // A Severe or Extreme warning (Winter Storm Warning, Flood Warning, Tornado Warning, ...) is sent to the alert
  // list once, when it first appears, so someone can decide about the office before people set off. Moderate ones
  // (watches, advisories) only show on the tablets. After a restart a warning that is still active is sent once more.
  async function checkWeatherAlerts() {
    const list = await currentWeatherAlerts();
    const zone = config.rooms[0]?.timeZone || 'UTC';
    const when = iso => new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    const live = new Set(list.map(a => `weather:${a.id}`));
    for (const key of [...alertState.keys()]) if (key.startsWith('weather:') && !live.has(key)) alertState.delete(key);   // ended: forget it
    for (const alert of list) {
      const key = `weather:${alert.id}`;
      if (!alert.notify || alertState.get(key)) continue;
      alertState.set(key, true);
      await sendAlert(`Weather: ${alert.event}${alert.ends ? ` until ${when(alert.ends)}` : ''}. ${alert.headline && !alert.headline.startsWith(alert.event) ? `${alert.headline}. ` : ''}The room displays are showing this warning. Check weather.gov or your local news before deciding about the office.`);
    }
  }
  let monitor = null;

  let watcher = null;
  let lastWatchError = 0;
  function startWatcher() {
    if (!config.changeCheckSeconds || watcher) return;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      for (const room of config.rooms) {
        try { await refreshRoom(room.id); }
        catch (error) { if (!calendarProblems.has(room.id)) calendarProblems.set(room.id, { since: Date.now(), error: String(error.message || error).slice(0, 140) }); if (Date.now() - lastWatchError > 60000) { lastWatchError = Date.now(); logger.error?.(`Calendar change check failed for ${room.id}: ${error.message}`); } }
      }
      busy = false;
    };
    watcher = setInterval(tick, config.changeCheckSeconds * 1000);
    watcher.unref?.();
    setTimeout(tick, 1000).unref?.();
  }

  const subscriptions = options.subscriptions || new SubscriptionManager({ onChange: value => notifyRoom(value.roomId || '*', 'graph.changed', value) });

  function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
  function recordTablet(req, body, forcedRoomId) {
    const roomId = forcedRoomId || String(body.roomId || '');
    if (!roomById.has(roomId)) throw Object.assign(new Error('Unknown room.'), { status: 404 });
    const tabletId = String(body.tabletId || '').trim().slice(0, 100);
    if (!tabletId) throw Object.assign(new Error('tabletId is required.'), { status: 400 });
    const key = `${roomId}:${tabletId}`;
    const previous = tablets.get(key);
    const tablet = { tabletId, roomId, name: String(body.name || previous?.name || 'Room tablet').trim().slice(0, 100), lastSeen: new Date().toISOString(), connectedAt: previous?.connectedAt || new Date().toISOString(), ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300), screen: /^[0-9x@. ]{1,30}$/.test(String(body.screen || '')) ? String(body.screen) : (previous?.screen || '') };
    tablets.set(key, tablet);
    return tablet;
  }

  function isAdmin(req) {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return safeEqual(bearer, config.adminToken);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const isHead = req.method === 'HEAD';
    try {
      if ((req.method === 'GET' || isHead) && url.pathname === '/healthz') return sendJson(res, 200, { status: 'ok', version: VERSION, mode: config.demoMode ? 'demo' : 'm365', rooms: config.rooms.length, uptimeSeconds: Math.round(process.uptime()) }, isHead);
      if (req.method === 'GET' && url.pathname === '/api/celebrations') {
        const room = roomById.get(url.searchParams.get('room') || '');
        const today = await celebrations.get();
        // Birthdays can be hidden per room; a company holiday always applies.
        return sendJson(res, 200, room && !room.showCelebrations ? { ...today, celebrations: [] } : today);
      }
      if (req.method === 'GET' && url.pathname === '/api/weather') return sendJson(res, 200, { weather: await weather.get(), alerts: await currentWeatherAlerts() });
      if (req.method === 'GET' && url.pathname === '/api/rooms') return sendJson(res, 200, { rooms: config.rooms.map(publicRoom), refreshSeconds: config.eventRefreshSeconds });
      if (req.method === 'GET' && url.pathname === '/api/config') {
        const room = roomById.get(url.searchParams.get('room') || config.rooms[0].id);
        if (!room) return sendJson(res, 404, { error: 'Unknown room.' });
        return sendJson(res, 200, { ...publicRoom(room), demoMode: config.demoMode, refreshSeconds: config.eventRefreshSeconds, officeHours: config.officeHours, control: controls.get(room.id) });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const roomId = url.searchParams.get('room') || config.rooms[0].id;
        const calendar = calendars.get(roomId);
        if (!calendar) return sendJson(res, 404, { error: 'Unknown room.' });
        const defaults = roomWindow();
        const start = url.searchParams.get('start') || defaults.start;
        const end = url.searchParams.get('end') || defaults.end;
        if (!Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime())) return sendJson(res, 400, { error: 'Invalid date range.' });
        const events = (!url.searchParams.get('start') && !url.searchParams.get('end')) ? await cachedEvents(roomId) : await calendar.listEvents(start, end);
        return sendJson(res, 200, { roomId, events, generatedAt: new Date().toISOString() });
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        const roomId = url.searchParams.get('room') || '';
        if (roomId !== '*' && !roomById.has(roomId)) return sendJson(res, 404, { error: 'Unknown room.' });
        const tabletId = url.searchParams.get('tabletId');
        if (tabletId && roomId !== '*') recordTablet(req, { tabletId, name: url.searchParams.get('name') || 'Room tablet' }, roomId);
        securityHeaders(res);
        res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
        const client = { res, roomId, tabletId, connectedAt: Date.now() };
        sseClients.add(client);
        res.write(`event: connected\ndata: ${JSON.stringify({ roomId, at: new Date().toISOString() })}\n\n`);
        // A named event (not a comment) so the tablet can see the connection is alive and notice when it is not.
        const keepAlive = setInterval(() => res.write('event: ping\ndata: {}\n\n'), (options.pingSeconds ?? PING_SECONDS) * 1000);
        keepAlive.unref?.();
        req.on('close', () => { clearInterval(keepAlive); sseClients.delete(client); });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/tablets/heartbeat') return sendJson(res, 200, { ok: true, tablet: recordTablet(req, await readJson(req)), serverTime: new Date().toISOString() });
      if (req.method === 'POST' && url.pathname === '/api/bookings') {
        const body = await readJson(req);
        const room = roomById.get(String(body.roomId || ''));
        if (!room) return sendJson(res, 404, { error: 'Unknown room.' });
        if (!room.allowQuickBooking) return sendJson(res, 403, { error: 'Quick booking is disabled for this room.' });
        const booking = validateBooking(body);
        // Company holidays are closed days: refuse bookings that start or end on one. If the holiday calendar
        // cannot be read, bookings are allowed (the check never blocks on an outage).
        try { await celebrations.get(); } catch { /* holiday lookup is best effort */ }
        const dayOf = value => new Intl.DateTimeFormat('en-CA', { timeZone: room.timeZone }).format(new Date(value));
        const closedFor = celebrations.holidayOn?.(dayOf(booking.start)) || celebrations.holidayOn?.(dayOf(new Date(booking.end).getTime() - 1));
        if (closedFor) return sendJson(res, 409, { error: `The office is closed for ${closedFor}, so this room cannot be booked.` });
        const calendar = calendars.get(room.id);
        const overlapping = (await calendar.listEvents(booking.start, booking.end)).some(event => new Date(event.end) > new Date(booking.start) && new Date(event.start) < new Date(booking.end));
        if (overlapping) return sendJson(res, 409, { error: 'That time overlaps an existing meeting.' });
        const event = await calendar.createEvent(booking);
        notifyRoom(room.id, 'calendar.changed', { reason: 'booking.created' });
        return sendJson(res, 201, { event });
      }
      if (url.pathname === '/api/notifications' && url.searchParams.has('validationToken')) return sendText(res, 200, url.searchParams.get('validationToken'));
      if (req.method === 'POST' && url.pathname === '/api/notifications') { subscriptions.processNotifications(((await readJson(req, 256000)).value || []).filter(value => !config.graphClientState || value.clientState === config.graphClientState)); return sendText(res, 202, 'Accepted'); }
      if (url.pathname.startsWith('/api/admin/')) {
        if (!config.adminToken) return sendJson(res, 503, { error: 'Dashboard controls are disabled until ADMIN_TOKEN is configured.' });
        if (!isAdmin(req)) return sendJson(res, 401, { error: 'A valid dashboard token is required.' });
        if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
          const cutoff = Date.now() - config.tabletOfflineSeconds * 1000;
          const window = roomWindow();
          const rooms = await Promise.all(config.rooms.map(async room => {
            let events = [], error = null;
            try { events = await calendars.get(room.id).listEvents(window.start, window.end); } catch (e) { error = e.message; }
            const roomTablets = [...tablets.values()].filter(t => t.roomId === room.id).map(t => ({ ...t, online: new Date(t.lastSeen).getTime() >= cutoff }));
            return { ...publicRoom(room), ...eventSummary(events), events, tablets: roomTablets, onlineTablets: roomTablets.filter(t => t.online).length, control: controls.get(room.id), error };
          }));
          return sendJson(res, 200, { version: VERSION, rooms, alerts, alertChannels: { webhook: Boolean(config.alertWebhookUrl), teamsRecipients: teams.recipients.length }, weather: await weather.get().catch(() => null), generatedAt: new Date().toISOString(), mode: config.demoMode ? 'demo' : 'm365' });
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/test-alert') {
          const text = 'This is a test alert from the Room Display dashboard. If you can read this, alerts reach you.';
          alerts.unshift({ at: new Date().toISOString(), text: `Test alert sent from the dashboard.` });
          alerts.length = Math.min(alerts.length, 20);
          return sendJson(res, 200, await deliver(text, { title: 'Room Display test alert' }));
        }
        const match = url.pathname.match(/^\/api\/admin\/rooms\/([a-z0-9-]+)\/control$/);
        if (req.method === 'POST' && match) {
          const roomId = match[1];
          if (!roomById.has(roomId)) return sendJson(res, 404, { error: 'Unknown room.' });
          const body = await readJson(req);
          const action = String(body.action || '');
          const state = controls.get(roomId);
          if (action === 'message') { state.message = String(body.message || '').trim().slice(0, 280); const ttl = Math.min(1440, Math.max(1, Number(body.ttlMinutes) || 30)); state.messageExpiresAt = state.message ? new Date(Date.now() + ttl * 60000).toISOString() : null; }
          else if (action === 'clearMessage') { state.message = ''; state.messageExpiresAt = null; }
          else if (action === 'displayOn') state.displayEnabled = true;
          else if (action === 'displayOff') state.displayEnabled = false;
          else if (action !== 'refresh') return sendJson(res, 400, { error: 'Unsupported control action.' });
          state.revision += 1;
          notifyRoom(roomId, 'room.control', { action, control: state });
          return sendJson(res, 200, { ok: true, roomId, control: state });
        }
      }
      if ((req.method === 'GET' || isHead) && (url.pathname === '/' || url.pathname === '/index.html' || /^\/room\/[a-z0-9-]+\/?$/.test(url.pathname))) return void serveStatic(req, res, 'index.html');
      if ((req.method === 'GET' || isHead) && (url.pathname === '/dashboard' || url.pathname === '/dashboard/')) return void serveStatic(req, res, 'dashboard.html');
      if (req.method === 'GET' || isHead) { const file = url.pathname.replace(/^\//, ''); if (serveStatic(req, res, file)) return; }
      return sendJson(res, 404, { error: 'Not found.' }, isHead);
    } catch (error) {
      logger.error?.(error);
      if (!res.headersSent) return sendJson(res, error.status || 502, { error: error.status ? error.message : 'The room calendar is temporarily unavailable.' });
      res.end();
    }
  });

  server.on('close', () => { subscriptions.stop(); if (watcher) clearInterval(watcher); if (monitor) clearInterval(monitor); });
  server.appState = { config, calendars, tablets, controls, subscriptions, notifyRoom, refreshRoom, checkTablets, checkSecretExpiry, secretStatus, checkWeatherAlerts, alerts, teams, calendarProblems };
  if (options.startSubscriptions !== false) startWatcher();
  if (options.startSubscriptions !== false) {
    monitor = setInterval(() => {
      checkTablets().catch(error => logger.error?.(`Tablet check failed: ${error.message}`));
      checkSecretExpiry().catch(error => logger.error?.(`Secret expiry check failed: ${error.message}`));
    checkWeatherAlerts().catch(error => logger.error?.(`Weather alert check failed: ${error.message}`));
    }, 60000); monitor.unref?.();
  }
  if (options.startSubscriptions !== false) subscriptions.start().catch(error => logger.error('Subscriptions did not start:', error.message));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotEnv();
  const server = createAppServer();
  server.listen(server.appState.config.port, '0.0.0.0', () => console.log(`M365 room display listening on http://0.0.0.0:${server.appState.config.port} for ${server.appState.config.rooms.length} room(s)`));
  const shutdown = signal => {
    console.log(`${signal} received; shutting down.`);
    const timer = setTimeout(() => process.exit(1), 10000); timer.unref();
    server.close(error => process.exit(error ? 1 : 0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
