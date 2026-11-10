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
function render() { if (!state.room) return; var now = Date.now(); var current = state.events.find(function (event) { return new Date(event.start).getTime() <= now && new Date(event.end).getTime() > now; }); var busy = Boolean(current); $('availability').classList.toggle('busy', busy); $('statusText').textContent = busy ? 'In use' : 'Available'; $('currentMeeting').textContent = busy ? ((current.subject || 'Reserved') + ' · until ' + formatTime(current.end)) : 'No meeting in progress'; $('reserveButton').classList.toggle('hidden', !state.room.allowQuickBooking || busy); var upcoming = state.events.filter(function (event) { return new Date(event.end).getTime() > now - 1800000; }).slice(0, 8); $('eventList').innerHTML = upcoming.length ? upcoming.map(function (event) { var start = new Date(event.start).getTime(), end = new Date(event.end).getTime(); var cls = start <= now && end > now ? 'current' : end <= now ? 'past' : ''; var nextUp = upcoming.find(function (e) { return new Date(e.start).getTime() > now; }); var badge = cls === 'current' ? '<span class="badge now">NOW</span>' : (event === nextUp ? '<span class="badge next">NEXT</span>' : ''); return '<article class="event meeting-row ' + cls + '"><div class="meeting-indicator"></div><div class="meeting-time">' + formatRange(event) + '</div><div class="meeting-subject">' + escapeText(event.subject) + '</div><div class="meeting-organizer">' + escapeText(event.organizer) + '</div><div class="meeting-badge">' + badge + '</div></article>'; }).join('') : '<p class="empty">No more meetings scheduled.</p>'; }
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
async function loadEvents() { try { var data = await api('/api/events?room=' + encodeURIComponent(state.room.id)); state.events = data.events; state.events = previewEvents(state.events); $('syncState').textContent = new URLSearchParams(location.search).get('preview') === 'error' ? 'Calendar temporarily unavailable' : 'Updated ' + formatTime(data.generatedAt); render(); } catch (error) { $('syncState').textContent = 'Calendar temporarily unavailable'; showToast(error.message); } }
async function heartbeat() { if (!state.room || NO_STREAM) return; try { await api('/api/tablets/heartbeat', { method: 'POST', body: JSON.stringify({ roomId: state.room.id, tabletId: state.tabletId, name: state.tabletName || state.room.name + ' tablet' }) }); } catch (_) { } }
function connectStream() { if (state.source) state.source.close(); if (!globalThis.EventSource || NO_STREAM) return; var params = new URLSearchParams({ room: state.room.id, tabletId: state.tabletId, name: state.tabletName || state.room.name + ' tablet' }); var source = state.source = new EventSource('/api/stream?' + params); source.addEventListener('connected', function () { $('syncState').textContent = 'Live updates connected'; }); source.addEventListener('calendar.changed', loadEvents); source.addEventListener('graph.changed', loadEvents); source.addEventListener('room.control', async function (event) { var data = JSON.parse(event.data); activeControl(data.detail.control); if (data.detail.action === 'refresh') await initializeRoom(state.room.id); }); source.onerror = function () { $('syncState').textContent = 'Reconnecting live updates…'; }; }
function showToast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); setTimeout(function () { $('toast').classList.add('hidden'); }, 5000); }
async function initializeRoom(roomId) { state.room = await api('/api/config?room=' + encodeURIComponent(roomId)); localStorage.setItem('selectedRoomId', state.room.id); $('roomName').textContent = state.room.name; document.title = state.room.name + ' · Room Display'; $('picker').classList.add('hidden'); $('display').classList.remove('hidden'); activeControl(state.room.control); updateClock(); await loadEvents(); clearInterval(state.refreshTimer); state.refreshTimer = setInterval(loadEvents, state.room.refreshSeconds * 1000); connectStream(); heartbeat(); }

$('reserveButton').addEventListener('click', function () { $('bookingPanel').classList.remove('hidden'); });
$('cancelBooking').addEventListener('click', function () { $('bookingPanel').classList.add('hidden'); });
$('bookingForm').addEventListener('submit', async function (event) { event.preventDefault(); $('bookingError').textContent = ''; var form = new FormData(event.currentTarget); var duration = Number(form.get('duration')); var start = new Date(Math.ceil(Date.now() / 300000) * 300000); try { await api('/api/bookings', { method: 'POST', body: JSON.stringify({ roomId: state.room.id, subject: $('bookingSubject').value, start: start.toISOString(), end: new Date(start.getTime() + duration * 60000).toISOString() }) }); $('bookingPanel').classList.add('hidden'); showToast('Room reserved'); await loadEvents(); } catch (error) { $('bookingError').textContent = error.message; } });
setInterval(updateClock, 1000); setInterval(heartbeat, 45000); setInterval(render, 30000); document.addEventListener('visibilitychange', function () { if (!document.hidden && state.room) { heartbeat(); loadEvents(); } });
var requestedRoom = roomIdFromLocation(); if (requestedRoom) initializeRoom(requestedRoom).catch(async function (error) { localStorage.removeItem('selectedRoomId'); showToast(error.message); await chooseRoom(); }); else chooseRoom().catch(function (error) { showToast(error.message); });
