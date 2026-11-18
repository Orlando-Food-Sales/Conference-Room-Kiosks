import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkIn, GraphPresence, DemoPresence, CALL_ACTIVITIES } from '../src/walk-in.js';
import { GraphCalendar, WALK_IN_SUBJECT, WALK_IN_BODY } from '../src/graph-calendar.js';
import { DemoCalendar } from '../src/demo-calendar.js';

const T0 = Date.UTC(2026, 0, 5, 15, 0, 0);
const SEC = 1000, MIN = 60000;
const ROOM = { id: 'front', name: 'Front', email: 'front@example.com', timeZone: 'UTC' };
const BACK = { id: 'back', name: 'Back', email: 'back@example.com', timeZone: 'UTC' };
const CALL = { availability: 'Busy', activity: 'InAConferenceCall' };
const FREE = { availability: 'Available', activity: 'Available' };
const iso = ms => new Date(ms).toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class FakeCalendar {
  constructor() { this.events = []; this.creates = 0; this.patches = []; this.failCreate = 0; this.delay = 0; }
  async listEvents() { return this.events.map(event => ({ ...event })); }
  async createEvent(booking) {
    if (this.delay) await sleep(this.delay);
    if (this.failCreate > 0) { this.failCreate -= 1; throw Object.assign(new Error('Microsoft is down'), { kind: 'microsoft-down' }); }
    const event = { id: `e${this.events.length + 1}`, isPrivate: false, ...booking };
    this.events.push(event); this.creates += 1;
    return event;
  }
  async updateEvent(id, { end }) { this.patches.push({ id, end }); this.events.find(event => event.id === id).end = end; }
}
class FakePresence {
  constructor() { this.reading = FREE; this.failure = null; this.reads = 0; this.asked = []; }
  async read(ids) {
    this.reads += 1; this.asked.push(ids);
    if (this.failure) throw this.failure;
    return new Map(this.reading ? ids.map(id => [id, this.reading]) : []);
  }
}
function setup({ cal = new FakeCalendar(), presence = new FakePresence(), open = true, config = {}, rooms = [ROOM], alertState = new Map() } = {}) {
  const logs = [], alerts = [], notes = [];
  const state = { open };
  const calendars = new Map([['front', cal]]);
  const walkIn = createWalkIn({
    config: { enabled: true, maxMinutes: 240, outsideHours: false, rooms: { front: 'u1' }, ...config },
    rooms, calendars, presence, alertState,
    listEvents: async () => cal.listEvents(), refreshRoom: async () => cal.listEvents(),
    notifyRoom: (id, type, data) => notes.push({ id, type, ...data }),
    isOpen: async () => state.open, logger: { log: line => logs.push(line) }, sendAlert: async text => alerts.push(text)
  });
  return { cal, presence, walkIn, logs, alerts, notes, state, alertState };
}
async function run(h, from, to, reading, step = 30 * SEC) {
  h.presence.reading = reading;
  for (let ms = from; ms <= to; ms += step) await h.walkIn.check(ms);
}
const real = (id, start, end, extra = {}) => ({ id, subject: 'Weekly', organizer: 'A', start: iso(start), end: iso(end), isPrivate: false, ...extra });

test('1. no call and no booking changes nothing', async () => {
  const h = setup();
  await run(h, T0, T0 + 10 * MIN, FREE);
  assert.equal(h.cal.creates, 0); assert.equal(h.cal.patches.length, 0);
  assert.equal(h.walkIn.doorState('front'), null);
});

test('2. a call during a real booking changes nothing, and a person\'s Reserved event is never touched', async () => {
  const h = setup();
  h.cal.events.push(real('r1', T0 - 10 * MIN, T0 + 50 * MIN), real('r2', T0 - 5 * MIN, T0 + 40 * MIN, { subject: 'Reserved' }), real('r3', T0 - 5 * MIN, T0 + 40 * MIN, { subject: WALK_IN_SUBJECT }));
  await run(h, T0, T0 + 30 * MIN, CALL);
  assert.equal(h.cal.creates, 0); assert.equal(h.cal.patches.length, 0);
  assert.deepEqual(h.walkIn.doorState('front'), { call: true });
});

test('3. a call without a booking: confirmed after 60 s, one 15 minute event, renewed on the same event', async () => {
  const h = setup();
  await h.walkIn.check(T0); h.presence.reading = CALL;
  await h.walkIn.check(T0); await h.walkIn.check(T0 + 30 * SEC);
  assert.equal(h.cal.creates, 0); assert.equal(h.walkIn.doorState('front'), null);
  await h.walkIn.check(T0 + 60 * SEC);
  assert.deepEqual(h.walkIn.doorState('front'), { call: true });
  assert.equal(h.cal.creates, 1);
  const [event] = h.cal.events;
  assert.equal(event.subject, WALK_IN_SUBJECT); assert.equal(event.autoBooked, true);
  assert.equal(event.start, iso(T0 + 60 * SEC)); assert.equal(event.end, iso(T0 + 60 * SEC + 15 * MIN));
  await run(h, T0 + 90 * SEC, T0 + 60 * SEC + 9 * MIN, CALL);
  assert.equal(h.cal.patches.length, 0);
  await run(h, T0 + 60 * SEC + 10 * MIN, T0 + 60 * SEC + 10 * MIN, CALL);
  assert.equal(h.cal.creates, 1); assert.equal(h.cal.patches.length, 1);
  assert.equal(h.cal.patches[0].id, event.id); assert.equal(event.end, iso(T0 + 60 * SEC + 25 * MIN));
  assert.ok(h.notes.some(n => n.reason === 'walk-in')); assert.ok(h.notes.some(n => n.reason === 'presence'));
  assert.ok(h.logs.every(line => line.startsWith('Walk-in: ')));
  assert.equal(h.walkIn.roomStatus('front').lastBooking.action, 'renewed');
});

test('4. the call ends: one blip changes nothing, 3 minutes of no call shorten the event, a 40 s call never books', async () => {
  const h = setup();
  await run(h, T0, T0 + 120 * SEC, CALL);
  const event = h.cal.events[0], firstEnd = event.end;
  await h.walkIn.check(T0 + 150 * SEC); h.presence.reading = FREE; await h.walkIn.check(T0 + 150 * SEC);
  await run(h, T0 + 180 * SEC, T0 + 180 * SEC, CALL);
  await run(h, T0 + 210 * SEC, T0 + 6 * MIN + 20 * SEC, FREE);
  assert.equal(event.end, firstEnd);
  assert.deepEqual(h.walkIn.doorState('front'), { call: true });
  await run(h, T0 + 6 * MIN + 30 * SEC, T0 + 8 * MIN, FREE);
  assert.equal(h.walkIn.doorState('front'), null);
  assert.equal(h.cal.patches.length, 1);
  assert.equal(event.end, iso(T0 + 4 * MIN));      // the minute after the last call reading (T0 + 180 s)
  assert.equal(h.walkIn.roomStatus('front').lastBooking.action, 'released');
  const short = setup();
  await run(short, T0, T0 + 30 * SEC, CALL); await run(short, T0 + 60 * SEC, T0 + 5 * MIN, FREE);
  assert.equal(short.cal.creates, 0);
});

test('5. a real booking starting soon: no overlap, nothing under 5 minutes, cut back when it appears later', async () => {
  const later = setup();
  later.cal.events.push(real('r1', T0 + 10 * MIN, T0 + 70 * MIN));
  await run(later, T0, T0 + 60 * SEC, CALL);
  assert.equal(later.cal.events[1].end, iso(T0 + 10 * MIN));
  const soon = setup();
  soon.cal.events.push(real('r1', T0 + 3 * MIN, T0 + 70 * MIN));
  await run(soon, T0, T0 + 2 * MIN, CALL);
  assert.equal(soon.cal.creates, 0);
  assert.deepEqual(soon.walkIn.doorState('front'), { call: true });
  const added = setup();
  await run(added, T0, T0 + 60 * SEC, CALL);
  added.cal.events.push(real('r2', T0 + 8 * MIN, T0 + 40 * MIN));
  await run(added, T0 + 90 * SEC, T0 + 2 * MIN, CALL);
  assert.equal(added.cal.events[0].end, iso(T0 + 8 * MIN));
  await run(added, T0 + 150 * SEC, T0 + 12 * MIN, CALL);
  assert.equal(added.cal.creates, 1);
});

test('6. presence that cannot be read changes nothing, and alerts only after 15 minutes inside office hours', async () => {
  for (const failure of [Object.assign(new Error('no'), { kind: 'permission', status: 403 }), Object.assign(new Error('no'), { kind: 'microsoft-down', status: 503 }), Object.assign(new Error('slow down'), { kind: 'microsoft-down', status: 429 })]) {
    const h = setup();
    await run(h, T0, T0 + 2 * MIN, CALL);
    const before = [h.cal.creates, h.cal.patches.length, h.cal.events[0].end];
    h.presence.failure = failure;
    await run(h, T0 + 150 * SEC, T0 + 30 * MIN, CALL);
    assert.deepEqual([h.cal.creates, h.cal.patches.length, h.cal.events[0].end], before);
    assert.deepEqual(h.walkIn.doorState('front'), { call: true });
  }
  for (const odd of [{ availability: 'Busy', activity: 'PresenceUnknown' }, { availability: 'PresenceUnknown', activity: 'PresenceUnknown' }, null]) {
    const h = setup();
    await run(h, T0, T0 + 30 * MIN, odd);
    assert.equal(h.cal.creates, 0);
  }
  const drop = setup();
  await run(drop, T0, T0 + 30 * SEC, CALL);
  drop.presence.failure = Object.assign(new Error('x'), { kind: 'microsoft-down' });
  await run(drop, T0 + 60 * SEC, T0 + 150 * SEC, CALL);
  drop.presence.failure = null;
  await run(drop, T0 + 180 * SEC, T0 + 180 * SEC, CALL);
  assert.equal(drop.cal.creates, 0);
  await run(drop, T0 + 210 * SEC, T0 + 240 * SEC, CALL);
  assert.equal(drop.cal.creates, 1);
  const a = setup();
  a.presence.failure = Object.assign(new Error('x'), { kind: 'permission' });
  await run(a, T0, T0 + 14 * MIN, FREE);
  assert.equal(a.alerts.length, 0);
  await run(a, T0 + 14 * MIN + 30 * SEC, T0 + 16 * MIN, FREE);
  assert.equal(a.alerts.length, 1);
  await run(a, T0 + 17 * MIN, T0 + 20 * MIN, FREE);
  assert.equal(a.alerts.length, 1);
  a.presence.failure = null;
  await run(a, T0 + 21 * MIN, T0 + 21 * MIN, FREE);
  assert.equal(a.alerts.length, 2);
  assert.match(a.alerts[1], /again/);
  const closed = setup({ open: false });
  closed.presence.failure = Object.assign(new Error('x'), { kind: 'permission' });
  await run(closed, T0, T0 + 20 * MIN, FREE);
  assert.equal(closed.alerts.length, 0);
});

test('7. a restart in the middle of a call creates no duplicate and does not release', async () => {
  const first = setup();
  await run(first, T0, T0 + 60 * SEC, CALL);
  const fresh = setup({ cal: first.cal });
  await run(fresh, T0 + 10 * MIN, T0 + 12 * MIN, CALL);
  assert.equal(first.cal.creates, 1);
  assert.equal(first.cal.patches.length, 1);
  assert.equal(first.cal.events[0].end, iso(T0 + 11 * MIN + 15 * MIN));
  const capped = setup({ config: { maxMinutes: 60 } });
  capped.cal.events.push({ id: 'old', subject: WALK_IN_SUBJECT, autoBooked: true, isPrivate: false, start: iso(T0), end: iso(T0 + 60 * MIN) });
  await run(capped, T0 + 61 * MIN, T0 + 66 * MIN, CALL);
  assert.equal(capped.cal.creates, 0);
});

test('8. the hard cap stops the booking and a new call after 3 quiet minutes books again', async () => {
  const h = setup({ config: { maxMinutes: 60 } });
  await run(h, T0, T0 + 70 * MIN, CALL);
  assert.equal(h.cal.creates, 1);
  const [event] = h.cal.events;
  assert.ok(Date.parse(event.end) <= Date.parse(event.start) + 60 * MIN);
  assert.equal(h.walkIn.roomStatus('front').call, true);
  assert.ok(h.logs.some(line => /longest booking time/.test(line)));
  await run(h, T0 + 71 * MIN, T0 + 76 * MIN, FREE);
  assert.equal(h.walkIn.doorState('front'), null);
  await run(h, T0 + 77 * MIN, T0 + 79 * MIN, CALL);
  assert.equal(h.cal.creates, 2);
});

test('9. off switch: presence is never read, and a room without an id is not tracked', async () => {
  const off = setup({ config: { enabled: false } });
  await run(off, T0, T0 + 5 * MIN, CALL);
  assert.equal(off.presence.reads, 0); assert.equal(off.cal.creates, 0); assert.equal(off.walkIn.doorState('front'), null);
  const two = setup({ rooms: [ROOM, BACK] });
  await run(two, T0, T0 + 2 * MIN, CALL);
  assert.deepEqual(two.presence.asked[0], ['u1']);
  assert.equal(two.walkIn.doorState('back'), null); assert.equal(two.walkIn.roomStatus('back'), null);
  assert.deepEqual(two.walkIn.health(), { enabled: true, problem: '', maxMinutes: 240, outsideHours: false });
});

test('10. office hours: no booking or renewal after hours, door state and release still work, outsideHours books', async () => {
  const closed = setup({ open: false });
  await run(closed, T0, T0 + 3 * MIN, CALL);
  assert.equal(closed.cal.creates, 0);
  assert.deepEqual(closed.walkIn.doorState('front'), { call: true });
  const h = setup();
  await run(h, T0, T0 + 60 * SEC, CALL);
  h.state.open = false;
  const end = h.cal.events[0].end;
  await run(h, T0 + 10 * MIN, T0 + 12 * MIN, CALL);
  assert.equal(h.cal.events[0].end, end);
  await run(h, T0 + 13 * MIN, T0 + 17 * MIN, FREE);
  assert.equal(h.walkIn.doorState('front'), null);
  assert.equal(h.cal.events[0].end, iso(T0 + 13 * MIN));      // the minute after the last call reading at T0 + 12 min
  const night = setup({ open: false, config: { outsideHours: true } });
  await run(night, T0, T0 + 60 * SEC, CALL);
  assert.equal(night.cal.creates, 1);
});

test('11. a failed write is retried without duplicates, and overlapping checks create one event', async () => {
  const h = setup();
  h.cal.failCreate = 1;
  await run(h, T0, T0 + 60 * SEC, CALL);
  assert.equal(h.cal.creates, 0);
  assert.equal(h.walkIn.roomStatus('front').lastBooking, null);
  assert.match(h.walkIn.roomStatus('front').problem, /microsoft-down/);
  await run(h, T0 + 90 * SEC, T0 + 90 * SEC, CALL);
  assert.equal(h.cal.creates, 1); assert.equal(h.cal.events.length, 1);
  assert.equal(h.walkIn.roomStatus('front').problem, '');
  const slow = setup();
  slow.cal.delay = 30;
  await run(slow, T0, T0 + 30 * SEC, CALL);
  await Promise.all([slow.walkIn.check(T0 + 60 * SEC), slow.walkIn.check(T0 + 60 * SEC)]);
  assert.equal(slow.cal.creates, 1);
});

test('12. GraphPresence sends only the ids and keeps only availability and activity', async () => {
  const requests = [];
  const answer = (status, body) => async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify(body), { status }); };
  const tokens = { getToken: async () => 'token' };
  const secrets = { id: 'U1', availability: 'Busy', activity: 'InAConferenceCall', statusMessage: { message: { content: 'secret note' } }, outOfOfficeSettings: { message: 'away at secret place' }, workLocation: { type: 'office' } };
  const result = await new GraphPresence({}, tokens, answer(200, { value: [secrets, { id: 'other', availability: 'Busy', activity: 'Busy' }] })).read(['u1']);
  assert.equal(requests[0].url, 'https://graph.microsoft.com/v1.0/communications/getPresencesByUserId');
  assert.equal(requests[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].init.body), { ids: ['u1'] });
  assert.deepEqual([...result.keys()], ['u1']);
  assert.deepEqual(Object.keys(result.get('u1')).sort(), ['activity', 'availability']);
  assert.doesNotMatch(JSON.stringify([...result]), /secret|office/);
  const odd = await new GraphPresence({}, tokens, answer(200, { value: [{ id: 'u1', availability: '<script>', activity: 'In A Call' }] })).read(['u1']);
  assert.deepEqual(odd.get('u1'), { availability: 'PresenceUnknown', activity: 'PresenceUnknown' });
  for (const [status, kind] of [[403, 'permission'], [429, 'microsoft-down'], [500, 'microsoft-down']]) {
    await assert.rejects(new GraphPresence({}, tokens, answer(status, { error: { message: 'no' } })).read(['u1']), error => error.kind === kind);
  }
  const timeout = async () => { throw Object.assign(new Error('late'), { name: 'TimeoutError' }); };
  await assert.rejects(new GraphPresence({}, tokens, timeout).read(['u1']), error => error.kind === 'microsoft-down');
  assert.ok(CALL_ACTIVITIES.has('InAConferenceCall') && !CALL_ACTIVITIES.has('InAMeeting') && !CALL_ACTIVITIES.has('Busy'));
});

test('GraphCalendar: marker body on create, PATCH with only end, and only the exact subject plus marker is flagged', async () => {
  const requests = [];
  const listing = { value: [
    { id: 'a', subject: WALK_IN_SUBJECT, bodyPreview: `${WALK_IN_BODY}`, start: { dateTime: '2026-01-05T15:00:00' }, end: { dateTime: '2026-01-05T15:15:00' }, organizer: { emailAddress: { name: 'Room' } } },
    { id: 'b', subject: 'Reserved', bodyPreview: 'Reserved from room display', start: { dateTime: '2026-01-05T16:00:00' }, end: { dateTime: '2026-01-05T16:15:00' } },
    { id: 'c', subject: WALK_IN_SUBJECT, bodyPreview: 'something else', start: { dateTime: '2026-01-05T17:00:00' }, end: { dateTime: '2026-01-05T17:15:00' } },
    { id: 'd', subject: WALK_IN_SUBJECT, bodyPreview: WALK_IN_BODY, sensitivity: 'private', start: { dateTime: '2026-01-05T18:00:00' }, end: { dateTime: '2026-01-05T18:15:00' } }
  ] };
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify(init.method === 'POST' ? { id: 'new' } : init.method === 'PATCH' ? {} : listing), { status: 200 }); };
  const calendar = new GraphCalendar({}, ROOM, { getToken: async () => 't' }, fetchImpl);
  const events = await calendar.listEvents(T0, T0 + 86400000);
  assert.match(requests[0].url, /bodyPreview/);
  assert.deepEqual(events.map(event => [event.id, event.autoBooked]), [['a', true], ['b', false], ['c', false], ['d', false]]);
  const created = await calendar.createEvent({ subject: WALK_IN_SUBJECT, start: iso(T0), end: iso(T0 + 15 * MIN), autoBooked: true });
  assert.equal(created.autoBooked, true);
  const post = JSON.parse(requests[1].init.body);
  assert.equal(post.subject, WALK_IN_SUBJECT); assert.equal(post.body.content, WALK_IN_BODY);
  await calendar.updateEvent('abc', { end: iso(T0 + 20 * MIN) });
  assert.equal(requests[2].init.method, 'PATCH');
  assert.match(requests[2].url, /\/events\/abc$/);
  assert.deepEqual(JSON.parse(requests[2].init.body), { end: { dateTime: '2026-01-05T15:20:00.000', timeZone: 'UTC' } });
  await calendar.createEvent({ subject: 'Reserved', start: iso(T0), end: iso(T0 + MIN), organizer: 'Pat' });
  assert.equal(JSON.parse(requests[3].init.body).body.content, 'Reserved from room display by Pat');
});

test('DemoCalendar: sample meetings can be turned off, and updateEvent moves the end', async () => {
  const withMeetings = new DemoCalendar(ROOM, 0);
  assert.ok((await withMeetings.listEvents(0, Date.now() + 86400000 * 365)).length >= 1);
  const calendar = new DemoCalendar(ROOM, 0, { meetings: false });
  assert.equal((await calendar.listEvents(0, Date.now() + 86400000 * 365)).length, 0);
  const event = await calendar.createEvent({ subject: WALK_IN_SUBJECT, start: iso(Date.now()), end: iso(Date.now() + 900000), autoBooked: true });
  await calendar.updateEvent(event.id, { end: iso(Date.now() + 1800000) });
  const [listed] = await calendar.listEvents(0, Date.now() + 86400000);
  assert.equal(listed.autoBooked, true);
  assert.equal(listed.end, iso(Date.parse(listed.end)));
  assert.ok(Date.parse(listed.end) > Date.now() + 1000000);
  const demo = new DemoPresence([ROOM]);
  demo.set('front', true);
  assert.equal((await demo.read()).get('front').activity, 'InAConferenceCall');
});
