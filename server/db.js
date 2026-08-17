'use strict';
/**
 * Pixel Passage — db.js
 * JSON persistence with atomic writes (tmp+rename), debounced saves (<=250ms),
 * and a synchronous flush on exit so no score is ever left at the gate.
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = DB_FILE + '.tmp';
const DEBOUNCE_MS = 250;

function emptyDb() {
  return {
    settings: {
      smtp: {
        host: '',
        port: 587,
        secure: false,
        user: '',
        pass: '',
        from: 'Pixel Passage <noreply@pixelpassage.horse>'
      },
      app: {
        showName: 'Donna Shar Dressage',
        transitionHorse: true,
        punLevel: 'unbridled' // 'reined-in' | 'unbridled'
      }
    },
    users: [],
    sessions: [],
    audit: [],
    tests: [],
    events: [],
    rides: [],
    notes: []
  };
}

let data = null;
let saveTimer = null;
let dirty = false;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Corrupted file: sidestep it (never trample data), then start fresh.
      const stash = DB_FILE + '.corrupt-' + Date.now();
      try {
        fs.copyFileSync(DB_FILE, stash);
        console.error(`[db] db.json unreadable (${err.message}); stashed a copy at ${stash} and starting fresh.`);
      } catch (copyErr) {
        console.error(`[db] db.json unreadable and could not be stashed: ${copyErr.message}`);
      }
    }
    data = emptyDb();
    dirty = true;
  }
  // Backfill any missing top-level keys / settings so old files keep working.
  const base = emptyDb();
  for (const key of Object.keys(base)) {
    if (data[key] === undefined || data[key] === null) data[key] = base[key];
  }
  if (typeof data.settings !== 'object') data.settings = base.settings;
  data.settings.smtp = Object.assign({}, base.settings.smtp, data.settings.smtp);
  data.settings.app = Object.assign({}, base.settings.app, data.settings.app);
}

function writeNow() {
  if (!data) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(TMP_FILE, DB_FILE); // atomic on the same filesystem
    dirty = false;
  } catch (err) {
    console.error('[db] save failed:', err.message);
  }
}

/** Whole database object. Mutate collections directly, then call save(). */
function get() {
  if (!data) load();
  return data;
}

/** Schedule a debounced save (at most one write per DEBOUNCE_MS). */
function save() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (dirty) writeNow();
  }, DEBOUNCE_MS);
  // Never keep the process alive just to save; exit hooks flush synchronously.
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

/** Synchronous flush — used on exit and available for callers who must be sure. */
function flushSync() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (dirty) writeNow();
}

// --- exit safety net: whatever happens, land the save. ---
process.on('exit', flushSync);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flushSync();
    process.exit(0);
  });
}
process.on('uncaughtException', (err) => {
  console.error('[db] uncaught exception — flushing db before exit:', err);
  flushSync();
  process.exit(1);
});

load();

module.exports = { get, save, flushSync, DATA_DIR, DB_FILE };
