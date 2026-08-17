# PIXEL PASSAGE — Agent Contracts

**App:** "Pixel Passage" — a dressage judging & rider notebook app for Donna Shar.
**Stack:** Zero-dependency Node 22 backend (`node server/server.js`, port 8420) + vanilla-JS pixel-art SPA.
**Tone:** AAA-polished pixel art, mobile/tablet-first, horse puns everywhere, delightful easter eggs.

Every agent works ONLY on the files it owns. Interfaces below are BINDING — implement them
exactly so modules snap together. Anything not specified is yours to make excellent.

---

## 1. File ownership

| Agent | Owns |
|---|---|
| kernel-server | `server/server.js`, `server/db.js`, `server/auth.js`, `server/audit.js`, `server/seed.js`, `package.json` |
| smtp-reports | `server/smtp.js`, `server/reports.js` |
| tests-data | `shared/defaults.js` |
| app-shell | `public/index.html`, `public/js/app.js`, `public/css/pixel.css` |
| judge-ui | `public/js/pages/judge.js` |
| rider-ui | `public/js/pages/rider.js` |
| calendar | `public/js/pages/calendar.js` |
| admin-ui | `public/js/pages/admin.js` |
| pixelart | `public/assets/*` (SVGs), `public/js/horse.js`, `public/css/sprites.css` |
| fun | `public/js/fun.js` |

Data files live in `server/data/` (gitignored, created at runtime by db.js).

---

## 2. Backend kernel (server/server.js + friends)

Plain `node:http`. No npm dependencies anywhere in the project. Port `process.env.PORT || 8420`.

- Serves `public/` statically (correct MIME for html/js/css/svg/png/ico/json/webmanifest; no path traversal).
- Serves `shared/defaults.js` at URL `/shared/defaults.js`.
- JSON API under `/api/`. Body limit 1MB. Always `Content-Type: application/json` for API.
- CSRF-safe enough: session cookie is `SameSite=Strict; HttpOnly`.

### db.js
JSON persistence at `server/data/db.json`, atomic writes (tmp+rename), debounced save (≤250ms), synchronous flush on exit.
API: `db.get()` → whole object; `db.save()`; collections are plain arrays/objects on it.
Shape:
```js
{
  settings: {
    smtp: { host:'', port:587, secure:false, user:'', pass:'', from:'Pixel Passage <noreply@pixelpassage.horse>' },
    app:  { showName:'Donna Shar Dressage', transitionHorse:true, punLevel:'unbridled' } // punLevel: 'reined-in'|'unbridled'
  },
  users:   [ { id, username, name, email, role /* 'admin'|'judge'|'rider' */, passHash, passSalt,
               failedAttempts:0, lockedUntil:0, createdAt, mustChangePassword:false } ],
  sessions:[ { token, userId, createdAt, expiresAt } ],
  audit:   [ { id, ts, userId, username, action, detail, ip } ],
  tests:   [ /* seeded from shared/defaults.js DR_DEFAULTS.tests, then editable */ ],
  events:  [ /* seeded from DR_DEFAULTS.events */ ],
  rides:   [ { id, testId, eventId, rider, horse, judgeId, judgeName, date, status:'in-progress'|'final',
               scores:{ [movementNum]: { score, note } },   // score: number 0..10 in 0.5 steps
               collectives:{ [key]: { score, note } },
               errors:0, furtherRemarks:'', finalPct, createdAt, updatedAt } ],
  notes:   [ { id, userId, date, horse, title, tags:[], text, mood /* 1..5 horseshoes */, createdAt, updatedAt } ]
}
```
IDs: `crypto.randomUUID()`. Timestamps: `Date.now()` ms.

### auth.js
- `hashPassword(pw)` → `{salt, hash}` using `crypto.scryptSync(pw, salt, 64)`, salt = 16 random bytes hex.
- `verify(pw, salt, hash)` timing-safe (`crypto.timingSafeEqual`).
- Sessions: 32-byte random token, cookie `pp_session`, `HttpOnly; SameSite=Strict; Path=/`, 7-day expiry, sliding.
- Login protection: after 5 failed attempts lock account 15 min (`lockedUntil`); audit every attempt.
  Global brute-force damper: per-IP 20 attempts / 10 min → 429.
- `requireAuth(req, res, role?)` helper → returns user or sends 401/403 and returns null.

### audit.js
`audit(ctx, req, user, action, detail)` — appends `{id, ts, userId, username, action, detail, ip}`; cap log at 5000 entries (drop oldest). Log: login success/fail/lockout, logout, every create/update/delete (users, tests, events, rides, notes, settings), report sends, password changes.

### Route table (kernel implements unless marked ▷)
| Method+Path | Auth | Does |
|---|---|---|
| POST `/api/login` `{username,password}` | — | → `{user}` (never passHash/salt) |
| POST `/api/logout` | any | kills session |
| GET `/api/me` | any | → `{user}` or 401 |
| POST `/api/me/password` `{current,next}` | any | change own password |
| GET/POST `/api/users`, PUT/DELETE `/api/users/:id` | admin | manage users; POST body `{username,name,email,role,password}`; can't delete last admin |
| GET `/api/tests` | any | list tests |
| POST `/api/tests`, PUT/DELETE `/api/tests/:id` | judge/admin | edit test definitions |
| POST `/api/tests/reset` | admin | re-seed tests from defaults |
| GET/POST `/api/events`, PUT/DELETE `/api/events/:id` | any read; judge/admin write | calendar events |
| GET/POST `/api/rides`, GET/PUT/DELETE `/api/rides/:id` | judge/admin | scoring sheets |
| GET/POST `/api/notes`, PUT/DELETE `/api/notes/:id` | any | rider notes, scoped to own userId (admin sees all) |
| GET `/api/audit?limit=200` | admin | newest first |
| GET `/api/settings` | admin | smtp.pass → `'••••'` if set |
| PUT `/api/settings` | admin | merge; keep old smtp.pass if value is `'••••'` |
| GET `/api/appconfig` | — | `{showName, transitionHorse, punLevel}` only |
| ▷ POST `/api/smtp/test` | admin | smtp.js: test connection |
| ▷ POST `/api/report` | judge/admin | reports.js: generate + email |
| ▷ GET `/api/report/ride/:id.html` / `.csv` | any | reports.js |
| ▷ GET `/api/schedule.ics` / `/api/schedule.html` / `/api/schedule.csv` | any | reports.js: calendar downloads |

Kernel mounts extension routes: `require('./smtp')` and `require('./reports')` each export
`{ routes: [{ method, path /* '/api/x' or '/api/x/:id(.ext)?' */, role /* null|'any'|'judge'|'admin' */, handler(req, res, ctx, params) }] }`.
`ctx = { db, audit, auth, sendJSON(res, code, obj), config }`. `'judge'` role check means judge OR admin.

### seed.js
On empty db: load defaults via `require('../shared/defaults.js')`, create tests + sample events, and users:
- `donna` / password `piaffe!` — role admin, name "Donna Shar", `mustChangePassword: true`
- `judge` / `halt-at-x` (judge, "Guest Judge"), `rider` / `free-walk` (rider, "Guest Rider")
Log seeded credentials to console with a warning to change them.

`package.json`: `{ "name":"pixel-passage", "private":true, "scripts": { "start": "node server/server.js" } }` — no deps.

---

## 3. smtp.js + reports.js

### smtp.js
Minimal SMTP client, `node:net`/`node:tls` only. `sendMail(ctx, {to:[], subject, html, text})`:
- Supports port 465 implicit TLS and 587/25 with STARTTLS; AUTH LOGIN + AUTH PLAIN; 15s timeouts.
- MIME: multipart/alternative (text + html), UTF-8, base64 bodies.
- **Outbox fallback:** if no smtp.host configured OR connection fails, write a full `.eml` file to `server/data/outbox/` and resolve `{sent:false, outbox:'<file>'}` — never lose a report. Success → `{sent:true}`.
- Route: POST `/api/smtp/test` → try connect+EHLO(+auth), report friendly result.

### reports.js
- Score report per ride: movement table (scores, coefficients, notes), collectives, errors deduction (−2/−4/elimination per error count 1/2/3), final % = points/maxPoints·100 rounded to 3 decimals, judge remarks. HTML version is print-ready and pixel-branded (inline CSS, no external assets); CSV version is spreadsheet-clean.
- POST `/api/report` `{rideIds:[], emails:[], subject?}` → one email, HTML digest of the rides + per-ride CSV content included; via smtp.sendMail. Audit it. Response `{sent, outbox?}`.
- `/api/schedule.ics` — valid ICS of all events (VEVENT with ring/notes; CATEGORIES=ring).
- `/api/schedule.html` — printable day-by-day schedule, **color-coded by ring/type** (same palette as §6 ring colors), pixel-branded.
- `/api/schedule.csv` — flat schedule rows.

---

## 4. shared/defaults.js (tests-data)

UMD file: sets `window.DR_DEFAULTS` in browser AND `module.exports` in Node:
```js
(function (root, factory) { const d = factory();
  if (typeof module === 'object' && module.exports) module.exports = d; else root.DR_DEFAULTS = d;
}(typeof self !== 'undefined' ? self : this, function () { return { tests:[...], events:[...], quickNotes:{...}, collectives:[...] }; }));
```
- `tests`: USDF-style defaults — Intro A, Intro B, Intro C, Training 1–3, First 1–3, plus a fun "Pixel Freestyle". Each:
  `{ id:'intro-a', name:'Introductory Level Test A', shortName:'Intro A', level:'Introductory', arena:'small'|'standard',
     movements:[ { num:1, name:'A Enter working trot, X halt salute…', directive:'Straightness on centerline…', coefficient:1 } ], ... }`
  Movement text should be real-feeling USDF-style content (letters A-X-C etc.), 9–15 movements each, correct coefficients (2 where typical).
- `collectives`: `[ { key:'gaits', name:'Gaits', coefficient:1 }, { key:'impulsion', ... }, { key:'submission', ... }, { key:'rider', name:"Rider's Position & Seat", coefficient:1 } ]`
- `quickNotes`: judge shorthand chips grouped: `{ praise:[ 'fluid', 'obedient', 'uphill', … ], faults:[ 'above bit', 'haunches in', 'late behind', 'braced', 'irregular', … ], geometry:[ '20m too small', 'off centerline', 'early transition', … ] }` — ≥12 per group, judge-authentic.
- `events`: ~8 sample events over the next 60 days from a REFERENCE date of 2026-08-17 (schooling show, clinic, lesson blocks, "Pixel Prix"), spread across rings `ring:'A'|'B'|'warmup'|'clinic'`, with `{ id, title, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', ring, type:'show'|'clinic'|'lesson'|'other', notes, entries:[{time, rider, horse, testId}] }`.

---

## 5. Frontend shell (app-shell)

`public/index.html`: mobile-first, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, theme-color, loads in ORDER: Google Fonts (`Press Start 2P` + `VT323`, with fallbacks), `css/pixel.css`, `css/sprites.css`, `/shared/defaults.js`, `js/fun.js`, `js/horse.js`, `js/app.js`, `js/pages/{judge,rider,calendar,admin}.js`. Single `<div id="app">`.

`public/js/app.js` defines global `window.DR` BEFORE page scripts run (scripts are classic, not modules; page scripts execute after app.js and register themselves; app.js boots on DOMContentLoaded):

```js
DR.registerPage(id, { title, icon /* emoji or asset path */, order, roles:['judge','admin'] /* omit = all */, render(el), onLeave() {} })
DR.api(method, path, body?) → Promise<parsed json>   // throws {status, error}; on 401 → show login
DR.navigate(pageId)          // runs horse transition if enabled (calls DR.horseTransition cb)
DR.toast(msg, type='info')   // pixel toast; type 'info'|'ok'|'err'|'pun'
DR.modal({title, body /* Node|html string */, actions:[{label, className, onClick}]}) → {close}
DR.confirm(msg) → Promise<bool>
DR.user                      // current user or null
DR.appconfig                 // from /api/appconfig
DR.esc(str)                  // html-escape helper
DR.fmtDate(d), DR.fmtTime('HH:MM')
DR.onReady(fn)               // queue until boot complete
```

Shell layout: top bar (pixel logo + show name + user chip), bottom tab bar on mobile / left rail on ≥900px with page icons, **persistent sidebar calendar** on ≥1100px: shell calls `DR.renderMiniCalendar(el)` if defined (calendar agent provides). Login screen (pixel gate art vibe) when no session: username/password, friendly lockout messages, shows seeded-account hint ("Stable staff: ask Donna for your reins"). Handle `mustChangePassword` → change-password modal on login.
Boot: fetch `/api/appconfig` + `/api/me`, then render. Register a simple **Home** page itself: greeting ("Good ride, {name}!"), big buttons to Judge/Notebook/Calendar, today's events (from `/api/events`), pun-of-the-moment via `DR.pun()`, stats strip.
Call hooks if present: `DR.initEggs?.()`, `DR.horseTransition?.(done)` inside navigate when `DR.appconfig.transitionHorse`.

### pixel.css — DESIGN SYSTEM (binding class names)
Fonts: `--font-pix:'Press Start 2P',monospace` (headings/labels), `--font-body:'VT323',monospace` (body, sized ≥18px for readability).
Tokens (light + dark via `prefers-color-scheme`, default warm-light "sand arena"):
`--bg, --panel, --panel-2, --ink, --ink-dim, --line, --gold:#e8a33d, --brand:#7a4a21 (saddle brown), --green:#3e8948, --red:#c8433b, --blue:#3b6ea5, --shadow`.
Ring colors (BINDING, used by calendar + reports): `--ring-a:#3b6ea5 (blue), --ring-b:#3e8948 (green), --ring-warmup:#e8a33d (gold), --ring-clinic:#8d5bb9 (purple), --ring-other:#c8433b (red)`.
Core classes: `.panel` (chunky 3px pixel border + hard shadow), `.btn`, `.btn-primary`, `.btn-danger`, `.btn-ghost`, `.btn-big` (≥52px touch target), `.score-key` (judge number pad key ≥56px), `.input`, `.select`, `.chip`, `.chip.on`, `.badge`, `.table` (mobile-scrollable), `.tabbar`, `.toast`, `.modal-backdrop`, `.modal`, `.pix-divider`, `.h-pix` (pixel heading), `.crisp` (`image-rendering:pixelated`).
All buttons: pressed state translates 2px down (hard-shadow collapse) — tactile pixel feel. Focus-visible outlines. `prefers-reduced-motion` respected globally.

---

## 6. Page modules

Each is an IIFE classic script: `DR.onReady(() => DR.registerPage('judge', {...}))` pattern is fine, or register immediately (DR exists). Fetch data via `DR.api`. All views must be excellent at 390px wide AND on tablet.

### judge.js — the crown jewel. SPEED IS THE CONTRACT.
- Flow: "New ride" → pick test (from `/api/tests`), rider+horse (free text w/ datalist from events' entries), → scoring screen.
- Scoring screen, one movement at a time: big movement name + directive; **giant score pad**: keys 4–8 prominent, 0–3 and 9–10 secondary, **half-point toggle** (or long-press key = +0.5); one tap scores AND auto-advances (undo toast). Progress bar "Movement 7/13". Swipe left/right or ◀▶ to navigate; tap progress bar to jump. Quick-note chips from `DR_DEFAULTS.quickNotes` — tap to append to movement note; free-text note field collapsed behind a 📝 toggle. Error button (E: 1st −2, 2nd −4, 3rd elim).
- After last movement: collectives screen (same pad), further remarks, live final % (with coefficients + error deduction), giant "Sign & Finalize" → PUT ride status 'final' → celebratory result screen (score, percentile pun, confetti via `DR.confetti?.()`), buttons: report HTML / CSV (links to `/api/report/ride/:id.*`), email report (calls POST `/api/report`), new ride.
- Autosaves ride to server after every score (debounced 600ms); resume in-progress rides from a list ("Rides in progress / Recent") on the page's landing view.
- Also: "Edit tests" entry point → simple editor (add/rename/reorder movements, coefficients) → CRUD `/api/tests`.

### rider.js — rider's notebook
Landing: notes list (newest first, search box, tag filter chips). New/edit note: date, horse (datalist of previous), title, tags (chips + free), mood = 1–5 horseshoe rating (pixel horseshoes), big textarea, **quick-note chips** (reuse quickNotes but rider-flavored labels ok). "Ride recap" template button pre-fills structure (Warmup / Work / Wins / Homework). Personal stats: streak ("5 rides this fortnight — unbridled dedication!"), horses ridden. Own notes only.

### calendar.js
- Full page: month grid (swipe/arrows to change month), events as colored pips by ring (§6 ring colors); tap day → day sheet with event cards (time, title, ring badge, entries); create/edit event (judge/admin) incl. entries editor; week list view toggle for mobile.
- **Downloads bar**: "Download .ics" → `/api/schedule.ics`, "Printable schedule" → opens `/api/schedule.html`, "CSV" → `/api/schedule.csv`. Legend of ring colors.
- `DR.renderMiniCalendar(el)`: compact month w/ pips, today highlighted, tap day → navigate to calendar page on that day. Expose on `DR`.

### admin.js (role admin; register with roles:['admin'])
Tabs: **Users** (list, add, edit role/email, reset password, delete — surfacing lockout state, unlock button), **SMTP** (editable host/port/secure/user/pass/from + "Test connection" → `/api/smtp/test`; explain outbox fallback), **Reports** (pick event or date-range or rides multi-select → email to comma-list, or open HTML/CSV; show outbox files note), **Audit log** (filterable table, newest first, action badges), **App settings** (show name, transitionHorse toggle, punLevel select — PUT `/api/settings`).

---

## 7. pixelart — assets, horse, sprites (AAA bar lives here)

Hand-crafted pixel-art **SVGs** (grid-of-rects or crisp paths, `shape-rendering:crispEdges`, limited warm palette matching §5 tokens). Deliver at least:
`public/assets/logo.svg` (horse-head + horseshoe mark), `favicon.svg`, `horse-idle.svg`, `horse-trot-sprite.svg` (horizontal sprite sheet, 6–8 frames, trotting/passage silhouette — must read clearly as dressage), `horse-piaffe-sprite.svg` (4–6 frames), `trophy.svg`, `ribbon.svg` (1st-place rosette), `horseshoe.svg`, `saddle.svg`, `arena-bg.svg` (subtle letter markers A/K/E/H/C/M/B/F).
`sprites.css`: classes `.spr-horse-trot`, `.spr-horse-piaffe` animating via `steps()` background sprite; `.crisp` everywhere; sizes via CSS vars.
`public/js/horse.js`:
- `DR.horseTransition(done)` — page-transition: pixel horse trots/passages across the screen over a sweeping curtain (~650ms, 60fps-cheap: transform-only), calls `done()` at midpoint so the page swaps behind it; respects `prefers-reduced-motion` (instant fade instead).
- `DR.horseParade()` — full gallop-across easter egg animation (used by Konami code).
- `DR.horseIdleMount(el, {mood})` — mount an idle horse that blinks, flicks tail, and does a piaffe on tap.

## 8. fun — puns & easter eggs (public/js/fun.js)

- `DR.puns` (≥40, dressage-specific: "Stable genius at work", "Canter believe that score!", "No need to rein it in", "That halt was a bit much", "Straight from the horse's mouth", "Unbridled talent", "Foal-proof plan", "Mane character energy", "Hay, nice transition!", "Every day I'm shufflin'… into piaffe"…), `DR.pun()` → random (respect `DR.appconfig.punLevel==='reined-in'` → calmer subset).
- `DR.loadingPun()` → e.g. "Braiding the mane…", "Dragging the arena…", "Polishing the tack…".
- `DR.confetti(opts?)` — pixel confetti (canvas overlay, horseshoes + squares, auto-cleanup).
- `DR.initEggs()` — wires easter eggs: logo tap ×5 → horse rears + whinny pun toast; Konami code → `DR.horseParade()` + toast "KONAMI CANTER!"; typing "xhalt" anywhere → everything freezes 1s with "HALT AT X. SALUTE." overlay; score of 10 celebrated (listens for `dr:perfect-ten` CustomEvent — judge page dispatches it) with confetti; tap any `.egg-horseshoe` → spins + luck pun; 5% chance a toast is replaced by a tiny trotting horse emoji parade. All idempotent, touch-friendly, reduced-motion aware.

---

## 9. Quality bar (every agent)

- Mobile-first: thumb-reachable controls, ≥44px touch targets (≥52px for judge pad), no horizontal page scroll, safe-area insets.
- No frameworks, no external requests except Google Fonts. Classic scripts, IIFE-wrapped, strict mode. No globals beyond your contracted ones.
- Escape all user content (`DR.esc`). Server validates types/lengths. Never leak passHash/salt/smtp.pass.
- Empty states are charming ("No rides yet — the arena is freshly dragged."). Errors are friendly + punny but never lose data.
- Code readable, small helpers over cleverness. Comments only where non-obvious.
