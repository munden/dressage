'use strict';
/**
 * Pixel Passage — reports.js
 * Print-ready pixel-branded ride scoresheets (HTML), spreadsheet-clean CSV,
 * emailed report digests, and schedule downloads (.ics / .html / .csv).
 *
 * Dressage math (authoritative):
 *   movement points   = score × coefficient        (scores 0..10 in 0.5 steps)
 *   collective points = score × coefficient
 *   errors of course  : 1st −2, 2nd −4 more (−6 total), 3rd = elimination
 *   final %           = points / maxPoints × 100, rounded to 3 decimals
 */

const smtp = require('./smtp');

/* ------------------------------------------------------------------ */
/* palette — §5 tokens are BINDING for ring colors                     */
/* ------------------------------------------------------------------ */

const RING = {
  A:      { color: '#3b6ea5', label: 'Ring A' },
  B:      { color: '#3e8948', label: 'Ring B' },
  warmup: { color: '#e8a33d', label: 'Warm-up' },
  clinic: { color: '#8d5bb9', label: 'Clinic' },
  other:  { color: '#c8433b', label: 'Other' }
};
const C = { // warm sand-arena theme
  bg: '#f6ecd7', panel: '#fdf6e8', panel2: '#f3e6c9', ink: '#33241a', dim: '#7c6a55',
  line: '#8a6a4a', brand: '#7a4a21', gold: '#e8a33d', green: '#3e8948', red: '#c8433b', blue: '#3b6ea5'
};

const PUNS = [
  'Straight from the horse\u2019s mouth.',
  'Every point accounted for \u2014 no foalin\u2019 around.',
  'Unbridled precision, to three decimals.',
  'Stable genius at work.',
  'Canter believe that trot!',
  'Hay \u2014 nice transitions out there.',
  'Mane character energy on the centerline.',
  'That halt? Square deal.',
  'Forward, straight, and fabulous.',
  'Piaffe-ction is a journey, not a destination.'
];
const PUNS_CALM = PUNS.slice(0, 4); // reined-in subset

function ringInfo(ring) { return RING[ring] || RING.other; }

function pickPun(ctx, seed) {
  let level = 'unbridled';
  try { level = ctx.db.get().settings.app.punLevel || 'unbridled'; } catch (e) { /* default */ }
  const list = level === 'reined-in' ? PUNS_CALM : PUNS;
  let h = 0;
  const s = String(seed || Date.now());
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

function showName(ctx) {
  try { return ctx.db.get().settings.app.showName || 'Donna Shar Dressage'; }
  catch (e) { return 'Donna Shar Dressage'; }
}

/* ------------------------------------------------------------------ */
/* tiny helpers                                                        */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(cells) { return cells.map(csvCell).join(','); }
function csvJoin(rows) { return '\uFEFF' + rows.join('\r\n') + '\r\n'; } // BOM helps Excel

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function parseDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function fmtDay(dateStr) {
  const d = parseDay(dateStr);
  if (!d) return String(dateStr || '');
  return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}
function fmtDayShort(dateStr) {
  const d = parseDay(dateStr);
  if (!d) return String(dateStr || '');
  return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + ', ' + d.getFullYear();
}
function fmtTs(ms) {
  const d = new Date(Number(ms) || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function validTime(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || '')); }

function num(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

/** Trim trailing zeros for display of scores/points (7 → "7", 7.5 → "7.5"). */
function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return String(Math.round(n * 1000) / 1000);
}

/* ------------------------------------------------------------------ */
/* defaults (shared/defaults.js is written by another agent — lazy)    */
/* ------------------------------------------------------------------ */

const FALLBACK_COLLECTIVES = [
  { key: 'gaits', name: 'Gaits', coefficient: 1 },
  { key: 'impulsion', name: 'Impulsion', coefficient: 1 },
  { key: 'submission', name: 'Submission', coefficient: 1 },
  { key: 'rider', name: 'Rider\u2019s Position & Seat', coefficient: 1 }
];

let _defaults; // undefined = untried, null = unavailable
function getDefaults() {
  if (_defaults === undefined) {
    try { _defaults = require('../shared/defaults.js'); }
    catch (e) { _defaults = null; }
  }
  return _defaults;
}

function collectiveDefs(test) {
  if (test && Array.isArray(test.collectives) && test.collectives.length) return test.collectives;
  const d = getDefaults();
  if (d && Array.isArray(d.collectives) && d.collectives.length) return d.collectives;
  return FALLBACK_COLLECTIVES;
}

/* ------------------------------------------------------------------ */
/* the dressage math                                                   */
/* ------------------------------------------------------------------ */

/** 1st error −2, 2nd error −4 more (−6 total), 3rd error = elimination. */
function errorPenalty(errors) {
  const n = Math.max(0, Math.floor(num(errors, 0)));
  if (n >= 3) return { errors: n, deduction: 6, eliminated: true };
  return { errors: n, deduction: n === 0 ? 0 : n === 1 ? 2 : 6, eliminated: false };
}

function lookupScore(bag, key) {
  if (!bag || typeof bag !== 'object') return null;
  const s = bag[key] != null ? bag[key] : bag[String(key)];
  if (!s || s.score == null || s.score === '') return null;
  const n = Number(s.score);
  return Number.isFinite(n) ? { score: n, note: String(s.note || '') } : null;
}

/**
 * Compute a full scoresheet for one ride against its test definition.
 * Returns rows for movements + collectives and the totals block.
 */
function scoreRide(ride, test) {
  const movements = (test && Array.isArray(test.movements)) ? test.movements : [];
  const rows = movements.map((m) => {
    const coef = num(m.coefficient, 1);
    const s = lookupScore(ride.scores, m.num);
    return {
      num: m.num, name: String(m.name || ''), directive: String(m.directive || ''),
      coefficient: coef,
      score: s ? s.score : null,
      points: s ? s.score * coef : 0,
      max: 10 * coef,
      note: s ? s.note : ''
    };
  });
  const colRows = collectiveDefs(test).map((c) => {
    const coef = num(c.coefficient, 1);
    const s = lookupScore(ride.collectives, c.key);
    return {
      key: c.key, name: String(c.name || c.key),
      coefficient: coef,
      score: s ? s.score : null,
      points: s ? s.score * coef : 0,
      max: 10 * coef,
      note: s ? s.note : ''
    };
  });

  const movementPoints = rows.reduce((a, r) => a + r.points, 0);
  const movementMax = rows.reduce((a, r) => a + r.max, 0);
  const collectivePoints = colRows.reduce((a, r) => a + r.points, 0);
  const collectiveMax = colRows.reduce((a, r) => a + r.max, 0);
  const subtotal = movementPoints + collectivePoints;
  const maxPoints = movementMax + collectiveMax;
  const pen = errorPenalty(ride.errors);
  const totalPoints = Math.max(0, subtotal - pen.deduction);
  const pct = maxPoints > 0 ? Math.round((totalPoints * 100 / maxPoints) * 1000) / 1000 : 0;

  return {
    rows, colRows,
    movementPoints, movementMax, collectivePoints, collectiveMax,
    subtotal, maxPoints,
    errors: pen.errors, deduction: pen.deduction, eliminated: pen.eliminated,
    totalPoints,
    pct,
    pctStr: pct.toFixed(3),
    finalLabel: pen.eliminated ? 'ELIMINATED' : pct.toFixed(3) + '%'
  };
}

/* ------------------------------------------------------------------ */
/* ride lookups                                                        */
/* ------------------------------------------------------------------ */

function getDb(ctx) { return ctx.db.get() || {}; }
function findRide(ctx, id) { return (getDb(ctx).rides || []).find((r) => r.id === id) || null; }
function findTest(ctx, id) { return (getDb(ctx).tests || []).find((t) => t.id === id) || null; }
function findEvent(ctx, id) { return (getDb(ctx).events || []).find((e) => e.id === id) || null; }

/* ------------------------------------------------------------------ */
/* ride CSV — spreadsheet-clean, uniform 7 columns                     */
/* ------------------------------------------------------------------ */

function rideCsv(ctx, ride, test) {
  const sc = scoreRide(ride, test);
  const ev = ride.eventId ? findEvent(ctx, ride.eventId) : null;
  const rows = [];
  const HEAD = ['Section', 'Item', 'Description', 'Coefficient', 'Score', 'Points', 'Remarks'];
  rows.push(csvRow(HEAD));
  const info = (item, desc) => rows.push(csvRow(['Info', item, desc, '', '', '', '']));
  info('Show', showName(ctx));
  info('Rider', ride.rider || '');
  info('Horse', ride.horse || '');
  info('Test', test ? (test.name || test.id) : ride.testId || '');
  if (test && test.level) info('Level', test.level);
  info('Judge', ride.judgeName || '');
  info('Date', ride.date || '');
  if (ev) info('Event', ev.title || '');
  info('Status', ride.status || '');
  for (const r of sc.rows) {
    rows.push(csvRow(['Movement', r.num, r.name, r.coefficient,
      r.score == null ? '' : r.score, fmtNum(r.points), r.note]));
  }
  for (const r of sc.colRows) {
    rows.push(csvRow(['Collective', r.name, '', r.coefficient,
      r.score == null ? '' : r.score, fmtNum(r.points), r.note]));
  }
  const sum = (item, desc, pts) => rows.push(csvRow(['Summary', item, desc, '', '', pts, '']));
  sum('Subtotal', 'movements + collectives', fmtNum(sc.subtotal));
  sum('Errors of course', sc.errors + (sc.eliminated ? ' (elimination)' : ''), sc.deduction ? '-' + fmtNum(sc.deduction) : '0');
  sum('Total points', '', fmtNum(sc.totalPoints));
  sum('Maximum points', '', fmtNum(sc.maxPoints));
  rows.push(csvRow(['Summary', 'Final score', sc.eliminated ? 'ELIMINATED' : sc.pctStr + '%', '', '', '', '']));
  if (ride.furtherRemarks) rows.push(csvRow(['Summary', 'Further remarks', ride.furtherRemarks, '', '', '', '']));
  return csvJoin(rows);
}

/* ------------------------------------------------------------------ */
/* shared pixel-print CSS (inline, zero external assets)               */
/* ------------------------------------------------------------------ */

function pixelCss() {
  return [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{background:' + C.bg + ';color:' + C.ink + ';font-family:"Courier New",Courier,monospace;',
    'font-size:15px;line-height:1.45;padding:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.sheet{max-width:860px;margin:0 auto}',
    '.panel{background:' + C.panel + ';border:3px solid ' + C.brand + ';box-shadow:6px 6px 0 rgba(122,74,33,.28);',
    'padding:14px 16px;margin-bottom:18px}',
    '.hdr{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between;',
    'border-bottom:3px solid ' + C.gold + ';padding-bottom:10px;margin-bottom:12px}',
    '.mark{font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:' + C.brand + ';font-size:20px}',
    '.mark .shoe{color:' + C.gold + '}',
    '.sub{color:' + C.line + ';font-size:13px;letter-spacing:1px;text-transform:uppercase}',
    '.badge{display:inline-block;border:2px solid ' + C.brand + ';background:' + C.gold + ';color:' + C.ink + ';',
    'padding:2px 8px;font-weight:bold;font-size:12px;letter-spacing:1px;text-transform:uppercase}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px 18px;margin:8px 0}',
    '.kv b{display:block;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:' + C.line + '}',
    'table{width:100%;border-collapse:collapse;margin:10px 0;background:' + C.panel + '}',
    'th{background:' + C.brand + ';color:#fff8ea;text-align:left;padding:6px 8px;font-size:12px;',
    'letter-spacing:1px;text-transform:uppercase;border:2px solid ' + C.brand + '}',
    'td{border:2px solid ' + C.line + ';padding:6px 8px;vertical-align:top}',
    'tr:nth-child(even) td{background:' + C.panel2 + '}',
    '.r{text-align:right;white-space:nowrap}.c{text-align:center;white-space:nowrap}',
    '.ten{background:' + C.gold + ' !important;font-weight:bold}',
    '.dir{color:' + C.line + ';font-size:13px}',
    '.total-line{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px dashed ' + C.line + '}',
    '.final{font-size:30px;font-weight:bold;color:' + C.brand + ';letter-spacing:2px}',
    '.final.elim{color:' + C.red + '}',
    '.gold{color:' + C.gold + '}.red{color:' + C.red + '}.green{color:' + C.green + '}',
    '.foot{text-align:center;color:' + C.line + ';font-size:13px;margin-top:14px}',
    '.pix{height:6px;background:repeating-linear-gradient(90deg,' + C.gold + ' 0 12px,' + C.brand + ' 12px 24px);',
    'border:2px solid ' + C.brand + ';margin:10px 0}',
    '.sig{display:flex;gap:30px;flex-wrap:wrap;margin-top:18px}',
    '.sig div{flex:1;min-width:200px;border-top:2px solid ' + C.ink + ';padding-top:4px;font-size:12px;',
    'text-transform:uppercase;letter-spacing:1px;color:' + C.line + '}',
    '.no-print{margin:0 auto 14px;max-width:860px;text-align:right}',
    '.no-print button{font:inherit;font-weight:bold;background:' + C.gold + ';border:3px solid ' + C.brand + ';',
    'padding:8px 14px;cursor:pointer;box-shadow:4px 4px 0 rgba(122,74,33,.28)}',
    '.no-print button:active{transform:translate(2px,2px);box-shadow:none}',
    '@page{margin:12mm}',
    '@media print{body{background:#fff;padding:0}.no-print{display:none}',
    '.panel{box-shadow:none}.day{page-break-inside:avoid}tr{page-break-inside:avoid}}'
  ].join('\n');
}

function headerHtml(ctx, subtitle) {
  return '<div class="hdr">' +
    '<div><div class="mark"><span class="shoe">\u2126</span> PIXEL PASSAGE</div>' +
    '<div class="sub">' + esc(showName(ctx)) + '</div></div>' +
    '<div class="badge">' + esc(subtitle) + '</div></div>';
}

/* ------------------------------------------------------------------ */
/* ride HTML — print-ready, pixel-branded                              */
/* ------------------------------------------------------------------ */

function rideHtml(ctx, ride, test) {
  const sc = scoreRide(ride, test);
  const ev = ride.eventId ? findEvent(ctx, ride.eventId) : null;
  const ring = ev ? ringInfo(ev.ring) : null;

  const kv = (k, v) => v ? '<div class="kv"><b>' + esc(k) + '</b>' + v + '</div>' : '';
  const meta =
    kv('Rider', esc(ride.rider)) +
    kv('Horse', esc(ride.horse)) +
    kv('Test', esc(test ? (test.name || test.id) : (ride.testId || '?'))) +
    kv('Level', test && test.level ? esc(test.level) : '') +
    kv('Arena', test && test.arena ? esc(test.arena === 'small' ? 'Small (20\u00d740m)' : 'Standard (20\u00d760m)') : '') +
    kv('Judge', esc(ride.judgeName)) +
    kv('Date', esc(fmtDayShort(ride.date) || ride.date)) +
    (ev ? kv('Event', esc(ev.title) +
      (ring ? ' <span style="display:inline-block;padding:1px 6px;border:2px solid ' + C.ink + ';background:' + ring.color + ';color:#fff8ea;font-size:11px;font-weight:bold">' + esc(ring.label) + '</span>' : '')) : '') +
    kv('Status', ride.status === 'final'
      ? '<span class="green"><b style="display:inline;color:' + C.green + '">\u2713 FINAL</b></span>'
      : '<span class="gold">In progress</span>');

  const mvRows = sc.rows.map((r) =>
    '<tr><td class="c">' + esc(r.num) + '</td>' +
    '<td>' + esc(r.name) + (r.directive ? '<div class="dir">' + esc(r.directive) + '</div>' : '') + '</td>' +
    '<td class="c">' + (r.coefficient !== 1 ? '\u00d7' + esc(r.coefficient) : '1') + '</td>' +
    '<td class="c' + (r.score === 10 ? ' ten' : '') + '">' + (r.score == null ? '\u2014' : esc(fmtNum(r.score))) + '</td>' +
    '<td class="r">' + esc(fmtNum(r.points)) + '</td>' +
    '<td>' + esc(r.note) + '</td></tr>').join('');

  const colRows = sc.colRows.map((r) =>
    '<tr><td colspan="2">' + esc(r.name) + '</td>' +
    '<td class="c">' + (r.coefficient !== 1 ? '\u00d7' + esc(r.coefficient) : '1') + '</td>' +
    '<td class="c' + (r.score === 10 ? ' ten' : '') + '">' + (r.score == null ? '\u2014' : esc(fmtNum(r.score))) + '</td>' +
    '<td class="r">' + esc(fmtNum(r.points)) + '</td>' +
    '<td>' + esc(r.note) + '</td></tr>').join('');

  const line = (k, v, cls) =>
    '<div class="total-line"><span>' + k + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';

  const totals =
    line('Movements (' + sc.rows.length + ')', esc(fmtNum(sc.movementPoints)) + ' / ' + esc(fmtNum(sc.movementMax))) +
    line('Collective marks', esc(fmtNum(sc.collectivePoints)) + ' / ' + esc(fmtNum(sc.collectiveMax))) +
    line('Errors of course (1st \u22122, 2nd \u22124, 3rd elim.)',
      sc.errors === 0 ? 'none' : esc(sc.errors + (sc.eliminated ? ' \u2014 ELIMINATED' : ' (\u2212' + fmtNum(sc.deduction) + ')')),
      sc.errors ? 'red' : 'green') +
    line('Total points', esc(fmtNum(sc.totalPoints)) + ' / ' + esc(fmtNum(sc.maxPoints))) +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:10px">' +
    '<span class="sub">Final score</span>' +
    '<span class="final' + (sc.eliminated ? ' elim' : '') + '">' + esc(sc.finalLabel) + '</span></div>';

  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Scoresheet \u2014 ' + esc(ride.rider || 'ride') + ' / ' + esc(ride.horse || '') + '</title>' +
    '<style>' + pixelCss() + '</style></head><body>' +
    '<div class="no-print"><button onclick="window.print()">\u{1F5A8} Print scoresheet</button></div>' +
    '<div class="sheet">' +
    '<div class="panel">' + headerHtml(ctx, 'Official Scoresheet') +
    '<div class="grid">' + meta + '</div></div>' +
    '<div class="panel"><table><thead><tr><th class="c">#</th><th>Movement &amp; directive</th>' +
    '<th class="c">Coef</th><th class="c">Score</th><th class="c">Points</th><th>Remarks</th></tr></thead>' +
    '<tbody>' + mvRows + '</tbody></table>' +
    '<div class="pix"></div>' +
    '<table><thead><tr><th colspan="2">Collective marks</th><th class="c">Coef</th>' +
    '<th class="c">Score</th><th class="c">Points</th><th>Remarks</th></tr></thead>' +
    '<tbody>' + colRows + '</tbody></table></div>' +
    '<div class="panel">' + totals + '</div>' +
    (ride.furtherRemarks
      ? '<div class="panel"><div class="sub" style="margin-bottom:6px">Further remarks</div>' + esc(ride.furtherRemarks) + '</div>'
      : '') +
    '<div class="panel"><div class="sig"><div>Judge\u2019s signature' +
    (ride.status === 'final' && ride.judgeName ? ' \u2014 signed digitally by ' + esc(ride.judgeName) : '') +
    '</div><div>Rider\u2019s signature</div></div></div>' +
    '<div class="foot">' + esc(pickPun(ctx, ride.id)) + '<br>Generated by Pixel Passage \u00b7 ' + esc(fmtTs(Date.now())) + '</div>' +
    '</div></body></html>';
}

/* ------------------------------------------------------------------ */
/* email digest (POST /api/report)                                     */
/* ------------------------------------------------------------------ */

function digestHtml(ctx, rides) {
  const blocks = rides.map((ride) => {
    const test = findTest(ctx, ride.testId);
    const sc = scoreRide(ride, test);
    const mvRows = sc.rows.map((r) =>
      '<tr><td class="c">' + esc(r.num) + '</td><td>' + esc(r.name) + '</td>' +
      '<td class="c">' + esc(r.coefficient) + '</td>' +
      '<td class="c">' + (r.score == null ? '\u2014' : esc(fmtNum(r.score))) + '</td>' +
      '<td class="r">' + esc(fmtNum(r.points)) + '</td><td>' + esc(r.note) + '</td></tr>').join('');
    const colRows = sc.colRows.map((r) =>
      '<tr><td class="c">\u2726</td><td>' + esc(r.name) + '</td>' +
      '<td class="c">' + esc(r.coefficient) + '</td>' +
      '<td class="c">' + (r.score == null ? '\u2014' : esc(fmtNum(r.score))) + '</td>' +
      '<td class="r">' + esc(fmtNum(r.points)) + '</td><td>' + esc(r.note) + '</td></tr>').join('');
    return '<div class="panel">' +
      '<div class="hdr"><div><div class="mark" style="font-size:16px">' + esc(ride.rider || '?') +
      ' <span class="shoe">\u2666</span> ' + esc(ride.horse || '?') + '</div>' +
      '<div class="sub">' + esc(test ? (test.name || test.id) : ride.testId || '') +
      ' \u00b7 ' + esc(fmtDayShort(ride.date) || '') + ' \u00b7 Judge: ' + esc(ride.judgeName || '\u2014') + '</div></div>' +
      '<div class="final' + (sc.eliminated ? ' elim' : '') + '" style="font-size:22px">' + esc(sc.finalLabel) + '</div></div>' +
      '<table><thead><tr><th class="c">#</th><th>Movement</th><th class="c">Coef</th>' +
      '<th class="c">Score</th><th class="c">Points</th><th>Remarks</th></tr></thead>' +
      '<tbody>' + mvRows + colRows + '</tbody></table>' +
      '<div class="total-line"><span>Errors: ' + sc.errors +
      (sc.deduction ? ' (\u2212' + fmtNum(sc.deduction) + ')' : '') + '</span>' +
      '<b>Total ' + esc(fmtNum(sc.totalPoints)) + ' / ' + esc(fmtNum(sc.maxPoints)) + '</b></div>' +
      (ride.furtherRemarks ? '<p style="margin-top:8px"><b>Remarks:</b> ' + esc(ride.furtherRemarks) + '</p>' : '') +
      '<details style="margin-top:10px"><summary style="cursor:pointer">CSV (copy into a spreadsheet)</summary>' +
      '<pre style="overflow:auto;background:' + C.panel2 + ';border:2px solid ' + C.line + ';padding:8px;font-size:12px">' +
      esc(rideCsv(ctx, ride, test).replace(/^\uFEFF/, '')) + '</pre></details>' +
      '</div>';
  }).join('');

  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>' +
    esc(showName(ctx)) + ' \u2014 scoresheets</title><style>' + pixelCss() + '</style></head><body>' +
    '<div class="sheet">' +
    '<div class="panel">' + headerHtml(ctx, 'Ride Report \u00d7 ' + rides.length) +
    '<div class="sub">Sent from the judge\u2019s booth \u00b7 ' + esc(fmtTs(Date.now())) + '</div></div>' +
    blocks +
    '<div class="foot">' + esc(pickPun(ctx, rides.map((r) => r.id).join(','))) + '<br>Pixel Passage \u00b7 ' + esc(showName(ctx)) + '</div>' +
    '</div></body></html>';
}

function digestText(ctx, rides) {
  const out = [showName(ctx) + ' — ride scoresheets', ''];
  for (const ride of rides) {
    const test = findTest(ctx, ride.testId);
    const sc = scoreRide(ride, test);
    out.push('=== ' + (ride.rider || '?') + ' on ' + (ride.horse || '?') + ' — ' +
      (test ? (test.name || test.id) : ride.testId || '') + ' (' + (ride.date || '') + ')');
    out.push('Final: ' + sc.finalLabel + '  (' + fmtNum(sc.totalPoints) + '/' + fmtNum(sc.maxPoints) +
      ' pts, errors: ' + sc.errors + ')');
    out.push('');
    out.push(rideCsv(ctx, ride, test).replace(/^\uFEFF/, '').trimEnd());
    out.push('');
  }
  out.push(pickPun(ctx, rides.map((r) => r.id).join(',')));
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* schedule: shared event collection                                   */
/* ------------------------------------------------------------------ */

function allEvents(ctx) {
  const evs = (getDb(ctx).events || []).slice();
  evs.sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')) ||
    String(a.start || '').localeCompare(String(b.start || '')) ||
    String(a.title || '').localeCompare(String(b.title || '')));
  return evs;
}

/* ------------------------------------------------------------------ */
/* /api/schedule.ics — RFC 5545: CRLF, folding, escaping               */
/* ------------------------------------------------------------------ */

function icsEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets; continuations begin with a space. */
function icsFold(line) {
  let out = '', cur = '', bytes = 0, max = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > max) { out += cur + '\r\n '; cur = ''; bytes = 1; max = 75; }
    cur += ch; bytes += b;
  }
  return out + cur;
}

function icsStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}

function scheduleIcs(ctx) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pixel Passage//Dressage Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEscape(showName(ctx) + ' — schedule')
  ];
  const stamp = icsStamp(new Date());
  for (const ev of allEvents(ctx)) {
    const day = parseDay(ev.date);
    if (!day) continue;
    const ymd = String(ev.date).replace(/-/g, '');
    const ring = ringInfo(ev.ring);
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + icsEscape(String(ev.id || ymd + '-' + (ev.title || 'event'))) + '@pixelpassage.horse');
    lines.push('DTSTAMP:' + stamp);
    if (validTime(ev.start)) {
      lines.push('DTSTART:' + ymd + 'T' + ev.start.replace(':', '') + '00');
      if (validTime(ev.end)) {
        lines.push('DTEND:' + ymd + 'T' + ev.end.replace(':', '') + '00');
      }
    } else { // all-day
      lines.push('DTSTART;VALUE=DATE:' + ymd);
    }
    lines.push('SUMMARY:' + icsEscape(ev.title || 'Untitled event'));
    lines.push('LOCATION:' + icsEscape(ring.label));
    lines.push('CATEGORIES:' + icsEscape(ring.label));
    const desc = [];
    if (ev.type) desc.push('Type: ' + ev.type);
    if (ev.notes) desc.push(String(ev.notes));
    if (Array.isArray(ev.entries) && ev.entries.length) {
      desc.push('Entries:');
      for (const en of ev.entries) {
        desc.push('  ' + [en.time, en.rider, en.horse && ('on ' + en.horse)].filter(Boolean).join(' '));
      }
    }
    if (desc.length) lines.push('DESCRIPTION:' + icsEscape(desc.join('\n')));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ */
/* /api/schedule.html — day-by-day, color-coded by ring, printable     */
/* ------------------------------------------------------------------ */

function scheduleHtml(ctx) {
  const evs = allEvents(ctx);
  const byDay = new Map();
  for (const ev of evs) {
    const key = String(ev.date || 'Undated');
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(ev);
  }

  const legend = Object.keys(RING).map((k) =>
    '<span style="display:inline-block;margin:2px 8px 2px 0;padding:2px 8px;border:2px solid ' + C.ink + ';' +
    'background:' + RING[k].color + ';color:#fff8ea;font-size:12px;font-weight:bold">' + esc(RING[k].label) + '</span>').join('');

  const testName = (id) => {
    const t = id ? findTest(ctx, id) : null;
    return t ? (t.shortName || t.name || id) : (id || '');
  };

  const dayBlocks = [...byDay.entries()].map(([date, list]) => {
    const cards = list.map((ev) => {
      const ring = ringInfo(ev.ring);
      const time = validTime(ev.start)
        ? ev.start + (validTime(ev.end) ? '\u2013' + ev.end : '') : 'all day';
      const entries = (Array.isArray(ev.entries) && ev.entries.length)
        ? '<table style="margin:8px 0 0"><thead><tr><th class="c">Time</th><th>Rider</th><th>Horse</th><th>Test</th></tr></thead><tbody>' +
          ev.entries.map((en) => '<tr><td class="c">' + esc(en.time || '') + '</td><td>' + esc(en.rider || '') +
            '</td><td>' + esc(en.horse || '') + '</td><td>' + esc(testName(en.testId)) + '</td></tr>').join('') +
          '</tbody></table>'
        : '';
      return '<div class="panel" style="border-left:10px solid ' + ring.color + '">' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:baseline">' +
        '<div><b style="font-size:17px">' + esc(ev.title || 'Untitled event') + '</b>' +
        ' <span class="sub">' + esc(ev.type || '') + '</span></div>' +
        '<div><span class="c" style="font-weight:bold;margin-right:8px">' + esc(time) + '</span>' +
        '<span style="display:inline-block;padding:2px 8px;border:2px solid ' + C.ink + ';background:' + ring.color +
        ';color:#fff8ea;font-size:12px;font-weight:bold">' + esc(ring.label) + '</span></div></div>' +
        (ev.notes ? '<div class="dir" style="margin-top:6px">' + esc(ev.notes) + '</div>' : '') +
        entries + '</div>';
    }).join('');
    return '<div class="day"><h2 style="margin:18px 0 10px;color:' + C.brand + ';border-bottom:3px solid ' + C.gold +
      ';padding-bottom:4px;font-size:18px;letter-spacing:1px">' + esc(fmtDay(date)) + '</h2>' + cards + '</div>';
  }).join('');

  const empty = '<div class="panel" style="text-align:center;padding:30px">' +
    'No events on the books yet \u2014 the arena is freshly dragged. \u{1F3C7}</div>';

  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(showName(ctx)) + ' \u2014 schedule</title><style>' + pixelCss() + '</style></head><body>' +
    '<div class="no-print"><button onclick="window.print()">\u{1F5A8} Print schedule</button></div>' +
    '<div class="sheet">' +
    '<div class="panel">' + headerHtml(ctx, 'Show Schedule') +
    '<div style="margin-top:6px"><span class="sub" style="margin-right:8px">Rings:</span>' + legend + '</div></div>' +
    (dayBlocks || empty) +
    '<div class="foot">' + esc(pickPun(ctx, 'schedule')) + '<br>Pixel Passage \u00b7 generated ' + esc(fmtTs(Date.now())) + '</div>' +
    '</div></body></html>';
}

/* ------------------------------------------------------------------ */
/* /api/schedule.csv — flat rows (one per entry, or one per event)     */
/* ------------------------------------------------------------------ */

function scheduleCsv(ctx) {
  const rows = [csvRow(['Date', 'Start', 'End', 'Title', 'Ring', 'Type', 'Notes',
    'Entry Time', 'Entry Rider', 'Entry Horse', 'Entry Test'])];
  for (const ev of allEvents(ctx)) {
    const base = [ev.date || '', ev.start || '', ev.end || '', ev.title || '',
      ringInfo(ev.ring).label, ev.type || '', ev.notes || ''];
    const entries = Array.isArray(ev.entries) ? ev.entries : [];
    if (!entries.length) {
      rows.push(csvRow(base.concat(['', '', '', ''])));
    } else {
      for (const en of entries) {
        const t = en.testId ? findTest(ctx, en.testId) : null;
        rows.push(csvRow(base.concat([en.time || '', en.rider || '', en.horse || '',
          t ? (t.shortName || t.name || en.testId) : (en.testId || '')])));
      }
    }
  }
  return csvJoin(rows);
}

/* ------------------------------------------------------------------ */
/* route handlers                                                      */
/* ------------------------------------------------------------------ */

function send(res, code, type, body, disposition) {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(code, Object.assign(
    { 'Content-Type': type, 'Content-Length': buf.length },
    disposition ? { 'Content-Disposition': disposition } : {}
  ));
  res.end(buf);
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ride';
}

/** GET /api/report/ride/:id.html | .csv */
function handleRideReport(req, res, ctx, params) {
  // Derive id + extension straight from the URL — robust to any param syntax.
  const pathname = new URL(req.url, 'http://pp.local').pathname;
  let m = /\/api\/report\/ride\/([^/]+?)\.(html|csv)$/.exec(pathname);
  let id = m ? decodeURIComponent(m[1]) : null;
  let ext = m ? m[2] : null;
  if (!id && params) { // fall back to kernel-provided params
    id = params.id || null;
    ext = params.ext || ext;
    if (id) {
      const m2 = /^(.+?)\.(html|csv)$/.exec(id);
      if (m2) { id = m2[1]; ext = m2[2]; }
    }
  }
  if (!id || !ext) return ctx.sendJSON(res, 400, { error: 'Expected /api/report/ride/<id>.html or .csv' });

  const ride = findRide(ctx, id);
  if (!ride) return ctx.sendJSON(res, 404, { error: 'Ride not found \u2014 maybe it bolted?' });
  const test = findTest(ctx, ride.testId);

  if (ext === 'csv') {
    return send(res, 200, 'text/csv; charset=utf-8', rideCsv(ctx, ride, test),
      'attachment; filename="scoresheet-' + slug(ride.rider) + '-' + slug(ride.horse) + '.csv"');
  }
  return send(res, 200, 'text/html; charset=utf-8', rideHtml(ctx, ride, test));
}

/** POST /api/report {rideIds:[], emails:[], subject?} → one digest email */
async function handleReportEmail(req, res, ctx) {
  let user = null;
  try { user = await ctx.auth.requireAuth(req, res, 'judge'); } catch (e) { user = null; }
  if (!user) return;

  let body;
  try { body = await smtp.readJsonBody(req); }
  catch (e) { return ctx.sendJSON(res, e.status || 400, { error: e.message }); }

  const rideIds = Array.isArray(body.rideIds) ? body.rideIds.map(String) : [];
  const emails = (Array.isArray(body.emails) ? body.emails : [])
    .map((s) => String(s).trim()).filter(Boolean);
  if (!rideIds.length) return ctx.sendJSON(res, 400, { error: 'No rides selected \u2014 pick at least one.' });
  if (!emails.length) return ctx.sendJSON(res, 400, { error: 'No recipients \u2014 who gets the scoresheets?' });
  const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad.length) return ctx.sendJSON(res, 400, { error: 'These don\u2019t look like email addresses: ' + bad.join(', ') });
  if (rideIds.length > 100) return ctx.sendJSON(res, 400, { error: 'Too many rides for one email (max 100).' });

  const rides = [];
  const missing = [];
  for (const id of rideIds) {
    const r = findRide(ctx, id);
    if (r) rides.push(r); else missing.push(id);
  }
  if (!rides.length) return ctx.sendJSON(res, 404, { error: 'None of those rides were found.' });

  const subject = String(body.subject || '').trim() ||
    showName(ctx) + ' \u2014 scoresheet' + (rides.length > 1 ? 's (' + rides.length + ' rides)' : '');

  let result;
  try {
    result = await smtp.sendMail(ctx, {
      to: emails,
      subject,
      html: digestHtml(ctx, rides),
      text: digestText(ctx, rides)
    });
  } catch (e) {
    return ctx.sendJSON(res, e.status || 500, { error: e.message });
  }

  try {
    ctx.audit(ctx, req, user, 'report.email',
      'rides=' + rides.map((r) => r.id).join(',') + ' to=' + emails.join(',') +
      (result.sent ? ' sent' : ' outbox=' + result.outbox));
  } catch (e) { /* audit is best-effort */ }

  const out = { sent: result.sent };
  if (!result.sent) {
    out.outbox = result.outbox;
    out.message = 'Mail couldn\u2019t leave the barn (' + (result.error || 'unknown') +
      ') \u2014 the full report is safe in the outbox.';
  } else {
    out.message = 'Report delivered at a lovely working canter to ' + emails.length +
      ' recipient' + (emails.length > 1 ? 's' : '') + '.';
  }
  if (missing.length) out.missing = missing;
  ctx.sendJSON(res, 200, out);
}

function handleScheduleIcs(req, res, ctx) {
  send(res, 200, 'text/calendar; charset=utf-8', scheduleIcs(ctx),
    'attachment; filename="pixel-passage-schedule.ics"');
}
function handleScheduleHtml(req, res, ctx) {
  send(res, 200, 'text/html; charset=utf-8', scheduleHtml(ctx));
}
function handleScheduleCsv(req, res, ctx) {
  send(res, 200, 'text/csv; charset=utf-8', scheduleCsv(ctx),
    'attachment; filename="pixel-passage-schedule.csv"');
}

/** Guard every handler: friendly JSON 500s, never a hung response. */
function guard(fn) {
  return async function guarded(req, res, ctx, params) {
    try { await fn(req, res, ctx, params); }
    catch (e) {
      try { ctx.sendJSON(res, 500, { error: 'Report stumbled: ' + ((e && e.message) || 'unknown error') }); }
      catch (e2) { try { res.end(); } catch (e3) { /* gone */ } }
    }
  };
}

module.exports = {
  routes: [
    { method: 'POST', path: '/api/report', role: 'judge', handler: guard(handleReportEmail) },
    // Contract pattern '/api/x/:id(.ext)?' — register both spellings so any
    // reasonable kernel matcher hits one; the handler re-parses from req.url.
    { method: 'GET', path: '/api/report/ride/:id(.ext)?', role: 'any', handler: guard(handleRideReport) },
    { method: 'GET', path: '/api/report/ride/:id', role: 'any', handler: guard(handleRideReport) },
    { method: 'GET', path: '/api/schedule.ics', role: 'any', handler: guard(handleScheduleIcs) },
    { method: 'GET', path: '/api/schedule.html', role: 'any', handler: guard(handleScheduleHtml) },
    { method: 'GET', path: '/api/schedule.csv', role: 'any', handler: guard(handleScheduleCsv) }
  ],
  // exposed for tests / other server code
  scoreRide, errorPenalty, rideCsv, rideHtml, scheduleIcs, scheduleHtml, scheduleCsv
};
