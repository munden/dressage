'use strict';
/**
 * Pixel Passage — server.js
 * Zero-dependency Node 22 kernel: static file serving, JSON API, sessions,
 * and defensive mounting of the smtp/reports extension modules.
 * Saddle up: `node server/server.js` → http://localhost:8420
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const db = require('./db');
const auth = require('./auth');
const audit = require('./audit');
const seedMod = require('./seed');

const PORT = Number(process.env.PORT) || 8420;
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const BODY_LIMIT = 1024 * 1024; // 1MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

// ----------------------------------------------------------------- utilities

function sendJSON(res, code, obj) {
  if (res.writableEnded) return;
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const ctx = {
  db,
  audit,
  auth,
  sendJSON,
  config: {
    port: PORT,
    root: ROOT,
    publicDir: PUBLIC_DIR,
    dataDir: db.DATA_DIR
  }
};

const isStr = (v, min = 0, max = 100000) =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isHalfStep = (v) => isNum(v) && v >= 0 && v <= 10 && Math.round(v * 2) === v * 2;
const USERNAME_RE = /^[a-zA-Z0-9._-]{2,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const ROLES = ['admin', 'judge', 'rider'];
const RINGS = ['A', 'B', 'warmup', 'clinic'];
const EVENT_TYPES = ['show', 'clinic', 'lesson', 'other'];

function safeUser(u) {
  // Never let passHash / passSalt escape the stable.
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email || '',
    role: u.role,
    createdAt: u.createdAt,
    mustChangePassword: !!u.mustChangePassword,
    failedAttempts: u.failedAttempts || 0,
    lockedUntil: u.lockedUntil || 0
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflowed = false;
    req.on('data', (chunk) => {
      if (overflowed) return; // keep draining, but discard — the 413 is already on its way
      size += chunk.length;
      if (size > BODY_LIMIT) {
        overflowed = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!overflowed) resolve(Buffer.concat(chunks)); });
    req.on('error', (err) => { if (!overflowed) reject(err); });
  });
}

// -------------------------------------------------------------------- routes

/** Compile '/api/users/:id' or '/api/report/ride/:id.html' into a regex. */
function compileRoute(route) {
  const names = [];
  const escaped = route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => {
    names.push(name);
    return '([^/]+?)';
  });
  return {
    method: route.method.toUpperCase(),
    path: route.path,
    rx: new RegExp('^' + pattern + '$'),
    names,
    role: route.role,
    handler: route.handler
  };
}

const routes = [];
function addRoute(method, routePath, role, handler) {
  routes.push(compileRoute({ method, path: routePath, role, handler }));
}

const mountedExtensions = new Set();
let lastMountAttempt = 0;

/** Defensively require ./smtp and ./reports — they are written in parallel. */
function mountExtensions() {
  for (const mod of ['./smtp', './reports']) {
    if (mountedExtensions.has(mod)) continue;
    try {
      const ext = require(mod);
      if (ext && Array.isArray(ext.routes)) {
        for (const r of ext.routes) {
          if (r && r.method && r.path && typeof r.handler === 'function') {
            routes.push(compileRoute(r));
          }
        }
        mountedExtensions.add(mod);
        console.log(`[server] mounted ${mod} (${ext.routes.length} routes) — the cavalry has arrived.`);
      } else {
        mountedExtensions.add(mod); // loaded but useless: don't retry forever
        console.warn(`[server] ${mod} loaded but exports no routes array — skipping.`);
      }
    } catch (err) {
      if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(`'${mod}'`)) {
        console.warn(`[server] optional module ${mod} not found yet — trotting on without it.`);
      } else {
        console.error(`[server] failed to load ${mod}:`, err && err.message);
      }
    }
  }
}

// ------------------------------------------------------------------- auth API

addRoute('POST', '/api/login', null, (req, res) => {
  const b = req.body || {};
  if (!isStr(b.username, 1, 64) || !isStr(b.password, 1, 256)) {
    return sendJSON(res, 400, { error: 'Username and password required — no bareback logins.' });
  }
  if (auth.ipThrottled(req)) {
    audit(ctx, req, null, 'login.throttled', 'per-IP damper tripped');
    return sendJSON(res, 429, { error: 'Easy there — too many attempts from this stable. Cool down for a few minutes.' });
  }
  auth.noteIpAttempt(req);

  const d = db.get();
  const now = Date.now();
  const user = d.users.find((u) => u.username.toLowerCase() === b.username.toLowerCase());
  if (!user) {
    audit(ctx, req, null, 'login.fail', `unknown username "${b.username.slice(0, 32)}"`);
    return sendJSON(res, 401, { error: 'Wrong reins — check your username and password.' });
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    const mins = Math.ceil((user.lockedUntil - now) / 60000);
    audit(ctx, req, user, 'login.locked', `attempt while locked (${mins} min left)`);
    return sendJSON(res, 423, { error: `This stall is locked for ${mins} more minute${mins === 1 ? '' : 's'} after too many attempts.` });
  }
  if (user.lockedUntil && user.lockedUntil <= now) {
    user.lockedUntil = 0;
    user.failedAttempts = 0;
  }
  if (!auth.verify(b.password, user.passSalt, user.passHash)) {
    user.failedAttempts = (user.failedAttempts || 0) + 1;
    if (user.failedAttempts >= auth.MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = now + auth.LOCK_MS;
      audit(ctx, req, user, 'login.lockout', `locked for 15 min after ${user.failedAttempts} failed attempts`);
    } else {
      audit(ctx, req, user, 'login.fail', `wrong password (attempt ${user.failedAttempts}/${auth.MAX_FAILED_ATTEMPTS})`);
    }
    db.save();
    return sendJSON(res, 401, { error: 'Wrong reins — check your username and password.' });
  }

  user.failedAttempts = 0;
  user.lockedUntil = 0;
  const token = auth.createSession(user.id);
  res.setHeader('Set-Cookie', auth.cookieFor(token));
  audit(ctx, req, user, 'login.success', 'signed in');
  sendJSON(res, 200, { user: safeUser(user) });
});

addRoute('POST', '/api/logout', 'any', (req, res) => {
  auth.destroySession(req);
  res.setHeader('Set-Cookie', auth.clearCookie());
  audit(ctx, req, req.user, 'logout', 'signed out');
  sendJSON(res, 200, { ok: true, bye: 'Happy trails!' });
});

addRoute('GET', '/api/me', 'any', (req, res) => {
  sendJSON(res, 200, { user: safeUser(req.user) });
});

addRoute('POST', '/api/me/password', 'any', (req, res) => {
  const b = req.body || {};
  if (!isStr(b.current, 1, 256) || !isStr(b.next, 1, 256)) {
    return sendJSON(res, 400, { error: 'Both current and next passwords are required.' });
  }
  if (b.next.length < 6) {
    return sendJSON(res, 400, { error: 'New password needs at least 6 characters — a short rein is a weak rein.' });
  }
  if (!auth.verify(b.current, req.user.passSalt, req.user.passHash)) {
    audit(ctx, req, req.user, 'password.change.fail', 'wrong current password');
    return sendJSON(res, 401, { error: 'Current password does not match.' });
  }
  const { salt, hash } = auth.hashPassword(b.next);
  req.user.passSalt = salt;
  req.user.passHash = hash;
  req.user.mustChangePassword = false;
  db.save();
  audit(ctx, req, req.user, 'password.change', 'changed own password');
  sendJSON(res, 200, { ok: true, user: safeUser(req.user) });
});

// ------------------------------------------------------------------ users API

addRoute('GET', '/api/users', 'admin', (req, res) => {
  sendJSON(res, 200, { users: db.get().users.map(safeUser) });
});

function validateUserBody(b, { requirePassword, existing }) {
  const d = db.get();
  if (b.username !== undefined || !existing) {
    if (!isStr(b.username) || !USERNAME_RE.test(b.username)) {
      return 'Username must be 2-32 characters: letters, numbers, dot, dash, underscore.';
    }
    const clash = d.users.find(
      (u) => u.username.toLowerCase() === b.username.toLowerCase() && (!existing || u.id !== existing.id)
    );
    if (clash) return 'That username is already in the stable.';
  }
  if (b.name !== undefined || !existing) {
    if (!isStr(b.name, 1, 80)) return 'Name is required (max 80 characters).';
  }
  if (b.email !== undefined && b.email !== '') {
    if (!isStr(b.email, 3, 120) || !b.email.includes('@')) return 'That email looks like it lost a shoe.';
  }
  if (b.role !== undefined || !existing) {
    if (!ROLES.includes(b.role)) return `Role must be one of: ${ROLES.join(', ')}.`;
  }
  if (b.password !== undefined || requirePassword) {
    if (!isStr(b.password, 6, 256)) return 'Password needs at least 6 characters.';
  }
  return null;
}

addRoute('POST', '/api/users', 'admin', (req, res) => {
  const b = req.body || {};
  const err = validateUserBody(b, { requirePassword: true, existing: null });
  if (err) return sendJSON(res, 400, { error: err });
  const { salt, hash } = auth.hashPassword(b.password);
  const user = {
    id: crypto.randomUUID(),
    username: b.username,
    name: b.name,
    email: b.email || '',
    role: b.role,
    passHash: hash,
    passSalt: salt,
    failedAttempts: 0,
    lockedUntil: 0,
    createdAt: Date.now(),
    mustChangePassword: b.mustChangePassword !== false // new riders change reins by default
  };
  db.get().users.push(user);
  db.save();
  audit(ctx, req, req.user, 'user.create', `created ${user.role} "${user.username}"`);
  sendJSON(res, 201, { user: safeUser(user) });
});

function isLastAdmin(user) {
  const admins = db.get().users.filter((u) => u.role === 'admin');
  return user.role === 'admin' && admins.length <= 1;
}

addRoute('PUT', '/api/users/:id', 'admin', (req, res, _ctx, params) => {
  const d = db.get();
  const user = d.users.find((u) => u.id === params.id);
  if (!user) return sendJSON(res, 404, { error: 'No such rider in the stable.' });
  const b = req.body || {};
  const err = validateUserBody(b, { requirePassword: false, existing: user });
  if (err) return sendJSON(res, 400, { error: err });
  if (b.role !== undefined && b.role !== 'admin' && isLastAdmin(user)) {
    return sendJSON(res, 400, { error: 'Cannot demote the last admin — someone has to hold the reins.' });
  }

  const changes = [];
  if (b.username !== undefined && b.username !== user.username) { user.username = b.username; changes.push('username'); }
  if (b.name !== undefined) { user.name = b.name; changes.push('name'); }
  if (b.email !== undefined) { user.email = b.email; changes.push('email'); }
  if (b.role !== undefined && b.role !== user.role) { user.role = b.role; changes.push(`role→${b.role}`); }
  if (b.password !== undefined) {
    const { salt, hash } = auth.hashPassword(b.password);
    user.passSalt = salt;
    user.passHash = hash;
    user.mustChangePassword = b.mustChangePassword !== false;
    auth.destroySessionsFor(user.id); // fresh reins for everyone
    changes.push('password-reset');
  }
  if (b.mustChangePassword !== undefined && b.password === undefined) {
    user.mustChangePassword = !!b.mustChangePassword;
    changes.push('mustChangePassword');
  }
  if (b.unlock === true) {
    user.lockedUntil = 0;
    user.failedAttempts = 0;
    changes.push('unlocked');
  }
  db.save();
  audit(ctx, req, req.user, 'user.update', `updated "${user.username}" (${changes.join(', ') || 'no changes'})`);
  sendJSON(res, 200, { user: safeUser(user) });
});

addRoute('DELETE', '/api/users/:id', 'admin', (req, res, _ctx, params) => {
  const d = db.get();
  const idx = d.users.findIndex((u) => u.id === params.id);
  if (idx < 0) return sendJSON(res, 404, { error: 'No such rider in the stable.' });
  const user = d.users[idx];
  if (isLastAdmin(user)) {
    return sendJSON(res, 400, { error: 'Cannot delete the last admin — the arena needs a steward.' });
  }
  d.users.splice(idx, 1);
  auth.destroySessionsFor(user.id);
  db.save();
  audit(ctx, req, req.user, 'user.delete', `deleted "${user.username}"`);
  sendJSON(res, 200, { ok: true });
});

// ------------------------------------------------------------------ tests API

function validateTest(b) {
  if (!isStr(b.name, 1, 120)) return 'Test needs a name (max 120 characters).';
  if (b.shortName !== undefined && !isStr(b.shortName, 0, 40)) return 'shortName too long (max 40).';
  if (b.level !== undefined && !isStr(b.level, 0, 60)) return 'level too long (max 60).';
  if (b.arena !== undefined && !['small', 'standard'].includes(b.arena)) return "arena must be 'small' or 'standard'.";
  if (b.movements !== undefined) {
    if (!Array.isArray(b.movements) || b.movements.length > 100) return 'movements must be an array (max 100).';
    for (const m of b.movements) {
      if (!m || typeof m !== 'object') return 'Each movement must be an object.';
      if (!isNum(m.num) || m.num < 0 || m.num > 999) return 'Each movement needs a numeric num.';
      if (!isStr(m.name, 1, 500)) return 'Each movement needs a name (max 500 characters).';
      if (m.directive !== undefined && !isStr(m.directive, 0, 500)) return 'Movement directive too long (max 500).';
      if (m.coefficient !== undefined && (!isNum(m.coefficient) || m.coefficient < 0 || m.coefficient > 10)) {
        return 'Movement coefficient must be a number between 0 and 10.';
      }
    }
  }
  return null;
}

addRoute('GET', '/api/tests', 'any', (req, res) => {
  sendJSON(res, 200, { tests: db.get().tests });
});

addRoute('POST', '/api/tests', 'judge', (req, res) => {
  const b = req.body || {};
  const err = validateTest(b);
  if (err) return sendJSON(res, 400, { error: err });
  const d = db.get();
  const test = {
    id: isStr(b.id, 1, 64) && !d.tests.some((t) => t.id === b.id) ? b.id : crypto.randomUUID(),
    name: b.name,
    shortName: b.shortName || b.name,
    level: b.level || '',
    arena: b.arena || 'standard',
    movements: Array.isArray(b.movements) ? b.movements : []
  };
  d.tests.push(test);
  db.save();
  audit(ctx, req, req.user, 'test.create', `created test "${test.name}"`);
  sendJSON(res, 201, { test });
});

addRoute('PUT', '/api/tests/:id', 'judge', (req, res, _ctx, params) => {
  const d = db.get();
  const test = d.tests.find((t) => t.id === params.id);
  if (!test) return sendJSON(res, 404, { error: 'No such test — did it leave the arena?' });
  const b = Object.assign({}, test, req.body || {}, { id: test.id });
  const err = validateTest(b);
  if (err) return sendJSON(res, 400, { error: err });
  Object.assign(test, b);
  db.save();
  audit(ctx, req, req.user, 'test.update', `updated test "${test.name}"`);
  sendJSON(res, 200, { test });
});

addRoute('DELETE', '/api/tests/:id', 'judge', (req, res, _ctx, params) => {
  const d = db.get();
  const idx = d.tests.findIndex((t) => t.id === params.id);
  if (idx < 0) return sendJSON(res, 404, { error: 'No such test — did it leave the arena?' });
  const [removed] = d.tests.splice(idx, 1);
  db.save();
  audit(ctx, req, req.user, 'test.delete', `deleted test "${removed.name}"`);
  sendJSON(res, 200, { ok: true });
});

addRoute('POST', '/api/tests/reset', 'admin', (req, res) => {
  const tests = seedMod.resetTests(db);
  if (!tests) {
    return sendJSON(res, 503, { error: 'shared/defaults.js is unavailable — cannot re-seed tests right now.' });
  }
  audit(ctx, req, req.user, 'test.reset', `re-seeded ${tests.length} tests from defaults`);
  sendJSON(res, 200, { tests });
});

// ----------------------------------------------------------------- events API

function validateEvent(b) {
  if (!isStr(b.title, 1, 120)) return 'Event needs a title (max 120 characters).';
  if (!isStr(b.date) || !DATE_RE.test(b.date)) return 'Event date must be YYYY-MM-DD.';
  if (b.start !== undefined && b.start !== '' && !TIME_RE.test(String(b.start))) return 'start must be HH:MM.';
  if (b.end !== undefined && b.end !== '' && !TIME_RE.test(String(b.end))) return 'end must be HH:MM.';
  if (b.ring !== undefined && !RINGS.includes(b.ring)) return `ring must be one of: ${RINGS.join(', ')}.`;
  if (b.type !== undefined && !EVENT_TYPES.includes(b.type)) return `type must be one of: ${EVENT_TYPES.join(', ')}.`;
  if (b.notes !== undefined && !isStr(b.notes, 0, 2000)) return 'notes too long (max 2000).';
  if (b.entries !== undefined) {
    if (!Array.isArray(b.entries) || b.entries.length > 200) return 'entries must be an array (max 200).';
    for (const e of b.entries) {
      if (!e || typeof e !== 'object') return 'Each entry must be an object.';
      if (e.time !== undefined && e.time !== '' && !TIME_RE.test(String(e.time))) return 'Entry time must be HH:MM.';
      if (e.rider !== undefined && !isStr(e.rider, 0, 80)) return 'Entry rider too long (max 80).';
      if (e.horse !== undefined && !isStr(e.horse, 0, 80)) return 'Entry horse too long (max 80).';
      if (e.testId !== undefined && !isStr(e.testId, 0, 64)) return 'Entry testId too long (max 64).';
    }
  }
  return null;
}

addRoute('GET', '/api/events', 'any', (req, res) => {
  sendJSON(res, 200, { events: db.get().events });
});

addRoute('POST', '/api/events', 'judge', (req, res) => {
  const b = req.body || {};
  const err = validateEvent(b);
  if (err) return sendJSON(res, 400, { error: err });
  const event = {
    id: crypto.randomUUID(),
    title: b.title,
    date: b.date,
    start: b.start || '',
    end: b.end || '',
    ring: b.ring || 'A',
    type: b.type || 'other',
    notes: b.notes || '',
    entries: Array.isArray(b.entries) ? b.entries : []
  };
  db.get().events.push(event);
  db.save();
  audit(ctx, req, req.user, 'event.create', `created event "${event.title}" on ${event.date}`);
  sendJSON(res, 201, { event });
});

addRoute('PUT', '/api/events/:id', 'judge', (req, res, _ctx, params) => {
  const d = db.get();
  const event = d.events.find((e) => e.id === params.id);
  if (!event) return sendJSON(res, 404, { error: 'No such event on the calendar.' });
  const b = Object.assign({}, event, req.body || {}, { id: event.id });
  const err = validateEvent(b);
  if (err) return sendJSON(res, 400, { error: err });
  Object.assign(event, b);
  db.save();
  audit(ctx, req, req.user, 'event.update', `updated event "${event.title}"`);
  sendJSON(res, 200, { event });
});

addRoute('DELETE', '/api/events/:id', 'judge', (req, res, _ctx, params) => {
  const d = db.get();
  const idx = d.events.findIndex((e) => e.id === params.id);
  if (idx < 0) return sendJSON(res, 404, { error: 'No such event on the calendar.' });
  const [removed] = d.events.splice(idx, 1);
  db.save();
  audit(ctx, req, req.user, 'event.delete', `deleted event "${removed.title}"`);
  sendJSON(res, 200, { ok: true });
});

// ------------------------------------------------------------------ rides API

function validateScoreMap(map, label) {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return `${label} must be an object.`;
  const keys = Object.keys(map);
  if (keys.length > 200) return `${label} has too many entries.`;
  for (const key of keys) {
    const cell = map[key];
    if (!cell || typeof cell !== 'object') return `${label}["${key}"] must be an object.`;
    if (cell.score !== undefined && cell.score !== null && !isHalfStep(cell.score)) {
      return `${label}["${key}"].score must be 0-10 in half-point steps.`;
    }
    if (cell.note !== undefined && !isStr(cell.note, 0, 1000)) {
      return `${label}["${key}"].note too long (max 1000).`;
    }
  }
  return null;
}

function validateRide(b) {
  if (b.testId !== undefined && !isStr(b.testId, 1, 64)) return 'testId required (max 64 characters).';
  if (b.eventId !== undefined && b.eventId !== null && !isStr(b.eventId, 0, 64)) return 'eventId too long.';
  if (b.rider !== undefined && !isStr(b.rider, 0, 80)) return 'rider name too long (max 80).';
  if (b.horse !== undefined && !isStr(b.horse, 0, 80)) return 'horse name too long (max 80).';
  if (b.date !== undefined && b.date !== '' && !DATE_RE.test(String(b.date))) return 'date must be YYYY-MM-DD.';
  if (b.status !== undefined && !['in-progress', 'final'].includes(b.status)) {
    return "status must be 'in-progress' or 'final'.";
  }
  if (b.errors !== undefined && (!Number.isInteger(b.errors) || b.errors < 0 || b.errors > 10)) {
    return 'errors must be an integer 0-10.';
  }
  if (b.furtherRemarks !== undefined && !isStr(b.furtherRemarks, 0, 5000)) return 'furtherRemarks too long (max 5000).';
  if (b.finalPct !== undefined && b.finalPct !== null && (!isNum(b.finalPct) || b.finalPct < 0 || b.finalPct > 100)) {
    return 'finalPct must be a number 0-100.';
  }
  if (b.scores !== undefined) {
    const err = validateScoreMap(b.scores, 'scores');
    if (err) return err;
  }
  if (b.collectives !== undefined) {
    const err = validateScoreMap(b.collectives, 'collectives');
    if (err) return err;
  }
  return null;
}

addRoute('GET', '/api/rides', 'judge', (req, res) => {
  let rides = db.get().rides;
  const q = req.query;
  if (q.get('eventId')) rides = rides.filter((r) => r.eventId === q.get('eventId'));
  if (q.get('testId')) rides = rides.filter((r) => r.testId === q.get('testId'));
  if (q.get('status')) rides = rides.filter((r) => r.status === q.get('status'));
  sendJSON(res, 200, { rides });
});

addRoute('POST', '/api/rides', 'judge', (req, res) => {
  const b = req.body || {};
  if (!isStr(b.testId, 1, 64)) return sendJSON(res, 400, { error: 'testId is required — pick a test before entering at A.' });
  const err = validateRide(b);
  if (err) return sendJSON(res, 400, { error: err });
  const d = db.get();
  if (!d.tests.some((t) => t.id === b.testId)) {
    return sendJSON(res, 400, { error: 'Unknown testId — that test is not in the book.' });
  }
  const now = Date.now();
  const ride = {
    id: crypto.randomUUID(),
    testId: b.testId,
    eventId: b.eventId || null,
    rider: b.rider || '',
    horse: b.horse || '',
    judgeId: req.user.id,
    judgeName: req.user.name,
    date: b.date || new Date().toISOString().slice(0, 10),
    status: 'in-progress',
    scores: b.scores || {},
    collectives: b.collectives || {},
    errors: Number.isInteger(b.errors) ? b.errors : 0,
    furtherRemarks: b.furtherRemarks || '',
    finalPct: null,
    createdAt: now,
    updatedAt: now
  };
  d.rides.push(ride);
  db.save();
  audit(ctx, req, req.user, 'ride.create', `new ride: ${ride.rider || '(rider tbd)'} on ${ride.horse || '(horse tbd)'} — ${ride.testId}`);
  sendJSON(res, 201, { ride });
});

addRoute('GET', '/api/rides/:id', 'judge', (req, res, _ctx, params) => {
  const ride = db.get().rides.find((r) => r.id === params.id);
  if (!ride) return sendJSON(res, 404, { error: 'No such ride — perhaps it bolted.' });
  sendJSON(res, 200, { ride });
});

addRoute('PUT', '/api/rides/:id', 'judge', (req, res, _ctx, params) => {
  const d = db.get();
  const ride = d.rides.find((r) => r.id === params.id);
  if (!ride) return sendJSON(res, 404, { error: 'No such ride — perhaps it bolted.' });
  const b = req.body || {};
  const err = validateRide(b);
  if (err) return sendJSON(res, 400, { error: err });
  if (b.testId !== undefined && !d.tests.some((t) => t.id === b.testId)) {
    return sendJSON(res, 400, { error: 'Unknown testId — that test is not in the book.' });
  }
  for (const key of ['testId', 'eventId', 'rider', 'horse', 'date', 'status', 'scores', 'collectives', 'errors', 'furtherRemarks', 'finalPct']) {
    if (b[key] !== undefined) ride[key] = b[key];
  }
  ride.updatedAt = Date.now();
  db.save();
  const what = b.status === 'final' ? `FINALIZED at ${ride.finalPct != null ? ride.finalPct + '%' : 'n/a'}` : 'updated';
  audit(ctx, req, req.user, 'ride.update', `${what}: ${ride.rider || '?'} on ${ride.horse || '?'}`);
  sendJSON(res, 200, { ride });
});

addRoute('DELETE', '/api/rides/:id', 'judge', (req, res, _ctx, params) => {
  const d = db.get();
  const idx = d.rides.findIndex((r) => r.id === params.id);
  if (idx < 0) return sendJSON(res, 404, { error: 'No such ride — perhaps it bolted.' });
  const [removed] = d.rides.splice(idx, 1);
  db.save();
  audit(ctx, req, req.user, 'ride.delete', `deleted ride: ${removed.rider || '?'} on ${removed.horse || '?'}`);
  sendJSON(res, 200, { ok: true });
});

// ------------------------------------------------------------------ notes API

function validateNote(b) {
  if (b.date !== undefined && b.date !== '' && !DATE_RE.test(String(b.date))) return 'date must be YYYY-MM-DD.';
  if (b.horse !== undefined && !isStr(b.horse, 0, 80)) return 'horse name too long (max 80).';
  if (b.title !== undefined && !isStr(b.title, 0, 120)) return 'title too long (max 120).';
  if (b.text !== undefined && !isStr(b.text, 0, 20000)) return 'text too long (max 20000).';
  if (b.mood !== undefined && b.mood !== null && (!Number.isInteger(b.mood) || b.mood < 1 || b.mood > 5)) {
    return 'mood must be 1-5 horseshoes.';
  }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > 20) return 'tags must be an array (max 20).';
    for (const t of b.tags) {
      if (!isStr(t, 1, 24)) return 'Each tag must be 1-24 characters.';
    }
  }
  return null;
}

addRoute('GET', '/api/notes', 'any', (req, res) => {
  const d = db.get();
  const notes = req.user.role === 'admin' ? d.notes : d.notes.filter((n) => n.userId === req.user.id);
  sendJSON(res, 200, { notes });
});

addRoute('POST', '/api/notes', 'any', (req, res) => {
  const b = req.body || {};
  const err = validateNote(b);
  if (err) return sendJSON(res, 400, { error: err });
  const now = Date.now();
  const note = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    date: b.date || new Date().toISOString().slice(0, 10),
    horse: b.horse || '',
    title: b.title || '',
    tags: Array.isArray(b.tags) ? b.tags : [],
    text: b.text || '',
    mood: Number.isInteger(b.mood) ? b.mood : 3,
    createdAt: now,
    updatedAt: now
  };
  db.get().notes.push(note);
  db.save();
  audit(ctx, req, req.user, 'note.create', `new note "${note.title || '(untitled)'}"`);
  sendJSON(res, 201, { note });
});

function findOwnNote(req, res, id) {
  const note = db.get().notes.find((n) => n.id === id);
  if (!note) {
    sendJSON(res, 404, { error: 'No such note — must have blown out of the tack box.' });
    return null;
  }
  if (note.userId !== req.user.id && req.user.role !== 'admin') {
    sendJSON(res, 403, { error: "That's someone else's notebook — no peeking." });
    return null;
  }
  return note;
}

addRoute('PUT', '/api/notes/:id', 'any', (req, res, _ctx, params) => {
  const note = findOwnNote(req, res, params.id);
  if (!note) return;
  const b = req.body || {};
  const err = validateNote(b);
  if (err) return sendJSON(res, 400, { error: err });
  for (const key of ['date', 'horse', 'title', 'tags', 'text', 'mood']) {
    if (b[key] !== undefined) note[key] = b[key];
  }
  note.updatedAt = Date.now();
  db.save();
  audit(ctx, req, req.user, 'note.update', `updated note "${note.title || '(untitled)'}"`);
  sendJSON(res, 200, { note });
});

addRoute('DELETE', '/api/notes/:id', 'any', (req, res, _ctx, params) => {
  const note = findOwnNote(req, res, params.id);
  if (!note) return;
  const d = db.get();
  d.notes = d.notes.filter((n) => n.id !== note.id);
  db.save();
  audit(ctx, req, req.user, 'note.delete', `deleted note "${note.title || '(untitled)'}"`);
  sendJSON(res, 200, { ok: true });
});

// -------------------------------------------------------- audit + settings API

addRoute('GET', '/api/audit', 'admin', (req, res) => {
  const limitRaw = parseInt(req.query.get('limit'), 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 200, 1), 1000);
  const entries = db.get().audit.slice(-limit).reverse(); // newest first
  sendJSON(res, 200, { audit: entries });
});

addRoute('GET', '/api/settings', 'admin', (req, res) => {
  const s = db.get().settings;
  const out = JSON.parse(JSON.stringify(s));
  if (out.smtp && out.smtp.pass) out.smtp.pass = '••••'; // never leak the real pass
  sendJSON(res, 200, { settings: out });
});

addRoute('PUT', '/api/settings', 'admin', (req, res) => {
  const b = req.body || {};
  const s = db.get().settings;

  if (b.smtp !== undefined) {
    const m = b.smtp;
    if (typeof m !== 'object' || m === null) return sendJSON(res, 400, { error: 'smtp must be an object.' });
    if (m.host !== undefined && !isStr(m.host, 0, 255)) return sendJSON(res, 400, { error: 'smtp.host too long.' });
    if (m.port !== undefined && (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535)) {
      return sendJSON(res, 400, { error: 'smtp.port must be 1-65535.' });
    }
    if (m.secure !== undefined && typeof m.secure !== 'boolean') return sendJSON(res, 400, { error: 'smtp.secure must be boolean.' });
    if (m.user !== undefined && !isStr(m.user, 0, 255)) return sendJSON(res, 400, { error: 'smtp.user too long.' });
    if (m.pass !== undefined && !isStr(m.pass, 0, 255)) return sendJSON(res, 400, { error: 'smtp.pass too long.' });
    if (m.from !== undefined && !isStr(m.from, 0, 255)) return sendJSON(res, 400, { error: 'smtp.from too long.' });
    for (const key of ['host', 'port', 'secure', 'user', 'from']) {
      if (m[key] !== undefined) s.smtp[key] = m[key];
    }
    // The mask means "keep the old secret" — only a genuinely new value lands.
    if (m.pass !== undefined && m.pass !== '••••') s.smtp.pass = m.pass;
  }

  if (b.app !== undefined) {
    const a = b.app;
    if (typeof a !== 'object' || a === null) return sendJSON(res, 400, { error: 'app must be an object.' });
    if (a.showName !== undefined && !isStr(a.showName, 1, 80)) return sendJSON(res, 400, { error: 'app.showName must be 1-80 characters.' });
    if (a.transitionHorse !== undefined && typeof a.transitionHorse !== 'boolean') {
      return sendJSON(res, 400, { error: 'app.transitionHorse must be boolean.' });
    }
    if (a.punLevel !== undefined && !['reined-in', 'unbridled'].includes(a.punLevel)) {
      return sendJSON(res, 400, { error: "app.punLevel must be 'reined-in' or 'unbridled'." });
    }
    for (const key of ['showName', 'transitionHorse', 'punLevel']) {
      if (a[key] !== undefined) s.app[key] = a[key];
    }
  }

  db.save();
  audit(ctx, req, req.user, 'settings.update', `updated ${[b.smtp && 'smtp', b.app && 'app'].filter(Boolean).join('+') || 'nothing'}`);
  const out = JSON.parse(JSON.stringify(s));
  if (out.smtp && out.smtp.pass) out.smtp.pass = '••••';
  sendJSON(res, 200, { settings: out });
});

addRoute('GET', '/api/appconfig', null, (req, res) => {
  const a = db.get().settings.app;
  sendJSON(res, 200, {
    showName: a.showName,
    transitionHorse: !!a.transitionHorse,
    punLevel: a.punLevel
  });
});

// ------------------------------------------------------------- API dispatcher

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  const findMatch = () => {
    let pathMatched = false;
    for (const route of routes) {
      const m = route.rx.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== req.method) continue;
      const params = {};
      route.names.forEach((name, i) => {
        try {
          params[name] = decodeURIComponent(m[i + 1]);
        } catch {
          params[name] = m[i + 1];
        }
      });
      return { route, params };
    }
    return pathMatched ? 'method' : null;
  };

  let match = findMatch();
  if (!match) {
    // The smtp/reports modules are built in parallel; if a route 404s and an
    // extension is still unmounted, give require another canter (throttled).
    if (mountedExtensions.size < 2 && Date.now() - lastMountAttempt > 5000) {
      lastMountAttempt = Date.now();
      mountExtensions();
      match = findMatch();
    }
  }
  if (!match) return sendJSON(res, 404, { error: 'No such trail — API route not found.' });
  if (match === 'method') return sendJSON(res, 405, { error: 'Wrong gait — method not allowed here.' });

  const { route, params } = match;

  // Parse JSON body for mutating methods (1MB limit) before auth/handler.
  req.query = url.searchParams;
  req.body = {};
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      const code = err.status === 413 ? 413 : 400;
      // Close the connection after the reply so we stop swallowing the oversized upload.
      if (code === 413 && !res.headersSent) res.setHeader('Connection', 'close');
      return sendJSON(res, code, {
        error: code === 413 ? 'That payload is more than one horse can carry (1MB limit).' : 'Could not read request body.'
      });
    }
    if (raw.length) {
      try {
        req.body = JSON.parse(raw.toString('utf8'));
      } catch {
        return sendJSON(res, 400, { error: 'Body must be valid JSON — that was more of a whinny.' });
      }
      if (typeof req.body !== 'object' || req.body === null) {
        return sendJSON(res, 400, { error: 'Body must be a JSON object.' });
      }
    }
  }

  if (route.role) {
    const user = auth.requireAuth(req, res, route.role);
    if (!user) return;
    req.user = user;
  } else {
    req.user = auth.getUser(req); // best-effort identity on open routes
  }

  await route.handler(req, res, ctx, params);
  if (!res.writableEnded && !res.headersSent) {
    sendJSON(res, 500, { error: 'The handler left the arena without saluting.' });
  }
}

// ------------------------------------------------------------- static serving

const FALLBACK_INDEX = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pixel Passage</title>
<body style="font-family:monospace;background:#f2e7d5;color:#3a2a18;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1>&#127905; Pixel Passage</h1>
<p>The backend is cantering on port ${PORT}, but the frontend is still being groomed.<br>
(public/index.html has not arrived at the arena yet.)</p></div></body>`;

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return sendJSON(res, 404, { error: 'File not found — nothing but tumbleweed here.' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600'
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.writableEnded) res.destroy();
    });
    stream.pipe(res);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname.includes('\0')) return sendJSON(res, 400, { error: 'Bad path.' });

  // shared/defaults.js is served at a fixed URL for the SPA.
  if (pathname === '/shared/defaults.js') {
    return serveFile(req, res, path.join(SHARED_DIR, 'defaults.js'));
  }

  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // Path-traversal guard: the resolved path must stay inside public/.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJSON(res, 403, { error: 'Nice try — no jumping the arena fence.' });
  }

  if (pathname === '/') {
    return fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : FALLBACK_INDEX);
      }
      serveFile(req, res, filePath);
    });
  }
  serveFile(req, res, filePath);
}

// -------------------------------------------------------------------- lift-off

seedMod.seed(db);
mountExtensions();

// Prune expired sessions every hour so the tack room stays tidy.
const pruneTimer = setInterval(() => {
  const d = db.get();
  const now = Date.now();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((s) => s.expiresAt > now);
  if (d.sessions.length !== before) db.save();
}, 60 * 60 * 1000);
pruneTimer.unref();

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendJSON(res, 400, { error: 'Malformed URL.' });
  }
  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return sendJSON(res, 400, { error: 'Bad path encoding.' });
      }
      return serveStatic(req, res, pathname);
    }
    sendJSON(res, 405, { error: 'Method not allowed.' });
  } catch (err) {
    console.error('[server] request error:', err);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: 'The server threw a shoe — please try again.' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

server.on('error', (err) => {
  // Fail fast and loud — without this, a second instance would die via the
  // uncaughtException hook and could clobber db.json with its stale copy.
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${PORT} is already taken — is another Pixel Passage cantering? Exiting without touching the db.`);
  } else {
    console.error('[server] listen failed:', err && err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n  Pixel Passage is cantering at http://localhost:${PORT}`);
  console.log('  (Ctrl+C performs a square halt and saves the db.)\n');
});
