'use strict';
(function () {
  var player = null, ready = false, wrapper, character, previous, zs, lastClip = '', lastPhase = '';
  var manifest, forced = new URLSearchParams(location.search).get('sleepPreview');
  var reduced = globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  globalThis.SnoopySleep = {
    ownsPlayback: function () { return Boolean(player && player.snapshot().active); },
    snapshot: function () { return player ? player.snapshot() : { active: false, ready: ready }; }
  };
  function mode(active) {
    wrapper.hidden = !active;
    document.dispatchEvent(new CustomEvent('snoopy-sleep-mode', { detail: { active: active } }));
  }
  function frame(info) {
    if (!info.active) { zs.hidden = true; return; }
    var clip = manifest.clips[info.clip];
    if (!clip) return;
    if (lastClip && (lastClip !== info.clip || lastPhase !== info.phase)) {
      previous.style.backgroundPosition = character.style.backgroundPosition;
      previous.style.opacity = reduced ? '0' : '1';
      previous.getBoundingClientRect(); previous.style.opacity = '0';
    }
    lastClip = info.clip; lastPhase = info.phase;
    var row = clip.row + Math.floor(info.frame / manifest.columns), col = info.frame % manifest.columns;
    character.style.backgroundPosition = col / (manifest.columns - 1) * 100 + '% ' + row / (manifest.rows - 1) * 100 + '%';
    zs.hidden = info.phase !== 'asleep';
    wrapper.dataset.clip = info.clip; wrapper.dataset.phase = info.phase;
    wrapper.setAttribute('aria-label', info.phase === 'asleep' ? 'Snoopy sleeping on his doghouse. Tap to wake him for 15 seconds.' : 'Snoopy waking on his doghouse. Tap to keep him awake.');
  }
  function image(url, width, height) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { if (img.naturalWidth !== width || img.naturalHeight !== height) reject(new Error('Invalid sleep artwork dimensions')); else resolve(img); };
      img.onerror = reject; img.src = url;
    });
  }
  // The self-wake settings are optional: stirEveryMs 0 or 30 s to 1 h, stirAwakeMs 3 to 60 s.
  function validStir(data) {
    var every = data.stirEveryMs, awake = data.stirAwakeMs;
    return (every === undefined || (Number.isInteger(every) && (every === 0 || (every >= 30000 && every <= 3600000)))) && (awake === undefined || (Number.isInteger(awake) && awake >= 3000 && awake <= 60000));
  }
  function valid(data) {
    var names = ['settle_on_roof','lie_down','eyes_close','sleep_breathing','sleep_ear_flick','sleep_paw_twitch','tap_reaction','eyes_open','head_raise','yawn','stretch','sit_up','sleepy_wave','awake_idle','look_around','drowsy_blink','return_to_lying','rest_head_close_eyes','awake_shrug','awake_thinking','awake_glance','sleepy_droop'];
    return data.version === 2 && data.columns === 8 && Number.isInteger(data.cellWidth) && data.cellWidth >= 192 && data.cellWidth <= 576 && data.cellHeight * 192 === data.cellWidth * 208 && data.rows === 23 && validStir(data) && data.wakeMs === 15000 && names.every(function (id) { var c = data.clips && data.clips[id]; return c && Number.isInteger(c.row) && c.row >= 0 && Number.isInteger(c.count) && c.count > 0 && c.count <= 16 && c.row + Math.floor((c.count - 1) / 8) < data.rows && c.ms >= 40 && c.ms <= 1000; });
  }
  fetch('/snoopy/sleep-manifest.json').then(function (r) { if (!r.ok) throw new Error('Sleep artwork unavailable'); return r.json(); }).then(function (data) {
    if (!valid(data)) throw new Error('Invalid sleep animation manifest');
    manifest = data;
    // The cell size comes from the manifest, so a sharper sheet (for example 288x312 or 384x416 cells) drops in with no code change.
    return Promise.all([image(data.atlas, data.cellWidth * 8, data.cellHeight * data.rows), image(data.house, data.cellWidth, data.cellHeight), image(data.zs, data.cellWidth * 8, data.cellHeight)]);
  }).then(function (art) {
    wrapper = document.createElement('div'); wrapper.className = 'snoopy snoopy-sleep'; wrapper.hidden = true;
    wrapper.setAttribute('role','button'); wrapper.tabIndex = 0;
    art[1].className = 'snoopy-sleep-house'; art[1].alt = ''; art[1].setAttribute('aria-hidden','true'); wrapper.appendChild(art[1]);
    previous = document.createElement('div'); previous.className = 'snoopy-sleep-character snoopy-sleep-previous';
    character = document.createElement('div'); character.className = 'snoopy-sleep-character';
    [previous, character].forEach(function (layer) { layer.style.backgroundImage = 'url(' + manifest.atlas + ')'; layer.style.backgroundSize = '800% ' + manifest.rows * 100 + '%'; layer.setAttribute('aria-hidden','true'); wrapper.appendChild(layer); });
    zs = document.createElement('div'); zs.className = 'snoopy-sleep-zs'; zs.style.backgroundImage = 'url(' + manifest.zs + ')'; zs.hidden = true; wrapper.appendChild(zs);
    (document.getElementById('availability') || document.body).appendChild(wrapper);
    player = SnoopySleepEngine.create({ manifest: manifest, reducedMotion: reduced, onMode: mode, onFrame: frame }); ready = true;
    function closed() { return forced === 'closed' || (forced !== 'open' && document.documentElement.dataset.closed === '1'); }
    player.setClosed(closed(), true);
    new MutationObserver(function () { player.setClosed(closed(), false); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-closed'] });
    document.addEventListener('pointerdown', function () { player.tap(); }, true);   // wakes him; the tap still reaches whatever was tapped (Codex's later version)
    wrapper.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); player.tap(); } });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) player.setClosed(closed(), false); });
  }).catch(function () { ready = false; /* Normal Snoopy remains usable when sleep assets are missing. */ });
})();
