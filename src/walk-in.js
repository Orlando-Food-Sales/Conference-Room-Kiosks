// Walk-in Teams calls (INSTALL-UBUNTU.md 12g). When a room's Teams account reports a call and nobody has the room
// booked, the door screen shows "In use" and the room display books the room for the call, one 15 minute slice at a
// time, and gives the time back when the call is over. Presence that cannot be read never changes anything.
import { call, graphError, WALK_IN_SUBJECT } from './graph-calendar.js';

// Only the Teams client sets these. "InAMeeting" is not here: Exchange derives it from the calendar, so our own booking
// would keep itself alive forever.
export const CALL_ACTIVITIES = new Set(['InAConferenceCall', 'InACall', 'Presenting']);
const WORD = /^[A-Za-z]{1,40}$/;
const CHECK_SECONDS = 30;
const CONFIRM_MS = 60000;
const GONE_MS = 180000;
const SLICE_MS = 15 * 60000;
const RENEW_AT_MS = 5 * 60000;
const MIN_SLICE_MS = 5 * 60000;
const UNKNOWN_DROP_MS = 120000;
const PRESENCE_ALERT_MS = 15 * 60000;
const CAP_MEMORY_MS = 10 * 60000;
const REPEAT_LOG_MS = 10 * 60000;
const ALERT_KEY = 'walkin:presence';

// Reads Teams presence for the user ids written in rooms.json and keeps only availability and activity.
export class GraphPresence {
  constructor(config, tokenProvider, fetchImpl = fetch) {
    this.config = config;
    this.tokens = tokenProvider;
    this.fetch = fetchImpl;
  }
  async read(ids) {
    const token = await this.tokens.getToken();
    const response = await call(this.fetch, 'https://graph.microsoft.com/v1.0/communications/getPresencesByUserId', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw graphError(response, body);
    const wanted = new Map(ids.map(id => [String(id).toLowerCase(), id]));
    const result = new Map();
    for (const item of Array.isArray(body.value) ? body.value : []) {
      const id = wanted.get(String(item?.id || '').toLowerCase());
      if (!id) continue;
      const word = value => (WORD.test(String(value ?? '')) ? String(value) : 'PresenceUnknown');
      result.set(id, { availability: word(item.availability), activity: word(item.activity) });
    }
    return result;
  }
}

// Demo mode: the dashboard's simulate-call button flips a room between a call and Available.
export class DemoPresence {
  constructor(rooms) {
    this.state = new Map(rooms.map(room => [room.id, false]));
  }
  async read() {
    return new Map([...this.state].map(([id, inCall]) => [id, inCall ? { availability: 'Busy', activity: 'InAConferenceCall' } : { availability: 'Available', activity: 'Available' }]));
  }
  set(roomId, inCall) { if (this.state.has(roomId)) this.state.set(roomId, Boolean(inCall)); }
}

export function createWalkIn({ config, rooms, calendars, presence, listEvents, refreshRoom, notifyRoom, isOpen, logger = {}, sendAlert, alertState = new Map(), officeSettled, roomEnabled }) {
  const settings = config || { enabled: false, rooms: {} };
  const tracked = (rooms || []).filter(room => Object.prototype.hasOwnProperty.call(settings.rooms || {}, room.id));
  const maxMs = (settings.maxMinutes || 240) * 60000;
  const states = new Map(tracked.map(room => [room.id, {
    callSeenSince: null, notCallSince: null, lastCallAt: null, callActive: false, callSince: null, lastGoodAt: null,
    lastReading: null, capped: false, capClearedAt: 0, lastBooking: null, problem: '', release: null,
    unreadableSince: null, unreadableLoggedAt: 0, writeLoggedAt: 0
  }]));
  const open = async (room, ms) => {
    if (isOpen) return Boolean(await isOpen(room, ms));
    return officeSettled ? Boolean(officeSettled(room, ms, 0)) : true;
  };
  const clock = (room, ms) => new Intl.DateTimeFormat('en-US', { timeZone: room.timeZone || 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  const log = text => logger.log?.(`Walk-in: ${text}`);
  const keyOf = room => settings.rooms[room.id] || room.id;
  const time = value => Date.parse(value);
  const switchedOff = room => roomEnabled ? !roomEnabled(room.id) : false;   // an administrator's switch for this room
  let running = false;

  async function writeWithRefresh(room, state, ms, action, make) {
    const events = await refreshRoom(room.id);
    const plan = make(events || []);
    if (!plan) return;
    await plan.run(calendars.get(room.id));
    state.lastBooking = { at: ms, start: plan.start, end: plan.end, action };
    state.problem = '';
    log(plan.message);
    await refreshRoom(room.id).catch(() => {});
    notifyRoom?.(room.id, 'calendar.changed', { reason: 'walk-in' });
  }

  // Decides what the room needs while a confirmed call is going on. Returns null when nothing should change.
  function plan(room, state, events, ms, canWrite) {
    const real = events.filter(event => !event.autoBooked && time(event.end) > ms);
    if (real.some(event => time(event.start) <= ms)) return null;
    const nextRealStart = Math.min(Infinity, ...real.filter(event => time(event.start) > ms).map(event => time(event.start)));
    const owned = events.filter(event => event.autoBooked);
    const current = owned.find(event => time(event.start) <= ms && time(event.end) > ms);
    if (current) {
      const start = time(current.start), end = time(current.end);
      const capEnd = start + maxMs;
      if (nextRealStart < end) {
        const newEnd = Math.max(nextRealStart, start + 60000);
        return { action: 'cut', start, end: newEnd, message: `a meeting starts at ${clock(room, nextRealStart)} in ${room.name}, the call booking now ends then`, run: cal => cal.updateEvent(current.id, { end: new Date(newEnd).toISOString() }) };
      }
      if (canWrite && end - ms <= RENEW_AT_MS) {
        const newEnd = Math.min(ms + SLICE_MS, nextRealStart, capEnd);
        if (newEnd > end + 30000) {
          const capped = newEnd === capEnd && capEnd < ms + SLICE_MS;
          return { action: 'renewed', start, end: newEnd, message: `call booking in ${room.name} renewed until ${clock(room, newEnd)}${capped ? ' (the longest booking time)' : ''}`, run: cal => cal.updateEvent(current.id, { end: new Date(newEnd).toISOString() }) };
        }
      }
      return null;
    }
    if (!canWrite || state.capped) return null;
    // After a restart the cap is remembered through the last system event: one that ran to the cap and ended recently.
    const spent = owned.some(event => time(event.end) <= ms && time(event.end) > ms - CAP_MEMORY_MS && time(event.end) > state.capClearedAt && time(event.end) - time(event.start) >= maxMs - 60000);
    if (spent) { state.capped = true; log(`the longest booking time (${settings.maxMinutes} minutes) is reached in ${room.name}; no new booking until the call has ended`); return null; }
    if (nextRealStart - ms < MIN_SLICE_MS) return null;
    const end = Math.min(ms + SLICE_MS, nextRealStart);
    return { action: 'created', start: ms, end, message: `Teams call in ${room.name}, booked until ${clock(room, end)}`, run: cal => cal.createEvent({ subject: WALK_IN_SUBJECT, start: new Date(ms).toISOString(), end: new Date(end).toISOString(), organizer: '', autoBooked: true }) };
  }

  async function handleCall(room, state, ms) {
    const events = await listEvents(room.id);
    const canWrite = settings.outsideHours || await open(room, ms);
    const first = plan(room, state, events || [], ms, canWrite);
    if (!first) return;
    await writeWithRefresh(room, state, ms, first.action, fresh => plan(room, state, fresh, ms, canWrite));
  }

  async function finishRelease(room, state, ms) {
    const lastCallAt = state.release.lastCallAt;
    const events = await refreshRoom(room.id);
    const owned = (events || []).find(event => event.autoBooked && time(event.start) <= lastCallAt + 60000 && time(event.end) > ms - GONE_MS && time(event.end) > time(event.start) + 60000);
    const newEnd = owned ? Math.max(time(owned.start) + 60000, (Math.floor(lastCallAt / 60000) + 1) * 60000) : 0;
    if (!owned || newEnd >= time(owned.end)) { state.release = null; return; }
    await calendars.get(room.id).updateEvent(owned.id, { end: new Date(newEnd).toISOString() });
    state.release = null;
    state.lastBooking = { at: ms, start: time(owned.start), end: newEnd, action: 'released' };
    state.problem = '';
    log(`Teams call ended in ${room.name}, booking shortened to end at ${clock(room, newEnd)}`);
    await refreshRoom(room.id).catch(() => {});
    notifyRoom?.(room.id, 'calendar.changed', { reason: 'walk-in' });
  }

  function reportWriteProblem(room, state, ms, error) {
    state.problem = `could not change the calendar (${error?.kind || 'error'}); trying again`;
    if (ms - state.writeLoggedAt >= REPEAT_LOG_MS || !state.writeLoggedAt) {
      state.writeLoggedAt = ms;
      log(`could not update the calendar for ${room.name} (${error?.kind || 'error'}); trying again every ${CHECK_SECONDS} seconds`);
    }
  }

  async function checkRoom(room, reading, failure, ms) {
    const state = states.get(room.id);
    const good = reading && WORD.test(reading.availability) && WORD.test(reading.activity) && reading.availability !== 'PresenceUnknown' && reading.activity !== 'PresenceUnknown';
    if (!good) {
      if (!state.unreadableSince) state.unreadableSince = ms;
      if (!state.unreadableLoggedAt || ms - state.unreadableLoggedAt >= REPEAT_LOG_MS) {
        state.unreadableLoggedAt = ms;
        log(`Teams presence for ${room.name} cannot be read (${failure || 'no answer for this room'})`);
      }
      state.problem = `presence not readable (${failure || 'no answer for this room'})`;
      state.notCallSince = null;
      if (!state.callActive && state.callSeenSince !== null && ms - (state.lastGoodAt ?? state.callSeenSince) >= UNKNOWN_DROP_MS) state.callSeenSince = null;
      return;
    }
    if (state.unreadableSince) {
      log(`Teams presence for ${room.name} can be read again`);
      state.unreadableSince = null; state.unreadableLoggedAt = 0; state.problem = '';
    }
    state.lastGoodAt = ms;
    state.lastReading = { availability: reading.availability, activity: reading.activity, at: ms };
    if (CALL_ACTIVITIES.has(reading.activity)) {
      state.notCallSince = null;
      state.lastCallAt = ms;
      if (state.callSeenSince === null) state.callSeenSince = ms;
      if (!state.callActive && ms - state.callSeenSince >= CONFIRM_MS) {
        state.callActive = true; state.callSince = state.callSeenSince; state.release = null;
        log(`Teams call started in ${room.name} (${reading.availability} / ${reading.activity})`);
        notifyRoom?.(room.id, 'calendar.changed', { reason: 'presence' });
      }
      if (state.callActive) await handleCall(room, state, ms);
      return;
    }
    if (!state.callActive) {
      state.callSeenSince = null;
      if (state.release) await finishRelease(room, state, ms);
      return;
    }
    if (state.notCallSince === null) state.notCallSince = ms;
    if (ms - state.notCallSince >= GONE_MS) {
      state.callActive = false; state.callSince = null; state.callSeenSince = null; state.notCallSince = null;
      state.capped = false; state.capClearedAt = ms;
      state.release = { lastCallAt: state.lastCallAt ?? ms };
      notifyRoom?.(room.id, 'calendar.changed', { reason: 'presence' });
      await finishRelease(room, state, ms);
    }
  }

  async function check(ms = Date.now()) {
    if (!settings.enabled || running || !tracked.length) return;
    running = true;
    try {
      let answers = null, failure = '';
      try {
        const keys = [...new Set(tracked.map(keyOf))];
        answers = await presence.read(keys);
      } catch (error) { failure = error?.kind || 'error'; }
      for (const room of tracked) {
        if (switchedOff(room)) {   // forget the call; an automatic booking already made simply ends within its slice
          const state = states.get(room.id);
          Object.assign(state, { callActive: false, callSeenSince: null, notCallSince: null, callSince: null, release: null, capped: false });
          continue;
        }
        try { await checkRoom(room, answers?.get(keyOf(room)), failure, ms); }
        catch (error) { reportWriteProblem(room, states.get(room.id), ms, error); }
      }
      let anyUnreadable = false;
      for (const room of tracked) {
        const state = states.get(room.id);
        if (!state.unreadableSince) continue;
        anyUnreadable = true;
        if (ms - state.unreadableSince >= PRESENCE_ALERT_MS && !alertState.get(ALERT_KEY) && await open(room, ms)) {
          alertState.set(ALERT_KEY, true);
          await sendAlert?.(`${room.name}: the walk-in call feature cannot read Teams presence (${state.problem.replace(/^presence not readable \(|\)$/g, '') || 'no answer'}). Walk-in bookings are paused. Check that the app has the Presence.Read.All permission with admin consent, and the presenceUserId in rooms.json.`);
        }
      }
      if (!anyUnreadable && alertState.get(ALERT_KEY)) {
        alertState.delete(ALERT_KEY);
        await sendAlert?.('Walk-in calls: Teams presence can be read again.');
      }
    } finally { running = false; }
  }

  return {
    check,
    doorState(roomId) { const state = states.get(roomId); const room = tracked.find(r => r.id === roomId); return state?.callActive && !(room && switchedOff(room)) ? { call: true } : null; },
    roomStatus(roomId) {
      const state = states.get(roomId);
      if (!state) return null;
      return {
        availability: state.lastReading?.availability || '',
        activity: state.lastReading?.activity || '',
        readAt: state.lastReading ? new Date(state.lastReading.at).toISOString() : null,
        call: state.callActive,
        callSince: state.callSince ? new Date(state.callSince).toISOString() : null,
        lastBooking: state.lastBooking ? { action: state.lastBooking.action, start: new Date(state.lastBooking.start).toISOString(), end: new Date(state.lastBooking.end).toISOString() } : null,
        problem: state.problem,
        ...(switchedOff(tracked.find(r => r.id === roomId)) ? { switchedOff: true } : {})
      };
    },
    health() { return { enabled: Boolean(settings.enabled), problem: settings.problem || '', maxMinutes: settings.maxMinutes || 240, outsideHours: Boolean(settings.outsideHours) }; }
  };
}
