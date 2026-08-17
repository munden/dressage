/* Pixel Passage — judge.js (judge-ui agent)
 * The crown jewel: one-tap scoring with auto-advance. SPEED IS THE CONTRACT.
 * Classic IIFE script; talks only through the DR API (contract §5) + DR_DEFAULTS.
 */
(function () {
  'use strict';
  if (!window.DR || typeof DR.registerPage !== 'function') return; // shell missing — nothing to do

  var esc = function (s) { return DR.esc ? DR.esc(String(s == null ? '' : s)) : String(s == null ? '' : s); };

  /* ------------------------------------------------------------------ *
   *  State (module-level so scoring & test-pick survive re-renders,    *
   *  rotation, and tab switches — the server holds the durable copy)   *
   * ------------------------------------------------------------------ */
  var S = {
    root: null,
    view: 'landing',       // landing | setup | score | summary | result | tests | testedit
    loaded: false,
    tests: [], rides: [], events: [],
    setup: null,           // { testId, eventId, rider, horse }
    ride: null,            // current ride object (contract §2 shape)
    test: null,            // its test definition
    seq: [],               // movements then collectives, flattened
    idx: 0,                // current position in seq (seq.length == summary)
    half: false,           // half-point toggle
    noteOpen: false,
    celebrate: false,      // confetti on next result render
    edit: null,            // { t, isNew } — test editor working copy
    dirty: false, saveTimer: 0, saveFailedOnce: false,
    toastEl: null, toastTimer: 0,
    keyBound: false, visBound: false
  };

  var LONG_PRESS_MS = 450;
  var AUTOSAVE_MS = 600;

  function defaults() { return window.DR_DEFAULTS || {}; }
  function quickNotes() {
    var q = defaults().quickNotes || {};
    return { praise: q.praise || [], faults: q.faults || [], geometry: q.geometry || [] };
  }
  function collectiveDefs(test) {
    if (test && Array.isArray(test.collectives) && test.collectives.length) return test.collectives;
    if (Array.isArray(defaults().collectives) && defaults().collectives.length) return defaults().collectives;
    return [
      { key: 'gaits', name: 'Gaits', coefficient: 1 },
      { key: 'impulsion', name: 'Impulsion', coefficient: 1 },
      { key: 'submission', name: 'Submission', coefficient: 1 },
      { key: 'rider', name: "Rider's Position & Seat", coefficient: 1 }
    ];
  }

  /* ------------------------------------------------------------------ *
   *  Small helpers                                                     *
   * ------------------------------------------------------------------ */
  function arr(res, key) {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res[key])) return res[key];
    if (res && Array.isArray(res.items)) return res.items;
    return [];
  }
  function unwrap(res, key) {
    if (res && res[key] && typeof res[key] === 'object') return res[key];
    return res;
  }
  function errMsg(e, fallback) {
    return (e && (e.error || e.message)) || fallback || 'Something stumbled — try again.';
  }
  function fdate(ts) {
    try { return DR.fmtDate ? DR.fmtDate(ts) : new Date(ts).toLocaleDateString(); }
    catch (e) { return new Date(ts).toLocaleDateString(); }
  }
  function ago(ts) {
    var d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
    if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
    return fdate(ts);
  }
  function fmtS(v) { // 6.5 -> "6½" for big pixel displays
    if (v == null || typeof v !== 'number') return '—';
    return Number.isInteger(v) ? String(v) : (Math.floor(v) + '½');
  }
  function fmtPct(p) { return (Math.round(p * 1000) / 1000).toFixed(3); }
  function div(cls, html) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function qs(el, sel) { return el.querySelector(sel); }
  function qsa(el, sel) { return Array.prototype.slice.call(el.querySelectorAll(sel)); }

  /* ------------------------------------------------------------------ *
   *  Page-scoped styles (judge layout on top of pixel.css tokens)      *
   * ------------------------------------------------------------------ */
  var CSS = [
    '.jg{max-width:780px;margin:0 auto;padding:10px 12px calc(10px + env(safe-area-inset-bottom));}',
    '.jg .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
    '.jg-body{font-family:var(--font-body,monospace);font-size:19px;}',
    '.jg-dim{color:var(--ink-dim,#7a6a55);}',
    '.jg-topbtns{display:flex;gap:10px;margin:10px 0 14px;flex-wrap:wrap;}',
    '.jg-topbtns .btn{flex:1 1 150px;}',
    /* progress bar */
    '.jg-progwrap{display:flex;align-items:center;gap:6px;margin:0 0 8px;}',
    '.jg-prog{display:flex;gap:3px;flex:1;min-width:0;}',
    '.jg-seg{flex:1;min-width:4px;height:34px;padding:0;border:2px solid var(--line,#8a7a63);background:var(--panel,#fff);cursor:pointer;font-family:var(--font-pix,monospace);font-size:10px;color:var(--ink,#333);}',
    '.jg-seg.done{background:var(--green,#3e8948);border-color:var(--green,#3e8948);}',
    '.jg-seg.kc{border-style:dashed;}',
    '.jg-seg.cur{background:var(--gold,#e8a33d);border-color:var(--brand,#7a4a21);box-shadow:0 0 0 2px var(--brand,#7a4a21);}',
    '.jg-navbtn{min-width:46px;min-height:46px;padding:0;}',
    '.jg-proglabel{font-family:var(--font-pix,monospace);font-size:11px;margin:0 0 8px;display:flex;justify-content:space-between;gap:8px;}',
    /* movement card */
    '.jg-mov{padding:12px;margin-bottom:8px;}',
    '.jg-movtag{font-family:var(--font-pix,monospace);font-size:11px;color:var(--brand,#7a4a21);display:flex;justify-content:space-between;align-items:center;gap:8px;}',
    '.jg-movname{font-family:var(--font-body,monospace);font-size:25px;line-height:1.12;margin:6px 0 2px;}',
    '.jg-dir{font-family:var(--font-body,monospace);font-size:18px;line-height:1.15;color:var(--ink-dim,#7a6a55);}',
    '.jg-scoreline{display:flex;align-items:baseline;gap:12px;margin-top:6px;}',
    '.jg-bigscore{font-family:var(--font-pix,monospace);font-size:32px;color:var(--gold,#e8a33d);min-width:70px;}',
    /* chips */
    '.jg-chips{margin:2px 0 6px;}',
    '.jg-chiprow{display:flex;gap:6px;overflow-x:auto;padding:4px 2px;-webkit-overflow-scrolling:touch;scrollbar-width:none;}',
    '.jg-chiprow::-webkit-scrollbar{display:none;}',
    '.jg-chiprow .chip{flex:0 0 auto;min-height:40px;}',
    '.jg-g-praise .chip{border-color:var(--green,#3e8948);}',
    '.jg-g-faults .chip{border-color:var(--red,#c8433b);}',
    '.jg-g-geometry .chip{border-color:var(--blue,#3b6ea5);}',
    '.jg-note{width:100%;min-height:74px;margin:4px 0 8px;font-size:19px;}',
    /* score pad — sticky under the thumb */
    '.jg-pad{position:sticky;bottom:0;z-index:5;background:var(--bg,#f4ead8);padding:8px 0 max(6px,env(safe-area-inset-bottom));}',
    '.jg-pad-sec{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:6px;}',
    '.jg-pad-main{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:6px;}',
    '.jg-pad-util{display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;}',
    '.jg-key{min-height:56px;padding:4px;font-family:var(--font-pix,monospace);font-size:15px;touch-action:manipulation;user-select:none;-webkit-user-select:none;}',
    '.jg-key-main{min-height:70px;font-size:21px;}',
    '.jg-half.on{background:var(--gold,#e8a33d);color:#241a10;}',
    '.jg-errbtn{border-color:var(--red,#c8433b);color:var(--red,#c8433b);}',
    '.jg-hint{text-align:center;font-family:var(--font-body,monospace);font-size:15px;color:var(--ink-dim,#7a6a55);margin-top:4px;}',
    /* undo toast */
    '.jg-toast{position:fixed;left:50%;transform:translateX(-50%);z-index:60;display:flex;gap:12px;align-items:center;padding:10px 14px;font-family:var(--font-body,monospace);font-size:19px;max-width:92vw;}',
    '.jg-toast .btn{min-height:44px;}',
    /* lists */
    '.jg-riderow{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:10px 4px;border-bottom:2px dashed var(--line,#8a7a63);}',
    '.jg-riderow:last-child{border-bottom:none;}',
    '.jg-riderow .who{font-family:var(--font-body,monospace);font-size:21px;min-width:0;}',
    '.jg-riderow .sub{font-size:16px;color:var(--ink-dim,#7a6a55);}',
    '.jg-riderow .btn{min-height:46px;}',
    '.jg-rowbtns{display:flex;gap:6px;flex-shrink:0;}',
    /* setup */
    '.jg-testgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:6px 0 10px;}',
    '.jg-testbtn{min-height:58px;text-align:left;padding:8px;font-family:var(--font-pix,monospace);font-size:11px;line-height:1.5;}',
    '.jg-testbtn small{display:block;font-family:var(--font-body,monospace);font-size:16px;color:var(--ink-dim,#7a6a55);}',
    '.jg-testbtn.on{box-shadow:0 0 0 3px var(--gold,#e8a33d);}',
    '.jg-lvl{font-family:var(--font-pix,monospace);font-size:11px;margin:12px 0 4px;color:var(--brand,#7a4a21);}',
    '.jg-field{margin:8px 0;}',
    '.jg-field label{display:block;font-family:var(--font-pix,monospace);font-size:11px;margin-bottom:4px;}',
    '.jg-field .input,.jg-field .select{width:100%;min-height:48px;font-size:20px;}',
    /* summary */
    '.jg-sumrow{display:flex;justify-content:space-between;gap:8px;align-items:center;width:100%;text-align:left;background:none;border:none;border-bottom:2px dashed var(--line,#8a7a63);padding:9px 4px;font-family:var(--font-body,monospace);font-size:19px;color:var(--ink,#333);min-height:44px;cursor:pointer;}',
    '.jg-sumrow .sc{font-family:var(--font-pix,monospace);font-size:14px;color:var(--green,#3e8948);white-space:nowrap;}',
    '.jg-sumrow .sc.miss{color:var(--red,#c8433b);}',
    '.jg-livepct{font-family:var(--font-pix,monospace);font-size:30px;color:var(--gold,#e8a33d);text-align:center;margin:8px 0 2px;}',
    '.jg-elim{border:3px solid var(--red,#c8433b);color:var(--red,#c8433b);font-family:var(--font-pix,monospace);font-size:13px;padding:10px;text-align:center;margin:8px 0;}',
    /* result */
    '.jg-result{text-align:center;padding-top:10px;}',
    '.jg-hugepct{font-family:var(--font-pix,monospace);font-size:46px;color:var(--gold,#e8a33d);margin:16px 0 8px;text-shadow:3px 3px 0 var(--shadow,rgba(0,0,0,.25));}',
    '.jg-result .btn{margin:4px;}',
    '.jg-resbtns{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:420px;margin:14px auto 0;}',
    '.jg-resbtns .btn{min-height:52px;margin:0;}',
    /* editor */
    '.jg-movedit{border:2px solid var(--line,#8a7a63);padding:8px;margin-bottom:8px;background:var(--panel-2,var(--panel,#fff));}',
    '.jg-movedit-top{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;}',
    '.jg-movedit-top .num{font-family:var(--font-pix,monospace);font-size:12px;}',
    '.jg-movedit .input,.jg-movedit .select{width:100%;margin-bottom:6px;min-height:44px;font-size:18px;}',
    '.jg-movedit .jg-coefrow{display:flex;gap:8px;align-items:center;}',
    '.jg-movedit .jg-coefrow .select{width:auto;margin:0;}',
    '.jg-iconbtn{min-width:44px;min-height:44px;padding:0;}',
    /* landscape phones: pad on the right so both thumbs work */
    '@media (orientation:landscape) and (max-height:560px){',
    '  .jg-score2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start;}',
    '  .jg-pad{position:sticky;top:6px;bottom:auto;background:none;}',
    '}'
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById('jg-style')) return;
    var st = document.createElement('style');
    st.id = 'jg-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------------ *
   *  Scoring model                                                     *
   * ------------------------------------------------------------------ */
  function buildSeq(test) {
    var seq = (test.movements || []).map(function (m) {
      return { kind: 'm', key: String(m.num), label: 'MVT ' + m.num, name: m.name || ('Movement ' + m.num),
               directive: m.directive || '', coef: m.coefficient || 1 };
    });
    collectiveDefs(test).forEach(function (c) {
      seq.push({ kind: 'c', key: c.key, label: 'COLLECTIVE', name: c.name,
                 directive: c.directive || 'Collective mark — the overall picture of the test.',
                 coef: c.coefficient || 1 });
    });
    return seq;
  }
  function bagFor(it) { return it.kind === 'm' ? S.ride.scores : S.ride.collectives; }
  function getEntry(it) { return bagFor(it)[it.key] || null; }
  function getScore(it) {
    var e = getEntry(it);
    return e && typeof e.score === 'number' ? e.score : null;
  }
  function setScore(it, val) {
    var bag = bagFor(it);
    bag[it.key] = Object.assign({}, bag[it.key] || {}, { score: val });
    S.ride.updatedAt = Date.now();
  }
  function setNote(it, note) {
    var bag = bagFor(it);
    bag[it.key] = Object.assign({}, bag[it.key] || {}, { note: note });
    S.ride.updatedAt = Date.now();
  }
  function compute() {
    var pts = 0, max = 0, scored = 0;
    S.seq.forEach(function (it) {
      max += 10 * it.coef;
      var v = getScore(it);
      if (v != null) { pts += v * it.coef; scored++; }
    });
    var errs = S.ride.errors || 0;
    var ded = (errs >= 1 ? 2 : 0) + (errs >= 2 ? 4 : 0); // 1st −2, 2nd −4 more
    var elim = errs >= 3;
    var pct = max ? Math.max(0, pts - ded) / max * 100 : 0;
    return { pts: pts, max: max, ded: ded, elim: elim, errs: errs,
             pct: Math.round(pct * 1000) / 1000,
             scored: scored, total: S.seq.length, complete: scored === S.seq.length };
  }
  function firstUnscored() {
    for (var i = 0; i < S.seq.length; i++) if (getScore(S.seq[i]) == null) return i;
    return S.seq.length; // all done → summary
  }

  /* ------------------------------------------------------------------ *
   *  Autosave (debounced 600ms; creates the ride if it has no id yet)  *
   * ------------------------------------------------------------------ */
  function queueSave() {
    S.dirty = true;
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flushSave, AUTOSAVE_MS);
  }
  function flushSave() {
    clearTimeout(S.saveTimer);
    if (!S.ride || !S.dirty) return Promise.resolve();
    S.dirty = false;
    var p = S.ride.id
      ? DR.api('PUT', '/api/rides/' + encodeURIComponent(S.ride.id), S.ride)
      : DR.api('POST', '/api/rides', S.ride).then(function (res) {
          var saved = unwrap(res, 'ride');
          if (saved && saved.id) S.ride.id = saved.id;
        });
    return p.catch(function (e) {
      S.dirty = true; // keep it and retry on next change
      if (!S.saveFailedOnce) {
        S.saveFailedOnce = true;
        DR.toast('Autosave stumbled (' + errMsg(e, 'network') + ') — scores kept, will retry.', 'err');
      }
    });
  }
  function onVisibility() {
    if (document.visibilityState === 'hidden') flushSave();
  }

  /* ------------------------------------------------------------------ *
   *  Undo toast (DR.toast has no action button, so the judge page      *
   *  floats its own just above the pad — still thumb country)          *
   * ------------------------------------------------------------------ */
  function killToast() {
    clearTimeout(S.toastTimer);
    if (S.toastEl) { S.toastEl.remove(); S.toastEl = null; }
  }
  function undoToast(msg, fn) {
    killToast();
    var t = div('panel jg-toast', '<span>' + esc(msg) + '</span>' + (fn ? '<button class="btn">UNDO</button>' : ''));
    var pad = S.root && qs(S.root, '.jg-pad');
    var bottom = 90;
    if (pad) {
      var r = pad.getBoundingClientRect();
      if (r.top > 120) bottom = Math.max(70, window.innerHeight - r.top + 10);
    }
    t.style.bottom = bottom + 'px';
    if (fn) qs(t, 'button').addEventListener('click', function () { killToast(); fn(); });
    document.body.appendChild(t);
    S.toastEl = t;
    S.toastTimer = setTimeout(killToast, 4000);
  }

  /* ------------------------------------------------------------------ *
   *  Actions: score, error, navigate                                   *
   * ------------------------------------------------------------------ */
  function nav(i) {
    killToast();
    i = Math.max(0, Math.min(S.seq.length, i));
    S.idx = i;
    S.noteOpen = false;
    S.view = (i === S.seq.length) ? 'summary' : 'score';
    draw();
  }
  function scoreTap(k, forceHalf) {
    if (S.view !== 'score') return;
    var it = S.seq[S.idx];
    var val = Math.min(10, k + ((forceHalf || S.half) ? 0.5 : 0));
    var prevEntry = getEntry(it) ? Object.assign({}, getEntry(it)) : null;
    var atIdx = S.idx;
    setScore(it, val);
    if (val === 10) firePerfectTen(it);
    queueSave();
    nav(S.idx + 1);
    undoToast((it.kind === 'm' ? 'Mvt ' + it.key : it.name) + ' → ' + fmtS(val), function () {
      var bag = bagFor(it);
      if (prevEntry) bag[it.key] = prevEntry; else delete bag[it.key];
      S.ride.updatedAt = Date.now();
      queueSave();
      nav(atIdx);
    });
  }
  function firePerfectTen(it) {
    try {
      document.dispatchEvent(new CustomEvent('dr:perfect-ten', {
        bubbles: true,
        detail: { rideId: S.ride && S.ride.id, movement: it.name, kind: it.kind }
      }));
    } catch (e) { /* eggs are optional */ }
  }
  function addError() {
    var n = (S.ride.errors || 0) + 1;
    var apply = function () {
      S.ride.errors = n;
      queueSave();
      draw();
      var msg = n === 1 ? 'Error of course: −2 points' : n === 2 ? '2nd error: −4 more (−6 total)' : '3rd error: ELIMINATION';
      undoToast(msg, function () { S.ride.errors = n - 1; queueSave(); draw(); });
    };
    if (n >= 4) { DR.toast('Already eliminated — the bell has rung.', 'info'); return; }
    if (n === 3) {
      DR.confirm('Third error of course means ELIMINATION. Ring the bell?').then(function (ok) { if (ok) apply(); });
    } else apply();
  }

  /* ------------------------------------------------------------------ *
   *  Keyboard (arrows navigate, digits score, "." toggles ½)           *
   * ------------------------------------------------------------------ */
  function onKey(e) {
    if (S.view !== 'score' && S.view !== 'summary') return;
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'ArrowLeft') { nav(S.idx - 1); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { nav(S.idx + 1); e.preventDefault(); return; }
    if (S.view !== 'score') return;
    if (e.key === '.') { S.half = !S.half; draw(); e.preventDefault(); return; }
    if (/^[0-9]$/.test(e.key)) { scoreTap(Number(e.key), false); e.preventDefault(); }
  }
  function bindGlobal() {
    if (!S.keyBound) { document.addEventListener('keydown', onKey); S.keyBound = true; }
    if (!S.visBound) { document.addEventListener('visibilitychange', onVisibility); S.visBound = true; }
  }
  function unbindGlobal() {
    if (S.keyBound) { document.removeEventListener('keydown', onKey); S.keyBound = false; }
    if (S.visBound) { document.removeEventListener('visibilitychange', onVisibility); S.visBound = false; }
  }

  /* Swipe left/right on a region → navigate */
  function bindSwipe(el) {
    var sx = 0, sy = 0, live = false;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; live = true;
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (!live) return;
      live = false;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) nav(S.idx + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   *  Data                                                              *
   * ------------------------------------------------------------------ */
  function loadAll() {
    drawLoading();
    return Promise.all([
      DR.api('GET', '/api/tests'),
      DR.api('GET', '/api/rides'),
      DR.api('GET', '/api/events').catch(function () { return []; })
    ]).then(function (res) {
      S.tests = arr(res[0], 'tests');
      S.rides = arr(res[1], 'rides');
      S.events = arr(res[2], 'events');
      S.loaded = true;
      draw();
    }).catch(function (e) {
      S.loaded = true;
      DR.toast(errMsg(e, 'Could not reach the barn office.'), 'err');
      draw();
    });
  }
  function testById(id) {
    for (var i = 0; i < S.tests.length; i++) if (S.tests[i].id === id) return S.tests[i];
    return null;
  }
  function nameLists() {
    var riders = {}, horses = {};
    S.events.forEach(function (ev) {
      (ev.entries || []).forEach(function (en) {
        if (en.rider) riders[en.rider] = 1;
        if (en.horse) horses[en.horse] = 1;
      });
    });
    S.rides.forEach(function (r) {
      if (r.rider) riders[r.rider] = 1;
      if (r.horse) horses[r.horse] = 1;
    });
    return { riders: Object.keys(riders).sort(), horses: Object.keys(horses).sort() };
  }

  /* ------------------------------------------------------------------ *
   *  Views                                                             *
   * ------------------------------------------------------------------ */
  function draw() {
    if (!S.root) return;
    ensureStyle();
    killToast();
    S.root.innerHTML = '';
    var v = S.view;
    if (v === 'landing') drawLanding();
    else if (v === 'setup') drawSetup();
    else if (v === 'score') drawScore();
    else if (v === 'summary') drawSummary();
    else if (v === 'result') drawResult();
    else if (v === 'tests') drawTests();
    else if (v === 'testedit') drawTestEdit();
  }

  function drawLoading() {
    if (!S.root) return;
    ensureStyle();
    var pun = (DR.loadingPun && DR.loadingPun()) || 'Dragging the arena…';
    S.root.innerHTML = '';
    S.root.appendChild(div('jg jg-body', '<p class="jg-dim" style="text-align:center;margin-top:40px;">' + esc(pun) + '</p>'));
  }

  /* ---------- Landing: resume list + entry points ---------- */
  function drawLanding() {
    var wrap = div('jg jg-body');
    var inProg = S.rides.filter(function (r) { return r.status === 'in-progress'; })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    var recent = S.rides.filter(function (r) { return r.status === 'final'; })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).slice(0, 8);

    var html = '<h2 class="h-pix">Judge’s Booth</h2>' +
      '<div class="jg-topbtns">' +
      '<button class="btn btn-primary btn-big" data-act="new">🏇 New Ride</button>' +
      '<button class="btn btn-big" data-act="tests">🛠 Edit Tests</button>' +
      '</div>';

    html += '<div class="panel jg-mov"><div class="jg-movtag">RIDES IN PROGRESS</div>';
    if (!inProg.length) {
      html += '<p class="jg-dim">No rides underway — the arena is freshly dragged.</p>';
    } else {
      inProg.forEach(function (r) {
        var t = testById(r.testId);
        var total = t ? (t.movements || []).length + collectiveDefs(t).length : 0;
        var done = Object.keys(r.scores || {}).length + Object.keys(r.collectives || {}).length;
        html += '<div class="jg-riderow"><div class="who">' + esc(r.rider || '?') + ' / ' + esc(r.horse || '?') +
          '<div class="sub">' + esc(t ? (t.shortName || t.name) : r.testId) + ' · ' +
          done + (total ? '/' + total : '') + ' scored · ' + esc(ago(r.updatedAt || r.createdAt || Date.now())) + '</div></div>' +
          '<div class="jg-rowbtns"><button class="btn btn-primary" data-resume="' + esc(r.id) + '">Resume</button>' +
          '<button class="btn btn-ghost jg-iconbtn" data-del="' + esc(r.id) + '" aria-label="Delete ride">✕</button></div></div>';
      });
    }
    html += '</div>';

    html += '<div class="panel jg-mov" style="margin-top:10px;"><div class="jg-movtag">RECENT RIDES</div>';
    if (!recent.length) {
      html += '<p class="jg-dim">No signed tests yet — canter believe it!</p>';
    } else {
      recent.forEach(function (r) {
        var t = testById(r.testId);
        var pctTxt = (r.errors >= 3) ? 'ELIM' : (typeof r.finalPct === 'number' ? fmtPct(r.finalPct) + '%' : '—');
        html += '<div class="jg-riderow"><div class="who">' + esc(r.rider || '?') + ' / ' + esc(r.horse || '?') +
          '<div class="sub">' + esc(t ? (t.shortName || t.name) : r.testId) + ' · ' + esc(fdate(r.date || r.updatedAt)) + '</div></div>' +
          '<div class="jg-rowbtns"><span class="badge">' + esc(pctTxt) + '</span>' +
          '<button class="btn" data-view="' + esc(r.id) + '">View</button></div></div>';
      });
    }
    html += '</div>';
    wrap.innerHTML = html;

    qs(wrap, '[data-act="new"]').addEventListener('click', function () {
      S.setup = { testId: null, eventId: '', rider: '', horse: '' };
      S.view = 'setup'; draw();
    });
    qs(wrap, '[data-act="tests"]').addEventListener('click', function () { S.view = 'tests'; draw(); });
    qsa(wrap, '[data-resume]').forEach(function (b) {
      b.addEventListener('click', function () { resumeRide(b.getAttribute('data-resume')); });
    });
    qsa(wrap, '[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { viewRide(b.getAttribute('data-view')); });
    });
    qsa(wrap, '[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        DR.confirm('Scratch this ride? Its scores go to the knacker.').then(function (ok) {
          if (!ok) return;
          DR.api('DELETE', '/api/rides/' + encodeURIComponent(id)).then(function () {
            S.rides = S.rides.filter(function (r) { return r.id !== id; });
            DR.toast('Ride scratched.', 'ok');
            draw();
          }).catch(function (e) { DR.toast(errMsg(e), 'err'); });
        });
      });
    });
    S.root.appendChild(wrap);
  }

  function openRideCommon(ride) {
    var t = testById(ride.testId);
    if (!t) { DR.toast('That test definition has bolted (deleted?). Cannot open ride.', 'err'); return false; }
    S.ride = ride;
    S.test = t;
    S.seq = buildSeq(t);
    S.saveFailedOnce = false;
    if (!S.ride.scores) S.ride.scores = {};
    if (!S.ride.collectives) S.ride.collectives = {};
    if (typeof S.ride.errors !== 'number') S.ride.errors = 0;
    if (typeof S.ride.furtherRemarks !== 'string') S.ride.furtherRemarks = '';
    return true;
  }
  function resumeRide(id) {
    DR.api('GET', '/api/rides/' + encodeURIComponent(id)).then(function (res) {
      var ride = unwrap(res, 'ride');
      if (!openRideCommon(ride)) return;
      nav(firstUnscored());
    }).catch(function (e) { DR.toast(errMsg(e), 'err'); });
  }
  function viewRide(id) {
    var ride = null;
    for (var i = 0; i < S.rides.length; i++) if (S.rides[i].id === id) ride = S.rides[i];
    if (!ride || !openRideCommon(ride)) return;
    S.celebrate = false;
    S.view = 'result';
    draw();
  }

  /* ---------- Setup: pick test, rider & horse ---------- */
  function drawSetup() {
    var wrap = div('jg jg-body');
    var lists = nameLists();
    var byLevel = {};
    var levelOrder = [];
    S.tests.forEach(function (t) {
      var lvl = t.level || 'Other';
      if (!byLevel[lvl]) { byLevel[lvl] = []; levelOrder.push(lvl); }
      byLevel[lvl].push(t);
    });

    var html = '<h2 class="h-pix">New Ride</h2><p class="jg-dim">Pick the test, name the pair, and off you trot.</p>';
    levelOrder.forEach(function (lvl) {
      html += '<div class="jg-lvl">' + esc(lvl.toUpperCase()) + '</div><div class="jg-testgrid">';
      byLevel[lvl].forEach(function (t) {
        var n = (t.movements || []).length;
        html += '<button class="btn jg-testbtn' + (S.setup.testId === t.id ? ' on' : '') + '" data-test="' + esc(t.id) + '">' +
          esc(t.shortName || t.name) + '<small>' + n + ' movements · ' + esc(t.arena || 'standard') + ' arena</small></button>';
      });
      html += '</div>';
    });
    if (!S.tests.length) html += '<p class="jg-dim">No tests on file — visit “Edit Tests” or reset to defaults.</p>';

    var today = new Date().toISOString().slice(0, 10);
    var upcoming = S.events.filter(function (e) { return e.date >= today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 12);
    html += '<div class="jg-field"><label>EVENT (OPTIONAL)</label><select class="select" id="jg-ev"><option value="">— no event —</option>';
    upcoming.forEach(function (e) {
      html += '<option value="' + esc(e.id) + '"' + (S.setup.eventId === e.id ? ' selected' : '') + '>' +
        esc(e.date + ' · ' + e.title) + '</option>';
    });
    html += '</select></div><div id="jg-entries"></div>';

    html += '<div class="jg-field"><label>RIDER</label>' +
      '<input class="input" id="jg-rider" list="jg-riders" autocomplete="off" placeholder="Who’s in the irons?" value="' + esc(S.setup.rider) + '"></div>' +
      '<div class="jg-field"><label>HORSE</label>' +
      '<input class="input" id="jg-horse" list="jg-horses" autocomplete="off" placeholder="The mane character" value="' + esc(S.setup.horse) + '"></div>' +
      '<datalist id="jg-riders">' + lists.riders.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist>' +
      '<datalist id="jg-horses">' + lists.horses.map(function (h) { return '<option value="' + esc(h) + '">'; }).join('') + '</datalist>';

    html += '<div class="jg-topbtns" style="margin-top:14px;">' +
      '<button class="btn btn-ghost btn-big" data-act="back">◀ Back</button>' +
      '<button class="btn btn-primary btn-big" data-act="start" disabled>Enter at A ▶</button></div>';
    wrap.innerHTML = html;

    var startBtn = qs(wrap, '[data-act="start"]');
    function refresh() {
      startBtn.disabled = !(S.setup.testId && S.setup.rider.trim());
      qsa(wrap, '.jg-testbtn').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-test') === S.setup.testId);
      });
    }
    function drawEntries() {
      var box = qs(wrap, '#jg-entries');
      box.innerHTML = '';
      var ev = null;
      S.events.forEach(function (e) { if (e.id === S.setup.eventId) ev = e; });
      if (!ev || !(ev.entries || []).length) return;
      var row = div('jg-chiprow');
      (ev.entries || []).forEach(function (en) {
        var c = document.createElement('button');
        c.className = 'chip';
        c.textContent = (en.time ? en.time + ' ' : '') + (en.rider || '?') + ' / ' + (en.horse || '?');
        c.addEventListener('click', function () {
          S.setup.rider = en.rider || '';
          S.setup.horse = en.horse || '';
          if (en.testId && testById(en.testId)) S.setup.testId = en.testId;
          qs(wrap, '#jg-rider').value = S.setup.rider;
          qs(wrap, '#jg-horse').value = S.setup.horse;
          refresh();
        });
        row.appendChild(c);
      });
      box.appendChild(div('jg-lvl', 'ONE-TAP FROM THE ORDER OF GO'));
      box.appendChild(row);
    }

    qsa(wrap, '.jg-testbtn').forEach(function (b) {
      b.addEventListener('click', function () { S.setup.testId = b.getAttribute('data-test'); refresh(); });
    });
    qs(wrap, '#jg-ev').addEventListener('change', function (e) { S.setup.eventId = e.target.value; drawEntries(); });
    qs(wrap, '#jg-rider').addEventListener('input', function (e) { S.setup.rider = e.target.value; refresh(); });
    qs(wrap, '#jg-horse').addEventListener('input', function (e) { S.setup.horse = e.target.value; refresh(); });
    qs(wrap, '[data-act="back"]').addEventListener('click', function () { S.view = 'landing'; loadAll(); });
    startBtn.addEventListener('click', startRide);
    refresh();
    drawEntries();
    S.root.appendChild(wrap);
  }

  function startRide() {
    var ride = {
      testId: S.setup.testId,
      eventId: S.setup.eventId || null,
      rider: S.setup.rider.trim(),
      horse: S.setup.horse.trim(),
      date: new Date().toISOString().slice(0, 10), // server contract: YYYY-MM-DD
      status: 'in-progress',
      scores: {}, collectives: {}, errors: 0, furtherRemarks: ''
    };
    DR.api('POST', '/api/rides', ride).then(function (res) {
      var saved = unwrap(res, 'ride');
      if (saved && saved.id) ride = Object.assign(ride, { id: saved.id });
      begin();
    }).catch(function (e) {
      DR.toast('Barn office unreachable (' + errMsg(e, 'network') + ') — scoring anyway, will retry saves.', 'err');
      S.dirty = true; // flushSave will POST-create later
      begin();
    });
    function begin() {
      if (ride.id) S.rides.push(ride);
      S.ride = ride;
      if (!openRideCommon(ride)) return;
      S.half = false;
      nav(0);
    }
  }

  /* ---------- Progress bar (shared by score + summary) ---------- */
  function progressHTML() {
    var segs = '';
    for (var i = 0; i < S.seq.length; i++) {
      var it = S.seq[i];
      var cls = 'jg-seg' + (it.kind === 'c' ? ' kc' : '') +
        (getScore(it) != null ? ' done' : '') + (S.idx === i && S.view === 'score' ? ' cur' : '');
      segs += '<button class="' + cls + '" data-go="' + i + '" aria-label="' +
        esc((it.kind === 'm' ? 'Movement ' + it.key : it.name) + (getScore(it) != null ? ', scored' : ', unscored')) + '"></button>';
    }
    segs += '<button class="jg-seg' + (S.view === 'summary' ? ' cur' : '') + '" data-go="' + S.seq.length +
      '" aria-label="Judge’s card and finalize">✓</button>';
    return '<div class="jg-progwrap">' +
      '<button class="btn jg-navbtn" data-nav="-1" aria-label="Previous">◀</button>' +
      '<div class="jg-prog">' + segs + '</div>' +
      '<button class="btn jg-navbtn" data-nav="1" aria-label="Next">▶</button></div>';
  }
  function wireProgress(wrap) {
    qsa(wrap, '[data-go]').forEach(function (b) {
      b.addEventListener('click', function () { nav(Number(b.getAttribute('data-go'))); });
    });
    qsa(wrap, '[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () { nav(S.idx + Number(b.getAttribute('data-nav'))); });
    });
  }

  /* ---------- Scoring screen: one movement, giant pad ---------- */
  function drawScore() {
    var it = S.seq[S.idx];
    var wrap = div('jg jg-body');
    var entry = getEntry(it) || {};
    var movN = S.seq.filter(function (x) { return x.kind === 'm'; }).length;
    var posLabel = it.kind === 'm'
      ? 'Movement ' + it.key + '/' + movN
      : 'Collectives · ' + it.name;

    var html = progressHTML();
    html += '<div class="jg-proglabel"><span>' + esc(posLabel) + '</span><span>' +
      esc(S.ride.rider + ' / ' + S.ride.horse) + '</span></div>';

    html += '<div class="jg-score2"><div class="jg-left">';
    html += '<div class="panel jg-mov" id="jg-swipe">' +
      '<div class="jg-movtag"><span>' + esc(it.label) + (it.coef > 1 ? ' ×' + it.coef : '') + '</span>' +
      (S.ride.errors ? '<span class="badge jg-errbtn">E×' + S.ride.errors + (S.ride.errors >= 3 ? ' ELIM' : '') + '</span>' : '') +
      '</div>' +
      '<div class="jg-movname">' + esc(it.name) + '</div>' +
      (it.directive ? '<div class="jg-dir">' + esc(it.directive) + '</div>' : '') +
      '<div class="jg-scoreline"><span class="jg-bigscore" aria-live="polite">' + fmtS(getScore(it)) + '</span>' +
      (entry.note ? '<span class="jg-dim" style="font-size:16px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📝 ' + esc(entry.note) + '</span>' : '') +
      '</div></div>';

    if (S.noteOpen) {
      html += '<textarea class="input jg-note" id="jg-notebox" placeholder="Judge’s remark… (chips below append here)">' +
        esc(entry.note || '') + '</textarea>';
    }

    // quick-note chips, color-coded rows, horizontal thumb-scroll
    var q = quickNotes();
    var noteNow = entry.note || '';
    var noteParts = noteNow ? noteNow.split(/,\s*/) : [];
    html += '<div class="jg-chips">';
    ['praise', 'faults', 'geometry'].forEach(function (g) {
      if (!q[g].length) return;
      html += '<div class="jg-chiprow jg-g-' + g + '">';
      q[g].forEach(function (txt) {
        var on = noteParts.indexOf(txt) >= 0;
        html += '<button class="chip' + (on ? ' on' : '') + '" data-chip="' + esc(txt) + '">' + esc(txt) + '</button>';
      });
      html += '</div>';
    });
    html += '</div></div>'; // .jg-chips, .jg-left

    // the pad
    html += '<div class="jg-pad" id="jg-pad">' +
      '<div class="jg-pad-sec">' + [0, 1, 2, 3, 9, 10].map(keyHTML).join('') + '</div>' +
      '<div class="jg-pad-main">' + [4, 5, 6, 7, 8].map(keyHTML).join('') + '</div>' +
      '<div class="jg-pad-util">' +
      '<button class="btn jg-key jg-half' + (S.half ? ' on' : '') + '" data-half aria-pressed="' + S.half + '">½ ' + (S.half ? 'ON' : 'OFF') + '</button>' +
      '<button class="btn jg-key' + (S.noteOpen ? ' jg-half on' : '') + '" data-note aria-label="Toggle note field">📝</button>' +
      '<button class="btn jg-key jg-errbtn" data-err aria-label="Record error of course">E' + (S.ride.errors ? '×' + S.ride.errors : '') + '</button>' +
      '</div>' +
      '<div class="jg-hint">tap scores &amp; advances · hold a key for ½ · swipe card to move</div>' +
      '</div></div>'; // .jg-pad, .jg-score2

    wrap.innerHTML = html;
    wireProgress(wrap);

    function keyHTML(k) {
      var main = k >= 4 && k <= 8;
      var lbl = (S.half && k < 10) ? k + '½' : String(k);
      return '<button class="btn score-key jg-key' + (main ? ' jg-key-main btn-primary' : '') +
        '" data-key="' + k + '" aria-label="Score ' + lbl + '">' + lbl + '</button>';
    }

    qsa(wrap, '[data-key]').forEach(function (b) { bindKey(b, Number(b.getAttribute('data-key'))); });
    qs(wrap, '[data-half]').addEventListener('click', function () { S.half = !S.half; draw(); });
    qs(wrap, '[data-note]').addEventListener('click', function () {
      S.noteOpen = !S.noteOpen; draw();
      if (S.noteOpen) { var nb = qs(S.root, '#jg-notebox'); if (nb) nb.focus(); }
    });
    qs(wrap, '[data-err]').addEventListener('click', addError);

    var noteBox = qs(wrap, '#jg-notebox');
    if (noteBox) noteBox.addEventListener('input', function (e) { setNote(it, e.target.value); syncChips(); queueSave(); });

    function syncChips() {
      var parts = ((getEntry(it) || {}).note || '').split(/,\s*/);
      qsa(wrap, '[data-chip]').forEach(function (ch) {
        ch.classList.toggle('on', parts.indexOf(ch.getAttribute('data-chip')) >= 0);
      });
    }
    qsa(wrap, '[data-chip]').forEach(function (ch) {
      ch.addEventListener('click', function () {
        var txt = ch.getAttribute('data-chip');
        var cur = (getEntry(it) || {}).note || '';
        var parts = cur ? cur.split(/,\s*/).filter(Boolean) : [];
        var at = parts.indexOf(txt);
        if (at >= 0) parts.splice(at, 1); else parts.push(txt);
        setNote(it, parts.join(', '));
        ch.classList.toggle('on', at < 0);
        var nb = qs(wrap, '#jg-notebox');
        if (nb) nb.value = parts.join(', ');
        queueSave();
      });
    });

    bindSwipe(qs(wrap, '#jg-swipe'));
    S.root.appendChild(wrap);
  }

  /* One-tap + long-press(=+½) key binding via pointer events */
  function bindKey(btn, k) {
    var timer = 0, firedLong = false, sx = 0, sy = 0, moved = false;
    btn.addEventListener('pointerdown', function (e) {
      firedLong = false; moved = false;
      sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        firedLong = true;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (er) {} }
        scoreTap(k, true);
      }, LONG_PRESS_MS);
    });
    btn.addEventListener('pointermove', function (e) {
      if (Math.abs(e.clientX - sx) > 14 || Math.abs(e.clientY - sy) > 14) { moved = true; clearTimeout(timer); }
    });
    ['pointercancel', 'pointerleave'].forEach(function (ev) {
      btn.addEventListener(ev, function () { clearTimeout(timer); });
    });
    btn.addEventListener('pointerup', function () {
      clearTimeout(timer);
      if (!firedLong && !moved) scoreTap(k, false);
    });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ---------- Summary / collectives review + Sign & Finalize ---------- */
  function drawSummary() {
    var wrap = div('jg jg-body');
    var c = compute();
    var html = progressHTML();
    html += '<h2 class="h-pix">The Judge’s Card</h2>' +
      '<div class="jg-proglabel"><span>' + esc(S.ride.rider + ' / ' + S.ride.horse) + '</span><span>' +
      esc(S.test.shortName || S.test.name) + '</span></div>';

    html += '<div class="panel jg-mov">';
    S.seq.forEach(function (it, i) {
      var v = getScore(it);
      var label = it.kind === 'm' ? it.key + '. ' + it.name : '★ ' + it.name;
      html += '<button class="jg-sumrow" data-go2="' + i + '">' +
        '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(label) +
        (it.coef > 1 ? ' <span class="badge">×' + it.coef + '</span>' : '') + '</span>' +
        '<span class="sc' + (v == null ? ' miss' : '') + '">' + (v == null ? 'tap to score' : v.toFixed(1)) + '</span></button>';
    });
    html += '</div>';

    html += '<div class="panel jg-mov" style="margin-top:10px;">' +
      '<div class="jg-movtag"><span>ERRORS OF COURSE</span>' +
      '<button class="btn jg-key jg-errbtn" data-err style="min-height:48px;">+ E</button></div>' +
      '<p class="jg-dim" style="margin:6px 0 0;">1st −2 · 2nd −4 more · 3rd elimination.&nbsp; Currently: <b>' +
      c.errs + (c.elim ? ' — ELIMINATED' : c.ded ? ' (−' + c.ded + ' pts)' : '') + '</b></p></div>';

    html += '<div class="jg-field" style="margin-top:10px;"><label>FURTHER REMARKS</label>' +
      '<textarea class="input jg-note" id="jg-remarks" placeholder="A word for the rider…">' +
      esc(S.ride.furtherRemarks || '') + '</textarea></div>';

    if (c.elim) html += '<div class="jg-elim">ELIMINATED — 3 ERRORS OF COURSE</div>';
    html += '<div class="jg-livepct" aria-live="polite">' + (c.elim ? 'ELIM' : fmtPct(c.pct) + '%') + '</div>' +
      '<p class="jg-dim" style="text-align:center;margin:0 0 10px;">' +
      c.pts.toFixed(1) + ' / ' + c.max + ' pts' + (c.ded ? ' · −' + c.ded + ' errors' : '') +
      ' · ' + c.scored + '/' + c.total + ' scored</p>';

    html += '<div class="jg-topbtns">' +
      '<button class="btn btn-ghost btn-big" data-back>◀ Scoring</button>' +
      '<button class="btn btn-primary btn-big" data-sign' + (c.complete ? '' : ' disabled') + '>✍ Sign &amp; Finalize</button></div>';
    if (!c.complete) html += '<p class="jg-dim" style="text-align:center;">' + (c.total - c.scored) +
      ' still unscored — tap a red row to jump there.</p>';

    wrap.innerHTML = html;
    wireProgress(wrap);
    qsa(wrap, '[data-go2]').forEach(function (b) {
      b.addEventListener('click', function () { nav(Number(b.getAttribute('data-go2'))); });
    });
    qs(wrap, '[data-err]').addEventListener('click', addError);
    qs(wrap, '#jg-remarks').addEventListener('input', function (e) {
      S.ride.furtherRemarks = e.target.value;
      S.ride.updatedAt = Date.now();
      queueSave();
    });
    qs(wrap, '[data-back]').addEventListener('click', function () { nav(S.seq.length - 1); });
    qs(wrap, '[data-sign]').addEventListener('click', finalize);
    S.root.appendChild(wrap);
  }

  function finalize() {
    var c = compute();
    if (!c.complete) { DR.toast('A few movements are still blank — no blind judging here.', 'err'); return; }
    DR.confirm('Sign and finalize this test? The ink is permanent.').then(function (ok) {
      if (!ok) return;
      S.ride.status = 'final';
      S.ride.finalPct = c.elim ? 0 : c.pct;
      S.ride.updatedAt = Date.now();
      S.dirty = true;
      flushSave().then(function () {
        if (S.dirty) { // save failed — don't pretend
          S.ride.status = 'in-progress';
          DR.toast('Could not reach the barn office — test kept in progress.', 'err');
          draw();
          return;
        }
        S.celebrate = true;
        S.view = 'result';
        draw();
      });
    });
  }

  /* ---------- Result: celebration + reports ---------- */
  function scorePun(c) {
    if (c.elim) return 'Eliminated — even Valegro had off days. Walk it off.';
    var p = c.pct;
    if (p >= 75) return 'Passage-ional! Straight from the horse’s mouth: brilliant.';
    if (p >= 70) return 'Unbridled brilliance — no need to rein it in!';
    if (p >= 65) return 'A lovely test. Mane character energy!';
    if (p >= 60) return 'Solid, obedient work — canter believe the progress!';
    if (p >= 50) return 'Green but game. Hay, nice transitions in there!';
    return 'Every grand prix horse started somewhere. Back to the schooling ring!';
  }
  function drawResult() {
    var wrap = div('jg jg-body jg-result');
    var c = compute();
    var tens = S.seq.filter(function (it) { return getScore(it) === 10; }).length;
    var best = null;
    S.seq.forEach(function (it) {
      var v = getScore(it);
      if (v != null && (!best || v > best.v)) best = { v: v, name: it.name };
    });
    var pctTxt = c.elim ? 'ELIM' : fmtPct(typeof S.ride.finalPct === 'number' ? S.ride.finalPct : c.pct) + '%';

    var html = '<h2 class="h-pix">Final Salute</h2>' +
      '<div class="jg-body jg-dim">' + esc(S.ride.rider + ' / ' + S.ride.horse) + ' · ' +
      esc(S.test.shortName || S.test.name) + ' · ' + esc(fdate(S.ride.date || Date.now())) + '</div>' +
      '<div class="jg-hugepct">' + esc(pctTxt) + '</div>' +
      '<p class="jg-body" style="max-width:460px;margin:0 auto;">' + esc(scorePun(c)) + '</p>' +
      '<p class="jg-dim" style="margin-top:6px;">' + c.pts.toFixed(1) + ' / ' + c.max + ' pts' +
      (c.ded ? ' · −' + c.ded + ' errors' : '') +
      (best ? ' · best: ' + esc(best.name).slice(0, 40) + ' (' + best.v.toFixed(1) + ')' : '') +
      (tens ? ' · ' + tens + '× PERFECT TEN!' : '') + '</p>';

    html += '<div class="jg-resbtns">' +
      '<button class="btn" data-rep="html">📄 Report</button>' +
      '<button class="btn" data-rep="csv">📊 CSV</button>' +
      '<button class="btn" data-email>✉️ Email report</button>' +
      '<button class="btn btn-primary" data-new>🏇 New ride</button>' +
      '</div><div style="margin-top:10px;"><button class="btn btn-ghost" data-home>◀ Back to the booth</button></div>';
    wrap.innerHTML = html;

    var id = S.ride.id;
    qsa(wrap, '[data-rep]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!id) { DR.toast('Ride not saved to the server yet.', 'err'); return; }
        window.open('/api/report/ride/' + encodeURIComponent(id) + '.' + b.getAttribute('data-rep'), '_blank');
      });
    });
    qs(wrap, '[data-email]').addEventListener('click', function () {
      if (!id) { DR.toast('Ride not saved to the server yet.', 'err'); return; }
      emailReportModal([id], 'Score report — ' + S.ride.rider + ' on ' + S.ride.horse);
    });
    qs(wrap, '[data-new]').addEventListener('click', function () {
      S.setup = { testId: S.ride.testId, eventId: S.ride.eventId || '', rider: '', horse: '' };
      S.ride = null;
      S.view = 'setup';
      loadAll();
      S.view = 'setup'; // loadAll draws async; keep target view
    });
    qs(wrap, '[data-home]').addEventListener('click', function () { S.ride = null; S.view = 'landing'; loadAll(); });
    S.root.appendChild(wrap);

    if (S.celebrate) {
      S.celebrate = false;
      if (DR.confetti) { try { DR.confetti(); } catch (e) {} }
    }
  }

  function emailReportModal(rideIds, subject) {
    var body = div('jg-body');
    body.innerHTML = '<p style="margin:0 0 8px;">Comma-separate for a full mailbag.</p>' +
      '<input class="input" id="jg-emails" type="text" inputmode="email" autocomplete="email" ' +
      'placeholder="donna@example.com, owner@example.com" style="width:100%;min-height:48px;">';
    var m = DR.modal({
      title: 'Email report',
      body: body,
      actions: [
        { label: 'Cancel', className: 'btn-ghost', onClick: function () { if (m && m.close) m.close(); } },
        { label: 'Send ✉️', className: 'btn-primary', onClick: function () {
            var raw = (qs(body, '#jg-emails').value || '');
            var emails = raw.split(/[,;\s]+/).filter(function (x) { return x.indexOf('@') > 0; });
            if (!emails.length) { DR.toast('Need at least one address — the horse can’t deliver it.', 'err'); return; }
            if (m && m.close) m.close();
            DR.api('POST', '/api/report', { rideIds: rideIds, emails: emails, subject: subject })
              .then(function (res) {
                res = res || {};
                if (res.sent) DR.toast('Report sent — special delivery by pony express!', 'ok');
                else DR.toast('SMTP’s asleep — report saved to the outbox instead.', 'info');
              })
              .catch(function (e) { DR.toast(errMsg(e, 'Sending failed.'), 'err'); });
          } }
      ]
    });
    setTimeout(function () { var i = qs(body, '#jg-emails'); if (i) i.focus(); }, 50);
  }

  /* ------------------------------------------------------------------ *
   *  Test editor                                                       *
   * ------------------------------------------------------------------ */
  function drawTests() {
    var wrap = div('jg jg-body');
    var isAdmin = DR.user && DR.user.role === 'admin';
    var html = '<h2 class="h-pix">Test Editor</h2>' +
      '<div class="jg-topbtns">' +
      '<button class="btn btn-ghost btn-big" data-back>◀ Booth</button>' +
      '<button class="btn btn-primary btn-big" data-new>＋ New test</button>' +
      (isAdmin ? '<button class="btn btn-danger btn-big" data-reset>Reset to defaults</button>' : '') +
      '</div><div class="panel jg-mov">';
    if (!S.tests.length) html += '<p class="jg-dim">No tests on file. Add one, or reset to defaults.</p>';
    S.tests.forEach(function (t) {
      html += '<div class="jg-riderow"><div class="who">' + esc(t.shortName || t.name) +
        '<div class="sub">' + esc(t.name) + ' · ' + esc(t.level || '') + ' · ' +
        (t.movements || []).length + ' movements</div></div>' +
        '<div class="jg-rowbtns"><button class="btn" data-edit="' + esc(t.id) + '">Edit</button>' +
        '<button class="btn btn-ghost jg-iconbtn" data-del="' + esc(t.id) + '" aria-label="Delete test">✕</button></div></div>';
    });
    html += '</div>';
    wrap.innerHTML = html;

    qs(wrap, '[data-back]').addEventListener('click', function () { S.view = 'landing'; loadAll(); });
    qs(wrap, '[data-new]').addEventListener('click', function () {
      S.edit = { isNew: true, t: { name: '', shortName: '', level: 'Training', arena: 'standard',
        movements: [{ num: 1, name: 'A Enter working trot, X halt, salute', directive: 'Straightness; quality of halt', coefficient: 1 }] } };
      S.view = 'testedit'; draw();
    });
    var resetBtn = qs(wrap, '[data-reset]');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      DR.confirm('Replace ALL tests with factory defaults? Custom tests go to pasture.').then(function (ok) {
        if (!ok) return;
        DR.api('POST', '/api/tests/reset').then(function () {
          DR.toast('Tests re-seeded from defaults.', 'ok');
          return DR.api('GET', '/api/tests');
        }).then(function (res) { S.tests = arr(res, 'tests'); draw(); })
          .catch(function (e) { DR.toast(errMsg(e), 'err'); });
      });
    });
    qsa(wrap, '[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = testById(b.getAttribute('data-edit'));
        if (!t) return;
        S.edit = { isNew: false, t: JSON.parse(JSON.stringify(t)) };
        S.view = 'testedit'; draw();
      });
    });
    qsa(wrap, '[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        DR.confirm('Delete this test? Existing rides keep their scores but lose the sheet.').then(function (ok) {
          if (!ok) return;
          DR.api('DELETE', '/api/tests/' + encodeURIComponent(id)).then(function () {
            S.tests = S.tests.filter(function (t) { return t.id !== id; });
            DR.toast('Test retired.', 'ok');
            draw();
          }).catch(function (e) { DR.toast(errMsg(e), 'err'); });
        });
      });
    });
    S.root.appendChild(wrap);
  }

  function drawTestEdit() {
    var wrap = div('jg jg-body');
    var t = S.edit.t;
    var html = '<h2 class="h-pix">' + (S.edit.isNew ? 'New Test' : 'Edit Test') + '</h2>' +
      '<div class="jg-field"><label>NAME</label><input class="input" data-f="name" value="' + esc(t.name) + '" placeholder="Training Level Test 1"></div>' +
      '<div class="jg-field"><label>SHORT NAME</label><input class="input" data-f="shortName" value="' + esc(t.shortName) + '" placeholder="Training 1"></div>' +
      '<div class="row">' +
      '<div class="jg-field" style="flex:1;"><label>LEVEL</label><input class="input" data-f="level" value="' + esc(t.level || '') + '" placeholder="Training"></div>' +
      '<div class="jg-field" style="flex:1;"><label>ARENA</label><select class="select" data-f="arena">' +
      '<option value="small"' + (t.arena === 'small' ? ' selected' : '') + '>small (20×40)</option>' +
      '<option value="standard"' + (t.arena !== 'small' ? ' selected' : '') + '>standard (20×60)</option>' +
      '</select></div></div>' +
      '<div class="jg-lvl">MOVEMENTS</div><div id="jg-movlist"></div>' +
      '<button class="btn" data-addmov style="min-height:48px;">＋ Add movement</button>' +
      '<div class="pix-divider"></div>' +
      '<div class="jg-topbtns">' +
      '<button class="btn btn-ghost btn-big" data-cancel>Cancel</button>' +
      '<button class="btn btn-primary btn-big" data-save>💾 Save test</button></div>';
    wrap.innerHTML = html;

    qsa(wrap, '[data-f]').forEach(function (inp) {
      inp.addEventListener('input', function () { t[inp.getAttribute('data-f')] = inp.value; });
      inp.addEventListener('change', function () { t[inp.getAttribute('data-f')] = inp.value; });
    });

    var list = qs(wrap, '#jg-movlist');
    function renderMovs() {
      list.innerHTML = '';
      (t.movements || []).forEach(function (m, i) {
        var row = div('jg-movedit');
        row.innerHTML =
          '<div class="jg-movedit-top"><span class="num">#' + (i + 1) + '</span>' +
          '<span class="jg-rowbtns">' +
          '<button class="btn jg-iconbtn" data-up aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button class="btn jg-iconbtn" data-down aria-label="Move down"' + (i === t.movements.length - 1 ? ' disabled' : '') + '>▼</button>' +
          '<button class="btn btn-ghost jg-iconbtn" data-rm aria-label="Delete movement">✕</button></span></div>' +
          '<input class="input" data-m="name" value="' + esc(m.name || '') + '" placeholder="A Enter working trot…">' +
          '<input class="input" data-m="directive" value="' + esc(m.directive || '') + '" placeholder="Directive (what the judge looks for)">' +
          '<div class="jg-coefrow"><label class="jg-dim" style="font-size:16px;">Coefficient</label>' +
          '<select class="select" data-m="coefficient">' +
          [1, 2].map(function (cf) { return '<option value="' + cf + '"' + ((m.coefficient || 1) === cf ? ' selected' : '') + '>×' + cf + '</option>'; }).join('') +
          '</select></div>';
        qsa(row, '[data-m]').forEach(function (inp) {
          var f = inp.getAttribute('data-m');
          inp.addEventListener('input', function () { m[f] = f === 'coefficient' ? Number(inp.value) : inp.value; });
          inp.addEventListener('change', function () { m[f] = f === 'coefficient' ? Number(inp.value) : inp.value; });
        });
        qs(row, '[data-up]').addEventListener('click', function () {
          t.movements.splice(i - 1, 0, t.movements.splice(i, 1)[0]); renderMovs();
        });
        qs(row, '[data-down]').addEventListener('click', function () {
          t.movements.splice(i + 1, 0, t.movements.splice(i, 1)[0]); renderMovs();
        });
        qs(row, '[data-rm]').addEventListener('click', function () {
          t.movements.splice(i, 1); renderMovs();
        });
        list.appendChild(row);
      });
    }
    renderMovs();

    qs(wrap, '[data-addmov]').addEventListener('click', function () {
      t.movements.push({ num: t.movements.length + 1, name: '', directive: '', coefficient: 1 });
      renderMovs();
      var last = list.lastElementChild && qs(list.lastElementChild, '[data-m="name"]');
      if (last) last.focus();
    });
    qs(wrap, '[data-cancel]').addEventListener('click', function () { S.edit = null; S.view = 'tests'; draw(); });
    qs(wrap, '[data-save]').addEventListener('click', function () {
      if (!t.name.trim()) { DR.toast('The test needs a name — “Mystery Meander” won’t do.', 'err'); return; }
      if (!t.shortName.trim()) t.shortName = t.name.trim().slice(0, 18);
      if (!(t.movements || []).length) { DR.toast('At least one movement, or it’s just standing at A.', 'err'); return; }
      t.movements.forEach(function (m, i) { m.num = i + 1; m.coefficient = m.coefficient || 1; });
      var p = S.edit.isNew
        ? DR.api('POST', '/api/tests', t)
        : DR.api('PUT', '/api/tests/' + encodeURIComponent(t.id), t);
      p.then(function () {
        DR.toast('Test saved — ready to ride.', 'ok');
        S.edit = null;
        return DR.api('GET', '/api/tests');
      }).then(function (res) { S.tests = arr(res, 'tests'); S.view = 'tests'; draw(); })
        .catch(function (e) { DR.toast(errMsg(e), 'err'); });
    });
    S.root.appendChild(wrap);
  }

  /* ------------------------------------------------------------------ *
   *  Register                                                          *
   * ------------------------------------------------------------------ */
  DR.registerPage('judge', {
    title: 'Judge',
    icon: '🏇',
    order: 20,
    roles: ['judge', 'admin'],
    render: function (el) {
      S.root = el;
      ensureStyle();
      bindGlobal();
      // Module state survives shell re-renders and rotation: a ride mid-score,
      // a half-picked setup screen, or an open test edit all resume in place.
      var midTask = S.ride || S.edit || (S.setup && S.view === 'setup');
      if (S.loaded && midTask) draw();
      else { if (!midTask) S.view = 'landing'; loadAll(); }
    },
    onLeave: function () {
      flushSave();
      unbindGlobal();
      killToast();
    }
  });
})();
