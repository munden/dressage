'use strict';
/**
 * Pixel Passage — auth.js
 * scrypt password hashing (salted), timing-safe verification, session cookies,
 * account lockout, and a per-IP brute-force damper. Hold your horses, intruders.
 */

const crypto = require('node:crypto');
const db = require('./db');

const SESSION_COOKIE = 'pp_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, sliding
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 minutes
const IP_MAX_ATTEMPTS = 20;
const IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------- passwords

/** hashPassword(pw) -> { salt, hash } (hex strings; scrypt, 64-byte key). */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}

/** Timing-safe password check. Any malformed input verifies false, never throws. */
function verify(pw, salt, hash) {
  try {
    const candidate = crypto.scryptSync(String(pw), String(salt), 64);
    const expected = Buffer.from(String(hash), 'hex');
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ helpers

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

// ---------------------------------------------------- per-IP login damper

const ipAttempts = new Map(); // ip -> [timestamps]

function pruneIp(ip, now) {
  const list = ipAttempts.get(ip);
  if (!list) return [];
  const fresh = list.filter((t) => now - t < IP_WINDOW_MS);
  if (fresh.length) ipAttempts.set(ip, fresh);
  else ipAttempts.delete(ip);
  return fresh;
}

/** True when this IP has burned through its attempt budget (send a 429). */
function ipThrottled(req) {
  return pruneIp(clientIp(req), Date.now()).length >= IP_MAX_ATTEMPTS;
}

/** Record one login attempt from this IP (success or failure — both count). */
function noteIpAttempt(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const fresh = pruneIp(ip, now);
  fresh.push(now);
  ipAttempts.set(ip, fresh);
}

// ----------------------------------------------------------------- sessions

/** Create a session for a user; returns the raw token for the cookie. */
function createSession(userId) {
  const d = db.get();
  const now = Date.now();
  const token = crypto.randomBytes(32).toString('hex');
  d.sessions = d.sessions.filter((s) => s.expiresAt > now); // tidy the tack room
  d.sessions.push({ token, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  db.save();
  return token;
}

function cookieFor(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Resolve the current user from the session cookie (sliding 7-day expiry). */
function getUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const d = db.get();
  const now = Date.now();
  const sess = d.sessions.find((s) => s.token === token);
  if (!sess || sess.expiresAt <= now) return null;
  const user = d.users.find((u) => u.id === sess.userId);
  if (!user) return null;
  // Sliding expiry — only touch the db when it moves by a meaningful amount.
  const target = now + SESSION_TTL_MS;
  if (target - sess.expiresAt > 60 * 1000) {
    sess.expiresAt = target;
    db.save();
  }
  return user;
}

/** Destroy the session named by the request's cookie (logout). */
function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const d = db.get();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((s) => s.token !== token);
  if (d.sessions.length !== before) {
    db.save();
    return true;
  }
  return false;
}

/** Drop every session for a user (delete/reset flows). */
function destroySessionsFor(userId) {
  const d = db.get();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((s) => s.userId !== userId);
  if (d.sessions.length !== before) db.save();
}

// -------------------------------------------------------------- role gating

/** role: null/undefined (open) | 'any' | 'judge' (judge OR admin) | 'admin'. */
function roleOk(user, role) {
  if (!role || role === null) return true;
  if (!user) return false;
  if (role === 'any') return true;
  if (role === 'admin') return user.role === 'admin';
  if (role === 'judge') return user.role === 'judge' || user.role === 'admin';
  return user.role === 'admin'; // unknown role names fail closed to admin-only
}

function sendAuthError(res, code, message) {
  const body = JSON.stringify({ error: message });
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/**
 * requireAuth(req, res, role?) -> user, or sends 401/403 and returns null.
 */
function requireAuth(req, res, role) {
  const user = getUser(req);
  if (!user) {
    sendAuthError(res, 401, 'Not signed in — hold your horses and log in first.');
    return null;
  }
  if (!roleOk(user, role || 'any')) {
    sendAuthError(res, 403, 'Whoa there — that paddock is off-limits for your role.');
    return null;
  }
  return user;
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  MAX_FAILED_ATTEMPTS,
  LOCK_MS,
  hashPassword,
  verify,
  clientIp,
  parseCookies,
  ipThrottled,
  noteIpAttempt,
  createSession,
  cookieFor,
  clearCookie,
  getUser,
  destroySession,
  destroySessionsFor,
  roleOk,
  requireAuth
};
