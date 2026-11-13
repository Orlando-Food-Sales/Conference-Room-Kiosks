'use strict';
// Snoopy: plays every row of public/snoopy/snoopy.png (8 columns x 11 rows, 192x208 cells).
// A base mood follows the room state from app.js; random flourishes (look around, wave,
// jump, walk) keep him lively; tapping the screen makes him look that way.
// Debug: add ?snoopy=<animation> to the URL to hold one animation (e.g. ?snoopy=runRight).
// Sleeping: while the display says Closed, snoopy-sleep.js (with snoopy-sleep-engine.js and the art in snoopy/sleep*.png)
// owns the picture: Snoopy sleeps on his doghouse and a tap wakes him for 15 seconds. This file steps aside meanwhile.
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

  // The calm mood for the room's meetings at a moment, and which meeting is on (so a change can be greeted):
  //   in a meeting: thinking ('working'); in its last 5 minutes (meetings over 10 minutes): 'waiting', time to wrap up
  //   free: 'waiting' when a meeting starts within 5 minutes, 'review' for 3 minutes after one ended, else 'idle'
  function meetingMood(events, now) {
    var on = null, soon = false, justEnded = false;
    (events || []).forEach(function (e) {
      var from = new Date(e.start).getTime(), to = new Date(e.end).getTime();
      if (from <= now && to > now && (!on || from > new Date(on.start).getTime())) on = e;   // the latest-starting one if two overlap
      if (from > now && from - now <= 5 * 60000) soon = true;
      if (to <= now && now - to <= 3 * 60000) justEnded = true;
    });
    if (on) {
      var start = new Date(on.start).getTime(), end = new Date(on.end).getTime();
      return { mood: end - start > 10 * 60000 && end - now <= 5 * 60000 ? 'waiting' : 'working', meeting: (on.id || '') + '|' + on.start };
    }
    return { mood: soon ? 'waiting' : (justEnded ? 'review' : 'idle'), meeting: '' };
  }

  // Calm mood that follows the room.
  function baseMood() {
    var s = globalThis.state;
    var sync = document.getElementById('syncState');
    if (sync && /unavailable|not responding/i.test(sync.textContent)) return 'failed';
    if (!s || !s.room) return 'idle';
    return meetingMood(s.events, Date.now()).mood;
  }

  // A meeting starting gets a two-handed hello, a meeting ending (with nothing straight after) a goodbye wave.
  // Not on the first look after the page loads, and not right after a booking from this tablet (that gets a jump).
  var lastMeeting = null, skipGreetingUntil = 0;
  function greet(now) {
    var s = globalThis.state;
    if (!s || !s.room) return false;
    var meeting = meetingMood(s.events, now).meeting;
    var before = lastMeeting;
    lastMeeting = meeting;
    if (before === null || before === meeting || reduceMotion) return false;
    if (meeting && now < skipGreetingUntil) return false;
    nextFlourishAt = now + 15000;
    setX(x, 0);
    start('waving', { repeat: meeting ? 2 : 1, then: function () { start(baseMood()); } });
    return true;
  }
  // Booked from this tablet (app.js sends "room-booked"): a happy double jump.
  document.addEventListener('room-booked', function () {
    skipGreetingUntil = Date.now() + 90000;
    if (forced || reduceMotion || sleepOwns()) return;
    nextFlourishAt = Date.now() + 15000;
    setX(x, 0);
    start('jumping', { repeat: 2, then: function () { start(baseMood()); } });
  });

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

  // While the sleeping Snoopy is on screen this one is hidden and still; when the office reopens he carries on.
  function sleepOwns() { return Boolean(globalThis.SnoopySleep && globalThis.SnoopySleep.ownsPlayback()); }
  document.addEventListener('snoopy-sleep-mode', function (event) {
    if (event.detail && event.detail.active) { clearTimeout(timer); plan = null; setX(0, 0); el.style.display = 'none'; }
    else { el.style.display = ''; if (!forced) start(baseMood()); }
  });

  function tick() {
    if (forced || sleepOwns()) return;
    var now = Date.now();
    if (greet(now)) return;                        // a meeting started or ended
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
    if (forced || reduceMotion || sleepOwns() || event.target === el) return;
    nextFlourishAt = Date.now() + 15000;
    lookAt(event.clientX, event.clientY);
  });

  // ---- Outfits: festive dates first, then weather (see snoopy/outfits.json) ----
  var outfits = [];
  var forcedOutfit = new URLSearchParams(location.search).get('outfit');   // id, or "none"
  var forcedDate = (function () { var v = new URLSearchParams(location.search).get('date'); return /^(\d{4}-)?\d\d-\d\d$/.test(v || '') ? v : ''; })();   // preview: ?date=12-25 or ?date=2027-03-25 pretends that is today
  var wornId = null;
  var known = {};                                                          // file -> true/false (loaded ok?)

  // Easter moves every year, so it is worked out instead of listed: Easter Sunday of the Gregorian calendar
  // (the Meeus/Jones/Butcher method, correct for every year from 1583). Months are 1 to 12.
  function easterSunday(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return { month: month, day: day };
  }
  // A rule like { "before": 7, "after": 0 }: from 7 days before Easter Sunday through Easter Sunday itself.
  // Whole days are counted from UTC dates, so daylight saving cannot move a day.
  function easterRuleMatches(rule, year, month, day) {
    var easter = easterSunday(year);
    var offset = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, easter.month - 1, easter.day)) / 86400000);
    return offset >= -(rule.before || 0) && offset <= (rule.after || 0);
  }
  // Holidays fixed to a weekday, worked out for any year. { "month": 1, "weekday": 1, "nth": 3 } is the third
  // Monday in January (MLK Day); "nth": -1 is the last one in the month (Memorial Day). Months 1 to 12, weekday 0 = Sunday.
  function nthWeekdayMatches(rule, year, month, day) {
    if (month !== rule.month) return false;
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== rule.weekday) return false;
    if (rule.nth === -1) return day + 7 > new Date(Date.UTC(year, month, 0)).getUTCDate();   // no same weekday left in the month
    return Math.ceil(day / 7) === rule.nth;
  }

  function inRange(from, to, today) {
    return from <= to ? (today >= from && today <= to) : (today >= from || today <= to);   // wraps the new year
  }
  // A day k days from the given one (k may be negative), as [year, month, day]. UTC, so daylight saving cannot move it.
  function shiftDay(year, month, day, k) {
    var t = new Date(Date.UTC(year, month - 1, day + k));
    return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  }
  // True when isHoliday(y, m, d) is true for a day from `after` days ago to `before` days ahead: that is, today is
  // within `before` days before the holiday or `after` days after it. (Mother's Day with "before": 2 also shows on Friday.)
  function aroundMatches(isHoliday, before, after, year, month, day) {
    for (var k = -(after || 0); k <= (before || 0); k += 1) {
      var s = shiftDay(year, month, day, k);
      if (isHoliday(s[0], s[1], s[2])) return true;
    }
    return false;
  }
  // The Hebrew calendar date of a Gregorian day, worked out by the browser (the Hebrew calendar is exact arithmetic,
  // so this never needs a yearly list). null if the browser cannot do it: the rule then simply does not apply.
  var hebrewFormat = null;
  function hebrewDate(year, month, day) {
    try {
      if (!hebrewFormat) hebrewFormat = new Intl.DateTimeFormat('en-US-u-ca-hebrew', { timeZone: 'UTC', month: 'long', day: 'numeric' });
      var parts = {};
      hebrewFormat.formatToParts(new Date(Date.UTC(year, month - 1, day, 12))).forEach(function (p) { parts[p.type] = p.value; });
      return { month: parts.month, day: Number(parts.day) };
    } catch (_) { return null; }
  }
  // Whether a date rule applies on a day: true or false, or null when the outfit has no date rule.
  //   from/to (MM-DD), easter, nthWeekday (+ before/after), dates (a list of YYYY-MM-DD, + before/after: holidays that follow
  //   a lunar calendar), hebrew (a Hebrew calendar date + days: Hanukkah is 25 Kislev for 8 days).
  // Whether a weather rule applies: true or false, or null when the outfit has no weather or temperature rule.
  // feels is the feels-like temperature in Celsius, or null when it is not known: an unknown temperature passes a
  // minimum but never a maximum (so "cold" never shows on a guess).
  function weatherRuleMatches(o, weather, isDay, feels) {
    if (!o.weather && o.minTempC === undefined && o.maxTempC === undefined) return null;
    if (o.weather && o.weather.indexOf(weather) === -1) return false;
    if (o.daytimeOnly && !isDay) return false;
    if (o.minTempC !== undefined && feels !== null && feels < o.minTempC) return false;
    if (o.maxTempC !== undefined && (feels === null || feels > o.maxTempC)) return false;
    return true;
  }
  function dateRuleMatches(o, year, month, day) {
    var mmdd = ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
    if (o.from && o.to) return inRange(o.from, o.to, mmdd);
    if (o.easter) return easterRuleMatches(o.easter, year, month, day);
    if (o.nthWeekday) return aroundMatches(function (y, m, d) { return nthWeekdayMatches(o.nthWeekday, y, m, d); }, o.nthWeekday.before, o.nthWeekday.after, year, month, day);
    if (o.dates) return aroundMatches(function (y, m, d) { return o.dates.on.indexOf(y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2)) !== -1; }, o.dates.before, o.dates.after, year, month, day);
    if (o.hebrew) return aroundMatches(function (y, m, d) { var h = hebrewDate(y, m, d); return !!h && h.month === o.hebrew.month && h.day === o.hebrew.day; }, 0, (o.hebrew.days || 1) - 1, year, month, day);
    return null;
  }

  function chooseOutfit() {
    if (forcedOutfit) return outfits.filter(function (o) { return o.id === forcedOutfit && known[o.file] !== false; })[0] || null;
    // Pushed from the dashboard (app.js sets these): wins over dates and weather until it runs out. "none" is plain Snoopy.
    var pushed = document.documentElement.getAttribute('data-outfit-override');
    var pushedUntil = Number(document.documentElement.getAttribute('data-outfit-until'));
    if (pushed && pushedUntil > Date.now()) {
      if (pushed === 'none') return null;
      var pick = outfits.filter(function (o) { return o.id === pushed && known[o.file] !== false; })[0];
      if (pick) return pick;                                               // art missing on this tablet: fall through to automatic
    }
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
    var anniversary = root.anniversary === '1';
    var closed = root.closed === '1';
    var weather = document.documentElement.dataset.weather || '';
    var isDay = document.documentElement.dataset.day !== '0';
    var feels = Number(document.documentElement.dataset.temp);
    var hasTemp = document.documentElement.dataset.temp !== undefined && Number.isFinite(feels);
    return outfits.filter(function (o) {
      if (known[o.file] === false) return false;                          // art not supplied yet
      if (o.year && o.year !== year) return false;                        // a rule for one particular year (Easter moves)
      if (o.weekdays && o.weekdays.indexOf(weekday) === -1) return false;  // 0 = Sunday ... 5 = Friday
      var dated = dateRuleMatches(o, year, Number(today.slice(0, 2)), Number(today.slice(3, 5)));   // festive dates, worked out for this year
      if (dated !== null) return dated;
      if (o.weekdays && !o.weather && !o.closed && !o.event) return true;  // a plain weekday rule (chef on Fridays)
      // A birthday and/or a work anniversary is on the display today (app.js sets data-birthday and data-anniversary).
      if (o.event) return o.event === 'birthday+anniversary' ? (birthday && anniversary) : (o.event === 'birthday' ? birthday : (o.event === 'anniversary' && anniversary));
      if (o.closed) return closed && !o.weather;                           // the display says Closed (after hours, weekend, holiday)
      var weathered = weatherRuleMatches(o, weather, isDay, hasTemp ? feels : null);
      if (weathered !== null) return weathered;
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
  new MutationObserver(refreshOutfit).observe(document.documentElement, { attributes: true, attributeFilter: ['data-weather', 'data-day', 'data-temp', 'data-birthday', 'data-anniversary', 'data-closed', 'data-outfit-override', 'data-outfit-until'] });
  setInterval(refreshOutfit, 60000);                                       // catches midnight / date changes

  draw();
  step();
  setInterval(tick, 1000);
})();
