'use strict';

function generateId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  var bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  var hex = Array.prototype.map.call(bytes, function (value) { return value.toString(16).padStart(2, '0'); });
  return [hex.slice(0, 4).join(''), hex.slice(4, 6).join(''), hex.slice(6, 8).join(''), hex.slice(8, 10).join(''), hex.slice(10, 16).join('')].join('-');
}

function $(id) { return document.getElementById(id); }
function escapeText(value) { var node = document.createElement('span'); node.textContent = String(value || ''); return node.innerHTML; }
// ?nostream=1 keeps preview iframes from opening live connections or registering as tablets.
var NO_STREAM = new URLSearchParams(location.search).has('nostream');
var savedTabletId = localStorage.getItem('tabletId');
var state = { room: null, events: [], source: null, refreshTimer: null, tabletId: savedTabletId || generateId(), tabletName: localStorage.getItem('tabletName') || '' };
localStorage.setItem('tabletId', state.tabletId);
state.liveAt = Date.now();   // when the live connection last proved it was alive (see the auto-heal watchdog below)
// Kiosk mode (?kiosk=1): hides the refresh and message buttons so visitors cannot tap them on a wall tablet.
var IS_KIOSK = new URLSearchParams(location.search).get('kiosk') === '1';
var HAS_TOUCH = (navigator.maxTouchPoints || 0) > 1;   // wall tablets; the server skips offline alerts for desktop test browsers
if (IS_KIOSK) document.documentElement.classList.add('kiosk');

function roomIdFromLocation() { var match = location.pathname.match(/^\/room\/([a-z0-9-]+)\/?$/); return match ? match[1] : localStorage.getItem('selectedRoomId'); }
async function api(url, options) { var response = await fetch(url, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {})); var data = await response.json().catch(function () { return {}; }); if (!response.ok) { var failure = new Error(data.error || ('Request failed: ' + response.status)); failure.reason = data.reason || ''; failure.status = response.status; throw failure; } return data; }
function formatTime(value) { return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', timeZone: state.room ? state.room.timeZone : undefined }).format(new Date(value)); }
function formatRange(event) { return formatTime(event.start) + '–' + formatTime(event.end); }
function updateClock() { if (!state.room) return; var now = new Date(); $('clock').textContent = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', timeZone: state.room.timeZone }).format(now); $('date').textContent = new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: state.room.timeZone }).format(now); }
function activeControl(control) { control = control || { displayEnabled: true }; document.body.classList.toggle('display-off', control.displayEnabled === false); var visible = control.message && (!control.messageExpiresAt || new Date(control.messageExpiresAt) > new Date()); $('notice').textContent = visible ? control.message : ''; $('notice').classList.toggle('hidden', !visible); pushOutfit(control); }
// An outfit pushed from the dashboard: Snoopy (snoopy.js) wears it until outfitUntil, then goes back to the automatic choice.
function pushOutfit(control) {
  var root = document.documentElement;
  clearTimeout(state.outfitTimer);
  var until = control.outfitUntil ? Date.parse(control.outfitUntil) : 0;
  if (control.outfit && until > Date.now()) {
    root.setAttribute('data-outfit-until', String(until));
    root.setAttribute('data-outfit-override', control.outfit);
    state.outfitTimer = setTimeout(function () {
      root.removeAttribute('data-outfit-override'); root.removeAttribute('data-outfit-until');
      if (state.room) api('/api/config?room=' + encodeURIComponent(state.room.id)).then(function (data) { if (data.control) activeControl(data.control); }).catch(function () { });
    }, Math.min(until - Date.now() + 500, 2147483000));
  } else { root.removeAttribute('data-outfit-override'); root.removeAttribute('data-outfit-until'); }
}

async function chooseRoom() { var data = await api('/api/rooms'); $('picker').classList.remove('hidden'); $('display').classList.add('hidden'); $('roomList').innerHTML = ''; data.rooms.forEach(function (room) { var button = document.createElement('button'); button.type = 'button'; button.className = 'room-choice'; button.innerHTML = '<span></span><span>→</span>'; button.firstChild.textContent = room.name; button.addEventListener('click', function () { history.replaceState({}, '', room.displayUrl + location.search); initializeRoom(room.id).catch(function (error) { showToast(error.message); }); }); $('roomList').appendChild(button); }); }
function render() { if (!state.room) return; var now = Date.now(); var current = state.events.find(function (event) { return new Date(event.start).getTime() <= now && new Date(event.end).getTime() > now; }); var busy = Boolean(current); var closed = !busy && (!officeOpen(now) || Boolean(state.holiday)); if (closed) document.documentElement.dataset.closed = '1'; else delete document.documentElement.dataset.closed; $('availability').classList.toggle('busy', busy); $('availability').classList.toggle('closed', closed); $('statusText').textContent = busy ? 'In use' : (closed ? 'Closed' : 'Available'); $('currentMeeting').textContent = busy ? ((current.subject || 'Reserved') + ' · until ' + formatTime(current.end)) : (closed ? closedText() : freeUntilText(now)); $('reserveButton').classList.toggle('hidden', !state.room.allowQuickBooking || busy || closed); renderQuickBook(now, busy || closed); var todayKey = dayKey(now); var upcoming = state.events.filter(function (event) { return new Date(event.end).getTime() > now - 1800000 && dayKey(event.start) <= todayKey; }).slice(0, 8); $('eventList').innerHTML = upcoming.length ? upcoming.map(function (event) { var start = new Date(event.start).getTime(), end = new Date(event.end).getTime(); var cls = start <= now && end > now ? 'current' : end <= now ? 'past' : ''; var nextUp = upcoming.find(function (e) { return new Date(e.start).getTime() > now; }); var badge = cls === 'current' ? '<span class="badge now">NOW</span>' : (event === nextUp ? '<span class="badge next">NEXT</span>' : ''); return '<article class="event meeting-row ' + cls + '"><div class="meeting-indicator"></div><div class="meeting-time">' + formatRange(event) + '</div><div class="meeting-subject">' + escapeText(event.subject) + '</div><div class="meeting-organizer">' + escapeText(event.organizer) + '</div><div class="meeting-badge">' + badge + '</div></article>'; }).join('') : '<p class="empty">' + escapeText(noMoreText(now, todayKey)) + '</p>'; fitRows(); }
// Preview helper: ?preview=free|soon|busy|ended|error swaps in fixed sample meetings.
function previewEvents(events) {
  var mode = new URLSearchParams(location.search).get('preview');
  if (!mode) return events;
  // Times are counted from the first page load, so a preview meeting really starts and ends (Snoopy reacts to that).
  var t = state.previewStartedAt || (state.previewStartedAt = Date.now()), m = 60000;
  function ev(id, subject, from, to) { return { id: id, subject: subject, organizer: 'Demo Organizer', start: new Date(t + from * m).toISOString(), end: new Date(t + to * m).toISOString() }; }
  var later = [ev('p2', 'Project review', 90, 150), ev('p3', 'Design sync', 180, 210)];
  if (mode === 'busy') return [ev('p1', 'Quarterly planning', -20, 25), ev('p2', 'Project review', 60, 120)];
  if (mode === 'soon') return [ev('p1', 'Quarterly planning', 3, 63), ev('p2', 'Project review', 120, 180)];
  if (mode === 'ended') return [ev('p0', 'Team sync', -61, -1)].concat(later);
  if (mode === 'error' || mode === 'outage') return [];
  if (mode === 'starting') return [ev('p1', 'Quarterly planning', 0.5, 45)].concat(later);           // starts 30 seconds after loading
  if (mode === 'wrapup') return [ev('p1', 'Quarterly planning', -40, 3), ev('p2', 'Project review', 4, 60)];   // last minutes, next one right after
  if (mode === 'tomorrow') return [ev('p1', 'Planning meeting', 30 * 60, 31 * 60)];     // only a meeting on a later day
  return later;
}
// Hide the schedule rows that do not fit, so the page never needs to scroll.
function fitRows() {
  var list = $('eventList');
  if (!list) return;
  var rows = Array.prototype.slice.call(list.querySelectorAll('.event'));
  rows.forEach(function (row) { row.classList.remove('hidden'); });
  var limit = list.clientHeight;
  rows.forEach(function (row, index) {
    if (row.offsetTop + row.offsetHeight > limit + 1) row.classList.add('hidden');
  });
}
window.addEventListener('resize', fitRows);
async function loadEvents() {
  var preview = new URLSearchParams(location.search).get('preview');
  try {
    var data = await api('/api/events?room=' + encodeURIComponent(state.room.id));
    state.events = previewEvents(data.events);
    state.lastGoodAt = data.generatedAt;
    state.syncProblem = '';
    $('syncState').textContent = preview === 'error' ? 'Calendar temporarily unavailable' : preview === 'outage' ? outageText() : 'Updated ' + formatTime(data.generatedAt);
    render();
  } catch (error) {
    // The meetings already on screen stay. A message pops up once per problem, not on every refresh.
    var kind = error.reason || 'other';
    $('syncState').textContent = kind === 'microsoft-down' ? outageText() : 'Calendar temporarily unavailable';
    if (state.syncProblem !== kind) showToast(error.message);
    state.syncProblem = kind;
  }
}
// "Microsoft 365 is not responding · showing meetings from 2:41 PM" (Snoopy looks for "not responding" too).
function outageText() { return 'Microsoft 365 is not responding' + (state.lastGoodAt ? ' \u00b7 showing meetings from ' + formatTime(state.lastGoodAt) : ''); }
async function heartbeat() { if (!state.room || NO_STREAM) return; try { await api('/api/tablets/heartbeat', { method: 'POST', body: JSON.stringify({ roomId: state.room.id, tabletId: state.tabletId, name: state.tabletName || state.room.name + ' tablet', screen: window.innerWidth + 'x' + window.innerHeight + ' @' + (Math.round((window.devicePixelRatio || 1) * 100) / 100), kiosk: IS_KIOSK, touch: HAS_TOUCH }) }); } catch (_) { } }
function connectStream() { if (state.source) state.source.close(); if (!globalThis.EventSource || NO_STREAM) return; var params = new URLSearchParams({ room: state.room.id, tabletId: state.tabletId, name: state.tabletName || state.room.name + ' tablet', kiosk: IS_KIOSK ? '1' : '0', touch: HAS_TOUCH ? '1' : '0' }); var source = state.source = new EventSource('/api/stream?' + params); source.addEventListener('connected', function () { state.liveAt = Date.now(); $('syncState').textContent = 'Live updates connected'; }); source.addEventListener('ping', function () { state.liveAt = Date.now(); }); source.addEventListener('calendar.changed', loadEvents); source.addEventListener('graph.changed', loadEvents); source.addEventListener('room.control', async function (event) { var data = JSON.parse(event.data); activeControl(data.detail.control); if (data.detail.action === 'refresh') await reloadPage(); }); source.onerror = function () { $('syncState').textContent = 'Reconnecting live updates…'; }; }
function showToast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); setTimeout(function () { $('toast').classList.add('hidden'); }, 5000); }
async function initializeRoom(roomId) { state.room = await api('/api/config?room=' + encodeURIComponent(roomId)); var qb = new URLSearchParams(location.search).get('quickbook'); if (qb === '0') state.room.allowQuickBooking = false; else if (qb !== null) state.room.allowQuickBooking = true; localStorage.setItem('selectedRoomId', state.room.id); $('roomName').textContent = state.room.name; document.title = state.room.name + ' · Room Display'; $('picker').classList.add('hidden'); $('display').classList.remove('hidden'); activeControl(previewControl(state.room.control)); updateClock(); await loadEvents(); clearInterval(state.refreshTimer); state.refreshTimer = setInterval(loadEvents, state.room.refreshSeconds * 1000); connectStream(); heartbeat(); loadCelebrations(); loadWeatherAlerts(); }

$('reserveButton').addEventListener('click', function () { $('bookingPanel').classList.remove('hidden'); });
$('cancelBooking').addEventListener('click', function () { $('bookingPanel').classList.add('hidden'); });
$('bookingForm').addEventListener('submit', async function (event) { event.preventDefault(); $('bookingError').textContent = ''; var form = new FormData(event.currentTarget); var duration = Number(form.get('duration')); var start = new Date(Math.ceil(Date.now() / 300000) * 300000); try { await api('/api/bookings', { method: 'POST', body: JSON.stringify({ roomId: state.room.id, subject: $('bookingSubject').value, start: start.toISOString(), end: new Date(start.getTime() + duration * 60000).toISOString() }) }); $('bookingPanel').classList.add('hidden'); showToast('Room reserved'); document.dispatchEvent(new CustomEvent('room-booked')); await loadEvents(); } catch (error) { $('bookingError').textContent = error.message; } });
setInterval(updateClock, 1000); setInterval(heartbeat, 45000); setInterval(render, 30000); document.addEventListener('visibilitychange', function () { if (!document.hidden && state.room) { heartbeat(); loadEvents(); } });
var requestedRoom = roomIdFromLocation(); if (requestedRoom) initializeRoom(requestedRoom).catch(async function (error) { localStorage.removeItem('selectedRoomId'); showToast(error.message); await chooseRoom(); }); else chooseRoom().catch(function (error) { showToast(error.message); });

// Birthdays and work anniversaries from the shared calendar (see /api/celebrations).
// Preview without a calendar: ?celebrate=birthday|anniversary|both
function celebrationLines(items) {
  function join(names) { return names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names[0]; }
  // Today first, then the closed days that follow (for example a Saturday birthday shows on Friday).
  var order = [], groups = {};
  items.forEach(function (item) { var key = item.day || ''; if (!groups[key]) { groups[key] = []; order.push(key); } groups[key].push(item); });
  var lines = [];
  order.forEach(function (key) {
    var suffix = key ? ' (' + key + ')' : '';
    var birthdays = groups[key].filter(function (i) { return i.kind === 'birthday'; }).map(function (i) { return i.name; });
    var anniversaries = groups[key].filter(function (i) { return i.kind === 'anniversary'; });
    if (birthdays.length) lines.push('\uD83C\uDF82 Happy birthday, ' + join(birthdays.slice(0, 4)) + (birthdays.length > 4 ? ' +' + (birthdays.length - 4) + ' more' : '') + suffix + '!');
    anniversaries.slice(0, 3).forEach(function (i) { lines.push('\uD83C\uDF89 Happy ' + (i.years ? i.years + '-year ' : '') + 'work anniversary, ' + i.name + suffix + '!'); });
  });
  return lines.slice(0, 4);
}
function showCelebrations(items) {
  var box = $('celebration');
  var lines = celebrationLines(items || []);
  box.textContent = '';
  lines.forEach(function (text) { var line = document.createElement('p'); line.textContent = text; box.appendChild(line); });
  box.classList.toggle('hidden', lines.length === 0);
  if (lines.length) document.documentElement.dataset.celebrate = '1'; else delete document.documentElement.dataset.celebrate;
  // Snoopy's party look only for entries that are today (not the weekend ones shown early on Friday): a birthday
  // (party hat), a work anniversary (anniversary vest), or both on the same day (vest and party hat).
  var todays = (items || []).filter(function (item) { return !item.day; });
  if (todays.some(function (item) { return item.kind === 'birthday'; })) document.documentElement.dataset.birthday = '1'; else delete document.documentElement.dataset.birthday;
  if (todays.some(function (item) { return item.kind === 'anniversary'; })) document.documentElement.dataset.anniversary = '1'; else delete document.documentElement.dataset.anniversary;
  fitRows();
}
function applyHoliday(name) { var next = name || ''; if (next !== (state.holiday || '')) { state.holiday = next; render(); } }
// "Closed tomorrow: Thanksgiving" heads-up. Preview: ?closedsoon=Thanksgiving (or none).
function showClosedSoon(info) {
  var box = $('closedSoon');
  var text = info ? 'Closed ' + info.dayLabel + (info.through ? ' through ' + info.through : '') + ': ' + info.name : '';
  box.textContent = text;
  box.classList.toggle('hidden', !text);
  fitRows();
}
// Official weather warnings from the National Weather Service, shown on the status card. Preview: ?warning=Winter Storm Warning
// (red; add |watch for the amber kind), several separated by ; (Winter Storm Warning;Flood Watch|watch), or ?warning=none.
function weatherAlertText(alerts, timeZone) {
  if (!alerts || !alerts.length) return '';
  var first = alerts[0];
  var until = '';
  if (first.ends) until = ' until ' + new Intl.DateTimeFormat('en-US', { timeZone: timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(first.ends));
  return '\u26A0 ' + first.event + until + (alerts.length > 1 ? ' (+' + (alerts.length - 1) + ' more)' : '');
}
function showWeatherAlert(alerts) {
  var box = $('weatherAlert');
  var text = weatherAlertText(alerts, state.room ? state.room.timeZone : undefined);
  box.textContent = text;
  box.dataset.level = alerts && alerts[0] && alerts[0].notify ? 'severe' : 'watch';
  box.classList.toggle('hidden', !text);
  fitRows();
}
async function loadWeatherAlerts() {
  var preview = new URLSearchParams(location.search).get('warning');
  if (preview !== null) {
    var sample = preview && preview !== 'none' ? preview.split(';').map(function (item) {
      var parts = item.split('|');
      return { event: parts[0], notify: parts[1] !== 'watch', ends: new Date(Date.now() + 5 * 3600000).toISOString() };
    }) : [];
    return showWeatherAlert(sample);
  }
  if (!state.room || NO_STREAM) return;
  try { showWeatherAlert((await api('/api/weather')).alerts || []); } catch (_) { /* keep what is showing */ }
}
setInterval(loadWeatherAlerts, 5 * 60 * 1000);
async function loadCelebrations() {
  var closedPreview = new URLSearchParams(location.search).get('closedsoon');
  if (closedPreview !== null) showClosedSoon(closedPreview && closedPreview !== 'none' ? { name: closedPreview, dayLabel: 'tomorrow', through: null } : null);
  var holidayPreview = new URLSearchParams(location.search).get('holiday');   // preview: ?holiday=Thanksgiving or none
  if (holidayPreview !== null) applyHoliday(holidayPreview === 'none' ? '' : holidayPreview);
  var preview = new URLSearchParams(location.search).get('celebrate');
  if (preview) {
    var sample = [];
    if (preview === 'birthday' || preview === 'both') sample.push({ kind: 'birthday', name: 'Jane' }, { kind: 'birthday', name: 'Sam' });
    if (preview === 'anniversary' || preview === 'both') sample.push({ kind: 'anniversary', name: 'Alex', years: 5 });
    if (preview === 'weekend') sample.push({ kind: 'birthday', name: 'Mabel', day: 'Saturday' }, { kind: 'anniversary', name: 'Alex', years: 5, day: 'Sunday' });
    return showCelebrations(sample);
  }
  if (!state.room) return;
  try {
    var data = await api('/api/celebrations?room=' + encodeURIComponent(state.room.id));
    showCelebrations(state.room.showCelebrations === false ? [] : data.celebrations);
    if (new URLSearchParams(location.search).get('holiday') === null) applyHoliday(data.holiday && data.holiday.name);
    if (new URLSearchParams(location.search).get('closedsoon') === null) showClosedSoon(data.nextHoliday);
  } catch (_) { /* keep what is showing */ }
}
setInterval(loadCelebrations, 15 * 60 * 1000);

// Refresh button and "send a message" panel (uses the same admin API as the dashboard).
// A real reload, so new code, styles and outfits are picked up (not just the meetings). Only when the server answers,
// so a refresh during an outage never leaves the tablet on a browser error page; then it just re-reads the meetings.
async function reloadPage() {
  showToast('Refreshing\u2026');
  try {
    var response = await fetch('/healthz', { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
    if (!response.ok) throw new Error('server not ready');
  } catch (_) {
    showToast('Server not reachable, showing the latest meetings instead');
    if (state.room) initializeRoom(state.room.id).catch(function () { });
    return;
  }
  location.reload();
}
$('refreshButton').addEventListener('click', function () { reloadPage(); });
function closeMessagePanel() { $('messagePanel').classList.add('hidden'); $('messageError').textContent = ''; }
$('messageButton').addEventListener('click', function () {
  $('messageToken').value = sessionStorage.getItem('adminToken') || '';
  $('messageText').value = (state.room && state.room.control && state.room.control.message) || '';
  $('messagePanel').classList.remove('hidden');
  $('messageText').focus();
});
$('messageCancel').addEventListener('click', closeMessagePanel);
$('messagePanel').addEventListener('click', function (event) { if (event.target === $('messagePanel')) closeMessagePanel(); });
async function sendControl(action, extra) {
  var token = $('messageToken').value.trim();
  if (!token) throw new Error('Enter the administrator token.');
  var response = await fetch('/api/admin/rooms/' + encodeURIComponent(state.room.id) + '/control', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(Object.assign({ action: action }, extra || {})) });
  var data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || ('Request failed: ' + response.status));
  sessionStorage.setItem('adminToken', token);
  if (data.control) activeControl(data.control);
  return data;
}
$('messageForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  $('messageError').textContent = '';
  var text = $('messageText').value.trim();
  if (!text) { $('messageError').textContent = 'Type a message first.'; return; }
  try { await sendControl('message', { message: text, ttlMinutes: Number($('messageTtl').value) }); closeMessagePanel(); showToast('Message sent'); } catch (error) { $('messageError').textContent = error.message; }
});
$('messageClear').addEventListener('click', async function () {
  $('messageError').textContent = '';
  try { await sendControl('clearMessage'); $('messageText').value = ''; closeMessagePanel(); showToast('Message cleared'); } catch (error) { $('messageError').textContent = error.message; }
});

// "Free until 2:30 PM" and one-tap booking buttons (15, 30, 60 minutes starting now).
function nextMeeting(now) { return state.events.find(function (event) { return new Date(event.start).getTime() > now; }); }
function dayKey(value) { return new Intl.DateTimeFormat('en-CA', { timeZone: state.room.timeZone }).format(new Date(value)); }
function freeUntilText(now) {
  var next = nextMeeting(now);
  var left = minutesToClose(now);                    // null when office hours are off
  var gap = next ? (new Date(next.start).getTime() - now) / 60000 : Infinity;
  if (left !== null && gap > left) return 'Free until ' + clockText(state.room.officeHours.endMinutes);
  if (!next) return 'Free for the rest of the day';
  return 'Free until ' + (dayKey(next.start) === dayKey(now) ? '' : 'tomorrow ') + formatTime(next.start);
}
function renderQuickBook(now, busy) {
  var box = $('quickBook');
  var next = nextMeeting(now);
  var gap = next ? (new Date(next.start).getTime() - now) / 60000 : Infinity;
  var left = minutesToClose(now);
  if (left !== null) gap = Math.min(gap, left);       // never offer a slot that runs past closing time
  var any = false;
  Array.prototype.forEach.call(box.querySelectorAll('button'), function (button) {
    var fits = gap >= Number(button.dataset.minutes);
    button.classList.toggle('hidden', !fits);
    any = any || fits;
  });
  box.classList.toggle('hidden', !(state.room.allowQuickBooking && !busy && any));
}
var booking = false;
async function bookNow(minutes) {
  if (booking || !state.room) return;
  booking = true;
  var start = new Date(Math.floor(Date.now() / 60000) * 60000);
  try {
    await api('/api/bookings', { method: 'POST', body: JSON.stringify({ roomId: state.room.id, subject: 'Reserved', start: start.toISOString(), end: new Date(start.getTime() + minutes * 60000).toISOString() }) });
    showToast('Room reserved for ' + minutes + ' minutes');
    document.dispatchEvent(new CustomEvent('room-booked'));
    await loadEvents();
  } catch (error) { showToast(error.message); }
  booking = false;
}
$('quickBook').addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('button') : null;
  if (button && button.dataset.minutes) bookNow(Number(button.dataset.minutes));
});

// Quiet nightly reload so tablets left on for weeks start fresh (new code, no memory build-up).
// Reloads once per night between 3:30 and 3:50 in the room's time zone, spread by tablet id.
function nightReloadDue(hour, minute, offset, today, lastDate, uptimeMs) {
  return hour === 3 && minute >= 30 + offset && minute < 50 && lastDate !== today && uptimeMs > 6 * 3600000;
}
function checkNightReload() {
  if (!state.room || NO_STREAM) return;
  var parts = new Intl.DateTimeFormat('en-US', { timeZone: state.room.timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  var hour = Number(parts.filter(function (p) { return p.type === 'hour'; })[0].value);
  var minute = Number(parts.filter(function (p) { return p.type === 'minute'; })[0].value);
  var sum = 0; for (var i = 0; i < state.tabletId.length; i += 1) sum += state.tabletId.charCodeAt(i);
  var today = dayKey(Date.now());
  if (!nightReloadDue(hour, minute, sum % 15, today, localStorage.getItem('lastNightReload'), performance.now())) return;
  if (!$('bookingPanel').classList.contains('hidden') || !$('messagePanel').classList.contains('hidden')) return;
  localStorage.setItem('lastNightReload', today);
  location.reload();
}
setInterval(checkNightReload, 60000);

// Auto-heal a stuck live connection. The server sends a "ping" every 25 seconds; a connection that has gone
// quiet without ever reporting an error (common after Wi-Fi drops or the tablet sleeps) is replaced, and if it
// stays quiet for 5 minutes the page reloads itself. It only reloads when the server answers /healthz, so an
// outage never leaves the kiosk on a browser error page, and at most once every 10 minutes.
var STALE_MS = 75000, RELOAD_AFTER_MS = 5 * 60000, MIN_BETWEEN_RELOADS_MS = 10 * 60000;
function healAction(silentMs, sinceReloadMs) {
  if (silentMs < STALE_MS) return 'ok';
  if (silentMs >= RELOAD_AFTER_MS && sinceReloadMs >= MIN_BETWEEN_RELOADS_MS) return 'reload';
  return 'reconnect';
}
async function checkConnection() {
  if (!state.room || NO_STREAM || !globalThis.EventSource) return;
  var lastReload = Number(localStorage.getItem('lastHealReload') || 0);
  var action = healAction(Date.now() - state.liveAt, Date.now() - lastReload);
  if (action === 'ok') return;
  $('syncState').textContent = 'Reconnecting live updates…';
  if (action === 'reconnect') { connectStream(); return; }
  if (!$('bookingPanel').classList.contains('hidden') || !$('messagePanel').classList.contains('hidden')) return;
  try {
    var response = await fetch('/healthz', { cache: 'no-store' });
    if (!response.ok) throw new Error('server not ready');
  } catch (_) { connectStream(); return; }
  localStorage.setItem('lastHealReload', String(Date.now()));
  location.reload();
}
setInterval(checkConnection, 30000);

// Office hours: outside them the display says "Closed" (a meeting still in progress shows In use).
// Preview: ?hours=open or ?hours=closed forces the state.
function localClock(now) {
  var parts = new Intl.DateTimeFormat('en-US', { timeZone: state.room.timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now));
  function part(type) { return parts.filter(function (p) { return p.type === type; })[0].value; }
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday')), minutes: Number(part('hour')) * 60 + Number(part('minute')) };
}
function officeOpen(now) {
  var forced = new URLSearchParams(location.search).get('hours');
  if (forced === 'open') return true;
  if (forced === 'closed') return false;
  var hours = state.room.officeHours;
  if (!hours) return true;
  var clock = localClock(now);
  return hours.days.indexOf(clock.day) !== -1 && clock.minutes >= hours.startMinutes && clock.minutes < hours.endMinutes;
}
function minutesToClose(now) {
  var hours = state.room.officeHours;
  if (!hours || new URLSearchParams(location.search).get('hours') === 'open') return null;
  return hours.endMinutes - localClock(now).minutes;
}
function clockText(minutes) {
  var h = Math.floor(minutes / 60) % 24, m = minutes % 60;
  return ((h % 12) || 12) + ':' + ('0' + m).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM');
}
function closedText() {
  if (state.holiday) return state.holiday + ' \u00b7 office closed, no bookings';
  var hours = state.room.officeHours;
  return hours ? 'Office hours ' + clockText(hours.startMinutes) + ' \u2013 ' + clockText(hours.endMinutes) : 'Closed';
}

// Preview only: ?display=off turns the screen black, ?message=Some+text shows the admin banner.
function previewControl(control) {
  var params = new URLSearchParams(location.search);
  if (!params.has('display') && !params.has('message')) return control;
  return Object.assign({}, control, { displayEnabled: params.get('display') !== 'off', message: params.get('message') || '', messageExpiresAt: null });
}

// "Today's schedule" only lists today. When nothing is left, mention the next meeting on a later day.
// The day after a YYYY-MM-DD key, by calendar arithmetic. Adding 24 hours to a clock time is wrong on the two
// daylight saving days a year (23 and 25 hours long); noon UTC keeps the arithmetic clear of them.
function nextDayKey(key) {
  var d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function noMoreText(now, todayKey) {
  var later = state.events.find(function (event) { return dayKey(event.start) > todayKey; });
  if (!later) return 'No more meetings today.';
  var label = dayKey(later.start) === nextDayKey(todayKey) ? 'tomorrow' : new Intl.DateTimeFormat([], { weekday: 'long', timeZone: state.room.timeZone }).format(new Date(later.start));
  return 'No more meetings today. Next: ' + label + ' at ' + formatTime(later.start) + '.';
}
