/* Pixel Passage — rides.js (rides-viz agent, contract §6c)
 * The Ride Board: a two-lane visual board of every ride (in progress + final)
 * with per-movement pixel score strips, and a detail view that renders the
 * judge's card VERBATIM plus a movement-profile bar chart.
 * Classic IIFE script; DR interface only; pixel.css tokens; zero deps.
 *
 * Scoring math mirrors server/reports.js EXACTLY:
 *   points   = Σ score×coefficient (movements + collectives)
 *   errors   : 1st −2, 2nd −4 more (−6 total), 3rd = elimination
 *   final %  = points / maxPoints × 100, rounded to 3 decimals
 *   running %: in-progress only — uses only the SCORED items' max.
 */
(function () {
  'use strict';
  var DR = window.DR;
  if (!DR || typeof DR.registerPage !== 'function') return;

  var POLL_MS = 20000;
  var BAR_H = 170;   // chart: pixel height of a 10.0 bar
  var XLAB_H = 24;   // chart: x-label band under the baseline

  /* ------------------------------------------------------------------ *
   *  State                                                             *
   * ------------------------------------------------------------------ */
  var S = {
    root: null, active: false, loaded: false,
    view: 'board',            // board | detail
    detailId: null,
    filters: { status: 'all', testId: '', q: '' },
    rides: [], tests: [], events: [],
    sel: null,                // selected movement num (string) in detail
    openDir: {},              // movement num -> directive expanded
    timer: 0, visBound: false,
    fp: ''                    // rides fingerprint (cheap change detection)
  };

  /* ------------------------------------------------------------------ *
   *  Tiny helpers                                                      *
   * ------------------------------------------------------------------ */
  function esc(s) { return DR.esc ? DR.esc(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function arr(res, key) {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res[key])) return res[key];
    return [];
  }
  function errMsg(e, fb) { return (e && (e.error || e.message)) || fb || 'Something stumbled — try again.'; }
  function div(cls, html) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function qs(el, sel) { return el.querySelector(sel); }
  function qsa(el, sel) { return Array.prototype.slice.call(el.querySelectorAll(sel)); }
  function fdate(d) {
    try { return DR.fmtDate ? DR.fmtDate(d) : String(d || ''); } catch (e) { return String(d || ''); }
  }
  function fmtS(v) { // 6.5 → "6½"
    if (v == null || typeof v !== 'number') return '—';
    return Number.isInteger(v) ? String(v) : (Math.floor(v) + '½');
  }
  function fmtNum(n) { return String(Math.round(n * 1000) / 1000); }
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function testById(id) {
    for (var i = 0; i < S.tests.length; i++) if (S.tests[i].id === id) return S.tests[i];
    return null;
  }
  function rideById(id) {
    for (var i = 0; i < S.rides.length; i++) if (S.rides[i].id === id) return S.rides[i];
    return null;
  }

  /* Quick-note phrase → group ('praise'|'faults'|'geometry') lookup */
  var QN = null;
  function qnMap() {
    if (QN) return QN;
    QN = {};
    var q = (window.DR_DEFAULTS && window.DR_DEFAULTS.quickNotes) || {};
    ['praise', 'faults', 'geometry'].forEach(function (g) {
      (q[g] || []).forEach(function (p) { QN[p] = g; });
    });
    return QN;
  }

  /* ------------------------------------------------------------------ *
   *  Scoring math — mirror of server/reports.js                        *
   * ------------------------------------------------------------------ */
  var FALLBACK_COLLECTIVES = [
    { key: 'gaits', name: 'Gaits', coefficient: 1 },
    { key: 'impulsion', name: 'Impulsion', coefficient: 1 },
    { key: 'submission', name: 'Submission', coefficient: 1 },
    { key: 'rider', name: 'Rider’s Position & Seat', coefficient: 1 }
  ];
  function collectiveDefs(test) {
    if (test && Array.isArray(test.collectives) && test.collectives.length) return test.collectives;
    var d = window.DR_DEFAULTS;
    if (d && Array.isArray(d.collectives) && d.collectives.length) return d.collectives;
    return FALLBACK_COLLECTIVES;
  }
  function num(v, fb) { var n = Number(v); return Number.isFinite(n) ? n : fb; }
  function errorPenalty(errors) { // 1st −2, 2nd −4 more (−6 total), 3rd = elimination
    var n = Math.max(0, Math.floor(num(errors, 0)));
    if (n >= 3) return { errors: n, deduction: 6, eliminated: true };
    return { errors: n, deduction: n === 0 ? 0 : n === 1 ? 2 : 6, eliminated: false };
  }
  function lookupScore(bag, key) {
    if (!bag || typeof bag !== 'object') return null;
    var s = bag[key] != null ? bag[key] : bag[String(key)];
    if (!s || s.score == null || s.score === '') return null;
    var n = Number(s.score);
    return Number.isFinite(n) ? { score: n, note: String(s.note || '') } : null;
  }
  function scoreRide(ride, test) {
    var movements = (test && Array.isArray(test.movements)) ? test.movements : [];
    var rows = movements.map(function (m) {
      var coef = num(m.coefficient, 1);
      var s = lookupScore(ride.scores, m.num);
      return { num: m.num, name: String(m.name || ''), directive: String(m.directive || ''),
        coefficient: coef, score: s ? s.score : null, points: s ? s.score * coef : 0,
        max: 10 * coef, note: s ? s.note : '' };
    });
    var colRows = collectiveDefs(test).map(function (c) {
      var coef = num(c.coefficient, 1);
      var s = lookupScore(ride.collectives, c.key);
      return { key: c.key, name: String(c.name || c.key), directive: String(c.directive || ''),
        coefficient: coef, score: s ? s.score : null, points: s ? s.score * coef : 0,
        max: 10 * coef, note: s ? s.note : '' };
    });
    var subtotal = 0, maxPoints = 0, scoredPts = 0, scoredMax = 0, scoredN = 0;
    rows.concat(colRows).forEach(function (r) {
      subtotal += r.points; maxPoints += r.max;
      if (r.score != null) { scoredPts += r.points; scoredMax += r.max; scoredN++; }
    });
    var pen = errorPenalty(ride.errors);
    var totalPoints = Math.max(0, subtotal - pen.deduction);
    var pct = maxPoints > 0 ? Math.round((totalPoints * 100 / maxPoints) * 1000) / 1000 : 0;
    // running % (in-progress): only the scored items' max counts
    var runPts = Math.max(0, scoredPts - pen.deduction);
    var runningPct = scoredMax > 0 ? Math.round((runPts * 100 / scoredMax) * 1000) / 1000 : 0;
    return {
      rows: rows, colRows: colRows, subtotal: subtotal, maxPoints: maxPoints,
      errors: pen.errors, deduction: pen.deduction, eliminated: pen.eliminated,
      totalPoints: totalPoints, pct: pct, pctStr: pct.toFixed(3),
      finalLabel: pen.eliminated ? 'ELIMINATED' : pct.toFixed(3) + '%',
      scoredN: scoredN, totalN: rows.length + colRows.length,
      scoredMovN: rows.filter(function (r) { return r.score != null; }).length,
      movN: rows.length,
      runningPct: runningPct
    };
  }

  /* score band: <5 red · 5–6.5 gold · ≥7 green (10 sparkles). Never color-only. */
  function bandVar(score) {
    if (score == null) return null;
    if (score < 5) return '--red';
    if (score < 7) return '--gold';
    return '--green';
  }
  function bandName(score) {
    if (score == null) return 'unscored';
    if (score < 5) return 'below 5';
    if (score < 7) return 'fair (5–6½)';
    return 'good (7+)';
  }

  function medalPun(sc) {
    if (sc.eliminated) return 'Eliminated — even Valegro had off days. Chin up, heels down.';
    var p = sc.pct;
    if (p >= 75) return '🥇 Gold-ribbon country — passage-ional riding!';
    if (p >= 70) return '🥈 Unbridled brilliance — the judge tips her helmet.';
    if (p >= 65) return '🥉 A lovely, harmonious test. Mane character energy.';
    if (p >= 60) return '🎀 Solid, obedient work — canter believe the progress!';
    if (p >= 50) return 'Green but game — hay, nice moments in there!';
    return 'A schooling day. Every grand prix horse started somewhere.';
  }

  /* ------------------------------------------------------------------ *
   *  Scoped styles (pixel.css tokens only)                             *
   * ------------------------------------------------------------------ */
  var CSS = [
    '.rb{max-width:960px;margin:0 auto;font-family:var(--font-body);font-size:19px;}',
    '.rb .dim{color:var(--ink-dim);}',
    /* ---- filter row (one row, scopes everything below it) ---- */
    '.rb-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px;}',
    '.rb-filters .chip{min-height:40px;}',
    '.rb-filters .select{width:auto;min-width:130px;max-width:46vw;flex:0 1 auto;min-height:40px;font-size:18px;padding:4px 30px 4px 10px;}',
    '.rb-search{flex:1 1 150px;min-width:120px;min-height:40px;font-size:18px;padding:4px 10px;}',
    /* ---- lanes ---- */
    '.rb-lane{margin-bottom:16px;padding:12px;}',
    '.rb-lanetag{display:flex;align-items:center;gap:8px;font-family:var(--font-pix);font-size:12px;color:var(--brand);margin:0 0 10px;flex-wrap:wrap;}',
    '.rb-lanetag .badge{font-size:8px;}',
    '.rb-live{margin-left:auto;font-family:var(--font-body);font-size:15px;color:var(--ink-dim);}',
    '.rb-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}',
    '.rb-card{display:block;width:100%;text-align:left;background:var(--panel-2);color:var(--ink);border:3px solid var(--line);box-shadow:4px 4px 0 var(--shadow);padding:10px 12px;cursor:pointer;font-family:var(--font-body);min-width:0;}',
    '.rb-card:hover{background:var(--panel);}',
    '.rb-card:active{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--shadow);}',
    '.rb-who{font-size:22px;line-height:1.1;overflow-wrap:anywhere;}',
    '.rb-who b{color:var(--brand);}',
    '.rb-who .on{color:var(--ink-dim);font-size:17px;}',
    '.rb-sub{font-size:16px;color:var(--ink-dim);margin-top:2px;overflow-wrap:anywhere;}',
    /* compact score strip: one pixel bar per movement, baseline-anchored */
    '.rb-strip{display:flex;align-items:flex-end;gap:2px;height:32px;margin:10px 0 6px;padding-bottom:2px;border-bottom:2px solid var(--line);overflow:hidden;}',
    '.rb-strip i{display:block;width:6px;flex:0 0 auto;}',
    '.rb-strip i.c2{width:13px;}',
    '.rb-strip i.un{background:transparent;border:1px dashed var(--ink-dim);height:8px !important;}',
    '.rb-cardfoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;}',
    '.rb-cardpct{font-family:var(--font-pix);font-size:13px;}',
    '.rb-cardrun{font-size:16px;color:var(--ink-dim);}',
    /* ---- detail: header ---- */
    '.rb-back{margin:0 0 12px;}',
    '.rb-head{padding:14px;margin-bottom:14px;}',
    '.rb-headtop{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;}',
    '.rb-headwho{min-width:0;flex:1 1 220px;}',
    '.rb-headwho h2{margin:0 0 4px;}',
    '.rb-bigpct{text-align:right;flex:0 0 auto;}',
    '.rb-bigpct .n{font-family:var(--font-pix);font-size:30px;color:var(--brand);text-shadow:2px 2px 0 var(--shadow);display:block;line-height:1.2;}',
    '.rb-bigpct .n.elim{color:var(--red);}',
    '.rb-bigpct .lbl{font-family:var(--font-pix);font-size:8px;color:var(--ink-dim);letter-spacing:1px;}',
    '.rb-headmeta{font-size:18px;color:var(--ink-dim);margin-top:2px;}',
    '.rb-errmath{margin-top:8px;font-size:18px;border-top:2px dashed color-mix(in srgb,var(--line) 40%,transparent);padding-top:8px;}',
    '.rb-errmath b.bad{color:var(--red);}',
    '.rb-pun{margin-top:6px;font-size:19px;color:var(--brand);}',
    '.rb-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}',
    /* ---- chart card ---- */
    '.rb-chartcard{padding:12px;margin-bottom:14px;}',
    '.rb-charttag{font-family:var(--font-pix);font-size:11px;color:var(--brand);margin:0 0 4px;}',
    '.rb-legend{display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:16px;color:var(--ink-dim);margin:2px 0 8px;}',
    '.rb-legend i{width:10px;height:10px;display:inline-block;vertical-align:-1px;margin-right:4px;border:1px solid var(--line);}',
    '.rb-legend i.hollow{background:transparent;border:1px dashed var(--ink-dim);}',
    '.rb-chartouter{display:flex;align-items:flex-start;}',
    '.rb-yaxis{position:relative;flex:0 0 26px;width:26px;height:' + (18 + BAR_H + XLAB_H) + 'px;}',
    '.rb-ylab{position:absolute;right:5px;font-family:var(--font-pix);font-size:9px;color:var(--ink-dim);transform:translateY(-50%);pointer-events:none;}',
    '.rb-chartwrap{flex:1 1 auto;min-width:0;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;}',
    '.rb-chart{position:relative;display:inline-flex;align-items:flex-end;gap:6px;min-width:100%;height:' + (18 + BAR_H + XLAB_H) + 'px;padding:0 6px;}',
    '.rb-grid{position:absolute;left:0;right:0;height:0;border-top:1px solid color-mix(in srgb,var(--ink-dim) 45%,transparent);pointer-events:none;}',
    '.rb-grid.axis{border-top:2px solid var(--line);}',
    '.rb-col{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;width:34px;flex:0 0 auto;background:none;border:none;padding:0 0 ' + XLAB_H + 'px;cursor:pointer;font-family:var(--font-body);color:var(--ink);}',
    '.rb-col.c2{width:62px;}',
    '.rb-col .rb-val{font-family:var(--font-pix);font-size:10px;line-height:1;margin-bottom:3px;white-space:nowrap;}',
    '.rb-col .rb-val .spark{color:var(--gold);text-shadow:1px 1px 0 var(--line);}',
    '.rb-col .rb-bar{width:22px;border:2px solid var(--line);border-bottom:none;box-shadow:2px 0 0 var(--shadow);}',
    '.rb-col.c2 .rb-bar{width:48px;}',
    '.rb-col.un .rb-bar{background:transparent;border:2px dashed var(--ink-dim);box-shadow:none;opacity:.7;}',
    '.rb-col .rb-x{position:absolute;bottom:2px;left:0;right:0;text-align:center;font-family:var(--font-pix);font-size:9px;color:var(--ink-dim);line-height:1.1;}',
    '.rb-col .rb-x .x2{display:block;font-size:7px;color:var(--brand);}',
    '.rb-col.sel{background:color-mix(in srgb,var(--gold) 18%,transparent);outline:3px solid var(--gold);outline-offset:-1px;}',
    '.rb-col:focus-visible{outline:3px solid var(--focus);outline-offset:1px;}',
    /* distribution + callouts */
    '.rb-dist{margin-top:10px;border-top:2px dashed color-mix(in srgb,var(--line) 40%,transparent);padding-top:10px;}',
    '.rb-disttag{font-family:var(--font-pix);font-size:9px;color:var(--ink-dim);margin-bottom:6px;letter-spacing:.5px;}',
    '.rb-distbar{display:flex;gap:2px;height:16px;border:2px solid var(--line);padding:1px;background:var(--panel);}',
    '.rb-distbar i{display:block;height:100%;min-width:4px;}',
    '.rb-distcap{font-size:16px;color:var(--ink-dim);margin-top:5px;}',
    '.rb-callouts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-top:10px;}',
    '.rb-callout{display:block;width:100%;text-align:left;background:var(--panel-2);color:var(--ink);border:2px solid var(--line);box-shadow:2px 2px 0 var(--shadow);padding:8px 10px;font-family:var(--font-body);font-size:17px;cursor:pointer;min-width:0;}',
    '.rb-callout:active{transform:translate(1px,1px);box-shadow:1px 1px 0 var(--shadow);}',
    '.rb-callout .t{font-family:var(--font-pix);font-size:8px;color:var(--ink-dim);display:block;margin-bottom:3px;letter-spacing:.5px;}',
    /* ---- judge's card (verbatim) ---- */
    '.rb-sheet{padding:12px;margin-bottom:14px;}',
    '.rb-sheettag{font-family:var(--font-pix);font-size:11px;color:var(--brand);margin:0 0 8px;}',
    '.rb-mrow{border-bottom:2px dashed color-mix(in srgb,var(--line) 45%,transparent);padding:2px 0 8px;scroll-margin:90px;}',
    '.rb-mrow:last-child{border-bottom:none;padding-bottom:2px;}',
    '.rb-mrow.sel{background:color-mix(in srgb,var(--gold) 16%,transparent);outline:3px solid var(--gold);outline-offset:-2px;}',
    '.rb-mtop{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:none;padding:8px 2px 4px;min-height:44px;cursor:pointer;color:var(--ink);font-family:var(--font-body);}',
    '.rb-mnum{flex:0 0 auto;min-width:26px;font-family:var(--font-pix);font-size:11px;color:var(--ink-dim);}',
    '.rb-mname{flex:1 1 auto;min-width:0;font-size:19px;line-height:1.12;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}',
    '.rb-mcoef{flex:0 0 auto;}',
    '.rb-msc{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;font-family:var(--font-pix);font-size:16px;min-width:44px;justify-content:flex-end;}',
    '.rb-msc .rb-dot{width:9px;height:9px;display:inline-block;border:1px solid var(--line);}',
    '.rb-msc .rb-dot.hollow{background:transparent;border-style:dashed;border-color:var(--ink-dim);}',
    '.rb-msc .spark{color:var(--gold);text-shadow:1px 1px 0 var(--line);font-size:12px;}',
    '.rb-dirbtn{flex:0 0 auto;min-width:34px;min-height:34px;padding:0;font-size:12px;}',
    '.rb-dir{font-size:17px;color:var(--ink-dim);padding:0 2px 6px 34px;line-height:1.2;}',
    '.rb-mnote{display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:0 2px 2px 34px;font-size:18px;line-height:1.25;}',
    '.rb-mnote .chip{min-height:30px;font-size:16px;cursor:default;box-shadow:none;padding:1px 8px;}',
    '.rb-mnote .chip:active{transform:none;}',
    '.rb-chip-praise{border-color:var(--green);}',
    '.rb-chip-faults{border-color:var(--red);}',
    '.rb-chip-geometry{border-color:var(--blue);}',
    '.rb-freetext{overflow-wrap:anywhere;}',
    '.rb-dash{color:var(--ink-dim);}',
    '.rb-totals{margin-top:8px;border-top:3px solid var(--line);padding-top:8px;font-size:18px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;}',
    '.rb-totals b{font-family:var(--font-pix);font-size:12px;}',
    /* remarks */
    '.rb-remarks{padding:12px;margin-bottom:14px;}',
    '.rb-remarks p{font-size:20px;margin:0;overflow-wrap:anywhere;white-space:pre-wrap;}',
    /* 390px comfort */
    '@media (max-width:430px){',
    '  .rb-cards{grid-template-columns:1fr;}',
    '  .rb-bigpct{text-align:left;}',
    '  .rb-mnote,.rb-dir{padding-left:2px;}',
    '}'
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById('rb-style')) return;
    var st = document.createElement('style');
    st.id = 'rb-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------------ *
   *  Data + polling (visibility-aware, 20s)                            *
   * ------------------------------------------------------------------ */
  function fingerprint(rides) {
    return rides.map(function (r) { return r.id + ':' + (r.updatedAt || 0) + ':' + r.status; }).join('|');
  }
  function loadAll() {
    return Promise.all([
      DR.api('GET', '/api/rides'),
      DR.api('GET', '/api/tests'),
      DR.api('GET', '/api/events').catch(function () { return []; })
    ]).then(function (res) {
      S.rides = arr(res[0], 'rides');
      S.tests = arr(res[1], 'tests');
      S.events = arr(res[2], 'events');
      S.fp = fingerprint(S.rides);
      S.loaded = true;
    });
  }
  function pollTick() {
    if (!S.active || document.visibilityState !== 'visible') return;
    DR.api('GET', '/api/rides').then(function (res) {
      if (!S.active) return;
      var rides = arr(res, 'rides');
      var fp = fingerprint(rides);
      if (fp === S.fp) return;          // nothing moved — no repaint, no scroll jump
      S.rides = rides;
      S.fp = fp;
      draw(true);
    }).catch(function () { /* transient — next tick retries */ });
  }
  function onVis() { if (document.visibilityState === 'visible') pollTick(); }
  function startPoll() {
    stopPoll();
    S.timer = setInterval(pollTick, POLL_MS);
    if (!S.visBound) { document.addEventListener('visibilitychange', onVis); S.visBound = true; }
  }
  function stopPoll() {
    if (S.timer) { clearInterval(S.timer); S.timer = 0; }
    if (S.visBound) { document.removeEventListener('visibilitychange', onVis); S.visBound = false; }
  }

  /* ------------------------------------------------------------------ *
   *  Shared bits                                                       *
   * ------------------------------------------------------------------ */
  function stripHTML(ride, test) {
    var movements = (test && test.movements) || [];
    if (!movements.length) return '';
    var html = '<div class="rb-strip" aria-hidden="true">';
    movements.forEach(function (m) {
      var s = lookupScore(ride.scores, m.num);
      var c2 = num(m.coefficient, 1) > 1 ? ' c2' : '';
      if (!s) { html += '<i class="un' + c2 + '"></i>'; return; }
      var h = Math.max(2, Math.round(s.score / 10 * 30));
      html += '<i class="' + c2.trim() + '" style="height:' + h + 'px;background:var(' + bandVar(s.score) + ')"></i>';
    });
    return html + '</div>';
  }

  function noteHTML(note) {
    if (!note) return '<span class="rb-dash">—</span>';
    var map = qnMap();
    var parts = String(note).split(/,\s*/);
    var html = '', buf = [];
    function flushBuf() {
      if (buf.length) { html += '<span class="rb-freetext">' + esc(buf.join(', ')) + '</span>'; buf = []; }
    }
    parts.forEach(function (p) {
      var g = map[p];
      if (g) { flushBuf(); html += '<span class="chip rb-chip-' + g + '">' + esc(p) + '</span>'; }
      else buf.push(p);
    });
    flushBuf();
    return html;
  }

  function statusBadge(ride, sc) {
    if (ride.status === 'final') {
      return sc.eliminated ? '<span class="badge red">ELIMINATED</span>' : '<span class="badge green">FINAL</span>';
    }
    return '<span class="badge gold">IN THE ARENA</span>';
  }

  /* ------------------------------------------------------------------ *
   *  Board view                                                        *
   * ------------------------------------------------------------------ */
  function matchesFilters(r) {
    var f = S.filters;
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.testId && r.testId !== f.testId) return false;
    if (f.q) {
      var q = f.q.toLowerCase();
      var hay = ((r.rider || '') + ' ' + (r.horse || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function cardHTML(r) {
    var t = testById(r.testId);
    var sc = scoreRide(r, t);
    var foot, aria;
    if (r.status === 'final') {
      var pctTxt = sc.eliminated ? 'ELIM' : ((typeof r.finalPct === 'number' ? r.finalPct.toFixed(3) : sc.pctStr) + '%');
      foot = '<span class="rb-cardpct" style="color:var(' + (sc.eliminated ? '--red' : '--brand') + ')">' + esc(pctTxt) + '</span>' + statusBadge(r, sc);
      aria = 'final score ' + pctTxt;
    } else {
      foot = '<span class="rb-cardrun">' + sc.scoredN + '/' + sc.totalN + ' scored · <b>running ' +
        sc.runningPct.toFixed(1) + '%</b></span>' + statusBadge(r, sc);
      aria = sc.scoredN + ' of ' + sc.totalN + ' scored, running ' + sc.runningPct.toFixed(1) + ' percent';
    }
    return '<button type="button" class="rb-card" data-open="' + esc(r.id) + '" aria-label="' +
      esc((r.rider || '?') + ' on ' + (r.horse || '?') + ', ' + (t ? (t.shortName || t.name) : r.testId) + ', ' + aria) + '">' +
      '<div class="rb-who"><b>' + esc(r.rider || '?') + '</b> <span class="on">on</span> ' + esc(r.horse || '?') + '</div>' +
      '<div class="rb-sub">' + esc((t ? (t.shortName || t.name) : r.testId) + ' · ' + fdate(r.date || r.updatedAt)) +
      (r.judgeName ? ' · ' + esc(r.judgeName) : '') + '</div>' +
      stripHTML(r, t) +
      '<div class="rb-cardfoot">' + foot + '</div></button>';
  }

  function laneHTML(tag, rides, emptyMsg, live) {
    var html = '<section class="panel rb-lane"><div class="rb-lanetag"><span>' + tag + '</span>' +
      '<span class="badge">' + rides.length + '</span>' +
      (live ? '<span class="rb-live">📡 refreshes every 20s</span>' : '') + '</div>';
    if (!rides.length) html += '<p class="dim" style="margin:0;">' + emptyMsg + '</p>';
    else html += '<div class="rb-cards">' + rides.map(cardHTML).join('') + '</div>';
    return html + '</section>';
  }

  function lanesHTML() {
    var inProg = S.rides.filter(function (r) { return r.status === 'in-progress' && matchesFilters(r); })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    var finals = S.rides.filter(function (r) { return r.status === 'final' && matchesFilters(r); })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    var filtered = S.filters.q || S.filters.testId;
    var html = '';
    if (S.filters.status !== 'final') {
      html += laneHTML('🏇 IN THE ARENA', inProg,
        filtered ? 'No rides in progress match — loosen the reins on those filters.'
                 : 'No rides underway — the arena is freshly dragged.', true);
    }
    if (S.filters.status !== 'in-progress') {
      html += laneHTML('🏆 FINAL SALUTES', finals,
        filtered ? 'No finished tests match those filters.'
                 : 'No signed tests yet — the first salute is still to come.', false);
    }
    return html;
  }

  function wireLanes(box) {
    qsa(box, '[data-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.detailId = b.getAttribute('data-open');
        S.view = 'detail';
        S.sel = null;
        S.openDir = {};
        draw();
      });
    });
  }

  function drawBoard() {
    var wrap = div('rb');
    var testOpts = '<option value="">All tests</option>' + S.tests.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (S.filters.testId === t.id ? ' selected' : '') + '>' +
        esc(t.shortName || t.name) + '</option>';
    }).join('');
    var chips = [
      { k: 'all', label: 'All' },
      { k: 'in-progress', label: '🏇 In the arena' },
      { k: 'final', label: '🏆 Final salutes' }
    ].map(function (c) {
      return '<button type="button" class="chip' + (S.filters.status === c.k ? ' on' : '') +
        '" data-status="' + c.k + '" aria-pressed="' + (S.filters.status === c.k) + '">' + c.label + '</button>';
    }).join('');

    wrap.innerHTML = '<h2 class="h-pix">Ride Board</h2>' +
      '<div class="rb-filters">' + chips +
      '<select class="select" data-test aria-label="Filter by test">' + testOpts + '</select>' +
      '<input class="input rb-search" data-q type="search" placeholder="🔍 rider or horse…" ' +
      'aria-label="Search rider or horse" value="' + esc(S.filters.q) + '">' +
      '</div><div id="rb-lanes">' + lanesHTML() + '</div>';

    qsa(wrap, '[data-status]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.filters.status = b.getAttribute('data-status');
        qsa(wrap, '[data-status]').forEach(function (x) {
          var on = x.getAttribute('data-status') === S.filters.status;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', String(on));
        });
        repaintLanes(wrap);
      });
    });
    qs(wrap, '[data-test]').addEventListener('change', function (e) {
      S.filters.testId = e.target.value;
      repaintLanes(wrap);
    });
    qs(wrap, '[data-q]').addEventListener('input', function (e) {
      S.filters.q = e.target.value;
      repaintLanes(wrap);
    });
    S.root.appendChild(wrap);
  }
  function repaintLanes(wrap) {
    var box = qs(wrap, '#rb-lanes');
    box.innerHTML = lanesHTML();
    wireLanes(box);
  }

  /* ------------------------------------------------------------------ *
   *  Detail view                                                       *
   * ------------------------------------------------------------------ */
  function headHTML(ride, test, sc) {
    var isFinal = ride.status === 'final';
    var pctBlock;
    if (isFinal) {
      var pctTxt = sc.eliminated ? 'ELIM' : ((typeof ride.finalPct === 'number' ? ride.finalPct.toFixed(3) : sc.pctStr) + '%');
      pctBlock = '<span class="n' + (sc.eliminated ? ' elim' : '') + '">' + esc(pctTxt) + '</span>' +
        '<span class="lbl">FINAL SCORE</span>';
    } else {
      pctBlock = '<span class="n">' + sc.runningPct.toFixed(1) + '%</span>' +
        '<span class="lbl">RUNNING · ' + sc.scoredN + '/' + sc.totalN + ' SCORED</span>';
    }
    var errLine;
    if (sc.errors === 0) errLine = 'No errors of course — a clean round.';
    else if (sc.errors === 1) errLine = '1 error of course: <b class="bad">−2 pts</b>';
    else if (sc.errors === 2) errLine = '2 errors of course: <b class="bad">−2 −4 = −6 pts</b>';
    else errLine = sc.errors + ' errors of course: <b class="bad">−2 −4 · third = ELIMINATION</b>';
    var ptsLine = isFinal
      ? fmtNum(sc.totalPoints) + ' / ' + fmtNum(sc.maxPoints) + ' pts'
      : fmtNum(sc.subtotal) + ' pts so far (running % counts only scored marks)';

    return '<header class="panel rb-head"><div class="rb-headtop">' +
      '<div class="rb-headwho"><h2>' + esc(ride.rider || '?') + ' <span class="dim" style="font-family:var(--font-body);font-size:16px;">on</span> ' + esc(ride.horse || '?') + '</h2>' +
      '<div class="rb-headmeta">' + esc((test ? (test.name || test.shortName) : ride.testId)) + '</div>' +
      '<div class="rb-headmeta">' + esc(fdate(ride.date || ride.updatedAt)) +
      (ride.judgeName ? ' · Judge: ' + esc(ride.judgeName) : '') + ' · ' + statusBadge(ride, sc) + '</div></div>' +
      '<div class="rb-bigpct">' + pctBlock + '</div></div>' +
      '<div class="rb-errmath">' + errLine + ' <span class="dim">· ' + esc(ptsLine) + '</span></div>' +
      (isFinal ? '<div class="rb-pun">' + esc(medalPun(sc)) + '</div>' : '') +
      '<div class="rb-actions">' +
      (ride.status === 'in-progress'
        ? '<button type="button" class="btn btn-primary" data-resume>🏇 Resume scoring</button>' : '') +
      '<button type="button" class="btn" data-rep="html">📄 Report</button>' +
      '<button type="button" class="btn" data-rep="csv">📊 CSV</button>' +
      '</div></header>';
  }

  function chartHTML(sc) {
    // gridlines at 0 (axis), 5 and 7 — solid recessive hairlines
    var lines = '', ylabs = '';
    [{ v: 0, cls: 'axis' }, { v: 5, cls: '' }, { v: 7, cls: '' }, { v: 10, cls: '' }]
      .forEach(function (g) {
        var b = XLAB_H + Math.round(g.v / 10 * BAR_H);           // inside the scrolling chart
        var top = 18 + Math.round((10 - g.v) / 10 * BAR_H);      // on the fixed y-axis rail
        lines += '<span class="rb-grid ' + g.cls + '" style="bottom:' + b + 'px"></span>';
        ylabs += '<span class="rb-ylab" style="top:' + top + 'px">' + g.v + '</span>';
      });

    var cols = sc.rows.map(function (r) {
      var c2 = r.coefficient > 1;
      var un = r.score == null;
      var aria = 'Movement ' + r.num + ', ' + r.name + ', ' +
        (un ? 'not yet scored' : fmtNum(r.score) + ' of 10') +
        (c2 ? ', coefficient ' + r.coefficient : '');
      var h, bg, val;
      if (un) {
        h = BAR_H; bg = ''; val = '<span class="rb-dash">·</span>';
      } else {
        h = Math.max(4, Math.round(r.score / 10 * BAR_H));
        bg = 'background:var(' + bandVar(r.score) + ');';
        val = r.score === 10 ? '<span class="spark">✦</span>10' : esc(fmtS(r.score));
      }
      return '<button type="button" class="rb-col' + (c2 ? ' c2' : '') + (un ? ' un' : '') +
        (S.sel === String(r.num) ? ' sel' : '') + '" data-bar="' + esc(String(r.num)) +
        '" aria-label="' + esc(aria) + '" aria-pressed="' + (S.sel === String(r.num)) + '">' +
        '<span class="rb-val">' + val + '</span>' +
        '<span class="rb-bar" style="height:' + h + 'px;' + bg + '"></span>' +
        '<span class="rb-x">' + esc(String(r.num)) + (c2 ? '<span class="x2">×2</span>' : '') + '</span>' +
        '</button>';
    }).join('');

    // distribution across ALL marks (movements + collectives)
    var all = sc.rows.concat(sc.colRows);
    var nR = 0, nG = 0, nGr = 0, nTen = 0, nUn = 0;
    all.forEach(function (r) {
      if (r.score == null) { nUn++; return; }
      if (r.score === 10) nTen++;
      if (r.score < 5) nR++; else if (r.score < 7) nG++; else nGr++;
    });
    var total = Math.max(1, all.length);
    function seg(n, varName) {
      if (!n) return '';
      return '<i style="flex:' + n + ' ' + n + ' 0;background:var(' + varName + ')" title="' + n + '"></i>';
    }
    var distBar = seg(nR, '--red') + seg(nG, '--gold') + seg(nGr, '--green') +
      (nUn ? '<i style="flex:' + nUn + ' ' + nUn + ' 0;background:transparent;border:1px dashed var(--ink-dim)"></i>' : '');
    var capBits = [];
    if (nR) capBits.push(nR + ' below 5');
    if (nG) capBits.push(nG + ' fair (5–6½)');
    if (nGr) capBits.push(nGr + ' good (7+)');
    if (nTen) capBits.push(nTen + '× perfect ten ✦');
    if (nUn) capBits.push(nUn + ' unscored');
    var distCap = capBits.join(' · ') || 'no marks yet';

    // best / hardest movement callouts (movements only, scored only)
    var best = null, hard = null;
    sc.rows.forEach(function (r) {
      if (r.score == null) return;
      if (!best || r.score > best.score) best = r;
      if (!hard || r.score < hard.score) hard = r;
    });
    var callouts = '';
    if (best && hard) {
      callouts = '<div class="rb-callouts">' +
        '<button type="button" class="rb-callout" data-bar-jump="' + esc(String(best.num)) + '">' +
        '<span class="t">🏅 BEST MOVEMENT — ' + esc(fmtS(best.score)) + '</span>' +
        esc(best.num + '. ' + best.name) + '</button>' +
        (hard.num !== best.num
          ? '<button type="button" class="rb-callout" data-bar-jump="' + esc(String(hard.num)) + '">' +
            '<span class="t">🔨 HARDEST MOVEMENT — ' + esc(fmtS(hard.score)) + '</span>' +
            esc(hard.num + '. ' + hard.name) + '</button>'
          : '') +
        '</div>';
    }

    return '<section class="panel rb-chartcard"><h3 class="rb-charttag">MOVEMENT PROFILE</h3>' +
      '<div class="rb-legend" aria-hidden="true">' +
      '<span><i style="background:var(--red)"></i>below 5</span>' +
      '<span><i style="background:var(--gold)"></i>5–6½</span>' +
      '<span><i style="background:var(--green)"></i>7+</span>' +
      '<span><i style="background:var(--gold)"></i>✦ = 10</span>' +
      '<span><i class="hollow"></i>unscored</span>' +
      '<span>×2 = coefficient 2</span></div>' +
      '<div class="rb-chartouter">' +
      '<div class="rb-yaxis" aria-hidden="true">' + ylabs + '</div>' +
      '<div class="rb-chartwrap" tabindex="0" aria-label="Movement score chart, scrolls sideways">' +
      '<div class="rb-chart">' + lines + cols + '</div></div></div>' +
      '<p class="dim" style="font-size:16px;margin:4px 0 0;">Tap a bar to jump to the judge’s note.</p>' +
      '<div class="rb-dist"><div class="rb-disttag">SCORE DISTRIBUTION — ALL ' + all.length + ' MARKS</div>' +
      '<div class="rb-distbar" role="img" aria-label="Score distribution: ' + esc(distCap) + '">' + distBar + '</div>' +
      '<div class="rb-distcap">' + esc(distCap) + '</div></div>' +
      callouts + '</section>';
  }

  function scoreCellHTML(r) {
    var un = r.score == null;
    return '<span class="rb-msc">' +
      '<i class="rb-dot' + (un ? ' hollow' : '') + '"' +
      (un ? '' : ' style="background:var(' + bandVar(r.score) + ')"') +
      ' title="' + esc(bandName(r.score)) + '"></i>' +
      (un ? '<span class="rb-dash">—</span>'
          : (r.score === 10 ? '<span class="spark">✦</span>10' : esc(fmtS(r.score)))) + '</span>';
  }

  function movementRowHTML(r) {
    var numKey = String(r.num);
    var open = !!S.openDir[numKey];
    return '<div class="rb-mrow' + (S.sel === numKey ? ' sel' : '') + '" data-mrow="' + esc(numKey) + '">' +
      '<button type="button" class="rb-mtop" data-mtop="' + esc(numKey) + '" aria-label="' +
      esc('Movement ' + r.num + ', ' + (r.score == null ? 'not yet scored' : 'score ' + fmtNum(r.score)) +
        (r.coefficient > 1 ? ', coefficient ' + r.coefficient : '') + '. Highlights its bar in the chart.') + '">' +
      '<span class="rb-mnum">' + esc(String(r.num)) + '</span>' +
      '<span class="rb-mname">' + esc(r.name) + '</span>' +
      (r.coefficient > 1 ? '<span class="badge rb-mcoef">×' + r.coefficient + '</span>' : '') +
      scoreCellHTML(r) +
      (r.directive ? '<span class="btn btn-ghost rb-dirbtn" data-dir="' + esc(numKey) + '" role="button" ' +
        'aria-label="Show directive" aria-expanded="' + open + '">' + (open ? '▲' : '▼') + '</span>' : '') +
      '</button>' +
      (open && r.directive ? '<div class="rb-dir">' + esc(r.directive) + '</div>' : '') +
      '<div class="rb-mnote">' + noteHTML(r.note) + '</div></div>';
  }

  function collectiveRowHTML(r) {
    return '<div class="rb-mrow">' +
      '<div class="rb-mtop" style="cursor:default;">' +
      '<span class="rb-mnum">★</span>' +
      '<span class="rb-mname">' + esc(r.name) + '</span>' +
      (r.coefficient > 1 ? '<span class="badge rb-mcoef">×' + r.coefficient + '</span>' : '') +
      scoreCellHTML(r) + '</div>' +
      '<div class="rb-mnote">' + noteHTML(r.note) + '</div></div>';
  }

  function drawDetail() {
    var ride = rideById(S.detailId);
    if (!ride) {
      DR.toast('That ride has bolted from the roster.', 'err');
      S.view = 'board';
      drawBoard();
      return;
    }
    var test = testById(ride.testId);
    var sc = scoreRide(ride, test);
    var wrap = div('rb');

    var html = '<button type="button" class="btn btn-ghost rb-back" data-back>◀ Ride Board</button>';
    html += headHTML(ride, test, sc);
    html += chartHTML(sc);

    html += '<section class="panel rb-sheet"><h3 class="rb-sheettag">THE JUDGE’S CARD — VERBATIM</h3>' +
      sc.rows.map(movementRowHTML).join('') +
      '<div class="rb-totals"><span>Movements: ' +
      fmtNum(sc.rows.reduce(function (a, r) { return a + r.points; }, 0)) + ' / ' +
      fmtNum(sc.rows.reduce(function (a, r) { return a + r.max; }, 0)) + ' pts</span></div></section>';

    html += '<section class="panel rb-sheet"><h3 class="rb-sheettag">COLLECTIVE MARKS</h3>' +
      sc.colRows.map(collectiveRowHTML).join('') +
      '<div class="rb-totals"><span>Collectives: ' +
      fmtNum(sc.colRows.reduce(function (a, r) { return a + r.points; }, 0)) + ' / ' +
      fmtNum(sc.colRows.reduce(function (a, r) { return a + r.max; }, 0)) + ' pts</span>' +
      '<b>' + (ride.status === 'final'
        ? (sc.eliminated ? 'ELIMINATED' : 'TOTAL ' + fmtNum(sc.totalPoints) + '/' + fmtNum(sc.maxPoints) + ' → ' + sc.pctStr + '%')
        : 'RUNNING ' + sc.runningPct.toFixed(1) + '%') + '</b></div></section>';

    html += '<section class="panel rb-remarks"><h3 class="rb-sheettag">JUDGE’S REMARKS</h3>' +
      (ride.furtherRemarks
        ? '<p>' + esc(ride.furtherRemarks) + '</p>'
        : '<p class="rb-dash">— no further remarks —</p>') + '</section>';

    wrap.innerHTML = html;
    wireDetail(wrap, ride);
    S.root.appendChild(wrap);
  }

  function wireDetail(wrap, ride) {
    qs(wrap, '[data-back]').addEventListener('click', function () {
      S.view = 'board'; S.detailId = null; draw();
    });
    var resume = qs(wrap, '[data-resume]');
    if (resume) resume.addEventListener('click', function () { DR.navigate('judge'); });
    qsa(wrap, '[data-rep]').forEach(function (b) {
      b.addEventListener('click', function () {
        window.open('/api/report/ride/' + encodeURIComponent(ride.id) + '.' + b.getAttribute('data-rep'), '_blank');
      });
    });

    var smooth = reducedMotion() ? 'auto' : 'smooth';
    function applySel() {
      qsa(wrap, '[data-bar]').forEach(function (c) {
        var on = c.getAttribute('data-bar') === S.sel;
        c.classList.toggle('sel', on);
        c.setAttribute('aria-pressed', String(on));
      });
      qsa(wrap, '[data-mrow]').forEach(function (row) {
        row.classList.toggle('sel', row.getAttribute('data-mrow') === S.sel);
      });
    }
    function selectBar(key, scrollNote, scrollBar) {
      S.sel = (S.sel === key && !scrollBar && !scrollNote) ? null : key;
      applySel();
      if (S.sel == null) return;
      if (scrollNote) {
        var row = qs(wrap, '[data-mrow="' + S.sel + '"]');
        if (row) row.scrollIntoView({ block: 'center', behavior: smooth });
      }
      if (scrollBar) {
        var bar = qs(wrap, '[data-bar="' + S.sel + '"]');
        if (bar) bar.scrollIntoView({ block: 'nearest', inline: 'center', behavior: smooth });
      }
    }
    // bar tap → highlight + bring the note row into view
    qsa(wrap, '[data-bar]').forEach(function (c) {
      c.addEventListener('click', function () { selectBar(c.getAttribute('data-bar'), true, false); });
    });
    // note row tap → highlight + bring the bar into view (and vice versa)
    qsa(wrap, '[data-mtop]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        var dirBtn = e.target.closest && e.target.closest('[data-dir]');
        var key = b.getAttribute('data-mtop');
        if (dirBtn) { // directive disclosure, not selection
          S.openDir[key] = !S.openDir[key];
          var keepScroll = window.scrollY;
          draw(true);
          window.scrollTo(0, keepScroll);
          return;
        }
        selectBar(key, false, true);
      });
    });
    // best/hardest callouts jump both ways
    qsa(wrap, '[data-bar-jump]').forEach(function (b) {
      b.addEventListener('click', function () { selectBar(b.getAttribute('data-bar-jump'), true, true); });
    });
  }

  /* ------------------------------------------------------------------ *
   *  Draw                                                              *
   * ------------------------------------------------------------------ */
  function draw(preserveScroll) {
    if (!S.root || !S.active) return;
    ensureStyle();
    // keep the chart's own horizontal scroll across live repaints
    var oldWrap = qs(S.root, '.rb-chartwrap');
    var chartX = oldWrap ? oldWrap.scrollLeft : 0;
    S.root.innerHTML = '';
    if (!S.loaded) {
      var pun = (DR.loadingPun && DR.loadingPun()) || 'Braiding the mane…';
      S.root.appendChild(div('rb', '<p class="dim" style="text-align:center;margin-top:40px;">' + esc(pun) + '</p>'));
      return;
    }
    if (S.view === 'detail') drawDetail(); else drawBoard();
    if (S.view === 'board') wireLanes(S.root);
    if (preserveScroll && chartX) {
      var nw = qs(S.root, '.rb-chartwrap');
      if (nw) nw.scrollLeft = chartX;
    }
  }

  /* ------------------------------------------------------------------ *
   *  Page registration                                                 *
   * ------------------------------------------------------------------ */
  DR.registerPage('rides', {
    title: 'Rides',
    icon: 'assets/ribbon.svg',
    order: 25,
    roles: ['judge', 'admin'],
    render: function (el) {
      S.root = el;
      S.active = true;
      ensureStyle();
      draw(); // loading pun
      loadAll().then(function () {
        if (!S.active) return;
        draw();
        startPoll();
      }).catch(function (e) {
        if (!S.active) return;
        S.root.innerHTML = '';
        var p = div('rb');
        p.innerHTML = '<div class="panel" style="padding:16px;">' +
          '<p style="margin:0 0 10px;">The ride roster spooked and bolted (' + esc(errMsg(e)) + ').</p>' +
          '<button type="button" class="btn btn-primary" data-retry>🔄 Try again</button></div>';
        qs(p, '[data-retry]').addEventListener('click', function () { DR.navigate('rides'); });
        S.root.appendChild(p);
      });
    },
    onLeave: function () {
      S.active = false;
      S.root = null;
      stopPoll();
    }
  });
}());
