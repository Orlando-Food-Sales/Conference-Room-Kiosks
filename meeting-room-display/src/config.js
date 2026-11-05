import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(file = path.resolve('.env')) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig() {
  loadDotEnv();
  const demoMode = bool('DEMO_MODE', false);
  const config = {
    port: Number(process.env.PORT || 3000),
    demoMode,
    roomName: process.env.ROOM_NAME || 'Meeting Room',
    roomEmail: process.env.ROOM_EMAIL || '',
    displayTimeZone: process.env.DISPLAY_TIME_ZONE || 'UTC',
    tenantId: process.env.TENANT_ID || '',
    clientId: process.env.CLIENT_ID || '',
    clientSecret: process.env.CLIENT_SECRET || '',
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    allowQuickBooking: bool('ALLOW_QUICK_BOOKING', false),
    graphClientState: process.env.GRAPH_CLIENT_STATE || '',
  };

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.displayTimeZone }).format();
  } catch {
    throw new Error('DISPLAY_TIME_ZONE must be a valid IANA time zone.');
  }
  if (!demoMode) {
    const required = ['roomEmail', 'tenantId', 'clientId', 'clientSecret'];
    const missing = required.filter((key) => !config[key]);
    if (missing.length) throw new Error(`Missing production configuration: ${missing.join(', ')}`);
  }
  if (config.publicBaseUrl && !config.publicBaseUrl.startsWith('https://')) {
    throw new Error('PUBLIC_BASE_URL must use HTTPS.');
  }
  if (config.publicBaseUrl && config.graphClientState.length < 32) {
    throw new Error('GRAPH_CLIENT_STATE must be at least 32 characters when webhooks are enabled.');
  }
  return Object.freeze(config);
}
