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
  assert.match(app, /var IS_KIOSK = new URLSearchParams\(location\.search\)\.get\('kiosk'\) === '1';/);
  assert.match(app, /if \(IS_KIOSK\) document\.documentElement\.classList\.add\('kiosk'\);/);
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
  const listened = previewJs.match(/\[('room', 'theme'[^\]]*)\]\.forEach/)[1];
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
  for (const size of ['1139x711', '711x1139', '1006x600', '600x1006', '1340x800', '800x1340', '1000x500']) assert.ok(screens.includes(size), `${size} is offered`);
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

test('the refresh button and the dashboard\'s Refresh display really reload the page, but only when the server answers', () => {
  const reload = app.match(/async function reloadPage\(\) \{[\s\S]*?\n\}/);
  assert.ok(reload, 'reloadPage is in app.js');
  assert.match(reload[0], /fetch\('\/healthz'/, 'checks the server first');
  assert.match(reload[0], /location\.reload\(\)/, 'a real reload, so new code, styles and outfits load');
  assert.ok(reload[0].indexOf('/healthz') < reload[0].indexOf('location.reload()'), 'the check comes before the reload');
  assert.match(reload[0], /catch \(_\) \{[\s\S]*initializeRoom\(state\.room\.id\)[\s\S]*return;/, 'with the server down it stays on the page and re-reads the meetings');
  assert.match(app, /\$\('refreshButton'\)\.addEventListener\('click', function \(\) \{ reloadPage\(\); \}\)/, 'the tablet button uses it');
  assert.match(app, /data\.detail\.action === 'refresh'\) requestRefresh\(\)/, 'the dashboard button (and a deploy) uses it, through requestRefresh');
});

test('the preview shows a real room from the server, and picking a room never drops the preview settings', () => {
  assert.match(previewHtml, /<label>Room\s*<select id="room">/, 'a Room choice on the preview page');
  assert.match(previewJs, /fetch\('\/api\/rooms'\)/, 'filled from the server (front and back in production, "room" in demo mode)');
  assert.match(previewJs, /return '\/room\/' \+ encodeURIComponent\(\$\('room'\)\.value \|\| 'room'\) \+ '\?' \+ q;/);
  assert.doesNotMatch(previewJs, /'\/room\/room\?'/, 'no longer a fixed room that only the demo has');
  assert.match(app, /history\.replaceState\(\{\}, '', room\.displayUrl \+ location\.search\);/, 'choosing a room from the picker keeps ?kiosk=1 and preview settings');
});

test('the layout is sized for the room tablets (1139x711) and still fits the older 1006x600 one', () => {
  const css = fs.readFileSync(new URL('../public/theme.css', import.meta.url), 'utf8');
  assert.equal((css.match(/@media \(max-height: 760px\)/g) || []).length, 3, 'compact status-card spacing up to 760 px tall: both tablets (711 and 600), not full-size screens');
  assert.doesNotMatch(css, /@media \(max-height: 700px\)/, 'the old 700 px limit missed the 711 px room tablets');
  const small = css.match(/@media \(max-height: 640px\) \{([\s\S]*?)\n\}/);
  assert.ok(small && /\.meeting-subject \{ font-size: 1\.05rem; \}/.test(small[1]), 'smaller meeting rows only on the 600 px tablet');
  const compact = css.match(/@media \(max-height: 760px\) \{\n([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(compact, /\.meeting-subject/, 'the room tablets keep the larger meeting titles');
  assert.match(css, /\.topbar h1 \{ font-size: clamp\(1\.5rem, min\(3vw, 6\.5vh\), 4\.4rem\); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/, 'the room name stays on one line');
  assert.match(css, /room tablets report 1139x711 at 1\.13x/, 'the target size is written down where the fit rules are');
});

test('the room display cannot be pinch-zoomed, and resets itself if a zoom gets through; the dashboard and preview still zoom', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/theme.css', import.meta.url), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">/);
  assert.match(css, /html, body \{ touch-action: pan-x pan-y;/, 'no pinch or double-tap zoom');
  assert.match(css, /input, textarea, select \{ -webkit-user-select: text; user-select: text;/, 'text boxes can still be typed in and selected');
  assert.match(app, /addEventListener\('touchmove', function \(event\) \{[^\n]*event\.touches\.length > 1[^\n]*noZoom\(event\); \}, \{ passive: false \}\)/, 'two-finger moves are blocked (passive: false, or preventDefault is ignored)');
  assert.match(app, /\['gesturestart', 'gesturechange', 'gestureend'\]\.forEach/, 'Safari pinch is blocked');
  const check = app.match(/function checkZoom\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(check, /if \(!zoomedIn\(\) \|\| Date\.now\(\) - lastTouchAt < ZOOM_RESET_MS\) return;/, 'only after 20 s without a touch');
  assert.match(check, /bookingPanel[\s\S]*messagePanel[\s\S]*return;/, 'never while someone is typing in a panel');
  assert.match(check, /reloadPage\(\);/, 'the reload checks the server first, so an outage never leaves an error page');
  assert.match(app, /var ZOOM_RESET_MS = 20000/);
  for (const page of ['dashboard.html', 'preview.html']) {
    const other = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    assert.doesNotMatch(other, /user-scalable=no|maximum-scale=1/, `${page} keeps normal zoom (people use it at a desk)`);
    assert.doesNotMatch(other, /theme\.css/, `${page} does not load the room display's no-zoom CSS`);
  }
});

test('the current weather shows after the date under the clock, in Fahrenheit, without growing the top bar', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/theme.css', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');
  assert.match(html, /<strong id="clock">--:--<\/strong><span class="clock-sub"><span id="date">—<\/span><span id="weatherNow" class="weather-now hidden"/, 'on the date line');
  assert.match(css, /\.clock-sub \{ display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/, 'one line, never wraps');
  assert.match(css, /\.weather-now::before \{ content: " \\00b7\\0020"; \}/, '" · " between the date and the weather');
  assert.match(css, /\.weather-now \.weather-icon \{ display: inline-block; height: 1em; line-height: 1;/, 'the emoji does not make the line taller');
  const show = new Function('document', 'forcedTemp', 'forcedWeather', 'weather', `${js.match(/var ICONS = [^\n]+\n  var LABELS = [^\n]+\n  var fahrenheit = [^\n]+\n  function showWeather\([\s\S]*?\n  \}/)[0]}\nreturn showWeather;`);
  const run = (weather, condition, isDay, { temp = null, forced = null } = {}) => {
    const kids = [], box = { classList: { hidden: true, add() { this.hidden = true; }, remove() { this.hidden = false; } }, set textContent(v) { kids.length = 0; }, get firstChild() { return kids[0] || null; }, appendChild(k) { kids.push(k); } };
    const doc = { getElementById: () => box, createElement: () => ({ setAttribute() { } }), createTextNode: text => ({ textContent: text }) };
    show(doc, temp, forced, weather)(condition, isDay);
    return box.classList.hidden ? null : kids.map(k => k.textContent).join('');
  };
  assert.equal(run({ temperatureC: 8.9, feelsLikeC: 5 }, 'clouds', true), '\u2601\ufe0f 48\u00b0F Cloudy \u00b7 feels 41\u00b0');
  assert.equal(run({ temperatureC: 21.1, feelsLikeC: 21.6 }, 'clear', true), '\u2600\ufe0f 70\u00b0F Sunny', 'no "feels" within 5 F');
  assert.equal(run({ temperatureC: 3, feelsLikeC: 1 }, 'clear', false), '\ud83c\udf19 37\u00b0F Clear', 'a moon at night');
  assert.equal(run({ temperatureC: -1.1, feelsLikeC: -7.2 }, 'ice', true), '\ud83e\uddca 30\u00b0F Sleet \u00b7 feels 19\u00b0');
  assert.equal(run(null, 'snow', true, { temp: '-2' }), '\u2744\ufe0f 28\u00b0F Snow', 'previews show too');
  assert.equal(run(null, '', true), null, 'no weather: just the date');
  assert.equal(run({ temperatureC: 10 }, 'clouds', true, { forced: 'none' }), null, '?weather=none hides it');
  assert.match(js, /showWeather\(condition, root\.dataset\.day !== '0'\);/, 'updated with the background mood (every 10 minutes)');
});

test('during a meeting the door screen says how long is left ("ends in 12 min")', () => {
  const endsInText = new Function(`${app.match(/function endsInText\(end, now\) \{[\s\S]*?\n\}/)[0]}\nreturn endsInText;`)();
  const now = Date.parse('2027-03-10T15:00:00Z'), at = minutes => new Date(now + minutes * 60000).toISOString();
  assert.equal(endsInText(at(12), now), 'ends in 12 min');
  assert.equal(endsInText(at(11.5), now), 'ends in 12 min', 'rounded up');
  assert.equal(endsInText(at(0.2), now), 'ends in 1 min', 'never "0 min" while the meeting is on');
  assert.equal(endsInText(at(-0.5), now), 'ends in 1 min', 'a late redraw never shows a negative time');
  assert.equal(endsInText(at(59), now), 'ends in 59 min');
  assert.equal(endsInText(at(60), now), 'ends in 1 h');
  assert.equal(endsInText(at(80), now), 'ends in 1 h 20 min');
  assert.equal(endsInText(at(150), now), 'ends in 2 h 30 min');
  assert.match(app, /\(current\.subject \|\| 'Reserved'\) \+ ' · until ' \+ formatTime\(current\.end\) \+ ' · ' \+ endsInText\(current\.end, now\)/, 'shown after the end time');
  assert.match(app, /setInterval\(render, 30000\)/, 'redrawn every 30 seconds');
  const css = fs.readFileSync(new URL('../public/theme.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 801px\) \{ \.status-copy \{ max-width: calc\(100% - 420px\); \} \}/, 'a long title wraps before Snoopy instead of running under him');
});

test('a refresh from the dashboard or a deploy waits while someone is typing in a panel, at most 3 minutes', () => {
  const source = app.match(/var REFRESH_WAIT_MS = [^\n]+\nfunction panelOpen\(\) \{[^\n]+\}\nfunction requestRefresh\(\) \{[\s\S]*?\n\}/)[0];
  let clock = 0, timers = [], reloads = 0;
  const open = { booking: false, message: false };
  const el = id => ({ classList: { contains: () => !(id === 'bookingPanel' ? open.booking : open.message) } });
  const make = new Function('$', 'state', 'reloadPage', 'setTimeout', 'clearTimeout', 'Date', `${source}\nreturn requestRefresh;`);
  const requestRefresh = make(el, {}, () => { reloads += 1; }, (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length; }, () => { timers = []; }, { now: () => clock });
  const advance = ms => { const end = clock + ms; while (timers.length && timers[0].at <= end) { const t = timers.shift(); clock = t.at; t.fn(); } clock = end; };
  requestRefresh();
  assert.equal(reloads, 1, 'nobody typing: reloads at once');
  open.booking = true;
  requestRefresh();
  advance(60000);
  assert.equal(reloads, 1, 'booking panel open: waits');
  open.booking = false;
  advance(2000);
  assert.equal(reloads, 2, 'reloads within 2 seconds of the panel closing');
  open.message = true;
  requestRefresh();
  advance(3 * 60000 + 2000);
  assert.equal(reloads, 3, 'a panel left open does not block the refresh for more than 3 minutes');
  assert.match(app, /\$\('refreshButton'\)\.addEventListener\('click', function \(\) \{ reloadPage\(\); \}\)/, 'the round button on the tablet still reloads at once');
});

test('the deploy script reloads the tablets after a deploy that changed web files, safely', () => {
  const script = fs.readFileSync(new URL('../scripts/deploy-on-server.sh', import.meta.url), 'utf8');
  assert.match(script, /printf '%s\\n' "\$CHANGES" \| awk '\{print \$2\}' \| grep -E '\^public\/' >\/dev\/null && needs_refresh=yes/, 'only when web files changed');
  assert.match(script, /--refresh\) REFRESH=yes;/); assert.match(script, /--no-refresh\) REFRESH=no;/);
  assert.match(script, /admin_call\(\) \{ curl -fsS --max-time 10 -H @"\$AUTH_FILE" "\$@"; \}/, 'the token goes to curl in a file, never on the command line');
  assert.match(script, /\( umask 077; printf 'authorization: Bearer %s\\n' "\$token" > "\$AUTH_FILE" \)/, 'the token file is private');
  assert.doesNotMatch(script.replace(/printf 'authorization: Bearer %s\\n'/, ''), /Bearer \$/, 'no other use of the token');
  assert.match(script, /-d '\{"action":"refresh"\}' "\$BASE_URL\/api\/admin\/rooms\/\$room\/control"/, 'the same request as the dashboard\'s Refresh display');
  const finish = script.slice(script.indexOf('say "8. Smoke test"'));
  assert.ok(finish.indexOf('say "9. Reloading the tablets"') > finish.indexOf('rollback; fi'), 'only after the smoke test passed');
  assert.match(script, /refresh_tablets after-restart \|\| true; else refresh_tablets \|\| true; fi/, 'a failure here never fails the deploy');
  assert.match(script, /while now=\$\(online_tablets\); \[\[ \$now -lt \$tablets_before && \$waited -lt 60 \]\]; do sleep 3;/, 'after a restart it waits up to a minute for the tablets to reconnect');
});
