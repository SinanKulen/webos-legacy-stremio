/*
 * LiteStream v1.1 - lightweight Stremio-addon client for old LG webOS (3.x, Chromium 38).
 * Plain ES5 only (no arrow functions, let/const, template strings, fetch, Array#find...).
 * Metadata: TMDB in Turkish (fallback: Stremio addons / Cinemeta).
 * Streams/subtitles: the user's Stremio addons (AIOStreams, OpenSubtitles...).
 */
(function () {
  'use strict';

  var VERSION = '1.2.0';
  var API = 'https://api.strem.io/api/';
  var TMDB_API = 'https://api.themoviedb.org/3';
  var TMDB_IMG = 'https://image.tmdb.org/t/p/';
  // Optional build-time defaults from config.js (not committed). Users can also enter keys in Settings.
  var CONFIG = window.LITESTREAM_CONFIG || {};
  var TMDB_DEFAULT_KEY = CONFIG.tmdbApiKey || '';
  var OMDB_DEFAULT_KEY = CONFIG.omdbApiKey || '';
  var LANG = 'tr-TR';
  var TR_FLAG = '🇹🇷';

  var KEYS = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, BACKSPACE: 8, ESC: 27,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, CH_UP: 33, CH_DOWN: 34
  };
  var MAX_ROW_ITEMS = 200;

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined && text !== null) { e.textContent = text; }
    return e;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (h > 0 && m < 10 ? '0' : '') + m;
    return (h > 0 ? h + ':' : '') + mm + ':' + (s < 10 ? '0' : '') + s;
  }

  function fmtRuntime(min) {
    if (!min) { return ''; }
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' sa ' : '') + (m ? m + ' dk' : '');
  }

  function each(arr, fn) { for (var i = 0; i < arr.length; i++) { fn(arr[i], i); } }

  function findFirst(arr, fn) {
    for (var i = 0; i < arr.length; i++) { if (fn(arr[i], i)) { return arr[i]; } }
    return null;
  }

  function closest(node, cls) {
    while (node && node !== document.body) {
      if (typeof node.className === 'string' && (' ' + node.className + ' ').indexOf(' ' + cls + ' ') >= 0) { return node; }
      node = node.parentNode;
    }
    return null;
  }

  var logLines = [];
  function log() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      try { parts.push(typeof a === 'string' ? a : JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
    }
    var d = new Date();
    logLines.push(d.toTimeString().substr(0, 8) + ' ' + parts.join(' ').replace(/api_key=[0-9a-f]+/g, 'api_key=***'));
    if (logLines.length > 80) { logLines.shift(); }
    var dbg = $('debug');
    if (dbg && dbg.className.indexOf('show') >= 0) { dbg.textContent = logLines.slice(-40).join('\n'); }
  }
  window.onerror = function (msg, src, line) { log('JS ERROR:', msg, (src || '').split('/').pop() + ':' + line); };

  var store = {
    get: function (k, def) {
      try { var v = window.localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { log('storage error', String(e)); }
    },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) {} }
  };

  var loaderCount = 0;
  function loading(on) {
    loaderCount = Math.max(0, loaderCount + (on ? 1 : -1));
    $('loader').className = 'loader' + (loaderCount > 0 ? ' show' : '');
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, ms || 3500);
  }

  /* XHR helpers (no fetch on Chromium 38) */
  function request(opts, cb) {
    var xhr = new XMLHttpRequest();
    var done = false;
    xhr.open(opts.method || 'GET', opts.url, true);
    xhr.timeout = opts.timeout || 20000;
    if (opts.responseType) { xhr.responseType = opts.responseType; }
    if (opts.body) { xhr.setRequestHeader('Content-Type', 'application/json'); }
    xhr.onload = function () {
      if (done) { return; } done = true;
      if (xhr.status >= 200 && xhr.status < 300) { cb(null, xhr); }
      else { cb(new Error('HTTP ' + xhr.status), xhr); }
    };
    xhr.onerror = function () { if (done) { return; } done = true; cb(new Error('Ağ hatası'), xhr); };
    xhr.ontimeout = function () { if (done) { return; } done = true; cb(new Error('Zaman aşımı'), xhr); };
    xhr.send(opts.body ? JSON.stringify(opts.body) : null);
    return xhr;
  }

  function getJSON(url, cb) {
    request({ url: url }, function (err, xhr) {
      if (err) { log('GET fail', url.substr(0, 140), err.message); return cb(err); }
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { return cb(new Error('JSON hatası')); }
      cb(null, data);
    });
  }

  function api(method, body, cb) {
    request({ method: 'POST', url: API + method, body: body }, function (err, xhr) {
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (data && data.error) { return cb(new Error(data.error.message || 'API hatası')); }
      if (err) { return cb(err); }
      if (!data) { return cb(new Error('Boş yanıt')); }
      cb(null, data.result);
    });
  }

  /* ------------------------------------------------------------------ */
  /* TMDB                                                                */
  /* ------------------------------------------------------------------ */

  var tmdbCache = {}, tmdbCacheKeys = [];

  function tmdbKey() { return store.get('tmdbKey', '') || TMDB_DEFAULT_KEY; }
  function hasTmdb() { return !!tmdbKey(); }

  function tmdb(path, query, cb, lang) {
    var url = TMDB_API + path + '?api_key=' + tmdbKey() + '&language=' + (lang || LANG) + (query || '');
    if (tmdbCache[url]) { var c = tmdbCache[url]; setTimeout(function () { cb(null, c); }, 0); return; }
    getJSON(url, function (err, data) {
      if (!err && data) {
        tmdbCache[url] = data;
        tmdbCacheKeys.push(url);
        if (tmdbCacheKeys.length > 120) { delete tmdbCache[tmdbCacheKeys.shift()]; }
      }
      cb(err, data);
    });
  }

  function tmdbImg(path, size) { return path ? TMDB_IMG + (size || 'w185') + path : ''; }

  function tmdbToItem(r, type) {
    var t = type || (r.media_type === 'tv' ? 'series' : 'movie');
    return {
      id: 'tmdb:' + r.id, tmdbId: r.id, type: t,
      name: r.title || r.name || r.original_title || r.original_name,
      poster: tmdbImg(r.poster_path, 'w185'),
      rating: r.vote_average
    };
  }

  var MOVIE_GENRES = [[28, 'Aksiyon'], [35, 'Komedi'], [18, 'Dram'], [53, 'Gerilim'], [27, 'Korku'], [878, 'Bilim Kurgu'],
    [10749, 'Romantik'], [80, 'Suç'], [12, 'Macera'], [16, 'Animasyon'], [10751, 'Aile'], [14, 'Fantastik'],
    [9648, 'Gizem'], [36, 'Tarih'], [10752, 'Savaş'], [99, 'Belgesel'], [10402, 'Müzik'], [37, 'Vahşi Batı']];
  var TV_GENRES = [[18, 'Dram'], [35, 'Komedi'], [80, 'Suç'], [10759, 'Aksiyon & Macera'], [10765, 'Bilim Kurgu & Fantastik'],
    [9648, 'Gizem'], [10751, 'Aile'], [16, 'Animasyon'], [99, 'Belgesel'], [10764, 'Reality'], [10762, 'Çocuk'],
    [10768, 'Savaş & Politik'], [37, 'Western']];

  /* Row definition backed by a paged TMDB list */
  function tmdbRow(title, path, query, type) {
    return {
      title: title,
      fetch: function (page, cb) {
        tmdb(path, (query || '') + '&page=' + page, function (err, data) {
          if (err || !data || !data.results) { return cb(err || new Error('boş')); }
          var items = [];
          each(data.results, function (r) {
            if (!r.poster_path) { return; }
            if (r.media_type && r.media_type !== 'movie' && r.media_type !== 'tv') { return; }
            items.push(tmdbToItem(r, type));
          });
          cb(null, items, data.page < data.total_pages && page < 40, data.total_results);
        });
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Focus / spatial navigation                                          */
  /* ------------------------------------------------------------------ */

  var focused = null;

  function activeScreenEl() { return document.querySelector('.screen.active'); }

  function visibleFocusables() {
    var root = activeScreenEl();
    if (!root) { return []; }
    var all = root.querySelectorAll('.focusable');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null) { out.push(all[i]); }
    }
    return out;
  }

  function setFocus(node, noScroll) {
    if (!node) { return; }
    // Clear any stale focus ring (also ones left on screens we navigated away from).
    each(document.querySelectorAll('.focused'), function (n) { if (n !== node) { n.className = n.className.replace(/\s*\bfocused\b/g, ''); } });
    focused = node;
    if (!/\bfocused\b/.test(node.className)) { node.className += ' focused'; }
    if (!noScroll) { ensureVisible(node); }
    if (current && current.onFocus) { current.onFocus(node); }
  }

  function ensureVisible(node) {
    var p = node.parentNode;
    while (p && p !== document.body) {
      var cls = p.className || '';
      if (typeof cls === 'string' && (cls.indexOf('scroll-x') >= 0 || cls.indexOf('scroll-y') >= 0)) {
        var er = node.getBoundingClientRect();
        var pr = p.getBoundingClientRect();
        if (cls.indexOf('scroll-x') >= 0) {
          if (er.right > pr.right - 40) { p.scrollLeft += er.right - pr.right + 80; }
          else if (er.left < pr.left + 40) { p.scrollLeft -= pr.left - er.left + 80; }
        }
        if (cls.indexOf('scroll-y') >= 0) {
          if (er.bottom > pr.bottom - 30) { p.scrollTop += er.bottom - pr.bottom + 60; }
          else if (er.top < pr.top + 30) { p.scrollTop -= pr.top - er.top + 90; }
        }
      }
      p = p.parentNode;
    }
  }

  function moveFocus(dir) {
    var list = visibleFocusables();
    if (!list.length) { return; }
    if (!focused || list.indexOf(focused) < 0) { setFocus(list[0]); return; }

    // Inside a poster row, left/right just step through the row (fast, no geometry).
    if ((dir === 'left' || dir === 'right') && /\bcard\b/.test(focused.className)) {
      var sib = dir === 'left' ? focused.previousSibling : focused.nextSibling;
      if (sib) { setFocus(sib); }
      return;
    }

    var c = focused.getBoundingClientRect();
    var cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n === focused) { continue; }
      var r = n.getBoundingClientRect();
      if (r.right < -1500 || r.left > 3400) { continue; } // far off-screen cards
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var main, cross;
      if (dir === 'left') { if (r.right > c.left + 2 && x >= cx) { continue; } main = cx - x; cross = Math.abs(y - cy); }
      else if (dir === 'right') { if (r.left < c.right - 2 && x <= cx) { continue; } main = x - cx; cross = Math.abs(y - cy); }
      else if (dir === 'up') { if (r.bottom > c.top + 2 && y >= cy) { continue; } main = cy - y; cross = Math.abs(x - cx); }
      else { if (r.top < c.bottom - 2 && y <= cy) { continue; } main = y - cy; cross = Math.abs(x - cx); }
      if (main <= 0) { continue; }
      if ((dir === 'left' || dir === 'right') && cross > Math.max(c.height, r.height) * 0.6) { continue; }
      // Prefer on-screen targets when moving vertically between rows.
      var offscreen = (r.left < 0 || r.right > 1920) ? 2000 : 0;
      var score = main + cross * 3 + offscreen;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    // Entering the top nav bar from below lands on the current tab.
    if (best && dir === 'up' && /\bnav-item\b/.test(best.className) && !/\bnav-item\b/.test(focused.className)) {
      best = best.parentNode.querySelector('.nav-item.current') || best;
    }
    if (best) { setFocus(best); }
  }

  function makeFocusable(node, action) {
    node.className += ' focusable';
    node._action = action;
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* Screens and history                                                 */
  /* ------------------------------------------------------------------ */

  var screens = {};
  var current = null;
  var history = [];
  var TOP_LEVEL = { home: 1, movies: 1, series: 1, mylist: 1, search: 1, settings: 1 };

  function show(name, params, replace) {
    if (current) {
      current.lastFocus = focused;
      if (current.leave) { current.leave(); }
      if (!replace) { history.push({ name: current.name, params: current.params }); }
    }
    openScreen(name, params, false);
  }

  function openScreen(name, params, restoring) {
    var s = screens[name];
    each(document.querySelectorAll('.screen'), function (n) { n.className = 'screen'; });
    $('screen-' + name).className = 'screen active';
    current = s;
    s.name = name;
    s.params = params;
    focused = null;
    if (restoring && s.restore) { s.restore(params); } else { s.enter(params || {}); }
  }

  function goBack() {
    if (!history.length) { return false; }
    if (current && current.leave) { current.leave(); }
    var h = history.pop();
    var s = screens[h.name];
    var keep = s.lastFocus;
    openScreen(h.name, h.params, true);
    if (keep && document.body.contains(keep) && keep.offsetParent !== null) { setFocus(keep); }
    else if (!focused) { focusFirst(); }
    return true;
  }

  /* Switch between top-level tabs without growing the history. */
  function switchTab(name) {
    if (current && current.name === name) { return; }
    history = [];
    if (current) { current.lastFocus = focused; if (current.leave) { current.leave(); } }
    var s = screens[name];
    var keep = s.lastFocus;
    var restoring = !!s.built;
    openScreen(name, {}, restoring);
    if (restoring) {
      if (keep && document.body.contains(keep) && keep.offsetParent !== null) { setFocus(keep); }
      else { focusFirst(); }
    }
  }

  function focusFirst() {
    var list = visibleFocusables();
    if (list.length) { setFocus(list[0]); }
  }

  /* Top navigation bar, injected into every top-level screen */
  var NAV = [['home', 'Ana Sayfa'], ['movies', 'Filmler'], ['series', 'Diziler'], ['mylist', 'Listem'], ['search', 'Ara'], ['settings', 'Ayarlar']];
  function buildNavBars() {
    each(document.querySelectorAll('.topbar[data-nav]'), function (bar) {
      var active = bar.getAttribute('data-nav');
      bar.innerHTML = '';
      bar.appendChild(el('div', 'brand', 'LiteStream'));
      each(NAV, function (n) {
        var b = makeFocusable(el('div', 'btn small ghost nav-item' + (n[0] === active ? ' current' : ''), n[1]), function () { switchTab(n[0]); });
        b.setAttribute('data-tab', n[0]);
        bar.appendChild(b);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Stremio account + addons                                            */
  /* ------------------------------------------------------------------ */

  var auth = store.get('auth', null); // { authKey, email }
  var addons = [];

  function addonBase(a) { return a.transportUrl.replace(/\/manifest\.json(\?.*)?$/, ''); }

  function supports(addon, resource, type, id) {
    var m = addon.manifest || {};
    var res = m.resources || [];
    for (var i = 0; i < res.length; i++) {
      var r = res[i];
      var name = typeof r === 'string' ? r : r.name;
      if (name !== resource) { continue; }
      var types = (typeof r === 'object' && r.types) ? r.types : m.types;
      var prefixes = (typeof r === 'object' && r.idPrefixes) ? r.idPrefixes : m.idPrefixes;
      if (types && type && types.indexOf(type) < 0) { continue; }
      if (prefixes && prefixes.length && id) {
        var ok = false;
        for (var j = 0; j < prefixes.length; j++) { if (id.indexOf(prefixes[j]) === 0) { ok = true; break; } }
        if (!ok) { continue; }
      }
      return true;
    }
    return false;
  }

  function isCinemeta(a) { return /cinemeta/i.test(a.transportUrl) || (a.manifest && a.manifest.id === 'com.linvo.cinemeta'); }

  function loadAddons(cb) {
    loading(true);
    api('addonCollectionGet', { type: 'AddonCollectionGet', authKey: auth.authKey, update: true }, function (err, res) {
      loading(false);
      if (err) { return cb(err); }
      addons = ((res && res.addons) || []).filter(function (a) { return a && a.transportUrl && a.manifest; });
      log('addons:', addons.map(function (a) { return a.manifest.name; }).join(', '));
      cb(null);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Watch progress (local)                                              */
  /* ------------------------------------------------------------------ */

  function allProgress() { return store.get('progress', {}); }
  function getProgress(videoId) { return allProgress()[videoId] || null; }

  function saveProgress(videoId, t, d, info) {
    if (!videoId || !d || d < 60) { return; }
    var p = allProgress();
    p[videoId] = { t: Math.floor(t), d: Math.floor(d), ts: Date.now(), info: info || null };
    dataVersion++;
    var keys = Object.keys(p);
    if (keys.length > 300) {
      keys.sort(function (a, b) { return p[a].ts - p[b].ts; });
      for (var i = 0; i < keys.length - 300; i++) { delete p[keys[i]]; }
    }
    store.set('progress', p);
  }

  function isWatched(pr) { return pr && pr.t > pr.d * 0.93; }

  /* Bumped whenever the watchlist or progress changes so cached tabs can refresh. */
  var dataVersion = 1;

  /* ------------------------------------------------------------------ */
  /* Watchlist ("Listem") - stored locally on the TV                     */
  /* ------------------------------------------------------------------ */

  function listKey(meta) { return meta.type + ':' + (meta.tmdbId ? 'tmdb:' + meta.tmdbId : meta.id); }
  function getList() { return store.get('watchlist', []); }

  function inList(meta) {
    var k = listKey(meta);
    return !!findFirst(getList(), function (x) { return x.key === k; });
  }

  function toggleList(meta) {
    var k = listKey(meta);
    var list = getList();
    var existing = findFirst(list, function (x) { return x.key === k; });
    if (existing) {
      list = list.filter(function (x) { return x.key !== k; });
    } else {
      list.unshift({
        key: k, id: meta.tmdbId ? 'tmdb:' + meta.tmdbId : meta.id, tmdbId: meta.tmdbId || null, type: meta.type,
        name: meta.name, poster: meta.posterSmall || meta.poster, rating: meta.rating || 0, ts: Date.now()
      });
    }
    store.set('watchlist', list.slice(0, 300));
    dataVersion++;
    return !existing;
  }

  function listRow(title, type) {
    return {
      title: title,
      fetch: function (page, cb) {
        var items = getList().filter(function (x) { return !type || x.type === type; });
        setTimeout(function () { cb(null, items, false); }, 0);
      }
    };
  }

  /* "İzlemeye devam et": from local progress, newest first, one card per title */
  function continueRow() {
    return {
      title: 'İzlemeye Devam Et',
      fetch: function (page, cb) {
        var p = allProgress(), seen = {}, rows = [];
        var keys = Object.keys(p).sort(function (a, b) { return p[b].ts - p[a].ts; });
        each(keys, function (k) {
          var pr = p[k], info = pr.info;
          if (!info || !info.name || !info.metaId) { return; }
          var key = info.type + ':' + info.metaId;
          if (seen[key]) { return; }
          seen[key] = 1;
          if (isWatched(pr) || pr.t < 60) { return; }
          rows.push({
            id: info.tmdbId ? 'tmdb:' + info.tmdbId : info.metaId, tmdbId: info.tmdbId || null, type: info.type,
            name: info.name, poster: info.poster, progress: pr.t / pr.d,
            sub: (info.label ? info.label + ' · ' : '') + fmtTime(pr.d - pr.t) + ' kaldı'
          });
        });
        setTimeout(function () { cb(null, rows.slice(0, 30), false); }, 0);
      }
    };
  }

  function resumePoint(videoId) {
    var p = getProgress(videoId);
    if (!p || p.t < 60 || isWatched(p)) { return 0; }
    return p.t;
  }

  /* ------------------------------------------------------------------ */
  /* Poster rows with lazy loading + infinite paging                     */
  /* ------------------------------------------------------------------ */

  function makeCard(item) {
    var isPerson = item.kind === 'person';
    var card = el('div', 'card' + (isPerson ? ' person' : '') + (item.sub ? ' has-sub' : ''));
    var img = el('img');
    img.setAttribute('data-src', item.poster || '');
    img.alt = '';
    card.appendChild(img);
    card.appendChild(el('div', 'card-name', item.name || ''));
    if (item.sub) { card.appendChild(el('div', 'card-sub', item.sub)); }
    if (item.rating) { card.appendChild(el('div', 'card-rating', '★ ' + Number(item.rating).toFixed(1))); }
    if (isPerson) {
      makeFocusable(card, function () { show('person', { id: item.personId, name: item.name }); });
      return card;
    }
    if (item.progress) {
      var bar = el('div', 'card-progress');
      bar.style.width = Math.min(100, Math.round(item.progress * 100)) + '%';
      card.appendChild(bar);
    }
    makeFocusable(card, function () { show('detail', { type: item.type, id: item.id, tmdbId: item.tmdbId, name: item.name, poster: item.poster }); });
    return card;
  }

  function buildRows(container, defs, onFirstCard) {
    container.innerHTML = '';
    container.scrollTop = 0;
    container._onFirstCard = onFirstCard || null;
    each(defs, function (def) {
      if (!def) { return; }
      var row = el('div', 'row');
      var title = el('div', 'row-title', def.title);
      row.appendChild(title);
      var track = el('div', 'row-track scroll-x');
      var items = el('div', 'row-items');
      track.appendChild(items);
      row.appendChild(track);
      row._items = items; row._def = def; row._title = title;
      row._page = 0; row._count = 0; row._done = false; row._loading = false; row._seen = {};
      container.appendChild(row);
    });
    rowsTick(container);
  }

  function rowsTick(container) {
    if (!container || container.offsetParent === null) { return; }
    var cr = container.getBoundingClientRect();
    each(container.querySelectorAll('.row'), function (row) {
      if (row._page === 0 && !row._loading && !row._done) {
        var r = row.getBoundingClientRect();
        if (r.top < cr.bottom + 500) { loadMore(row, container); }
      }
    });
    loadNearbyImages(container);
  }

  function loadMore(row, container) {
    if (row._loading || row._done) { return; }
    row._loading = true;
    var page = row._page + 1;
    row._def.fetch(page, function (err, items, hasMore, total) {
      row._loading = false;
      if (err || !items) {
        row._done = true;
        if (!row._count && row.parentNode) { row.parentNode.removeChild(row); tryFirstFocus(container); }
        return;
      }
      row._page = page;
      each(items, function (it) {
        if (!it || !it.id || row._seen[it.id] || row._count >= MAX_ROW_ITEMS) { return; }
        row._seen[it.id] = 1;
        row._items.appendChild(makeCard(it));
        row._count++;
      });
      if (total && !row._countEl) { row._countEl = el('span', 'count', total > 999 ? '1000+' : String(total)); row._title.appendChild(row._countEl); }
      if (!hasMore || !items.length || row._count >= MAX_ROW_ITEMS) { row._done = true; }
      if (!row._count && row._done) { if (row.parentNode) { row.parentNode.removeChild(row); } tryFirstFocus(container); return; }
      tryFirstFocus(container);
      rowsTick(container);
    }, row._count);
  }

  /* Initial focus goes to the first poster of the top-most row, once that row has loaded. */
  function tryFirstFocus(container) {
    if (!container._onFirstCard) { return; }
    var first = container.querySelector('.row');
    if (!first || !first._count) { return; }
    var f = container._onFirstCard;
    container._onFirstCard = null;
    f(first._items.firstChild);
  }

  /* Called on focus inside a rows screen: page in more items near the end of a row. */
  function rowsOnFocus(container, node) {
    if (/\bcard\b/.test(node.className)) {
      var row = closest(node, 'row');
      if (row && !row._done) {
        var idx = Array.prototype.indexOf.call(row._items.childNodes, node);
        if (idx >= row._count - 8) { loadMore(row, container); }
      }
    }
    rowsTick(container);
  }

  /* Load posters near the viewport, release the ones far away (keeps RAM low). */
  function loadNearbyImages(container) {
    if (!container || container.offsetParent === null) { return; }
    var cr = container.getBoundingClientRect();
    var imgs = container.querySelectorAll('.card img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var r = img.getBoundingClientRect();
      var near = r.top < cr.bottom + 450 && r.bottom > cr.top - 450 && r.left < 1920 + 900 && r.right > -900;
      var pending = img.getAttribute('data-src');
      if (near && pending) {
        img.removeAttribute('data-src');
        img.src = pending;
      } else if (!near && !pending && img.src) {
        var far = r.top > cr.bottom + 1600 || r.bottom < cr.top - 1600 || r.left > 1920 + 3000 || r.right < -3000;
        if (far) { img.setAttribute('data-src', img.src); img.removeAttribute('src'); }
      }
    }
  }

  function unloadImages(container) {
    if (!container) { return; }
    each(container.querySelectorAll('.card img'), function (img) {
      if (img.src && !img.getAttribute('data-src')) { img.setAttribute('data-src', img.src); img.removeAttribute('src'); }
    });
  }

  /* Rows screen factory (home / movies / series) */
  function rowsScreen(containerId, defsFn, dynamic) {
    return {
      enter: function () {
        var s = this;
        s.built = true;
        s.version = dataVersion;
        var c = $(containerId);
        var navBtn = activeScreenEl().querySelector('.nav-item.current');
        setFocus(navBtn);
        buildRows(c, defsFn(), function (firstCard) {
          if (current === s && (!focused || focused === navBtn)) { setFocus(firstCard); }
        });
      },
      restore: function () {
        // Lists that depend on local data (Listem / Devam et) are rebuilt when that data changed.
        if (dynamic && this.version !== dataVersion) { this.lastFocus = null; this.enter(); return; }
        rowsTick($(containerId));
      },
      leave: function () { unloadImages($(containerId)); },
      onFocus: function (node) { rowsOnFocus($(containerId), node); }
    };
  }

  /* Addon catalog row (for non-TMDB catalogs or as fallback) */
  function addonCatalogRow(a, cat, title) {
    var supportsSkip = false;
    each(cat.extra || [], function (ex) { if (ex.name === 'skip') { supportsSkip = true; } });
    if (cat.extraSupported && cat.extraSupported.indexOf('skip') >= 0) { supportsSkip = true; }
    return {
      title: title,
      fetch: function (page, cb, count) {
        var url = addonBase(a) + '/catalog/' + encodeURIComponent(cat.type) + '/' + encodeURIComponent(cat.id) +
          (supportsSkip && count ? '/skip=' + count : '') + '.json';
        getJSON(url, function (err, data) {
          if (err || !data || !data.metas) { return cb(err || new Error('boş')); }
          var items = data.metas.map(function (m) { return { id: m.id, type: m.type || cat.type, name: m.name, poster: m.poster, rating: m.imdbRating }; });
          cb(null, items, supportsSkip && data.metas.length > 0);
        });
      }
    };
  }

  function catalogRequired(cat) {
    var required = !!(cat.extraRequired && cat.extraRequired.length);
    each(cat.extra || [], function (ex) { if (ex.isRequired) { required = true; } });
    return required;
  }

  function libraryRow() {
    return {
      title: 'Stremio Kütüphanem',
      fetch: function (page, cb) {
        api('datastoreGet', { authKey: auth.authKey, collection: 'libraryItem', ids: [], all: true }, function (err, res) {
          if (err || !res) { return cb(err || new Error('boş')); }
          var items = res.filter(function (it) { return it && !it.removed && !it.temp && (it.type === 'movie' || it.type === 'series'); });
          items.sort(function (a, b) {
            var ta = new Date((a.state && a.state.lastWatched) || a._mtime || 0).getTime();
            var tb = new Date((b.state && b.state.lastWatched) || b._mtime || 0).getTime();
            return tb - ta;
          });
          cb(null, items.map(function (it) {
            var st = it.state || {};
            return { id: it._id, type: it.type, name: it.name, poster: it.poster, progress: st.duration ? (st.timeOffset / st.duration) : 0 };
          }), false);
        });
      }
    };
  }

  function extraAddonRows(type) {
    // Catalogs from the user's addons (except Cinemeta, which TMDB replaces).
    var rows = [];
    each(addons, function (a) {
      if (hasTmdb() && isCinemeta(a)) { return; }
      each((a.manifest && a.manifest.catalogs) || [], function (cat) {
        if (catalogRequired(cat) || (type && cat.type !== type)) { return; }
        if (cat.type !== 'movie' && cat.type !== 'series') { return; }
        if (rows.length >= 8) { return; }
        rows.push(addonCatalogRow(a, cat, (cat.name || cat.id) + ' · ' + (a.manifest.name || '')));
      });
    });
    return rows;
  }

  function cinemetaFallbackRows(type) {
    var rows = [];
    each(addons, function (a) {
      if (!isCinemeta(a)) { return; }
      each(a.manifest.catalogs || [], function (cat) {
        if (catalogRequired(cat) || (type && cat.type !== type)) { return; }
        rows.push(addonCatalogRow(a, cat, (cat.name || cat.id) + (cat.type === 'movie' ? ' · Film' : ' · Dizi')));
      });
    });
    return rows;
  }

  screens.home = rowsScreen('home-rows', function () {
    var defs = [continueRow(), listRow('Listem', null), libraryRow()];
    if (hasTmdb()) {
      defs.push(tmdbRow('Bu Hafta Trend Filmler', '/trending/movie/week', '', 'movie'));
      defs.push(tmdbRow('Bu Hafta Trend Diziler', '/trending/tv/week', '', 'series'));
      defs.push(tmdbRow('Popüler Türk Dizileri', '/discover/tv', '&with_original_language=tr&sort_by=popularity.desc', 'series'));
      defs.push(tmdbRow('Vizyondaki Filmler', '/movie/now_playing', '&region=TR', 'movie'));
      defs.push(tmdbRow('Popüler Türk Filmleri', '/discover/movie', '&with_original_language=tr&sort_by=popularity.desc', 'movie'));
    } else {
      defs = defs.concat(cinemetaFallbackRows(null));
    }
    return defs.concat(extraAddonRows(null));
  }, true);

  screens.mylist = rowsScreen('mylist-rows', function () {
    var c = $('mylist-rows');
    setTimeout(function () {
      if (current === screens.mylist && !c.querySelector('.row')) {
        c.appendChild(el('div', 'empty', 'Listen boş. Bir filmin veya dizinin sayfasında "+ Listem" ile ekleyebilirsin.'));
      }
    }, 300);
    return [continueRow(), listRow('Listem · Filmler', 'movie'), listRow('Listem · Diziler', 'series')];
  }, true);

  screens.movies = rowsScreen('movies-rows', function () {
    if (!hasTmdb()) { return cinemetaFallbackRows('movie').concat(extraAddonRows('movie')); }
    var defs = [
      tmdbRow('Popüler', '/movie/popular', '', 'movie'),
      tmdbRow('Bu Hafta Trend', '/trending/movie/week', '', 'movie'),
      tmdbRow('Vizyonda', '/movie/now_playing', '&region=TR', 'movie'),
      tmdbRow('En Yüksek Puanlı', '/movie/top_rated', '', 'movie'),
      tmdbRow('Türk Filmleri', '/discover/movie', '&with_original_language=tr&sort_by=popularity.desc', 'movie'),
      tmdbRow('Yeni Çıkanlar', '/discover/movie', '&sort_by=primary_release_date.desc&vote_count.gte=100', 'movie')
    ];
    each(MOVIE_GENRES, function (g) {
      defs.push(tmdbRow(g[1], '/discover/movie', '&with_genres=' + g[0] + '&sort_by=popularity.desc&vote_count.gte=50', 'movie'));
    });
    return defs.concat(extraAddonRows('movie'));
  });

  screens.series = rowsScreen('series-rows', function () {
    if (!hasTmdb()) { return cinemetaFallbackRows('series').concat(extraAddonRows('series')); }
    var defs = [
      tmdbRow('Popüler', '/tv/popular', '', 'series'),
      tmdbRow('Bu Hafta Trend', '/trending/tv/week', '', 'series'),
      tmdbRow('Türk Dizileri', '/discover/tv', '&with_original_language=tr&sort_by=popularity.desc', 'series'),
      tmdbRow('Yayında Olanlar', '/tv/on_the_air', '', 'series'),
      tmdbRow('En Yüksek Puanlı', '/tv/top_rated', '', 'series')
    ];
    each(TV_GENRES, function (g) {
      defs.push(tmdbRow(g[1], '/discover/tv', '&with_genres=' + g[0] + '&sort_by=popularity.desc&vote_count.gte=30', 'series'));
    });
    return defs.concat(extraAddonRows('series'));
  });

  /* ------------------------------------------------------------------ */
  /* Login                                                               */
  /* ------------------------------------------------------------------ */

  screens.login = {
    enter: function () {
      $('login-btn')._action = doLogin;
      $('login-email').value = (auth && auth.email) || store.get('lastEmail', '') || '';
      $('login-msg').textContent = '';
      setFocus($('login-email'));
    }
  };

  function doLogin() {
    var email = $('login-email').value.trim();
    var pass = $('login-pass').value;
    if (!email || !pass) { $('login-msg').textContent = 'E-posta ve şifre gerekli.'; return; }
    $('login-msg').textContent = '';
    loading(true);
    api('login', { type: 'Login', email: email, password: pass, facebook: false }, function (err, res) {
      loading(false);
      if (err || !res || !res.authKey) {
        $('login-msg').textContent = 'Giriş başarısız: ' + (err ? err.message : 'bilinmeyen hata');
        return;
      }
      auth = { authKey: res.authKey, email: email };
      store.set('auth', auth);
      store.set('lastEmail', email);
      $('login-pass').value = '';
      startApp();
    });
  }

  function resetTabs() {
    each(['home', 'movies', 'series', 'mylist', 'search', 'settings'], function (n) { screens[n].built = false; screens[n].lastFocus = null; });
  }

  function startApp() {
    loadAddons(function (err) {
      if (err) {
        log('addon load error', err.message);
        if (/auth|session|login/i.test(err.message)) { auth = null; store.del('auth'); show('login', {}, true); return; }
        toast('Eklentiler alınamadı: ' + err.message);
      }
      history = [];
      current = null;
      resetTabs();
      switchTab('home');
    });
  }

  function logout() {
    auth = null; store.del('auth'); history = []; current = null; resetTabs();
    show('login', {}, true);
  }

  /* ------------------------------------------------------------------ */
  /* Search                                                              */
  /* ------------------------------------------------------------------ */

  screens.search = {
    enter: function () {
      this.built = true;
      $('search-btn')._action = doSearch;
      $('search-input')._submit = doSearch;
      setFocus($('search-input'));
    },
    restore: function () { rowsTick($('search-rows')); },
    leave: function () { unloadImages($('search-rows')); },
    onFocus: function (node) { rowsOnFocus($('search-rows'), node); }
  };

  function doSearch() {
    var q = $('search-input').value.trim();
    if (!q) { return; }
    $('search-input').blur();
    var defs = [];
    var enc = encodeURIComponent(q);
    if (hasTmdb()) {
      defs.push(tmdbRow('Filmler', '/search/movie', '&include_adult=false&query=' + enc, 'movie'));
      defs.push(tmdbRow('Diziler', '/search/tv', '&include_adult=false&query=' + enc, 'series'));
    }
    each(addons, function (a) {
      if (hasTmdb() && isCinemeta(a)) { return; }
      each((a.manifest && a.manifest.catalogs) || [], function (cat) {
        var hasSearch = false;
        each(cat.extra || [], function (ex) { if (ex.name === 'search') { hasSearch = true; } });
        if (cat.extraSupported && cat.extraSupported.indexOf('search') >= 0) { hasSearch = true; }
        if (!hasSearch) { return; }
        defs.push({
          title: (cat.type === 'movie' ? 'Filmler' : (cat.type === 'series' ? 'Diziler' : cat.type)) + ' · ' + (a.manifest.name || ''),
          fetch: function (page, cb) {
            getJSON(addonBase(a) + '/catalog/' + encodeURIComponent(cat.type) + '/' + encodeURIComponent(cat.id) + '/search=' + enc + '.json', function (err, data) {
              if (err || !data || !data.metas) { return cb(err || new Error('boş')); }
              cb(null, data.metas.map(function (m) { return { id: m.id, type: m.type || cat.type, name: m.name, poster: m.poster }; }), false);
            });
          }
        });
      });
    });
    var rows = $('search-rows');
    if (!defs.length) { rows.innerHTML = ''; rows.appendChild(el('div', 'empty', 'Arama kaynağı yok.')); return; }
    buildRows(rows, defs, function (first) { if (current === screens.search) { setFocus(first); } });
    setTimeout(function () {
      if (current === screens.search && !rows.querySelector('.card') && !rows.querySelector('.row')) {
        rows.appendChild(el('div', 'empty', 'Sonuç bulunamadı.'));
      }
    }, 8000);
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  screens.settings = {
    enter: function () {
      this.built = true;
      $('set-tmdb').value = store.get('tmdbKey', '');
      $('set-account').textContent = auth ? ('Giriş yapılan hesap: ' + auth.email + ' · ' + addons.length + ' eklenti') : '';
      $('set-info').textContent = 'LiteStream ' + VERSION + ' · ' + navigator.userAgent;
      $('set-save')._action = function () {
        var v = $('set-tmdb').value.trim();
        if (v) { store.set('tmdbKey', v); } else { store.del('tmdbKey'); }
        tmdbCache = {}; tmdbCacheKeys = [];
        toast('Kaydedildi. Listeler yenileniyor…');
        resetTabs();
        screens.settings.built = true;
      };
      $('set-reload')._action = function () {
        loadAddons(function (err) {
          toast(err ? 'Hata: ' + err.message : 'Eklentiler yenilendi (' + addons.length + ')');
          resetTabs(); screens.settings.built = true;
        });
      };
      $('set-omdb').value = store.get('omdbKey', '');
      $('set-omdb-save')._action = function () {
        var v = $('set-omdb').value.trim();
        if (v) { store.set('omdbKey', v); } else { store.del('omdbKey'); }
        omdbCache = {};
        toast('OMDb anahtarı kaydedildi.');
      };
      $('set-logout')._action = logout;
      setFocus($('set-tmdb'));
    },
    restore: function () {}
  };

  /* ------------------------------------------------------------------ */
  /* Metadata: TMDB first, addon (Cinemeta) fallback                     */
  /* ------------------------------------------------------------------ */

  function resolveTmdbId(p, cb) {
    if (!hasTmdb()) { return cb(null); }
    if (p.tmdbId) { return cb(p.tmdbId); }
    if (p.id && p.id.indexOf('tmdb:') === 0) { return cb(parseInt(p.id.substr(5), 10)); }
    if (p.id && p.id.indexOf('tt') === 0) {
      tmdb('/find/' + p.id.split(':')[0], '&external_source=imdb_id', function (err, data) {
        if (err || !data) { return cb(null); }
        var list = p.type === 'series' ? data.tv_results : data.movie_results;
        cb(list && list.length ? list[0].id : null);
      });
      return;
    }
    cb(null);
  }

  function loadMeta(p, cb) {
    resolveTmdbId(p, function (tid) {
      if (tid) {
        loadTmdbMeta(p.type, tid, p, function (meta) { if (meta) { cb(meta); } else { loadAddonMeta(p, cb); } });
      } else {
        loadAddonMeta(p, cb);
      }
    });
  }

  function pickLogo(images) {
    var logos = (images && images.logos) || [];
    var best = findFirst(logos, function (l) { return l.iso_639_1 === 'tr'; }) ||
      findFirst(logos, function (l) { return l.iso_639_1 === 'en'; }) ||
      findFirst(logos, function (l) { return !l.iso_639_1; });
    return best ? tmdbImg(best.file_path, 'w500') : '';
  }

  function loadTmdbMeta(type, tid, p, cb) {
    var isTv = type === 'series';
    tmdb((isTv ? '/tv/' : '/movie/') + tid, '&append_to_response=credits,external_ids,images,recommendations&include_image_language=tr,en,null', function (err, d) {
      if (err || !d || !d.id) { return cb(null); }
      var imdb = d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || '';
      if (!imdb && p.id && p.id.indexOf('tt') === 0) { imdb = p.id.split(':')[0]; }
      var idBase = imdb || ('tmdb:' + tid);
      var year = (d.release_date || d.first_air_date || '').substr(0, 4);
      var endYear = isTv && d.status === 'Ended' && d.last_air_date ? d.last_air_date.substr(0, 4) : '';
      var credits = d.credits || {};
      var crew = credits.crew || [];
      function crewNames(jobs) {
        var out = [];
        each(crew, function (c) { if (jobs.indexOf(c.job) >= 0 && out.indexOf(c.name) < 0) { out.push(c.name); } });
        return out.slice(0, 3);
      }
      var crewLines = [];
      var dirs = crewNames(['Director']);
      var creators = (d.created_by || []).map(function (c) { return c.name; });
      var writers = crewNames(['Screenplay', 'Writer', 'Novel']);
      var music = crewNames(['Original Music Composer', 'Music']);
      var dop = crewNames(['Director of Photography']);
      if (creators.length) { crewLines.push('Yaratıcı: ' + creators.join(', ')); }
      if (dirs.length) { crewLines.push('Yönetmen: ' + dirs.join(', ')); }
      if (writers.length) { crewLines.push('Senaryo: ' + writers.join(', ')); }
      if (music.length) { crewLines.push('Müzik: ' + music.join(', ')); }
      if (dop.length) { crewLines.push('Görüntü: ' + dop.join(', ')); }

      var meta = {
        source: 'tmdb', tmdbId: tid, type: isTv ? 'series' : 'movie', id: idBase, imdbId: imdb,
        name: d.title || d.name, originalName: d.original_title || d.original_name,
        description: d.overview || '', tagline: d.tagline || '',
        poster: tmdbImg(d.poster_path, 'w342'), posterSmall: tmdbImg(d.poster_path, 'w185'),
        background: tmdbImg(d.backdrop_path, 'w1280'), logo: pickLogo(d.images),
        releaseInfo: year + (isTv ? (endYear && endYear !== year ? '–' + endYear : (d.status === 'Ended' ? '' : '–')) : ''),
        runtime: fmtRuntime(isTv ? (d.episode_run_time && d.episode_run_time[0]) : d.runtime),
        rating: d.vote_average, voteCount: d.vote_count,
        genres: (d.genres || []).map(function (g) { return g.name; }),
        crewLine: crewLines.join('   ·   '),
        cast: (credits.cast || []).slice(0, 20).map(function (c) {
          return { kind: 'person', id: 'person:' + c.id, personId: c.id, name: c.name, sub: c.character || '', poster: tmdbImg(c.profile_path, 'w185') };
        }),
        recommendations: ((d.recommendations && d.recommendations.results) || []).filter(function (r) { return r.poster_path; })
          .map(function (r) { return tmdbToItem(r, isTv ? 'series' : (r.media_type === 'tv' ? 'series' : 'movie')); }),
        extra: isTv && d.number_of_seasons ? d.number_of_seasons + ' sezon' : ''
      };
      if (isTv) {
        meta.seasons = [];
        meta.episodeCounts = {};
        each(d.seasons || [], function (s) {
          if (!s.episode_count) { return; }
          meta.seasons.push(s.season_number);
          meta.episodeCounts[s.season_number] = s.episode_count;
        });
        meta.loadSeason = function (n, done) {
          tmdb('/tv/' + tid + '/season/' + n, '', function (err2, sd) {
            if (err2 || !sd || !sd.episodes) { return done([]); }
            done(sd.episodes.map(function (e) {
              return {
                id: idBase + ':' + n + ':' + e.episode_number, season: n, episode: e.episode_number,
                title: e.name, overview: e.overview, released: e.air_date, runtime: e.runtime, rating: e.vote_average
              };
            }));
          });
        };
      }
      if (!meta.description) {
        tmdb((isTv ? '/tv/' : '/movie/') + tid, '', function (e3, en) {
          if (!e3 && en && en.overview) { meta.description = en.overview; }
          cb(meta);
        }, 'en-US');
        return;
      }
      cb(meta);
    });
  }

  function loadAddonMeta(p, cb) {
    var base = { id: p.id, type: p.type, name: p.name, poster: p.poster, source: 'addon' };
    var a = findFirst(addons, function (x) { return supports(x, 'meta', p.type, p.id); });
    if (!a) { return cb(finishAddonMeta(base)); }
    getJSON(addonBase(a) + '/meta/' + encodeURIComponent(p.type) + '/' + encodeURIComponent(p.id) + '.json', function (err, data) {
      var m = (data && data.meta) || base;
      if (!m.type) { m.type = p.type; }
      cb(finishAddonMeta(m));
    });
  }

  function finishAddonMeta(m) {
    var meta = {
      source: 'addon', type: m.type, id: m.id, imdbId: m.imdb_id || (m.id && m.id.indexOf('tt') === 0 ? m.id : ''),
      name: m.name, description: m.description || '',
      poster: m.poster, posterSmall: m.poster, background: m.background, logo: m.logo || '', releaseInfo: m.releaseInfo || m.year || '',
      runtime: m.runtime || '', rating: 0, imdbRatingFallback: m.imdbRating ? parseFloat(m.imdbRating) : 0,
      genres: m.genres || m.genre || [], crewLine: (m.director && m.director.length ? 'Yönetmen: ' + [].concat(m.director).join(', ') : ''),
      cast: (m.cast || []).slice(0, 10).map(function (n) { return { kind: 'person-text', name: n }; }), recommendations: [], tagline: ''
    };
    var videos = (m.videos || []).filter(function (v) { return v && v.id; });
    if (m.type === 'series' && videos.length) {
      meta.seasons = []; meta.episodeCounts = {};
      each(videos, function (v) {
        var s = (v.season === undefined || v.season === null) ? 1 : v.season;
        if (meta.seasons.indexOf(s) < 0) { meta.seasons.push(s); }
        meta.episodeCounts[s] = (meta.episodeCounts[s] || 0) + 1;
      });
      meta.loadSeason = function (n, done) {
        var list = videos.filter(function (v) { return ((v.season === undefined || v.season === null) ? 1 : v.season) === n; })
          .map(function (v) { return { id: v.id, season: n, episode: v.episode || v.number, title: v.title || v.name, overview: v.overview || v.description, released: v.released }; });
        list.sort(function (a, b) { return (a.episode || 0) - (b.episode || 0); });
        setTimeout(function () { done(list); }, 0);
      };
    }
    return meta;
  }

  /* ------------------------------------------------------------------ */
  /* OMDb: IMDb, Rotten Tomatoes, Metacritic ratings                     */
  /* ------------------------------------------------------------------ */

  var omdbCache = {};
  function omdbKey() { return store.get('omdbKey', '') || OMDB_DEFAULT_KEY; }

  function loadOmdb(imdbId, cb) {
    if (!imdbId || imdbId.indexOf('tt') !== 0 || !omdbKey()) { return cb(null); }
    if (omdbCache[imdbId]) { return cb(omdbCache[imdbId]); }
    getJSON('https://www.omdbapi.com/?apikey=' + omdbKey() + '&i=' + imdbId, function (err, d) {
      if (err || !d || d.Response === 'False') { log('omdb fail', err ? err.message : (d && d.Error)); return cb(null); }
      var r = { imdb: null, imdbVotes: '', rt: null, mc: null, awards: '' };
      if (d.imdbRating && d.imdbRating !== 'N/A') { r.imdb = d.imdbRating; }
      if (d.imdbVotes && d.imdbVotes !== 'N/A') { r.imdbVotes = d.imdbVotes; }
      each(d.Ratings || [], function (x) {
        if (x.Source === 'Rotten Tomatoes') { r.rt = x.Value; }
        if (x.Source === 'Metacritic') { r.mc = x.Value.split('/')[0]; }
      });
      if (!r.mc && d.Metascore && d.Metascore !== 'N/A') { r.mc = d.Metascore; }
      if (d.Awards && d.Awards !== 'N/A') { r.awards = d.Awards; }
      omdbCache[imdbId] = r;
      cb(r);
    });
  }

  function fmtVotes(v) {
    var n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
    if (!n) { return ''; }
    if (n >= 1000000) { return (n / 1000000).toFixed(1).replace('.0', '') + ' Mn oy'; }
    if (n >= 1000) { return Math.round(n / 1000) + ' B oy'; }
    return n + ' oy';
  }

  /* Rough Turkish rendering of OMDb's English awards line */
  function trAwards(a) {
    if (!a) { return ''; }
    return a.replace(/Won (\d+) Oscars?\./i, '$1 Oscar kazandı.')
      .replace(/Nominated for (\d+) Oscars?\./i, '$1 Oscar adaylığı.')
      .replace(/Won (\d+) Primetime Emmys?\./i, '$1 Emmy kazandı.')
      .replace(/Nominated for (\d+) Primetime Emmys?\./i, '$1 Emmy adaylığı.')
      .replace(/Won (\d+) Golden Globes?\./i, '$1 Altın Küre kazandı.')
      .replace(/Nominated for (\d+) Golden Globes?\./i, '$1 Altın Küre adaylığı.')
      .replace(/(\d+) wins? & (\d+) nominations?( total)?/i, 'Toplam $1 ödül, $2 adaylık')
      .replace(/(\d+) wins?( total)?/i, '$1 ödül')
      .replace(/(\d+) nominations?( total)?/i, '$1 adaylık');
  }

  function renderRatings(meta, omdb) {
    var html = '';
    if (meta.rating) { html += '<span class="rb rb-tmdb">TMDB <b>' + Number(meta.rating).toFixed(1) + '</b></span>'; }
    var imdb = omdb && omdb.imdb ? omdb.imdb : (meta.imdbRatingFallback ? meta.imdbRatingFallback.toFixed(1) : null);
    if (imdb) { html += '<span class="rb rb-imdb">IMDb <b>' + esc(imdb) + '</b>' + (omdb && omdb.imdbVotes ? ' <small>' + esc(fmtVotes(omdb.imdbVotes)) + '</small>' : '') + '</span>'; }
    if (omdb && omdb.rt) {
      var rtv = parseInt(omdb.rt, 10);
      html += '<span class="rb ' + (rtv >= 60 ? 'rb-rt' : 'rb-rt-bad') + '">Rotten Tomatoes <b>' + esc(omdb.rt) + '</b></span>';
    }
    if (omdb && omdb.mc) {
      var mcv = parseInt(omdb.mc, 10);
      html += '<span class="rb ' + (mcv >= 61 ? 'rb-mc-good' : (mcv >= 40 ? 'rb-mc-mid' : 'rb-mc-bad')) + '">Metacritic <b>' + esc(omdb.mc) + '</b></span>';
    }
    if (omdb && omdb.awards) { html += '<span class="awards">🏆 ' + esc(trAwards(omdb.awards)) + '</span>'; }
    $('detail-ratings').innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* Detail screen (Netflix-like: hero, ratings, episodes, cast, similar)*/
  /* ------------------------------------------------------------------ */

  var detail = { meta: null, season: null, token: 0 };

  function detailRows() { return [$('detail-cast'), $('detail-similar')]; }

  screens.detail = {
    enter: function (p) {
      var token = ++detail.token;
      detail.meta = null;
      detail.season = null;
      var sc = $('detail-scroll');
      sc.scrollTop = 0;
      $('detail-title').textContent = p.name || '';
      $('detail-title').style.display = '';
      $('detail-logo').style.display = 'none';
      $('detail-logo').removeAttribute('src');
      $('detail-tagline').textContent = '';
      $('detail-meta').innerHTML = '';
      $('detail-ratings').innerHTML = '';
      $('detail-desc').textContent = '';
      $('detail-crew').textContent = '';
      $('detail-actions').innerHTML = '';
      $('detail-series').style.display = 'none';
      $('detail-seasons').innerHTML = '';
      $('detail-episodes').innerHTML = '';
      $('detail-cast').innerHTML = '';
      $('detail-similar').innerHTML = '';
      $('detail-castnames').textContent = '';
      $('detail-bg').style.backgroundImage = '';
      loading(true);
      loadMeta(p, function (meta) {
        loading(false);
        if (token !== detail.token || current !== screens.detail) { return; }
        renderDetail(meta, false);
        loadOmdb(meta.imdbId, function (om) {
          if (token !== detail.token) { return; }
          renderRatings(meta, om);
        });
      });
    },
    restore: function () {
      if (detail.meta) { renderDetail(detail.meta, true); }
      each(detailRows(), function (c) { loadNearbyImages(c); });
    },
    leave: function () {
      $('detail-bg').style.backgroundImage = '';
      each(detailRows(), function (c) { unloadImages(c); });
    },
    onFocus: function (node) {
      // Keep the hero fully visible while moving around the top buttons.
      if (closest(node, 'hero')) { $('detail-scroll').scrollTop = 0; }
      each(detailRows(), function (c) { if (c.contains(node)) { rowsOnFocus(c, node); } else { loadNearbyImages(c); } });
    }
  };

  function renderDetail(meta, refreshing) {
    detail.meta = meta;
    $('detail-title').textContent = meta.name || '';
    if (meta.logo) {
      var logo = $('detail-logo');
      logo.onload = function () { logo.style.display = 'block'; $('detail-title').style.display = 'none'; };
      logo.onerror = function () { logo.style.display = 'none'; $('detail-title').style.display = ''; };
      if (logo.getAttribute('src') !== meta.logo) { logo.src = meta.logo; }
    }
    $('detail-tagline').textContent = meta.tagline || (meta.originalName && meta.originalName !== meta.name ? meta.originalName : '');
    var bits = [];
    if (meta.releaseInfo) { bits.push(meta.releaseInfo); }
    if (meta.runtime) { bits.push(meta.runtime); }
    if (meta.extra) { bits.push(meta.extra); }
    if (meta.genres && meta.genres.length) { bits.push(meta.genres.slice(0, 3).join(', ')); }
    $('detail-meta').textContent = bits.join('  ·  ');
    if (!refreshing) { renderRatings(meta, null); }
    $('detail-desc').textContent = meta.description || 'Özet bulunamadı.';
    $('detail-crew').textContent = meta.crewLine || '';
    $('detail-bg').style.backgroundImage = meta.background ? 'url("' + meta.background + '")' : '';

    var actions = $('detail-actions');
    actions.innerHTML = '';
    var isSeries = meta.type === 'series' && meta.seasons && meta.seasons.length;

    if (!isSeries) {
      var vid = meta.id;
      var rp = resumePoint(vid);
      if (rp) {
        actions.appendChild(makeFocusable(el('div', 'btn', '▶ Devam et (' + fmtTime(rp) + ')'), function () { openStreams(meta, vid, meta.name, rp); }));
      }
      actions.appendChild(makeFocusable(el('div', 'btn' + (rp ? ' ghost' : ''), rp ? 'Baştan oynat' : '▶ Oynat'), function () { openStreams(meta, vid, meta.name, 0); }));
    } else {
      var next = nextEpisode(meta);
      if (next) {
        var tr = resumePoint(next.id);
        actions.appendChild(makeFocusable(el('div', 'btn', '▶ S' + next.season + ' B' + next.episode + (tr ? ' devam et (' + fmtTime(tr) + ')' : ' izle')), function () {
          openStreams(meta, next.id, meta.name + ' S' + next.season + 'B' + next.episode, tr);
        }));
      } else {
        var firstSeason = findFirst(meta.seasons.slice().sort(function (a, b) { return a - b; }), function (s) { return s > 0; }) || meta.seasons[0];
        actions.appendChild(makeFocusable(el('div', 'btn', '▶ S' + firstSeason + ' B1 izle'), function () {
          openStreams(meta, meta.id + ':' + firstSeason + ':1', meta.name + ' S' + firstSeason + 'B1', resumePoint(meta.id + ':' + firstSeason + ':1'));
        }));
      }
    }
    var listBtn = makeFocusable(el('div', 'btn ghost', inList(meta) ? '✓ Listemde' : '+ Listem'), function () {
      var added = toggleList(meta);
      listBtn.textContent = added ? '✓ Listemde' : '+ Listem';
      toast(added ? 'Listene eklendi' : 'Listenden çıkarıldı', 1500);
    });
    actions.appendChild(listBtn);

    // Series: seasons + episodes
    if (isSeries) {
      $('detail-series').style.display = 'block';
      var seasons = meta.seasons.slice().sort(function (a, b) { if (a === 0) { return 1; } if (b === 0) { return -1; } return a - b; });
      var nx = nextEpisode(meta);
      if (detail.season === null || seasons.indexOf(detail.season) < 0) {
        detail.season = nx ? nx.season : (findFirst(seasons, function (s) { return s > 0; }) || seasons[0]);
      }
      var seasonBox = $('detail-seasons');
      seasonBox.innerHTML = '';
      each(seasons, function (s) {
        var b = makeFocusable(el('div', 'btn small' + (s === detail.season ? '' : ' ghost'), s === 0 ? 'Özel' : ('Sezon ' + s)), function () {
          detail.season = s;
          each(seasonBox.childNodes, function (n) { n.className = n.className.replace(/\s*\bghost\b/g, '') + (n === b ? '' : ' ghost'); });
          loadEpisodes(meta, false);
        });
        seasonBox.appendChild(b);
      });
      loadEpisodes(meta, refreshing);
    } else {
      $('detail-series').style.display = 'none';
    }

    // Cast and similar titles (built once; kept when coming back so focus survives)
    if (!refreshing) {
      var personCards = (meta.cast || []).filter(function (c) { return c.kind === 'person'; });
      if (personCards.length) {
        buildRows($('detail-cast'), [{ title: 'Oyuncular', fetch: function (pg, cb) { cb(null, personCards, false); } }]);
      } else if (meta.cast && meta.cast.length) {
        $('detail-castnames').textContent = 'Oyuncular: ' + meta.cast.map(function (c) { return c.name; }).join(', ');
      }
      if (meta.recommendations && meta.recommendations.length) {
        buildRows($('detail-similar'), [{ title: 'Benzer İçerikler', fetch: function (pg, cb) { cb(null, meta.recommendations, false); } }]);
      }
      setFocus(actions.querySelector('.focusable'));
    }
  }

  function nextEpisode(meta) {
    var prefix = meta.id + ':';
    var p = allProgress();
    var best = null, bestTs = 0;
    for (var k in p) {
      if (p.hasOwnProperty(k) && k.indexOf(prefix) === 0 && p[k].ts > bestTs) { bestTs = p[k].ts; best = k; }
    }
    if (!best) { return null; }
    var parts = best.substr(prefix.length).split(':');
    var s = parseInt(parts[0], 10), e = parseInt(parts[1], 10);
    if (isNaN(s) || isNaN(e)) { return null; }
    if (isWatched(p[best])) {
      if (meta.episodeCounts && meta.episodeCounts[s] && e + 1 > meta.episodeCounts[s]) {
        if (meta.episodeCounts[s + 1]) { s = s + 1; e = 1; } else { return null; }
      } else { e = e + 1; }
    }
    return { season: s, episode: e, id: prefix + s + ':' + e };
  }

  function loadEpisodes(meta, keepFocus) {
    var box = $('detail-episodes');
    var season = detail.season;
    if (!keepFocus) { box.innerHTML = ''; box.appendChild(el('div', 'empty', 'Bölümler yükleniyor…')); }
    meta.loadSeason(season, function (videos) {
      if (detail.meta !== meta || detail.season !== season) { return; }
      var prevIdx = focused && box.contains(focused) ? Array.prototype.indexOf.call(box.childNodes, focused) : -1;
      var prevScroll = box.scrollTop;
      box.innerHTML = '';
      box.scrollTop = 0;
      if (!videos.length) { box.appendChild(el('div', 'empty', 'Bölüm bulunamadı.')); return; }
      var now = Date.now();
      each(videos, function (v) {
        var pr = getProgress(v.id);
        var watched = isWatched(pr);
        var mark = watched ? '✓ ' : (pr && pr.t > 60 ? '◐ ' : '');
        var future = v.released && new Date(v.released).getTime() > now;
        var row = el('div', 'ep' + (watched ? ' watched' : ''));
        row.appendChild(el('div', 'ep-title', mark + v.episode + '. ' + (v.title || 'Bölüm ' + v.episode)));
        var sub = [];
        if (future) { sub.push('Yayın: ' + v.released.substr(0, 10)); }
        if (v.runtime) { sub.push(v.runtime + ' dk'); }
        if (v.rating) { sub.push('★ ' + Number(v.rating).toFixed(1)); }
        if (v.overview) { sub.push(v.overview); }
        if (sub.length) { row.appendChild(el('div', 'ep-sub', sub.join(' · '))); }
        if (pr && !watched && pr.d) {
          var bar = el('div', 'ep-progress');
          bar.style.width = Math.round(pr.t / pr.d * 100) + '%';
          row.appendChild(bar);
        }
        makeFocusable(row, function () {
          openStreams(meta, v.id, meta.name + ' S' + v.season + 'B' + v.episode + (v.title ? ' – ' + v.title : ''), resumePoint(v.id));
        });
        box.appendChild(row);
      });
      if (prevIdx >= 0 && box.childNodes[prevIdx]) { box.scrollTop = prevScroll; setFocus(box.childNodes[prevIdx]); }
    });
  }

  function openStreams(meta, videoId, title, startAt) {
    var m = /:(\d+):(\d+)$/.exec(videoId);
    show('streams', { meta: meta, videoId: videoId, title: title, startAt: startAt || 0, label: m ? 'S' + m[1] + 'B' + m[2] : '' });
  }

  /* ------------------------------------------------------------------ */
  /* Person screen (actor / director filmography)                        */
  /* ------------------------------------------------------------------ */

  var personState = { token: 0 };

  screens.person = {
    enter: function (p) {
      var token = ++personState.token;
      $('person-name').textContent = p.name || '';
      $('person-meta').textContent = '';
      $('person-bio').textContent = '';
      $('person-photo').removeAttribute('src');
      var rows = $('person-rows');
      rows.innerHTML = '';
      loading(true);
      tmdb('/person/' + p.id, '&append_to_response=combined_credits', function (err, d) {
        loading(false);
        if (token !== personState.token || current !== screens.person) { return; }
        if (err || !d) { rows.appendChild(el('div', 'empty', 'Bilgi alınamadı.')); return; }
        if (d.profile_path) { $('person-photo').src = tmdbImg(d.profile_path, 'w342'); }
        var bits = [];
        if (d.known_for_department) { bits.push({ Acting: 'Oyuncu', Directing: 'Yönetmen', Writing: 'Senarist', Production: 'Yapımcı', Sound: 'Müzik' }[d.known_for_department] || d.known_for_department); }
        if (d.birthday) { bits.push('Doğum: ' + d.birthday + (d.place_of_birth ? ', ' + d.place_of_birth : '')); }
        if (d.deathday) { bits.push('Ölüm: ' + d.deathday); }
        $('person-meta').textContent = bits.join('  ·  ');
        var bio = d.biography;
        var cc = d.combined_credits || {};
        function credits(list, mediaType) {
          var seen = {}, out = [];
          each((list || []).slice().sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); }), function (r) {
            if (r.media_type !== mediaType || !r.poster_path || seen[r.id]) { return; }
            if (mediaType === 'tv' && r.character && /self|himself|herself|kendisi/i.test(r.character)) { return; }
            seen[r.id] = 1;
            out.push(tmdbToItem(r, mediaType === 'tv' ? 'series' : 'movie'));
          });
          return out;
        }
        var directed = (cc.crew || []).filter(function (c) { return c.job === 'Director'; });
        var defs = [];
        var mv = credits(cc.cast, 'movie'), tv = credits(cc.cast, 'tv'), dir = credits(directed, 'movie').concat(credits(directed, 'tv'));
        if (dir.length) { defs.push({ title: 'Yönettikleri', fetch: function (pg, cb) { cb(null, dir, false); } }); }
        if (mv.length) { defs.push({ title: 'Filmleri', fetch: function (pg, cb) { cb(null, mv, false); } }); }
        if (tv.length) { defs.push({ title: 'Dizileri', fetch: function (pg, cb) { cb(null, tv, false); } }); }
        buildRows(rows, defs, function (first) { if (current === screens.person) { setFocus(first); } });
        if (!bio) {
          tmdb('/person/' + p.id, '', function (e2, en) {
            if (token === personState.token && en && en.biography) { $('person-bio').textContent = en.biography; }
          }, 'en-US');
        } else { $('person-bio').textContent = bio; }
      });
    },
    restore: function () { rowsTick($('person-rows')); },
    leave: function () { unloadImages($('person-rows')); },
    onFocus: function (node) { rowsOnFocus($('person-rows'), node); }
  };

  /* ------------------------------------------------------------------ */
  /* Stream analysis: what can this TV play, which has Turkish audio     */
  /* ------------------------------------------------------------------ */

  function analyzeStream(s) {
    var bh = s.behaviorHints || {};
    var text = [s.name || '', s.title || '', s.description || '', bh.filename || ''].join(' ');
    var info = { reasons: [], tags: [], text: text };

    if (/2160p|\b4k\b|\buhd\b/i.test(text)) { info.res = 2160; }
    else if (/1080p|1080i|\bfhd\b/i.test(text)) { info.res = 1080; }
    else if (/720p/i.test(text)) { info.res = 720; }
    else if (/480p|576p|\bsd\b/i.test(text)) { info.res = 480; }
    else { info.res = 0; }

    var sizeMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(GB|GiB|MB|MiB)\b/i);
    if (bh.videoSize) { info.size = bh.videoSize / 1073741824; }
    else if (sizeMatch) {
      var num = parseFloat(sizeMatch[1].replace(',', '.'));
      info.size = /^m/i.test(sizeMatch[2]) ? num / 1024 : num;
    }

    if (/\.mp4\b|\bmp4\b/i.test(text)) { info.container = 'MP4'; }
    else if (/\.mkv\b|\bmkv\b/i.test(text)) { info.container = 'MKV'; }

    if (!s.url || !/^https?:\/\//i.test(s.url)) {
      info.reasons.push(s.infoHash ? 'Torrent (debrid linki değil)' : 'Doğrudan link yok');
    }
    if (info.res === 2160) { info.reasons.push('4K'); }
    if (/\b(x\.?265|h\.?265|hevc)\b/i.test(text)) { info.reasons.push('HEVC/x265'); }
    if (/\bav1\b/i.test(text)) { info.reasons.push('AV1'); }
    if (/\bhdr(10)?(\+|plus)?\b|\bdovi\b|dolby\s?vision|\bdv\b/i.test(text)) { info.reasons.push('HDR/DV'); }
    if (/10\s?-?bit|\bhi10/i.test(text)) { info.reasons.push('10bit'); }
    if (/\bdts\b|dts-?hd|dts-?x|truehd|atmos/i.test(text)) { info.reasons.push('DTS/TrueHD ses'); }
    if (/remux/i.test(text)) { info.reasons.push('Remux (çok büyük)'); }
    if (/\b3d\b|\bsbs\b/i.test(text)) { info.reasons.push('3D'); }
    if (/\[[A-Z]{2,3} download\]|uncached|not cached|⏳/i.test(text)) { info.reasons.push('Önbellekte değil'); }
    if (info.size && info.size > 12) { info.reasons.push('Çok büyük dosya'); }

    info.turkish = text.indexOf(TR_FLAG) >= 0 || /t[üu]rk[çc]e|turkish|dublaj|\btr\b|\btur\b|tr[\s._-]?en\b|\btr[\s._-]?dub/i.test(text);
    info.multiAudio = /\bdual\b|\bmulti\b|\bdual[\s._-]?audio\b/i.test(text);

    if (info.turkish) { info.tags.push('TR SES'); }
    else if (info.multiAudio) { info.tags.push('Çoklu ses'); }
    if (info.res) { info.tags.push(info.res === 2160 ? '4K' : info.res + 'p'); }
    if (info.size) { info.tags.push(info.size.toFixed(1) + ' GB'); }
    if (info.container) { info.tags.push(info.container); }
    if (/\b(x\.?264|h\.?264|avc)\b/i.test(text)) { info.tags.push('x264'); }
    if (/\b(aac)\b/i.test(text)) { info.tags.push('AAC'); }
    else if (/\b(ac3|dd5\.?1|ddp|eac3|dd\+)\b/i.test(text)) { info.tags.push('AC3'); }
    if (/\[RD\+\]|⚡|cached/i.test(text) && info.reasons.indexOf('Önbellekte değil') < 0) { info.tags.push('⚡'); }

    info.ok = info.reasons.length === 0;

    // Ranking: Turkish audio first, then 1080p, mp4, explicit x264, medium size.
    var score = 0;
    if (info.turkish) { score += 1000; } else if (info.multiAudio) { score += 150; }
    if (info.res === 1080) { score += 300; } else if (info.res === 720) { score += 200; } else if (info.res === 480) { score += 50; } else { score += 100; }
    if (info.container === 'MP4') { score += 30; }
    if (info.tags.indexOf('x264') >= 0) { score += 40; }
    if (info.size) { if (info.size > 8) { score -= 80; } else if (info.size > 5) { score -= 30; } }
    info.score = score;
    return info;
  }

  /* ------------------------------------------------------------------ */
  /* Streams screen                                                      */
  /* ------------------------------------------------------------------ */

  var streamsState = { all: [], showBad: false, token: 0 };

  screens.streams = {
    enter: function (p) {
      streamsState.all = [];
      streamsState.showBad = false;
      var token = ++streamsState.token;
      $('streams-title').textContent = p.title || '';
      var list = $('streams-list');
      list.innerHTML = '';
      list.scrollTop = 0;
      list.appendChild(el('div', 'empty', 'Kaynaklar aranıyor…'));
      $('streams-toggle').textContent = 'Uyumsuzları göster';
      $('streams-toggle')._action = function () {
        streamsState.showBad = !streamsState.showBad;
        $('streams-toggle').textContent = streamsState.showBad ? 'Uyumsuzları gizle' : 'Uyumsuzları göster';
        renderStreams(p, true, true);
      };

      var type = p.meta.type;
      var sources = addons.filter(function (a) { return supports(a, 'stream', type, p.videoId); });
      if (!sources.length) {
        list.innerHTML = '';
        list.appendChild(el('div', 'empty', 'Kaynak eklentisi bulunamadı (AIOStreams / Torrentio). ID: ' + p.videoId));
        setFocus($('streams-toggle'));
        return;
      }
      var pending = sources.length;
      each(sources, function (a) {
        loading(true);
        getJSON(addonBase(a) + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(p.videoId) + '.json', function (err, data) {
          loading(false);
          pending--;
          if (token !== streamsState.token) { return; }
          if (!err && data && data.streams) {
            each(data.streams, function (s) {
              var info = analyzeStream(s);
              info.addon = a.manifest.name || '';
              streamsState.all.push({ s: s, info: info });
            });
          }
          renderStreams(p, false, pending === 0);
        });
      });
    }
  };

  function renderStreams(p, keepFocus, finished) {
    var list = $('streams-list');
    var hadFocus = focused && list.contains(focused);
    var prevIndex = hadFocus ? Array.prototype.indexOf.call(list.querySelectorAll('.focusable'), focused) : -1;
    list.innerHTML = '';
    var good = streamsState.all.filter(function (x) { return x.info.ok; });
    var bad = streamsState.all.filter(function (x) { return !x.info.ok; });
    good.sort(function (a, b) { return b.info.score - a.info.score; });
    var trCount = good.filter(function (x) { return x.info.turkish; }).length;

    list.appendChild(el('div', 'list-head', 'Bu TV için uyumlu kaynaklar (' + good.length + (trCount ? ', ' + trCount + ' Türkçe sesli' : '') + ')' + (finished ? '' : ' – aranıyor…')));
    if (!good.length) {
      list.appendChild(el('div', 'empty', finished ? 'Uyumlu kaynak yok. "Uyumsuzları göster" ile diğerlerini görebilirsin (TV\'de çökebilir).' : 'Bekleniyor…'));
    }
    each(good, function (x) { list.appendChild(streamRow(p, x)); });

    if (streamsState.showBad && bad.length) {
      list.appendChild(el('div', 'list-head', 'Uyumsuz / riskli kaynaklar (' + bad.length + ')'));
      each(bad, function (x) { list.appendChild(streamRow(p, x)); });
    }

    var rows = list.querySelectorAll('.focusable');
    if (keepFocus || hadFocus) {
      var target = rows[Math.min(Math.max(prevIndex, 0), rows.length - 1)];
      if (target) { setFocus(target); return; }
    }
    if (!focused || !document.body.contains(focused) || focused === $('streams-toggle')) {
      if (rows.length) { setFocus(rows[0]); } else { setFocus($('streams-toggle')); }
    }
  }

  function streamRow(p, x) {
    var s = x.s, info = x.info;
    var row = el('div', 'stream' + (info.ok ? '' : ' bad'));
    var firstLine = (s.name || '').replace(/\n/g, ' ') + '  ' + (s.title || s.description || '').split('\n')[0];
    row.appendChild(el('div', 's-title', firstLine));
    var sub = el('div', 's-sub');
    var html = '';
    each(info.tags, function (t) { html += '<span class="tag ' + (t === 'TR SES' ? 'tr' : 'ok') + '">' + esc(t) + '</span>'; });
    each(info.reasons, function (r) { html += '<span class="tag warn">' + esc(r) + '</span>'; });
    html += esc(((s.title || s.description || '').split('\n').slice(1).join(' ')).substr(0, 160));
    sub.innerHTML = html;
    row.appendChild(sub);
    makeFocusable(row, function () {
      if (!s.url) { toast('Bu kaynak doğrudan oynatılamıyor (torrent). Debrid bağlantılı bir kaynak seç.'); return; }
      show('player', {
        url: s.url, title: p.title, videoId: p.videoId, meta: p.meta, startAt: p.startAt, label: p.label,
        streamSubs: s.subtitles || [], risky: !info.ok, turkishAudio: info.turkish
      });
    });
    return row;
  }

  /* ------------------------------------------------------------------ */
  /* Subtitles (Turkish first, English second)                           */
  /* ------------------------------------------------------------------ */

  var LANG_NAMES = { tur: 'Türkçe', tr: 'Türkçe', eng: 'İngilizce', en: 'İngilizce', ger: 'Almanca', deu: 'Almanca', de: 'Almanca',
    fre: 'Fransızca', fra: 'Fransızca', fr: 'Fransızca', spa: 'İspanyolca', es: 'İspanyolca', ita: 'İtalyanca', it: 'İtalyanca',
    ara: 'Arapça', ar: 'Arapça', rus: 'Rusça', ru: 'Rusça', und: 'Bilinmiyor' };

  function langName(l) { return LANG_NAMES[(l || '').toLowerCase()] || l || '?'; }

  function langRank(l) {
    l = (l || '').toLowerCase();
    if (l === 'tur' || l === 'tr' || l.indexOf('turk') === 0 || l.indexOf('türk') === 0) { return 0; }
    if (l === 'eng' || l === 'en' || l.indexOf('engl') === 0) { return 1; }
    return 2;
  }

  function fetchSubtitles(p, cb) {
    var out = [];
    each(p.streamSubs || [], function (s) { if (s && s.url) { out.push({ url: s.url, lang: s.lang || '?', src: 'stream' }); } });
    var srcs = addons.filter(function (a) { return supports(a, 'subtitles', p.meta.type, p.videoId); });
    var pending = srcs.length;
    if (!pending) { return cb(finalize(out)); }
    each(srcs, function (a) {
      getJSON(addonBase(a) + '/subtitles/' + encodeURIComponent(p.meta.type) + '/' + encodeURIComponent(p.videoId) + '.json', function (err, data) {
        if (!err && data && data.subtitles) {
          each(data.subtitles, function (s) { if (s && s.url) { out.push({ url: s.url, lang: s.lang || '?', src: a.manifest.name }); } });
        }
        pending--;
        if (pending === 0) { cb(finalize(out)); }
      });
    });

    function finalize(list) {
      list.sort(function (a, b) { return langRank(a.lang) - langRank(b.lang); });
      var counts = [0, 0, 0], limits = [6, 4, 3], res = [];
      each(list, function (s) { var r = langRank(s.lang); if (counts[r] < limits[r]) { counts[r]++; res.push(s); } });
      return res;
    }
  }

  function decodeSubtitle(xhr) {
    var buf = xhr.response;
    if (!buf) { return xhr.responseText || ''; }
    if (window.TextDecoder) {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buf)); } catch (e) {}
      try { return new TextDecoder('windows-1254').decode(new Uint8Array(buf)); } catch (e2) {}
    }
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) { s += String.fromCharCode(bytes[i]); }
    return s;
  }

  function parseTime(t) {
    var m = t.match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/);
    if (!m) { return NaN; }
    return (parseInt(m[1] || '0', 10) * 3600) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt((m[4] + '00').substr(0, 3), 10) / 1000;
  }

  function parseSubtitles(text) {
    text = text.replace(/\r/g, '').replace(/^﻿/, '');
    var blocks = text.split(/\n\s*\n/);
    var cues = [];
    each(blocks, function (b) {
      var lines = b.split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('-->') >= 0) {
          var parts = lines[i].split('-->');
          var start = parseTime(parts[0]), end = parseTime(parts[1]);
          var body = lines.slice(i + 1).join('\n').trim();
          if (!isNaN(start) && !isNaN(end) && body) {
            body = body.replace(/\{\\[^}]*\}/g, '').replace(/<(?!\/?(i|b|u)>)[^>]*>/gi, '');
            cues.push({ s: start, e: end, t: body });
          }
          break;
        }
      }
    });
    cues.sort(function (a, b) { return a.s - b.s; });
    return cues;
  }

  /* ------------------------------------------------------------------ */
  /* Player                                                              */
  /* ------------------------------------------------------------------ */

  var player = {
    p: null, video: null, osdTimer: null, seekTarget: null, seekTimer: null, wasPlaying: false,
    saveTimer: null, subTimer: null, subs: [], subIndex: -1, cues: [], cueIdx: 0, subDelay: 0,
    lastCueText: null, started: false, audioIndex: -1
  };

  screens.player = {
    enter: function (p) {
      var v = $('video');
      player.p = p;
      player.video = v;
      player.seekTarget = null;
      player.subs = []; player.subIndex = -1; player.cues = []; player.cueIdx = 0; player.subDelay = 0; player.lastCueText = null;
      player.started = false; player.audioIndex = -1;
      $('subtitle').innerHTML = '';
      $('osd-title').textContent = p.title || '';
      $('osd-sub').textContent = 'Altyazı: aranıyor…';
      $('osd-audio').textContent = '';
      playerMsg('Yükleniyor…');
      log('play', p.url.substr(0, 120));

      v.onloadedmetadata = function () {
        log('metadata ok, duration', Math.round(v.duration));
        setupAudio();
        if (p.startAt && p.startAt > 0 && !player.started) {
          try { v.currentTime = p.startAt; } catch (e) { log('resume seek fail', String(e)); }
          toast('Kaldığın yerden devam: ' + fmtTime(p.startAt));
        }
        player.started = true;
      };
      v.onplaying = function () { playerMsg(''); updateOsd(); };
      v.onwaiting = function () { playerMsg('Arabelleğe alınıyor…'); };
      v.onseeking = function () { playerMsg('Atlanıyor…'); };
      v.onseeked = function () {
        playerMsg('');
        player.cueIdx = 0;
        if (player.wasPlaying) { player.wasPlaying = false; v.play(); }
      };
      v.onpause = function () { showOsd(true); };
      v.onended = function () { saveNow(); goBack(); };
      v.onerror = function () {
        var code = v.error ? v.error.code : 0;
        var names = { 1: 'iptal edildi', 2: 'ağ hatası', 3: 'çözümleme hatası (codec desteklenmiyor)', 4: 'format desteklenmiyor' };
        log('video error', code);
        playerMsg('Oynatma hatası: ' + (names[code] || code) + '. GERİ ile başka kaynak seç.');
      };
      v.ontimeupdate = function () { if ($('player-osd').className.indexOf('show') >= 0) { updateOsd(); } };

      v.src = p.url;
      v.load();
      var pr = v.play();
      if (pr && pr['catch']) { pr['catch'](function (e) { log('play() rejected', String(e)); }); }

      clearInterval(player.saveTimer);
      player.saveTimer = setInterval(saveNow, 15000);
      clearInterval(player.subTimer);
      player.subTimer = setInterval(renderSubtitle, 200);
      showOsd(false);
      if (p.risky) { toast('Uyarı: bu kaynak TV için riskli, çökebilir.', 5000); }

      fetchSubtitles(p, function (list) {
        if (current !== screens.player || player.p !== p) { return; }
        player.subs = list;
        log('subtitles found', list.length);
        // Turkish audio -> subtitles off by default. Otherwise Turkish, then English.
        if (!p.turkishAudio && list.length && langRank(list[0].lang) <= 1) { selectSubtitle(0, true); }
        else { updateSubLabel(); }
      });
    },
    leave: function () {
      saveNow();
      clearInterval(player.saveTimer);
      clearInterval(player.subTimer);
      clearTimeout(player.seekTimer);
      clearTimeout(player.osdTimer);
      var v = player.video;
      if (v) {
        v.onloadedmetadata = v.onplaying = v.onwaiting = v.onseeking = v.onseeked = v.onpause = v.onended = v.onerror = v.ontimeupdate = null;
        try { v.pause(); } catch (e) {}
        v.removeAttribute('src');
        try { v.load(); } catch (e2) {}
      }
      player.cues = [];
      $('subtitle').innerHTML = '';
      $('player-osd').className = 'osd';
      playerMsg('');
    },
    onKey: function (code) {
      var v = player.video;
      switch (code) {
        case KEYS.ENTER: case KEYS.PLAYPAUSE:
          if (v.paused) { v.play(); } else { v.pause(); }
          showOsd(v.paused); return true;
        case KEYS.PLAY: v.play(); showOsd(false); return true;
        case KEYS.PAUSE: v.pause(); showOsd(true); return true;
        case KEYS.LEFT: queueSeek(-10); return true;
        case KEYS.RIGHT: queueSeek(10); return true;
        case KEYS.UP: case KEYS.FF: queueSeek(60); return true;
        case KEYS.DOWN: case KEYS.RW: queueSeek(-60); return true;
        case KEYS.RED: cycleAudio(); return true;
        case KEYS.YELLOW: cycleSubtitle(); return true;
        case KEYS.CH_UP: case KEYS.GREEN: shiftSubs(0.5); return true;
        case KEYS.CH_DOWN: shiftSubs(-0.5); return true;
        case KEYS.STOP: goBack(); return true;
      }
      return false;
    }
  };

  function playerMsg(t) { $('player-msg').textContent = t || ''; }

  function shiftSubs(d) {
    player.subDelay = Math.round((player.subDelay + d) * 10) / 10;
    player.cueIdx = 0;
    toast('Altyazı gecikmesi: ' + (player.subDelay > 0 ? '+' : '') + player.subDelay.toFixed(1) + ' sn', 1500);
  }

  function saveNow() {
    var v = player.video, p = player.p;
    if (!v || !p || !player.started) { return; }
    if (v.duration && isFinite(v.duration)) {
      saveProgress(p.videoId, v.currentTime, v.duration, {
        metaId: p.meta.id, type: p.meta.type, tmdbId: p.meta.tmdbId || null, name: p.meta.name,
        poster: p.meta.posterSmall || p.meta.poster || '', label: p.label || ''
      });
    }
  }

  /* Audio tracks: Turkish first, then English (only if the TV exposes audioTracks) */
  function audioTracks() {
    var v = player.video;
    return (v && v.audioTracks && v.audioTracks.length) ? v.audioTracks : null;
  }

  function setupAudio() {
    var at = audioTracks();
    if (!at) { $('osd-audio').textContent = player.p && player.p.turkishAudio ? 'Ses: Türkçe kaynak' : ''; return; }
    var pick = -1, rank = 9;
    for (var i = 0; i < at.length; i++) {
      var r = langRank(at[i].language);
      if (r < rank) { rank = r; pick = i; }
    }
    log('audio tracks', at.length, 'pick', pick);
    if (pick >= 0 && rank <= 1 && at.length > 1) { selectAudio(pick, true); }
    else { player.audioIndex = currentAudioIndex(); updateAudioLabel(); }
  }

  function currentAudioIndex() {
    var at = audioTracks();
    if (!at) { return -1; }
    for (var i = 0; i < at.length; i++) { if (at[i].enabled) { return i; } }
    return 0;
  }

  function selectAudio(i, silent) {
    var at = audioTracks();
    if (!at) { return; }
    try { for (var j = 0; j < at.length; j++) { at[j].enabled = (j === i); } } catch (e) { log('audio switch error', String(e)); }
    player.audioIndex = i;
    updateAudioLabel();
    if (!silent) { toast('Ses: ' + langName(at[i].language) + ' (' + (i + 1) + '/' + at.length + ')', 2000); }
  }

  function cycleAudio() {
    var at = audioTracks();
    if (!at || at.length < 2) { toast('Bu dosyada değiştirilebilir başka ses dili yok.'); return; }
    selectAudio((player.audioIndex + 1) % at.length);
    showOsd(false);
  }

  function updateAudioLabel() {
    var at = audioTracks();
    if (!at) { return; }
    var t = at[player.audioIndex] || at[0];
    $('osd-audio').textContent = 'Ses: ' + langName(t.language) + (at.length > 1 ? ' ' + (player.audioIndex + 1) + '/' + at.length : '');
  }

  /* Safe seeking: presses move a target marker; one real seek 900 ms after the last press. */
  function queueSeek(delta) {
    var v = player.video;
    if (!v.duration || !isFinite(v.duration)) { return; }
    var base = player.seekTarget !== null ? player.seekTarget : v.currentTime;
    player.seekTarget = Math.max(0, Math.min(v.duration - 3, base + delta));
    showOsd(true);
    updateOsd();
    clearTimeout(player.seekTimer);
    player.seekTimer = setTimeout(applySeek, 900);
  }

  function applySeek() {
    var v = player.video;
    if (player.seekTarget === null) { return; }
    var t = player.seekTarget;
    player.seekTarget = null;
    player.wasPlaying = !v.paused;
    try {
      if (!v.paused) { v.pause(); }
      v.currentTime = t;
      log('seek to', Math.round(t));
    } catch (e) { log('seek error', String(e)); player.wasPlaying = false; }
    player.cueIdx = 0;
    updateOsd();
    showOsd(false);
  }

  function showOsd(sticky) {
    var o = $('player-osd');
    o.className = 'osd show';
    updateOsd();
    clearTimeout(player.osdTimer);
    if (!sticky) {
      player.osdTimer = setTimeout(function () {
        if (player.video && !player.video.paused && player.seekTarget === null) { o.className = 'osd'; }
      }, 4000);
    }
  }

  function updateOsd() {
    var v = player.video;
    if (!v) { return; }
    var d = v.duration && isFinite(v.duration) ? v.duration : 0;
    var t = v.currentTime || 0;
    $('osd-time').textContent = fmtTime(t) + ' / ' + fmtTime(d);
    $('osd-progress').style.width = d ? (t / d * 100) + '%' : '0';
    try {
      if (v.buffered && v.buffered.length && d) {
        $('osd-buffer').style.width = (v.buffered.end(v.buffered.length - 1) / d * 100) + '%';
      }
    } catch (e) {}
    var tgt = $('osd-target');
    if (player.seekTarget !== null && d) {
      tgt.style.display = 'block';
      tgt.style.left = (player.seekTarget / d * 100) + '%';
      var diff = player.seekTarget - t;
      $('osd-seek').textContent = '→ ' + fmtTime(player.seekTarget) + ' (' + (diff >= 0 ? '+' : '-') + fmtTime(Math.abs(diff)) + ')';
    } else {
      tgt.style.display = 'none';
      $('osd-seek').textContent = '';
    }
  }

  function updateSubLabel() {
    var label;
    if (!player.subs.length) { label = 'Altyazı: yok'; }
    else if (player.subIndex < 0) { label = 'Altyazı: kapalı (' + player.subs.length + ' mevcut)'; }
    else {
      var s = player.subs[player.subIndex];
      label = 'Altyazı: ' + langName(s.lang) + ' ' + (player.subIndex + 1) + '/' + player.subs.length;
    }
    $('osd-sub').textContent = label;
  }

  function cycleSubtitle() {
    if (!player.subs.length) { toast('Altyazı bulunamadı.'); return; }
    var next = player.subIndex + 1;
    if (next >= player.subs.length) { next = -1; }
    selectSubtitle(next, false);
    showOsd(false);
  }

  function selectSubtitle(i, auto) {
    player.subIndex = i;
    player.cues = [];
    player.cueIdx = 0;
    player.lastCueText = null;
    $('subtitle').innerHTML = '';
    updateSubLabel();
    if (i < 0) { toast('Altyazı kapalı', 1500); return; }
    var sub = player.subs[i];
    var p = player.p;
    request({ url: sub.url, responseType: 'arraybuffer', timeout: 20000 }, function (err, xhr) {
      if (player.p !== p || player.subIndex !== i) { return; }
      if (err) {
        log('sub fail', err.message);
        // On auto-select, silently try the next candidate of the same rank.
        if (auto && player.subs[i + 1] && langRank(player.subs[i + 1].lang) <= 1) { selectSubtitle(i + 1, true); return; }
        toast('Altyazı indirilemedi');
        return;
      }
      player.cues = parseSubtitles(decodeSubtitle(xhr));
      log('sub cues', player.cues.length);
      toast(langName(sub.lang) + ' altyazı açık (' + player.cues.length + ' satır) · SARI ile değiştir', 2500);
    });
  }

  function renderSubtitle() {
    var v = player.video;
    if (!v || !player.cues.length) { return; }
    var t = v.currentTime - player.subDelay;
    var cues = player.cues;
    var i = player.cueIdx;
    if (i >= cues.length || (cues[i] && cues[i].s > t + 0.01)) { i = 0; }
    while (i < cues.length && cues[i].e < t) { i++; }
    player.cueIdx = i;
    var text = '';
    if (i < cues.length && cues[i].s <= t && cues[i].e >= t) { text = cues[i].t; }
    if (text !== player.lastCueText) {
      player.lastCueText = text;
      $('subtitle').innerHTML = esc(text).replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>').replace(/\n/g, '<br>');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Input handling                                                      */
  /* ------------------------------------------------------------------ */

  var backPressedAt = 0;

  function activate(node) {
    if (!node) { return; }
    if (node.tagName === 'INPUT') { node.focus(); return; }
    if (node._action) { node._action(); }
  }

  function handleBack() {
    if (goBack()) { return; }
    if (current === screens.login) { return; }
    if (current && current.name !== 'home' && TOP_LEVEL[current.name]) { switchTab('home'); return; }
    var now = Date.now();
    if (now - backPressedAt < 2500) { try { window.close(); } catch (e) {} }
    else { backPressedAt = now; toast('Çıkmak için tekrar GERİ tuşuna bas.', 2500); }
  }

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    var active = document.activeElement;

    if (code === KEYS.BLUE) {
      var dbg = $('debug');
      if (dbg.className.indexOf('show') >= 0) { dbg.className = 'debug'; }
      else { dbg.className = 'debug show'; dbg.textContent = logLines.slice(-40).join('\n'); }
      e.preventDefault(); return;
    }

    if (active && active.tagName === 'INPUT') {
      if (code === KEYS.ENTER) {
        active.blur();
        if (active._submit) { active._submit(); }
        else if (active.id === 'login-email') { setFocus($('login-pass')); }
        else if (active.id === 'login-pass') { setFocus($('login-btn')); }
        else if (active.id === 'set-tmdb') { setFocus($('set-save')); }
        else if (active.id === 'set-omdb') { setFocus($('set-omdb-save')); }
        e.preventDefault(); return;
      }
      if (code === KEYS.UP || code === KEYS.DOWN || code === KEYS.BACK || code === KEYS.ESC) {
        active.blur();
        if (code === KEYS.UP) { moveFocus('up'); }
        if (code === KEYS.DOWN) { moveFocus('down'); }
        e.preventDefault(); return;
      }
      return;
    }

    if (current && current.onKey && current.onKey(code)) { e.preventDefault(); return; }

    switch (code) {
      case KEYS.LEFT: moveFocus('left'); break;
      case KEYS.RIGHT: moveFocus('right'); break;
      case KEYS.UP: moveFocus('up'); break;
      case KEYS.DOWN: moveFocus('down'); break;
      case KEYS.ENTER: activate(focused); break;
      case KEYS.BACK: case KEYS.ESC: case KEYS.BACKSPACE: handleBack(); break;
      default: return;
    }
    e.preventDefault();
  }, false);

  // Magic Remote pointer support
  document.addEventListener('mouseover', function (e) {
    var f = closest(e.target, 'focusable');
    if (f && f !== focused) { setFocus(f, true); }
  }, false);
  document.addEventListener('click', function (e) {
    if (current === screens.player) { var v = player.video; if (v.paused) { v.play(); } else { v.pause(); } return; }
    var f = closest(e.target, 'focusable');
    if (f) { setFocus(f, true); activate(f); }
  }, false);
  document.addEventListener('mousewheel', function (e) {
    var c = activeScreenEl() && activeScreenEl().querySelector('.rows');
    if (c) { c.scrollTop += e.wheelDelta < 0 ? 300 : -300; rowsTick(c); }
  }, false);

  document.addEventListener('webkitvisibilitychange', function () {
    if (document.webkitHidden && current === screens.player && player.video) { saveNow(); player.video.pause(); }
  }, false);

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  buildNavBars();
  log('LiteStream ' + VERSION + ' start, UA:', navigator.userAgent);
  if (auth && auth.authKey) { startApp(); }
  else { show('login', {}, true); }

  window.__ls = { focused: function () { return focused; }, analyzeStream: analyzeStream, parseSubtitles: parseSubtitles, supports: supports, nextEpisode: nextEpisode };
})();
