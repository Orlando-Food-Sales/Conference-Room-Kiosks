const state = { config: null, events: [], loading: false };
const $ = (selector) => document.querySelector(selector);
const elements = {
  roomName: $('#room-name'), clockTime: $('#clock-time'), clockDate: $('#clock-date'),
  statusPanel: $('#status-panel'), statusLabel: $('#status-label'), statusTitle: $('#status-title'),
  statusDetail: $('#status-detail'), syncState: $('#sync-state'), agenda: $('#agenda'),
  reserveButton: $('#reserve-button'), refreshButton: $('#refresh-button'),
  dialog: $('#booking-dialog'), bookingForm: $('#booking-form'), bookingError: $('#booking-error'),
  closeDialog: $('#close-dialog'), confirmBooking: $('#confirm-booking'), toast: $('#toast'),
};

function formatter(options) {
  return new Intl.DateTimeFormat(undefined, { timeZone: state.config?.displayTimeZone || 'UTC', ...options });
}

function updateClock() {
  const now = new Date();
  elements.clockTime.textContent = formatter({ hour: 'numeric', minute: '2-digit' }).format(now);
  elements.clockDate.textContent = formatter({ weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  renderStatus();
}

function activeEvent(now = new Date()) {
  return state.events.find((event) => new Date(event.start) <= now && new Date(event.end) > now);
}

function nextEvent(now = new Date()) {
  return state.events.find((event) => new Date(event.start) > now);
}

function minutesBetween(a, b) {
  return Math.max(0, Math.ceil((new Date(b) - new Date(a)) / 60_000));
}

function renderStatus() {
  if (!state.config) return;
  const now = new Date();
  const current = activeEvent(now);
  const next = nextEvent(now);
  elements.statusPanel.classList.toggle('occupied', Boolean(current));
  elements.statusPanel.classList.toggle('available', !current);
  elements.statusLabel.textContent = current ? 'In use' : 'Available';
  elements.reserveButton.hidden = !state.config.allowQuickBooking || Boolean(current);

  if (current) {
    elements.statusTitle.textContent = current.subject;
    elements.statusDetail.textContent = `Ends ${formatter({ hour: 'numeric', minute: '2-digit' }).format(new Date(current.end))} · ${minutesBetween(now, current.end)} min remaining`;
  } else {
    const freeMinutes = next ? minutesBetween(now, next.start) : null;
    elements.statusTitle.textContent = next ? `Free for ${freeMinutes} min` : 'Free for the rest of today';
    elements.statusDetail.textContent = next
      ? `Next: ${next.subject} at ${formatter({ hour: 'numeric', minute: '2-digit' }).format(new Date(next.start))}`
      : 'No more reservations scheduled';
  }
}

function renderAgenda() {
  const now = new Date();
  const upcoming = state.events.filter((event) => new Date(event.end) > now).slice(0, 6);
  elements.agenda.replaceChildren();
  if (!upcoming.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-agenda';
    empty.textContent = 'No more meetings today.';
    elements.agenda.append(empty);
    return;
  }
  for (const event of upcoming) {
    const card = document.createElement('article');
    card.className = 'event-card';
    const time = document.createElement('div');
    time.className = 'event-time';
    time.textContent = `${formatter({ hour: 'numeric', minute: '2-digit' }).format(new Date(event.start))} – ${formatter({ hour: 'numeric', minute: '2-digit' }).format(new Date(event.end))}`;
    const copy = document.createElement('div');
    copy.className = 'event-copy';
    const title = document.createElement('h3');
    title.textContent = event.subject;
    const organizer = document.createElement('p');
    organizer.textContent = event.organizer || (event.isPrivate ? 'Details hidden' : 'Room reservation');
    copy.append(title, organizer);
    const badge = document.createElement('span');
    const isNow = new Date(event.start) <= now && new Date(event.end) > now;
    badge.className = `event-state${isNow ? ' now' : ''}`;
    badge.textContent = isNow ? 'Now' : 'Upcoming';
    card.append(time, copy, badge);
    elements.agenda.append(card);
  }
}

async function refreshEvents(silent = false) {
  if (state.loading) return;
  state.loading = true;
  if (!silent) elements.refreshButton.disabled = true;
  try {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const response = await fetch(`/api/events?start=${encodeURIComponent(now.toISOString())}&end=${encodeURIComponent(end.toISOString())}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Schedule unavailable');
    const data = await response.json();
    state.events = data.events || [];
    renderStatus();
    renderAgenda();
    setSyncState('Live', true);
  } catch {
    setSyncState('Reconnecting', false);
    if (!silent) showToast('Could not refresh the calendar');
  } finally {
    state.loading = false;
    elements.refreshButton.disabled = false;
  }
}

function setSyncState(text, online) {
  elements.syncState.lastChild.textContent = text;
  elements.syncState.classList.toggle('offline', !online);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove('show'), 2500);
}

function connectLiveUpdates() {
  const stream = new EventSource('/api/stream');
  stream.addEventListener('ready', () => setSyncState('Live', true));
  stream.addEventListener('calendar.changed', () => refreshEvents(true));
  stream.onerror = () => setSyncState('Reconnecting', false);
}

async function submitBooking(event) {
  event.preventDefault();
  elements.bookingError.textContent = '';
  elements.confirmBooking.disabled = true;
  const form = new FormData(elements.bookingForm);
  const duration = Number(form.get('duration'));
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + duration * 60_000);
  try {
    const response = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: form.get('subject'), start: start.toISOString(), end: end.toISOString() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to reserve the room');
    elements.dialog.close();
    showToast('Room reserved');
    await refreshEvents(true);
  } catch (error) {
    elements.bookingError.textContent = error.message;
  } finally {
    elements.confirmBooking.disabled = false;
  }
}

async function init() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    state.config = await response.json();
    elements.roomName.textContent = state.config.roomName;
    document.title = `${state.config.roomName} · Room display`;
    updateClock();
    setInterval(updateClock, 15_000);
    await refreshEvents();
    connectLiveUpdates();
    setInterval(() => refreshEvents(true), 5 * 60_000);
  } catch {
    elements.statusTitle.textContent = 'Display unavailable';
    elements.statusDetail.textContent = 'Check the network connection and server configuration.';
    setSyncState('Offline', false);
  }
}

elements.refreshButton.addEventListener('click', () => refreshEvents());
elements.reserveButton.addEventListener('click', () => elements.dialog.showModal());
elements.closeDialog.addEventListener('click', () => elements.dialog.close());
elements.bookingForm.addEventListener('submit', submitBooking);
elements.dialog.addEventListener('click', (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});

init();
