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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

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
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
  const celebrations = options.celebrations || new CelebrationService(config, tokenProvider, options.fetchImpl || fetch);
  const sseClients = new Set();
  const tablets = new Map();
  const controls = new Map(config.rooms.map(room => [room.id, { displayEnabled: true, message: '', messageExpiresAt: null, revision: 0 }]));
  const roomById = new Map(config.rooms.map(room => [room.id, room]));

  function notifyRoom(roomId, type, detail = {}) {
    const data = JSON.stringify({ roomId, detail, at: new Date().toISOString() });
    for (const client of sseClients) if (client.roomId === roomId || client.roomId === '*') client.res.write(`event: ${type}\ndata: ${data}\n\n`);
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
    const tablet = { tabletId, roomId, name: String(body.name || previous?.name || 'Room tablet').trim().slice(0, 100), lastSeen: new Date().toISOString(), connectedAt: previous?.connectedAt || new Date().toISOString(), ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300) };
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
      if ((req.method === 'GET' || isHead) && url.pathname === '/healthz') return sendJson(res, 200, { status: 'ok', mode: config.demoMode ? 'demo' : 'm365', rooms: config.rooms.length, uptimeSeconds: Math.round(process.uptime()) }, isHead);
      if (req.method === 'GET' && url.pathname === '/api/celebrations') {
        const room = roomById.get(url.searchParams.get('room') || '');
        if (room && !room.showCelebrations) return sendJson(res, 200, { celebrations: [] });
        return sendJson(res, 200, await celebrations.get());
      }
      if (req.method === 'GET' && url.pathname === '/api/weather') return sendJson(res, 200, { weather: await weather.get() });
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
        const events = await calendar.listEvents(start, end);
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
        const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25000);
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
        const calendar = calendars.get(room.id);
        const overlapping = (await calendar.listEvents(booking.start, booking.end)).some(event => new Date(event.end) > new Date(booking.start) && new Date(event.start) < new Date(booking.end));
        if (overlapping) return sendJson(res, 409, { error: 'That time overlaps an existing meeting.' });
        const event = await calendar.createEvent(booking);
        notifyRoom(room.id, 'calendar.changed', { reason: 'booking.created' });
        return sendJson(res, 201, { event });
      }
      if (url.pathname === '/api/notifications' && url.searchParams.has('validationToken')) return sendText(res, 200, url.searchParams.get('validationToken'));
      if (req.method === 'POST' && url.pathname === '/api/notifications') { subscriptions.processNotifications((await readJson(req, 256000)).value || []); return sendText(res, 202, 'Accepted'); }
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
          return sendJson(res, 200, { rooms, generatedAt: new Date().toISOString(), mode: config.demoMode ? 'demo' : 'm365' });
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

  server.on('close', () => subscriptions.stop());
  server.appState = { config, calendars, tablets, controls, subscriptions, notifyRoom };
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
