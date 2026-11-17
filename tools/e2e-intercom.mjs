#!/usr/bin/env node
// Real-browser check of the door intercom, noise meter and location report (INSTALL-UBUNTU.md section 12f).
// Starts this repo's server on a spare port (demo mode, a random test token) and a headless Chrome, and drives
// Chrome through the DevTools protocol using Node's global WebSocket. No npm packages. Nothing leaves this Mac:
// everything runs on http://localhost, which browsers treat as a secure context.
//
//   node tools/e2e-intercom.mjs
//
// Set CHROME_BIN to use another headless Chrome. The test token is random, never printed, and used only here.
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_BIN || path.join(os.homedir(), '.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.204/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const TOKEN = crypto.randomBytes(18).toString('hex');
const RING_SECONDS = 10;
const LAT = 40.9595, LON = -74.1252, ACCURACY = 35;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanups = [];
let failures = 0;
function pass(name) { console.log('PASS ' + name); }
function fail(name, why) { failures += 1; console.log('FAIL ' + name + (why ? ' - ' + why : '')); }
function check(name, ok, why) { if (ok) pass(name); else fail(name, why); return Boolean(ok); }
async function waitFor(label, fn, ms = 20000, step = 250) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (error) { last = error; }
    await sleep(step);
  }
  throw new Error('timed out waiting for ' + label);
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}
function stopProcess(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode) return resolve();
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch { resolve(); }
  });
}
async function cleanup() {
  while (cleanups.length) { try { await cleanups.pop()(); } catch { } }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup().finally(() => process.exit(130)); });

// ---- DevTools protocol client ----
class Cdp {
  constructor(ws) {
    this.ws = ws; this.nextId = 1; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const waiter = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (waiter) { if (msg.error) waiter.reject(new Error(msg.error.message)); else waiter.resolve(msg.result); }
      } else for (const listener of this.listeners) listener(msg);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', () => reject(new Error('DevTools connection failed')), { once: true }); });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, sessionId })); });
  }
  close() { try { this.ws.close(); } catch { } }
}
class Page {
  constructor(cdp, targetId, sessionId) { this.cdp = cdp; this.targetId = targetId; this.sid = sessionId; this.requests = []; this.consoleErrors = []; }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('page error: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    return result.result.value;
  }
  text(id) { return this.eval(`(document.getElementById(${JSON.stringify(id)})||{}).textContent||''`); }
  shown(id) { return this.eval(`(function(){var e=document.getElementById(${JSON.stringify(id)});if(!e)return false;var s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&!e.classList.contains('hidden');})()`); }
  click(id) { return this.eval(`document.getElementById(${JSON.stringify(id)}).click(),true`); }
  async close() { try { await this.cdp.send('Target.closeTarget', { targetId: this.targetId }); } catch { } }
}
// Counts every RTCPeerConnection and getUserMedia call in the page, so the checks can see what the page itself did.
const HOOK = `(function(){window.__pcs=[];window.__gum=[];var O=window.RTCPeerConnection;if(O){var W=function(a,b){var pc=new O(a,b);window.__pcs.push(pc);return pc;};W.prototype=O.prototype;W.generateCertificate=O.generateCertificate;window.RTCPeerConnection=W;}
var md=navigator.mediaDevices;if(md&&md.getUserMedia){var g=md.getUserMedia.bind(md);md.getUserMedia=function(c){var rec={constraints:JSON.parse(JSON.stringify(c||{})),stream:null};window.__gum.push(rec);return g(c).then(function(s){rec.stream=s;return s;});};}})();`;

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error('headless Chrome not found (set CHROME_BIN)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-intercom-'));
  cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // ---- server ----
  const port = await freePort();
  const base = 'http://localhost:' + port;
  const serverLog = [];
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: tmp, PORT: String(port), DEMO_MODE: 'true', ADMIN_TOKEN: TOKEN, NOISE_METER: 'on', INTERCOM_ENABLED: 'true',
      INTERCOM_RING_SECONDS: String(RING_SECONDS), LOCATION_REPORT: 'on',
      ROOMS_JSON: JSON.stringify([{ id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: 'America/New_York' }])
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  cleanups.push(() => stopProcess(server));
  server.stdout.on('data', chunk => serverLog.push(String(chunk)));
  server.stderr.on('data', chunk => serverLog.push(String(chunk)));
  const api = async (route) => (await fetch(base + route, { headers: { authorization: 'Bearer ' + TOKEN } })).json();
  await waitFor('the server', async () => (await fetch(base + '/healthz')).ok, 15000);

  // ---- Chrome ----
  const debugPort = await freePort();
  const chrome = spawn(CHROME, [
    '--remote-debugging-port=' + debugPort, '--user-data-dir=' + path.join(tmp, 'profile'), '--no-sandbox', '--disable-gpu',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'
  ], { stdio: 'ignore' });
  cleanups.push(() => stopProcess(chrome));
  const version = await waitFor('Chrome', async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(), 15000);
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  cleanups.push(() => cdp.close());
  await cdp.send('Browser.grantPermissions', { origin: base, permissions: ['audioCapture', 'geolocation'] });

  async function openPage(url, { dashboard = false, geo = false, network = false } = {}) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, targetId, sessionId);
    await page.send('Page.enable'); await page.send('Runtime.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    if (dashboard) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('adminToken', ${JSON.stringify(TOKEN)});` });
    if (geo) await page.send('Emulation.setGeolocationOverride', { latitude: LAT, longitude: LON, accuracy: ACCURACY });
    if (network) {
      await page.send('Network.enable');
      cdp.listeners.push(msg => { if (msg.sessionId === sessionId && msg.method === 'Network.requestWillBeSent') page.requests.push({ url: msg.params.request.url, method: msg.params.request.method, body: msg.params.request.postData || '' }); });
    }
    await page.send('Page.navigate', { url });
    return page;
  }
  const gumCount = page => page.eval('window.__gum.length');
  const callGum = page => page.eval('window.__gum.filter(function(g){return g.constraints.audio&&g.constraints.audio.echoCancellation===true}).length');
  const pcCount = page => page.eval('window.__pcs.length');
  const badgeText = page => page.eval(`(function(){var e=document.getElementById('micNotice');return e&&getComputedStyle(e).display!=='none'?e.textContent:''})()`);
  const noiseBadge = async page => /noise level only/.test(await badgeText(page));
  const callBadge = async page => { const t = await badgeText(page); return t !== '' && !/noise level only/.test(t); };
  const liveTracks = (page, which) => page.eval(`window.__gum.filter(function(g){var a=g.constraints.audio;return ${which === 'call' ? 'a&&a.echoCancellation===true' : 'a===true||(a&&a.echoCancellation===false)'}}).reduce(function(n,g){return n+(g.stream?g.stream.getTracks().filter(function(t){return t.readyState==='live'}).length:0)},0)`);
  const audioBytes = (page, kind) => page.eval(`(async function(){var n=0;for(var pc of window.__pcs){var r=await pc.getStats();r.forEach(function(s){if(s.type==='${kind === 'in' ? 'inbound-rtp' : 'outbound-rtp'}'&&(s.kind==='audio'||s.mediaType==='audio'))n+=s.${kind === 'in' ? 'bytesReceived' : 'bytesSent'}||0;});}return n;})()`);
  const adminsOnline = async () => (await api('/api/admin/overview')).intercomAdminsOnline;
  const callStatus = page => page.text('callStatus');

  const tabletUrl = base + '/room/front?kiosk=1';
  const created = [];
  const open = async (...args) => { const page = await openPage(...args); created.push(page); return page; };
  cleanups.push(async () => { for (const page of created) await page.close(); });

  // ---- (a) nothing but the noise meter before a press; the dashboard shows noise and location ----
  const tablet = await open(tabletUrl, { geo: true, network: true });
  await waitFor('the tablet page', () => noiseBadge(tablet), 20000);
  check('a1 red microphone badge is visible on the tablet while the meter runs', true);
  check('a2 no RTCPeerConnection before any press', (await pcCount(tablet)) === 0, 'count ' + await pcCount(tablet));
  check('a3 the only microphone use is the noise meter (processing off)', (await gumCount(tablet)) === 1 && (await callGum(tablet)) === 0, 'getUserMedia calls ' + await gumCount(tablet));
  check('a4 the red badge is on and says it is the noise level only', (await noiseBadge(tablet)) && !(await callBadge(tablet)));
  await waitFor('the call button', () => tablet.shown('callButton'), 10000);
  check('a5 call button is shown on a secure page', true);
  const posts = tablet.requests.filter(r => r.method === 'POST');
  const jsonOnly = posts.every(r => { try { JSON.parse(r.body); return new URL(r.url).pathname.startsWith('/api/') && r.body.length < 4000; } catch { return false; } });
  check('a6 the tablet only posts small JSON to /api/ (no audio)', posts.length > 0 && jsonOnly, posts.map(r => r.url).join(','));

  const dash = await open(base + '/dashboard', { dashboard: true });
  await waitFor('the dashboard noise and location', async () => {
    await dash.eval(`document.getElementById('refresh').click(),true`);
    await sleep(1500);
    const text = await dash.text('rooms');
    return /noise (quiet|talking|loud) \(-?\d+ dB\)/.test(text) && text.includes('40.95950, -74.12520');
  }, 45000, 1000);
  check('a7 dashboard shows the noise level with dB', true);
  check('a8 dashboard shows the location text', true);
  const mapHref = await dash.eval(`(function(){var a=Array.prototype.find.call(document.querySelectorAll('#rooms a'),function(x){return x.textContent==='Open map'});return a?a.href+'|'+a.rel+'|'+a.target:''})()`);
  check('a9 "Open map" link with noopener', mapHref.startsWith('https://www.openstreetmap.org/?mlat=40.9595&mlon=-74.1252') && mapHref.includes('noopener') && mapHref.endsWith('|_blank'), mapHref);
  check('a10 the dashboard has no control that starts a call', await dash.eval(`!document.querySelector('#intercom button[id*="Call" i], #intercom button[id*="ring" i]')`));

  // ---- (b) press with no dashboard open ----
  await dash.close(); created.splice(created.indexOf(dash), 1);
  await waitFor('the dashboard stream to close', async () => (await adminsOnline()) === 0, 15000);
  const gumBefore = await gumCount(tablet);
  await tablet.click('callButton');
  await waitFor('the nobody message', async () => /Nobody is signed in/.test(await callStatus(tablet)), 10000);
  check('b1 "Nobody is signed in" when no dashboard is open', true);
  check('b2 still no RTCPeerConnection and no new getUserMedia', (await pcCount(tablet)) === 0 && (await gumCount(tablet)) === gumBefore);
  check('b3 microphone badge hidden', !(await callBadge(tablet)));
  await tablet.eval(`document.getElementById('callPanel').classList.add('hidden'),true`);

  // ---- (c) dashboard open, press, answer ----
  const admin1 = await open(base + '/dashboard', { dashboard: true });
  await waitFor('the dashboard stream', async () => (await adminsOnline()) === 1, 15000);
  await sleep(3500); // the cooldown after a ring that found nobody
  const gumC = await gumCount(tablet);
  await tablet.click('callButton');
  await waitFor('the ring banner', async () => /Front Conference Room door is calling/.test(await admin1.text('intercomText')) && await admin1.shown('intercomAnswer'), 10000);
  check('c1 ring banner with the room name and an Answer button on the dashboard', true);
  check('c2 tablet says Calling, no peer connection, no microphone badge', /Calling/.test(await callStatus(tablet)) && (await pcCount(tablet)) === 0 && !(await callBadge(tablet)) && (await callGum(tablet)) === 0 && (await gumCount(tablet)) === gumC);
  check('c3 the dashboard has not opened a microphone or connection before Answer', (await gumCount(admin1)) === 0 && (await pcCount(admin1)) === 0);
  await admin1.click('intercomAnswer');
  await waitFor('the call to connect', async () => /Connected/.test(await callStatus(tablet)) && /Talking with Front Conference Room/.test(await admin1.text('intercomText')), 20000);
  check('c4 connected on both sides', true);
  check('c5 microphone badge shows only now', (await callBadge(tablet)) && (await callGum(tablet)) === 1 && (await pcCount(tablet)) === 1);
  const inA = await audioBytes(admin1, 'in'), outA = await audioBytes(tablet, 'out');
  await waitFor('audio to flow', async () => (await audioBytes(admin1, 'in')) > inA && (await audioBytes(tablet, 'out')) > outA, 10000, 500);
  check('c6 dashboard receives audio from the tablet and the tablet sends it', true);
  check('c7 noise meter is paused during the call', !(await noiseBadge(tablet)) && (await liveTracks(tablet, 'noise')) === 0);

  // ---- (d1) hang up from the door ----
  await tablet.click('callHangup');
  await waitFor('the door hang-up', async () => !(await callBadge(tablet)), 10000);
  check('d1 door hang-up hides the microphone badge', true);
  check('d2 every call track on the tablet is stopped', (await liveTracks(tablet, 'call')) === 0);
  await waitFor('the dashboard to see the end', async () => /Call ended/.test(await admin1.text('intercomText')), 10000);
  check('d3 dashboard shows the call ended', true);
  await waitFor('the noise meter to resume', () => noiseBadge(tablet), 20000);
  check('d4 noise meter resumes after the call', (await liveTracks(tablet, 'noise')) >= 1);

  // ---- (d2) hang up from the dashboard ----
  await sleep(3500);
  await tablet.click('callButton');
  await waitFor('the second ring', () => admin1.shown('intercomAnswer'), 10000);
  await admin1.click('intercomAnswer');
  await waitFor('the second call to connect', async () => /Connected/.test(await callStatus(tablet)), 20000);
  await admin1.click('intercomHangup');
  await waitFor('the dashboard hang-up', async () => !(await callBadge(tablet)), 10000);
  check('d5 dashboard hang-up hides the tablet microphone badge', true);
  check('d6 tablet shows the call ended and every call track is stopped', /ended/i.test(await callStatus(tablet)) && (await liveTracks(tablet, 'call')) === 0, await callStatus(tablet));
  await waitFor('the meter again', () => noiseBadge(tablet), 20000);
  check('d7 noise meter resumes after a dashboard hang-up', true);
  await tablet.eval(`document.getElementById('callPanel').classList.add('hidden'),true`);

  // ---- (e) unanswered ring times out ----
  await sleep(3500);
  const pcsE = await pcCount(tablet);
  await tablet.click('callButton');
  await waitFor('the ring', () => admin1.shown('intercomAnswer'), 10000);
  await waitFor('the ring timeout', async () => /Nobody answered/.test(await callStatus(tablet)), (RING_SECONDS + 10) * 1000);
  check('e1 an unanswered ring ends with "Nobody answered" on the tablet', (await pcCount(tablet)) === pcsE && !(await callBadge(tablet)), 'peer connections ' + await pcCount(tablet));
  await waitFor('the banner to clear', async () => !(await admin1.shown('intercomAnswer')), 10000);
  check('e2 the ring banner clears on the dashboard', true);

  // ---- (f) a second dashboard answering after the first ----
  await sleep(3500);
  const admin2 = await open(base + '/dashboard', { dashboard: true });
  await waitFor('two dashboards online', async () => (await adminsOnline()) === 2, 15000);
  // Simulate the race of two people clicking at nearly the same moment: the second page has not yet processed the
  // "taken" event, so it keeps its banner and its click reaches the server after the first answer.
  await admin2.eval('window.dropRing=function(){},true');
  await tablet.click('callButton');
  await waitFor('both banners', async () => (await admin1.shown('intercomAnswer')) && (await admin2.shown('intercomAnswer')), 10000);
  await admin1.click('intercomAnswer');
  await waitFor('the first answer to connect', async () => /Talking with/.test(await admin1.text('intercomText')), 20000);
  await admin2.click('intercomAnswer');
  await waitFor('the second answer to be refused', async () => /Already answered/.test(await admin2.eval('intercom.message')), 10000);
  check('f1 the second dashboard gets "Already answered"', true);
  check('f2 the second dashboard opened no microphone or connection', (await gumCount(admin2)) === 0 && (await pcCount(admin2)) === 0);
  await admin1.click('intercomHangup');
  await waitFor('the tablet to end', async () => !(await callBadge(tablet)), 10000);
  await admin2.close(); created.splice(created.indexOf(admin2), 1);

  // ---- (h) a ?nostream=1 page ----
  const preview = await open(tabletUrl + '&nostream=1');
  await sleep(4000);
  check('h1 a ?nostream=1 page has no call button, no noise pill, no microphone and no peer connection',
    !(await preview.shown('callButton')) && !(await preview.shown('micNotice')) && (await gumCount(preview)) === 0 && (await pcCount(preview)) === 0);

  // ---- (g) what the server wrote ----
  await sleep(500);
  const log = serverLog.join('');
  const lines = log.split('\n').filter(line => line.includes('Intercom:'));
  check('g1 log has the started line', lines.some(l => /Intercom: call from Front Conference Room started at the door/.test(l)), lines.join(' | '));
  check('g2 log has the answered line with the administrator token wording', lines.some(l => /Front Conference Room answered by the administrator token/.test(l)));
  check('g3 log has the ended lines (door, dashboard, nobody answered)', ['hung up at the door', 'hung up by the administrator token', 'nobody answered', 'no administrator on the dashboard'].every(why => lines.some(l => l.includes('call ended') && l.includes(why))), lines.join(' | '));
  check('g4 log contains no SDP or ICE text and no token', !/v=0|candidate|a=ice|a=fingerprint/i.test(log) && !log.includes(TOKEN));
}

try {
  await main();
} catch (error) {
  fail('script', error.message);
} finally {
  await cleanup();
}
console.log(failures ? `${failures} check(s) FAILED` : 'All scenarios passed (a b c d e f g h)');
process.exit(failures ? 1 : 0);
