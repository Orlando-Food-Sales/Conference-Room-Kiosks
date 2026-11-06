import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

test('loads and normalizes rooms from a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm365-room-'));
  fs.writeFileSync(path.join(dir, 'rooms.json'), JSON.stringify([{ id: 'front', name: 'Front', email: 'front@example.com', timeZone: 'UTC', allowQuickBooking: false }]));
  const config = loadConfig({ DEMO_MODE: 'true', ROOMS_FILE: './rooms.json' }, dir);
  assert.equal(config.rooms[0].id, 'front');
  assert.equal(config.demoMode, true);
});

test('requires credentials outside demo mode', () => {
  assert.throws(() => loadConfig({ DEMO_MODE: 'false', ROOM_NAME: 'Room', ROOM_EMAIL: 'room@example.com' }), /TENANT_ID/);
});
