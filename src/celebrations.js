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

// Calendar dates are plain YYYY-MM-DD strings; noon UTC keeps day arithmetic clear of DST.
function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayNumber(key) { return new Date(`${key}T12:00:00Z`).getUTCDay(); }
function weekdayName(key) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
}
function appliesOn(event, date) {
  const start = String(event.start?.dateTime || '').slice(0, 10);
  const end = String(event.end?.dateTime || '').slice(0, 10);
  return event.isAllDay ? (start <= date && date < end) : start === date;
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
    this.holidays = {};      // YYYY-MM-DD -> holiday name, for today and the next week
  }

  get enabled() {
    const b = this.config.birthdays;
    return Boolean(b && b.mailbox && this.tokens && !this.config.demoMode);
  }

  async get(now = new Date()) {
    const b = this.config.birthdays;
    const date = todayIn(b.timeZone, now);
    if (!this.enabled) return { date, celebrations: [], holiday: null, nextHoliday: null };
    if (this.cached && this.cachedKey === date && Date.now() - this.cachedAt < this.ttlMs) return this.cached;
    try {
      const { celebrations, holiday, holidays, nextHoliday } = await this.fetchDays(date, now);
      this.cached = { date, celebrations, holiday, nextHoliday };
      this.holidays = holidays;
      this.cachedKey = date;
      this.cachedAt = Date.now();
    } catch (error) {
      // Keep yesterday's answer off the screen: only reuse a result for the same date.
      if (!(this.cached && this.cachedKey === date)) return { date, celebrations: [], holiday: null, nextHoliday: null };
    }
    return this.cached;
  }

  // Name of the company holiday on a date (YYYY-MM-DD), or null. Uses the last successful lookup,
  // so an unreachable calendar never blocks anything.
  holidayOn(dateKey) {
    return this.holidays[dateKey] || null;
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

  async fetchDays(date, now) {
    const b = this.config.birthdays;
    const day = 24 * 60 * 60 * 1000;
    const params = new URLSearchParams({
      startDateTime: new Date(now.getTime() - day).toISOString(),
      endDateTime: new Date(now.getTime() + 10 * day).toISOString(),
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
    const live = events.filter(event => !event.isCancelled);

    // Company holidays for today and the next 8 days.
    const holidays = {};
    for (let k = 0; k <= 8; k += 1) {
      const d = addDays(date, k);
      let found = null;
      let publicName = '';
      for (const event of live) {
        if (!event.isAllDay || !appliesOn(event, d)) continue;
        const name = holidayName(event.subject);
        if (name !== null && found === null) found = name;
        // A bare "Holiday" entry borrows the name from the public holidays calendar for the same day.
        else if (name === null && /holiday/i.test(event.calendarName) && !publicName) publicName = String(event.subject || '').trim().slice(0, 60);
      }
      if (found !== null) holidays[d] = found || publicName || 'Company holiday';
    }

    // Today, plus the closed days that follow when today is a working day (a Saturday birthday shows on Friday).
    const hours = this.config.officeHours;
    const closed = d => Boolean(holidays[d]) || Boolean(hours && !hours.days.includes(weekdayNumber(d)));
    const days = [date];
    if (!closed(date)) {
      for (let k = 1; k <= 7; k += 1) {
        const d = addDays(date, k);
        if (!closed(d)) break;
        days.push(d);
      }
    }

    const seen = new Set();
    const out = [];
    for (const d of days) {
      for (const event of live) {
        if (!appliesOn(event, d)) continue;
        const entry = parseCelebration(event.subject, b.nameStyle);
        if (!entry) continue;
        const key = `${d}:${entry.kind}:${entry.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d === date ? entry : { ...entry, day: weekdayName(d) });
      }
    }
    // Heads-up: the next working day is a company holiday ("Closed tomorrow: Thanksgiving").
    let nextHoliday = null;
    if (!holidays[date]) {
      for (let k = 1; k <= 8; k += 1) {
        const d = addDays(date, k);
        if (hours && !hours.days.includes(weekdayNumber(d))) continue;      // skip weekends
        if (holidays[d]) {
          let last = d;
          while (holidays[addDays(last, 1)]) last = addDays(last, 1);       // a holiday that runs for several days
          nextHoliday = { name: holidays[d], dayLabel: k === 1 ? 'tomorrow' : weekdayName(d), through: last !== d ? weekdayName(last) : null };
        }
        break;                                                              // only the very next working day matters
      }
    }
    return { celebrations: out.slice(0, 12), holiday: holidays[date] ? { name: holidays[date] } : null, holidays, nextHoliday };
  }
}
