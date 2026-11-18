// Per-room feature switches. A switch is an override an administrator sets in the dashboard; it is saved in
// <dataDir>/room-switches.json and wins over the configured value (.env / rooms.json). No override = the configured value,
// so a server with no file behaves exactly as before. .env and rooms.json are never written. No dataDir = memory only (tests).
import fs from 'node:fs';
import path from 'node:path';

export const CAMERA_MODES = ['off', 'ondemand', 'always'];
const SERVER_ONLY = ' This does not save tablet battery; it only runs on the server.';

export const DEFINITIONS = [
  { key: 'noise', label: 'Noise meter', kind: 'tablet', savesBattery: 'yes', what: 'The tablet listens through its microphone and shows how loud the room is (quiet, talking, loud). Nothing is recorded.', offCost: 'The dashboard shows no noise level for this room and the tablet stops using the microphone.' },
  { key: 'intercom', label: 'Door intercom', kind: 'tablet', savesBattery: 'no', what: 'A visitor can press Call on the door screen and an administrator answers from the dashboard.', offCost: 'The Call button disappears from the door screen. A call that is already going on is not cut off.' },
  { key: 'location', label: 'Location', kind: 'tablet', savesBattery: 'yes', what: 'The tablet reports where it is, so you can see it has not been moved or taken.', offCost: 'The tablet stops using GPS and the dashboard shows no position for it.' },
  { key: 'camera', label: 'Door camera', kind: 'fully', savesBattery: 'yes', what: 'Lets an administrator take a photo or watch live from the tablet camera. The picture is never stored.', offCost: 'Off: Take photo and Live camera are unavailable. On request: they start with a wait of about 8 seconds while the camera wakes up.' },
  { key: 'weather', label: 'Weather', kind: 'tablet', savesBattery: 'little', what: 'The door screen shows the weather line and the mood of the picture follows the weather.', offCost: 'The weather line and the weather mood are hidden. Official weather warnings still show.' },
  { key: 'snoopy', label: 'Snoopy', kind: 'tablet', savesBattery: 'no', what: 'The Snoopy picture and his outfits on the door screen.', offCost: 'The door screen shows no Snoopy picture. Outfit pushes and schedules are kept.' },
  { key: 'snoopyMotion', label: 'Snoopy animation', kind: 'tablet', savesBattery: 'yes', what: 'Snoopy moves, blinks and sleeps on the screen.', offCost: 'Snoopy stays a still picture.' },
  { key: 'quickBooking', label: 'Quick booking', kind: 'server', savesBattery: 'no', what: 'People can book the room for 15, 30 or 60 minutes from the door screen.' + SERVER_ONLY, offCost: 'The quick-book buttons disappear and the server refuses bookings from the door screen.' },
  { key: 'celebrations', label: 'Birthdays and anniversaries', kind: 'server', savesBattery: 'no', what: 'The door screen shows today\'s birthdays and work anniversaries.' + SERVER_ONLY, offCost: 'No birthday or anniversary is shown in this room. Company holidays still show.' },
  { key: 'walkIn', label: 'Walk-in Teams calls', kind: 'server', savesBattery: 'no', what: 'When the room\'s Teams device is in a call and nobody booked the room, the door shows In use and the room is booked for the call.' + SERVER_ONLY, offCost: 'Calls nobody booked do not show on the door and do not book the room. An existing automatic booking ends within its 15 minute slice.' }
];
const KEYS = new Set(DEFINITIONS.map(d => d.key));
const BY_KEY = new Map(DEFINITIONS.map(d => [d.key, d]));
const validValue = (key, value) => key === 'camera' ? CAMERA_MODES.includes(value) : typeof value === 'boolean';
const isOffValue = value => value === false || value === 'off';

function problem(message, status) { return Object.assign(new Error(message), { status }); }

export class RoomSwitches {
  constructor({ config, dataDir, logger = {} }) {
    this.config = config;
    this.logger = logger;
    this.file = dataDir ? path.join(dataDir, 'room-switches.json') : null;
    this.rooms = new Map();   // roomId -> Map(key -> { value, by, at })
    this.load();
  }
  roomOf(roomId) { return (this.config.rooms || []).find(room => room.id === roomId); }
  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [roomId, entries] of Object.entries(data?.rooms && typeof data.rooms === 'object' ? data.rooms : {})) {
        if (!this.roomOf(roomId) || !entries || typeof entries !== 'object') { this.logger.error?.(`room-switches.json: ignored the unknown room "${String(roomId).slice(0, 40)}".`); continue; }
        for (const [key, entry] of Object.entries(entries)) {
          if (!KEYS.has(key) || !entry || !validValue(key, entry.value)) { this.logger.error?.(`room-switches.json: ignored an unknown or invalid switch "${String(key).slice(0, 40)}" for ${roomId}.`); continue; }
          if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Map());
          this.rooms.get(roomId).set(key, { value: entry.value, by: String(entry.by || '').slice(0, 200), at: String(entry.at || '').slice(0, 40) });
        }
      }
    } catch (error) { this.logger.error?.(`Could not read room-switches.json, starting with no switch changes: ${error.message}`); this.rooms = new Map(); }
  }
  save() {
    if (!this.file) return;
    const rooms = {};
    for (const [roomId, entries] of this.rooms) if (entries.size) rooms[roomId] = Object.fromEntries(entries);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), rooms }, null, 1));
      fs.renameSync(`${this.file}.tmp`, this.file);                       // all or nothing, never a half-written file
    } catch (error) { this.logger.error?.(`Could not save the room switches: ${error.message}`); }
  }
  configured(roomId, key) {
    const c = this.config, room = this.roomOf(roomId);
    switch (key) {
      case 'noise': return Boolean(c.noise?.enabled);
      case 'intercom': return Boolean(c.intercom?.enabled);
      case 'location': return Boolean(c.location?.enabled);
      case 'weather': return c.weather?.enabled !== false;
      case 'quickBooking': return Boolean(room?.allowQuickBooking);
      case 'celebrations': return room ? room.showCelebrations !== false : false;
      case 'walkIn': return Boolean(c.walkIn?.enabled && Object.prototype.hasOwnProperty.call(c.walkIn.rooms || {}, roomId));
      case 'camera': return 'unmanaged';
      default: return true;   // snoopy, snoopyMotion
    }
  }
  // Whether the feature can work at all in this room. A switch can only be turned ON where this is ok.
  capability(roomId, key) {
    const c = this.config;
    switch (key) {
      case 'noise': return c.noise?.problem ? { ok: false, reason: `The noise meter has a settings problem: ${c.noise.problem}` } : { ok: true, reason: '' };
      case 'camera': return c.camera?.enabled && c.camera.hosts?.[roomId] ? { ok: true, reason: '' } : { ok: false, reason: 'No camera is set up for this room. Set FULLY_CAMERA_HOSTS and FULLY_REMOTE_PASSWORD in .env.' };
      case 'walkIn':
        if (!c.walkIn?.enabled) return { ok: false, reason: 'Walk-in calls are not set up. Set WALK_IN_ENABLED=true in .env.' };
        if (!Object.prototype.hasOwnProperty.call(c.walkIn.rooms || {}, roomId)) return { ok: false, reason: 'This room has no presenceUserId in rooms.json, so its Teams calls cannot be read.' };
        return { ok: true, reason: '' };
      case 'weather': return c.weather?.enabled === false ? { ok: false, reason: 'Weather is turned off for the whole server (WEATHER_ENABLED=false in .env).' } : { ok: true, reason: '' };
      default: return { ok: true, reason: '' };
    }
  }
  override(roomId, key) { return this.rooms.get(roomId)?.get(key) || null; }
  effective(roomId, key) {
    const entry = this.override(roomId, key);
    if (entry && (isOffValue(entry.value) || this.capability(roomId, key).ok)) return entry.value;
    return this.configured(roomId, key);
  }
  anyOn(key) { return (this.config.rooms || []).some(room => { const value = this.effective(room.id, key); return value === true || (key === 'camera' && value !== 'off' && value !== 'unmanaged'); }); }
  set(roomId, key, value, who = '') {
    if (!this.roomOf(roomId)) throw problem('Unknown room.', 404);
    if (!KEYS.has(key)) throw problem('Unknown switch.', 400);
    if (value !== null && !validValue(key, value)) throw problem(key === 'camera' ? 'The door camera value must be "off", "ondemand", "always" or null.' : 'The value must be true, false or null.', 400);
    if (value !== null && !isOffValue(value)) { const cap = this.capability(roomId, key); if (!cap.ok) throw problem(cap.reason, 409); }
    const before = this.effective(roomId, key);
    const entries = this.rooms.get(roomId) || new Map();
    if (value === null) entries.delete(key); else entries.set(key, { value, by: String(who || ''), at: new Date().toISOString() });
    if (entries.size) this.rooms.set(roomId, entries); else this.rooms.delete(roomId);
    this.save();
    const after = this.effective(roomId, key);
    return { changed: before !== after, before, after };
  }
  clearAll(roomId) {
    if (!this.roomOf(roomId)) throw problem('Unknown room.', 404);
    const before = Object.fromEntries(DEFINITIONS.map(d => [d.key, this.effective(roomId, d.key)]));
    this.rooms.delete(roomId);
    this.save();
    const changedKeys = DEFINITIONS.filter(d => this.effective(roomId, d.key) !== before[d.key]).map(d => d.key);
    return { changed: changedKeys.length > 0, changedKeys };
  }
  preset(roomId, name, who = '') {
    if (!this.roomOf(roomId)) throw problem('Unknown room.', 404);
    if (name === 'normal') return this.clearAll(roomId, who);
    if (name !== 'battery-saver') throw problem('Unknown preset. Use "battery-saver" or "normal".', 400);
    const before = Object.fromEntries(DEFINITIONS.map(d => [d.key, this.effective(roomId, d.key)]));
    const entries = this.rooms.get(roomId) || new Map(), at = new Date().toISOString();
    const put = (key, value) => entries.set(key, { value, by: String(who || ''), at });
    put('noise', false); put('location', false); put('snoopyMotion', false);
    if (this.capability(roomId, 'camera').ok) put('camera', 'ondemand');
    this.rooms.set(roomId, entries);
    this.save();
    const changedKeys = DEFINITIONS.filter(d => this.effective(roomId, d.key) !== before[d.key]).map(d => d.key);
    return { changed: changedKeys.length > 0, changedKeys };
  }
  describe(roomId) {
    return DEFINITIONS.map(def => {
      const entry = this.override(roomId, def.key), cap = this.capability(roomId, def.key);
      return { key: def.key, label: def.label, kind: def.kind, savesBattery: def.savesBattery, what: def.what, offCost: def.offCost, effective: this.effective(roomId, def.key), configured: this.configured(roomId, def.key), override: entry ? entry.value : null, by: entry?.by || '', at: entry?.at || '', available: cap.ok, unavailableReason: cap.reason };
    });
  }
}
export const switchLabel = key => BY_KEY.get(key)?.label || key;
