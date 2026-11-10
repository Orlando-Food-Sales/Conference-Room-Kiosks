import fs from 'node:fs';
import path from 'node:path';

function booleanValue(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function integerValue(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function floatValue(value, fallback, min, max) {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function roomId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) {
    throw new Error(`Invalid room id "${value}". Use lowercase letters, numbers, and hyphens.`);
  }
  return id;
}

function normalizeRoom(value) {
  const room = {
    id: roomId(value.id),
    name: String(value.name || '').trim(),
    email: String(value.email || '').trim(),
    timeZone: String(value.timeZone || 'UTC').trim(),
    allowQuickBooking: Boolean(value.allowQuickBooking),
    showCelebrations: value.showCelebrations !== false      // set false for client-facing rooms
  };
  if (!room.name) throw new Error(`Room ${room.id} needs a name.`);
  if (!room.email || !room.email.includes('@')) throw new Error(`Room ${room.id} needs a valid mailbox address.`);
  try { new Intl.DateTimeFormat('en-US', { timeZone: room.timeZone }).format(); }
  catch { throw new Error(`Room ${room.id} has an invalid IANA time zone: ${room.timeZone}`); }
  return room;
}

function loadRooms(env, cwd) {
  let values;
  if (env.ROOMS_JSON) {
    values = JSON.parse(env.ROOMS_JSON);
  } else if (env.ROOMS_FILE) {
    const file = path.resolve(cwd, env.ROOMS_FILE);
    values = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    values = [{
      id: env.ROOM_ID || String(env.ROOM_NAME || 'room').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name: env.ROOM_NAME || 'Conference Room',
      email: env.ROOM_EMAIL || 'room@example.com',
      timeZone: env.DISPLAY_TIME_ZONE || 'UTC',
      allowQuickBooking: booleanValue(env.ALLOW_QUICK_BOOKING)
    }];
  }
  if (!Array.isArray(values) || values.length === 0) throw new Error('At least one room must be configured.');
  const rooms = values.map(normalizeRoom);
  const ids = new Set();
  for (const room of rooms) {
    if (ids.has(room.id)) throw new Error(`Duplicate room id: ${room.id}`);
    ids.add(room.id);
  }
  return rooms;
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const demoMode = booleanValue(env.DEMO_MODE, false);
  const config = {
    port: integerValue(env.PORT, 3000, 1, 65535),
    demoMode,
    tenantId: String(env.TENANT_ID || '').trim(),
    clientId: String(env.CLIENT_ID || '').trim(),
    clientSecret: String(env.CLIENT_SECRET || '').trim(),
    adminToken: String(env.ADMIN_TOKEN || '').trim(),
    eventRefreshSeconds: integerValue(env.EVENT_REFRESH_SECONDS, 60, 15, 3600),
    tabletOfflineSeconds: integerValue(env.TABLET_OFFLINE_SECONDS, 120, 30, 86400),
    publicBaseUrl: String(env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    birthdays: {
      mailbox: String(env.BIRTHDAY_CALENDAR_MAILBOX || '').trim(),
      calendarId: String(env.BIRTHDAY_CALENDAR_ID || '').trim(),
      calendarName: String(env.BIRTHDAY_CALENDAR_NAME || '').trim(),
      nameStyle: /^full$/i.test(String(env.BIRTHDAY_NAME_STYLE || '')) ? 'full' : 'first',
      timeZone: ''   // filled below from the first room unless BIRTHDAY_TIME_ZONE is set
    },
    weather: {
      enabled: booleanValue(env.WEATHER_ENABLED, true),
      // Defaults to Glen Rock, NJ.
      latitude: floatValue(env.WEATHER_LATITUDE, 40.9595, -90, 90),
      longitude: floatValue(env.WEATHER_LONGITUDE, -74.1252, -180, 180)
    },
    rooms: loadRooms(env, cwd)
  };
  const birthdayZone = String(env.BIRTHDAY_TIME_ZONE || '').trim() || config.rooms[0].timeZone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: birthdayZone }).format(); }
  catch { throw new Error(`BIRTHDAY_TIME_ZONE is not a valid IANA time zone: ${birthdayZone}`); }
  config.birthdays.timeZone = birthdayZone;
  if (!demoMode && (!config.tenantId || !config.clientId || !config.clientSecret)) {
    throw new Error('TENANT_ID, CLIENT_ID, and CLIENT_SECRET are required when DEMO_MODE=false.');
  }
  return config;
}

export function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    email: room.email,
    timeZone: room.timeZone,
    allowQuickBooking: room.allowQuickBooking,
    showCelebrations: room.showCelebrations,
    displayUrl: `/room/${room.id}`
  };
}
