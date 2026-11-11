import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, publicRoom } from '../src/config.js';

const demo = { DEMO_MODE: 'true' };

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

test('rejects bad rooms: duplicate ids, bad ids, missing mailbox, bad time zone', () => {
  const rooms = list => ({ ...demo, ROOMS_JSON: JSON.stringify(list) });
  const room = (extra = {}) => ({ id: 'front', name: 'Front', email: 'f@example.com', timeZone: 'UTC', ...extra });
  assert.throws(() => loadConfig(rooms([room(), room()])), /Duplicate room id/);
  assert.throws(() => loadConfig(rooms([room({ id: 'Front Room' })])), /Invalid room id/);
  assert.throws(() => loadConfig(rooms([room({ email: 'nope' })])), /valid mailbox/);
  assert.throws(() => loadConfig(rooms([room({ timeZone: 'Mars/Base' })])), /time zone/);
  assert.throws(() => loadConfig(rooms([])), /At least one room/);
});

test('showCelebrations is on unless a room turns it off, and is public', () => {
  const rooms = [{ id: 'a', name: 'A', email: 'a@example.com', timeZone: 'UTC' }, { id: 'b', name: 'B', email: 'b@example.com', timeZone: 'UTC', showCelebrations: false }];
  const config = loadConfig({ ...demo, ROOMS_JSON: JSON.stringify(rooms) });
  assert.equal(config.rooms[0].showCelebrations, true);
  assert.equal(config.rooms[1].showCelebrations, false);
  assert.equal(publicRoom(config.rooms[1]).showCelebrations, false);
});

test('office hours default to 8 to 5 on weekdays and can be changed or turned off', () => {
  assert.deepEqual(loadConfig(demo).officeHours, { startMinutes: 480, endMinutes: 1020, days: [1, 2, 3, 4, 5] });
  assert.deepEqual(
    loadConfig({ ...demo, OFFICE_HOURS_START: '07:30', OFFICE_HOURS_END: '18:00', OFFICE_DAYS: '1-6' }).officeHours,
    { startMinutes: 450, endMinutes: 1080, days: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual(loadConfig({ ...demo, OFFICE_DAYS: '1,3,5' }).officeHours.days, [1, 3, 5]);
  assert.equal(loadConfig({ ...demo, OFFICE_HOURS: 'off' }).officeHours, null);
});

test('office hours reject nonsense instead of silently using it', () => {
  assert.throws(() => loadConfig({ ...demo, OFFICE_HOURS_START: '8am' }), /OFFICE_HOURS_START/);
  assert.throws(() => loadConfig({ ...demo, OFFICE_HOURS_END: '07:00' }), /after OFFICE_HOURS_START/);
  assert.throws(() => loadConfig({ ...demo, OFFICE_DAYS: '9' }), /OFFICE_DAYS/);
  assert.throws(() => loadConfig({ ...demo, OFFICE_DAYS: 'mon' }), /OFFICE_DAYS/);
});

test('calendar change check: 15 seconds by default, limited to 5 to 3600, 0 or off disables it', () => {
  const seconds = value => loadConfig(value === undefined ? demo : { ...demo, CHANGE_CHECK_SECONDS: value }).changeCheckSeconds;
  assert.equal(seconds(undefined), 15);
  assert.equal(seconds('10'), 10);
  assert.equal(seconds('1'), 5);
  assert.equal(seconds('99999'), 3600);
  assert.equal(seconds('0'), 0);
  assert.equal(seconds('off'), 0);
});

test('weather defaults to Glen Rock, NJ with automatic source selection', () => {
  const { weather } = loadConfig(demo);
  assert.equal(weather.enabled, true);
  assert.equal(weather.latitude, 40.9595);
  assert.equal(weather.longitude, -74.1252);
  assert.equal(weather.source, 'auto');
  const custom = loadConfig({ ...demo, WEATHER_LATITUDE: '28.5383', WEATHER_LONGITUDE: '-81.3792', WEATHER_SOURCE: 'OPEN-METEO', WEATHER_ENABLED: 'false', WEATHER_CONTACT: 'it@example.com' }).weather;
  assert.deepEqual([custom.latitude, custom.longitude, custom.source, custom.enabled, custom.contact], [28.5383, -81.3792, 'open-meteo', false, 'it@example.com']);
  assert.equal(loadConfig({ ...demo, WEATHER_SOURCE: 'bogus' }).weather.source, 'auto');
  assert.equal(loadConfig({ ...demo, WEATHER_LATITUDE: '999' }).weather.latitude, 90, 'out of range values are clamped');
});

test('birthday calendar settings follow the first room time zone unless set', () => {
  const rooms = JSON.stringify([{ id: 'a', name: 'A', email: 'a@example.com', timeZone: 'America/New_York' }]);
  assert.equal(loadConfig({ ...demo, ROOMS_JSON: rooms }).birthdays.timeZone, 'America/New_York');
  const set = loadConfig({ ...demo, ROOMS_JSON: rooms, BIRTHDAY_CALENDAR_MAILBOX: ' cal@example.com ', BIRTHDAY_CALENDAR_NAME: 'birth', BIRTHDAY_NAME_STYLE: 'FULL', BIRTHDAY_TIME_ZONE: 'UTC' }).birthdays;
  assert.deepEqual([set.mailbox, set.calendarName, set.nameStyle, set.timeZone], ['cal@example.com', 'birth', 'full', 'UTC']);
  assert.equal(loadConfig(demo).birthdays.nameStyle, 'first');
  assert.throws(() => loadConfig({ ...demo, BIRTHDAY_TIME_ZONE: 'Mars/Base' }), /BIRTHDAY_TIME_ZONE/);
});

test('tablet offline alert settings: 10 minutes by default, webhook must be https', () => {
  const config = loadConfig(demo);
  assert.equal(config.alertAfterMinutes, 10);
  assert.equal(config.alertWebhookUrl, '');
  assert.equal(loadConfig({ ...demo, ALERT_AFTER_MINUTES: '0' }).alertAfterMinutes, 1);
  assert.equal(loadConfig({ ...demo, ALERT_WEBHOOK_URL: 'https://hooks.example.com/x' }).alertWebhookUrl, 'https://hooks.example.com/x');
  assert.throws(() => loadConfig({ ...demo, ALERT_WEBHOOK_URL: 'http://hooks.example.com/x' }), /https/);
});

const BOT = { TEAMS_BOT_APP_ID: '11111111-2222-3333-4444-555555555555', TEAMS_BOT_APP_SECRET: 's3cret', TEAMS_BOT_TENANT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', TEAMS_ALERT_EMAILS: 'A@example.com, b@example.com;a@example.com' };

test('Teams alerts are off unless configured, and tidy up the list of people', () => {
  assert.equal(loadConfig(demo).teamsAlerts.enabled, false);
  const teams = loadConfig({ ...demo, ...BOT }).teamsAlerts;
  assert.equal(teams.enabled, true);
  assert.deepEqual(teams.recipients, ['a@example.com', 'b@example.com'], 'lower-cased, split on commas, semicolons or spaces, no duplicates');
  assert.equal(teams.serviceUrl, 'https://smba.trafficmanager.net/teams/');
  assert.equal(loadConfig({ ...demo, ...BOT, TEAMS_BOT_TENANT_ID: '', TENANT_ID: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' }).teamsAlerts.tenantId, 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', 'falls back to the main tenant');
});

test('Teams alert settings must be complete and valid, or the server refuses to start', () => {
  assert.throws(() => loadConfig({ ...demo, ...BOT, TEAMS_BOT_APP_SECRET: '' }), /together/);
  assert.throws(() => loadConfig({ ...demo, ...BOT, TEAMS_ALERT_EMAILS: '' }), /together/);
  assert.throws(() => loadConfig({ ...demo, ...BOT, TEAMS_BOT_APP_ID: 'not-a-guid' }), /GUID/);
  assert.throws(() => loadConfig({ ...demo, ...BOT, TEAMS_BOT_TENANT_ID: '' }), /tenant/i);
  assert.throws(() => loadConfig({ ...demo, ...BOT, TEAMS_ALERT_EMAILS: 'nobody' }), /invalid address/);
  assert.throws(() => loadConfig({ ...demo, ...BOT, TEAMS_BOT_SERVICE_URL: 'http://smba.example.com' }), /https/);
  assert.throws(() => loadConfig({ ...demo, ...BOT, TEAMS_BOT_CATALOG_ID: 'abc' }), /GUID/);
  const many = Array.from({ length: 11 }, (_, i) => `p${i}@example.com`).join(',');
  assert.throws(() => loadConfig({ ...demo, ...BOT, TEAMS_ALERT_EMAILS: many }), /at most 10/);
});

test('client secret expiry date is optional and must be a real YYYY-MM-DD date', () => {
  assert.equal(loadConfig(demo).clientSecretExpires, '');
  assert.equal(loadConfig({ ...demo, CLIENT_SECRET_EXPIRES: ' 2027-05-04 ' }).clientSecretExpires, '2027-05-04');
  for (const bad of ['2027-02-30', '05/04/2027', '2027-5-4', 'soon', '2027-13-01']) {
    assert.throws(() => loadConfig({ ...demo, CLIENT_SECRET_EXPIRES: bad }), /CLIENT_SECRET_EXPIRES/, bad);
  }
});
