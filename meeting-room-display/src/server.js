import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { DemoCalendar } from './demo-calendar.js';
import { GraphCalendar } from './graph-calendar.js';
import { SubscriptionManager } from './subscription-manager.js';
import { timingSafeTextEqual, validateBooking } from './validation.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(dirname, '..', 'public');
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function securityHeaders(contentType = null) {
  return {
    ...(contentType ? { 'Content-Type': contentType } : {}),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { ...securityHeaders('application/json; charset=utf-8'), 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65_536) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createApplication(config = loadConfig()) {
  const calendar = config.demoMode ? new DemoCalendar() : new GraphCalendar(config);
  const streamClients = new Set();
  const subscriptionManager = new SubscriptionManager(calendar, config);

  const notifyDisplays = (type = 'calendar.changed') => {
    const payload = `event: ${type}\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`;
    for (const res of streamClients) res.write(payload);
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return sendJson(res, 200, { status: 'ok', mode: config.demoMode ? 'demo' : 'm365' });
      }

      if (req.method === 'GET' && url.pathname === '/api/config') {
        return sendJson(res, 200, {
          roomName: config.roomName,
          roomEmail: config.roomEmail,
          displayTimeZone: config.displayTimeZone,
          allowQuickBooking: config.allowQuickBooking || config.demoMode,
          demoMode: config.demoMode,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        const now = new Date();
        const start = url.searchParams.has('start') ? new Date(url.searchParams.get('start')) : new Date(now.getTime() - 60 * 60_000);
        const end = url.searchParams.has('end') ? new Date(url.searchParams.get('end')) : new Date(now.getTime() + 24 * 60 * 60_000);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
          return sendJson(res, 400, { error: 'Invalid start or end range.' });
        }
        if (end - start > 7 * 24 * 60 * 60_000) {
          return sendJson(res, 400, { error: 'The requested range cannot exceed 7 days.' });
        }
        const events = await calendar.listEvents(start, end);
        return sendJson(res, 200, { events, generatedAt: new Date().toISOString() });
      }

      if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, {
          ...securityHeaders('text/event-stream'),
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
        streamClients.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
        heartbeat.unref?.();
        req.on('close', () => {
          clearInterval(heartbeat);
          streamClients.delete(res);
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/book') {
        if (!config.allowQuickBooking && !config.demoMode) return sendJson(res, 403, { error: 'Quick booking is disabled.' });
        let booking;
        try { booking = validateBooking(await readJson(req)); }
        catch (error) { return sendJson(res, 400, { error: error.message }); }
        const overlapping = (await calendar.listEvents(booking.start, booking.end)).some((event) =>
          new Date(event.start) < new Date(booking.end) && new Date(event.end) > new Date(booking.start));
        if (overlapping) return sendJson(res, 409, { error: 'The room is no longer available for that time.' });
        const event = await calendar.createEvent(booking);
        notifyDisplays();
        return sendJson(res, 201, { event });
      }

      if (req.method === 'POST' && url.pathname === '/api/graph/notifications') {
        if (url.searchParams.has('validationToken')) {
          res.writeHead(200, securityHeaders('text/plain; charset=utf-8'));
          res.end(url.searchParams.get('validationToken'));
          return;
        }
        const body = await readJson(req);
        res.writeHead(202, securityHeaders());
        res.end();
        const valid = (body.value || []).some((notification) =>
          timingSafeTextEqual(notification.clientState || '', config.graphClientState));
        if (valid) notifyDisplays();
        return;
      }

      if (['GET', 'HEAD'].includes(req.method) && staticFiles.has(url.pathname)) {
        const [file, contentType] = staticFiles.get(url.pathname);
        const contents = await fs.readFile(path.join(publicDir, file));
        const cacheControl = file === 'index.html' || config.demoMode ? 'no-cache' : 'public, max-age=3600';
        res.writeHead(200, { ...securityHeaders(contentType), 'Cache-Control': cacheControl, 'Content-Length': contents.length });
        res.end(req.method === 'HEAD' ? undefined : contents);
        return;
      }

      return sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) return sendJson(res, 502, { error: 'The room calendar is temporarily unavailable.' });
      return res.end();
    }
  };

  const server = http.createServer(handler);
  return { server, subscriptionManager, notifyDisplays };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const { server, subscriptionManager } = createApplication(config);
  server.listen(config.port, async () => {
    console.log(`Meeting room display listening on http://localhost:${config.port}`);
    await subscriptionManager.start();
  });
  const shutdown = () => {
    subscriptionManager.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
