// Dashboard control over the birthdays and work anniversaries that the door screens show.
// Lists everyone found in the shared calendar, hides people from the door screens (kept in <dataDir>/celebration-hidden.json),
// adds people (a yearly all-day event in the format the displays already read) and removes a whole yearly series.
// The app only ever deletes an event it can clearly recognise as its own work anniversary.
import fs from 'node:fs';
import path from 'node:path';
import { parseCelebration } from './celebrations.js';
import { call, graphError } from './graph-calendar.js';
const NAME_PATTERN = /^[\p{L}][\p{L} .'\u2019-]*$/u;
const OWN_ANNIVERSARY = /^([\p{L}][\p{L} .'\u2019-]{1,59}) - Work Anniversary \(since ((?:19|20)\d\d)\)$/u;
const KEYWORD = /anniversar|anniv\b|birthday|\bb['\u2019]?-?day\b/i;
const FIELDS = 'id,subject,start,end,isAllDay,isCancelled,type,recurrence';
export const anniversarySubject = (name, year) => `${name} - Work Anniversary (since ${year})`;
export const birthdaySubject = name => `${name} - Birthday`;
export const hideKey = (kind, name) => `${kind}:${String(name).replace(/\s+/g, ' ').trim().toLowerCase()}`;
const pad = n => String(n).padStart(2, '0');
function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayNumber = key => Math.round(Date.parse(`${key}T12:00:00Z`) / 86400000);
function validDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
// The next time a yearly month/day comes round, counting today. Feb 29 waits for the next leap year.
export function nextOccurrence(month, day, todayKey) {
  const year = Number(todayKey.slice(0, 4));
  for (let y = year; y <= year + 8; y += 1) {
    if (!validDate(y, month, day)) continue;
    const date = `${y}-${pad(month)}-${pad(day)}`;
    if (date >= todayKey) return { date, daysUntil: dayNumber(date) - dayNumber(todayKey) };
  }
  return null;
}
const yearlyOf = event => {
  const p = event.recurrence?.pattern;
  return p && p.type === 'absoluteYearly' && Number(p.interval || 1) === 1 && p.month >= 1 && p.month <= 12 && p.dayOfMonth >= 1 && p.dayOfMonth <= 31 ? { month: Number(p.month), day: Number(p.dayOfMonth) } : null;
};
// True only for what this app creates: an all-day yearly series titled exactly "<Name> - Work Anniversary (since YYYY)".
export function isOwnAnniversary(event) {
  if (!event || event.type !== 'seriesMaster' || !event.isAllDay || event.isCancelled || !yearlyOf(event)) return false;
  const m = String(event.subject || '').match(OWN_ANNIVERSARY);
  if (!m) return false;
  const read = parseCelebration(event.subject, 'full', '');
  return Boolean(read && read.kind === 'anniversary' && read.name === m[1]);
}
const DEMO_PEOPLE = [
  ['birthday', 'Maria Santos', 3], ['anniversary', 'Fred Mortati', 9, 1988], ['birthday', 'Jordan Lee', 20], ['anniversary', 'Jodi Andrade', 41, 2025],
  ['anniversary', 'Sam Okafor', 75, 2019], ['birthday', 'Priya Nair', 120], ['anniversary', 'Hermes Jimenez Jr', 200, 2026], ['birthday', 'Carla Reyes', 310]
];
export class CelebrationAdmin {
  constructor(config, tokenProvider, fetchImpl = fetch, { dataDir = '', logger = console, onHiddenChange = null } = {}) {
    this.config = config;
    this.tokens = tokenProvider;
    this.fetch = fetchImpl;
    this.logger = logger;
    this.onHiddenChange = onHiddenChange;
    this.hiddenKeys = new Set();
    this.file = dataDir ? path.join(dataDir, 'celebration-hidden.json') : null;
    this.demo = [];
    this.nextDemoId = 1;
    this.loadHidden();
    if (config.demoMode) this.seedDemo();
  }
  get zone() { return this.config.birthdays?.timeZone || this.config.rooms?.[0]?.timeZone || 'America/New_York'; }
  get demoMode() { return Boolean(this.config.demoMode); }
  get enabled() { return this.demoMode || Boolean(this.config.birthdays?.mailbox && this.tokens); }
  error(status, message) { return Object.assign(new Error(message), { status, friendly: true }); }
  loadHidden() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')).hidden;
      for (const key of Array.isArray(saved) ? saved : []) if (typeof key === 'string' && /^(birthday|anniversary):/.test(key)) this.hiddenKeys.add(key.slice(0, 120));
    } catch (error) { this.logger.error?.(`Could not read the saved hidden birthdays and anniversaries (starting with none hidden): ${error.message}`); }
  }
  saveHidden() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ savedAt: new Date().toISOString(), hidden: [...this.hiddenKeys].sort() }, null, 1));
      fs.renameSync(`${this.file}.tmp`, this.file);                      // all or nothing, never a half-written file
    } catch (error) { this.logger.error?.(`Could not save the hidden birthdays and anniversaries: ${error.message}`); }
  }
  seedDemo() {
    const today = todayIn(this.zone);
    for (const [kind, name, ahead, since] of DEMO_PEOPLE) {
      const date = addDays(today, ahead);
      this.demo.push({ id: `demo-${this.nextDemoId++}`, kind, name, since: since || null, month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) });
    }
  }
  // ---- Microsoft Graph ----
  get base() { return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.birthdays.mailbox)}`; }
  async graph(method, url, body) {
    const headers = { authorization: `Bearer ${await this.tokens.getToken()}`, accept: 'application/json', prefer: `outlook.timezone="${this.config.birthdays.timeZone}"` };
    if (body) headers['content-type'] = 'application/json';
    const response = await call(this.fetch, url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw graphError(response, json);
    return json;
  }
  // The calendars the door screens read (same choice as CelebrationService.calendarIds), with whether the app may change them.
  async calendars() {
    const b = this.config.birthdays;
    if (b.calendarId) {
      const one = await this.graph('GET', `${this.base}/calendars/${encodeURIComponent(b.calendarId)}?$select=id,name,canEdit`);
      return [{ id: b.calendarId, name: String(one.name || ''), canEdit: one.canEdit === true }];
    }
    const list = (await this.graph('GET', `${this.base}/calendars?$select=id,name,canEdit&$top=50`)).value || [];
    const wanted = String(b.calendarName || '').toLowerCase();
    const picked = wanted ? list.filter(c => String(c.name || '').toLowerCase().includes(wanted)) : list;
    return picked.slice(0, 10).map(c => ({ id: c.id, name: String(c.name || ''), canEdit: c.canEdit === true }));
  }
  writeCalendar(calendars) {
    const b = this.config.birthdays;
    if (b.calendarId) return calendars[0] || null;
    const wanted = String(b.calendarName || '').toLowerCase();
    const exact = wanted ? calendars.filter(c => c.name.toLowerCase() === wanted) : [];
    if (exact.length === 1) return exact[0];
    return calendars.length === 1 ? calendars[0] : null;
  }
  async readEvents(calendar) {
    const params = new URLSearchParams({ '$select': FIELDS, '$top': '100' });
    const out = [];
    let next = `${this.base}/calendars/${encodeURIComponent(calendar.id)}/events?${params}`;
    for (let page = 0; next && page < 10; page += 1) {
      const body = await this.graph('GET', next);
      out.push(...(body.value || []));
      next = body['@odata.nextLink'] || '';
    }
    return out;
  }
  person(row, today, calendar) {
    const next = nextOccurrence(row.month, row.day, today);
    if (!next) return null;
    const years = row.kind === 'anniversary' && row.since ? Number(next.date.slice(0, 4)) - row.since : null;
    return {
      id: row.id, calendarId: calendar.id, calendarName: calendar.name, kind: row.kind, name: row.name, since: row.since || null, month: row.month, day: row.day,
      nextDate: next.date, daysUntil: next.daysUntil, upcomingYears: years >= 1 ? years : null, hidden: this.hiddenKeys.has(hideKey(row.kind, row.name)),
      canDelete: Boolean(row.own), calendarCanEdit: calendar.canEdit !== false
    };
  }
  async list(now = new Date()) {
    const b = this.config.birthdays;
    const today = todayIn(this.zone, now);
    if (this.demoMode) {
      const calendar = { id: 'demo', name: 'Calendar (demo)', canEdit: true };
      const people = this.demo.map(row => this.person({ ...row, own: row.kind === 'anniversary' }, today, calendar)).filter(Boolean).sort(bySoonest);
      return { enabled: true, demo: true, mailbox: 'demo@example.com', calendars: [calendar], people, skipped: 0, writeCalendar: { name: calendar.name, canEdit: true }, message: '' };
    }
    if (!this.enabled) return { enabled: false, demo: false, mailbox: '', calendars: [], people: [], skipped: 0, writeCalendar: null, message: 'Birthdays and anniversaries are not set up. Set BIRTHDAY_CALENDAR_MAILBOX in the settings file to the shared calendar mailbox.' };
    const calendars = await this.calendars();
    const people = [];
    let skipped = 0;
    for (const calendar of calendars) {
      for (const event of await this.readEvents(calendar)) {
        if (event.isCancelled) continue;
        const entry = parseCelebration(event.subject, 'full', '');
        if (!entry) { if (KEYWORD.test(String(event.subject || ''))) skipped += 1; continue; }
        const yearly = event.type === 'seriesMaster' ? yearlyOf(event) : null;
        let month, day;
        if (yearly) ({ month, day } = yearly);
        else if (event.type === 'singleInstance' && event.isAllDay && String(event.start?.dateTime || '').slice(0, 10) >= today) { month = Number(event.start.dateTime.slice(5, 7)); day = Number(event.start.dateTime.slice(8, 10)); }
        else { skipped += 1; continue; }
        const own = isOwnAnniversary(event);
        const sinceText = String(event.subject).match(/\bsince\s*((?:19|20)\d\d)\b/i);
        const since = entry.kind === 'anniversary' ? (sinceText ? Number(sinceText[1]) : null) : null;
        const row = this.person({ id: event.id, kind: entry.kind, name: entry.name, since, month, day, own }, today, calendar);
        if (row) people.push(row); else skipped += 1;
      }
    }
    const write = this.writeCalendar(calendars);
    return { enabled: true, demo: false, mailbox: b.mailbox, calendars, people: people.sort(bySoonest), skipped, writeCalendar: write ? { name: write.name, canEdit: write.canEdit } : null, message: '' };
  }
  async setHidden({ kind, name, hidden }, now = new Date()) {
    if (!['birthday', 'anniversary'].includes(kind)) throw this.error(400, 'Pick birthday or anniversary.');
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    if (!clean) throw this.error(400, 'Give the name of the person.');
    const key = hideKey(kind, clean);
    if (hidden !== false && !(await this.list(now)).people.some(p => hideKey(p.kind, p.name) === key)) throw this.error(404, 'That person is not in the list any more. Refresh the list.');
    if (hidden === false) this.hiddenKeys.delete(key); else this.hiddenKeys.add(key);
    this.saveHidden();
    this.onHiddenChange?.(this.hiddenKeys);
    return { kind, name: clean };
  }
  // Checks a new entry before anything is written; returns what to create.
  checkNew({ kind, name, month, day, since }, today) {
    if (!['birthday', 'anniversary'].includes(kind)) throw this.error(400, 'Pick birthday or anniversary.');
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    if (clean.length < 2 || clean.length > 60 || !NAME_PATTERN.test(clean)) throw this.error(400, 'Use the person\u2019s name: 2 to 60 letters, spaces, dots or apostrophes.');
    const m = Number(month), d = Number(day);
    if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) throw this.error(400, 'Pick a real month and day.');
    if (m === 2 && d === 29) throw this.error(400, 'February 29 is not supported. Use February 28 or March 1.');
    if (!validDate(2025, m, d)) throw this.error(400, 'That day does not exist in that month.');
    const thisYear = Number(today.slice(0, 4));
    let year = thisYear;
    if (kind === 'anniversary') {
      year = Number(since);
      if (!Number.isInteger(year) || year < 1950 || year > thisYear) throw this.error(400, `Give the year the person started, between 1950 and ${thisYear}.`);
    }
    const subject = kind === 'anniversary' ? anniversarySubject(clean, year) : birthdaySubject(clean);
    const read = parseCelebration(subject, 'full', `${thisYear}-01-01`);
    if (!read || read.kind !== kind || read.name !== clean) throw this.error(400, 'The door screens could not read that name back correctly (hyphens, digits and words such as birthday or work are not allowed). Use the plain name.');
    return { kind, name: clean, subject, month: m, day: d, year };
  }
  async add(input, now = new Date()) {
    const today = todayIn(this.zone, now);
    const item = this.checkNew(input, today);
    const listing = await this.list(now);
    if (!listing.enabled) throw this.error(409, listing.message);
    if (listing.people.some(p => hideKey(p.kind, p.name) === hideKey(item.kind, item.name))) throw this.error(409, `${item.name} is already on the ${item.kind === 'anniversary' ? 'work anniversary' : 'birthday'} list.`);
    if (this.demoMode) {
      const row = { id: `demo-${this.nextDemoId++}`, kind: item.kind, name: item.name, since: item.kind === 'anniversary' ? item.year : null, month: item.month, day: item.day };
      this.demo.push(row);
      return { calendarName: 'Calendar (demo)', person: this.person({ ...row, own: row.kind === 'anniversary' }, today, { id: 'demo', name: 'Calendar (demo)', canEdit: true }) };
    }
    if (!listing.writeCalendar) throw this.error(409, 'Several calendars match, so the app cannot tell where to add this. Set BIRTHDAY_CALENDAR_ID to the right calendar.');
    if (!listing.writeCalendar.canEdit) throw this.error(409, READ_ONLY);
    const target = listing.calendars.find(c => c.name === listing.writeCalendar.name) || listing.calendars[0];
    const tz = this.config.birthdays.timeZone;
    const start = `${item.year}-${pad(item.month)}-${pad(item.day)}`;
    const created = await this.graph('POST', `${this.base}/calendars/${encodeURIComponent(target.id)}/events`, {
      subject: item.subject, isAllDay: true, showAs: 'free', isReminderOn: false,
      start: { dateTime: `${start}T00:00:00`, timeZone: tz }, end: { dateTime: `${addDays(start, 1)}T00:00:00`, timeZone: tz },
      recurrence: { pattern: { type: 'absoluteYearly', interval: 1, month: item.month, dayOfMonth: item.day }, range: { type: 'noEnd', startDate: start } }
    });
    return { calendarName: target.name, person: this.person({ id: created.id || '', kind: item.kind, name: item.name, since: item.kind === 'anniversary' ? item.year : null, month: item.month, day: item.day, own: item.kind === 'anniversary' }, today, target) };
  }
  async remove({ id, calendarId }, now = new Date()) {
    id = String(id || ''); calendarId = String(calendarId || '');
    if (!id || !calendarId) throw this.error(400, 'Say which entry to remove.');
    if (this.demoMode) {
      const row = this.demo.find(r => r.id === id);
      if (!row) throw this.error(404, 'That entry is not in the list any more. Refresh the list.');
      if (row.kind !== 'anniversary') throw this.error(409, NOT_OWN);
      this.demo.splice(this.demo.indexOf(row), 1);
      this.forget(row);
      return { kind: row.kind, name: row.name, since: row.since, calendarName: 'Calendar (demo)' };
    }
    if (!this.enabled) throw this.error(409, 'Birthdays and anniversaries are not set up.');
    const calendar = (await this.calendars()).find(c => c.id === calendarId);
    if (!calendar) throw this.error(404, 'That calendar is not one the door screens read. Refresh the list.');
    if (!calendar.canEdit) throw this.error(409, READ_ONLY);
    let event;
    try { event = await this.graph('GET', `${this.base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}?$select=${FIELDS}`); }
    catch (error) { if (error.status === 404) throw this.error(404, 'That entry is not in the calendar any more. Refresh the list.'); throw error; }
    if (!isOwnAnniversary(event)) throw this.error(409, NOT_OWN);
    await this.graph('DELETE', `${this.base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`);
    const m = String(event.subject).match(OWN_ANNIVERSARY);
    const row = { kind: 'anniversary', name: m[1], since: Number(m[2]) };
    this.forget(row);
    return { ...row, calendarName: calendar.name };
  }
  // A removed person no longer needs a hide entry.
  forget(row) {
    if (this.hiddenKeys.delete(hideKey(row.kind, row.name))) { this.saveHidden(); this.onHiddenChange?.(this.hiddenKeys); }
  }
}
const READ_ONLY = 'This calendar is read-only for the app (canEdit is off), so nothing can be added or removed here. Give the app Calendars.ReadWrite on this mailbox, or use Hide.';
const NOT_OWN = 'This entry is not in the app\u2019s own format, so the app will not delete it. Hide it, or delete it in Outlook.';
const bySoonest = (a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name);
