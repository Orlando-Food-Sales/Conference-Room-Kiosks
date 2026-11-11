import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/theme.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

// The tablet page is a plain browser script, so the connection watchdog's decision is pulled out of it and run here.
function loadHeal() {
  const constants = app.match(/var STALE_MS = [^;]+;/);
  const fn = app.match(/function healAction\([\s\S]*?\n\}/);
  assert.ok(constants && fn, 'healAction is in public/app.js');
  return new Function(`${constants[0]}\n${fn[0]}\nreturn { healAction, STALE_MS, RELOAD_AFTER_MS, MIN_BETWEEN_RELOADS_MS };`)();
}

test('auto-heal: fine while pings arrive, reconnect when quiet, reload only after 5 minutes and not too often', () => {
  const { healAction, STALE_MS, RELOAD_AFTER_MS, MIN_BETWEEN_RELOADS_MS } = loadHeal();
  assert.ok(STALE_MS > 2 * 25000, 'more than two missed 25 second pings');
  const long = 24 * 3600000;
  assert.equal(healAction(10000, long), 'ok');
  assert.equal(healAction(STALE_MS - 1, long), 'ok');
  assert.equal(healAction(STALE_MS, long), 'reconnect');
  assert.equal(healAction(RELOAD_AFTER_MS - 1, long), 'reconnect');
  assert.equal(healAction(RELOAD_AFTER_MS, long), 'reload');
  assert.equal(healAction(RELOAD_AFTER_MS, MIN_BETWEEN_RELOADS_MS - 1), 'reconnect', 'recently reloaded: do not reload again');
  assert.equal(healAction(RELOAD_AFTER_MS, MIN_BETWEEN_RELOADS_MS), 'reload');
});

test('the tablet page only reloads after /healthz answers, so an outage never leaves a browser error page', () => {
  const body = app.match(/async function checkConnection\(\)[\s\S]*?\n\}/)[0];
  assert.match(body, /fetch\('\/healthz'/);
  assert.ok(body.indexOf("fetch('/healthz'") < body.indexOf('location.reload()'), 'health check comes before the reload');
  assert.match(body, /NO_STREAM/, 'the dashboard live view (nostream) never reloads itself');
  assert.match(app, /addEventListener\('ping'/, 'pings count as proof the connection is alive');
});

test('kiosk mode (?kiosk=1) hides the refresh and message buttons and nothing else', () => {
  assert.match(app, /get\('kiosk'\) === '1'[^\n]*classList\.add\('kiosk'\)/);
  const rule = css.match(/\.kiosk #refreshButton[^{]*\{[^}]*\}/);
  assert.ok(rule, 'rule exists');
  assert.match(rule[0], /#messageButton/);
  assert.match(rule[0], /display:\s*none/);
  assert.doesNotMatch(rule[0], /reserve|quick/i, 'booking stays available');
  assert.match(html, /id="refreshButton"/);
  assert.match(html, /id="messageButton"/);
});

test('"tomorrow" is worked out by calendar day, so the 23 and 25 hour daylight saving days cannot break it', () => {
  const fn = app.match(/function nextDayKey\([\s\S]*?\n\}/);
  assert.ok(fn, 'nextDayKey is in public/app.js');
  const nextDayKey = new Function(`${fn[0]}\nreturn nextDayKey;`)();
  assert.equal(nextDayKey('2026-11-10'), '2026-11-11');
  assert.equal(nextDayKey('2026-11-30'), '2026-12-01', 'month end');
  assert.equal(nextDayKey('2026-12-31'), '2027-01-01', 'year end');
  assert.equal(nextDayKey('2028-02-28'), '2028-02-29', 'leap day');
  assert.equal(nextDayKey('2027-03-14'), '2027-03-15', 'the day clocks go forward (23 hours long)');
  assert.equal(nextDayKey('2027-11-07'), '2027-11-08', 'the day clocks go back (25 hours long)');
  assert.doesNotMatch(app, /dayKey\(now \+ 86400000\)/, 'no more adding 24 hours to a clock time');
});
