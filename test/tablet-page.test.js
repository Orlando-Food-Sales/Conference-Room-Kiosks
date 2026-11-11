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

test('the weather warning banner says what, until when (in the room time zone), and how many more', () => {
  const fn = app.match(/function weatherAlertText\([\s\S]*?\n\}/);
  assert.ok(fn, 'weatherAlertText is in public/app.js');
  const text = new Function(`${fn[0]}\nreturn weatherAlertText;`)();
  assert.equal(text([], 'America/New_York'), '');
  assert.equal(text(undefined, 'America/New_York'), '');
  assert.match(text([{ event: 'Winter Storm Warning', ends: '2026-11-11T23:00:00Z' }], 'America/New_York'), /^\u26A0 Winter Storm Warning until Wed,? 6:00 PM$/);
  assert.match(text([{ event: 'Heat Advisory', ends: '2026-07-15T16:00:00Z' }], 'America/Chicago'), /until Wed,? 11:00 AM$/, 'a different time zone gives a different clock time');
  assert.equal(text([{ event: 'Flood Watch', ends: null }], 'America/New_York'), '\u26A0 Flood Watch', 'no end time: nothing after the name');
  assert.match(text([{ event: 'Tornado Warning', ends: null }, { event: 'Flood Watch' }, { event: 'Wind Advisory' }], 'UTC'), /^\u26A0 Tornado Warning \(\+2 more\)$/);
});

test('the warning banner is red for warnings and amber for watches, and is on the page', () => {
  assert.match(html, /id="weatherAlert"/);
  assert.match(css, /\.weather-alert\[data-level="severe"\][^{]*\{[^}]*--red/);
  assert.match(app, /box\.dataset\.level = [^;]*notify \? 'severe' : 'watch'/);
  assert.match(app, /loadWeatherAlerts\(\); \}/, 'warnings are loaded when the room starts');
  assert.match(app, /setInterval\(loadWeatherAlerts, 5 \* 60 \* 1000\)/, 'and refreshed every 5 minutes');
  assert.match(app, /get\('warning'\)/, 'the preview option exists');
});

test('ice has its own background mood, like the other weather', () => {
  for (const theme of ['dark', 'light']) assert.match(css, new RegExp(`:root\\[data-weather="ice"\\]\\[data-theme="${theme}"\\]`));
  assert.match(css, /:root\[data-weather="ice"\] body::before/, 'freezing rain streaks');
});

test('the Orlando Foods logo files exist, are small web-ready PNGs with transparency, and match the page', () => {
  const pngInfo = file => {
    const b = fs.readFileSync(file);
    assert.equal(b.subarray(1, 4).toString(), 'PNG', `${file} is a PNG`);
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25], bytes: b.length };
  };
  for (const name of ['white', 'color', 'black']) {
    const info = pngInfo(new URL(`../public/logo/orlando-foods-${name}.png`, import.meta.url));
    assert.equal(info.colorType, 6, `${name} has a transparent background (RGBA)`);
    assert.ok(info.width <= 1000 && info.bytes < 100 * 1024, `${name} is web-sized (${info.width}px, ${info.bytes} bytes)`);
    assert.ok(Math.abs(info.width / info.height - 800 / 295) < 0.05, `${name} is trimmed to the logo`);
  }
  assert.match(html, /logo-for-dark" src="\/logo\/orlando-foods-white\.png"/, 'white logo for the dark theme');
  assert.match(html, /logo-for-light" src="\/logo\/orlando-foods-color\.png"/, 'colour logo for the light theme (its dark text would vanish on dark)');
  assert.match(css, /:root\[data-theme="light"\] \.brand-logo \.logo-for-dark \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 800px\) \{ \.topbar > \.brand-logo \{ display: none; \} \}/, 'hidden on narrow portrait screens');
  assert.doesNotMatch(css, /max-height: 540px\)[^{]*\{ \.topbar > \.brand-logo \{ display: none/, 'but still shown on short landscape screens (540 px tall or less); the real tablet is 1006x600 and gets the normal size');
  assert.match(css, /@media \(max-height: 540px\) \{ \.brand-logo \{ height: clamp\(30px, 9vh, 44px\); \} \}/, 'a little smaller there');
  assert.ok(fs.existsSync(new URL('../assets/logo/Orlando-Foods_Logo_NoTagline_Color.png', import.meta.url)), 'the full-size originals are kept outside the served folder');
});

// ---------------------------------------------------------------------------------------------
// The preview page must keep up with the display: every control is wired up and every option works
// ---------------------------------------------------------------------------------------------

const previewHtml = fs.readFileSync(new URL('../public/preview.html', import.meta.url), 'utf8');
const previewJs = fs.readFileSync(new URL('../public/preview.js', import.meta.url), 'utf8');
const options = id => [...previewHtml.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(m => ({ value: m[1], label: m[2] }));

test('every control on the preview page is listened to and sent to the display', () => {
  const ids = [...previewHtml.matchAll(/<select id="([a-z]+)"/g)].map(m => m[1]);
  assert.ok(ids.length >= 17, 'the controls were found');
  const listened = previewJs.match(/\[('theme'[^\]]*)\]\.forEach/)[1];
  const sent = previewJs.match(/function url\(\) \{[\s\S]*?\n  \}/)[0];
  for (const id of ids) {
    assert.ok(listened.includes(`'${id}'`), `${id} is listened to, so changing it updates the display`);
    if (id !== 'screen') assert.ok(sent.includes(`$('${id}')`), `${id} is added to the display address`);
  }
  assert.ok(ids.includes('kiosk') && ids.includes('warning'), 'kiosk mode and weather warnings can be previewed');
  assert.match(sent, /q\.set\('kiosk'/);
});

test('every weather in the preview has a background mood, and the tour covers them all', () => {
  const weathers = options('weather').map(o => o.value).filter(v => v && v !== 'none');
  assert.deepEqual(weathers, ['clear', 'clouds', 'rain', 'storm', 'snow', 'ice', 'fog']);
  for (const kind of weathers) assert.match(css, new RegExp(`:root\\[data-weather="${kind}"\\]\\[data-theme="dark"\\]`), `${kind} has a mood`);
  const tour = previewJs.match(/var WEATHERS = \[([^\]]*)\]/)[1];
  for (const kind of weathers) assert.ok(tour.includes(`'${kind}'`), `the tour includes ${kind}`);
});

test('the preview offers the real tablet size and the warning examples the display understands', () => {
  const screens = options('screen').map(o => o.value);
  for (const size of ['1006x600', '600x1006', '1340x800', '800x1340', '1000x500']) assert.ok(screens.includes(size), `${size} is offered`);
  const warnings = options('warning').map(o => o.value);
  assert.ok(warnings.some(w => w.includes(';')), 'several warnings at once');
  assert.ok(warnings.some(w => w.endsWith('|watch')) && warnings.some(w => w && w !== 'none' && !w.includes('|')), 'both red and amber');
  assert.match(app, /preview\.split\(';'\)/, 'the display understands several warnings in the address');
});

test('the favicon and touch icon are real files with the right sizes, and every page links them', () => {
  const ico = fs.readFileSync(new URL('../public/favicon.ico', import.meta.url));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], 'an ICO file header');
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256).sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 32, 48], 'it holds 16, 32 and 48 pixel icons');
  const touch = fs.readFileSync(new URL('../public/apple-touch-icon.png', import.meta.url));
  assert.equal(touch.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([touch.readUInt32BE(16), touch.readUInt32BE(20)], [180, 180], 'the touch icon is 180x180');
  for (const page of ['index.html', 'dashboard.html', 'preview.html']) {
    const text = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    assert.match(text, /<link rel="icon" href="\/favicon\.ico"/, `${page} links the favicon`);
    assert.match(text, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/, `${page} links the touch icon`);
  }
});

test('every logo size named in a srcset exists at exactly the width it claims, so the browser never has to shrink a big image', () => {
  const pngWidth = file => fs.readFileSync(new URL(`../public${file}`, import.meta.url)).readUInt32BE(16);
  for (const [name, text] of [['index.html', html], ['dashboard.html', fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8')]]) {
    const sets = [...text.matchAll(/srcset="([^"]+)"/g)].map(m => m[1]);
    assert.ok(sets.length >= 1, `${name} uses srcset`);
    for (const set of sets) {
      const entries = set.split(',').map(e => e.trim().split(/\s+/));
      assert.deepEqual(entries.map(e => e[1]), ['200w', '300w', '400w', '600w', '800w'], 'five sizes, smallest first');
      for (const [file, descriptor] of entries) assert.equal(pngWidth(file), Number(descriptor.slice(0, -1)), `${file} is ${descriptor}`);
    }
  }
  const logoSizes = [...html.matchAll(/<img[^>]* sizes="([^"]+)"/g)].map(m => m[1]);
  assert.equal(logoSizes.length, 4, 'picker and top bar, dark and light');
  assert.ok(logoSizes.every(value => /^clamp\(/.test(value)), 'sizes follow the CSS height of the logo');
});
