const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';

function graphDate(value) {
  if (!value?.dateTime) return null;
  const dateTime = value.dateTime;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(dateTime)) return new Date(dateTime).toISOString();
  if ((value.timeZone || '').toUpperCase() === 'UTC') return new Date(`${dateTime}Z`).toISOString();
  return new Date(dateTime).toISOString();
}

export class GraphCalendar {
  constructor(config) {
    this.config = config;
    this.cachedToken = null;
    this.tokenExpiresAt = 0;
  }

  async accessToken() {
    if (this.cachedToken && this.tokenExpiresAt > Date.now() + 5 * 60_000) return this.cachedToken;
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) {
      throw new Error(`Microsoft identity platform ${response.status}: ${result.error_description || result.error || 'token request failed'}`);
    }
    this.cachedToken = result.access_token;
    this.tokenExpiresAt = Date.now() + Number(result.expires_in || 3600) * 1000;
    return this.cachedToken;
  }

  async request(path, options = {}) {
    const token = await this.accessToken();
    const response = await fetch(`${GRAPH_ROOT}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        Prefer: 'outlook.timezone="UTC"',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Microsoft Graph ${response.status}: ${detail.slice(0, 500)}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async listEvents(start, end) {
    const user = encodeURIComponent(this.config.roomEmail);
    const params = new URLSearchParams({
      startDateTime: new Date(start).toISOString(),
      endDateTime: new Date(end).toISOString(),
      '$select': 'id,subject,start,end,organizer,sensitivity,isCancelled,showAs',
      '$orderby': 'start/dateTime',
      '$top': '100',
    });
    const data = await this.request(`/users/${user}/calendarView?${params}`);
    return (data.value || [])
      .filter((event) => !event.isCancelled && event.showAs !== 'free')
      .map((event) => ({
        id: event.id,
        subject: event.sensitivity === 'private' ? 'Private meeting' : (event.subject || 'Reserved'),
        organizer: event.sensitivity === 'private' ? '' : (event.organizer?.emailAddress?.name || ''),
        start: graphDate(event.start),
        end: graphDate(event.end),
        isPrivate: event.sensitivity === 'private',
      }));
  }

  async createEvent(booking) {
    const user = encodeURIComponent(this.config.roomEmail);
    const event = await this.request(`/users/${user}/events`, {
      method: 'POST',
      body: JSON.stringify({
        subject: booking.subject,
        showAs: 'busy',
        start: { dateTime: booking.start, timeZone: 'UTC' },
        end: { dateTime: booking.end, timeZone: 'UTC' },
        body: { contentType: 'text', content: 'Created from the room display.' },
      }),
    });
    return {
      id: event.id,
      subject: event.subject,
      organizer: event.organizer?.emailAddress?.name || '',
      start: graphDate(event.start),
      end: graphDate(event.end),
      isPrivate: false,
    };
  }

  async createSubscription(notificationUrl) {
    const expiration = new Date(Date.now() + 2 * 24 * 60 * 60_000);
    return this.request('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        changeType: 'created,updated,deleted',
        notificationUrl,
        resource: `users/${this.config.roomEmail}/events`,
        expirationDateTime: expiration.toISOString(),
        clientState: this.config.graphClientState,
        latestSupportedTlsVersion: 'v1_2',
      }),
    });
  }

  async renewSubscription(id) {
    const expiration = new Date(Date.now() + 2 * 24 * 60 * 60_000);
    return this.request(`/subscriptions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ expirationDateTime: expiration.toISOString() }),
    });
  }
}
