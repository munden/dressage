'use strict';
/**
 * Pixel Passage — smtp.js
 * Minimal zero-dependency SMTP client (node:net / node:tls only).
 *
 *   sendMail(ctx, { to:[], subject, html, text }) →
 *     { sent:true }                          on success
 *     { sent:false, outbox:'<file>', error } when no host configured or delivery fails
 *
 * Supports: implicit TLS (port 465), STARTTLS (587/25), AUTH LOGIN + AUTH PLAIN,
 * 15s timeouts, multipart/alternative MIME (UTF-8, base64 bodies), dot-stuffing.
 * Mail is never lost: any failure lands a full .eml in server/data/outbox/.
 */

const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const TIMEOUT_MS = 15000;
const OUTBOX_DIR = path.join(__dirname, 'data', 'outbox');
const DEFAULT_FROM = 'Pixel Passage <noreply@pixelpassage.horse>';

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }

/** base64-encode a body and wrap at 76 chars with CRLF (RFC 2045). */
function b64Body(s) {
  return Buffer.from(String(s), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
}

/** RFC 2047 encoded-word for headers with non-ASCII content. */
function encodeHeader(s) {
  s = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return '=?UTF-8?B?' + b64(s) + '?=';
}

/** Pull the bare address out of `Name <addr>` (or return trimmed input). */
function bareAddress(s) {
  const m = /<([^<>]+)>/.exec(String(s || ''));
  return (m ? m[1] : String(s || '')).trim();
}

function looksLikeEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** Very light HTML→text for the plain part when only html was given. */
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function smtpConfig(ctx) {
  let smtp = {};
  try { smtp = ((ctx.db.get() || {}).settings || {}).smtp || {}; } catch (e) { /* empty db */ }
  const port = Number(smtp.port) || 587;
  return {
    host: String(smtp.host || '').trim(),
    port,
    secure: !!smtp.secure || port === 465, // implicit TLS
    user: String(smtp.user || ''),
    pass: String(smtp.pass || ''),
    from: String(smtp.from || DEFAULT_FROM)
  };
}

function ehloName() {
  const h = String(os.hostname() || '').replace(/[^A-Za-z0-9.-]/g, '');
  return h || 'pixel-passage.local';
}

/* ------------------------------------------------------------------ */
/* MIME construction                                                   */
/* ------------------------------------------------------------------ */

function buildMime(from, msg) {
  const to = (msg.to || []).map(bareAddress).filter(Boolean);
  const boundary = 'pp-' + crypto.randomBytes(12).toString('hex');
  const text = msg.text != null && msg.text !== '' ? String(msg.text) : htmlToText(msg.html || '');
  const html = msg.html != null && msg.html !== '' ? String(msg.html)
    : '<pre style="font-family:monospace">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';

  const lines = [
    'From: ' + from,
    'To: ' + to.join(', '),
    'Subject: ' + encodeHeader(msg.subject || '(no subject)'),
    'Date: ' + new Date().toUTCString().replace(/GMT$/, '+0000'),
    'Message-ID: <' + crypto.randomUUID() + '@pixelpassage.horse>',
    'MIME-Version: 1.0',
    'X-Mailer: Pixel Passage (zero-dependency stable mail)',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    'This is a multi-part message in MIME format.',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Body(text),
    '--' + boundary,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Body(html),
    '--' + boundary + '--',
    ''
  ];
  return lines.join('\r\n');
}

/** Dot-stuff message data for the SMTP DATA phase (RFC 5321 §4.5.2). */
function dotStuff(data) {
  let d = String(data).replace(/\r?\n/g, '\r\n'); // normalize to CRLF
  d = d.replace(/(^|\r\n)\./g, '$1..');
  if (!d.endsWith('\r\n')) d += '\r\n';
  return d;
}

/* ------------------------------------------------------------------ */
/* outbox fallback — mail is never lost                                */
/* ------------------------------------------------------------------ */

function writeOutbox(mime, subject) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const slug = String(subject || 'mail').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mail';
  const file = Date.now() + '-' + slug + '-' + crypto.randomBytes(3).toString('hex') + '.eml';
  fs.writeFileSync(path.join(OUTBOX_DIR, file), mime, 'utf8');
  return 'server/data/outbox/' + file;
}

function friendlyError(e) {
  const msg = String((e && e.message) || e || 'unknown error');
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Could not find that mail server (DNS lookup failed).';
  if (/ECONNREFUSED/.test(msg)) return 'The mail server refused the connection (wrong port?).';
  if (/ETIMEDOUT|timeout/i.test(msg)) return 'The mail server took too long to answer (15s timeout).';
  if (/certificate|SSL|TLS|handshake/i.test(msg)) return 'Secure connection failed: ' + msg;
  if (/^SMTP 535/.test(msg)) return 'The mail server rejected the username/password (535).';
  if (/^SMTP 5\d\d/.test(msg)) return 'The mail server said no: ' + msg;
  if (/closed/i.test(msg)) return 'The mail server hung up unexpectedly.';
  return msg;
}

/* ------------------------------------------------------------------ */
/* the wire — tiny promise-based SMTP conversation                     */
/* ------------------------------------------------------------------ */

class Wire {
  constructor(cfg) {
    this.cfg = cfg;
    this.socket = null;
    this.buf = '';
    this.lines = [];
    this.replies = [];  // parsed complete replies
    this.waiters = [];  // pending read() promises
    this.err = null;
  }

  connect() {
    const { host, port, secure } = this.cfg;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Connection timeout (15s)'));
        try { sock.destroy(); } catch (e) { /* already gone */ }
      }, TIMEOUT_MS);
      const done = (err) => {
        clearTimeout(timer);
        if (err) return reject(err);
        sock.removeListener('error', onErr);
        this._hook(sock);
        resolve();
      };
      const onErr = (e) => done(e);
      const sock = secure
        ? tls.connect({ host, port, servername: host }, () => done())
        : net.connect({ host, port }, () => done());
      sock.once('error', onErr);
    });
  }

  _hook(sock) {
    this.socket = sock;
    sock.setTimeout(TIMEOUT_MS, () => this._fail(new Error('SMTP timeout (15s)')));
    sock.on('data', (d) => this._onData(d));
    sock.on('error', (e) => this._fail(e));
    sock.on('close', () => this._fail(new Error('connection closed')));
  }

  _unhook() {
    const s = this.socket;
    if (!s) return;
    s.setTimeout(0);
    s.removeAllListeners('data');
    s.removeAllListeners('error');
    s.removeAllListeners('close');
    s.removeAllListeners('timeout');
  }

  _fail(e) {
    if (this.err) return;
    this.err = e;
    try { this.socket && this.socket.destroy(); } catch (e2) { /* noop */ }
    this._drain();
  }

  _onData(chunk) {
    this.buf += chunk.toString('utf8');
    let i;
    while ((i = this.buf.indexOf('\n')) !== -1) {
      let line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const m = /^(\d{3})(?:([ -])(.*))?$/.exec(line);
      if (!m) continue; // tolerate junk
      this.lines.push(m[3] || '');
      if (m[2] !== '-') {
        this.replies.push({ code: Number(m[1]), lines: this.lines });
        this.lines = [];
      }
    }
    this._drain();
  }

  _drain() {
    while (this.waiters.length && this.replies.length) {
      this.waiters.shift().resolve(this.replies.shift());
    }
    if (this.err) {
      while (this.waiters.length) this.waiters.shift().reject(this.err);
    }
  }

  read() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this._drain();
    });
  }

  async expect(codes) {
    const ok = Array.isArray(codes) ? codes : [codes];
    const r = await this.read();
    if (!ok.includes(r.code)) {
      throw new Error('SMTP ' + r.code + ': ' + (r.lines[0] || '(no detail)'));
    }
    return r;
  }

  /** Send one command line; if codes given, await + assert the reply. */
  cmd(line, codes) {
    if (this.err) return Promise.reject(this.err);
    this.socket.write(line + '\r\n');
    return codes ? this.expect(codes) : this.read();
  }

  /** EHLO and return advertised capabilities (uppercased). */
  async ehlo() {
    const r = await this.cmd('EHLO ' + ehloName(), [250]);
    return r.lines.slice(1).map((l) => l.toUpperCase());
  }

  /** Upgrade the plain socket to TLS (STARTTLS). */
  starttls() {
    return new Promise((resolve, reject) => {
      const plain = this.socket;
      this._unhook();
      const timer = setTimeout(() => {
        reject(new Error('STARTTLS timeout (15s)'));
        try { secure.destroy(); } catch (e) { /* noop */ }
      }, TIMEOUT_MS);
      const secure = tls.connect({ socket: plain, servername: this.cfg.host }, () => {
        clearTimeout(timer);
        secure.removeListener('error', onErr);
        this._hook(secure);
        resolve();
      });
      const onErr = (e) => { clearTimeout(timer); reject(e); };
      secure.once('error', onErr);
    });
  }

  async auth() {
    const { user, pass } = this.cfg;
    const authLine = this.caps.find((l) => /^AUTH[ =]/.test(l)) || '';
    const mechs = authLine.replace(/^AUTH[ =]/, '').split(/\s+/).filter(Boolean);
    if (mechs.includes('PLAIN') || !mechs.includes('LOGIN')) {
      await this.cmd('AUTH PLAIN ' + b64('\u0000' + user + '\u0000' + pass), [235]);
    } else {
      await this.cmd('AUTH LOGIN', [334]);
      await this.cmd(b64(user), [334]);
      await this.cmd(b64(pass), [235]);
    }
  }

  /** Full handshake: greeting, EHLO, STARTTLS when applicable, AUTH when creds set. */
  async handshake() {
    await this.expect([220]); // greeting
    this.caps = await this.ehlo();
    this.tlsActive = this.cfg.secure;
    if (!this.cfg.secure && this.caps.some((l) => l.startsWith('STARTTLS'))) {
      await this.cmd('STARTTLS', [220]);
      await this.starttls();
      this.caps = await this.ehlo(); // caps change after TLS
      this.tlsActive = true;
    }
    if (this.cfg.user) {
      await this.auth();
      this.authed = true;
    }
  }

  quit() {
    try { this.socket && this.socket.write('QUIT\r\n'); } catch (e) { /* noop */ }
    this.destroy();
  }

  destroy() {
    this._unhook();
    try { this.socket && this.socket.destroy(); } catch (e) { /* noop */ }
    this.err = this.err || new Error('connection closed');
    this._drain();
  }
}

/* ------------------------------------------------------------------ */
/* transmit + public sendMail                                          */
/* ------------------------------------------------------------------ */

async function transmit(cfg, fromAddr, rcpts, mime) {
  const wire = new Wire(cfg);
  await wire.connect();
  try {
    await wire.handshake();
    await wire.cmd('MAIL FROM:<' + fromAddr + '>', [250]);
    for (const r of rcpts) await wire.cmd('RCPT TO:<' + r + '>', [250, 251]);
    await wire.cmd('DATA', [354]);
    wire.socket.write(dotStuff(mime) + '.\r\n');
    await wire.expect([250]);
    wire.quit();
  } catch (e) {
    wire.destroy();
    throw e;
  }
}

/**
 * Send a message. Resolves { sent:true } on success, or
 * { sent:false, outbox:'server/data/outbox/…​.eml', error } — never rejects
 * for delivery problems, and never loses the mail.
 */
async function sendMail(ctx, msg) {
  const cfg = smtpConfig(ctx);
  const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map(bareAddress).filter(looksLikeEmail);
  if (!to.length) throw Object.assign(new Error('No valid recipient addresses'), { status: 400 });
  const mime = buildMime(cfg.from, { ...msg, to });

  if (!cfg.host) {
    const outbox = writeOutbox(mime, msg.subject);
    return { sent: false, outbox, error: 'No SMTP host configured — saved to the outbox instead.' };
  }
  try {
    await transmit(cfg, bareAddress(cfg.from), to, mime);
    return { sent: true };
  } catch (e) {
    const outbox = writeOutbox(mime, msg.subject);
    return { sent: false, outbox, error: friendlyError(e) };
  }
}

/* ------------------------------------------------------------------ */
/* request-body helper (shared with reports.js)                        */
/* ------------------------------------------------------------------ */

const BODY_LIMIT = 1024 * 1024; // 1MB, per contract

function readJsonBody(req) {
  if (req.body !== undefined) { // kernel may have pre-parsed it
    if (typeof req.body === 'string') {
      try { return Promise.resolve(req.body ? JSON.parse(req.body) : {}); }
      catch (e) { return Promise.reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    }
    return Promise.resolve(req.body || {});
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', (e) => reject(e));
  });
}

/* ------------------------------------------------------------------ */
/* route: POST /api/smtp/test                                          */
/* ------------------------------------------------------------------ */

async function handleSmtpTest(req, res, ctx) {
  let user = null;
  try { user = await ctx.auth.requireAuth(req, res, 'admin'); } catch (e) { user = null; }
  if (!user) return; // requireAuth already answered

  const cfg = smtpConfig(ctx);
  const finish = (ok, message, extra) => {
    try { ctx.audit(ctx, req, user, 'smtp.test', (ok ? 'ok: ' : 'fail: ') + message); } catch (e) { /* audit optional */ }
    ctx.sendJSON(res, 200, Object.assign({ ok, message }, extra || {}));
  };

  if (!cfg.host) {
    return finish(false,
      'No SMTP host configured yet. Reports will trot to the outbox (server/data/outbox/) instead — no mail is ever lost.',
      { outboxFallback: true });
  }

  const wire = new Wire(cfg);
  try {
    await wire.connect();
    await wire.handshake();
    wire.quit();
    const bits = [
      'Connected to ' + cfg.host + ':' + cfg.port,
      wire.tlsActive ? (cfg.secure ? 'implicit TLS' : 'STARTTLS upgraded') : 'no TLS (plain)',
      wire.authed ? 'authenticated as ' + cfg.user : (cfg.user ? 'auth skipped' : 'no auth configured')
    ];
    finish(true, 'Neigh-ce! ' + bits.join(', ') + '. This mailbox is ready to canter.');
  } catch (e) {
    wire.destroy();
    finish(false, friendlyError(e) + ' Reports will fall back to the outbox (server/data/outbox/) so nothing is lost.',
      { outboxFallback: true });
  }
}

module.exports = {
  routes: [
    { method: 'POST', path: '/api/smtp/test', role: 'admin', handler: handleSmtpTest }
  ],
  sendMail,
  readJsonBody,
  // exposed for tests / reuse
  _internal: { buildMime, dotStuff, encodeHeader, bareAddress, looksLikeEmail, htmlToText, smtpConfig, writeOutbox, Wire, OUTBOX_DIR }
};
