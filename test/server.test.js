import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../src/server.js';

const config = { port: 0, demoMode: true, adminToken: 'test-token', eventRefreshSeconds: 60, tabletOfflineSeconds: 120, rooms: [{ id: 'front', name: 'Front Room', email: 'front@example.com', timeZone: 'UTC', allowQuickBooking: false }] };

test('serves health, room UI, assets, and demo events', async t => {
  const server = createAppServer({ config, startSubscriptions: false, logger: { error() {} } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/healthz`); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'ok');
  response = await fetch(`${base}/room/front`); assert.equal(response.status, 200); assert.match(await response.text(), /Room Display/);
  response = await fetch(`${base}/app.js`); assert.equal(response.status, 200); assert.match(await response.text(), /generateId/);
  response = await fetch(`${base}/styles.css`, { method: 'HEAD' }); assert.equal(response.status, 200);
  response = await fetch(`${base}/api/events?room=front`); assert.equal(response.status, 200); assert.ok(Array.isArray((await response.json()).events));
});
