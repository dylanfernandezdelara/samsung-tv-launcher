(function () {
  'use strict';

  // config.js, then config.local.js on top (any key there replaces the default)
  var cfg = {};
  [window.LAUNCHER_CONFIG, window.LAUNCHER_LOCAL].forEach(function (c) {
    if (c) for (var k in c) cfg[k] = c[k];
  });
  cfg.wallpapers = cfg.wallpapers || {};
  if (!cfg.wallpapers.files) cfg.wallpapers.files = (window.LAUNCHER_WALLPAPERS || []).slice();
  // no images: built-in soft gradients (drawn once on a canvas when first shown)
  if (!cfg.wallpapers.files.length) {
    cfg.wallpapers.files = ['gradient:#e9eef5,#b8c7e0,#f3d9e4', 'gradient:#eef3ea,#bfe3cf,#f6ecc9', 'gradient:#f5ece4,#f0c9b5,#cfd6f2'];
  }
  var ART = window.TILE_ART || {};
  var hasTizen = typeof window.tizen !== 'undefined';
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, CH_UP: 427, CH_DOWN: 428 };
  var REST_MS = 900;      // how long focus sits still before the idle float starts
  // Motion timers go through later() so a capture can slow the whole UI uniformly (the CSS
  // side is slowed through DevTools; see tv-capture.js). timeScale is 1 in normal use.
  var timeScale = 1;
  function later(fn, ms) { return setTimeout(fn, ms * timeScale); }

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), rowEl = $('row');
  var homeEl = $('home'), toastEl = $('toast'), veil = $('veil');

  var selfId = '';
  try { selfId = hasTizen ? tizen.application.getCurrentApplication().appInfo.id : ''; } catch (e) {}

  var state = { apps: [], tiles: [], rowFocus: 0, busy: false };
  var imageWaits = [];   // logo loads in flight; startup waits for them before revealing
  // Coming back from an app restarts the launcher (Samsung relaunches it), so remember when we left.
  var returning = Date.now() - (parseInt(load('leftAt'), 10) || 0) < 3 * 3600 * 1000;

  // ---------- small helpers ----------
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  // One-shot motion through the Web Animations API: runs on the compositor and never forces
  // a style/layout flush the way re-adding a CSS animation class does.
  var SPRING = 'cubic-bezier(0.22, 1.32, 0.42, 1)';
  function animate(node, frames, ms, easing) {
    if (!node || !node.animate) return;
    node.animate(frames, { duration: ms, easing: easing || SPRING });
  }
  // localStorage is synchronous; only write once navigation pauses.
  var saveTimers = {};
  function saveLater(key, val) {
    clearTimeout(saveTimers[key]);
    saveTimers[key] = setTimeout(function () { save(key, val); }, 600);
  }

  // Scale the fixed 1920x1080 stage to fit (the TV is 1920 wide, so this is a no-op there).
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = Math.abs(s - 1) < 0.001 ? '' : 'scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------- sound ----------
  // ---------- clock ----------
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  var DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var clockTimer = null;
  function tick() {
    var d = new Date(), h = d.getHours();
    $('time').textContent = cfg.clock24h ? pad(h) + ':' + pad(d.getMinutes())
      : ((h % 12) || 12) + ':' + pad(d.getMinutes()) + (h < 12 ? ' AM' : ' PM');
    $('date').textContent = DAYS_SHORT[d.getDay()] + ', ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate();
    clearTimeout(clockTimer);
    clockTimer = setTimeout(tick, 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
  }

  // ---------- toast ----------
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2800);
  }

  // ---------- weather ----------
  // Current conditions from Open-Meteo (free, no key). Shown in the clock pill once a location
  // is set in config.weather; refreshed every 30 minutes, skipped while the launcher is hidden.
  var WX_ICONS = {
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    partly: '<path d="M8 3.5v1.5M3.5 8H5M4.8 4.8l1 1M11.2 4.8l-1 1"/><path d="M5.6 10.4A3.4 3.4 0 0 1 11 6.6"/><path d="M8.5 19.5h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 8.5 19.5z"/>',
    cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11.2 1.6A3.2 3.2 0 0 0 7 18.5z"/>',
    fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
    rain: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11.2 1.6A3.2 3.2 0 0 0 7 14.5z"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
    snow: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11.2 1.6A3.2 3.2 0 0 0 7 14.5z"/><path d="M8.5 18.5h.01M12 20h.01M15.5 18.5h.01"/>',
    storm: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11.2 1.6A3.2 3.2 0 0 0 7 14.5z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>'
  };
  function wxKind(code, day) {
    if (code === 0) return day ? 'sun' : 'moon';
    if (code <= 2) return day ? 'partly' : 'cloud';
    if (code === 3) return 'cloud';
    if (code <= 48) return 'fog';
    if (code <= 67 || (code >= 80 && code <= 82)) return 'rain';
    if (code <= 77 || code === 85 || code === 86) return 'snow';
    return 'storm';
  }
  function updateWeather() {
    var w = cfg.weather;
    if (!w || w.latitude == null || document.hidden) return;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + w.latitude + '&longitude=' + w.longitude +
      '&current=temperature_2m,weather_code,is_day&temperature_unit=' + (w.units || 'fahrenheit');
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.timeout = 10000;
    x.onload = function () {
      try {
        var c = JSON.parse(x.responseText).current;
        $('wx').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
          WX_ICONS[wxKind(c.weather_code, c.is_day)] + '</svg><span>' + Math.round(c.temperature_2m) + '°</span>';
      } catch (e) {}
    };
    x.send();
  }

  // ---------- wallpaper + frosted dock ----------
  // Two wallpaper layers crossfade. The dock's frosted glass is a tiny copy of the same
  // wallpaper stretched back up (bilinear scaling reads as a soft blur), made once per
  // wallpaper, so there is no live blur to recompute while you navigate.
  var wpLayers = document.querySelectorAll('#art .wp');
  var frosts = document.querySelectorAll('#dock .frost');
  var dockEl = $('dock');
  var wpIdx = -1, wpFront = 0, wpTimer = null;

  // The frost is drawn at the dock's exact size with its rounded corners baked in, so the
  // crossfade is a plain blend: no rounded overflow clip for the TV to re-mask every frame.
  // A 96px copy of the wallpaper (downscaled off the main thread) is cropped to the dock's
  // area and stretched back up, which reads as a soft blur.
  var frostSrc = [null, null];
  var DOCK_RADIUS = 38;  // keep in sync with .platter in style.css

  // cached per wallpaper as a tiny JPEG, so restarts skip the resize
  function smallCopy(img) {
    var key = 'frost:' + img.src.slice(-80);
    var hit = load(key);
    if (hit) {
      var ci = new Image();
      ci.src = hit;
      return (ci.decode ? ci.decode() : Promise.resolve()).then(function () { return ci; }, function () { return makeSmall(img, key); });
    }
    return makeSmall(img, key);
  }
  function makeSmall(img, key) {
    return resizeSmall(img).then(function (small) {
      try {
        var c = small.getContext ? small : drawSmall(small, small.width, small.height);
        save(key, c.toDataURL('image/jpeg', 0.85));
      } catch (e) {}
      return small;
    });
  }
  function resizeSmall(img) {
    var w = 96, h = Math.round(96 * img.naturalHeight / img.naturalWidth);
    if (window.createImageBitmap) {
      return createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
        .catch(function () { return drawSmall(img, w, h); });
    }
    return Promise.resolve(drawSmall(img, w, h));
  }
  function drawSmall(img, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }

  function drawFrost(i) {
    var src = frostSrc[i], canvas = frosts[i];
    var W = dockEl.offsetWidth, H = dockEl.offsetHeight;
    if (!src || !W || !H) return;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    var ctx = canvas.getContext('2d');
    var k = src.width / 1920;   // wallpaper covers the 1920-wide stage
    var left = dockEl.offsetLeft, top = dockEl.offsetTop + homeEl.offsetTop;
    var oy = (src.height / k - 1080) / 2; // cover: image is centered vertically
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, W, H, DOCK_RADIUS); else ctx.rect(0, 0, W, H);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, left * k, (top + oy) * k, W * k, H * k, 0, 0, W, H);
    ctx.restore();
  }

  function redrawFrost() { drawFrost(0); drawFrost(1); }

  // 'gradient:#a,#b,#c' -> a soft three-blob gradient rendered once to a JPEG data URL
  var gradientCache = {};
  function wallpaperSrc(entry) {
    if (entry.indexOf('gradient:') !== 0) return entry;
    if (gradientCache[entry]) return gradientCache[entry];
    var c = entry.slice(9).split(',');
    var cv = document.createElement('canvas');
    cv.width = 1920; cv.height = 1080;
    var x = cv.getContext('2d');
    x.fillStyle = c[0]; x.fillRect(0, 0, 1920, 1080);
    [[300, 200, c[1]], [1650, 350, c[2]], [900, 1000, c[1]]].forEach(function (b) {
      var g = x.createRadialGradient(b[0], b[1], 0, b[0], b[1], 1100);
      g.addColorStop(0, b[2]); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 1920, 1080);
    });
    return (gradientCache[entry] = cv.toDataURL('image/jpeg', 0.92));
  }

  // instant: no crossfade (used at startup, behind the black veil). Resolves once it's on screen.
  function showWallpaper(i, instant) {
    var files = (cfg.wallpapers && cfg.wallpapers.files) || [];
    if (!files.length) return Promise.resolve();
    wpIdx = (i + files.length) % files.length;
    // The image is fully decoded (off the main thread) before it is shown, and shown as the
    // same decoded <img>, so the crossfade never stalls a frame on a 1920px JPEG decode.
    var img = new Image();
    img.src = wallpaperSrc(files[wpIdx]);
    var ready = img.decode ? img.decode() : new Promise(function (r) { img.onload = r; });
    return ready.then(function () {
      var back = wpFront ^ 1;
      return smallCopy(img).then(function (small) {
        frostSrc[back] = small;
        drawFrost(back);
        wpLayers[back].textContent = '';
        wpLayers[back].appendChild(img);
        if (instant) {
          [wpLayers[back], frosts[back]].forEach(function (n) { n.style.transition = 'none'; n.classList.add('on'); });
          wpLayers[wpFront].classList.remove('on');
          frosts[wpFront].classList.remove('on');
          wpFront = back;
          save('wallpaper', String(wpIdx));
          requestAnimationFrame(function () { wpLayers[back].style.transition = ''; frosts[back].style.transition = ''; });
          return;
        }
        // pre-warm: a few frames at near-zero opacity gets the image uploaded to the GPU
        // before the crossfade starts, instead of on its first frame
        wpLayers[back].classList.add('prep');
        frosts[back].classList.add('prep');
        later(function () {
          wpLayers[back].classList.remove('prep');
          frosts[back].classList.remove('prep');
          wpLayers[back].classList.add('on');
          frosts[back].classList.add('on');
          wpLayers[wpFront].classList.remove('on');
          frosts[wpFront].classList.remove('on');
          wpFront = back;
          save('wallpaper', String(wpIdx));
        }, 250);
      });
    }).catch(function () {});
  }

  // A new wallpaper when the TV starts the launcher fresh; the same one when coming back from an app.
  function startWallpapers() {
    var saved = parseInt(load('wallpaper'), 10);
    var shown = showWallpaper(isNaN(saved) ? 0 : (returning ? saved : saved + 1), true);
    clearInterval(wpTimer);
    var mins = (cfg.wallpapers && cfg.wallpapers.minutes) || 5;
    wpTimer = setInterval(rotateWhenIdle, mins * 60000);
    return shown;
  }

  // The timed change waits for a pause in remote use, so it never lands mid-navigation.
  var lastKey = 0;
  function rotateWhenIdle() {
    if (document.hidden) return;
    if (Date.now() - lastKey < 4000) { setTimeout(rotateWhenIdle, 2000); return; }
    showWallpaper(wpIdx + 1);
  }

  // ---------- apps ----------
  function fetchApps(done) {
    if (!hasTizen) { done(demoApps()); return; }
    tizen.application.getAppsInfo(function (list) {
      var out = [];
      list.forEach(function (a) {
        if (a.show === false || !a.name || a.id === selfId) return;
        out.push({ id: a.id, name: a.name, icon: a.iconPath || '' });
      });
      out.sort(function (a, b) { return a.name.localeCompare(b.name); });
      done(out);
    }, function (e) {
      toast('Could not read apps: ' + e.message);
      done([]);
    });
  }

  function findApp(match) {
    for (var i = 0; i < match.length; i++) {
      var m = String(match[i]).toLowerCase();
      for (var j = 0; j < state.apps.length; j++) {
        var a = state.apps[j];
        if (a.id.toLowerCase() === m || a.name.toLowerCase() === m) return a;
      }
    }
    return null;
  }

  function iconSrc(path) {
    if (!path) return '';
    if (/^(file|https?|data):/.test(path)) return path;
    return path.charAt(0) === '/' ? 'file://' + path : path; // relative = bundled with the launcher
  }

  // ---------- tiles ----------
  function makeTile(opts) {
    var li = el('li', 'tile' + (opts.cls ? ' ' + opts.cls : ''));
    var lift = el('div', 'lift', li);
    el('div', 'shadow', lift);
    var face = el('div', 'face', lift);

    // brand background right away, so a tile without its logo file still reads as that app
    if (opts.fit === 'mark' && opts.bg && opts.bg !== 'auto') face.style.background = opts.bg;
    var fallback = el('div', 'fallback', face);
    fallback.textContent = opts.title;

    if (opts.art && ART[opts.art]) {
      face.insertAdjacentHTML('beforeend', ART[opts.art]);
      fallback.style.display = 'none';
    }
    // Images replace the drawn art only once they load, so a missing file falls back cleanly.
    function show(node) {
      face.insertBefore(node, face.querySelector('.gloss'));
      fallback.style.display = 'none';
      var art = face.querySelector('.art');
      if (art) art.style.display = 'none';
    }
    // A logo already prepared on an earlier start is reused as-is (the launcher restarts every
    // time it comes back from an app, so this keeps returns fast).
    var cacheKey = opts.icon && opts.fit === 'mark' ? markKey(opts) : null;
    var cached = cacheKey && readMark(cacheKey);
    if (cached) {
      if (cached.bg) face.style.background = cached.bg;
      var ci = new Image();
      ci.className = 'mark';
      ci.style.cssText = cached.style;
      imageWaits.push(new Promise(function (r) { ci.onload = ci.onerror = function () { r(); }; }));
      ci.src = cached.src;
      show(ci);
    } else if (opts.icon) {
      var img = new Image();
      var settle;
      imageWaits.push(new Promise(function (r) { settle = r; }));
      img.onerror = function () { settle(); };
      img.onload = function () {
        setTimeout(settle, 0);
        if (opts.fit !== 'mark') { show(img); return; }
        if (opts.bg === 'auto') face.style.background = cornerColor(img) || '';
        else if (opts.bg) face.style.background = opts.bg;
        var source = img;
        if (opts.extract) {
          // the lifted-out logo replaces the icon once it has decoded
          var lifted = liftWhite(img, opts.box, opts.lift, opts.extract === 'key' ? 'key' : 'white');
          if (lifted) source = lifted;
        }
        var place = function () {
          var c = placeMark(face, source, opts.box, opts.optical);
          show(c);
          writeMark(cacheKey, c, opts.bg === 'auto' ? face.style.background : '');
        };
        if (source === img || (source.complete && source.naturalWidth)) place();
        else source.onload = place;
      };
      img.src = iconSrc(opts.icon);
    }

    el('span', 'gloss', face);
    el('span', 'rim', face);
    el('span', 'dim', face);

    return li;
  }

  // ---------- prepared-logo cache (localStorage) ----------
  var MARK_CACHE_VERSION = 'm1';
  function markKey(o) {
    return 'mark:' + MARK_CACHE_VERSION + ':' + [o.icon, o.optical || 1, o.box || '', o.extract || '', o.lift || '', o.bg === 'auto' ? 'auto' : ''].join('|');
  }
  function readMark(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeMark(key, canvas, bg) {
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ src: canvas.toDataURL('image/png'), style: canvas.style.cssText, bg: bg }));
    } catch (e) {}
  }

  // ---------- logo sizing system ----------
  // Every mark gets the same visual weight on its tile:
  //   1. measure the mark: its bounds (ignoring small detached bits like (R) and TM) and its ink
  //      density (how much of those bounds is actually filled);
  //   2. equal area: scale so the bounds cover the same share of the tile (wide wordmarks get
  //      wider and shorter, square marks more compact);
  //   3. density compensation: area scales with 1 / ink density, so every mark carries the
  //      same amount of ink (light scripts grow, dense blocks shrink); exponent 0.42 is a bit
  //      under full compensation so dense marks aren't over-shrunk; clamped to 0.8-1.6x;
  //   4. clamp to a safe zone so the focus zoom never crowds the tile edges.
  // `optical` in config.js stays available as a manual nudge but should rarely be needed.
  var MARK = { area: 0.15, maxW: 0.72, maxH: 0.55, lift: 0.02, refDensity: 0.38, densityExp: 0.42 };

  function markSize(r, density, tileW, tileH) {
    var a = MARK.area * tileW * tileH;
    var w = Math.sqrt(a * r), h = w / r;
    var d = density ? Math.pow(MARK.refDensity / density, MARK.densityExp) : 1;
    d = Math.max(0.8, Math.min(1.6, d));
    w *= d; h *= d;
    var k = Math.min(1, (MARK.maxW * tileW) / w, (MARK.maxH * tileH) / h);
    return { w: w * k, h: h * k };
  }

  // Measures a mark as { box: [x, y, w, h] fractions, density }. Transparent pixels, or pixels
  // close to the corner color, are background. Connected pieces smaller than 3% of the ink
  // (registered/trademark symbols) don't count toward the bounds.
  var measureCache = {};
  function markBox(img) {
    if (measureCache[img.src] === undefined) measureCache[img.src] = measureMark(img);
    return measureCache[img.src];
  }
  function measureMark(img) {
    try {
      var s = Math.min(1, 384 / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var px = ctx.getImageData(0, 0, w, h).data;
      var transparent = px[3] < 16, br = px[0], bg = px[1], bb = px[2];
      var ink = new Float32Array(w * h), on = new Uint8Array(w * h), total = 0;
      for (var i = 0; i < w * h; i++) {
        var q = i * 4;
        var v = transparent ? px[q + 3] / 255
          : Math.min(1, (Math.abs(px[q] - br) + Math.abs(px[q + 1] - bg) + Math.abs(px[q + 2] - bb)) / 180);
        ink[i] = v;
        if (v > 0.16) { on[i] = 1; total++; }
      }
      if (!total) return null;
      // connected components (4-neighbour flood fill); keep the bounds of the big ones
      var seen = new Uint8Array(w * h), stack = [], x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var start = 0; start < w * h; start++) {
        if (!on[start] || seen[start]) continue;
        var cx0 = w, cy0 = h, cx1 = -1, cy1 = -1, count = 0;
        stack.push(start); seen[start] = 1;
        while (stack.length) {
          var p = stack.pop(), x = p % w, y = (p - x) / w;
          count++;
          if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
          if (x > 0 && on[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
          if (x < w - 1 && on[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
          if (y > 0 && on[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
          if (y < h - 1 && on[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
        }
        if (count < total * 0.03) continue;
        if (cx0 < x0) x0 = cx0; if (cx1 > x1) x1 = cx1; if (cy0 < y0) y0 = cy0; if (cy1 > y1) y1 = cy1;
      }
      if (x1 < 0) return null;
      var sum = 0;
      for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) sum += ink[yy * w + xx];
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      return { box: [x0 / w, y0 / h, bw / w, bh / h], density: sum / (bw * bh) };
    } catch (e) { return null; }
  }

  // Returns a canvas holding the mark resampled to exactly the pixels it occupies on screen,
  // so the TV never shrinks a large logo in one cheap step (which makes edges jagged).
  function placeMark(face, img, box, optical) {
    var m = markBox(img);
    var density = m && m.density;
    box = box || (m && m.box) || [0, 0, 1, 1];
    var nw = img.naturalWidth, nh = img.naturalHeight;
    var tileW = face.clientWidth || 242, tileH = face.clientHeight || 146;
    var bw = box[2] * nw, bh = box[3] * nh;
    var size = markSize(bw / bh, density, tileW, tileH);
    var s = (size.w / bw) * (optical || 1);
    var w = Math.max(1, Math.round(nw * s)), h = Math.max(1, Math.round(nh * s));
    var c = resample(img, w, h);
    c.className = 'mark';
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.style.left = Math.round(tileW / 2 - (box[0] * nw + bw / 2) * s) + 'px';
    c.style.top = Math.round(tileH / 2 - (box[1] * nh + bh / 2) * s - MARK.lift * tileH) + 'px';
    return c;
  }

  // Halve repeatedly (each step averages 2x2 pixels well), then one final high-quality draw.
  function resample(img, w, h) {
    var src = img, sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    // The TV draws vectors onto a canvas without anti-aliasing, so vectors are drawn at 4x and
    // then halved twice: each output pixel averages 16 samples (supersampling).
    if (/\.svg(\?|$)/i.test(img.src || '')) {
      var big = document.createElement('canvas');
      big.width = w * 4; big.height = h * 4;
      big.getContext('2d').drawImage(img, 0, 0, big.width, big.height);
      src = big; sw = big.width; sh = big.height;
    }
    while (sw / 2 >= w && sh / 2 >= h) {
      var half = document.createElement('canvas');
      half.width = Math.round(sw / 2); half.height = Math.round(sh / 2);
      var hc = half.getContext('2d');
      hc.imageSmoothingEnabled = true;
      hc.imageSmoothingQuality = 'high';
      hc.drawImage(src, 0, 0, half.width, half.height);
      src = half; sw = half.width; sh = half.height;
    }
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return out;
  }

  // Lift a white logo off its icon background: alpha follows brightness inside the mark's box,
  // so only the logo survives and it can sit on a clean brand gradient like every other tile.
  var liftCache = {};
  function liftWhite(img, box, range, mode) {
    var key = img.src + '|' + box + '|' + range + '|' + mode;
    if (!liftCache[key]) liftCache[key] = liftPixels(img, box, range, mode);
    if (!liftCache[key]) return null;
    var out = new Image();
    out.src = liftCache[key];
    return out;
  }
  // mode 'white': alpha follows brightness, logo becomes pure white.
  // mode 'key':   alpha follows distance from the background (corner) color and the logo keeps
  //               its own colors, e.g. Netflix red lifted off white.
  function liftPixels(img, box, range, mode) {
    try {
      var w = img.naturalWidth, h = img.naturalHeight;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      var d = ctx.getImageData(0, 0, w, h), px = d.data;
      var bx0 = (box ? box[0] - 0.02 : 0) * w, bx1 = (box ? box[0] + box[2] + 0.02 : 1) * w;
      var by0 = (box ? box[1] - 0.02 : 0) * h, by1 = (box ? box[1] + box[3] + 0.02 : 1) * h;
      var key = mode === 'key';
      var LO = range ? range[0] : (key ? 30 : 185), HI = range ? range[1] : (key ? 160 : 240);
      var kr = px[0], kg = px[1], kb = px[2];
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          var a = 0;
          if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) {
            var v = key
              ? Math.abs(px[i] - kr) + Math.abs(px[i + 1] - kg) + Math.abs(px[i + 2] - kb)
              : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            a = Math.max(0, Math.min(1, (v - LO) / (HI - LO)));
          }
          if (key) {
            // un-blend edge pixels from the background so the logo's color stays true
            if (a > 0) {
              px[i] = Math.max(0, Math.min(255, kr + (px[i] - kr) / a));
              px[i + 1] = Math.max(0, Math.min(255, kg + (px[i + 1] - kg) / a));
              px[i + 2] = Math.max(0, Math.min(255, kb + (px[i + 2] - kb) / a));
            }
          } else {
            px[i] = px[i + 1] = px[i + 2] = 255;
          }
          px[i + 3] = Math.round(a * px[i + 3]);
        }
      }
      ctx.putImageData(d, 0, 0);
      return c.toDataURL('image/png');
    } catch (e) { return null; }
  }

  function cornerColor(img) {
    try {
      var c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      var px = ctx.getImageData(0, 0, 1, 1).data;
      return 'rgb(' + px[0] + ',' + px[1] + ',' + px[2] + ')';
    } catch (e) { return ''; }
  }

  function renderHome() {
    rowEl.textContent = '';
    var favorites = (cfg.favorites || []).filter(function (f) {
      return !cfg.hideMissing || f.source || findApp(f.match || [f.title]);
    });
    state.tiles = favorites.map(function (f) {
      var app = f.source ? null : findApp(f.match || [f.title]);
      var t = { title: f.title, source: f.source, app: app, accent: f.accent, accent2: f.accent2, missing: !f.source && !app };
      var image = f.image === 'icon' ? (app && app.icon) : f.image;
      t.el = makeTile({
        title: f.title,
        art: f.art,
        icon: image || '',
        fit: f.fit,
        box: f.box,
        optical: f.optical,
        bg: f.bg,
        extract: f.extract,
        lift: f.lift,
        cls: t.missing ? 'missing' : ''
      });
      rowEl.appendChild(t.el);
      return t;
    });
    var saved = parseInt(load('rowFocus'), 10);
    if (saved >= 0 && saved < state.tiles.length) state.rowFocus = saved;
    if (state.rowFocus >= state.tiles.length) state.rowFocus = 0;
    focusRow(state.rowFocus, 0);
    redrawFrost();
  }

  // ---------- focus ----------
  var restTimer = null;
  function settle(node) {
    clearTimeout(restTimer);
    restTimer = later(function () { node.classList.add('rest'); }, REST_MS);
  }
  // Leaving a tile that was mid idle-float: stopping the CSS animation would snap the tilt back
  // to flat in one frame, so ease from wherever it was back to flat instead.
  function blur(node) {
    var face = node.querySelector('.face');
    if (node.classList.contains('rest') && face) {
      var from = getComputedStyle(face).transform;
      node.classList.remove('focus', 'rest', 'press');
      if (from && from !== 'none') animate(face, [{ transform: from }, { transform: 'perspective(900px) rotateX(0deg) rotateY(0deg)' }], 320, 'cubic-bezier(0.25, 0.8, 0.25, 1)');
      return;
    }
    node.classList.remove('focus', 'rest', 'press');
  }

  function focusRow(i, dir) {
    var prev = state.tiles[state.rowFocus];
    if (prev) blur(prev.el);
    state.rowFocus = i;
    var t = state.tiles[i];
    if (!t) return;
    t.el.classList.add('focus');
    // lean toward the direction of travel, then settle
    if (dir) animate(t.el.querySelector('.face'), [
      { transform: 'perspective(900px) rotateY(' + (dir > 0 ? -6 : 6) + 'deg)' },
      { transform: 'perspective(900px) rotateY(0deg)' }
    ], 520);
    settle(t.el);
    saveLater('rowFocus', String(i));
  }

  // pushing past the end of the row nudges the tile
  var lastBump = 0;
  function bump(node, dir) {
    var now = Date.now();
    if (now - lastBump < 300 * timeScale) return;   // one nudge per push, not one per auto-repeat
    lastBump = now;
    var base = 'scale(1)';   // tiles are drawn at focused size; focus = scale(1)
    animate(node.querySelector('.lift'), [
      { transform: base },
      { transform: 'translateX(' + (dir * 14) + 'px) ' + base, offset: 0.35 },
      { transform: 'translateX(' + (-dir * 5) + 'px) ' + base, offset: 0.7 },
      { transform: base }
    ], 360, 'ease-out');
  }

  // ---------- actions ----------
  // Launch immediately: the press dip plays while the TV starts the app (no fade, no wait), so the
  // app opens as fast as the TV allows. While a launch is in flight every key is ignored, so a
  // double Enter can't launch twice. If the launcher is still showing after a few seconds
  // (launch failed silently), it unlocks.
  var busyTimer = null;
  function press(node, fn) {
    state.busy = true;
    save('rowFocus', String(state.rowFocus));
    node.classList.remove('rest');
    node.classList.add('press');
    // one frame for the dip to start, then hand off to the system
    requestAnimationFrame(function () { setTimeout(fn, 0); });
    clearTimeout(busyTimer);
    busyTimer = setTimeout(function () { if (!document.hidden) reveal(); }, 4000);
  }

  function reveal() {
    state.busy = false;
    clearTimeout(busyTimer);
    state.tiles.forEach(function (t) { t.el.classList.remove('press'); });
    veil.classList.add('open');
  }

  function launchApp(app) {
    if (!hasTizen) { reveal(); toast('Would open ' + app.name); return; }
    tizen.application.launch(app.id, null, function (e) { reveal(); toast('Could not open ' + app.name + ': ' + e.message); });
  }

  // source is "HDMI2" style, or the input's name as set on the TV ("PlayStation 5").
  function findSource(spec, done, fail) {
    var m = /^([A-Za-z_]+?)\s*(\d+)$/.exec(spec);
    tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (v) {
      var all = (v.connected || []).concat(v.disconnected || []);
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        if ((m && s.type === m[1].toUpperCase() && s.number === +m[2]) ||
            (s.editName && s.editName.toLowerCase() === spec.toLowerCase())) return done(s);
      }
      fail({ message: 'not found' });
    }, fail);
  }

  function openSource(spec) {
    if (!hasTizen || !tizen.tvwindow) { reveal(); toast(hasTizen ? 'Input switching is not available' : 'Would switch to ' + spec); return; }
    var fail = function (e) { reveal(); toast('Could not switch to ' + spec + ': ' + (e && e.message)); };
    var hide = function () { try { tizen.application.getCurrentApplication().hide(); } catch (e) { reveal(); } };
    findSource(spec, function (src) {
      tizen.tvwindow.setSource(src, function () {
        // Hand over to the TV's input viewer. Just hiding would put Samsung's home in front,
        // which the launcher replaces, so the input would never show.
        try { tizen.application.launch(cfg.inputViewerId || 'org.tizen.tv-viewer', function () {}, hide); } catch (e) { hide(); }
      }, fail, 'MAIN');
    }, fail);
  }

  // The TV powers on showing its last input for a moment before the launcher can come back.
  // An empty input shows "cable disconnected" and an antenna with no signal shows static, so
  // while the launcher is up, the input behind it is parked on idleSource (e.g. a soundbar's
  // ARC port, which shows plain black). Silent if it isn't set or fails.
  function parkSource() {
    if (!cfg.idleSource || !hasTizen || !tizen.tvwindow || document.hidden) return;
    try {
      var cur = tizen.tvwindow.getSource('MAIN'), m = /^([A-Za-z_]+?)\s*(\d+)$/.exec(cfg.idleSource);
      if (cur && m && cur.type === m[1].toUpperCase() && cur.number === +m[2]) return;
      findSource(cfg.idleSource, function (src) {
        if (!document.hidden) tizen.tvwindow.setSource(src, function () {}, function () {}, 'MAIN');
      }, function () {});
    } catch (e) {}
  }

  function activateRow() {
    var t = state.tiles[state.rowFocus];
    if (!t) return;
    if (t.missing) { bump(t.el, 1); toast(t.title + ' is not installed'); return; }
    press(t.el, function () { if (t.source) openSource(t.source); else launchApp(t.app); });
  }

  // ---------- keys ----------
  // Channel up/down (the remote's CH rocker, or the phone remote) change the wallpaper.
  try { tizen.tvinputdevice.registerKeyBatch(['ChannelUp', 'ChannelDown']); } catch (e) {}
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    lastKey = Date.now();
    if (k === KEY.BACK) e.preventDefault();
    if (state.busy) return;
    var n = state.tiles.length, i = state.rowFocus, cur = state.tiles[i];
    if (k === KEY.LEFT) { if (i > 0) focusRow(i - 1, -1); else if (!e.repeat) bump(cur.el, -1); }
    else if (k === KEY.RIGHT) { if (i < n - 1) focusRow(i + 1, 1); else if (!e.repeat) bump(cur.el, 1); }
    else if (k === KEY.ENTER) activateRow();
    else if (!e.repeat && (k === KEY.CH_UP || k === KEY.CH_DOWN)) showWallpaper(wpIdx + (k === KEY.CH_UP ? 1 : -1));
    if (k === KEY.BACK && hasTizen) {
      var now = Date.now();
      if (now - lastBack < 700) { lastBack = 0; openSamsungHome(); } else lastBack = now;
    }
    // Back is swallowed so the launcher never closes itself.
    if (k === KEY.BACK) e.preventDefault();
  });

  // ---------- lifecycle ----------
  // Fade in from black and let the row rise into place, staggered.
  // Fresh start: tiles rise in, staggered. Back from an app: everything simply fades in together.
  function entrance() {
    if (returning) {
      veil.classList.add('quick');
      reveal();
    } else {
      state.tiles.forEach(function (t) { t.el.classList.add('enter'); });
      void rowEl.offsetWidth;
      reveal();
      state.tiles.forEach(function (t, i) {
        later(function () { t.el.classList.remove('enter'); }, 60 + i * 45);
      });
    }
    if (performance.mark && !performance.getEntriesByName('launcher-ready').length) performance.mark('launcher-ready');
  }

  // Keep the screen black until the wallpaper is decoded and the logos are drawn, then reveal
  // everything at once (never more than ~1 s, so a slow image can't hold the launcher back).
  function boot() {
    var wallpaper = startWallpapers();
    var dock = new Promise(function (r) { refresh(r); }).then(function () { return Promise.all(imageWaits); });
    var timeout = new Promise(function (r) { setTimeout(r, 1000); });
    Promise.race([Promise.all([wallpaper, dock]), timeout]).then(function () {
      requestAnimationFrame(function () { requestAnimationFrame(entrance); });
    });
  }

  // The dock is rebuilt only when what it shows changes (an app in it was installed or removed),
  // never just because the launcher came back to the front.
  var dockKey = '';
  function refresh(done) {
    fetchApps(function (apps) {
      state.apps = apps;
      var key = (cfg.favorites || []).map(function (f) {
        var a = f.source ? null : findApp(f.match || [f.title]);
        return f.source || (a ? a.id : '-');
      }).join(',');
      if (key !== dockKey) {
        dockKey = key;
        renderHome();
      }
      if (done) done();
    });
  }

  // Coming back from an app: the page resumes as it was left (config.xml reload="disable"), with
  // no entrance animation. The focused tile's idle float stops while away and restarts once the
  // TV has finished switching apps, so nothing is moving through those first busy frames.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      save('leftAt', String(Date.now()));
      clearTimeout(restTimer);
      // undo the press dip instantly (no spring) so the launcher comes back already at rest
      state.tiles.forEach(function (t) {
        var lift = t.el.querySelector('.lift');
        lift.style.transition = 'none';
        t.el.classList.remove('rest', 'press');
        void lift.offsetWidth;
        lift.style.transition = '';
      });
      return;
    }
    reveal();
    tick();
    var cur = state.tiles[state.rowFocus];
    if (cur) restTimer = later(function () { cur.el.classList.add('rest'); }, 1500);
    setTimeout(function () { updateWeather(); refresh(); parkSource(); }, 1500);
  });

  // Browser preview only (no tizen object): pretend every app in config.js is installed.
  function demoApps() {
    return ['Netflix', 'Disney+', 'Prime Video', 'YouTube', 'Spotify', 'Instagram']
      .map(function (n) { return { id: 'demo.' + n.replace(/\W+/g, ''), name: n, icon: '' }; });
  }

  // ---------- return to the launcher ----------
  // Samsung keeps Home and Back for itself, so leaving an app lands on Samsung's home. With
  // background support on (config.xml), the launcher keeps checking which app is in front and,
  // when it's Samsung's home, brings itself back. Turn off with returnToLauncher: false.
  var SAMSUNG_HOME = cfg.samsungHomeIds || ['com.samsung.tv.csfs'];
  var returnTimer = null, pauseReturnUntil = 0, lastBack = 0, lastRelaunch = 0, asleepSince = 0, wakeUntil = 0;
  // what the TV shows when it wakes: its input viewer (static / "no signal") or Samsung's home
  var WAKE_SCREENS = cfg.wakeScreenIds || ['org.tizen.tv-viewer'].concat(SAMSUNG_HOME);
  // Escape hatch: Back twice quickly on the launcher opens Samsung's home for 2 minutes.
  function openSamsungHome() {
    pauseReturnUntil = Date.now() + 120000;
    try { tizen.application.launch(SAMSUNG_HOME[0], null, function () { tizen.application.getCurrentApplication().hide(); }); }
    catch (e) { try { tizen.application.getCurrentApplication().hide(); } catch (e2) {} }
  }
  function watchForeground() {
    if (cfg.returnToLauncher === false || !hasTizen || !window.webapis || !webapis.appcommon) return;
    clearInterval(returnTimer);
    // Each check is a ~2 ms call into the TV's app manager, so it runs only as often as needed:
    // every 50 ms for 10 s after an app opens, then every 100 ms while it's open (adds ~25 ms
    // to the brief Samsung-home flash) or the TV is in standby, and every 500 ms while the
    // launcher is on screen.
    var lastCheck = 0, hiddenAt = 0;
    var tickWork = function () {
      var now = Date.now();
      if (!document.hidden) hiddenAt = 0;
      else if (!hiddenAt) hiddenAt = now;
      // (standby polls fast too: the static of the TV's last input shows until this catches it)
      var every = asleepSince ? 100 : !document.hidden ? 500 : now - hiddenAt < 10000 ? 50 : 100;
      if (now - lastCheck < every - 5) return;
      lastCheck = now;
      // an uncaught error here would end the watcher, so nothing escapes
      try { check(); } catch (e) {}
    };
    var check = function () {
      var id;
      // in standby there is no foreground app (the call throws or returns nothing)
      try { id = webapis.appcommon.getForegroundAppId(); } catch (e) { id = null; }
      if (!id) { asleepSince = asleepSince || Date.now(); return; }
      // Power-on: the TV wakes on its last input (static, or "no signal"), and that screen can
      // even appear after the launcher has asked to come forward. So for 10 s after waking the
      // launcher replaces that screen, or Samsung's home, whenever it shows, until a key is
      // pressed. (A no-app blip while switching apps is much shorter than standby.)
      // Off with launcherOnPowerOn: false.
      var now = Date.now();
      if (asleepSince && now - asleepSince > 1500 && cfg.launcherOnPowerOn !== false) wakeUntil = now + 10000;
      asleepSince = 0;
      if (now < wakeUntil && lastKey < wakeUntil - 10000 && WAKE_SCREENS.indexOf(id) >= 0 && now - lastRelaunch > 1000) {
        lastRelaunch = now;
        try { tizen.application.launch(selfId, null, function () {}); } catch (e) {}
        return;
      }
      if (!document.hidden || Date.now() < pauseReturnUntil) return;
      // one relaunch at a time: a relaunch takes ~0.3 s, longer than the check interval
      if (SAMSUNG_HOME.indexOf(id) >= 0 && Date.now() - lastRelaunch > 2000) {
        lastRelaunch = Date.now();
        try { tizen.application.launch(selfId, null, function () {}); } catch (e) {}
      }
    };
    try { new Worker('tick-worker.js').onmessage = tickWork; } catch (e) { returnTimer = setInterval(tickWork, 100); }
  }

  // Hooks for tv-test.js and tv-capture.js (wallpaper changes, slowed capture, focus reset).
  window.__launcher = {
    nextWallpaper: function () { showWallpaper(wpIdx + 1); },
    showWallpaper: function (file) {
      var files = cfg.wallpapers.files, i = files.indexOf(file);
      if (i >= 0) showWallpaper(i);
    },
    // slowing the UI for a capture also pauses the timed wallpaper rotation (it runs on real
    // time, so a long slowed capture would otherwise hit it mid-take)
    setTimeScale: function (k) {
      timeScale = k;
      clearInterval(wpTimer);
      if (k === 1) wpTimer = setInterval(rotateWhenIdle, ((cfg.wallpapers && cfg.wallpapers.minutes) || 5) * 60000);
    },
    // freeze the clock text (e.g. '9:41 AM') for footage continuity; null resumes it
    freezeClock: function (text) {
      clearTimeout(clockTimer);
      if (text) $('time').textContent = text; else tick();
    },
    focus: function (i) { focusRow(i, 0); }
  };

  tick();
  watchForeground();
  updateWeather();
  setInterval(updateWeather, 30 * 60000);
  boot();
  setTimeout(parkSource, 2000);
})();
