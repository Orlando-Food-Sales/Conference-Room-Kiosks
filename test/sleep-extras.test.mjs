import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Tests for the things added on top of Codex's engine: the awake extras and the self-wake ("stir").
// Same approach as sleep-engine.test.mjs: fake clock and timers, no browser.
const source = fs.readFileSync(new URL('../public/snoopy-sleep-engine.js', import.meta.url), 'utf8');
const realManifest = JSON.parse(fs.readFileSync(new URL('../public/snoopy/sleep-manifest.json', import.meta.url)));
const EXTRAS = ['awake_shrug', 'awake_thinking', 'look_around', 'awake_glance', 'sleepy_droop'];

function setup({ reducedMotion = false, random = () => 0.5, patch = {} } = {}) {
  const manifest = structuredClone(realManifest); Object.assign(manifest, patch);
  let time = 0, id = 0; const tasks = new Map(), frames = [];
  const box = {}; vm.runInNewContext(source, box);
  const player = box.SnoopySleepEngine.create({
    manifest, reducedMotion, random, now: () => time,
    setTimeout: (fn, ms) => { const key = ++id; tasks.set(key, { fn, at: time + ms }); return key; },
    clearTimeout: key => tasks.delete(key),
    onFrame: s => frames.push({ ...s, time })
  });
  function advance(ms) {
    const end = time + ms; let guard = 0;
    for (;;) {
      const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      assert.ok(++guard < 200000, 'runaway timers');
      time = next[1].at; tasks.delete(next[0]); next[1].fn();
    }
    time = end;
  }
  const clipsSince = from => [...new Set(frames.filter(f => f.time >= from).map(f => f.clip))];
  return { player, advance, frames, manifest, pending: () => tasks.size, time: () => time, clipsSince };
}

test('every tap shows something different: the extras rotate, one wake window to the next', () => {
  const s = setup(); s.player.setClosed(true, true);
  const seenPerWindow = [];
  for (let i = 0; i < 5; i += 1) {
    const from = s.time(); s.player.tap(); s.advance(24000);
    assert.equal(s.player.snapshot().phase, 'asleep', `window ${i + 1} ends asleep`);
    seenPerWindow.push(s.clipsSince(from).filter(c => EXTRAS.includes(c)));
  }
  for (const [i, extras] of seenPerWindow.entries()) assert.ok(extras.length >= 1 && extras.length <= 4, `window ${i + 1} shows ${extras.length} extras: ${extras}`);
  const all = new Set(seenPerWindow.flat());
  for (const id of EXTRAS) assert.ok(all.has(id), `${id} appears within five wake windows`);
  assert.notDeepEqual(seenPerWindow[0], seenPerWindow[1], 'consecutive windows are not the same show');
});

test('extras only start after the wave, and he still goes back to sleep on time', () => {
  const s = setup(); s.player.setClosed(true, true); s.player.tap(); s.advance(24000);
  const order = s.frames.filter((f, i) => !i || s.frames[i - 1].clip !== f.clip).map(f => f.clip);
  const wave = order.indexOf('sleepy_wave');
  assert.ok(wave > 0 && order.slice(0, wave).every(c => !EXTRAS.includes(c)), 'no extra before the wake sequence has finished');
  assert.equal(order.filter(c => c === 'sleepy_wave').length, 1, 'one wave only');
  const drowsy = s.frames.find(f => f.clip === 'drowsy_blink');
  assert.ok(drowsy.time >= 15000 && drowsy.time <= 15000 + 2000, `drowsy blink starts ${drowsy.time} ms after the tap (15 s window, at most one extra to finish)`);
  assert.equal(s.player.snapshot().awakeUntil, 0);
});

test('a self-wake happens on a Closed day, about every 4 minutes, with the same stir, yawn, stretch and wave', () => {
  const s = setup({ random: () => 0.5 }); s.player.setClosed(true, true);
  s.advance(239000);
  assert.ok(s.frames.every(f => !f.active || ['sleep_breathing', 'sleep_ear_flick', 'sleep_paw_twitch'].includes(f.clip)), 'asleep and calm until the time comes');
  s.advance(9000);
  const from = 239000; const order = s.frames.filter(f => f.time >= from).filter((f, i, a) => !i || a[i - 1].clip !== f.clip).map(f => f.clip);
  assert.deepEqual(order.slice(0, 8), ['sleep_breathing', 'tap_reaction', 'eyes_open', 'head_raise', 'yawn', 'stretch', 'sit_up', 'sleepy_wave']);
  s.advance(30000);
  assert.equal(s.player.snapshot().phase, 'asleep', 'and back to sleep afterwards');
  assert.ok(s.frames.some(f => f.clip === 'return_to_lying'));
  const before = s.frames.filter(f => f.clip === 'tap_reaction').length;
  s.advance(250000);
  assert.ok(s.frames.filter(f => f.clip === 'tap_reaction' && f.frame === 0).length >= 2, 'and again a few minutes later');
  assert.ok(before >= 1);
});

test('the self-wake only lasts stirAwakeMs; a tap during it extends it to the full 15 seconds', () => {
  const s = setup({ random: () => 0.5 }); s.player.setClosed(true, true);
  s.advance(243000);
  const started = s.frames.find(f => f.clip === 'tap_reaction').time;
  assert.equal(s.player.snapshot().awakeUntil, started + 10000, 'ten seconds, not fifteen');
  s.advance(1000);
  s.player.tap();
  assert.equal(s.player.snapshot().awakeUntil, s.time() + 15000, 'a tap makes it the usual 15 seconds');
  assert.equal(s.frames.filter(f => f.clip === 'sleepy_wave' && f.frame === 0).length, 0, 'and does not restart the wake sequence');
  s.advance(40000);
  assert.equal(s.player.snapshot().phase, 'asleep');
});

test('the time between self-wakes varies from 0.6 to 1.4 times the setting', () => {
  const firstStir = random => { const s = setup({ random: () => random }); s.player.setClosed(true, true); s.advance(600000); return s.frames.find(f => f.clip === 'tap_reaction').time; };
  const soonest = firstStir(0), latest = firstStir(1);
  assert.ok(soonest >= 144000 && soonest < 144000 + 3500, `soonest ${soonest}`);
  assert.ok(latest >= 336000 && latest < 336000 + 3500, `latest ${latest}`);
});

test('no self-wake when it is switched off, with reduced motion, or after the office reopens', () => {
  const off = setup({ patch: { stirEveryMs: 0 } }); off.player.setClosed(true, true); off.advance(3 * 3600000);
  assert.ok(!off.frames.some(f => f.clip === 'tap_reaction'), 'stirEveryMs 0 means never');
  const still = setup({ reducedMotion: true }); still.player.setClosed(true, true); still.advance(3 * 3600000);
  assert.ok(!still.frames.some(f => f.clip === 'tap_reaction'), 'reduced motion keeps a still pose');
  const reopened = setup(); reopened.player.setClosed(true, true); reopened.advance(244500);
  assert.equal(reopened.player.snapshot().phase, 'waking');
  reopened.player.setClosed(false);
  assert.equal(reopened.pending(), 0, 'every timer is cancelled');
  const count = reopened.frames.length; reopened.advance(3600000);
  assert.equal(reopened.frames.length, count, 'nothing moves any more');
  assert.equal(reopened.player.snapshot().active, false);
});

test('an older sheet without the extras still works: only the look-around is used', () => {
  const clips = structuredClone(realManifest.clips);
  for (const id of ['awake_shrug', 'awake_thinking', 'awake_glance', 'sleepy_droop']) delete clips[id];
  const s = setup({ patch: { clips, rows: 19 } }); s.player.setClosed(true, true); s.player.tap(); s.advance(24000);
  const shown = s.clipsSince(0).filter(c => EXTRAS.includes(c));
  assert.ok(shown.every(c => c === 'look_around'), `only look_around is used: ${shown}`);
  assert.equal(s.player.snapshot().phase, 'asleep');
});
