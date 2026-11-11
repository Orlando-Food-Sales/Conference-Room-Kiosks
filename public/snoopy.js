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
  el.style.visibility = 'hidden';           // shown once we know which outfit to wear
  host.appendChild(el);
  function reveal() { el.style.visibility = ''; }
  setTimeout(reveal, 3000);                  // never stay hidden if outfits are slow

  var name = forced || 'idle', index = 0, timer = null;
  var plan = null;               // { repeat, then } for one-shot animations
  var x = 0;                     // horizontal offset in px (walking)
  var nextFlourishAt = Date.now() + 8000;

  var sheetRows = ROWS;          // 11 for the base sheet; 9 for outfit sheets without look rows

  function draw() {
    var cell = ANIMATIONS[name].frames[index];
    if (cell[0] >= sheetRows) cell = [0, 0];                    // row missing in this outfit: show idle
    el.style.backgroundPosition = (cell[1] / (COLS - 1) * 100) + '% ' + (cell[0] / (sheetRows - 1) * 100) + '%';
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
    var canLook = sheetRows >= ROWS;
    var party = document.documentElement.dataset.celebrate === '1';
    var choices = mood === 'idle' ? (party ? ['jumping', 'waving', 'jumping', 'walk'] : ['look', 'waving', 'jumping', 'walk', 'look']) : (mood === 'failed' ? [] : ['look']);
    if (!canLook) choices = choices.filter(function (c) { return c !== 'look'; });
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
      nextFlourishAt = now + (document.documentElement.dataset.celebrate === '1' ? 5000 + Math.random() * 5000 : 12000 + Math.random() * 12000);
      flourish();
    }
  }

  // Look towards a tapped point. 0 degrees is up, clockwise; 16 directions.
  function lookAt(clientX, clientY) {
    if (sheetRows < ROWS) return;                                // outfit has no look-around rows
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

  // ---- Outfits: festive dates first, then weather (see snoopy/outfits.json) ----
  var outfits = [];
  var forcedOutfit = new URLSearchParams(location.search).get('outfit');   // id, or "none"
  var forcedDate = (function () { var v = new URLSearchParams(location.search).get('date'); return /^(\d{4}-)?\d\d-\d\d$/.test(v || '') ? v : ''; })();   // preview: ?date=12-25 or ?date=2027-03-25 pretends that is today
  var wornId = null;
  var known = {};                                                          // file -> true/false (loaded ok?)

  function inRange(from, to, today) {
    return from <= to ? (today >= from && today <= to) : (today >= from || today <= to);   // wraps the new year
  }

  function chooseOutfit() {
    if (forcedOutfit) return outfits.filter(function (o) { return o.id === forcedOutfit && known[o.file] !== false; })[0] || null;
    var d = new Date();
    var year = d.getFullYear(), weekday = d.getDay();
    var today = ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    if (forcedDate) {
      var parts = forcedDate.split('-');
      today = parts.slice(-2).join('-');
      if (parts.length === 3) year = Number(parts[0]);
      weekday = new Date(year, Number(parts[parts.length - 2]) - 1, Number(parts[parts.length - 1])).getDay();
    }
    var root = document.documentElement.dataset;
    var birthday = root.birthday === '1';
    var closed = root.closed === '1';
    var weather = document.documentElement.dataset.weather || '';
    var isDay = document.documentElement.dataset.day !== '0';
    var feels = Number(document.documentElement.dataset.temp);
    var hasTemp = document.documentElement.dataset.temp !== undefined && Number.isFinite(feels);
    return outfits.filter(function (o) {
      if (known[o.file] === false) return false;                          // art not supplied yet
      if (o.year && o.year !== year) return false;                        // a rule for one particular year (Easter moves)
      if (o.weekdays && o.weekdays.indexOf(weekday) === -1) return false;  // 0 = Sunday ... 5 = Friday
      if (o.from && o.to) return inRange(o.from, o.to, today);
      if (o.weekdays && !o.weather && !o.closed && !o.event) return true;  // a plain weekday rule (chef on Fridays)
      if (o.event === 'birthday') return birthday;                         // a birthday or work anniversary is on the display today
      if (o.closed) return closed && !o.weather;                           // the display says Closed (after hours, weekend, holiday)
      if (o.weather || o.minTempC !== undefined || o.maxTempC !== undefined) {
        if (o.weather && o.weather.indexOf(weather) === -1) return false;
        if (o.daytimeOnly && !isDay) return false;
        if (o.minTempC !== undefined && hasTemp && feels < o.minTempC) return false;      // unknown temperature passes a minimum
        if (o.maxTempC !== undefined && (!hasTemp || feels > o.maxTempC)) return false;   // but never a maximum
        return true;
      }
      return false;
    })[0] || null;
  }

  var wantedId = null;      // the outfit we most recently decided on; a slower, older image load must not override it
  function wear(outfit) {
    var id = outfit ? outfit.id : null;
    wantedId = id;
    if (id === wornId) return;
    if (!outfit) { wornId = null; sheetRows = ROWS; el.style.backgroundImage = ''; el.style.backgroundSize = ''; reveal(); return; }
    var url = '/snoopy/' + outfit.file;
    var probe = new Image();
    probe.onload = function () {
      known[outfit.file] = true;
      if (wantedId !== id) return;                     // a newer choice was made while this image was loading
      wornId = id;
      sheetRows = outfit.rows || ROWS;
      el.style.backgroundSize = '800% ' + (sheetRows * 100) + '%';
      el.style.backgroundImage = 'url(' + url + ')';
      draw();
      reveal();
    };
    probe.onerror = function () { known[outfit.file] = false; refreshOutfit(); };   // fall back to the next match
    probe.src = url;
  }

  function refreshOutfit() { if (outfits.length) wear(chooseOutfit()); else reveal(); }

  fetch('/snoopy/outfits.json').then(function (r) { return r.ok ? r.json() : { outfits: [] }; })
    .then(function (data) { outfits = data.outfits || []; refreshOutfit(); })
    .catch(function () { });
  new MutationObserver(refreshOutfit).observe(document.documentElement, { attributes: true, attributeFilter: ['data-weather', 'data-day', 'data-temp', 'data-birthday', 'data-closed'] });
  setInterval(refreshOutfit, 60000);                                       // catches midnight / date changes

  draw();
  step();
  setInterval(tick, 1000);
})();
