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
import { DashboardSignIn, SignInError, signInProblemPage } from './dashboard-signin.js';

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

// What the tablet is told when Microsoft fails. Microsoft's own wording ("Bad Gateway", "UnknownError") means nothing
// to someone at the door, so each kind of failure gets a plain sentence, plus a "reason" the tablet can act on.
// The Teams / dashboard alert for a room calendar that cannot be read, by kind of failure.
export function calendarProblemText(problem) {
  if (problem.kind === 'microsoft-down') return `Microsoft 365 is not responding (${problem.error}), so the room calendar cannot be read. This is on Microsoft's side and nothing needs changing here: the display keeps showing the last meetings it had, and booking from the tablet fails until Microsoft recovers. Microsoft's status page: https://status.cloud.microsoft (or Health > Service health in the Microsoft 365 admin center).`;
  if (problem.kind === 'permission') return `the room calendar cannot be read (${problem.error}). The display may be showing old meetings. Check the Microsoft 365 app secret (CLIENT_SECRET, and whether it has expired) and the app's permissions.`;
  if (problem.kind === 'not-found') return `the room's mailbox was not found (${problem.error}). Check the room's email address in config/rooms.json.`;
  return `the room calendar cannot be read (${problem.error}). The display may be showing old meetings.`;
}

export function failureAnswer(error, pathname = '') {
  const booking = pathname === '/api/bookings';
  if (error.kind === 'microsoft-down') return { status: 503, body: { reason: 'microsoft-down', error: booking
    ? 'Microsoft 365 is not responding right now, so the room could not be booked. Please try again in a few minutes, or book it in Outlook.'
    : 'Microsoft 365 is not responding right now. The display is showing the last meetings it had.' } };
  if (error.kind === 'permission') return { status: 502, body: { reason: 'permission', error: booking
    ? 'The room display is not allowed to book this room in Microsoft 365. Please tell IT.'
    : 'The room display is not allowed to read this room\'s calendar in Microsoft 365. Please tell IT.' } };
  if (error.kind === 'not-found') return { status: 502, body: { reason: 'not-found', error: 'This room\'s mailbox was not found in Microsoft 365. Please tell IT.' } };
  return { status: error.status || 502, body: { error: error.status ? error.message : 'The room calendar is temporarily unavailable.' } };
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
  const signIn = options.dashboardSignIn || new DashboardSignIn(config.dashboardSignIn, options.fetchImpl || fetch);
  const sseClients = new Set();
  const tablets = new Map();
  const controls = new Map(config.rooms.map(room => [room.id, { displayEnabled: true, message: '', messageExpiresAt: null, outfit: null, outfitLabel: '', outfitUntil: null, outfitSchedule: [], revision: 0 }]));
  // Outfit pushes and scheduled outfits are saved in <dataDir>/outfit-overrides.json, so a restart or a deploy keeps them.
  // (Messages and display on/off are not saved: they are meant to be short-lived.) No dataDir, nothing is saved (tests).
  const MAX_SCHEDULED = 30;
  const outfitFile = options.dataDir ? path.join(options.dataDir, 'outfit-overrides.json') : null;
  function saveOutfits() {
    if (!outfitFile) return;
    const rooms = {};
    for (const [id, s] of controls) rooms[id] = { push: s.outfit ? { outfit: s.outfit, label: s.outfitLabel, until: s.outfitUntil } : null, schedule: s.outfitSchedule };
    try {
      fs.mkdirSync(path.dirname(outfitFile), { recursive: true });
      fs.writeFileSync(`${outfitFile}.tmp`, JSON.stringify({ savedAt: new Date().toISOString(), rooms }, null, 1));
      fs.renameSync(`${outfitFile}.tmp`, outfitFile);                    // all or nothing, never a half-written file
    } catch (error) { logger.error?.(`Could not save the outfit overrides: ${error.message}`); }
  }
  (function loadOutfits() {
    if (!outfitFile || !fs.existsSync(outfitFile)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(outfitFile, 'utf8')).rooms || {};
      const now = Date.now();
      for (const [id, s] of controls) {
        const r = saved[id];
        if (!r) continue;
        if (r.push && typeof r.push.outfit === 'string' && Date.parse(r.push.until) > now) Object.assign(s, { outfit: r.push.outfit, outfitLabel: String(r.push.label || ''), outfitUntil: new Date(r.push.until).toISOString() });
        s.outfitSchedule = (Array.isArray(r.schedule) ? r.schedule : [])
          .filter(e => e && typeof e.outfit === 'string' && Date.parse(e.start) < Date.parse(e.end) && Date.parse(e.end) > now)
          .slice(0, MAX_SCHEDULED)
          .map(e => ({ id: String(e.id || crypto.randomBytes(6).toString('hex')), outfit: e.outfit, label: String(e.label || ''), start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString() }));
      }
    } catch (error) { logger.error?.(`Could not read the saved outfit overrides (starting without them): ${error.message}`); }
  })();
  // The control state as tablets and the dashboard should see it: an outfit override that has run out is dropped.
  function liveControl(roomId, ms = Date.now()) {
    const state = controls.get(roomId);
    if (state.outfit && (!state.outfitUntil || Date.parse(state.outfitUntil) <= ms)) { state.outfit = null; state.outfitLabel = ''; state.outfitUntil = null; }
    return state;
  }
  // What tablets and the dashboard see: the control state with the outfit that applies right now. A push from the
  // dashboard wins; otherwise a scheduled outfit whose time has come (the latest-starting one if several overlap).
  // ms is the moment to look at (tests and the start/end check look ahead); only the real clock removes anything.
  function effectiveControl(roomId, ms = Date.now()) {
    const state = liveControl(roomId);
    const kept = state.outfitSchedule.filter(e => Date.parse(e.end) > Date.now());
    if (kept.length !== state.outfitSchedule.length) { state.outfitSchedule = kept; saveOutfits(); }
    const pushed = Boolean(state.outfit) && Date.parse(state.outfitUntil) > ms;
    const view = { ...state, outfitSchedule: state.outfitSchedule.map(e => ({ ...e })), outfitSource: pushed ? 'push' : null, outfitScheduleId: null };
    if (!pushed) {
      Object.assign(view, { outfit: null, outfitLabel: '', outfitUntil: null });
      const current = state.outfitSchedule.filter(e => Date.parse(e.start) <= ms && Date.parse(e.end) > ms).sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
      if (current) Object.assign(view, { outfit: current.outfit, outfitLabel: current.label, outfitUntil: current.end, outfitSource: 'schedule', outfitScheduleId: current.id });
    }
    return view;
  }
  // Tablets learn about a scheduled outfit starting or ending from this check (every 15 seconds).
  const lastOutfitKey = new Map();
  const outfitKey = c => `${c.outfit || ''}|${c.outfitUntil || ''}`;
  function checkOutfitSchedules(ms = Date.now()) {
    for (const room of config.rooms) {
      const control = effectiveControl(room.id, ms);
      if (lastOutfitKey.has(room.id) && lastOutfitKey.get(room.id) !== outfitKey(control)) notifyRoom(room.id, 'room.control', { action: 'outfitSchedule', control });
      lastOutfitKey.set(room.id, outfitKey(control));
    }
  }
  // An outfit choice from the dashboard: an outfit id from outfits.json whose art is here, or "none" for plain Snoopy.
  function outfitChoice(id) { return String(id || '') === 'none' ? { id: 'none', label: 'No outfit' } : pushableOutfits().find(o => o.id === String(id || '')); }
  // Outfits that can be pushed from the dashboard: those in public/snoopy/outfits.json whose art is on the server.
  function pushableOutfits() {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'snoopy', 'outfits.json'), 'utf8')).outfits || []; } catch { return []; }
    const seen = new Set();
    return list.filter(o => o && typeof o.id === 'string' && typeof o.file === 'string' && !seen.has(o.id) && seen.add(o.id))
      .filter(o => { const file = path.resolve(PUBLIC, 'snoopy', o.file); return file.startsWith(path.join(PUBLIC, 'snoopy') + path.sep) && fs.existsSync(file); })
      .map(o => ({ id: o.id, label: String(o.label || o.id) }));
  }
  // Midnight at the end of today (or of a later day), in the room's time zone, as a UTC instant.
  function endOfDay(timeZone, ms, extraDays = 0) {
    const wall = t => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t)).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); };
    const today = new Date(wall(ms));
    const target = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1 + extraDays);   // wall-clock midnight wanted
    let t = target - (wall(target) - target);                                // first guess using the offset at that moment
    t += target - wall(t);                                                   // correct once more (daylight saving)
    return t;
  }
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
      const roomTablets = [...tablets.values()].filter(t => t.roomId === room.id && t.wallTablet !== false);   // desktop test browsers never alert
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
        await sendAlert(`${room.name}: ${calendarProblemText(problem)}`);
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
        catch (error) { if (!calendarProblems.has(room.id)) calendarProblems.set(room.id, { since: Date.now(), error: String(error.message || error).slice(0, 140), kind: error.kind || 'other' }); if (Date.now() - lastWatchError > 60000) { lastWatchError = Date.now(); logger.error?.(`Calendar change check failed for ${room.id}: ${error.message}`); } }
      }
      busy = false;
    };
    watcher = setInterval(tick, config.changeCheckSeconds * 1000);
    watcher.unref?.();
    setTimeout(tick, 1000).unref?.();
  }

  const subscriptions = options.subscriptions || new SubscriptionManager({ onChange: value => notifyRoom(value.roomId || '*', 'graph.changed', value) });

  function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
  // Wall tablets get offline alerts; a desktop browser someone opened to test or look at a room does not.
  // A wall tablet is a phone/tablet browser, a touch screen (iPads in Safari say "Macintosh"), or any page opened with ?kiosk=1.
  function isWallTablet(userAgent, body) {
    const flag = value => value === true || value === '1' || value === 'true';
    return flag(body.kiosk) || flag(body.touch) || /Android|iPad|iPhone|Mobile|Silk|Kindle/i.test(userAgent);
  }
  function recordTablet(req, body, forcedRoomId) {
    const roomId = forcedRoomId || String(body.roomId || '');
    if (!roomById.has(roomId)) throw Object.assign(new Error('Unknown room.'), { status: 404 });
    const tabletId = String(body.tabletId || '').trim().slice(0, 100);
    if (!tabletId) throw Object.assign(new Error('tabletId is required.'), { status: 400 });
    const key = `${roomId}:${tabletId}`;
    const previous = tablets.get(key);
    const tablet = { tabletId, roomId, name: String(body.name || previous?.name || 'Room tablet').trim().slice(0, 100), lastSeen: new Date().toISOString(), connectedAt: previous?.connectedAt || new Date().toISOString(), ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300), screen: /^[0-9x@. ]{1,30}$/.test(String(body.screen || '')) ? String(body.screen) : (previous?.screen || '') };
    tablet.wallTablet = isWallTablet(tablet.userAgent, body);
    tablets.set(key, tablet);
    return tablet;
  }

  // Who is calling the admin API: the administrator token (the backup, also used by the tablet's message panel)
  // or a Microsoft sign-in session cookie. null if neither.
  function adminFrom(req) {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (config.adminToken && safeEqual(bearer, config.adminToken)) return { via: 'token' };
    const session = signIn.sessionFor(req.headers.cookie);
    return session ? { via: 'session', session } : null;
  }
  function isAdmin(req) { return Boolean(adminFrom(req)); }
  // A browser sends the session cookie by itself, so a change made with it must come from the dashboard's own page:
  // JSON (a form on another site cannot send that without permission) and, when the browser says, the same origin.
  function sameOriginJson(req) { return /^application\/json\b/i.test(String(req.headers['content-type'] || '')) && sameOriginPost(req); }
  function sameOriginPost(req) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return false;
    const origin = req.headers.origin;
    if (origin) { try { return new URL(origin).host === req.headers.host; } catch { return false; } }
    return true;
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
        return sendJson(res, 200, { ...publicRoom(room), demoMode: config.demoMode, refreshSeconds: config.eventRefreshSeconds, officeHours: config.officeHours, control: effectiveControl(room.id) });
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
        if (tabletId && roomId !== '*') recordTablet(req, { tabletId, name: url.searchParams.get('name') || 'Room tablet', kiosk: url.searchParams.get('kiosk'), touch: url.searchParams.get('touch') }, roomId);
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
      // Microsoft sign-in for the dashboard (off unless DASHBOARD_SIGNIN_* is set; the administrator token always works too).
      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        const who = adminFrom(req);
        return sendJson(res, 200, { signInEnabled: signIn.enabled, tokenEnabled: Boolean(config.adminToken), signedIn: who?.via === 'session', name: who?.session?.name || '', email: who?.session?.email || '', expiresAt: who?.session ? new Date(who.session.expires).toISOString() : null });
      }
      if (req.method === 'GET' && url.pathname === '/auth/login') {
        if (!signIn.enabled) return sendJson(res, 404, { error: 'Microsoft sign-in is not set up on this server.' });
        const { location, setCookie } = signIn.start();
        securityHeaders(res);
        res.writeHead(302, { location, 'set-cookie': setCookie });
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        try {
          const { session, setCookies } = await signIn.finish(url.searchParams, req.headers.cookie);
          logger.log?.(`Dashboard sign-in: ${session.email}`);
          securityHeaders(res);
          res.writeHead(302, { location: '/dashboard', 'set-cookie': setCookies });
          return res.end();
        } catch (error) {
          if (!(error instanceof SignInError)) throw error;
          logger.warn?.(`Dashboard sign-in refused: ${error.message}`);
          return sendText(res, error.status, signInProblemPage(error.message), 'text/html; charset=utf-8');
        }
      }
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        if (!sameOriginPost(req)) return sendJson(res, 403, { error: 'Sign out from the dashboard page.' });
        securityHeaders(res);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': signIn.logout(req.headers.cookie) });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (url.pathname.startsWith('/api/admin/')) {
        if (!config.adminToken && !signIn.enabled) return sendJson(res, 503, { error: 'Dashboard controls are disabled until ADMIN_TOKEN (or Microsoft sign-in) is configured.' });
        const who = adminFrom(req);
        if (!who) return sendJson(res, 401, { error: signIn.enabled ? 'Please sign in with Microsoft (or use the administrator token).' : 'A valid dashboard token is required.' });
        if (who.via === 'session' && req.method !== 'GET' && !sameOriginJson(req)) return sendJson(res, 403, { error: 'Changes must come from the dashboard page.' });
        if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
          const cutoff = Date.now() - config.tabletOfflineSeconds * 1000;
          const window = roomWindow();
          const rooms = await Promise.all(config.rooms.map(async room => {
            let events = [], error = null;
            try { events = await calendars.get(room.id).listEvents(window.start, window.end); } catch (e) { error = e.message; }
            const roomTablets = [...tablets.values()].filter(t => t.roomId === room.id).map(t => ({ ...t, online: new Date(t.lastSeen).getTime() >= cutoff }));
            return { ...publicRoom(room), ...eventSummary(events), events, tablets: roomTablets, onlineTablets: roomTablets.filter(t => t.online).length, control: effectiveControl(room.id), error };
          }));
          return sendJson(res, 200, { version: VERSION, rooms, outfits: pushableOutfits(), alerts, alertChannels: { webhook: Boolean(config.alertWebhookUrl), teamsRecipients: teams.recipients.length }, weather: await weather.get().catch(() => null), generatedAt: new Date().toISOString(), mode: config.demoMode ? 'demo' : 'm365' });
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
          const state = liveControl(roomId);
          if (action === 'message') { state.message = String(body.message || '').trim().slice(0, 280); const ttl = Math.min(1440, Math.max(1, Number(body.ttlMinutes) || 30)); state.messageExpiresAt = state.message ? new Date(Date.now() + ttl * 60000).toISOString() : null; }
          else if (action === 'clearMessage') { state.message = ''; state.messageExpiresAt = null; }
          else if (action === 'outfit') {
            // body.outfit: an outfit id from outfits.json, or "none" for plain Snoopy.
            // body.until: "today" (to midnight, room time) or "tomorrow" (to midnight tomorrow); otherwise ttlMinutes (1 minute to 7 days).
            const choice = outfitChoice(body.outfit);
            if (!choice) return sendJson(res, 400, { error: 'Unknown outfit, or its picture is not on the server yet.' });
            const now = Date.now();
            let until;
            if (body.until === 'today') until = endOfDay(roomById.get(roomId).timeZone, now);
            else if (body.until === 'tomorrow') until = endOfDay(roomById.get(roomId).timeZone, now, 1);
            else {
              const minutes = Number(body.ttlMinutes);
              if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) return sendJson(res, 400, { error: 'Pick how long: 1 minute to 7 days, or until the end of today.' });
              until = now + Math.round(minutes) * 60000;
            }
            state.outfit = choice.id; state.outfitLabel = choice.label; state.outfitUntil = new Date(until).toISOString();
          }
          else if (action === 'clearOutfit') { state.outfit = null; state.outfitLabel = ''; state.outfitUntil = null; }
          else if (action === 'scheduleOutfit') {
            // body.outfit as for "outfit"; body.start and body.end are dates (ISO), up to a year ahead and 14 days long.
            const choice = outfitChoice(body.outfit);
            if (!choice) return sendJson(res, 400, { error: 'Unknown outfit, or its picture is not on the server yet.' });
            const start = Date.parse(body.start), end = Date.parse(body.end), now = Date.now();
            if (!Number.isFinite(start) || !Number.isFinite(end)) return sendJson(res, 400, { error: 'Pick when it starts and when it ends.' });
            if (end <= start) return sendJson(res, 400, { error: 'The end must be after the start.' });
            if (end <= now) return sendJson(res, 400, { error: 'That time has already passed.' });
            if (start > now + 366 * 86400000) return sendJson(res, 400, { error: 'An outfit can be scheduled at most a year ahead.' });
            if (end - start > 14 * 86400000) return sendJson(res, 400, { error: 'A scheduled outfit can last at most 14 days.' });
            if (state.outfitSchedule.length >= MAX_SCHEDULED) return sendJson(res, 400, { error: `This room already has ${MAX_SCHEDULED} scheduled outfits. Remove some first.` });
            state.outfitSchedule.push({ id: crypto.randomBytes(6).toString('hex'), outfit: choice.id, label: choice.label, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
            state.outfitSchedule.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
          }
          else if (action === 'unscheduleOutfit') {
            const kept = state.outfitSchedule.filter(e => e.id !== String(body.id || ''));
            if (kept.length === state.outfitSchedule.length) return sendJson(res, 404, { error: 'That scheduled outfit is not there any more (it may have ended).' });
            state.outfitSchedule = kept;
          }
          else if (action === 'displayOn') state.displayEnabled = true;
          else if (action === 'displayOff') state.displayEnabled = false;
          else if (action !== 'refresh') return sendJson(res, 400, { error: 'Unsupported control action.' });
          state.revision += 1;
          if (['outfit', 'clearOutfit', 'scheduleOutfit', 'unscheduleOutfit'].includes(action)) saveOutfits();
          const control = effectiveControl(roomId);
          lastOutfitKey.set(roomId, outfitKey(control));
          notifyRoom(roomId, 'room.control', { action, control });
          return sendJson(res, 200, { ok: true, roomId, control });
        }
      }
      if ((req.method === 'GET' || isHead) && (url.pathname === '/' || url.pathname === '/index.html' || /^\/room\/[a-z0-9-]+\/?$/.test(url.pathname))) return void serveStatic(req, res, 'index.html');
      if ((req.method === 'GET' || isHead) && (url.pathname === '/dashboard' || url.pathname === '/dashboard/')) return void serveStatic(req, res, 'dashboard.html');
      if (req.method === 'GET' || isHead) { const file = url.pathname.replace(/^\//, ''); if (serveStatic(req, res, file)) return; }
      return sendJson(res, 404, { error: 'Not found.' }, isHead);
    } catch (error) {
      logger.error?.(error);
      if (!res.headersSent) { const answer = failureAnswer(error, url.pathname); return sendJson(res, answer.status, answer.body); }
      res.end();
    }
  });

  let scheduleTimer = null;
  server.on('close', () => { subscriptions.stop(); if (watcher) clearInterval(watcher); if (monitor) clearInterval(monitor); if (scheduleTimer) clearInterval(scheduleTimer); });
  server.appState = { config, calendars, tablets, controls, signIn, liveControl, effectiveControl, checkOutfitSchedules, endOfDay, pushableOutfits, subscriptions, notifyRoom, refreshRoom, checkTablets, checkSecretExpiry, secretStatus, checkWeatherAlerts, alerts, teams, calendarProblems };
  if (options.startSubscriptions !== false) startWatcher();
  if (options.startSubscriptions !== false) {
    monitor = setInterval(() => {
      checkTablets().catch(error => logger.error?.(`Tablet check failed: ${error.message}`));
      checkSecretExpiry().catch(error => logger.error?.(`Secret expiry check failed: ${error.message}`));
    checkWeatherAlerts().catch(error => logger.error?.(`Weather alert check failed: ${error.message}`));
    }, 60000); monitor.unref?.();
  }
  checkOutfitSchedules();
  if (options.startSubscriptions !== false) { scheduleTimer = setInterval(() => checkOutfitSchedules(), 15000); scheduleTimer.unref?.(); }
  if (options.startSubscriptions !== false) subscriptions.start().catch(error => logger.error('Subscriptions did not start:', error.message));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotEnv();
  const server = createAppServer({ dataDir: process.env.DATA_DIR || path.join(ROOT, 'data') });
  server.listen(server.appState.config.port, '0.0.0.0', () => console.log(`M365 room display listening on http://0.0.0.0:${server.appState.config.port} for ${server.appState.config.rooms.length} room(s)`));
  const shutdown = signal => {
    console.log(`${signal} received; shutting down.`);
    const timer = setTimeout(() => process.exit(1), 10000); timer.unref();
    server.close(error => process.exit(error ? 1 : 0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
