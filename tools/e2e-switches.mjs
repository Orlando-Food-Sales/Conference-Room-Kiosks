#!/usr/bin/env node
// Real-browser check of the per-room feature switches (INSTALL-UBUNTU.md section 12h).
// Starts this repo's server on a spare port (demo mode, a random test token, a temporary data folder) and a headless
// Chrome with fake media devices, and drives Chrome through the DevTools protocol using Node's global WebSocket.
// No npm packages. Nothing leaves this Mac: everything runs on http://localhost, which browsers treat as a secure context.
//
//   node tools/e2e-switches.mjs
//
// Every tablet-side switch is flipped through the admin API while the tablet page is open, and the page is watched:
// microphone tracks, geolocation calls, weather requests, Snoopy and the buttons. The camera switch is not driven here:
// Fully's address must be a private network address, so it is covered by the unit tests with a fake Fully instead.
// Finally the dashboard is opened at 1139x711 and a screenshot of the Features box is saved to a temporary path.
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
const W = 1139, H = 711;
// Counts what the page itself does: microphone requests (and their tracks), geolocation reads.
const HOOK = `(function(){window.__gum=[];window.__geo=0;var md=navigator.mediaDevices;if(md&&md.getUserMedia){var g=md.getUserMedia.bind(md);md.getUserMedia=function(c){var rec={constraints:JSON.parse(JSON.stringify(c||{})),stream:null};window.__gum.push(rec);return g(c).then(function(s){rec.stream=s;return s;});};}
var geo=navigator.geolocation;if(geo){['getCurrentPosition','watchPosition'].forEach(function(n){var o=geo[n].bind(geo);geo[n]=function(){window.__geo+=1;return o.apply(null,arguments);};});}})();`;
const SHOTS = [];

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error('headless Chrome not found (set CHROME_BIN)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-switches-'));
  cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const port = await freePort();
  const base = 'http://localhost:' + port;
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: tmp, PORT: String(port), DEMO_MODE: 'true', DEMO_MEETINGS: 'off', OFFICE_HOURS: 'off', ADMIN_TOKEN: TOKEN, DATA_DIR: path.join(tmp, 'data'),
      NOISE_METER: 'on', INTERCOM_ENABLED: 'true', LOCATION_REPORT: 'on',
      ROOMS_JSON: JSON.stringify([
        { id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: 'America/New_York', allowQuickBooking: true },
        { id: 'back', name: 'Back Conference Room', email: 'back@example.com', timeZone: 'America/New_York', allowQuickBooking: true }])
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  cleanups.push(() => stopProcess(server));
  await waitFor('the server', async () => (await fetch(base + '/healthz')).ok, 15000);
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const setSwitch = async (room, key, value) => { const r = await post(`/api/admin/rooms/${room}/switches`, { key, value }); if (!r.ok) throw new Error(`switch ${key} answered ${r.status}`); };

  const debugPort = await freePort();
  const chrome = spawn(CHROME, ['--remote-debugging-port=' + debugPort, '--user-data-dir=' + path.join(tmp, 'profile'), '--no-sandbox', '--disable-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(() => stopProcess(chrome));
  const version = await waitFor('Chrome', async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(), 15000);
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  cleanups.push(() => cdp.close());
  await cdp.send('Browser.grantPermissions', { origin: base, permissions: ['audioCapture', 'geolocation'] });
  const created = [];
  cleanups.push(async () => { for (const page of created) await page.close(); });
  async function open(url, { dashboard = false, width = W, height = H, celebration = false } = {}) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, targetId, sessionId);
    created.push(page);
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    if (dashboard) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('adminToken', ${JSON.stringify(TOKEN)});` });
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setGeolocationOverride', { latitude: 40.9595, longitude: -74.1252, accuracy: 35 });
    cdp.listeners.push(msg => { if (msg.sessionId === sessionId && msg.method === 'Network.requestWillBeSent') page.requests.push(msg.params.request.url + ' ' + JSON.stringify(msg.params.initiator || {})); });
    if (celebration) {
      // The demo server has no birthday list: answer the tablet's own request with one, so the tablet's switch is what is tested.
      await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/celebrations*' }] });
      cdp.listeners.push(msg => {
        if (msg.sessionId !== sessionId || msg.method !== 'Fetch.requestPaused') return;
        const body = Buffer.from(JSON.stringify({ celebrations: [{ kind: 'birthday', name: 'Test Person' }], holiday: null, nextHoliday: null })).toString('base64');
        page.send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body }).catch(() => { });
      });
    }
    await page.send('Page.navigate', { url });
    return page;
  }
  async function shot(page, name, w, h) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(os.tmpdir(), `e2e-switches-${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    SHOTS.push(file);
    check(`screenshot ${name} is ${w}x${h}`, fs.readFileSync(file).readUInt32BE(16) === w && fs.readFileSync(file).readUInt32BE(20) === h);
  }
  const liveMic = page => page.eval(`window.__gum.filter(function(g){var a=g.constraints.audio;return a===true||(a&&a.echoCancellation===false)}).reduce(function(n,g){return n+(g.stream?g.stream.getTracks().filter(function(t){return t.readyState==='live'}).length:0)},0)`);
  const gum = page => page.eval('window.__gum.length');
  const geo = page => page.eval('window.__geo');
  // The warnings banner (app.js) still reads /api/weather for official alerts while the weather switch is off, so only the weather line's own request (theme.js) is counted.
  const weatherRequests = page => page.requests.filter(u => u.includes('/api/weather') && u.includes('theme.js')).length;
  const bg = page => page.eval(`(document.querySelector('.snoopy')||{style:{}}).style.backgroundPosition||''`);
  const attr = (page, name) => page.eval(`document.documentElement.hasAttribute(${JSON.stringify(name)})`);

  const front = await open(base + '/room/front?kiosk=1');
  const back = await open(base + '/room/back?kiosk=1');
  const all = [front, back];
  await waitFor('the tablet pages', async () => (await liveMic(front)) >= 1 && (await liveMic(back)) >= 1 && (await geo(front)) >= 1, 25000);

  // ---- noise ----
  check('noise 1 meter runs while the switch is on (microphone tracks live)', (await liveMic(front)) >= 1);
  await setSwitch('front', 'noise', false);
  await waitFor('microphone to stop', async () => (await liveMic(front)) === 0, 8000);
  const gumAfterOff = await gum(front);
  await sleep(3000);
  check('noise 2 off: microphone tracks stopped and no new getUserMedia', (await liveMic(front)) === 0 && (await gum(front)) === gumAfterOff);
  check('noise 3 the back room page is unaffected', (await liveMic(back)) >= 1);
  await setSwitch('front', 'noise', true);
  await waitFor('microphone to restart', async () => (await liveMic(front)) >= 1, 10000);
  check('noise 4 back on: the meter runs again', true);

  // ---- location ----
  await setSwitch('front', 'location', false);
  await sleep(1500);
  const geoAfterOff = await geo(front);
  await sleep(3000);
  check('location 1 off: no new geolocation call after the change', (await geo(front)) === geoAfterOff);
  await front.send('Page.reload');
  await sleep(6000);
  check('location 2 off: a reload makes no geolocation call at all', (await geo(front)) === 0, 'calls ' + await geo(front));
  check('location 3 the back room page still read its location', (await geo(back)) >= 1);
  await setSwitch('front', 'location', true);
  await waitFor('geolocation to come back', async () => (await geo(front)) >= 1, 10000);
  check('location 4 back on: the tablet reads its location again', true);

  // ---- intercom ----
  await waitFor('call button', () => front.shown('callButton'), 10000);
  check('intercom 1 on: the Call button is shown', true);
  await setSwitch('front', 'intercom', false);
  await waitFor('call button to hide', async () => !(await front.shown('callButton')), 8000);
  const ring = await post('/api/intercom/ring', { roomId: 'front', tabletId: 'e2e-test' });
  check('intercom 2 off: the Call button is hidden and a ring is refused (404)', ring.status === 404, 'status ' + ring.status);
  check('intercom 3 the back room still shows its Call button', await back.shown('callButton'));
  await setSwitch('front', 'intercom', true);
  await waitFor('call button back', () => front.shown('callButton'), 8000);
  check('intercom 4 back on: the Call button is back', true);

  // ---- weather ----
  await waitFor('the weather line', () => front.shown('weatherNow'), 20000);
  check('weather 1 on: the weather line is shown and the page has a weather mood', await attr(front, 'data-weather'));
  await setSwitch('front', 'weather', false);
  await waitFor('weather line to hide', async () => !(await front.shown('weatherNow')), 8000);
  const weatherBefore = weatherRequests(front);
  await sleep(3000);
  check('weather 2 off: line hidden, no data-weather attribute, no new /api/weather request', !(await attr(front, 'data-weather')) && weatherRequests(front) === weatherBefore);
  await front.send('Page.reload');
  const reloadFrom = front.requests.length;
  await sleep(6000);
  check('weather 3 off: a reload makes no weather-line request', !front.requests.slice(reloadFrom).some(u => u.includes('/api/weather') && u.includes('theme.js')));
  await setSwitch('front', 'weather', true);
  await waitFor('weather line back', () => front.shown('weatherNow'), 20000);
  check('weather 4 back on: the weather line is back', true);

  // ---- snoopy ----
  const snoopyShown = page => page.eval(`(function(){var e=document.querySelector('.snoopy');return Boolean(e)&&getComputedStyle(e).display!=='none'})()`);
  check('snoopy 1 on: Snoopy is displayed', await snoopyShown(front));
  await setSwitch('front', 'snoopy', false);
  await waitFor('Snoopy to hide', async () => !(await snoopyShown(front)), 8000);
  check('snoopy 2 off: Snoopy is not displayed, the back room still shows him', (await snoopyShown(back)) === true);
  await setSwitch('front', 'snoopy', true);
  await waitFor('Snoopy back', () => snoopyShown(front), 8000);
  check('snoopy 3 back on: Snoopy is displayed again', true);

  // ---- snoopy animation ----
  await setSwitch('front', 'snoopyMotion', false);
  await sleep(1500);
  const still = await bg(front);
  await sleep(3000);
  check('snoopyMotion 1 off: the picture stays constant for 3 seconds', (await bg(front)) === still);
  await setSwitch('front', 'snoopyMotion', true);
  await waitFor('Snoopy to move', async () => (await bg(front)) !== still, 30000, 500);
  check('snoopyMotion 2 back on: Snoopy moves again', true);

  // ---- quick booking ----
  await waitFor('quick-book buttons', () => front.shown('quickBook'), 15000);
  check('quickBooking 1 on: the quick-book buttons are shown', true);
  await setSwitch('front', 'quickBooking', false);
  await waitFor('quick-book to hide', async () => !(await front.shown('quickBook')), 8000);
  check('quickBooking 2 off: the buttons are hidden', true);
  await setSwitch('front', 'quickBooking', true);
  await waitFor('quick-book back', () => front.shown('quickBook'), 15000);
  check('quickBooking 3 back on: the buttons are back', true);

  // ---- celebrations ----
  const celeb = await open(base + '/room/front?kiosk=1', { celebration: true });
  await waitFor('the birthday', () => celeb.shown('celebration'), 20000);
  check('celebrations 1 on: the birthday is shown', true);
  await setSwitch('front', 'celebrations', false);
  await waitFor('the birthday to hide', async () => !(await celeb.shown('celebration')), 10000);
  check('celebrations 2 off: the birthday is hidden', true);
  await setSwitch('front', 'celebrations', true);
  await waitFor('the birthday back', () => celeb.shown('celebration'), 10000);
  check('celebrations 3 back on: the birthday is shown again', true);
  check('no page reported a script error', (await Promise.all(all.concat(celeb).map(p => p.eval('window.__err||0')))).every(n => !n));

  // ---- dashboard: leave some switches overridden so the rows show the difference ----
  await setSwitch('front', 'noise', false);
  await setSwitch('front', 'location', false);
  await setSwitch('front', 'snoopyMotion', false);
  const dash = await open(base + '/dashboard', { dashboard: true });
  await waitFor('the Features box', () => dash.eval(`document.querySelectorAll('.features .feature-row').length>=10`), 20000);
  check('dashboard 1 every room card has a Features box with all ten rows', await dash.eval(`Array.prototype.every.call(document.querySelectorAll('.features'),function(f){return f.querySelectorAll('.feature-row').length===10})&&document.querySelectorAll('.features').length===2`));
  check('dashboard 2 the overridden rows say what the server setting is', await dash.eval(`document.querySelector('.features').textContent.indexOf('Server setting: on. Overridden by')>=0`));
  await sleep(1500);
  const noClip = await dash.eval(`Array.prototype.every.call(document.querySelectorAll('.features *'),function(e){var r=e.getBoundingClientRect();var f=e.closest('.features').getBoundingClientRect();return r.width===0||(r.right<=f.right+1&&r.left>=f.left-1)})`);
  check('dashboard 3 nothing in the Features box sticks out of it at 1139 px', noClip);
  await dash.eval(`document.querySelector('.features').scrollIntoView({block:'start'}),window.scrollBy(0,-12),true`);
  await sleep(400);
  await shot(dash, 'dashboard-1139', W, H);
  await dash.eval(`window.scrollBy(0,${H - 120}),true`);
  await sleep(400);
  await shot(dash, 'dashboard-1139-lower', W, H);
  await dash.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await dash.eval(`document.querySelector('.features').scrollIntoView({block:'start'}),true`);
  await sleep(400);
  check('dashboard 4 nothing sticks out sideways at 560 px', await dash.eval(`document.documentElement.scrollWidth<=window.innerWidth+1`));
  await shot(dash, 'dashboard-560', 560, 900);
  console.log('Screenshots (not committed): ' + SHOTS.join(' '));
  console.log('Camera switch: not driven in the browser (Fully needs a private address); see the unit tests with a fake Fully.');
}
try {
  await main();
} catch (error) {
  fail('script', error.message);
} finally {
  await cleanup();
}
console.log(failures ? `${failures} check(s) FAILED` : 'All switch checks passed');
process.exit(failures ? 1 : 0);
