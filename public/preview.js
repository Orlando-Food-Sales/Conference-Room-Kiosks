'use strict';
// Preview page: one live display driven by the controls, plus a tour of every combination.
(function () {
  var COLS = 8, ROWS = 11;
  function cells(row, count) { var out = []; for (var c = 0; c < count; c += 1) out.push([row, c]); return out; }
  // Same rows and timings as snoopy.js.
  var ANIMATIONS = [
    { id: '', label: 'Auto (smart)', frames: cells(0, 6), ms: 260 },
    { id: 'idle', label: 'Idle', frames: cells(0, 6), ms: 260 },
    { id: 'runRight', label: 'Run right', frames: cells(1, 8), ms: 110 },
    { id: 'runLeft', label: 'Run left', frames: cells(2, 8), ms: 110 },
    { id: 'waving', label: 'Waving', frames: cells(3, 4), ms: 220 },
    { id: 'jumping', label: 'Jumping', frames: cells(4, 5), ms: 160 },
    { id: 'failed', label: 'Failed', frames: cells(5, 8), ms: 200 },
    { id: 'waiting', label: 'Waiting', frames: cells(6, 6), ms: 260 },
    { id: 'working', label: 'Working', frames: cells(7, 6), ms: 260 },
    { id: 'review', label: 'Review', frames: cells(8, 6), ms: 260 },
    { id: 'look', label: 'Look around', frames: cells(9, 8).concat(cells(10, 8)), ms: 120 }
  ];
  var THEMES = ['dark', 'light'];
  var WEATHERS = ['none', 'clear', 'clouds', 'rain', 'storm', 'snow', 'fog'];
  var STATES = ['free', 'soon', 'busy', 'ended', 'error'];
  var STATE_LABELS = { free: 'free', soon: 'starts in 3 min', busy: 'in use', ended: 'just ended', error: 'calendar error' };

  function $(id) { return document.getElementById(id); }
  var gallery = $('gallery'), frame = $('frame'), box = $('frameBox');
  var selected = '';
  var tourTimer = null, tourIndex = 0;

  // Gallery: each tile plays its animation.
  var tiles = ANIMATIONS.map(function (anim) {
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    var thumb = document.createElement('div');
    thumb.className = 'thumb';
    var label = document.createElement('span');
    label.textContent = anim.label;
    button.appendChild(thumb); button.appendChild(label);
    button.addEventListener('click', function () { selected = anim.id; stopTour(); update(); });
    gallery.appendChild(button);
    var index = 0;
    setInterval(function () {
      index = (index + 1) % anim.frames.length;
      var cell = anim.frames[index];
      thumb.style.backgroundPosition = (cell[1] / (COLS - 1) * 100) + '% ' + (cell[0] / (ROWS - 1) * 100) + '%';
    }, anim.ms);
    return button;
  });

  function url() {
    var q = new URLSearchParams({ theme: $('theme').value, preview: $('state').value, nostream: '1' });
    var weather = $('weather').value;
    if (weather) q.set('weather', weather);
    if (selected) q.set('snoopy', selected);
    if ($('outfit').value) q.set('outfit', $('outfit').value);
    if ($('celebrate').value) q.set('celebrate', $('celebrate').value);
    if ($('quickbook').value) q.set('quickbook', $('quickbook').value);
    if ($('display').value) q.set('display', $('display').value);
    if ($('message').value) q.set('message', $('message').value);
    if ($('hours').value) q.set('hours', $('hours').value);
    return '/room/room?' + q;
  }

  function fit() {
    var size = $('screen').value.split('x').map(Number);
    var availW = box.parentElement.clientWidth - 40;
    var availH = window.innerHeight - 90;
    var scale = Math.min(1, availW / size[0], availH / size[1]);
    frame.style.width = size[0] + 'px';
    frame.style.height = size[1] + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    box.style.width = Math.round(size[0] * scale) + 'px';
    box.style.height = Math.round(size[1] * scale) + 'px';
  }

  function update() {
    tiles.forEach(function (tile, i) { tile.setAttribute('aria-pressed', String(ANIMATIONS[i].id === selected)); });
    var target = url();
    if (frame.getAttribute('src') !== target) frame.setAttribute('src', target);
    $('link').setAttribute('href', target.replace('&nostream=1', ''));
    var anim = ANIMATIONS.filter(function (a) { return a.id === selected; })[0];
    $('caption').textContent = [anim.label, $('theme').value, 'weather: ' + ($('weather').value || 'live'), STATE_LABELS[$('state').value], 'outfit: ' + ($('outfit').value || 'auto'), 'celebrate: ' + ($('celebrate').value === 'none' ? 'hidden' : $('celebrate').value), 'booking buttons: ' + ({ '': 'auto', '1': 'shown', '0': 'hidden' }[$('quickbook').value]), 'hours: ' + ($('hours').value || 'auto'), 'screen: ' + ($('display').value || 'on') + ($('message').value ? ' + message' : '')].join(' · ');
    fit();
  }

  ['theme', 'weather', 'state', 'screen', 'outfit', 'celebrate', 'quickbook', 'hours', 'display', 'message'].forEach(function (id) { $(id).addEventListener('change', function () { stopTour(); update(); }); });
  window.addEventListener('resize', fit);

  // Tour: every animation x theme x weather x state. Animations are the slowest axis
  // so you see each one in all conditions before moving to the next.
  var combos = [];
  ANIMATIONS.slice(1).forEach(function (anim) {
    THEMES.forEach(function (theme) {
      WEATHERS.forEach(function (weather) {
        STATES.forEach(function (state) { combos.push({ anim: anim.id, theme: theme, weather: weather, state: state }); });
      });
    });
  });

  function showCombo(i) {
    tourIndex = (i + combos.length) % combos.length;
    var c = combos[tourIndex];
    selected = c.anim; $('theme').value = c.theme; $('weather').value = c.weather; $('state').value = c.state;
    update();
    $('tourInfo').textContent = 'Combination ' + (tourIndex + 1) + ' of ' + combos.length;
  }
  function stopTour() { clearInterval(tourTimer); tourTimer = null; $('tourPlay').textContent = 'Play'; }
  $('tourPlay').addEventListener('click', function () {
    if (tourTimer) { stopTour(); return; }
    $('tourPlay').textContent = 'Pause';
    showCombo(tourIndex);
    tourTimer = setInterval(function () { showCombo(tourIndex + 1); }, 3500);
  });
  $('tourNext').addEventListener('click', function () { stopTour(); showCombo(tourIndex + 1); });
  $('tourPrev').addEventListener('click', function () { stopTour(); showCombo(tourIndex - 1); });

  // Outfit choices come from snoopy/outfits.json.
  fetch('/snoopy/outfits.json').then(function (r) { return r.json(); }).then(function (data) {
    (data.outfits || []).forEach(function (o) {
      var option = document.createElement('option');
      option.value = o.id; option.textContent = o.label || o.id;
      $('outfit').appendChild(option);
    });
  }).catch(function () {});

  update();
})();
