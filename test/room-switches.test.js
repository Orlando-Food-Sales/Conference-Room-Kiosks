import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoomSwitches, DEFINITIONS } from '../src/room-switches.js';

const rooms = () => [
  { id: 'front', name: 'Front', allowQuickBooking: true, showCelebrations: true },
  { id: 'back', name: 'Back', allowQuickBooking: false, showCelebrations: false }
];
const makeConfig = (extra = {}) => ({
  rooms: rooms(), noise: { enabled: false }, intercom: { enabled: true }, location: { enabled: true }, weather: { enabled: true },
  camera: { enabled: false, hosts: {} }, walkIn: { enabled: false, rooms: {} }, ...extra
});
const tempDir = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const make = (t, config = makeConfig(), extra = {}) => { const errors = []; const dataDir = extra.dataDir || tempDir(t); return { dataDir, errors, switches: new RoomSwitches({ config, dataDir, logger: { error: line => errors.push(line) } }) }; };

test('defaults equal the configured values', t => {
  const { switches } = make(t);
  assert.equal(switches.effective('front', 'noise'), false);
  for (const key of ['intercom', 'location', 'weather', 'snoopy', 'snoopyMotion', 'celebrations', 'quickBooking']) assert.equal(switches.effective('front', key), true, key);
  assert.equal(switches.effective('back', 'quickBooking'), false);
  assert.equal(switches.effective('back', 'celebrations'), false);
  assert.equal(switches.effective('front', 'walkIn'), false);
  assert.equal(switches.effective('front', 'camera'), 'unmanaged');
});
test('an override beats the configured value, and null follows the setting again', t => {
  const { switches } = make(t);
  assert.equal(switches.set('back', 'quickBooking', true, 'me').changed, true);
  assert.equal(switches.effective('back', 'quickBooking'), true);
  assert.equal(switches.effective('front', 'quickBooking'), true);
  assert.equal(switches.set('front', 'location', false, 'me').after, false);
  assert.equal(switches.set('front', 'location', null, 'me').after, true);
  assert.equal(switches.describe('front').find(r => r.key === 'location').override, null);
});
test('describe shows the configured value, who and when', t => {
  const { switches } = make(t);
  switches.set('front', 'weather', false, 'ann@example.com');
  const row = switches.describe('front').find(r => r.key === 'weather');
  assert.equal(row.effective, false); assert.equal(row.configured, true); assert.equal(row.override, false);
  assert.equal(row.by, 'ann@example.com'); assert.match(row.at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(switches.describe('front').length, DEFINITIONS.length);
});
test('overrides survive a new instance on the same folder, and no .tmp file is left', t => {
  const { switches, dataDir } = make(t);
  switches.set('front', 'noise', true, 'me');
  switches.set('front', 'camera', 'off', 'me');
  assert.deepEqual(fs.readdirSync(dataDir), ['room-switches.json']);
  const again = make(t, makeConfig(), { dataDir }).switches;
  assert.equal(again.effective('front', 'noise'), true);
  assert.equal(again.effective('front', 'camera'), 'off');
});
test('a corrupt file, unknown rooms or keys and wrong types are logged and ignored', t => {
  const dataDir = tempDir(t);
  const file = path.join(dataDir, 'room-switches.json');
  fs.writeFileSync(file, '{ nope');
  const bad = make(t, makeConfig(), { dataDir });
  assert.ok(bad.errors.length >= 1);
  assert.equal(bad.switches.effective('front', 'location'), true);
  fs.writeFileSync(file, JSON.stringify({ version: 1, rooms: { front: { location: { value: false }, bogus: { value: true }, noise: { value: 'yes' } }, gone: { location: { value: false } } } }));
  const mixed = make(t, makeConfig(), { dataDir });
  assert.equal(mixed.switches.effective('front', 'location'), false);
  assert.equal(mixed.switches.effective('front', 'noise'), false);
  assert.equal(mixed.errors.length, 3);
});
test('turning a feature on where it cannot work is refused with a plain sentence', t => {
  const { switches } = make(t, makeConfig({ noise: { enabled: false, problem: 'talking must be lower' }, weather: { enabled: false } }));
  for (const [key, value, pattern] of [['noise', true, /settings problem/], ['camera', 'ondemand', /FULLY_CAMERA_HOSTS/], ['walkIn', true, /WALK_IN_ENABLED/], ['weather', true, /WEATHER_ENABLED/]]) {
    assert.throws(() => switches.set('front', key, value, 'me'), error => error.status === 409 && pattern.test(error.message), key);
  }
  switches.set('front', 'noise', false, 'me');   // turning off is always allowed
  assert.throws(() => switches.set('front', 'bogus', true), error => error.status === 400);
  assert.throws(() => switches.set('front', 'camera', 'maybe'), error => error.status === 400);
  assert.throws(() => switches.set('front', 'location', 'on'), error => error.status === 400);
  assert.throws(() => switches.set('nowhere', 'location', true), error => error.status === 404);
});
test('walk-in needs the setting and a presenceUserId for the room', t => {
  const { switches } = make(t, makeConfig({ walkIn: { enabled: true, rooms: { front: 'guid' } } }));
  assert.equal(switches.effective('front', 'walkIn'), true);
  assert.equal(switches.capability('back', 'walkIn').ok, false);
  assert.throws(() => switches.set('back', 'walkIn', true), error => error.status === 409 && /presenceUserId/.test(error.message));
  switches.set('front', 'walkIn', false, 'me');
  assert.equal(switches.effective('front', 'walkIn'), false);
});
test('presets: battery saver and back to normal', t => {
  const { switches } = make(t);
  switches.preset('front', 'battery-saver', 'me');
  assert.equal(switches.effective('front', 'noise'), false);
  assert.equal(switches.effective('front', 'location'), false);
  assert.equal(switches.effective('front', 'snoopyMotion'), false);
  assert.equal(switches.effective('front', 'camera'), 'unmanaged');   // no camera in this room, so it is left alone
  assert.equal(switches.effective('front', 'intercom'), true);
  assert.equal(switches.effective('front', 'weather'), true);
  assert.equal(switches.effective('back', 'location'), true);
  switches.preset('front', 'normal', 'me');
  assert.equal(switches.effective('front', 'location'), true);
  assert.throws(() => switches.preset('front', 'x'), error => error.status === 400);
  const withCamera = make(t, makeConfig({ camera: { enabled: true, hosts: { front: 'h' } } })).switches;
  withCamera.preset('front', 'battery-saver', 'me');
  assert.equal(withCamera.effective('front', 'camera'), 'ondemand');
});
test('the settings files are never written', t => {
  const dir = tempDir(t);
  const rooms = path.join(dir, 'rooms.json'), env = path.join(dir, '.env');
  fs.writeFileSync(rooms, '[{"id":"front"}]'); fs.writeFileSync(env, 'NOISE_METER=false\n');
  const before = [fs.readFileSync(rooms), fs.readFileSync(env)];
  const { switches } = make(t);
  switches.set('front', 'noise', true, 'me'); switches.set('front', 'location', false, 'me'); switches.preset('back', 'battery-saver', 'me'); switches.clearAll('front');
  assert.deepEqual([fs.readFileSync(rooms), fs.readFileSync(env)], before);
});
test('every definition has plain wording, and the server-only ones say they do not save battery', () => {
  for (const def of DEFINITIONS) { assert.ok(def.what && def.offCost && def.label, def.key); assert.ok(['tablet', 'server', 'fully'].includes(def.kind)); }
  for (const key of ['walkIn', 'quickBooking', 'celebrations']) assert.match(DEFINITIONS.find(d => d.key === key).what, /does not save tablet battery/);
});
