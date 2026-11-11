import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCelebration, holidayName, CelebrationService } from '../src/celebrations.js';

const NY = 'America/New_York';
const WEEKDAYS = { startMinutes: 480, endMinutes: 1020, days: [1, 2, 3, 4, 5] };

// ---- title reading ----

test('reads birthdays and anniversaries from calendar titles', () => {
  const read = (title, style) => parseCelebration(title, style);
  assert.deepEqual(read('Jane Smith - Birthday'), { kind: 'birthday', name: 'Jane', years: null });
  assert.deepEqual(read("Mabel B'day"), { kind: 'birthday', name: 'Mabel', years: null });
  assert.deepEqual(read('Mabel B\u2019day'), { kind: 'birthday', name: 'Mabel', years: null });
  assert.deepEqual(read("\uD83C\uDF82 John's Birthday"), { kind: 'birthday', name: 'John', years: null });
  assert.deepEqual(read('Happy Birthday Bob'), { kind: 'birthday', name: 'Bob', years: null });
  assert.deepEqual(read('Sam Lee \u2013 5 Year Work Anniversary'), { kind: 'anniversary', name: 'Sam', years: 5 });
  assert.deepEqual(read('Maria (3) Anniversary'), { kind: 'anniversary', name: 'Maria', years: 3 });
  assert.equal(read('Jane Smith - Birthday', 'full').name, 'Jane Smith');
});

test('ignores PTO, holidays and anything that is not a birthday or anniversary', () => {
  for (const title of ['Beatrice - PTO', 'Craig - Out of office', 'Veterans Day', "Carla's Saint Day", 'Halloween', 'Dana Cruz', '', null, 'Holiday-Thanksgiving']) {
    assert.equal(parseCelebration(title), null, `should ignore ${JSON.stringify(title)}`);
  }
});

test('recognises company holidays only when the title starts with Holiday', () => {
  assert.equal(holidayName('Holiday-Thanksgiving'), 'Thanksgiving');
  assert.equal(holidayName('Holiday - Christmas'), 'Christmas');
  assert.equal(holidayName("holiday \u2013 New Year's Eve"), "New Year's Eve");
  assert.equal(holidayName('HOLIDAY'), '', 'a bare Holiday has no name of its own');
  for (const title of ['Thanksgiving Day', 'Veterans Day', 'Holidays update', 'Craig - PTO', 'Day after the holiday', null]) {
    assert.equal(holidayName(title), null, `should not be a holiday: ${JSON.stringify(title)}`);
  }
});

// ---- the service, against a fake Microsoft Graph ----

const allDay = (subject, from, to, extra = {}) => ({ subject, isAllDay: true, start: { dateTime: `${from}T00:00:00.0000000` }, end: { dateTime: `${to}T00:00:00.0000000` }, ...extra });

function fakeGraph(calendars, { fail = false } = {}) {
  const calls = [];
  const answer = body => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async url => {
    calls.push(url);
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    const parsed = new URL(url);
    const view = parsed.pathname.match(/\/calendars\/([^/]+)\/calendarView$/);
    if (view) return answer({ value: calendars[decodeURIComponent(view[1])] || [] });
    if (parsed.pathname.endsWith('/calendars')) return answer({ value: Object.keys(calendars).map(name => ({ id: name, name })) });
    return answer({ value: [] });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function service(calendars, { officeHours = WEEKDAYS, birthdays = {}, fail = false } = {}) {
  const fetchImpl = fakeGraph(calendars, { fail });
  const config = { demoMode: false, officeHours, birthdays: { mailbox: 'cal@example.com', calendarId: '', calendarName: '', nameStyle: 'first', timeZone: NY, ...birthdays } };
  const svc = new CelebrationService(config, { getToken: async () => 'token' }, fetchImpl);
  svc.fetchImpl = fetchImpl;
  return svc;
}
const noon = day => new Date(`${day}T17:00:00Z`);          // noon in New York

const CALENDARS = () => ({
  Calendar: [
    allDay('Holiday-Thanksgiving', '2026-11-26', '2026-11-28'),
    allDay('Holiday - Christmas', '2026-12-24', '2026-12-26'),
    allDay('Holiday - Founders Day', '2026-11-16', '2026-11-17'),
    allDay("Mabel B'day", '2026-11-14', '2026-11-15'),
    allDay('Jackie Birthday', '2026-11-27', '2026-11-28'),
    allDay('Sam Lee - 5 Year Work Anniversary', '2026-11-10', '2026-11-11'),
    allDay('Craig - PTO', '2026-11-25', '2026-11-30'),
    allDay('Cancelled Birthday', '2026-11-10', '2026-11-11', { isCancelled: true })
  ],
  'United States holidays': [allDay('Veterans Day', '2026-11-11', '2026-11-12'), allDay('Thanksgiving Day', '2026-11-26', '2026-11-27')]
});
const names = result => result.celebrations.map(c => `${c.name}${c.day ? ` (${c.day})` : ''}`);

test('shows today\'s birthdays and anniversaries, never PTO or cancelled entries', async () => {
  const result = await service(CALENDARS()).get(noon('2026-11-10'));
  assert.deepEqual(result.celebrations, [{ kind: 'anniversary', name: 'Sam', years: 5 }]);
  assert.equal(result.holiday, null);
});

test('a Saturday birthday is also shown on Friday, labelled with its day', async () => {
  assert.deepEqual(names(await service(CALENDARS()).get(noon('2026-11-13'))), ['Mabel (Saturday)']);
  assert.deepEqual(names(await service(CALENDARS()).get(noon('2026-11-14'))), ['Mabel'], 'on the day itself there is no label');
  assert.deepEqual(names(await service(CALENDARS()).get(noon('2026-11-12'))), [], 'Thursday looks ahead only over closed days');
});

test('company holidays count as closed days when looking ahead', async () => {
  // Wednesday before Thanksgiving: Thursday and Friday are closed, so Friday's birthday is shown early.
  assert.deepEqual(names(await service(CALENDARS()).get(noon('2026-11-25'))), ['Jackie (Friday)']);
});

test('detects a company holiday today, including a two day holiday', async () => {
  for (const day of ['2026-11-26', '2026-11-27']) {
    const result = await service(CALENDARS()).get(noon(day));
    assert.equal(result.holiday?.name, 'Thanksgiving', day);
  }
  assert.equal((await service(CALENDARS()).get(noon('2026-11-28'))).holiday, null, 'the entry ends before Saturday');
  assert.equal((await service(CALENDARS()).get(noon('2026-11-11'))).holiday, null, 'Veterans Day is not a company closure');
});

test('on a holiday only that day\'s birthdays are shown, not a look-ahead', async () => {
  assert.deepEqual(names(await service(CALENDARS()).get(noon('2026-11-27'))), ['Jackie']);
});

test('a bare HOLIDAY takes its name from the public holidays calendar, else "Company holiday"', async () => {
  const withPublic = { Calendar: [allDay('HOLIDAY', '2027-01-01', '2027-01-02')], 'United States holidays': [allDay("New Year's Day", '2027-01-01', '2027-01-02')] };
  assert.equal((await service(withPublic).get(noon('2027-01-01'))).holiday.name, "New Year's Day");
  assert.equal((await service({ Calendar: [allDay('HOLIDAY', '2027-01-01', '2027-01-02')] }).get(noon('2027-01-01'))).holiday.name, 'Company holiday');
});

test('warns the day before a holiday ("Closed tomorrow through Friday")', async () => {
  const wednesday = (await service(CALENDARS()).get(noon('2026-11-25'))).nextHoliday;
  assert.deepEqual(wednesday, { name: 'Thanksgiving', dayLabel: 'tomorrow', through: 'Friday' });
  assert.equal((await service(CALENDARS()).get(noon('2026-11-10'))).nextHoliday, null);
  assert.equal((await service(CALENDARS()).get(noon('2026-11-26'))).nextHoliday, null, 'on the holiday itself the Closed screen already says so');
});

test('the warning looks past the weekend ("Closed Monday")', async () => {
  for (const day of ['2026-11-13', '2026-11-14', '2026-11-15']) {
    const next = (await service(CALENDARS()).get(noon(day))).nextHoliday;
    assert.equal(next.name, 'Founders Day', day);
  }
  assert.equal((await service(CALENDARS()).get(noon('2026-11-13'))).nextHoliday.dayLabel, 'Monday');
  assert.equal((await service(CALENDARS()).get(noon('2026-11-15'))).nextHoliday.dayLabel, 'tomorrow');
});

test('holidayOn remembers the next week for the booking check', async () => {
  const svc = service(CALENDARS());
  await svc.get(noon('2026-11-25'));
  assert.equal(svc.holidayOn('2026-11-26'), 'Thanksgiving');
  assert.equal(svc.holidayOn('2026-11-27'), 'Thanksgiving');
  assert.equal(svc.holidayOn('2026-11-28'), null);
  assert.equal(svc.holidayOn('2026-11-25'), null);
});

test('can read only calendars whose name matches, and shows full names on request', async () => {
  const calendars = { Calendar: [allDay('Jane Smith Birthday', '2026-11-10', '2026-11-11')], Birthdays: [allDay('Tom Reed Birthday', '2026-11-10', '2026-11-11')] };
  const svc = service(calendars, { birthdays: { calendarName: 'birth', nameStyle: 'full' } });
  assert.deepEqual(names(await svc.get(noon('2026-11-10'))), ['Tom Reed']);
  assert.ok(svc.fetchImpl.calls.every(url => !url.includes('/calendars/Calendar/')), 'the main calendar was not read');
});

test('is quiet when no mailbox is set, when Graph fails, and between refreshes', async () => {
  const off = service(CALENDARS(), { birthdays: { mailbox: '' } });
  assert.deepEqual(await off.get(noon('2026-11-10')), { date: '2026-11-10', celebrations: [], holiday: null, nextHoliday: null });
  assert.equal(off.fetchImpl.calls.length, 0, 'no mailbox means no requests');

  const broken = service(CALENDARS(), { fail: true });
  const result = await broken.get(noon('2026-11-26'));
  assert.deepEqual([result.celebrations, result.holiday], [[], null], 'an outage shows nothing rather than guessing');
  assert.equal(broken.holidayOn('2026-11-26'), null, 'an outage never blocks bookings');

  const cached = service(CALENDARS());
  await cached.get(noon('2026-11-10'));
  const requests = cached.fetchImpl.calls.length;
  await cached.get(noon('2026-11-10'));
  assert.equal(cached.fetchImpl.calls.length, requests, 'the second call the same day reuses the answer');
});
