'use strict';
// Snoopy: plays every row of public/snoopy/snoopy.png (8 columns x 11 rows, 192x208 cells).
// A base mood follows the room state from app.js; random flourishes (look around, wave,
// jump, walk) keep him lively; tapping the screen makes him look that way.
// Debug: add ?snoopy=<animation> to the URL to hold one animation (e.g. ?snoopy=runRight).
(function () {
  var COLS = 8, ROWS = 11;

  function cells(row, count) {
    var out = [];
    for (var c = 0; c < count; c += 1) out.push([row, c]);
    return out;
  }

  var ANIMATIONS = {
    idle: { frames: cells(0, 6), ms: 260 },
    runRight: { frames: cells(1, 8), ms: 110 },
    runLeft: { frames: cells(2, 8), ms: 110 },
    waving: { frames: cells(3, 4), ms: 220 },
    jumping: { frames: cells(4, 5), ms: 160 },
    failed: { frames: cells(5, 8), ms: 200 },
    waiting: { frames: cells(6, 6), ms: 260 },
    working: { frames: cells(7, 6), ms: 260 },
    review: { frames: cells(8, 6), ms: 260 },
    look: { frames: cells(9, 8).concat(cells(10, 8)), ms: 120 }   // full 360 degree sweep
  };

  var reduceMotion = globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var forced = new URLSearchParams(location.search).get('snoopy');
  if (forced && !ANIMATIONS[forced]) forced = null;

  var host = document.getElementById('availability') || document.body;
  var el = document.createElement('div');
  el.className = 'snoopy';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Snoopy');
  host.appendChild(el);

  var name = forced || 'idle', index = 0, timer = null;
  var plan = null;               // { repeat, then } for one-shot animations
  var x = 0;                     // horizontal offset in px (walking)
  var nextFlourishAt = Date.now() + 8000;

  function draw() {
    var cell = ANIMATIONS[name].frames[index];
    el.style.backgroundPosition = (cell[1] / (COLS - 1) * 100) + '% ' + (cell[0] / (ROWS - 1) * 100) + '%';
  }

  function setX(value, ms) {
    x = value;
    el.style.transition = ms ? 'transform ' + ms + 'ms linear' : 'none';
    el.style.setProperty('--snoopy-x', value + 'px');
  }

  function start(animation, once) {
    name = animation; index = 0; plan = once || null;
    draw(); step();
  }

  function step() {
    clearTimeout(timer);
    if (reduceMotion) return;
    timer = setTimeout(function () {
      var anim = ANIMATIONS[name];
      index += 1;
      if (index >= anim.frames.length) {
        index = 0;
        if (plan) {
          plan.repeat -= 1;
          if (plan.repeat <= 0) { var done = plan.then; plan = null; if (done) done(); else start(baseMood()); return; }
        }
      }
      draw(); step();
    }, ANIMATIONS[name].ms);
  }

  // Calm mood that follows the room.
  function baseMood() {
    var s = globalThis.state;
    var sync = document.getElementById('syncState');
    if (sync && /unavailable/i.test(sync.textContent)) return 'failed';
    if (!s || !s.room) return 'idle';
    var now = Date.now();
    var events = s.events || [];
    var busy = events.some(function (e) { return new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now; });
    if (busy) return 'working';
    var soon = events.some(function (e) { var t = new Date(e.start).getTime(); return t > now && t - now <= 5 * 60000; });
    if (soon) return 'waiting';
    var justEnded = events.some(function (e) { var t = new Date(e.end).getTime(); return t <= now && now - t <= 3 * 60000; });
    return justEnded ? 'review' : 'idle';
  }

  function walk() {
    if (globalThis.innerWidth <= 800) return start('idle');
    var goRight = x < -100;                       // head towards the side with more room
    var target = goRight ? Math.min(x + 220, 40) : Math.max(x - 220, -300);
    var distance = Math.abs(target - x);
    var loops = 2;
    var duration = ANIMATIONS.runRight.frames.length * ANIMATIONS.runRight.ms * loops;
    setX(target, duration);
    start(goRight ? 'runRight' : 'runLeft', { repeat: loops, then: function () { start(baseMood()); } });
    return distance;
  }

  function flourish() {
    var mood = baseMood();
    var choices = mood === 'idle' ? ['look', 'waving', 'jumping', 'walk', 'look'] : (mood === 'failed' ? [] : ['look']);
    if (!choices.length) return;
    var pick = choices[Math.floor(Math.random() * choices.length)];
    if (pick === 'walk') walk();
    else start(pick, { repeat: 1, then: function () { start(baseMood()); } });
  }

  function tick() {
    if (forced) return;
    var now = Date.now();
    if (plan) return;                              // a one-shot is playing
    var mood = baseMood();
    if (mood !== name) start(mood);
    if (now >= nextFlourishAt) {
      nextFlourishAt = now + 12000 + Math.random() * 12000;
      flourish();
    }
  }

  // Look towards a tapped point. 0 degrees is up, clockwise; 16 directions.
  function lookAt(clientX, clientY) {
    var box = el.getBoundingClientRect();
    var dx = clientX - (box.left + box.width / 2);
    var dy = clientY - (box.top + box.height / 2);
    var angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    var dir = Math.round(angle / 22.5) % 16;
    name = 'look'; plan = { repeat: 1, then: null }; index = dir;
    clearTimeout(timer);
    draw();
    timer = setTimeout(function () { plan = null; start(baseMood()); }, 1600);
  }

  el.addEventListener('click', function (event) {
    event.stopPropagation();
    nextFlourishAt = Date.now() + 15000;
    setX(x, 0);
    start('jumping', { repeat: 1, then: function () { start(baseMood()); } });
  });
  document.addEventListener('pointerdown', function (event) {
    if (forced || reduceMotion || event.target === el) return;
    nextFlourishAt = Date.now() + 15000;
    lookAt(event.clientX, event.clientY);
  });

  draw();
  step();
  setInterval(tick, 1000);
})();
