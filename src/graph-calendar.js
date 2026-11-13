// What kind of failure a Microsoft answer is, so the tablet and the alerts can say something useful:
//   microsoft-down  Microsoft 365 itself is failing or not answering (5xx, throttling, timeouts, no connection);
//                   nothing to fix on our side, it recovers by itself
//   permission      the app is not allowed (401, 403): the client secret or the app's permissions need attention
//   not-found       the mailbox does not exist (404)
export function failureKind(status) {
  if (status === 401 || status === 403) return 'permission';
  if (status === 404) return 'not-found';
  if (status === 408 || status === 429 || status >= 500) return 'microsoft-down';
  return 'other';
}

function graphError(response, body) {
  const message = body?.error?.message || body?.error_description || response.statusText || 'Unknown error';
  const error = new Error(`Microsoft Graph request failed (${response.status}): ${message}`);
  error.status = response.status;
  error.kind = failureKind(response.status);
  return error;
}

// During Microsoft outages requests hung for 20 to 35 seconds before failing. Give up after 20 seconds instead,
// and treat "no answer" like any other Microsoft outage.
export const REQUEST_TIMEOUT_MS = 20000;
async function call(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (cause) {
    const why = cause?.name === 'TimeoutError' || cause?.name === 'AbortError' ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds` : String(cause?.message || cause).slice(0, 80);
    const error = new Error(`Microsoft 365 did not answer (${why})`);
    error.status = 503;
    error.kind = 'microsoft-down';
    return Promise.reject(error);
  }
}

function asUtcIso(dateTime) {
  const value = String(dateTime || '');
  if (!value) return value;
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(withZone);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

export class GraphTokenProvider {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
    this.cached = null;
  }

  async getToken() {
    if (this.cached && this.cached.expiresAt > Date.now() + 60000) return this.cached.value;
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    });
    const response = await call(this.fetch, `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw graphError(response, json);
    this.cached = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000 };
    return this.cached.value;
  }
}

export class GraphCalendar {
  constructor(config, room, tokenProvider, fetchImpl = fetch) {
    this.config = config;
    this.room = room;
    this.tokens = tokenProvider;
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    const token = await this.tokens.getToken();
    const target = /^https:\/\/graph\.microsoft\.com\//.test(path) ? path : `https://graph.microsoft.com/v1.0${path}`;
    const response = await call(this.fetch, target, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        prefer: 'outlook.timezone="UTC"',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw graphError(response, body);
    return body;
  }

  async listEvents(start, end) {
    const params = new URLSearchParams({
      startDateTime: new Date(start).toISOString(),
      endDateTime: new Date(end).toISOString(),
      '$select': 'id,subject,organizer,start,end,sensitivity,isCancelled,showAs',
      '$orderby': 'start/dateTime',
      '$top': '100'
    });
    let next = `/users/${encodeURIComponent(this.room.email)}/calendarView?${params}`;
    const values = [];
    for (let page = 0; next && page < 20; page += 1) {
      const result = await this.request(next);
      values.push(...(result.value || []));
      next = result['@odata.nextLink'] || '';
    }
    return values.filter(event => !event.isCancelled).map(event => {
      const isPrivate = String(event.sensitivity || '').toLowerCase() === 'private';
      return {
        id: event.id,
        subject: isPrivate ? 'Private meeting' : (event.subject || 'Reserved'),
        organizer: isPrivate ? '' : (event.organizer?.emailAddress?.name || event.organizer?.emailAddress?.address || ''),
        start: asUtcIso(event.start?.dateTime),
        end: asUtcIso(event.end?.dateTime),
        isPrivate
      };
    });
  }

  async createEvent(booking) {
    const payload = {
      subject: booking.subject || 'Reserved',
      start: { dateTime: new Date(booking.start).toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
      end: { dateTime: new Date(booking.end).toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
      body: { contentType: 'text', content: booking.organizer ? `Reserved from room display by ${booking.organizer}` : 'Reserved from room display' }
    };
    const event = await this.request(`/users/${encodeURIComponent(this.room.email)}/events`, { method: 'POST', body: JSON.stringify(payload) });
    return {
      id: event.id,
      subject: event.subject || payload.subject,
      organizer: booking.organizer || '',
      start: booking.start,
      end: booking.end,
      isPrivate: false
    };
  }
}
