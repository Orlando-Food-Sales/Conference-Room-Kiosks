// Birthdays and work anniversaries from a shared Microsoft 365 calendar.
// Reads today's events from the mailbox in BIRTHDAY_CALENDAR_MAILBOX through Microsoft Graph
// (same app credentials as the room calendars) and turns event titles into short entries.

const NOISE = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu;       // emoji

export function parseCelebration(subject, nameStyle = 'first') {
  const raw = String(subject || '').replace(NOISE, ' ').trim();
  if (!raw) return null;
  // Only titles that say birthday or anniversary count. PTO and anything else on the calendar is ignored.
  const kind = /anniversar|anniv\b/i.test(raw) ? 'anniversary' : (/birthday|\bb['\u2019]?-?day\b/i.test(raw) ? 'birthday' : null);
  if (!kind) return null;
  const yearsMatch = raw.match(/(\d{1,2})\s*[- ]?\s*(?:year|yr)s?/i) || raw.match(/\((\d{1,2})\)/);
  const years = kind === 'anniversary' && yearsMatch ? Number(yearsMatch[1]) : null;
  let name = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d{1,2}\s*[- ]?\s*(?:year|yr)s?/gi, ' ')
    .replace(/\bb['\u2019]?-?day\b/gi, ' ')
    .replace(/\b(?:happy|work|birthday|anniversary|anniv)\b/gi, ' ')
    .replace(/['\u2019]s\b/gi, ' ')
    .replace(/[-\u2013\u2014:|,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return null;
  if (nameStyle !== 'full') name = name.split(' ')[0];
  return { kind, name: name.slice(0, 40), years };
}

// Company holidays are all-day events whose title starts with "Holiday" ("Holiday - Christmas",
// "Holiday-Thanksgiving", or just "HOLIDAY"). Returns the holiday name, '' for a bare "Holiday",
// or null when the title is not a company holiday.
export function holidayName(subject) {
  const raw = String(subject || '').replace(NOISE, ' ').trim();
  if (!/^holiday\b/i.test(raw)) return null;
  return raw.replace(/^holiday\s*[-\u2013\u2014:|]*\s*/i, '').trim().slice(0, 60);
}

function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export class CelebrationService {
  constructor(config, tokenProvider, fetchImpl = fetch) {
    this.config = config;
    this.tokens = tokenProvider;
    this.fetch = fetchImpl;
    this.cached = null;
    this.cachedKey = '';
    this.cachedAt = 0;
    this.ttlMs = 15 * 60 * 1000;
  }

  get enabled() {
    const b = this.config.birthdays;
    return Boolean(b && b.mailbox && this.tokens && !this.config.demoMode);
  }

  async get(now = new Date()) {
    const b = this.config.birthdays;
    const date = todayIn(b.timeZone, now);
    if (!this.enabled) return { date, celebrations: [], holiday: null };
    if (this.cached && this.cachedKey === date && Date.now() - this.cachedAt < this.ttlMs) return this.cached;
    try {
      const { celebrations, holiday } = await this.fetchToday(date, now);
      this.cached = { date, celebrations, holiday };
      this.cachedKey = date;
      this.cachedAt = Date.now();
    } catch (error) {
      // Keep yesterday's answer off the screen: only reuse a result for the same date.
      if (!(this.cached && this.cachedKey === date)) return { date, celebrations: [], holiday: null };
    }
    return this.cached;
  }

  async graph(url, timeZone) {
    const response = await this.fetch(url, {
      headers: { authorization: `Bearer ${await this.tokens.getToken()}`, accept: 'application/json', prefer: `outlook.timezone="${timeZone}"` }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Celebration calendar request failed (${response.status})`);
    return body;
  }

  // Which calendars in the mailbox to read: one by id, one or more by name, or all of them.
  // Titles are filtered by keyword afterwards, so reading PTO or holiday calendars is harmless.
  async calendarIds(base) {
    const b = this.config.birthdays;
    if (b.calendarId) return [{ id: b.calendarId, name: '' }];
    const list = await this.graph(`${base}/calendars?$select=id,name&$top=50`, b.timeZone);
    const calendars = list.value || [];
    const wanted = String(b.calendarName || '').toLowerCase();
    const picked = wanted ? calendars.filter(c => String(c.name || '').toLowerCase().includes(wanted)) : calendars;
    return picked.slice(0, 10).map(c => ({ id: c.id, name: String(c.name || '') }));
  }

  async fetchToday(date, now) {
    const b = this.config.birthdays;
    const day = 24 * 60 * 60 * 1000;
    const params = new URLSearchParams({
      startDateTime: new Date(now.getTime() - day).toISOString(),
      endDateTime: new Date(now.getTime() + 2 * day).toISOString(),
      '$select': 'subject,start,end,isAllDay,isCancelled',
      '$top': '100'
    });
    const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(b.mailbox)}`;
    const calendars = await this.calendarIds(base);
    const events = [];
    for (const { id, name } of calendars) {
      const path = id ? `/calendars/${encodeURIComponent(id)}` : '';
      let next = `${base}${path}/calendarView?${params}`;
      for (let page = 0; next && page < 5; page += 1) {
        const body = await this.graph(next, b.timeZone);
        events.push(...(body.value || []).map(event => ({ ...event, calendarName: name })));
        next = body['@odata.nextLink'] || '';
      }
    }
    const seen = new Set();
    const out = [];
    let holiday = null;
    let publicHoliday = '';
    for (const event of events) {
      if (event.isCancelled) continue;
      const start = String(event.start?.dateTime || '').slice(0, 10);
      const end = String(event.end?.dateTime || '').slice(0, 10);
      const today = event.isAllDay ? (start <= date && date < end) : start === date;
      if (!today) continue;
      if (event.isAllDay) {
        const name = holidayName(event.subject);
        if (name !== null && !holiday) holiday = { name };
        // A bare "Holiday" entry borrows the name from the public holidays calendar for the same day.
        else if (name === null && /holiday/i.test(event.calendarName) && !publicHoliday) publicHoliday = String(event.subject || '').trim().slice(0, 60);
      }
      const entry = parseCelebration(event.subject, b.nameStyle);
      if (!entry) continue;
      const key = `${entry.kind}:${entry.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
    if (holiday && !holiday.name) holiday.name = publicHoliday || 'Company holiday';
    return { celebrations: out.slice(0, 12), holiday };
  }
}
