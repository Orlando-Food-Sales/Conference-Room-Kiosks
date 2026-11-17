import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
const html = read('dashboard.html');
const css = read('dashboard.css');
const js = read('dashboard.js');
const theme = read('theme.css');

const variables = text => Object.fromEntries([...text.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map(m => [m[1], m[2].toLowerCase()]));

test('the dashboard uses the same colours as the room displays (dark theme)', () => {
  const dark = variables(theme.slice(0, theme.indexOf(':root[data-theme="light"]')));
  const mine = variables(css);
  for (const name of ['bg', 'panel', 'card', 'line', 'text', 'muted', 'on-accent', 'green', 'glow']) assert.equal(mine[name], dark[name], `--${name} matches theme.css`);
  assert.equal(mine.accent, dark.blue, 'the accent is the displays\' crimson');
  for (const old of ['#57a5ff', '#07111f', '#0d1b2c', '#26364b']) assert.ok(!css.toLowerCase().includes(old), `the old blue colour ${old} is gone`);
});

test('the dashboard shows the Orlando Foods logo, with a name for screen readers', () => {
  assert.match(html, /<img class="logo" src="\/logo\/orlando-foods-white\.png" srcset="[^"]+" sizes="[^"]+" alt="Orlando Foods"/);
  assert.ok(fs.existsSync(new URL('../public/logo/orlando-foods-white.png', import.meta.url)));
  assert.match(html, /<meta name="theme-color" content="#120b0d">/);
  assert.match(css, /\.logo\{[^}]*height:clamp/);
});

test('every element the dashboard script looks up is on the page, and the version is shown', () => {
  const wanted = new Set([...js.matchAll(/\$\('([A-Za-z]+)'\)/g)].map(m => m[1]));
  assert.ok(wanted.size >= 8, 'the script looks things up');
  for (const id of wanted) assert.ok(html.includes(`id="${id}"`), `#${id} is in dashboard.html`);
  assert.match(js, /data\.version\?'v'\+data\.version/, 'the version appears in the status line');
});

test('buttons and links are easy to tap and show where the keyboard is', () => {
  assert.match(css, /button\{[^}]*min-height:44px/);
  assert.match(css, /button:focus-visible[^{]*\{outline:2px solid var\(--accent\)/);
  assert.match(css, /@media \(max-width:560px\)/, 'there is a layout for phones');
  assert.match(css, /minmax\(min\(300px,100%\),1fr\)/, 'room cards never overflow a narrow screen');
});

test('the dashboard heading and browser tab title say the same thing', () => {
  const heading = html.match(/<h1>([^<]+)<\/h1>/)[1];
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  assert.equal(heading, 'Room Display Control');
  assert.equal(title, heading, 'the tab title matches the heading');
  assert.doesNotMatch(html, /Operations dashboard/);
});
test('the dashboard shows each tablet\'s battery, and "not reported" when it cannot tell', () => {
  const start = js.indexOf('function batteryText');
  const batteryText = new Function(`${js.slice(start, js.indexOf('\n', start))}; return batteryText;`)();
  assert.equal(batteryText({}), '');
  assert.equal(batteryText({ battery: null }), ' \u00b7 battery not reported');
  assert.equal(batteryText({ battery: { level: 87, charging: true } }), ' \u00b7 battery 87% charging');
  assert.equal(batteryText({ battery: { level: 8, charging: false } }), ' \u00b7 battery 8% not charging');
  assert.match(js, /t\.battery\.level<10\?'low'/);
  assert.match(css, /\.devices \.low\{/);
});
test('the dashboard has Take photo and Live camera for rooms with a camera, and a viewer that can be closed', () => {
  assert.match(js, /var photo=button\('Take photo',function\(\)\{cameraView\(room,false\)\}\)/);
  assert.match(js, /var live=button\('Live camera',function\(\)\{cameraView\(room,true\)\}\)/);
  assert.match(js, /if\(!room\.camera\)\{photo\.disabled=live\.disabled=true;/, 'shown on every room, greyed out until the camera is set up');
  assert.match(js, /Camera not set up yet/);
  assert.match(js, /Date\.now\(\)-started>=300000/, 'live view stops by itself after 5 minutes');
  assert.match(js, /URL\.revokeObjectURL/, 'old pictures are released, not kept');
  assert.match(html, /<section id="camera" class="camera hidden"/);
  assert.match(js, /\$\('cameraStop'\)\.addEventListener\('click',closeCamera\)/);
});
test('the camera viewer can switch between the front and back camera', () => {
  assert.match(html, /<button id="cameraFront" type="button">Front camera<\/button> <button id="cameraBack" type="button">Back camera<\/button>/);
  assert.match(js, /\/camera\/side',\{method:'POST',body:JSON\.stringify\(\{side:side\}\)\}/);
});
test('the dashboard has no control that starts a call: only the answer, signal, hangup and stream routes', () => {
  assert.ok(!/\/api\/intercom\//.test(js), 'the public ring route is not used');
  assert.ok(!/intercom\/ring/.test(js));
  const routes = new Set([...js.matchAll(/\/api\/admin\/intercom\/([a-z]+)/g)].map(m => m[1]));
  assert.deepEqual([...routes].sort(), ['answer', 'hangup', 'signal', 'stream']);
  assert.match(js, /fetch\('\/api\/admin\/intercom\/stream\?client='[^)]*authorization: 'Bearer '/, 'the stream sends the token');
  assert.match(html, /id="intercomAudio" autoplay/);
  assert.match(js, /getUserMedia\(\{ audio: true \}\)/);
  assert.match(js, /new RTCPeerConnection\(\{ iceServers: \[\] \}\)/);
  assert.equal((js.match(/getUserMedia\(/g) || []).length, 1, 'the microphone is only opened after Answer');
  assert.match(js, /async function answerCall\(\)[\s\S]*intercom\/answer[\s\S]*getUserMedia/, 'Answer posts first, then opens the microphone');
});
test('noise and location text per tablet, with a safe map link', () => {
  assert.match(js, /function noiseText\(t\)/);
  assert.match(js, /noise not measured/);
  assert.match(js, /noiseText\(t\)/);
  assert.match(js, /locationText\(t\)/);
  assert.match(js, /Location not reported/);
  assert.match(js, /https:\/\/www\.openstreetmap\.org\/\?mlat='/);
  assert.match(js, /link\.target = '_blank'; link\.rel = 'noopener'/);
  assert.match(js, /this tablet is on plain http: intercom, noise and location need https/);
});
test('the intercom additions need no inline scripts or styles (CSP)', () => {
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), 'no inline script');
  assert.ok(!/\sstyle="/.test(html), 'no inline style attribute');
  assert.ok(!/setAttribute\('style'|\.style\.cssText/.test(js));
  assert.match(css, /\.intercom\.ringing/);
});
