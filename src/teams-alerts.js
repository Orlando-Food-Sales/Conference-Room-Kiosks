// Alerts to named people in Microsoft Teams, sent by a notification-only Teams bot (for example "Room Display Alerts").
//
// How a message reaches one person, with no inbound web address needed:
//   1. Sign in as the bot's own Entra app (client credentials) to get a Graph token and a Bot Connector token.
//   2. Find, or install, the bot's Teams app for that person through Microsoft Graph
//      (application permission TeamsAppInstallation.ReadWriteSelfForUser.All; the app must be in the organisation's app catalog).
//   3. Ask Graph for the 1:1 chat that installation created, and remember its id.
//   4. Post the message into that chat through the Bot Connector service.
//
// Nothing here throws on a delivery problem: send() returns one result per person so a failure for one
// person never stops the other, and never stops the server.

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = { graph: 'https://graph.microsoft.com/.default', bot: 'https://api.botframework.com/.default' };

class TeamsError extends Error {
  constructor(step, message, status = 0) { super(message); this.step = step; this.status = status; }
}

export class TeamsAlerts {
  constructor(settings, fetchImpl = fetch, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), clock = () => Date.now() } = {}) {
    this.s = settings || { enabled: false, recipients: [] };
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.clock = clock;
    this.tokens = {};          // kind -> { value, expiresAt }
    this.chats = new Map();    // email -> chat id
    this.catalogId = this.s.catalogId || '';
  }

  get enabled() { return Boolean(this.s.enabled && this.s.appId && this.s.appSecret && this.s.tenantId && this.s.recipients?.length); }
  get recipients() { return this.enabled ? [...this.s.recipients] : []; }

  // ---------- HTTP plumbing ----------

  async token(kind, { fresh = false } = {}) {
    const cached = this.tokens[kind];
    if (!fresh && cached && cached.expiresAt > this.clock() + 60000) return cached.value;
    const response = await this.fetch(`https://login.microsoftonline.com/${encodeURIComponent(this.s.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.s.appId, client_secret: this.s.appSecret, scope: SCOPES[kind] })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      const code = (body.error_description || body.error || `HTTP ${response.status}`).split('\r')[0].split('\n')[0].slice(0, 160);
      throw new TeamsError('sign-in', `The bot could not sign in to Microsoft (${code}). Check TEAMS_BOT_APP_ID, TEAMS_BOT_APP_SECRET and the tenant ID.`, response.status);
    }
    this.tokens[kind] = { value: body.access_token, expiresAt: this.clock() + Number(body.expires_in || 3600) * 1000 };
    return body.access_token;
  }

  // One request; if Microsoft says the token is no good, get a fresh one and try once more.
  async call(kind, step, method, url, payload) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.token(kind, { fresh: attempt > 0 });
      const response = await this.fetch(url, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(payload ? { 'content-type': 'application/json' } : {}) },
        body: payload ? JSON.stringify(payload) : undefined
      });
      if (response.status === 401 && attempt === 0) { delete this.tokens[kind]; continue; }
      const text = typeof response.text === 'function' ? await response.text() : '';
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
      if (!response.ok) throw new TeamsError(step, explain(step, response.status, data), response.status);
      return data;
    }
    throw new TeamsError(step, 'Microsoft refused the bot\'s sign-in token.', 401);
  }

  // ---------- finding the person's chat with the bot ----------

  async findInstallation(user) {
    const filter = encodeURIComponent(`teamsApp/externalId eq '${this.s.appId}'`);
    const data = await this.call('graph', 'finding the app', 'GET', `${GRAPH}/users/${user}/teamwork/installedApps?$expand=teamsApp&$filter=${filter}`);
    return data.value?.[0]?.id || null;
  }

  async catalogAppId() {
    if (this.catalogId) return this.catalogId;
    const filter = encodeURIComponent(`externalId eq '${this.s.appId}'`);
    const data = await this.call('graph', 'finding the app in your app catalog', 'GET', `${GRAPH}/appCatalogs/teamsApps?$filter=${filter}`);
    const id = data.value?.[0]?.id;
    if (!id) throw new TeamsError('finding the app in your app catalog', 'The Teams app is not in your organisation\'s app catalog yet. Upload room-display-alerts.zip in the Teams admin center first.', 404);
    this.catalogId = id;
    return id;
  }

  async installFor(user) {
    const catalogId = await this.catalogAppId();
    await this.call('graph', 'installing the app', 'POST', `${GRAPH}/users/${user}/teamwork/installedApps`, { 'teamsApp@odata.bind': `${GRAPH}/appCatalogs/teamsApps/${catalogId}` });
    for (const wait of [500, 1500, 3000, 5000]) {          // Teams needs a moment before the installation is listed
      await this.sleep(wait);
      const id = await this.findInstallation(user);
      if (id) return id;
    }
    throw new TeamsError('installing the app', 'The app was installed but Teams has not finished setting it up. Try again in a minute.', 202);
  }

  async chatFor(email) {
    if (this.chats.has(email)) return this.chats.get(email);
    const user = encodeURIComponent(email);
    const installation = (await this.findInstallation(user)) || (await this.installFor(user));
    const chat = await this.call('graph', 'finding the chat', 'GET', `${GRAPH}/users/${user}/teamwork/installedApps/${encodeURIComponent(installation)}/chat`);
    if (!chat.id) throw new TeamsError('finding the chat', 'Teams did not return a chat for this person.', 404);
    this.chats.set(email, chat.id);
    return chat.id;
  }

  // ---------- sending ----------

  async post(chatId, markdown) {
    const base = this.s.serviceUrl.replace(/\/+$/, '');
    await this.call('bot', 'sending the message', 'POST', `${base}/v3/conversations/${encodeURIComponent(chatId)}/activities`, {
      type: 'message',
      textFormat: 'markdown',
      text: markdown,
      channelData: { notification: { alert: true } }
    });
  }

  async sendTo(email, markdown) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.post(await this.chatFor(email), markdown);
        return { recipient: email, ok: true };
      } catch (error) {
        const stale = error instanceof TeamsError && error.step === 'sending the message' && [403, 404].includes(error.status) && !/blocked|muted/i.test(error.message);
        if (stale && attempt === 0) { this.chats.delete(email); continue; }        // the saved chat may be out of date: look it up again once
        return { recipient: email, ok: false, step: error.step || 'sending', error: error.message || String(error) };
      }
    }
    return { recipient: email, ok: false, step: 'sending', error: 'Could not deliver.' };
  }

  // Sends the same message to everyone. Always resolves; never throws.
  async send(text, { title = 'Room Display alert' } = {}) {
    if (!this.enabled) return [];
    const markdown = `**${title}**\n\n${text}`;
    const results = [];
    for (const email of this.s.recipients) results.push(await this.sendTo(email, markdown));
    return results;
  }
}

function explain(step, status, data) {
  const detail = String(data?.error?.message || data?.message || data?.error_description || data?.raw || '').replace(/\s+/g, ' ').slice(0, 160);
  if (/MessageWritesBlocked/i.test(JSON.stringify(data))) return 'This person has blocked or muted the bot in Teams, so the message was not delivered.';
  if (status === 401) return `Microsoft refused the bot's sign-in token while ${step}.`;
  if (status === 403 && step === 'sending the message') return 'Teams refused the message: the app is not installed for this person, or the bot is not allowed to message them.';
  if (status === 403) return `Microsoft refused permission while ${step}. The bot's Entra app needs the TeamsAppInstallation.ReadWriteSelfForUser.All application permission with admin consent.${detail ? ` (${detail})` : ''}`;
  if (status === 404 && step === 'sending the message') return 'Teams could not find the chat. It will be looked up again next time.';
  if (status === 404) return `Microsoft could not find the person or the app while ${step}. Check the email address is that person's sign-in name (UPN).${detail ? ` (${detail})` : ''}`;
  if (status === 429) return 'Microsoft asked the bot to slow down; this alert was not delivered.';
  return `Microsoft answered ${status} while ${step}.${detail ? ` (${detail})` : ''}`;
}
