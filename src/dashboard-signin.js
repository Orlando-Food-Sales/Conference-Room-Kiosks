// Sign in to the dashboard with Microsoft Entra ID (work accounts), as an alternative to the administrator token.
//
// Flow: OpenID Connect authorization code flow with PKCE, for a confidential client (it has a client secret).
//   GET /auth/login     -> remembers a one-time state, nonce and PKCE verifier, sends the browser to Microsoft
//   GET /auth/callback  -> checks the state (and that it is this browser's), swaps the code for tokens at Microsoft,
//                          checks the ID token, checks the person is on the allowed list, starts a session
//   POST /auth/logout   -> ends the session
// The ID token comes straight from Microsoft's token endpoint over HTTPS, in exchange for our client secret, so its
// signature does not need to be checked (OpenID Connect Core 3.1.3.7); its issuer, audience, tenant, nonce and
// expiry still are. Sessions are kept in memory: a server restart signs everyone out.
import crypto from 'node:crypto';

const AUTHORITY = 'https://login.microsoftonline.com';
export const SESSION_COOKIE = 'rd_session';
const STATE_COOKIE = 'rd_signin';
const STATE_MINUTES = 10;
const MAX_PENDING = 200;      // sign-ins started but not finished
const MAX_SESSIONS = 200;
const CLOCK_SKEW_SECONDS = 300;

const base64url = buffer => Buffer.from(buffer).toString('base64url');
const randomToken = (bytes = 32) => base64url(crypto.randomBytes(bytes));

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    if (!(name in cookies)) cookies[name] = part.slice(at + 1).trim();
  }
  return cookies;
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new SignInError('Microsoft did not return a valid ID token. Please start again.', 502);
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch { throw new SignInError('Microsoft did not return a readable ID token. Please start again.', 502); }
}

export class SignInError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export class DashboardSignIn {
  constructor(settings, fetchImpl = fetch, now = () => Date.now()) {
    this.settings = settings || { enabled: false };
    this.fetch = fetchImpl;
    this.now = now;
    this.pending = new Map();    // state -> { nonce, verifier, browser, expires }
    this.sessions = new Map();   // id -> { email, name, oid, expires }
  }

  get enabled() { return Boolean(this.settings.enabled); }
  get secure() { return /^https:/i.test(this.settings.redirectUri || ''); }

  cookie(name, value, maxAgeSeconds, cookiePath = '/') {
    return `${name}=${value}; Path=${cookiePath}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}`;
  }

  prune() {
    const now = this.now();
    for (const [key, value] of this.pending) if (value.expires <= now) this.pending.delete(key);
    for (const [key, value] of this.sessions) if (value.expires <= now) this.sessions.delete(key);
  }

  // Step 1: where to send the browser, and the cookie that ties the answer to this browser.
  start() {
    if (!this.enabled) throw new SignInError('Microsoft sign-in is not set up on this server.', 404);
    this.prune();
    if (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value);   // oldest first
    const state = randomToken(), nonce = randomToken(), verifier = randomToken(48), browser = randomToken();
    this.pending.set(state, { nonce, verifier, browser, expires: this.now() + STATE_MINUTES * 60000 });
    const { tenantId, clientId, redirectUri } = this.settings;
    const query = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query',
      scope: 'openid profile email', state, nonce, prompt: 'select_account',
      code_challenge: base64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256'
    });
    return {
      location: `${AUTHORITY}/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${query}`,
      setCookie: this.cookie(STATE_COOKIE, browser, STATE_MINUTES * 60, '/auth')
    };
  }

  // Step 2: Microsoft sent the browser back. Returns the new session (and its cookie) or throws a SignInError.
  async finish(query, cookieHeader) {
    if (!this.enabled) throw new SignInError('Microsoft sign-in is not set up on this server.', 404);
    this.prune();
    const state = String(query.get('state') || '');
    const pending = state && this.pending.get(state);
    if (pending) this.pending.delete(state);   // one use only, whatever happens next
    if (query.get('error')) throw new SignInError(`Microsoft did not sign you in: ${String(query.get('error_description') || query.get('error')).split(/\r?\n/)[0].slice(0, 200)}`, 401);
    if (!pending) throw new SignInError('This sign-in link has expired or was already used. Please start again.', 400);
    const browser = parseCookies(cookieHeader)[STATE_COOKIE];
    if (!browser || browser.length !== pending.browser.length || !crypto.timingSafeEqual(Buffer.from(browser), Buffer.from(pending.browser))) {
      throw new SignInError('This sign-in was started in a different browser. Please start again.', 400);
    }
    const code = String(query.get('code') || '');
    if (!code) throw new SignInError('Microsoft did not send a sign-in code. Please start again.', 400);

    const { tenantId, clientId, clientSecret, redirectUri, allowedEmails, sessionHours } = this.settings;
    let tokens;
    try {
      const response = await this.fetch(`${AUTHORITY}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: pending.verifier, scope: 'openid profile email' })
      });
      tokens = await response.json().catch(() => ({}));
      if (!response.ok) throw new SignInError(`Microsoft refused the sign-in (${tokens.error || response.status}). Please start again; if it keeps happening, check the dashboard sign-in app registration and its secret.`, 502);
    } catch (error) {
      if (error instanceof SignInError) throw error;
      throw new SignInError('Could not reach Microsoft to finish signing in. Please try again.', 502);
    }

    const claims = decodeJwtPayload(tokens.id_token);
    const nowSeconds = Math.floor(this.now() / 1000);
    if (claims.tid !== tenantId) throw new SignInError('That account belongs to a different organisation.', 403);
    if (claims.iss !== `${AUTHORITY}/${tenantId}/v2.0`) throw new SignInError('The ID token is not from this organisation.', 403);
    if (claims.aud !== clientId) throw new SignInError('The ID token was not issued for this dashboard.', 403);
    if (claims.nonce !== pending.nonce) throw new SignInError('The ID token does not belong to this sign-in. Please start again.', 403);
    if (!Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) throw new SignInError('The ID token has expired. Please start again.', 403);
    if (Number.isFinite(claims.nbf) && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) throw new SignInError('The ID token is not valid yet. Check the server clock.', 403);

    const names = [claims.preferred_username, claims.email, claims.upn].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
    const email = names.find(name => allowedEmails.includes(name));
    if (!email) throw new SignInError(`${names[0] || 'That account'} is not allowed to use the dashboard. Ask an administrator to add you to DASHBOARD_ADMIN_EMAILS (or TEAMS_ALERT_EMAILS).`, 403);

    if (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value);
    const id = randomToken();
    const session = { email, name: String(claims.name || email).slice(0, 100), oid: String(claims.oid || ''), expires: this.now() + sessionHours * 3600000 };
    this.sessions.set(id, session);
    return {
      session,
      setCookies: [this.cookie(SESSION_COOKIE, id, sessionHours * 3600), this.cookie(STATE_COOKIE, '', 0, '/auth')]
    };
  }

  // The signed-in person for a request, or null.
  sessionFor(cookieHeader) {
    if (!this.enabled) return null;
    const id = parseCookies(cookieHeader)[SESSION_COOKIE];
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expires <= this.now()) { this.sessions.delete(id); return null; }
    return session;
  }

  logout(cookieHeader) {
    const id = parseCookies(cookieHeader)[SESSION_COOKIE];
    if (id) this.sessions.delete(id);
    return this.cookie(SESSION_COOKIE, '', 0);
  }
}

// A short page for sign-in problems (the dashboard is a separate page, so this stays plain and needs no script).
export function signInProblemPage(message) {
  const text = String(message).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in problem · Room Display Control</title><link rel="stylesheet" href="/dashboard.css"></head>`
    + `<body><main><h1>Could not sign you in</h1><p id="error">${text}</p><p><a class="button-link" href="/auth/login">Try again</a> <a class="button-link" href="/dashboard">Back to the dashboard</a></p></main></body></html>`;
}
