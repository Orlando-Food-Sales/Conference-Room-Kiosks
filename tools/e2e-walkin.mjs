#!/usr/bin/env node
// Real-browser check of the walk-in Teams call door states (INSTALL-UBUNTU.md section 12g).
// Starts this repo's server on a spare port (demo mode, a random test token) and a headless Chrome, and drives
// Chrome through the DevTools protocol using Node's global WebSocket. No npm packages. Nothing leaves this Mac:
// everything runs on http://localhost, which browsers treat as a secure context.
//
//   node tools/e2e-walkin.mjs
//
// Two demo servers run side by side (the call takes about 90 seconds to be confirmed): one outside office hours
// (call shown, nothing booked) and one open all day (call shown, booked automatically).
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
// Counts every RTCPeerConnection and getUserMedia call in the page, so the checks can see what the page itself did.

const W = 1139, H = 711;
const SHOTS = [];
async function main() {
  if (!fs.existsSync(CHROME)) throw new Error('headless Chrome not found (set CHROME_BIN)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-walkin-'));
  cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // Every day of the week except today (in the room's time zone), so the office is closed for the whole run.
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
  const todayNumber = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(today);
  const otherDays = [0, 1, 2, 3, 4, 5, 6].filter(d => d !== todayNumber).join(',');

  async function startServer(extraEnv) {
    const port = await freePort();
    const base = 'http://localhost:' + port;
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH, HOME: tmp, PORT: String(port), DEMO_MODE: 'true', DEMO_MEETINGS: 'off', WALK_IN_ENABLED: 'true', ADMIN_TOKEN: TOKEN,
        ROOMS_JSON: JSON.stringify([{ id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: 'America/New_York' }]), ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    cleanups.push(() => stopProcess(child));
    await waitFor('the server', async () => (await fetch(base + '/healthz')).ok, 15000);
    return base;
  }
  const closedBase = await startServer({ OFFICE_DAYS: otherDays });
  const openBase = await startServer({ OFFICE_HOURS: 'off' });

  const debugPort = await freePort();
  const chrome = spawn(CHROME, ['--remote-debugging-port=' + debugPort, '--user-data-dir=' + path.join(tmp, 'profile'), '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(() => stopProcess(chrome));
  const version = await waitFor('Chrome', async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(), 15000);
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  cleanups.push(() => cdp.close());
  const created = [];
  cleanups.push(async () => { for (const page of created) await page.close(); });
  async function open(url) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, targetId, sessionId);
    created.push(page);
    await page.send('Page.enable'); await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url });
    return page;
  }
  async function shot(page, name) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(os.tmpdir(), `e2e-walkin-${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    const width = fs.readFileSync(file).readUInt32BE(16), height = fs.readFileSync(file).readUInt32BE(20);
    SHOTS.push(file);
    check(`screenshot ${name} is ${W}x${H}`, width === W && height === H, `${width}x${height}`);
  }
  const fits = (page, id) => page.eval(`(function(){var e=document.getElementById(${JSON.stringify(id)});return e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=window.innerWidth})()`);
  const call = (base, on) => fetch(base + '/api/admin/rooms/front/simulate-call', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ call: on }) });
  const reserveHidden = page => page.eval(`document.getElementById('reserveButton').classList.contains('hidden')`);

  // ---- (a) the office is closed all day: a call must still show In use, never Closed, and nothing is booked ----
  const closed = await open(closedBase + '/room/front');
  await waitFor('the closed door screen', async () => /Closed/.test(await closed.text('statusText')), 20000);
  check('a1 closed office shows Closed before any call', true);
  // ---- (b) open all day: Available first ----
  const opened = await open(openBase + '/room/front');
  await waitFor('the open door screen', async () => /Available/.test(await opened.text('statusText')), 20000);
  check('b1 Available before any call', true);
  await shot(opened, 'available');
  check('a2 call simulation accepted (closed-office server)', (await call(closedBase, true)).ok);
  check('b2 call simulation accepted (open-office server)', (await call(openBase, true)).ok);

  await waitFor('the closed-office door to show the call', async () => /Teams call in progress/.test(await closed.text('currentMeeting')), 150000, 1000);
  check('a3 In use during the call, never Closed', (await closed.text('statusText')) === 'In use');
  check('a4 line says Teams call in progress · not booked', (await closed.text('currentMeeting')) === 'Teams call in progress \u00b7 not booked', await closed.text('currentMeeting'));
  check('a5 quick booking hidden during the call', await reserveHidden(closed));
  check('a6 text is not cut off', (await fits(closed, 'currentMeeting')) && (await fits(closed, 'statusText')));
  await shot(closed, 'call-not-booked');

  await waitFor('the open-office door to show the automatic booking', async () => /booked automatically/.test(await opened.text('currentMeeting')), 150000, 1000);
  check('b3 In use and booked automatically', (await opened.text('statusText')) === 'In use' && (await opened.text('currentMeeting')) === 'Teams call in progress \u00b7 booked automatically', await opened.text('currentMeeting'));
  check('b4 no "ends in" text while the end keeps moving', !/ends in|until/.test(await opened.text('currentMeeting')));
  check('b5 the booked call is in the list', /Teams call \(booked automatically\)/.test(await opened.eval(`document.getElementById('eventList').textContent`)));
  check('b6 quick booking hidden', await reserveHidden(opened));
  await shot(opened, 'call-booked');

  // ---- (c) the call ends: the closed office goes back to Closed ----
  await call(closedBase, false);
  await waitFor('the call to end', async () => /Closed/.test(await closed.text('statusText')), 240000, 1000);
  check('a7 back to Closed after the call ends (3 minutes of no call)', true);

  // ---- (d) the preview pages ----
  const p1 = await open(closedBase + '/room/front?preview=walkin');
  await waitFor('preview walkin', async () => /not booked/.test(await p1.text('currentMeeting')), 20000);
  check('d1 preview=walkin shows In use and not booked', (await p1.text('statusText')) === 'In use');
  await shot(p1, 'preview-walkin');
  const p2 = await open(closedBase + '/room/front?preview=walkinbooked');
  await waitFor('preview walkinbooked', async () => /booked automatically/.test(await p2.text('currentMeeting')), 20000);
  check('d2 preview=walkinbooked shows In use and booked automatically', (await p2.text('statusText')) === 'In use' && !/ends in/.test(await p2.text('currentMeeting')));
  await shot(p2, 'preview-walkinbooked');
  console.log('Screenshots: ' + SHOTS.join(' '));
}
try {
  await main();
} catch (error) {
  fail('script', error.message);
} finally {
  await cleanup();
}
console.log(failures ? `${failures} check(s) FAILED` : 'All walk-in checks passed');
process.exit(failures ? 1 : 0);
