import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApplication } from '../src/server.js';

const config = Object.freeze({
  port: 0,
  demoMode: true,
  roomName: 'Test Room',
  roomEmail: 'test-room@example.com',
  displayTimeZone: 'UTC',
  tenantId: '', clientId: '', clientSecret: '', publicBaseUrl: '',
  allowQuickBooking: true,
  graphClientState: 'test-client-state-at-least-32-characters',
});

async function withServer(fn) {
  const { server } = createApplication(config);
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('health and config endpoints return display metadata', async () => withServer(async (base) => {
  const health = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.deepEqual(health, { status: 'ok', mode: 'demo' });
  const room = await fetch(`${base}/api/config`).then((r) => r.json());
  assert.equal(room.roomName, 'Test Room');
  assert.equal(room.allowQuickBooking, true);
}));

test('events can be listed and a non-overlapping room booking can be created', async () => withServer(async (base) => {
  const start = new Date(Date.now() + 6 * 60 * 60_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  const create = await fetch(`${base}/api/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: 'API test', start: start.toISOString(), end: end.toISOString() }),
  });
  assert.equal(create.status, 201);
  const rangeEnd = new Date(end.getTime() + 60_000);
  const data = await fetch(`${base}/api/events?start=${start.toISOString()}&end=${rangeEnd.toISOString()}`).then((r) => r.json());
  assert.equal(data.events.some((event) => event.subject === 'API test'), true);
}));

test('Graph validation echoes the validation token as plain text', async () => withServer(async (base) => {
  const response = await fetch(`${base}/api/graph/notifications?validationToken=proof`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  assert.equal(await response.text(), 'proof');
}));
