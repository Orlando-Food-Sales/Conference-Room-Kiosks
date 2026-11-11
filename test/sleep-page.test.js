import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = name => new URL(`../${name}`, import.meta.url);
const read = name => fs.readFileSync(file(name), 'utf8');
const png = name => { const b = fs.readFileSync(file(name)); assert.equal(b.subarray(1, 4).toString(), 'PNG', `${name} is a PNG`); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] }; };
const manifest = JSON.parse(read('public/snoopy/sleep-manifest.json'));

test('the sleep artwork exists, is transparent, and is exactly the size the manifest promises', () => {
  const atlas = png('public/snoopy/sleep.png');
  assert.deepEqual([atlas.width, atlas.height], [manifest.cellWidth * manifest.columns, manifest.cellHeight * manifest.rows], 'the character atlas');
  const size = name => { const { width, height } = png(name); return [width, height]; };
  assert.deepEqual(size('public/snoopy/sleep-house.png'), [manifest.cellWidth, manifest.cellHeight], 'the doghouse layer');
  assert.deepEqual(size('public/snoopy/sleep-zs.png'), [manifest.cellWidth * 8, manifest.cellHeight], 'the floating Z strip');
  assert.equal(manifest.cellHeight * 192, manifest.cellWidth * 208, 'cells keep the 192:208 proportions');
  assert.ok(manifest.cellWidth >= 288, 'the sheet is the sharper 1.5x (or bigger) version, not the original 192x208');
  for (const name of ['sleep', 'sleep-house', 'sleep-zs']) assert.equal(png(`public/snoopy/${name}.png`).colorType, 6, `${name} has a transparent background`);
  assert.deepEqual([manifest.atlas, manifest.house, manifest.zs], ['/snoopy/sleep.png', '/snoopy/sleep-house.png', '/snoopy/sleep-zs.png']);
});

test('every sleep clip sits inside the atlas and no two clips share a row', () => {
  assert.equal(manifest.wakeMs, 15000, 'awake for 15 seconds after a tap');
  const names = Object.keys(manifest.clips);
  assert.equal(names.length, 22, 'the 18 original clips plus the 4 extras (shrug, thinking, glance, sleepy droop)');
  assert.equal(manifest.rows, 23);
  const used = new Map();
  for (const name of names) {
    const clip = manifest.clips[name];
    const rows = Math.ceil(clip.count / manifest.columns);
    assert.ok(clip.row >= 0 && clip.row + rows <= manifest.rows, `${name} fits inside ${manifest.rows} rows`);
    assert.ok(clip.ms >= 40 && clip.ms <= 1000, `${name} has a sensible speed`);
    for (let r = clip.row; r < clip.row + rows; r += 1) { assert.ok(!used.has(r), `${name} shares row ${r} with ${used.get(r)}`); used.set(r, name); }
  }
  for (const needed of ['settle_on_roof', 'sleep_breathing', 'tap_reaction', 'yawn', 'stretch', 'sit_up', 'sleepy_wave', 'awake_idle', 'drowsy_blink', 'return_to_lying', 'rest_head_close_eyes', 'awake_shrug', 'awake_thinking', 'awake_glance', 'sleepy_droop']) assert.ok(manifest.clips[needed], `${needed} is there`);
});

test('the display loads the sleep styles, then the engine, then the adapter, after the normal Snoopy', () => {
  const html = read('public/index.html');
  assert.match(html, /<link rel="stylesheet" href="\/snoopy-sleep\.css">/);
  const order = ['/snoopy.js', '/snoopy-sleep-engine.js', '/snoopy-sleep.js'].map(src => html.indexOf(`<script src="${src}"></script>`));
  assert.ok(order.every(position => position > 0), 'all three scripts are on the page');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in that order');
  for (const name of ['public/snoopy-sleep-engine.js', 'public/snoopy-sleep.js', 'public/snoopy-sleep.css']) assert.ok(fs.existsSync(file(name)), name);
});

test('the normal Snoopy hides and stays still while the sleeping one is on screen, and carries on when the office reopens', () => {
  const code = read('public/snoopy.js');
  assert.match(code, /function sleepOwns\(\) \{ return Boolean\(globalThis\.SnoopySleep && globalThis\.SnoopySleep\.ownsPlayback\(\)\); \}/);
  assert.match(code, /addEventListener\('snoopy-sleep-mode'/);
  assert.match(code, /if \(forced \|\| sleepOwns\(\)\) return;/, 'no flourishes while asleep');
  assert.match(code, /reduceMotion \|\| sleepOwns\(\)/, 'a tap does not make the hidden Snoopy look around');
  assert.match(code, /el\.style\.display = 'none'/);
  assert.match(code, /el\.style\.display = ''; if \(!forced\) start\(baseMood\(\)\)/);
});

test('the sleep scripts obey the page security policy (no inline styles, HTML strings or eval)', () => {
  const policy = read('src/server.js').match(/content-security-policy', "([^"]+)"/)[1];
  assert.match(policy, /style-src 'self'(;|$)/, 'the policy this test is checking against');
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
  for (const name of ['public/snoopy-sleep.js', 'public/snoopy-sleep-engine.js']) {
    const code = read(name);
    for (const banned of [/innerHTML/, /insertAdjacentHTML/, /\beval\(/, /new Function\(/, /setAttribute\(['"]style['"]/, /document\.write/]) assert.doesNotMatch(code, banned, `${name} avoids ${banned}`);
  }
});

test('it works from the Closed signal the display already sets, and the preview can show it', () => {
  assert.match(read('public/snoopy-sleep.js'), /document\.documentElement\.dataset\.closed === '1'/);
  assert.match(read('public/app.js'), /document\.documentElement\.dataset\.closed = '1'/);
  assert.match(read('public/preview.html'), /<option value="closed">/, 'the preview has a Closed hours option');
});

test('the sleep adapter takes its cell size from the manifest, so a sharper sheet drops in without code changes', () => {
  const code = read('public/snoopy-sleep.js');
  assert.match(code, /image\(data\.atlas, data\.cellWidth \* 8, data\.cellHeight \* data\.rows\)/);
  assert.match(code, /image\(data\.house, data\.cellWidth, data\.cellHeight\)/);
  assert.match(code, /image\(data\.zs, data\.cellWidth \* 8, data\.cellHeight\)/);
  assert.doesNotMatch(code, /192 \* 8|208 \* 19|cellHeight \* 19\b/, 'no fixed 192x208 or 19 row sizes left');
  assert.match(code, /data\.cellWidth >= 192 && data\.cellWidth <= 576 && data\.cellHeight \* 192 === data\.cellWidth \* 208/, 'any size from 1x to 3x with the same proportions');
});

test('a tap while Closed wakes Snoopy but is not swallowed: buttons, fields and links keep working', () => {
  const code = read('public/snoopy-sleep.js');
  assert.match(code, /addEventListener\('pointerdown', function \(\) \{ player\.tap\(\); \}, true\)/, 'the tap handler only calls tap()');
  assert.doesNotMatch(code, /stopImmediatePropagation|stopPropagation|preventDefault\(\)\s*;?\s*\}\s*\}, true/, 'no stopped or cancelled taps');
  assert.match(read('public/snoopy.js'), /reduceMotion \|\| sleepOwns\(\)/, 'the normal Snoopy ignores the same tap, so only the sleeping one reacts');
});

test('the adapter insists on exactly the clips and rows the manifest has, so a wrong or partial sheet is rejected', () => {
  const code = read('public/snoopy-sleep.js');
  const listed = code.match(/var names = \[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map(name => name.slice(1, -1));
  assert.deepEqual([...listed].sort(), Object.keys(manifest.clips).sort(), 'the adapter requires every clip in the manifest and nothing else');
  assert.match(code, new RegExp(`data\\.rows === ${manifest.rows}\\b`), `it requires ${manifest.rows} rows`);
  assert.match(code, /image\(data\.house, data\.cellWidth, data\.cellHeight\)/);
  // the optional self-wake settings are range-checked
  assert.match(code, /function validStir/);
  assert.ok(manifest.stirEveryMs === 0 || (manifest.stirEveryMs >= 30000 && manifest.stirEveryMs <= 3600000), 'stirEveryMs is in the range the adapter accepts');
  assert.ok(manifest.stirAwakeMs >= 3000 && manifest.stirAwakeMs <= 60000, 'stirAwakeMs is in the range the adapter accepts');
});
