'use strict';
/**
 * Pixel Passage — audit.js
 * Every mutating hoofprint in the arena gets recorded.
 * audit(ctx, req, user, action, detail) — appends an entry, capped at 5000.
 */

const crypto = require('node:crypto');

const MAX_ENTRIES = 5000;

function ipOf(req) {
  if (!req) return '';
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

/**
 * @param {object} ctx   kernel context ({ db, ... })
 * @param {object} req   incoming request (for the IP) — may be null
 * @param {object} user  acting user — may be null (e.g. failed logins)
 * @param {string} action e.g. 'login.fail', 'ride.update', 'settings.update'
 * @param {string} detail short human-readable context (never secrets!)
 */
function audit(ctx, req, user, action, detail) {
  const d = ctx.db.get();
  d.audit.push({
    id: crypto.randomUUID(),
    ts: Date.now(),
    userId: user ? user.id : null,
    username: user ? user.username : 'anonymous',
    action: String(action || 'unknown').slice(0, 80),
    detail: String(detail == null ? '' : detail).slice(0, 500),
    ip: ipOf(req)
  });
  if (d.audit.length > MAX_ENTRIES) {
    d.audit.splice(0, d.audit.length - MAX_ENTRIES); // drop the oldest hoofprints
  }
  ctx.db.save();
}

module.exports = audit;
