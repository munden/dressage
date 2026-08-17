/* Pixel Passage — calendar.js
 * Month grid + week list, ring-colored pips, day sheet, event editor,
 * downloads bar, and DR.renderMiniCalendar for the shell sidebar.
 * Contract §6 (calendar). Classic script, IIFE, zero dependencies.
 */
(function () {
  'use strict';

  var DR = window.DR;
  if (!DR) { if (window.console) console.warn('[calendar] DR shell missing'); return; }

  /* ------------------------------------------------------------------ *
   * Constants & tiny helpers
   * ------------------------------------------------------------------ */

  // §5 ring colors are BINDING — always referenced via CSS custom properties.
  var RINGS = [
    { key: 'A',      label: 'Ring A',  cssVar: '--ring-a' },
    { key: 'B',      label: 'Ring B',  cssVar: '--ring-b' },
    { key: 'warmup', label: 'Warm-up', cssVar: '--ring-warmup' },
    { key: 'clinic', label: 'Clinic',  cssVar: '--ring-clinic' },
    { key: 'other',  label: 'Other',   cssVar: '--ring-other' }
  ];
  var TYPES = [
    { key: 'show',   label: 'Show',   emoji: '🏆' },
    { key: 'clinic', label: 'Clinic', emoji: '🎓' },
    { key: 'lesson', label: 'Lesson', emoji: '🐴' },
    { key: 'other',  label: 'Other',  emoji: '📌' }
  ];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function esc(s) { return DR.esc(s == null ? '' : String(s)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fromISO(s) { // parse YYYY-MM-DD as a LOCAL date (never UTC-shifted)
    var p = String(s || '').split('-');
    return new Date(+p[0] || 1970, (+p[1] || 1) - 1, +p[2] || 1);
  }
  function todayISO() { return toISO(new Date()); }
  function ringInfo(key) {
    for (var i = 0; i < RINGS.length; i++) if (RINGS[i].key === key) return RINGS[i];
    return RINGS[RINGS.length - 1]; // unknown rings render as "other"
  }
  function typeInfo(key) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].key === key) return TYPES[i];
    return TYPES[TYPES.length - 1];
  }
  function fmtT(t) { // HH:MM → pretty, via shell helper when present
    if (!t) return '';
    try { return DR.fmtTime ? DR.fmtTime(t) : t; } catch (e) { return t; }
  }
  function dayLabel(iso) { // "Sat · Aug 22"
    var d = fromISO(iso);
    return DOW[d.getDay()] + ' · ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
  }
  function canEdit() {
    return !!(DR.user && (DR.user.role === 'judge' || DR.user.role === 'admin'));
  }
  function closeModal(m) { try { if (m && m.close) m.close(); } catch (e) { /* already closed */ } }

  /* ------------------------------------------------------------------ *
   * State + data
   * ------------------------------------------------------------------ */

  var now = new Date();
  var state = {
    view: 'month',                 // 'month' | 'week'
    y: now.getFullYear(),
    m: now.getMonth(),             // 0-based
    selected: todayISO(),          // ISO day for the day sheet
    weekStart: null                // ISO Sunday for week view
  };
  var pendingFocus = null;         // ISO date the mini calendar asked us to open
  var pageEl = null;               // container while page is active
  var active = false;
  var keyBound = false;

  var eventsCache = null;          // array of events, sorted
  var eventsPromise = null;
  var testsCache = null;           // for entry testId → shortName

  var miniEl = null;               // sidebar mini calendar mount
  var miniCursor = null;           // {y, m}

  function loadEvents(force) {
    if (eventsCache && !force) return Promise.resolve(eventsCache);
    if (eventsPromise && !force) return eventsPromise;
    eventsPromise = DR.api('GET', '/api/events').then(function (list) {
      eventsCache = (Array.isArray(list) ? list : []).slice().sort(function (a, b) {
        return (a.date + 'T' + (a.start || '')) < (b.date + 'T' + (b.start || '')) ? -1 : 1;
      });
      eventsPromise = null;
      return eventsCache;
    }, function (err) {
      eventsPromise = null;
      throw err;
    });
    return eventsPromise;
  }

  function loadTests() {
    if (testsCache) return Promise.resolve(testsCache);
    return DR.api('GET', '/api/tests').then(function (list) {
      testsCache = Array.isArray(list) ? list : [];
      return testsCache;
    }, function () { testsCache = []; return testsCache; });
  }

  function testName(id) {
    if (!id || !testsCache) return id || '';
    for (var i = 0; i < testsCache.length; i++) {
      if (testsCache[i].id === id) return testsCache[i].shortName || testsCache[i].name || id;
    }
    return id;
  }

  function eventsByDate() {
    var map = {};
    (eventsCache || []).forEach(function (ev) {
      if (!ev || !ev.date) return;
      (map[ev.date] = map[ev.date] || []).push(ev);
    });
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) { return (a.start || '') < (b.start || '') ? -1 : 1; });
    });
    return map;
  }

  function refreshData() {
    return loadEvents(true).then(function () {
      if (active && pageEl) paint();
      refreshMini();
    });
  }

  function apiToast(err, fallback) {
    var msg = (err && err.error) ? err.error : fallback;
    DR.toast(msg, 'err');
  }

  /* ------------------------------------------------------------------ *
   * Styles (scoped, tokens from pixel.css)
   * ------------------------------------------------------------------ */

  function injectStyles() {
    if (document.getElementById('cal-styles')) return;
    var css = '' +
      '.cal-wrap{display:flex;flex-direction:column;gap:14px;min-width:0;}' +
      '.cal-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start;}' +
      '@media(min-width:1000px){.cal-cols{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);}}' +
      '.cal-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.cal-head .cal-month{flex:1 1 auto;min-width:0;text-align:center;font-family:var(--font-pix);' +
        'font-size:14px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.cal-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}' +
      '.cal-tools .cal-spring{flex:1 1 auto;}' +
      '.cal-dowrow,.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;}' +
      '.cal-dow{font-family:var(--font-pix);font-size:9px;text-align:center;color:var(--ink-dim);padding:4px 0;}' +
      '.cal-swipe{touch-action:pan-y;}' +
      '.cal-cell{position:relative;min-height:56px;padding:5px 3px 4px;border:2px solid var(--line);' +
        'background:var(--panel);color:var(--ink);font-family:var(--font-body);font-size:19px;line-height:1;' +
        'display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;min-width:0;}' +
      '.cal-cell:focus-visible{outline:3px solid var(--gold);outline-offset:1px;z-index:1;}' +
      '.cal-cell.is-dim{opacity:.45;}' +
      '.cal-cell.is-today{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset;}' +
      '.cal-cell.is-sel{background:var(--panel-2);border-color:var(--brand);box-shadow:2px 2px 0 var(--shadow);}' +
      '.cal-pips{display:flex;gap:3px;flex-wrap:wrap;justify-content:center;max-width:100%;}' +
      '.cal-pips i{width:8px;height:8px;display:block;}' + // square pips — this is pixel country
      '.cal-pips .cal-more{font-family:var(--font-body);font-size:13px;line-height:8px;color:var(--ink-dim);}' +
      '.cal-sheet-title{font-family:var(--font-pix);font-size:12px;margin:0 0 10px;}' +
      '.cal-empty{font-family:var(--font-body);font-size:19px;color:var(--ink-dim);margin:8px 0;}' +
      '.cal-evs{display:flex;flex-direction:column;gap:10px;}' +
      '.cal-ev{border:3px solid var(--line);border-left-width:10px;background:var(--panel);' +
        'box-shadow:3px 3px 0 var(--shadow);padding:10px 12px;min-width:0;}' +
      '.cal-ev-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.cal-ev-time{font-family:var(--font-pix);font-size:10px;}' +
      '.cal-ev-title{font-family:var(--font-body);font-size:23px;margin:6px 0 0;line-height:1.1;overflow-wrap:anywhere;}' +
      '.cal-ev-notes{font-family:var(--font-body);font-size:18px;color:var(--ink-dim);margin:4px 0 0;overflow-wrap:anywhere;}' +
      '.cal-ring-badge{color:#fff;font-family:var(--font-pix);font-size:8px;padding:4px 6px;' +
        'border:2px solid rgba(0,0,0,.25);margin-left:auto;white-space:nowrap;}' +
      '.cal-ev-entries{list-style:none;margin:8px 0 0;padding:8px 0 0;border-top:1px dashed var(--line);' +
        'font-family:var(--font-body);font-size:18px;display:flex;flex-direction:column;gap:3px;}' +
      '.cal-ev-entries li{overflow-wrap:anywhere;}' +
      '.cal-ev-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}' +
      '.cal-week{display:flex;flex-direction:column;gap:12px;}' +
      '.cal-wday-head{display:flex;align-items:baseline;gap:8px;border-bottom:2px solid var(--line);' +
        'padding-bottom:4px;margin-bottom:8px;}' +
      '.cal-wday-head b{font-family:var(--font-pix);font-size:11px;}' +
      '.cal-wday-head .cal-today-tag{font-family:var(--font-pix);font-size:8px;color:var(--gold);}' +
      '.cal-dl{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px;}' +
      '.cal-dl .cal-dl-label{font-family:var(--font-pix);font-size:10px;margin-right:2px;}' +
      '.cal-legend{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-left:auto;}' +
      '.cal-lgd{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-body);font-size:17px;' +
        'color:var(--ink-dim);white-space:nowrap;}' +
      '.cal-lgd i{width:10px;height:10px;display:inline-block;border:1px solid var(--line);}' +
      '.cal-form{display:flex;flex-direction:column;gap:10px;min-width:0;}' +
      '.cal-form label{display:flex;flex-direction:column;gap:4px;font-family:var(--font-pix);font-size:9px;' +
        'color:var(--ink-dim);min-width:0;}' +
      '.cal-form .input,.cal-form .select{width:100%;min-width:0;}' +
      '.cal-form-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}' +
      '.cal-entries-title{font-family:var(--font-pix);font-size:10px;margin:6px 0 0;}' +
      '.cal-en-row{display:grid;gap:6px;align-items:center;padding:8px 0;border-bottom:1px dashed var(--line);' +
        'grid-template-columns:minmax(0,1fr) minmax(0,1fr) 44px;' +
        'grid-template-areas:"time rider del" "horse test test";}' +
      '.cal-en-row .cal-en-time{grid-area:time;}.cal-en-row .cal-en-rider{grid-area:rider;}' +
      '.cal-en-row .cal-en-del{grid-area:del;min-height:44px;}' +
      '.cal-en-row .cal-en-horse{grid-area:horse;}.cal-en-row .cal-en-test{grid-area:test;}' +
      '.cal-en-empty{font-family:var(--font-body);font-size:18px;color:var(--ink-dim);padding:4px 0;}' +
      /* --- mini calendar (sidebar) --- */
      '.mcal{min-width:0;font-family:var(--font-body);}' +
      '.mcal-head{display:flex;align-items:center;gap:4px;margin-bottom:6px;}' +
      '.mcal-title{flex:1;text-align:center;font-family:var(--font-pix);font-size:9px;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap;}' +
      '.mcal-nav{min-width:28px;min-height:28px;padding:2px 6px;border:2px solid var(--line);' +
        'background:var(--panel);color:var(--ink);font-family:var(--font-pix);font-size:9px;cursor:pointer;}' +
      '.mcal-nav:focus-visible{outline:2px solid var(--gold);}' +
      '.mcal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;}' +
      '.mcal-dow{font-family:var(--font-pix);font-size:7px;color:var(--ink-dim);text-align:center;padding:2px 0;}' +
      '.mcal-cell{position:relative;min-height:32px;padding:3px 1px 2px;border:1px solid transparent;' +
        'background:none;color:var(--ink);font-family:var(--font-body);font-size:15px;line-height:1;' +
        'display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;min-width:0;}' +
      '.mcal-cell:focus-visible{outline:2px solid var(--gold);z-index:1;}' +
      '.mcal-cell.is-dim{opacity:.4;}' +
      '.mcal-cell.is-today{border-color:var(--gold);background:var(--panel-2);}' +
      '.mcal-pips{display:flex;gap:2px;justify-content:center;}' +
      '.mcal-pips i{width:5px;height:5px;display:block;}' +
      '@media(prefers-reduced-motion:no-preference){.cal-cell,.mcal-cell{transition:transform .08s steps(2);}' +
        '.cal-cell:active,.mcal-cell:active{transform:translateY(2px);}}';
    var tag = document.createElement('style');
    tag.id = 'cal-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ------------------------------------------------------------------ *
   * Shared HTML builders
   * ------------------------------------------------------------------ */

  function pipsHTML(list, max, cls) {
    if (!list || !list.length) return '';
    var shown = list.slice(0, max);
    var html = shown.map(function (ev) {
      var r = ringInfo(ev.ring);
      return '<i style="background:var(' + r.cssVar + ')" title="' + esc(r.label) + '"></i>';
    }).join('');
    if (list.length > max) html += '<span class="cal-more">+' + (list.length - max) + '</span>';
    return '<span class="' + cls + '">' + html + '</span>';
  }

  function eventCardHTML(ev) {
    var r = ringInfo(ev.ring);
    var t = typeInfo(ev.type);
    var entries = (ev.entries || []).slice().sort(function (a, b) {
      return (a.time || '') < (b.time || '') ? -1 : 1;
    });
    var html = '<article class="cal-ev" style="border-left-color:var(' + r.cssVar + ')">';
    html += '<header class="cal-ev-head">' +
      '<span class="cal-ev-time">' + esc(fmtT(ev.start)) + (ev.end ? '–' + esc(fmtT(ev.end)) : '') + '</span>' +
      '<span class="cal-ring-badge" style="background:var(' + r.cssVar + ')">' + esc(r.label) + '</span>' +
      '</header>';
    html += '<h3 class="cal-ev-title">' + t.emoji + ' ' + esc(ev.title || '(untitled)') + '</h3>';
    if (ev.notes) html += '<p class="cal-ev-notes">' + esc(ev.notes) + '</p>';
    if (entries.length) {
      html += '<ul class="cal-ev-entries">' + entries.map(function (en) {
        var line = '<b>' + esc(fmtT(en.time)) + '</b> ' + esc(en.rider || '—');
        if (en.horse) line += ' on ' + esc(en.horse);
        if (en.testId) line += ' · ' + esc(testName(en.testId));
        return '<li>' + line + '</li>';
      }).join('') + '</ul>';
    }
    if (canEdit()) {
      html += '<div class="cal-ev-actions">' +
        '<button type="button" class="btn" data-cal-edit="' + esc(ev.id) + '">✏️ Edit</button>' +
        '<button type="button" class="btn btn-danger" data-cal-delete="' + esc(ev.id) + '">🗑 Scratch</button>' +
        '</div>';
    }
    return html + '</article>';
  }

  function downloadsBarHTML() {
    var legend = RINGS.map(function (r) {
      return '<span class="cal-lgd"><i style="background:var(' + r.cssVar + ')"></i>' + esc(r.label) + '</span>';
    }).join('');
    return '<div class="panel cal-dl">' +
      '<span class="cal-dl-label">Take-home:</span>' +
      '<a class="btn" href="/api/schedule.ics" download="pixel-passage-schedule.ics">📥 .ics</a>' +
      '<a class="btn" href="/api/schedule.html" target="_blank" rel="noopener">🖨️ Printable</a>' +
      '<a class="btn" href="/api/schedule.csv" download="pixel-passage-schedule.csv">📊 CSV</a>' +
      '<span class="cal-legend">' + legend + '</span>' +
      '</div>';
  }

  // One month's worth of grid cells (shared by full + mini). cb(dateObj, iso, inMonth) → cell html.
  function gridCells(y, m, cb) {
    var startDow = new Date(y, m, 1).getDay();
    var total = Math.ceil((startDow + new Date(y, m + 1, 0).getDate()) / 7) * 7;
    var html = '';
    for (var i = 0; i < total; i++) {
      var d = new Date(y, m, 1 - startDow + i);
      html += cb(d, toISO(d), d.getMonth() === m);
    }
    return html;
  }

  /* ------------------------------------------------------------------ *
   * Full page — paint
   * ------------------------------------------------------------------ */

  function applyPendingFocus() {
    if (!pendingFocus) return;
    var d = fromISO(pendingFocus);
    state.y = d.getFullYear();
    state.m = d.getMonth();
    state.selected = pendingFocus;
    state.weekStart = toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()));
    pendingFocus = null;
  }

  function currentWeekStart() {
    if (state.weekStart) return state.weekStart;
    var base = fromISO(state.selected || todayISO());
    if (base.getFullYear() !== state.y || base.getMonth() !== state.m) base = new Date(state.y, state.m, 1);
    state.weekStart = toISO(new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay()));
    return state.weekStart;
  }

  function monthGridHTML(map) {
    var tIso = todayISO();
    var dows = DOW.map(function (d) { return '<span class="cal-dow">' + d[0] + '</span>'; }).join('');
    var cells = gridCells(state.y, state.m, function (d, iso, inMonth) {
      var evs = map[iso] || [];
      var cls = 'cal-cell' + (inMonth ? '' : ' is-dim') +
        (iso === tIso ? ' is-today' : '') + (iso === state.selected ? ' is-sel' : '');
      var label = dayLabel(iso) + (evs.length ? ', ' + evs.length + ' event' + (evs.length > 1 ? 's' : '') : ', no events');
      return '<button type="button" class="' + cls + '" data-cal-day="' + iso + '" aria-label="' + esc(label) + '">' +
        '<span>' + d.getDate() + '</span>' + pipsHTML(evs, 4, 'cal-pips') + '</button>';
    });
    return '<div class="cal-dowrow" aria-hidden="true">' + dows + '</div>' +
      '<div class="cal-grid">' + cells + '</div>';
  }

  function daySheetHTML(map) {
    var iso = state.selected;
    var html = '<div class="panel" style="padding:12px;">';
    if (!iso) {
      html += '<p class="cal-empty">Tap a day to see the order of go.</p>';
      return html + '</div>';
    }
    var evs = map[iso] || [];
    html += '<h2 class="cal-sheet-title">' + esc(dayLabel(iso)) + (iso === todayISO() ? ' — today' : '') + '</h2>';
    if (!evs.length) {
      html += '<p class="cal-empty">No events — free walk on a long rein. 🌾</p>';
    } else {
      html += '<div class="cal-evs">' + evs.map(eventCardHTML).join('') + '</div>';
    }
    if (canEdit()) {
      html += '<div style="margin-top:12px;">' +
        '<button type="button" class="btn btn-primary" data-cal-add="' + iso + '">➕ Add event</button></div>';
    }
    return html + '</div>';
  }

  function weekListHTML(map) {
    var start = fromISO(currentWeekStart());
    var tIso = todayISO();
    var html = '<div class="cal-week">';
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var iso = toISO(d);
      var evs = map[iso] || [];
      html += '<section class="panel" style="padding:10px 12px;">' +
        '<header class="cal-wday-head"><b>' + esc(dayLabel(iso)) + '</b>' +
        (iso === tIso ? '<span class="cal-today-tag">TODAY</span>' : '') +
        (canEdit() ? '<button type="button" class="btn btn-ghost" style="margin-left:auto;" data-cal-add="' + iso + '" aria-label="Add event on ' + esc(dayLabel(iso)) + '">➕</button>' : '') +
        '</header>';
      html += evs.length
        ? '<div class="cal-evs">' + evs.map(eventCardHTML).join('') + '</div>'
        : '<p class="cal-empty">—</p>';
      html += '</section>';
    }
    return html + '</div>';
  }

  function headerHTML() {
    var title;
    if (state.view === 'month') {
      title = MONTHS[state.m] + ' ' + state.y;
    } else {
      var s = fromISO(currentWeekStart());
      var e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
      title = MONTHS[s.getMonth()].slice(0, 3) + ' ' + s.getDate() + ' – ' +
        MONTHS[e.getMonth()].slice(0, 3) + ' ' + e.getDate();
    }
    return '<div class="cal-head">' +
      '<button type="button" class="btn" data-cal-act="prev" aria-label="Previous ' + state.view + '">◀</button>' +
      '<h1 class="cal-month">' + esc(title) + '</h1>' +
      '<button type="button" class="btn" data-cal-act="next" aria-label="Next ' + state.view + '">▶</button>' +
      '</div>' +
      '<div class="cal-tools">' +
      '<button type="button" class="btn btn-ghost" data-cal-act="today">📍 Today</button>' +
      '<button type="button" class="btn" data-cal-act="toggle" aria-pressed="' + (state.view === 'week') + '">' +
      (state.view === 'month' ? '📋 Week list' : '🗓️ Month grid') + '</button>' +
      '<span class="cal-spring"></span>' +
      (canEdit() ? '<button type="button" class="btn btn-primary" data-cal-act="new">➕ Event</button>' : '') +
      '</div>';
  }

  function paint() {
    if (!pageEl) return;
    var map = eventsByDate();
    var body;
    if (state.view === 'month') {
      body = '<div class="cal-cols">' +
        '<div class="panel cal-swipe" style="padding:10px;" data-cal-swipe>' + monthGridHTML(map) + '</div>' +
        '<div>' + daySheetHTML(map) + '</div>' +
        '</div>';
    } else {
      body = '<div class="cal-swipe" data-cal-swipe>' + weekListHTML(map) + '</div>';
    }
    pageEl.innerHTML = '<section class="cal-wrap">' + headerHTML() + body + downloadsBarHTML() + '</section>';
    wire();
  }

  /* ------------------------------------------------------------------ *
   * Full page — interaction
   * ------------------------------------------------------------------ */

  function shift(delta) {
    if (state.view === 'month') {
      var d = new Date(state.y, state.m + delta, 1);
      state.y = d.getFullYear(); state.m = d.getMonth();
      // keep the day sheet inside the visible month
      if (state.selected) {
        var s = fromISO(state.selected);
        if (s.getFullYear() !== state.y || s.getMonth() !== state.m) state.selected = null;
      }
    } else {
      var w = fromISO(currentWeekStart());
      w.setDate(w.getDate() + delta * 7);
      state.weekStart = toISO(w);
      state.y = w.getFullYear(); state.m = w.getMonth();
    }
    paint();
  }

  function goToday() {
    var t = new Date();
    state.y = t.getFullYear(); state.m = t.getMonth();
    state.selected = todayISO();
    state.weekStart = toISO(new Date(t.getFullYear(), t.getMonth(), t.getDate() - t.getDay()));
    paint();
  }

  function selectDay(iso) {
    var d = fromISO(iso);
    state.y = d.getFullYear(); state.m = d.getMonth(); // tapping a dimmed cell hops months
    state.selected = iso;
    state.weekStart = toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()));
    paint();
  }

  function wire() {
    pageEl.querySelectorAll('[data-cal-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-cal-act');
        if (act === 'prev') shift(-1);
        else if (act === 'next') shift(1);
        else if (act === 'today') goToday();
        else if (act === 'toggle') { state.view = state.view === 'month' ? 'week' : 'month'; paint(); }
        else if (act === 'new') openEditor(null, state.selected || todayISO());
      });
    });
    pageEl.querySelectorAll('[data-cal-day]').forEach(function (b) {
      b.addEventListener('click', function () { selectDay(b.getAttribute('data-cal-day')); });
    });
    pageEl.querySelectorAll('[data-cal-add]').forEach(function (b) {
      b.addEventListener('click', function () { openEditor(null, b.getAttribute('data-cal-add')); });
    });
    pageEl.querySelectorAll('[data-cal-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ev = findEvent(b.getAttribute('data-cal-edit'));
        if (ev) openEditor(ev, null);
      });
    });
    pageEl.querySelectorAll('[data-cal-delete]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ev = findEvent(b.getAttribute('data-cal-delete'));
        if (ev) deleteEvent(ev);
      });
    });
    // swipe left/right → next/prev month (or week)
    var zone = pageEl.querySelector('[data-cal-swipe]');
    if (zone) {
      var sx = 0, sy = 0, swiping = false;
      zone.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { swiping = false; return; }
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = true;
      }, { passive: true });
      zone.addEventListener('touchend', function (e) {
        if (!swiping) return;
        swiping = false;
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 2) shift(dx < 0 ? 1 : -1);
      }, { passive: true });
    }
  }

  function findEvent(id) {
    for (var i = 0; i < (eventsCache || []).length; i++) if (eventsCache[i].id === id) return eventsCache[i];
    return null;
  }

  function onKey(e) {
    if (!active) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target.isContentEditable) return;
    if (e.key === 'ArrowLeft') { shift(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { shift(1); e.preventDefault(); }
  }

  /* ------------------------------------------------------------------ *
   * Event editor (judge/admin) — create / edit, with entries editor
   * ------------------------------------------------------------------ */

  function optionList(opts, sel) {
    return opts.map(function (o) {
      return '<option value="' + esc(o.key) + '"' + (o.key === sel ? ' selected' : '') + '>' +
        esc(o.label) + '</option>';
    }).join('');
  }

  function openEditor(ev, presetDate) {
    if (!canEdit()) { DR.toast('Only judges and admins hold these reins.', 'err'); return; }
    loadTests().then(function (tests) {
      var isNew = !ev;
      var f = document.createElement('div');
      f.className = 'cal-form';
      f.innerHTML =
        '<label>Title<input class="input" name="title" type="text" maxlength="120" ' +
          'placeholder="Schooling show, clinic, lessons…" value="' + esc(ev ? ev.title : '') + '"></label>' +
        '<div class="cal-form-row">' +
          '<label>Date<input class="input" name="date" type="date" value="' +
            esc(ev ? ev.date : (presetDate || todayISO())) + '"></label>' +
          '<label>Ring<select class="select" name="ring">' +
            optionList(RINGS, ev ? ev.ring : 'A') + '</select></label>' +
        '</div>' +
        '<div class="cal-form-row">' +
          '<label>Start<input class="input" name="start" type="time" value="' + esc(ev ? ev.start : '09:00') + '"></label>' +
          '<label>End<input class="input" name="end" type="time" value="' + esc(ev ? ev.end : '12:00') + '"></label>' +
        '</div>' +
        '<label>Type<select class="select" name="type">' +
          optionList(TYPES, ev ? ev.type : 'show') + '</select></label>' +
        '<label>Notes<textarea class="input" name="notes" rows="2" maxlength="500" ' +
          'placeholder="Footing, stabling, coffee locations…">' + esc(ev ? ev.notes : '') + '</textarea></label>' +
        '<h4 class="cal-entries-title">Order of go (entries)</h4>' +
        '<div class="cal-entries"></div>' +
        '<div><button type="button" class="btn" data-cal-en-add>➕ Add entry</button></div>';

      var box = f.querySelector('.cal-entries');
      var testOpts = '<option value="">— test —</option>' + tests.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.shortName || t.name || t.id) + '</option>';
      }).join('');

      function syncEmpty() {
        var empty = f.querySelector('.cal-en-empty');
        var rows = box.querySelectorAll('.cal-en-row').length;
        if (!rows && !empty) {
          var p = document.createElement('p');
          p.className = 'cal-en-empty';
          p.textContent = 'No entries yet — the order of go is wide open.';
          box.appendChild(p);
        } else if (rows && empty) empty.remove();
      }

      function addRow(en) {
        en = en || {};
        var row = document.createElement('div');
        row.className = 'cal-en-row';
        row.innerHTML =
          '<input class="input cal-en-time" type="time" aria-label="Ride time" value="' + esc(en.time || '') + '">' +
          '<input class="input cal-en-rider" type="text" maxlength="80" placeholder="Rider" value="' + esc(en.rider || '') + '">' +
          '<button type="button" class="btn btn-ghost cal-en-del" aria-label="Remove entry">✕</button>' +
          '<input class="input cal-en-horse" type="text" maxlength="80" placeholder="Horse" value="' + esc(en.horse || '') + '">' +
          '<select class="select cal-en-test" aria-label="Test">' + testOpts + '</select>';
        row.querySelector('.cal-en-test').value = en.testId || '';
        row.querySelector('.cal-en-del').addEventListener('click', function () { row.remove(); syncEmpty(); });
        box.appendChild(row);
        syncEmpty();
        return row;
      }

      ((ev && ev.entries) || []).forEach(addRow);
      syncEmpty();
      f.querySelector('[data-cal-en-add]').addEventListener('click', function () {
        var row = addRow();
        var r = row.querySelector('.cal-en-rider');
        if (r) r.focus();
      });

      function collect() {
        var get = function (name) { return f.querySelector('[name="' + name + '"]').value; };
        var entries = [];
        box.querySelectorAll('.cal-en-row').forEach(function (row) {
          var en = {
            time: row.querySelector('.cal-en-time').value,
            rider: row.querySelector('.cal-en-rider').value.trim(),
            horse: row.querySelector('.cal-en-horse').value.trim(),
            testId: row.querySelector('.cal-en-test').value
          };
          if (en.rider || en.horse) entries.push(en);
        });
        entries.sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; });
        return {
          title: get('title').trim(),
          date: get('date'),
          start: get('start'),
          end: get('end'),
          ring: get('ring'),
          type: get('type'),
          notes: get('notes').trim(),
          entries: entries
        };
      }

      var saving = false;
      var m = DR.modal({
        title: isNew ? '➕ New event' : '✏️ Edit event',
        body: f,
        actions: [
          { label: 'Cancel', className: 'btn-ghost', onClick: function () { closeModal(m); } }
        ].concat(isNew ? [] : [
          { label: 'Scratch', className: 'btn-danger', onClick: function () { closeModal(m); deleteEvent(ev); } }
        ]).concat([
          {
            label: isNew ? 'Add to schedule' : 'Save changes',
            className: 'btn-primary',
            onClick: function () {
              if (saving) return;
              var body = collect();
              if (!body.title) { DR.toast('Every event needs a title — even "Mystery Clinic".', 'err'); return; }
              if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) { DR.toast('Pick a date — the horses need notice.', 'err'); return; }
              if (body.start && body.end && body.end < body.start) { DR.toast('End time is before start — no time-traveling trots.', 'err'); return; }
              saving = true;
              var req = isNew
                ? DR.api('POST', '/api/events', body)
                : DR.api('PUT', '/api/events/' + encodeURIComponent(ev.id), Object.assign({}, ev, body));
              req.then(function () {
                closeModal(m);
                DR.toast(isNew ? 'Event on the schedule. Hold your horses till then!' : 'Event updated — changes saved.', 'ok');
                refreshData();
              }, function (err) {
                saving = false;
                apiToast(err, 'Could not save the event. The gate stayed shut.');
              });
            }
          }
        ])
      });
    });
  }

  function deleteEvent(ev) {
    DR.confirm('Scratch "' + (ev.title || 'this event') + '" from the schedule?').then(function (ok) {
      if (!ok) return;
      DR.api('DELETE', '/api/events/' + encodeURIComponent(ev.id)).then(function () {
        DR.toast('Scratched. The ring falls quiet.', 'ok');
        refreshData();
      }, function (err) {
        apiToast(err, 'Could not scratch that event.');
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Mini calendar for the shell sidebar (contract §6)
   * ------------------------------------------------------------------ */

  function paintMini() {
    if (!miniEl) return;
    var t = new Date();
    if (!miniCursor) miniCursor = { y: t.getFullYear(), m: t.getMonth() };
    var map = eventsByDate();
    var tIso = todayISO();
    var dows = DOW.map(function (d) { return '<span class="mcal-dow">' + d[0] + '</span>'; }).join('');
    var cells = gridCells(miniCursor.y, miniCursor.m, function (d, iso, inMonth) {
      var evs = map[iso] || [];
      var cls = 'mcal-cell' + (inMonth ? '' : ' is-dim') + (iso === tIso ? ' is-today' : '');
      return '<button type="button" class="' + cls + '" data-mcal-day="' + iso + '" aria-label="' +
        esc(dayLabel(iso)) + '"><span>' + d.getDate() + '</span>' + pipsHTML(evs, 3, 'mcal-pips') + '</button>';
    });
    miniEl.innerHTML = '<div class="mcal">' +
      '<div class="mcal-head">' +
      '<button type="button" class="mcal-nav" data-mcal-nav="-1" aria-label="Previous month">◀</button>' +
      '<span class="mcal-title">' + esc(MONTHS[miniCursor.m].slice(0, 3) + ' ' + miniCursor.y) + '</span>' +
      '<button type="button" class="mcal-nav" data-mcal-nav="1" aria-label="Next month">▶</button>' +
      '</div>' +
      '<div class="mcal-grid">' + dows + cells + '</div>' +
      '</div>';
    miniEl.querySelectorAll('[data-mcal-nav]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var d = new Date(miniCursor.y, miniCursor.m + Number(b.getAttribute('data-mcal-nav')), 1);
        miniCursor = { y: d.getFullYear(), m: d.getMonth() };
        paintMini();
      });
    });
    miniEl.querySelectorAll('[data-mcal-day]').forEach(function (b) {
      b.addEventListener('click', function () {
        pendingFocus = b.getAttribute('data-mcal-day');
        if (active && pageEl) { // already on the calendar page — just focus the day
          applyPendingFocus();
          paint();
        } else {
          DR.navigate('calendar');
        }
      });
    });
  }

  function refreshMini() {
    if (miniEl && miniEl.isConnected) paintMini();
  }

  DR.renderMiniCalendar = function (el) {
    if (!el) return;
    miniEl = el;
    miniCursor = null; // reset to the current month for a fresh mount
    injectStyles();
    paintMini(); // draw the grid immediately…
    loadEvents().then(refreshMini, function () { /* no session yet — grid still useful */ });
  };

  /* ------------------------------------------------------------------ *
   * Page registration
   * ------------------------------------------------------------------ */

  DR.registerPage('calendar', {
    title: 'Calendar',
    icon: '📅',
    order: 30,
    render: function (el) {
      pageEl = el;
      active = true;
      injectStyles();
      applyPendingFocus();
      if (!keyBound) { document.addEventListener('keydown', onKey); keyBound = true; }
      var pun = (DR.loadingPun && DR.loadingPun()) || 'Dragging the arena…';
      el.innerHTML = '<section class="cal-wrap"><div class="panel" style="padding:16px;">' +
        '<p class="cal-empty">' + esc(pun) + '</p></div></section>';
      Promise.all([loadEvents(), loadTests()]).then(function () {
        if (active && pageEl === el) paint();
      }, function (err) {
        if (!(active && pageEl === el)) return;
        el.innerHTML = '<section class="cal-wrap"><div class="panel" style="padding:16px;">' +
          '<p class="cal-empty">The schedule spooked and bolted. Pull the reins and try again.</p>' +
          '<button type="button" class="btn btn-primary" data-cal-retry>🔄 Retry</button></div>' +
          downloadsBarHTML() + '</section>';
        var r = el.querySelector('[data-cal-retry]');
        if (r) r.addEventListener('click', function () { DR.navigate('calendar'); });
        if (err && err.status !== 401) apiToast(err, 'Could not load events.');
      });
    },
    onLeave: function () {
      active = false;
      pageEl = null;
      if (keyBound) { document.removeEventListener('keydown', onKey); keyBound = false; }
    }
  });
}());
