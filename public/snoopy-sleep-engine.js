'use strict';
(function (root) {
  function createSleepPlayer(options) {
    var manifest = options.manifest, now = options.now || Date.now;
    var later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    var reduced = Boolean(options.reducedMotion), active = false, phase = 'off';
    var state = '', frame = 0, queue = [], sequence = null, timer = null, wakeTimer = null;
    var deadline = 0, generation = 0, nextVariation = 0, variation = 0, awakeLookAt = 0;
    function snapshot() { return { active: active, phase: phase, clip: state, frame: frame, awakeUntil: deadline }; }
    function emit() { if (options.onFrame) options.onFrame(snapshot()); }
    function clearAnimation() { generation += 1; cancel(timer); timer = null; }
    function off() {
      clearAnimation(); cancel(wakeTimer); wakeTimer = null;
      active = false; phase = 'off'; deadline = 0; queue = []; sequence = null;
      if (options.onMode) options.onMode(false); emit();
    }
    function play(id, remaining, customFrames) {
      if (!manifest.clips[id]) throw new Error('Unknown sleep clip: ' + id);
      clearAnimation(); state = id; frame = customFrames ? customFrames[0] : 0;
      queue = remaining || []; sequence = customFrames || null; emit();
      if (!reduced) schedule(0);
    }
    function schedule(position) {
      var token = generation, clip = manifest.clips[state];
      timer = later(function () {
        if (!active || token !== generation) return;
        var count = sequence ? sequence.length : clip.count;
        if (position + 1 < count) {
          frame = sequence ? sequence[position + 1] : position + 1; emit(); schedule(position + 1); return;
        }
        finish();
      }, clip.ms);
    }
    function enterSleep() {
      phase = 'asleep'; deadline = 0; cancel(wakeTimer); wakeTimer = null;
      nextVariation = now() + 10000; play('sleep_breathing');
    }
    function returnToSleep() {
      if (!active) return;
      phase = 'returning';
      if (reduced) { enterSleep(); return; }
      play('drowsy_blink', ['return_to_lying', 'rest_head_close_eyes', '@sleep']);
    }
    function finish() {
      if (queue.length) {
        var next = queue[0], rest = queue.slice(1);
        if (next === '@sleep') return enterSleep();
        if (next === '@awake') {
          phase = 'awake'; awakeLookAt = now() + 4000;
          if (now() >= deadline) return returnToSleep();
          return play('awake_idle');
        }
        return play(next, rest);
      }
      if (phase === 'asleep') {
        if (state !== 'sleep_breathing') return play('sleep_breathing');
        if (now() >= nextVariation) {
          nextVariation = now() + 12000;
          return play(variation++ % 2 ? 'sleep_paw_twitch' : 'sleep_ear_flick');
        }
        return play('sleep_breathing');
      }
      if (phase === 'awake') {
        if (now() >= deadline) return returnToSleep();
        if (state === 'awake_idle' && now() >= awakeLookAt) {
          awakeLookAt = now() + 8000; return play('look_around');
        }
        return play('awake_idle');
      }
    }
    function armWakeDeadline() {
      cancel(wakeTimer); var target = deadline;
      wakeTimer = later(function () {
        if (!active || deadline !== target) return;
        // Finish the current pose cycle before settling. No stale callback can revive a cleared sequence.
        if (reduced || (phase === 'awake' && state === 'awake_idle')) returnToSleep();
      }, Math.max(0, deadline - now()));
    }
    function tap() {
      if (!active) return false;
      deadline = now() + manifest.wakeMs; armWakeDeadline();
      if (phase === 'waking' || phase === 'awake') return true;
      var previous = state, previousFrame = frame;
      phase = 'waking';
      if (reduced) { phase = 'awake'; play('awake_idle'); return true; }
      if (previous === 'return_to_lying' || previous === 'drowsy_blink') {
        // Follow the exact already-rendered transition backwards to its supported sitting endpoint.
        var reverse = []; for (var i = previousFrame; i >= 0; i -= 1) reverse.push(i);
        play(previous, ['sleepy_wave', '@awake'], reverse);
      } else if (previous === 'settle_on_roof') {
        play('sleepy_wave', ['@awake']);
      } else if (previous === 'lie_down') {
        var restore = []; for (var j = previousFrame; j >= 0; j -= 1) restore.push(j);
        play('lie_down', ['sleepy_wave', '@awake'], restore);
      } else {
        play('tap_reaction', ['eyes_open', 'head_raise', 'yawn', 'stretch', 'sit_up', 'sleepy_wave', '@awake']);
      }
      return true;
    }
    return {
      setClosed: function (closed, initial) {
        if (!closed) { if (active) off(); return; }
        if (active) return;
        active = true; if (options.onMode) options.onMode(true);
        if (initial || reduced) enterSleep();
        else { phase = 'settling'; play('settle_on_roof', ['lie_down', 'eyes_close', '@sleep']); }
      },
      tap: tap,
      snapshot: snapshot,
      destroy: off
    };
  }
  root.SnoopySleepEngine = { create: createSleepPlayer };
})(globalThis);
