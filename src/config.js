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

function timeOfDay(value, fallback, name) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 24 || Number(match[2]) > 59) throw new Error(`${name} must look like 08:00 or 17:30.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function weekdays(value) {
  const text = String(value ?? '').trim();
  if (!text) return [1, 2, 3, 4, 5];
  const days = new Set();
  for (const part of text.split(',')) {
    const range = part.trim().match(/^([0-6])(?:-([0-6]))?$/);
    if (!range) throw new Error('OFFICE_DAYS must look like 1-5 or 1,2,3,4,5 (0 is Sunday).');
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    for (let d = from; d <= to; d += 1) days.add(d);
  }
  return [...days].sort();
}

function loadOfficeHours(env) {
  if (/^(off|false|0|no)$/i.test(String(env.OFFICE_HOURS || ''))) return null;
  const startMinutes = timeOfDay(env.OFFICE_HOURS_START, 8 * 60, 'OFFICE_HOURS_START');
  const endMinutes = timeOfDay(env.OFFICE_HOURS_END, 17 * 60, 'OFFICE_HOURS_END');
  if (endMinutes <= startMinutes) throw new Error('OFFICE_HOURS_END must be after OFFICE_HOURS_START.');
  return { startMinutes, endMinutes, days: weekdays(env.OFFICE_DAYS) };
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
    showCelebrations: value.showCelebrations !== false,     // set false for client-facing rooms
    presenceUserId: String(value.presenceUserId || '').trim()   // Entra object id of the room's Teams account (walk-in calls)
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

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Alerts from a named Teams bot. All of it is optional; leave TEAMS_BOT_APP_ID empty to turn it off.
// The day the Microsoft 365 client secret expires (YYYY-MM-DD), for the expiry reminders. Empty turns them off.
// The app cannot read this from Microsoft itself, so it has to be written down here.
// Door camera through Fully Kiosk Browser's Remote Admin (INSTALL-UBUNTU.md 12e). FULLY_CAMERA_HOSTS names each room's
// tablet address (room=ip, comma separated) and FULLY_REMOTE_PASSWORD is the Remote Admin password. The addresses are
// written down here on purpose: the server never sends that password to an address a browser reported about itself.
function privateIPv4(ip) {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some(n => !Number.isInteger(n) || n > 255)) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}
function loadCamera(env, rooms) {
  const list = String(env.FULLY_CAMERA_HOSTS || '').trim();
  const password = String(env.FULLY_REMOTE_PASSWORD || '');
  // On request mode (src/fully-camera.js): how long the camera stays on after the last picture, and how long it gets to warm up.
  const timing = { idleSeconds: integerValue(env.FULLY_CAMERA_IDLE_SECONDS, 120, 30, 1800), warmupSeconds: integerValue(env.FULLY_CAMERA_WARMUP_SECONDS, 8, 3, 20) };
  if (!list && !password) return { enabled: false, hosts: {}, password: '', port: 2323, ...timing };
  if (!list || !password) throw new Error('The door camera needs FULLY_CAMERA_HOSTS and FULLY_REMOTE_PASSWORD together (or neither).');
  const hosts = {};
  for (const part of list.split(',').map(s => s.trim()).filter(Boolean)) {
    const match = part.match(/^([a-z0-9-]+)\s*=\s*([0-9.]+)$/);
    if (!match) throw new Error(`FULLY_CAMERA_HOSTS: "${part}" should look like front=192.168.1.20.`);
    if (!rooms.some(room => room.id === match[1])) throw new Error(`FULLY_CAMERA_HOSTS: there is no room "${match[1]}".`);
    if (!privateIPv4(match[2])) throw new Error(`FULLY_CAMERA_HOSTS: ${match[2]} must be a private network address (10.x, 172.16-31.x or 192.168.x).`);
    hosts[match[1]] = match[2];
  }
  return { enabled: true, hosts, password, port: integerValue(env.FULLY_REMOTE_PORT, 2323, 1, 65535), ...timing };
}
// Walk-in Teams calls (INSTALL-UBUNTU.md 12g). Off unless WALK_IN_ENABLED; a room is watched only when it has a presenceUserId.
// In demo mode every room is watched without an id. A settings mistake turns the feature off and is logged.
function loadWalkIn(env, rooms, demoMode) {
  const enabled = booleanValue(env.WALK_IN_ENABLED, false);
  const result = { enabled, maxMinutes: integerValue(env.WALK_IN_MAX_MINUTES, 240, 15, 720), outsideHours: booleanValue(env.WALK_IN_OUTSIDE_HOURS, false), checkSeconds: 30, rooms: {} };
  if (!enabled) return result;
  const seen = new Set();
  for (const room of rooms) {
    if (demoMode) { result.rooms[room.id] = ''; continue; }
    if (!room.presenceUserId) continue;
    if (!GUID.test(room.presenceUserId)) throw new Error(`Room ${room.id}: presenceUserId must be the Teams account's object id, a GUID.`);
    const key = room.presenceUserId.toLowerCase();
    if (seen.has(key)) throw new Error(`Room ${room.id}: presenceUserId is already used by another room.`);
    seen.add(key);
    result.rooms[room.id] = room.presenceUserId;
  }
  if (!Object.keys(result.rooms).length) throw new Error('WALK_IN_ENABLED is on but no room has a presenceUserId in rooms.json.');
  return result;
}
// Door intercom, noise meter and location report (INSTALL-UBUNTU.md 12f). A noise setting mistake turns the meter off.
function loadIntercom(env) {
  return { enabled: booleanValue(env.INTERCOM_ENABLED, true), ringSeconds: integerValue(env.INTERCOM_RING_SECONDS, 45, 10, 120), maxMinutes: integerValue(env.INTERCOM_MAX_MINUTES, 10, 1, 60) };
}
function loadNoise(env) {
  const enabled = booleanValue(env.NOISE_METER, true);
  const talkingDb = floatValue(env.NOISE_TALKING_DB, -50, -120, 0);
  const loudDb = floatValue(env.NOISE_LOUD_DB, -35, -120, 0);
  if (talkingDb >= loudDb) return { enabled: false, talkingDb, loudDb, problem: `NOISE_TALKING_DB (${talkingDb}) must be lower than NOISE_LOUD_DB (${loudDb}).` };
  return { enabled, talkingDb, loudDb };
}
function loadSecretExpiry(env, name = 'CLIENT_SECRET_EXPIRES') {
  const value = String(env[name] || '').trim();
  if (!value) return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!date || date.toISOString().slice(0, 10) !== value) throw new Error(`${name} must be a real date written as YYYY-MM-DD, for example 2027-05-04.`);
  return value;
}

function loadTeamsAlerts(env, tenantId) {
  const appId = String(env.TEAMS_BOT_APP_ID || '').trim();
  const appSecret = String(env.TEAMS_BOT_APP_SECRET || '').trim();
  const emails = String(env.TEAMS_ALERT_EMAILS || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
  const botTenant = String(env.TEAMS_BOT_TENANT_ID || '').trim() || tenantId;
  const serviceUrl = String(env.TEAMS_BOT_SERVICE_URL || '').trim() || 'https://smba.trafficmanager.net/teams/';
  const catalogId = String(env.TEAMS_BOT_CATALOG_ID || '').trim();
  if (!appId && !appSecret && !emails.length) return { enabled: false, appId: '', appSecret: '', tenantId: botTenant, recipients: [], serviceUrl, catalogId };
  if (!appId || !appSecret || !emails.length) throw new Error('Teams alerts need TEAMS_BOT_APP_ID, TEAMS_BOT_APP_SECRET and TEAMS_ALERT_EMAILS together (or none of them).');
  if (!GUID.test(appId)) throw new Error('TEAMS_BOT_APP_ID must be the bot\'s application (client) ID, a GUID.');
  if (!GUID.test(botTenant)) throw new Error('Teams alerts need a tenant ID: set TEAMS_BOT_TENANT_ID (or TENANT_ID) to the directory (tenant) ID, a GUID.');
  if (catalogId && !GUID.test(catalogId)) throw new Error('TEAMS_BOT_CATALOG_ID must be a GUID.');
  for (const email of emails) if (!EMAIL.test(email)) throw new Error(`TEAMS_ALERT_EMAILS has an invalid address: ${email}`);
  if (emails.length > 10) throw new Error('TEAMS_ALERT_EMAILS can list at most 10 people.');
  if (!/^https:\/\//i.test(serviceUrl)) throw new Error('TEAMS_BOT_SERVICE_URL must start with https://');
  return { enabled: true, appId, appSecret, tenantId: botTenant, recipients: [...new Set(emails)], serviceUrl, catalogId };
}

// Optional "Sign in with Microsoft" for the dashboard (see dashboard-signin.js). Off unless the client ID and secret are set.
// Who may sign in: DASHBOARD_ADMIN_EMAILS, or by default the people who get the Teams alerts.
function loadDashboardSignIn(env, tenantId, teamsRecipients, publicBaseUrl) {
  const clientId = String(env.DASHBOARD_SIGNIN_CLIENT_ID || '').trim();
  let clientSecret = String(env.DASHBOARD_SIGNIN_CLIENT_SECRET || '').trim();
  if (!clientId && !clientSecret) return { enabled: false };
  // Sign-in can use the room display's own app registration (CLIENT_ID): then its CLIENT_SECRET is used too, so there is
  // only one secret to keep up to date.
  const sameApp = Boolean(clientId) && clientId.toLowerCase() === String(env.CLIENT_ID || '').trim().toLowerCase();
  if (!clientSecret && sameApp) clientSecret = String(env.CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('Dashboard sign-in needs DASHBOARD_SIGNIN_CLIENT_ID and DASHBOARD_SIGNIN_CLIENT_SECRET together (or neither). When DASHBOARD_SIGNIN_CLIENT_ID is the room display\'s own CLIENT_ID, CLIENT_SECRET is used and no separate secret is needed.');
  if (!GUID.test(clientId)) throw new Error('DASHBOARD_SIGNIN_CLIENT_ID must be the sign-in app registration\'s application (client) ID, a GUID.');
  const signInTenant = String(env.DASHBOARD_SIGNIN_TENANT_ID || '').trim() || tenantId;
  if (!GUID.test(signInTenant)) throw new Error('Dashboard sign-in needs the directory (tenant) ID as a GUID: set DASHBOARD_SIGNIN_TENANT_ID or TENANT_ID.');
  const redirectUri = String(env.DASHBOARD_SIGNIN_REDIRECT_URI || '').trim() || (publicBaseUrl ? `${publicBaseUrl}/auth/callback` : '');
  let url;
  try { url = new URL(redirectUri); } catch { throw new Error('Dashboard sign-in needs DASHBOARD_SIGNIN_REDIRECT_URI (or PUBLIC_BASE_URL), for example https://rooms.example.com/auth/callback.'); }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('DASHBOARD_SIGNIN_REDIRECT_URI must use https:// (Microsoft only allows plain http:// for localhost).');
  if (url.pathname !== '/auth/callback' || url.search || url.hash) throw new Error('DASHBOARD_SIGNIN_REDIRECT_URI must end in /auth/callback, for example https://rooms.example.com/auth/callback.');
  const listed = String(env.DASHBOARD_ADMIN_EMAILS || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
  const allowedEmails = [...new Set(listed.length ? listed : teamsRecipients)];
  if (!allowedEmails.length) throw new Error('Dashboard sign-in needs someone who may sign in: set DASHBOARD_ADMIN_EMAILS (or TEAMS_ALERT_EMAILS).');
  for (const email of allowedEmails) if (!EMAIL.test(email)) throw new Error(`DASHBOARD_ADMIN_EMAILS has an invalid address: ${email}`);
  if (allowedEmails.length > 50) throw new Error('DASHBOARD_ADMIN_EMAILS can list at most 50 people.');
  return { enabled: true, clientId, clientSecret, sameApp, tenantId: signInTenant, redirectUri: url.href, allowedEmails, allowedFrom: listed.length ? 'DASHBOARD_ADMIN_EMAILS' : 'TEAMS_ALERT_EMAILS', sessionHours: integerValue(env.DASHBOARD_SESSION_HOURS, 8, 1, 24) };
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
    // The server checks each room calendar this often and pushes changes to the tablets at once.
    // 0 turns it off (tablets then refresh on their own timer only).
    changeCheckSeconds: /^(off|false|no)$/i.test(String(env.CHANGE_CHECK_SECONDS || '')) ? 0 : (String(env.CHANGE_CHECK_SECONDS ?? '').trim() === '0' ? 0 : integerValue(env.CHANGE_CHECK_SECONDS, 15, 5, 3600)),
    // Optional shared secret that Microsoft change notifications must carry (see /api/notifications).
    graphClientState: String(env.GRAPH_CLIENT_STATE || '').trim(),
    // Tablet offline alerts: a tablet that has not checked in for this long (during office hours) raises an alert.
    // ALERT_WEBHOOK_URL is optional (Teams, Slack or similar incoming webhook); alerts always show on the dashboard.
    alertAfterMinutes: integerValue(env.ALERT_AFTER_MINUTES, 10, 1, 1440),
    alertWebhookUrl: String(env.ALERT_WEBHOOK_URL || '').trim(),
    clientSecretExpires: loadSecretExpiry(env),
    // The dashboard's HTTPS certificate (PEM file readable by the service), checked for renewals that stopped working,
    // and the day the login that renews it expires (for example the Azure DNS login used by acme.sh). Empty = off.
    httpsCertFile: String(env.HTTPS_CERT_FILE || '').trim(),
    certRenewalSecretExpires: loadSecretExpiry(env, 'CERT_RENEWAL_SECRET_EXPIRES'),
    // Alerts from a named Teams bot to specific people (see INSTALL-UBUNTU.md, "Teams alerts").
    teamsAlerts: null,   // filled below, once the tenant ID is known
    // Outside these hours the display shows "Closed" instead of "Available". null turns it off.
    officeHours: loadOfficeHours(env),
    birthdays: {
      mailbox: String(env.BIRTHDAY_CALENDAR_MAILBOX || '').trim(),
      calendarId: String(env.BIRTHDAY_CALENDAR_ID || '').trim(),
      calendarName: String(env.BIRTHDAY_CALENDAR_NAME || '').trim(),
      nameStyle: /^full$/i.test(String(env.BIRTHDAY_NAME_STYLE || '')) ? 'full' : 'first',
      timeZone: ''   // filled below from the first room unless BIRTHDAY_TIME_ZONE is set
    },
    weather: {
      enabled: booleanValue(env.WEATHER_ENABLED, true),
      // Official National Weather Service warnings (US only): a banner on the tablets and a Teams alert for serious ones.
      alerts: booleanValue(env.WEATHER_ALERTS, true),
      // Defaults to Glen Rock, NJ.
      latitude: floatValue(env.WEATHER_LATITUDE, 40.9595, -90, 90),
      longitude: floatValue(env.WEATHER_LONGITUDE, -74.1252, -180, 180),
      // auto: the US National Weather Service (real airport observations) inside the US, Open-Meteo elsewhere or as backup.
      source: ['auto', 'nws', 'open-meteo'].includes(String(env.WEATHER_SOURCE || '').toLowerCase()) ? String(env.WEATHER_SOURCE).toLowerCase() : 'auto',
      // NWS asks API users to identify themselves, for example an IT email address. Optional.
      contact: String(env.WEATHER_CONTACT || '').trim().slice(0, 100)
    },
    rooms: loadRooms(env, cwd)
  };
  config.teamsAlerts = loadTeamsAlerts(env, config.tenantId);
  // Like sign-in, a camera settings mistake turns the camera off (and is logged); the door screens keep working.
  try { config.camera = loadCamera(env, config.rooms); }
  catch (error) { config.camera = { enabled: false, hosts: {}, password: '', port: 2323, problem: error.message }; }
  try { config.walkIn = loadWalkIn(env, config.rooms, demoMode); }
  catch (error) { config.walkIn = { enabled: false, maxMinutes: 240, outsideHours: false, checkSeconds: 30, rooms: {}, problem: error.message }; }
  // DEMO_MEETINGS=off removes the demo calendars' sample meetings (used by tests).
  config.demoMeetings = !/^(off|false|0|no)$/i.test(String(env.DEMO_MEETINGS || ''));
  config.intercom = loadIntercom(env);
  config.noise = loadNoise(env);
  config.location = { enabled: booleanValue(env.LOCATION_REPORT, true) };
  // A mistake in the sign-in settings turns Microsoft sign-in off (the administrator token still works) and is logged;
  // it never stops the app, so the door screens keep working.
  try { config.dashboardSignIn = loadDashboardSignIn(env, config.tenantId, config.teamsAlerts.recipients, config.publicBaseUrl); }
  catch (error) { config.dashboardSignIn = { enabled: false, problem: error.message }; }
  if (config.alertWebhookUrl && !/^https:\/\//i.test(config.alertWebhookUrl)) throw new Error('ALERT_WEBHOOK_URL must start with https://');
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
