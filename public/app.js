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

function roomIdFromLocation() { var match = location.pathname.match(/^\/room\/([a-z0-9-]+)\/?$/); return match ? match[1] : localStorage.getItem('selectedRoomId'); }
async function api(url, options) { var response = await fetch(url, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {})); var data = await response.json().catch(function () { return {}; }); if (!response.ok) throw new Error(data.error || ('Request failed: ' + response.status)); return data; }
function formatTime(value) { return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', timeZone: state.room ? state.room.timeZone : undefined }).format(new Date(value)); }
function formatRange(event) { return formatTime(event.start) + '–' + formatTime(event.end); }
function updateClock() { if (!state.room) return; var now = new Date(); $('clock').textContent = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', timeZone: state.room.timeZone }).format(now); $('date').textContent = new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: state.room.timeZone }).format(now); }
function activeControl(control) { control = control || { displayEnabled: true }; document.body.classList.toggle('display-off', control.displayEnabled === false); var visible = control.message && (!control.messageExpiresAt || new Date(control.messageExpiresAt) > new Date()); $('notice').textContent = visible ? control.message : ''; $('notice').classList.toggle('hidden', !visible); }

async function chooseRoom() { var data = await api('/api/rooms'); $('picker').classList.remove('hidden'); $('display').classList.add('hidden'); $('roomList').innerHTML = ''; data.rooms.forEach(function (room) { var button = document.createElement('button'); button.type = 'button'; button.className = 'room-choice'; button.innerHTML = '<span></span><span>→</span>'; button.firstChild.textContent = room.name; button.addEventListener('click', function () { history.replaceState({}, '', room.displayUrl); initializeRoom(room.id).catch(function (error) { showToast(error.message); }); }); $('roomList').appendChild(button); }); }
function render() { if (!state.room) return; var now = Date.now(); var current = state.events.find(function (event) { return new Date(event.start).getTime() <= now && new Date(event.end).getTime() > now; }); var busy = Boolean(current); var closed = !busy && (!officeOpen(now) || Boolean(state.holiday)); $('availability').classList.toggle('busy', busy); $('availability').classList.toggle('closed', closed); $('statusText').textContent = busy ? 'In use' : (closed ? 'Closed' : 'Available'); $('currentMeeting').textContent = busy ? ((current.subject || 'Reserved') + ' · until ' + formatTime(current.end)) : (closed ? closedText() : freeUntilText(now)); $('reserveButton').classList.toggle('hidden', !state.room.allowQuickBooking || busy || closed); renderQuickBook(now, busy || closed); var upcoming = state.events.filter(function (event) { return new Date(event.end).getTime() > now - 1800000; }).slice(0, 8); $('eventList').innerHTML = upcoming.length ? upcoming.map(function (event) { var start = new Date(event.start).getTime(), end = new Date(event.end).getTime(); var cls = start <= now && end > now ? 'current' : end <= now ? 'past' : ''; var nextUp = upcoming.find(function (e) { return new Date(e.start).getTime() > now; }); var badge = cls === 'current' ? '<span class="badge now">NOW</span>' : (event === nextUp ? '<span class="badge next">NEXT</span>' : ''); return '<article class="event meeting-row ' + cls + '"><div class="meeting-indicator"></div><div class="meeting-time">' + formatRange(event) + '</div><div class="meeting-subject">' + escapeText(event.subject) + '</div><div class="meeting-organizer">' + escapeText(event.organizer) + '</div><div class="meeting-badge">' + badge + '</div></article>'; }).join('') : '<p class="empty">No more meetings scheduled.</p>'; fitRows(); }
// Preview helper: ?preview=free|soon|busy|ended|error swaps in fixed sample meetings.
function previewEvents(events) {
  var mode = new URLSearchParams(location.search).get('preview');
  if (!mode) return events;
  var t = Date.now(), m = 60000;
  function ev(id, subject, from, to) { return { id: id, subject: subject, organizer: 'Demo Organizer', start: new Date(t + from * m).toISOString(), end: new Date(t + to * m).toISOString() }; }
  var later = [ev('p2', 'Project review', 90, 150), ev('p3', 'Design sync', 180, 210)];
  if (mode === 'busy') return [ev('p1', 'Quarterly planning', -20, 25), ev('p2', 'Project review', 60, 120)];
  if (mode === 'soon') return [ev('p1', 'Quarterly planning', 3, 63), ev('p2', 'Project review', 120, 180)];
  if (mode === 'ended') return [ev('p0', 'Team sync', -61, -1)].concat(later);
  if (mode === 'error') return [];
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
    if (index > 0 && row.offsetTop + row.offsetHeight > limit + 1) row.classList.add('hidden');
  });
}
window.addEventListener('resize', fitRows);
async function loadEvents() { try { var data = await api('/api/events?room=' + encodeURIComponent(state.room.id)); state.events = data.events; state.events = previewEvents(state.events); $('syncState').textContent = new URLSearchParams(location.search).get('preview') === 'error' ? 'Calendar temporarily unavailable' : 'Updated ' + formatTime(data.generatedAt); render(); } catch (error) { $('syncState').textContent = 'Calendar temporarily unavailable'; showToast(error.message); } }
async function heartbeat() { if (!state.room || NO_STREAM) return; try { await api('/api/tablets/heartbeat', { method: 'POST', body: JSON.stringify({ roomId: state.room.id, tabletId: state.tabletId, name: state.tabletName || state.room.name + ' tablet' }) }); } catch (_) { } }
function connectStream() { if (state.source) state.source.close(); if (!globalThis.EventSource || NO_STREAM) return; var params = new URLSearchParams({ room: state.room.id, tabletId: state.tabletId, name: state.tabletName || state.room.name + ' tablet' }); var source = state.source = new EventSource('/api/stream?' + params); source.addEventListener('connected', function () { $('syncState').textContent = 'Live updates connected'; }); source.addEventListener('calendar.changed', loadEvents); source.addEventListener('graph.changed', loadEvents); source.addEventListener('room.control', async function (event) { var data = JSON.parse(event.data); activeControl(data.detail.control); if (data.detail.action === 'refresh') await initializeRoom(state.room.id); }); source.onerror = function () { $('syncState').textContent = 'Reconnecting live updates…'; }; }
function showToast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); setTimeout(function () { $('toast').classList.add('hidden'); }, 5000); }
async function initializeRoom(roomId) { state.room = await api('/api/config?room=' + encodeURIComponent(roomId)); var qb = new URLSearchParams(location.search).get('quickbook'); if (qb === '0') state.room.allowQuickBooking = false; else if (qb !== null) state.room.allowQuickBooking = true; localStorage.setItem('selectedRoomId', state.room.id); $('roomName').textContent = state.room.name; document.title = state.room.name + ' · Room Display'; $('picker').classList.add('hidden'); $('display').classList.remove('hidden'); activeControl(previewControl(state.room.control)); updateClock(); await loadEvents(); clearInterval(state.refreshTimer); state.refreshTimer = setInterval(loadEvents, state.room.refreshSeconds * 1000); connectStream(); heartbeat(); loadCelebrations(); }

$('reserveButton').addEventListener('click', function () { $('bookingPanel').classList.remove('hidden'); });
$('cancelBooking').addEventListener('click', function () { $('bookingPanel').classList.add('hidden'); });
$('bookingForm').addEventListener('submit', async function (event) { event.preventDefault(); $('bookingError').textContent = ''; var form = new FormData(event.currentTarget); var duration = Number(form.get('duration')); var start = new Date(Math.ceil(Date.now() / 300000) * 300000); try { await api('/api/bookings', { method: 'POST', body: JSON.stringify({ roomId: state.room.id, subject: $('bookingSubject').value, start: start.toISOString(), end: new Date(start.getTime() + duration * 60000).toISOString() }) }); $('bookingPanel').classList.add('hidden'); showToast('Room reserved'); await loadEvents(); } catch (error) { $('bookingError').textContent = error.message; } });
setInterval(updateClock, 1000); setInterval(heartbeat, 45000); setInterval(render, 30000); document.addEventListener('visibilitychange', function () { if (!document.hidden && state.room) { heartbeat(); loadEvents(); } });
var requestedRoom = roomIdFromLocation(); if (requestedRoom) initializeRoom(requestedRoom).catch(async function (error) { localStorage.removeItem('selectedRoomId'); showToast(error.message); await chooseRoom(); }); else chooseRoom().catch(function (error) { showToast(error.message); });

// Birthdays and work anniversaries from the shared calendar (see /api/celebrations).
// Preview without a calendar: ?celebrate=birthday|anniversary|both
function celebrationLines(items) {
  function join(names) { return names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names[0]; }
  var birthdays = items.filter(function (i) { return i.kind === 'birthday'; }).map(function (i) { return i.name; });
  var anniversaries = items.filter(function (i) { return i.kind === 'anniversary'; });
  var lines = [];
  if (birthdays.length) lines.push('\uD83C\uDF82 Happy birthday, ' + join(birthdays.slice(0, 4)) + (birthdays.length > 4 ? ' +' + (birthdays.length - 4) + ' more' : '') + '!');
  anniversaries.slice(0, 3).forEach(function (i) { lines.push('\uD83C\uDF89 Happy ' + (i.years ? i.years + '-year ' : '') + 'work anniversary, ' + i.name + '!'); });
  return lines;
}
function showCelebrations(items) {
  var box = $('celebration');
  var lines = celebrationLines(items || []);
  box.textContent = '';
  lines.forEach(function (text) { var line = document.createElement('p'); line.textContent = text; box.appendChild(line); });
  box.classList.toggle('hidden', lines.length === 0);
  if (lines.length) document.documentElement.dataset.celebrate = '1'; else delete document.documentElement.dataset.celebrate;
  fitRows();
}
function applyHoliday(name) { var next = name || ''; if (next !== (state.holiday || '')) { state.holiday = next; render(); } }
async function loadCelebrations() {
  var holidayPreview = new URLSearchParams(location.search).get('holiday');   // preview: ?holiday=Thanksgiving or none
  if (holidayPreview !== null) applyHoliday(holidayPreview === 'none' ? '' : holidayPreview);
  var preview = new URLSearchParams(location.search).get('celebrate');
  if (preview) {
    var sample = [];
    if (preview === 'birthday' || preview === 'both') sample.push({ kind: 'birthday', name: 'Jane' }, { kind: 'birthday', name: 'Sam' });
    if (preview === 'anniversary' || preview === 'both') sample.push({ kind: 'anniversary', name: 'Alex', years: 5 });
    return showCelebrations(sample);
  }
  if (!state.room) return;
  try {
    var data = await api('/api/celebrations?room=' + encodeURIComponent(state.room.id));
    showCelebrations(state.room.showCelebrations === false ? [] : data.celebrations);
    if (new URLSearchParams(location.search).get('holiday') === null) applyHoliday(data.holiday && data.holiday.name);
  } catch (_) { /* keep what is showing */ }
}
setInterval(loadCelebrations, 15 * 60 * 1000);

// Refresh button and "send a message" panel (uses the same admin API as the dashboard).
$('refreshButton').addEventListener('click', function () {
  if (!state.room) return;
  showToast('Refreshing\u2026');
  initializeRoom(state.room.id).catch(function (error) { showToast(error.message); });
});
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
