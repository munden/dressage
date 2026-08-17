#!/usr/bin/env node
'use strict';
/*
 * Emergency password reset — for when the reins are well and truly dropped.
 *
 *   Usage:  node server/tools/reset-password.js <username> <new-password>
 *
 * Stop the server first (systemd: `sudo systemctl stop dressage`) — the running
 * server holds the database in memory and would overwrite this change on its
 * next save. The reset also clears any lockout and expires every session for
 * the account, and asks for a fresh password change on next login.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [, , username, newPass] = process.argv;
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function die(msg) { console.error('\n  ' + msg + '\n'); process.exit(1); }

if (!username || !newPass) {
  die('Usage: node server/tools/reset-password.js <username> <new-password>\n' +
      '  (stop the server first, or it will trample this change)');
}
if (newPass.length < 6) die('New password needs at least 6 characters — a short rein is no rein.');
if (!fs.existsSync(DB_PATH)) die('No database at ' + DB_PATH + ' — has the server ever run here?');

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const user = (db.users || []).find(u => u.username === String(username).toLowerCase().trim());
if (!user) {
  die('No rider named "' + username + '" in the stable. Known users: ' +
      (db.users || []).map(u => u.username).join(', '));
}

const salt = crypto.randomBytes(16).toString('hex');
user.passSalt = salt;
user.passHash = crypto.scryptSync(newPass, salt, 64).toString('hex');
user.failedAttempts = 0;
user.lockedUntil = 0;
user.mustChangePassword = true;
db.sessions = (db.sessions || []).filter(s => s.userId !== user.id);
db.audit = db.audit || [];
db.audit.push({
  id: crypto.randomUUID(), ts: Date.now(), userId: user.id, username: user.username,
  action: 'user.password.cli-reset', detail: 'Password reset from the command line', ip: 'localhost-cli',
});

const tmp = DB_PATH + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
fs.renameSync(tmp, DB_PATH);

console.log('\n  Back in the saddle! Password reset for "' + user.username + '".');
console.log('  Lockout cleared, sessions expired, and they\'ll be asked to pick a');
console.log('  fresh password at next login. Now restart the server and trot on.\n');
