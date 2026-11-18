#!/usr/bin/env node
// Real-browser check of the dashboard's birthdays and work anniversaries panel (list, search, hide, add, remove).
// Starts this repo's server on a spare port (demo mode, a random test token, a temporary data folder) and a headless
// Chrome at 1139 px wide, and drives Chrome through the DevTools protocol using Node's global WebSocket.
// No npm packages. Nothing leaves this Mac and no Microsoft calendar is touched.
//
//   node tools/e2e-celebrations.mjs
//
// Set CHROME_BIN to use another headless Chrome. The test token is random, never printed, and used only here.
// Saves a screenshot of the panel to /tmp/celebrations-1139.png.
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
const WIDTH = 1139;
async function main() {
  if (!fs.existsSync(CHROME)) throw new Error('headless Chrome not found (set CHROME_BIN)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-celebrations-'));
  cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const port = await freePort();
  const base = 'http://localhost:' + port;
  const serverLog = [];
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: tmp, PORT: String(port), DEMO_MODE: 'true', ADMIN_TOKEN: TOKEN, DATA_DIR: path.join(tmp, 'data'), WEATHER_ENABLED: 'false', ROOMS_JSON: JSON.stringify([{ id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: 'America/New_York' }]) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  cleanups.push(() => stopProcess(server));
  server.stdout.on('data', chunk => serverLog.push(String(chunk)));
  server.stderr.on('data', chunk => serverLog.push(String(chunk)));
  await waitFor('the server', async () => (await fetch(base + '/healthz')).ok, 15000);
  const debugPort = await freePort();
  const chrome = spawn(CHROME, ['--remote-debugging-port=' + debugPort, '--user-data-dir=' + path.join(tmp, 'profile'), '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(() => stopProcess(chrome));
  const version = await waitFor('Chrome', async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(), 15000);
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  cleanups.push(() => cdp.close());
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, targetId, sessionId);
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('adminToken', ${JSON.stringify(TOKEN)});` });
  await page.send('Page.navigate', { url: base + '/dashboard' });
  const q = expr => page.eval(expr);
  const rows = () => q(`Array.prototype.map.call(document.querySelectorAll('#celebrations .celeb-row strong'),function(e){return e.textContent})`);
  const result = () => q(`document.querySelector('#celebrations .celeb-result').textContent`);
  const clickText = (scope, label) => q(`(function(){var b=Array.prototype.find.call(document.querySelectorAll(${JSON.stringify(scope)}+' button'),function(x){return x.textContent===${JSON.stringify(label)}});if(!b)return false;b.click();return true})()`);
  const setValue = (selector, value) => q(`(function(){var e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  // ---- the list ----
  const first = await waitFor('the list', async () => { const r = await rows(); return r.length >= 6 ? r : null; }, 20000);
  check('1 the panel lists the demo people', first.length === 8, first.join(', '));
  const days = await q(`Array.prototype.map.call(document.querySelectorAll('#celebrations .celeb-row .muted'),function(e){return e.textContent})`);
  check('2 rows show kind, date and days until', /Birthday \u00b7 [A-Z][a-z]{2} \d+ \u00b7 (today|tomorrow|in \d+ days)/.test(days[0]) && days.some(d => /Work anniversary \(since \d{4}\)/.test(d)), days[0]);
  const order = await (await fetch(base + '/api/admin/celebrations', { headers: { authorization: 'Bearer ' + TOKEN } })).json();
  check('3 rows are sorted by the next date', JSON.stringify(first) === JSON.stringify(order.people.map(p => p.name)) && order.people.every((p, i) => i === 0 || order.people[i - 1].daysUntil <= p.daysUntil));
  check('4 the heading and the hint are there', (await q(`document.querySelector('#celebrations h2').textContent`)) === 'Birthdays and work anniversaries' && /Hide keeps the calendar/.test(await q(`document.querySelector('#celebrations').textContent`)));
  // ---- search and filter ----
  await setValue('#celebrations input[type=search]', 'fred');
  check('5 search narrows the list', JSON.stringify(await rows()) === JSON.stringify(['Fred Mortati']), (await rows()).join(','));
  await setValue('#celebrations input[type=search]', '');
  await setValue('#celebrations .celeb-bar select', 'birthday');
  const births = await rows();
  check('6 the kind filter shows birthdays only', births.length === 4 && births.every(n => order.people.find(p => p.name === n).kind === 'birthday'), births.join(','));
  await setValue('#celebrations .celeb-bar select', 'all');
  // ---- hide and show again ----
  await clickText('#celebrations .celeb-row:first-child', 'Hide');
  await waitFor('hidden tag', async () => (await q(`document.querySelectorAll('#celebrations .hidden-tag').length`)) === 1, 10000);
  check('7 Hide marks the person as Hidden and says the calendar was not changed', /not changed/.test(await result()), await result());
  await clickText('#celebrations .celeb-row:first-child', 'Show again');
  await waitFor('shown again', async () => (await q(`document.querySelectorAll('#celebrations .hidden-tag').length`)) === 0, 10000);
  check('8 Show again clears the tag', /shown on the door screens again/.test(await result()));
  // ---- add ----
  await setValue('#celebrations .celeb-form input[type=text]', 'Ann Lee');
  await setValue('#celebrations .celeb-form select:nth-of-type(2)', '3');
  await setValue('#celebrations .celeb-form input[aria-label="Day of the month"]', '9');
  await setValue('#celebrations .celeb-form input[aria-label="Year the person started"]', '2020');
  await clickText('#celebrations .celeb-form', 'Add person');
  await waitFor('Ann Lee in the list', async () => (await rows()).includes('Ann Lee'), 10000);
  check('9 an added person appears', /Ann Lee was added/.test(await result()), await result());
  const annText = await q(`Array.prototype.find.call(document.querySelectorAll('#celebrations .celeb-row'),function(r){return r.textContent.indexOf('Ann Lee')===0}).textContent`);
  check('10 the new row shows "since 2020" and Mar 9', /since 2020/.test(annText) && /Mar 9/.test(annText), annText);
  await setValue('#celebrations .celeb-form input[type=text]', 'Mary-Jane Lee');
  await setValue('#celebrations .celeb-form input[aria-label="Year the person started"]', '2020');
  await setValue('#celebrations .celeb-form input[aria-label="Day of the month"]', '9');
  await clickText('#celebrations .celeb-form', 'Add person');
  await waitFor('the refusal', async () => /name/.test(await result()), 10000);
  check('11 a name the door screens would misread is refused with a plain message', /plain name|person/.test(await result()) && !(await rows()).includes('Mary-Jane Lee'), await result());
  // ---- remove with confirmation ----
  await setValue('#celebrations input[type=search]', 'ann lee');
  await clickText('#celebrations .celeb-row', 'Remove from calendar');
  await waitFor('the confirm box', async () => (await q(`document.querySelectorAll('#celebrations .confirm').length`)) === 1, 10000);
  const confirmText = await q(`document.querySelector('#celebrations .confirm').textContent`);
  check('12 the confirmation names the person, the series, the calendar and Deleted Items', /Ann Lee \(since 2020\)/.test(confirmText) && /whole yearly Work Anniversary series/.test(confirmText) && /Calendar \(demo\)/.test(confirmText) && /Deleted Items in Outlook/.test(confirmText), confirmText);
  await clickText('#celebrations .confirm', 'Cancel');
  check('13 Cancel leaves the person in the list', (await q(`document.querySelectorAll('#celebrations .confirm').length`)) === 0 && (await rows()).includes('Ann Lee'));
  // Birthdays have no Remove button
  await setValue('#celebrations input[type=search]', 'maria');
  check('14 a birthday has no Remove button, only Hide and a note about Outlook', !(await clickText('#celebrations .celeb-row', 'Remove from calendar')) && /Outlook/.test(await q(`document.querySelector('#celebrations .celeb-row').textContent`)));
  await setValue('#celebrations input[type=search]', 'ann lee');
  await clickText('#celebrations .celeb-row', 'Remove from calendar');
  await waitFor('the confirm box again', async () => (await q(`document.querySelectorAll('#celebrations .confirm').length`)) === 1, 10000);
  await clickText('#celebrations .confirm', 'Delete series');
  await waitFor('Ann Lee gone', async () => !(await rows()).includes('Ann Lee') && /was removed/.test(await result()), 10000);
  check('15 Delete series removes the person and says it is in Deleted Items', /Deleted Items/.test(await result()), await result());
  await setValue('#celebrations input[type=search]', '');
  // ---- recent activity ----
  await q(`document.getElementById('refresh').click(),true`);
  await waitFor('the activity lines', async () => (await q(`document.getElementById('activity').textContent`)).includes('Celebrations:'), 15000);
  const activity = await q(`Array.prototype.map.call(document.querySelectorAll('#activity p'),function(p){return p.textContent})`);
  const lines = activity.filter(l => l.includes('Celebrations:'));
  check('16 Recent activity lists the changes (hide, show again, add, remove)', lines.length === 4 && lines.some(l => /hidden from the door screens/.test(l)) && lines.some(l => /shown again/.test(l)) && lines.some(l => /Ann Lee .*added/.test(l)) && lines.some(l => /Ann Lee .*removed/.test(l)), lines.join(' | '));
  check('17 the activity lines carry no token', !lines.join('').includes(TOKEN));
  // ---- layout and screenshot ----
  await q(`document.querySelector('#celebrations').scrollIntoView(),true`);
  const metrics = await q(`(function(){var r=document.getElementById('celebrations').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height,sw:document.documentElement.scrollWidth,iw:innerWidth}})()`);
  check('18 the page is ' + WIDTH + ' px wide with no sideways scrolling', metrics.iw === WIDTH && metrics.sw <= WIDTH, JSON.stringify(metrics));
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, metrics.y - 20), width: WIDTH, height: Math.min(metrics.h + 40, 1600), scale: 1 } });
  fs.writeFileSync('/tmp/celebrations-1139.png', Buffer.from(shot.data, 'base64'));
  check('19 a screenshot was saved to /tmp/celebrations-1139.png', fs.statSync('/tmp/celebrations-1139.png').size > 5000);
  const log = serverLog.join('');
  check('20 the server log has no token', !log.includes(TOKEN));
  await page.close();
}
try {
  await main();
} catch (error) {
  fail('script', error.message);
} finally {
  await cleanup();
}
console.log(failures ? `${failures} check(s) FAILED` : 'All celebrations checks passed');
process.exit(failures ? 1 : 0);
