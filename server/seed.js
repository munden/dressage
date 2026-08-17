'use strict';
/**
 * Pixel Passage — seed.js
 * First-canter setup: on an empty database, plant the default tests, sample
 * events, and starter accounts. Defensive about shared/defaults.js — the
 * tests-data agent may still be writing it while we boot.
 */

const path = require('node:path');
const crypto = require('node:crypto');
const auth = require('./auth');

const DEFAULTS_PATH = path.join(__dirname, '..', 'shared', 'defaults.js');

/**
 * Load shared/defaults.js fresh (cache-busted so a file that arrives after
 * boot, or is edited, is picked up). Returns the defaults object or null.
 */
function loadDefaults() {
  try {
    const resolved = require.resolve(DEFAULTS_PATH);
    delete require.cache[resolved];
  } catch {
    /* not resolvable yet — fall through to the require below for the error */
  }
  try {
    return require(DEFAULTS_PATH);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      console.error(
        '[seed] shared/defaults.js is missing — default tests/events cannot be seeded yet.\n' +
        '       (The tests-data module may still be in the oven. The server will run;\n' +
        '        re-seed later via POST /api/tests/reset or a restart once it exists.)'
      );
    } else {
      console.error('[seed] shared/defaults.js failed to load:', err.message);
    }
    return null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeUser({ username, name, email, role, password, mustChangePassword }) {
  const { salt, hash } = auth.hashPassword(password);
  return {
    id: crypto.randomUUID(),
    username,
    name,
    email: email || '',
    role,
    passHash: hash,
    passSalt: salt,
    failedAttempts: 0,
    lockedUntil: 0,
    createdAt: Date.now(),
    mustChangePassword: !!mustChangePassword
  };
}

/** Seed whatever is empty. Safe to call on every boot. */
function seed(db) {
  const d = db.get();
  let changed = false;

  if (!d.users.length) {
    d.users.push(
      makeUser({ username: 'donna', name: 'Donna Shar', role: 'admin', password: 'piaffe!', mustChangePassword: true }),
      makeUser({ username: 'judge', name: 'Guest Judge', role: 'judge', password: 'halt-at-x' }),
      makeUser({ username: 'rider', name: 'Guest Rider', role: 'rider', password: 'free-walk' })
    );
    changed = true;
    console.warn(
      '\n[seed] Fresh stable! Seeded starter accounts:\n' +
      '       donna / piaffe!    (admin — will be asked to change password on first login)\n' +
      '       judge / halt-at-x  (judge)\n' +
      '       rider / free-walk  (rider)\n' +
      '       *** CHANGE THESE PASSWORDS before letting anyone else into the arena. ***\n'
    );
  }

  if (!d.tests.length || !d.events.length) {
    const defaults = loadDefaults();
    if (defaults) {
      if (!d.tests.length && Array.isArray(defaults.tests)) {
        d.tests = clone(defaults.tests);
        changed = true;
        console.log(`[seed] Seeded ${d.tests.length} dressage tests from shared/defaults.js.`);
      }
      if (!d.events.length && Array.isArray(defaults.events)) {
        d.events = clone(defaults.events);
        changed = true;
        console.log(`[seed] Seeded ${d.events.length} sample events — the calendar is saddled up.`);
      }
    }
  }

  if (changed) db.save();
  return changed;
}

/**
 * Re-seed tests from defaults (POST /api/tests/reset).
 * Returns the fresh tests array, or null when defaults are unavailable.
 */
function resetTests(db) {
  const defaults = loadDefaults();
  if (!defaults || !Array.isArray(defaults.tests)) return null;
  const d = db.get();
  d.tests = clone(defaults.tests);
  db.save();
  return d.tests;
}

module.exports = { seed, resetTests, loadDefaults };
