/* Pixel Passage — admin.js (admin-ui agent)
 * The Stable Office: Users, SMTP, Reports, Audit log, App settings.
 * Classic IIFE script. Talks to the world only through window.DR (contract §5).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Small helpers
   * ------------------------------------------------------------------ */

  var esc = function (s) { return DR.esc(s == null ? '' : String(s)); };

  // Build one element from an HTML string.
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function fmtTs(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function apiErr(e, fallback) {
    var msg = (e && (e.error || e.message)) || fallback || 'Something threw a shoe.';
    DR.toast(msg, 'err');
  }

  function loadingHTML() {
    var pun = (DR.loadingPun ? DR.loadingPun() : 'Dragging the arena…');
    return '<div class="adm-loading">' + esc(pun) + '</div>';
  }

  function emptyHTML(msg) {
    return '<div class="adm-empty">' + esc(msg) + '</div>';
  }

  /* ------------------------------------------------------------------ *
   *  Admin-page CSS (injected once, tokens from pixel.css)
   * ------------------------------------------------------------------ */

  function injectCSS() {
    if (document.getElementById('adm-css')) return;
    var css = '' +
      '.adm-tabs{display:flex;gap:6px;overflow-x:auto;padding:4px 2px 10px;' +
        '-webkit-overflow-scrolling:touch;scrollbar-width:none}' +
      '.adm-tabs::-webkit-scrollbar{display:none}' +
      '.adm-tab{flex:0 0 auto;min-height:44px;padding:10px 14px;cursor:pointer;' +
        'font-family:var(--font-pix);font-size:10px;letter-spacing:.5px;' +
        'background:var(--panel);color:var(--ink-dim);border:3px solid var(--line);' +
        'box-shadow:0 3px 0 var(--shadow)}' +
      '.adm-tab.on{background:var(--brand);color:#fff;border-color:var(--brand);transform:translateY(2px);box-shadow:none}' +
      '.adm-tab:focus-visible{outline:3px solid var(--gold);outline-offset:2px}' +
      '.adm-body{display:block}' +
      '.adm-loading,.adm-empty{font-family:var(--font-body);font-size:20px;color:var(--ink-dim);' +
        'text-align:center;padding:28px 12px}' +
      '.adm-grid{display:grid;gap:12px;grid-template-columns:1fr}' +
      '@media(min-width:720px){.adm-grid{grid-template-columns:1fr 1fr}}' +
      '.adm-card{display:flex;flex-direction:column;gap:8px}' +
      '.adm-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.adm-card-title{font-family:var(--font-pix);font-size:11px;overflow-wrap:anywhere}' +
      '.adm-sub{font-family:var(--font-body);font-size:18px;color:var(--ink-dim);overflow-wrap:anywhere}' +
      '.adm-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
      '.adm-row .btn{min-height:44px}' +
      '.adm-form{display:grid;gap:10px;grid-template-columns:1fr}' +
      '.adm-form label{display:block;font-family:var(--font-pix);font-size:9px;' +
        'color:var(--ink-dim);margin:0 0 4px}' +
      '.adm-form .input,.adm-form .select{width:100%}' +
      '.adm-hint{font-family:var(--font-body);font-size:17px;color:var(--ink-dim);line-height:1.35}' +
      '.adm-check{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer;' +
        'font-family:var(--font-body);font-size:19px}' +
      '.adm-check input{width:22px;height:22px;accent-color:var(--brand)}' +
      '.adm-badge-admin{background:var(--brand);color:#fff}' +
      '.adm-badge-judge{background:var(--blue);color:#fff}' +
      '.adm-badge-rider{background:var(--green);color:#fff}' +
      '.adm-badge-lock{background:var(--red);color:#fff}' +
      '.adm-badge-key{background:var(--gold);color:#3a2408}' +
      '.adm-act{display:inline-block;padding:2px 6px;font-family:var(--font-pix);font-size:8px;' +
        'color:#fff;white-space:nowrap}' +
      '.adm-act-auth{background:var(--blue)}' +
      '.adm-act-create{background:var(--green)}' +
      '.adm-act-update{background:var(--gold);color:#3a2408}' +
      '.adm-act-delete{background:var(--red)}' +
      '.adm-act-report{background:var(--brand)}' +
      '.adm-act-other{background:var(--ink-dim)}' +
      '.adm-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}' +
      '.adm-audit-detail{max-width:34ch;overflow-wrap:anywhere}' +
      '.adm-ridepick{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto;' +
        'padding:4px;border:3px solid var(--line);background:var(--panel-2)}' +
      '.adm-ride{display:flex;align-items:center;gap:10px;min-height:48px;padding:4px 8px;cursor:pointer;' +
        'font-family:var(--font-body);font-size:18px;background:var(--panel)}' +
      '.adm-ride input{width:22px;height:22px;flex:0 0 auto;accent-color:var(--brand)}' +
      '.adm-ride-main{flex:1 1 auto;min-width:0}' +
      '.adm-ride-links{display:flex;gap:6px;flex:0 0 auto}' +
      '.adm-ride-links a{font-family:var(--font-pix);font-size:8px;color:var(--blue);' +
        'text-decoration:none;padding:8px 6px;border:2px solid var(--line);min-height:34px}' +
      '.adm-section-gap{margin-top:14px}' +
      '.adm-filterbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}' +
      '.adm-filterbar .input{flex:1 1 160px}' +
      '.adm-filterbar .select{flex:0 1 auto}';
    var s = document.createElement('style');
    s.id = 'adm-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------ *
   *  Page state
   * ------------------------------------------------------------------ */

  var state = {
    tab: 'users',
    body: null,          // container node for the active tab
    alive: false,        // guards async renders after leaving the page
    cache: { tests: null, events: null }
  };

  var TABS = [
    { id: 'users',    label: 'Users' },
    { id: 'smtp',     label: 'SMTP' },
    { id: 'reports',  label: 'Reports' },
    { id: 'audit',    label: 'Audit log' },
    { id: 'settings', label: 'App settings' }
  ];

  /* ------------------------------------------------------------------ *
   *  USERS TAB
   * ------------------------------------------------------------------ */

  function roleBadge(role) {
    var cls = role === 'admin' ? 'adm-badge-admin' : role === 'judge' ? 'adm-badge-judge' : 'adm-badge-rider';
    return '<span class="badge ' + cls + '">' + esc(role) + '</span>';
  }

  function userForm(u) {
    // u == null → "add" form (username + password fields included).
    var isNew = !u;
    var f = el('<div class="adm-form">' +
      (isNew ?
        '<div><label>Username</label>' +
        '<input class="input" name="username" autocomplete="off" autocapitalize="none" maxlength="40" placeholder="e.g. centerline_carl"></div>' : '') +
      '<div><label>Name</label>' +
      '<input class="input" name="name" maxlength="80" value="' + esc(u && u.name) + '" placeholder="Full name"></div>' +
      '<div><label>Email</label>' +
      '<input class="input" name="email" type="email" maxlength="120" value="' + esc(u && u.email) + '" placeholder="rider@barn.example"></div>' +
      '<div><label>Role</label>' +
      '<select class="select" name="role">' +
        ['rider', 'judge', 'admin'].map(function (r) {
          var sel = (u ? u.role === r : r === 'rider') ? ' selected' : '';
          return '<option value="' + r + '"' + sel + '>' + r + '</option>';
        }).join('') +
      '</select></div>' +
      (isNew ?
        '<div><label>Password</label>' +
        '<input class="input" name="password" type="text" autocomplete="off" maxlength="80" placeholder="First password (they can change it)"></div>' : '') +
      '</div>');
    return f;
  }

  function readForm(form) {
    var out = {};
    form.querySelectorAll('input,select').forEach(function (i) {
      out[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim();
    });
    return out;
  }

  function openUserModal(u, onDone) {
    var form = userForm(u);
    var m = DR.modal({
      title: u ? 'Edit ' + u.username : 'New stablehand',
      body: form,
      actions: [
        { label: 'Cancel', className: 'btn-ghost', onClick: function () { m.close(); } },
        { label: u ? 'Save' : 'Add user', className: 'btn-primary', onClick: function () {
          var v = readForm(form);
          if (!u && !v.username) { DR.toast('A username is required — no nameless horses in this barn.', 'err'); return; }
          if (!u && !v.password) { DR.toast('Give them a first password.', 'err'); return; }
          var p = u
            ? DR.api('PUT', '/api/users/' + u.id, { name: v.name, email: v.email, role: v.role })
            : DR.api('POST', '/api/users', v);
          p.then(function () {
            m.close();
            DR.toast(u ? 'User updated.' : 'Welcome to the stable, ' + v.username + '!', 'ok');
            onDone();
          }).catch(function (e) { apiErr(e, 'Could not save user.'); });
        } }
      ]
    });
  }

  function openPasswordModal(u, onDone) {
    var form = el('<div class="adm-form">' +
      '<div><label>New password for ' + esc(u.username) + '</label>' +
      '<input class="input" name="password" type="text" autocomplete="off" maxlength="80" placeholder="New password"></div>' +
      '<div class="adm-hint">They will be able to change it themselves after logging in.</div>' +
      '</div>');
    var m = DR.modal({
      title: 'Reset password',
      body: form,
      actions: [
        { label: 'Cancel', className: 'btn-ghost', onClick: function () { m.close(); } },
        { label: 'Reset', className: 'btn-primary', onClick: function () {
          var v = readForm(form);
          if (!v.password) { DR.toast('Type the new password first.', 'err'); return; }
          DR.api('PUT', '/api/users/' + u.id, { password: v.password }).then(function () {
            m.close();
            DR.toast('New reins handed to ' + u.username + '.', 'ok');
            onDone();
          }).catch(function (e) { apiErr(e, 'Could not reset password.'); });
        } }
      ]
    });
  }

  function renderUsers(body) {
    body.innerHTML = loadingHTML();
    DR.api('GET', '/api/users').then(function (data) {
      if (!state.alive || state.tab !== 'users') return;
      var users = Array.isArray(data) ? data : (data.users || []);
      var now = Date.now();

      body.innerHTML = '';
      var bar = el('<div class="adm-row" style="margin-bottom:12px">' +
        '<button class="btn btn-primary btn-big" data-act="add">+ Add user</button>' +
        '<span class="adm-hint">' + users.length + ' in the barn</span>' +
        '</div>');
      bar.querySelector('[data-act=add]').addEventListener('click', function () {
        openUserModal(null, function () { renderUsers(body); });
      });
      body.appendChild(bar);

      if (!users.length) {
        body.insertAdjacentHTML('beforeend', emptyHTML('No users yet — an empty barn is a quiet barn.'));
        return;
      }

      var grid = el('<div class="adm-grid"></div>');
      users.forEach(function (u) {
        var locked = u.lockedUntil && u.lockedUntil > now;
        var card = el('<div class="panel adm-card">' +
          '<div class="adm-card-head">' +
            '<span class="adm-card-title">' + esc(u.username) + '</span>' +
            roleBadge(u.role) +
            (locked ? '<span class="badge adm-badge-lock">LOCKED until ' + esc(fmtTs(u.lockedUntil).slice(11)) + '</span>' : '') +
            (u.mustChangePassword ? '<span class="badge adm-badge-key">must change pw</span>' : '') +
          '</div>' +
          '<div class="adm-sub">' + esc(u.name || '—') + ' · ' + esc(u.email || 'no email') + '</div>' +
          (u.failedAttempts ? '<div class="adm-sub">' + u.failedAttempts + ' failed login attempt' + (u.failedAttempts === 1 ? '' : 's') + '</div>' : '') +
          '<div class="adm-row">' +
            '<button class="btn" data-act="edit">Edit</button>' +
            '<button class="btn" data-act="pw">Password</button>' +
            (locked ? '<button class="btn btn-primary" data-act="unlock">Unlock</button>' : '') +
            '<button class="btn btn-danger" data-act="del">Delete</button>' +
          '</div>' +
          '</div>');

        card.querySelector('[data-act=edit]').addEventListener('click', function () {
          openUserModal(u, function () { renderUsers(body); });
        });
        card.querySelector('[data-act=pw]').addEventListener('click', function () {
          openPasswordModal(u, function () { renderUsers(body); });
        });
        var unlockBtn = card.querySelector('[data-act=unlock]');
        if (unlockBtn) unlockBtn.addEventListener('click', function () {
          DR.api('PUT', '/api/users/' + u.id, { unlock: true }).then(function () {
            DR.toast(u.username + ' is back out of the stocks.', 'ok');
            renderUsers(body);
          }).catch(function (e) { apiErr(e, 'Could not unlock user.'); });
        });
        card.querySelector('[data-act=del]').addEventListener('click', function () {
          DR.confirm('Delete ' + u.username + '? Their notes and rides stay in the records.').then(function (yes) {
            if (!yes) return;
            DR.api('DELETE', '/api/users/' + u.id).then(function () {
              DR.toast(u.username + ' has left the stable.', 'ok');
              renderUsers(body);
            }).catch(function (e) { apiErr(e, 'Could not delete user.'); });
          });
        });
        grid.appendChild(card);
      });
      body.appendChild(grid);
    }).catch(function (e) {
      if (!state.alive) return;
      body.innerHTML = emptyHTML('Could not fetch users.');
      apiErr(e, 'Could not fetch users.');
    });
  }

  /* ------------------------------------------------------------------ *
   *  SMTP TAB
   * ------------------------------------------------------------------ */

  function renderSmtp(body) {
    body.innerHTML = loadingHTML();
    DR.api('GET', '/api/settings').then(function (res) {
      if (!state.alive || state.tab !== 'smtp') return;
      var settings = (res && res.settings) || res || {};
      var smtp = settings.smtp || {};
      var hasPass = smtp.pass === '••••' || !!smtp.pass;

      body.innerHTML = '';
      var panel = el('<div class="panel adm-card">' +
        '<div class="h-pix">Mail relay</div>' +
        '<div class="adm-form">' +
          '<div><label>Host</label>' +
          '<input class="input" name="host" autocapitalize="none" value="' + esc(smtp.host) + '" placeholder="smtp.example.com"></div>' +
          '<div><label>Port</label>' +
          '<input class="input" name="port" type="number" inputmode="numeric" min="1" max="65535" value="' + esc(smtp.port != null ? smtp.port : 587) + '"></div>' +
          '<label class="adm-check"><input type="checkbox" name="secure"' + (smtp.secure ? ' checked' : '') + '>' +
            ' Implicit TLS (port 465). Off = STARTTLS on 587/25.</label>' +
          '<div><label>Username</label>' +
          '<input class="input" name="user" autocapitalize="none" autocomplete="off" value="' + esc(smtp.user) + '"></div>' +
          '<div><label>Password</label>' +
          '<input class="input" name="pass" type="password" autocomplete="new-password" value="' + (hasPass ? '••••' : '') + '" placeholder="' + (hasPass ? 'unchanged' : 'no password set') + '">' +
          '<div class="adm-hint">Leave the dots to keep the saved password. Type to replace it, clear the field to remove it.</div></div>' +
          '<div><label>From</label>' +
          '<input class="input" name="from" value="' + esc(smtp.from) + '" placeholder="Pixel Passage &lt;noreply@pixelpassage.horse&gt;"></div>' +
        '</div>' +
        '<div class="adm-row adm-section-gap">' +
          '<button class="btn btn-primary btn-big" data-act="save">Save SMTP</button>' +
          '<button class="btn btn-big" data-act="test">Test connection</button>' +
        '</div>' +
        '</div>');

      var outboxNote = el('<div class="panel adm-card adm-section-gap">' +
        '<div class="h-pix">The outbox never loses a letter</div>' +
        '<div class="adm-hint">If no host is set here, or the mail server refuses the handshake, ' +
        'Pixel Passage does not drop your report — it writes the full email as a <b>.eml</b> file to ' +
        '<b>server/data/outbox/</b> on the server. Open those files in any mail app and send them by hand, ' +
        'or fix the settings above and resend. Straight from the horse’s mouth to the hay bale, one way or another.</div>' +
        '</div>');

      function collect() {
        var v = readForm(panel);
        return {
          host: v.host,
          port: Math.max(1, Math.min(65535, parseInt(v.port, 10) || 587)),
          secure: v.secure,
          user: v.user,
          pass: panel.querySelector('[name=pass]').value, // no trim — dots or literal password
          from: v.from
        };
      }

      panel.querySelector('[data-act=save]').addEventListener('click', function () {
        DR.api('PUT', '/api/settings', { smtp: collect() }).then(function () {
          DR.toast('SMTP settings stabled.', 'ok');
          renderSmtp(body);
        }).catch(function (e) { apiErr(e, 'Could not save SMTP settings.'); });
      });

      panel.querySelector('[data-act=test]').addEventListener('click', function (ev) {
        var btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Testing…';
        DR.api('POST', '/api/smtp/test', {}).then(function (r) {
          var ok = r && (r.ok || r.sent || r.success);
          var msg = (r && (r.message || r.result || r.error)) ||
            (ok ? 'Connection OK — the mail horse is saddled.' : 'Connection failed.');
          DR.toast(msg, ok ? 'ok' : 'err');
        }).catch(function (e) {
          apiErr(e, 'Test failed — check host and port. (Unsaved changes are not tested; save first.)');
        }).then(function () {
          btn.disabled = false;
          btn.textContent = 'Test connection';
        });
      });

      body.appendChild(panel);
      body.appendChild(outboxNote);
    }).catch(function (e) {
      if (!state.alive) return;
      body.innerHTML = emptyHTML('Could not load settings.');
      apiErr(e, 'Could not load settings.');
    });
  }

  /* ------------------------------------------------------------------ *
   *  REPORTS TAB
   * ------------------------------------------------------------------ */

  function loadRefData() {
    // API responses are wrapped: {tests:[]}, {events:[]}, {rides:[]}.
    var unwrap = function (key) {
      return function (res) {
        return Array.isArray(res) ? res : (res && res[key]) || [];
      };
    };
    var jobs = [];
    jobs.push(state.cache.tests ? Promise.resolve(state.cache.tests) :
      DR.api('GET', '/api/tests').then(unwrap('tests')).then(function (t) { state.cache.tests = t; return t; }));
    jobs.push(state.cache.events ? Promise.resolve(state.cache.events) :
      DR.api('GET', '/api/events').then(unwrap('events')).then(function (t) { state.cache.events = t; return t; }));
    jobs.push(DR.api('GET', '/api/rides').then(unwrap('rides')));
    return Promise.all(jobs);
  }

  function testName(tests, id) {
    for (var i = 0; i < tests.length; i++) {
      if (tests[i].id === id) return tests[i].shortName || tests[i].name || id;
    }
    return id || '?';
  }

  function renderReports(body) {
    body.innerHTML = loadingHTML();
    loadRefData().then(function (res) {
      if (!state.alive || state.tab !== 'reports') return;
      var tests = res[0] || [], events = res[1] || [], rides = res[2] || [];
      rides = rides.slice().sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || '')) || (b.updatedAt || 0) - (a.updatedAt || 0);
      });

      var selected = {};   // rideId -> true
      var mode = 'event';

      body.innerHTML = '';
      var panel = el('<div class="panel adm-card">' +
        '<div class="h-pix">Send score reports</div>' +
        '<div class="adm-row" role="tablist" aria-label="Pick rides by">' +
          '<button class="chip on" data-mode="event">By event</button>' +
          '<button class="chip" data-mode="range">Date range</button>' +
          '<button class="chip" data-mode="pick">Hand-pick</button>' +
        '</div>' +
        '<div data-slot="picker"></div>' +
        '<div class="pix-divider"></div>' +
        '<div data-slot="ridelist"></div>' +
        '<div class="adm-form adm-section-gap">' +
          '<div><label>Email to (comma-separated)</label>' +
          '<input class="input" name="emails" type="text" inputmode="email" autocapitalize="none" placeholder="donna@barn.example, owner@barn.example"></div>' +
          '<div><label>Subject (optional)</label>' +
          '<input class="input" name="subject" maxlength="120" placeholder="Scores from today’s show"></div>' +
        '</div>' +
        '<div class="adm-row adm-section-gap">' +
          '<button class="btn btn-primary btn-big" data-act="send">Email report</button>' +
          '<span class="adm-hint" data-slot="count">0 rides selected</span>' +
        '</div>' +
        '<div class="adm-hint adm-section-gap">If mail can’t be delivered, the report lands as a .eml file in ' +
          '<b>server/data/outbox/</b> instead — nothing is ever lost. See the SMTP tab.</div>' +
        '</div>');
      body.appendChild(panel);

      var pickerSlot = panel.querySelector('[data-slot=picker]');
      var listSlot = panel.querySelector('[data-slot=ridelist]');
      var countSlot = panel.querySelector('[data-slot=count]');

      function visibleRides() {
        if (mode === 'event') {
          var evId = pickerSlot.querySelector('[name=event]');
          evId = evId ? evId.value : '';
          return evId ? rides.filter(function (r) { return r.eventId === evId; }) : rides;
        }
        if (mode === 'range') {
          var from = pickerSlot.querySelector('[name=from]').value;
          var to = pickerSlot.querySelector('[name=to]').value;
          return rides.filter(function (r) {
            var d = String(r.date || '').slice(0, 10);
            return (!from || d >= from) && (!to || d <= to);
          });
        }
        return rides; // hand-pick: everything
      }

      function updateCount() {
        var n = Object.keys(selected).length;
        countSlot.textContent = n + ' ride' + (n === 1 ? '' : 's') + ' selected';
      }

      function renderRideList() {
        var vis = visibleRides();
        if (!vis.length) {
          listSlot.innerHTML = emptyHTML('No rides here — the arena is freshly dragged.');
          updateCount();
          return;
        }
        var wrap = el('<div class="adm-ridepick"></div>');
        var allRow = el('<label class="adm-ride"><input type="checkbox" data-all>' +
          '<span class="adm-ride-main"><b>Select all shown (' + vis.length + ')</b></span></label>');
        allRow.querySelector('input').addEventListener('change', function (ev) {
          vis.forEach(function (r) {
            if (ev.target.checked) selected[r.id] = true; else delete selected[r.id];
          });
          renderRideList();
        });
        wrap.appendChild(allRow);

        vis.forEach(function (r) {
          var label = esc(r.rider || '?') + ' on ' + esc(r.horse || '?') +
            ' — ' + esc(testName(tests, r.testId)) +
            ' · ' + esc(r.date || '') +
            (r.status === 'final' && r.finalPct != null ? ' · <b>' + esc(r.finalPct) + '%</b>'
              : ' · in progress');
          var row = el('<label class="adm-ride">' +
            '<input type="checkbox"' + (selected[r.id] ? ' checked' : '') + '>' +
            '<span class="adm-ride-main">' + label + '</span>' +
            '<span class="adm-ride-links">' +
              '<a href="/api/report/ride/' + encodeURIComponent(r.id) + '.html" target="_blank" rel="noopener">HTML</a>' +
              '<a href="/api/report/ride/' + encodeURIComponent(r.id) + '.csv" target="_blank" rel="noopener">CSV</a>' +
            '</span></label>');
          row.querySelector('input').addEventListener('change', function (ev) {
            if (ev.target.checked) selected[r.id] = true; else delete selected[r.id];
            updateCount();
          });
          // Don't toggle the checkbox when tapping a download link.
          row.querySelectorAll('a').forEach(function (a) {
            a.addEventListener('click', function (ev) { ev.stopPropagation(); });
          });
          wrap.appendChild(row);
        });
        listSlot.innerHTML = '';
        listSlot.appendChild(wrap);
        updateCount();
      }

      function renderPicker() {
        if (mode === 'event') {
          var opts = events.slice().sort(function (a, b) {
            return String(a.date).localeCompare(String(b.date));
          }).map(function (ev) {
            return '<option value="' + esc(ev.id) + '">' + esc(ev.date) + ' — ' + esc(ev.title) + '</option>';
          }).join('');
          pickerSlot.innerHTML = '<div class="adm-form"><div><label>Event</label>' +
            '<select class="select" name="event"><option value="">All events</option>' + opts + '</select></div></div>';
          pickerSlot.querySelector('[name=event]').addEventListener('change', renderRideList);
        } else if (mode === 'range') {
          pickerSlot.innerHTML = '<div class="adm-form" style="grid-template-columns:1fr 1fr">' +
            '<div><label>From</label><input class="input" type="date" name="from"></div>' +
            '<div><label>To</label><input class="input" type="date" name="to"></div></div>';
          pickerSlot.querySelectorAll('input').forEach(function (i) {
            i.addEventListener('change', renderRideList);
          });
        } else {
          pickerSlot.innerHTML = '<div class="adm-hint">Every ride in the book, newest first. Tick the ones to send.</div>';
        }
        renderRideList();
      }

      panel.querySelectorAll('[data-mode]').forEach(function (chip) {
        chip.addEventListener('click', function () {
          mode = chip.getAttribute('data-mode');
          panel.querySelectorAll('[data-mode]').forEach(function (c) {
            c.classList.toggle('on', c === chip);
          });
          renderPicker();
        });
      });

      panel.querySelector('[data-act=send]').addEventListener('click', function (ev) {
        var rideIds = Object.keys(selected);
        if (!rideIds.length) { DR.toast('Pick at least one ride first.', 'err'); return; }
        var emails = panel.querySelector('[name=emails]').value
          .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!emails.length) { DR.toast('Who should receive it? Add an email address.', 'err'); return; }
        var bad = emails.filter(function (e2) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e2); });
        if (bad.length) { DR.toast('That address looks off: ' + bad[0], 'err'); return; }
        var subject = panel.querySelector('[name=subject]').value.trim();
        var payload = { rideIds: rideIds, emails: emails };
        if (subject) payload.subject = subject;

        var btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Sending…';
        DR.api('POST', '/api/report', payload).then(function (r) {
          if (r && r.sent) {
            DR.toast('Report cantered off to ' + emails.length + ' inbox' + (emails.length === 1 ? '' : 'es') + '!', 'ok');
          } else {
            var om = DR.modal({
              title: 'Saved to outbox',
              body: '<div class="adm-hint">Mail could not be sent right now, so the report was written to ' +
                '<b>' + esc((r && r.outbox) || 'server/data/outbox/') + '</b> on the server. ' +
                'Nothing was lost — fix SMTP on the SMTP tab and resend, or forward the .eml by hand.</div>',
              actions: [{ label: 'OK', className: 'btn-primary', onClick: function () { om.close(); } }]
            });
            DR.toast('Kept safe in the outbox.', 'info');
          }
        }).catch(function (e) {
          apiErr(e, 'Report could not be generated.');
        }).then(function () {
          btn.disabled = false;
          btn.textContent = 'Email report';
        });
      });

      renderPicker();
    }).catch(function (e) {
      if (!state.alive) return;
      body.innerHTML = emptyHTML('Could not load rides and events.');
      apiErr(e, 'Could not load rides and events.');
    });
  }

  /* ------------------------------------------------------------------ *
   *  AUDIT TAB
   * ------------------------------------------------------------------ */

  function actionClass(action) {
    var a = String(action || '').toLowerCase();
    if (/login|logout|lock|auth|password/.test(a)) return 'adm-act-auth';
    if (/create|add|seed/.test(a)) return 'adm-act-create';
    if (/update|edit|change|settings|reset/.test(a)) return 'adm-act-update';
    if (/delete|remove/.test(a)) return 'adm-act-delete';
    if (/report|send|mail/.test(a)) return 'adm-act-report';
    return 'adm-act-other';
  }

  function renderAudit(body) {
    body.innerHTML = loadingHTML();
    DR.api('GET', '/api/audit?limit=500').then(function (data) {
      if (!state.alive || state.tab !== 'audit') return;
      var entries = Array.isArray(data) ? data : (data.audit || data.entries || []);
      entries = entries.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }); // newest first

      var actions = {};
      entries.forEach(function (e2) { if (e2.action) actions[e2.action] = true; });

      body.innerHTML = '';
      var bar = el('<div class="adm-filterbar">' +
        '<input class="input" type="search" name="q" placeholder="Filter by user, action, detail…">' +
        '<select class="select" name="action"><option value="">All actions</option>' +
          Object.keys(actions).sort().map(function (a) {
            return '<option value="' + esc(a) + '">' + esc(a) + '</option>';
          }).join('') +
        '</select>' +
        '<button class="btn" data-act="refresh">Refresh</button>' +
        '</div>');
      var tableWrap = el('<div class="panel adm-scroll"></div>');
      body.appendChild(bar);
      body.appendChild(tableWrap);

      function draw() {
        var q = bar.querySelector('[name=q]').value.trim().toLowerCase();
        var act = bar.querySelector('[name=action]').value;
        var rows = entries.filter(function (e2) {
          if (act && e2.action !== act) return false;
          if (!q) return true;
          return (String(e2.username || '') + ' ' + String(e2.action || '') + ' ' +
            String(e2.detail || '') + ' ' + String(e2.ip || '')).toLowerCase().indexOf(q) !== -1;
        });
        if (!rows.length) {
          tableWrap.innerHTML = emptyHTML('Nothing in the logbook matches — clean stalls all around.');
          return;
        }
        tableWrap.innerHTML = '<table class="table"><thead><tr>' +
          '<th>When</th><th>Who</th><th>Action</th><th>Detail</th><th>IP</th>' +
          '</tr></thead><tbody>' +
          rows.slice(0, 500).map(function (e2) {
            return '<tr>' +
              '<td style="white-space:nowrap">' + esc(fmtTs(e2.ts)) + '</td>' +
              '<td>' + esc(e2.username || '—') + '</td>' +
              '<td><span class="adm-act ' + actionClass(e2.action) + '">' + esc(e2.action) + '</span></td>' +
              '<td class="adm-audit-detail">' + esc(e2.detail || '') + '</td>' +
              '<td>' + esc(e2.ip || '') + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table>';
      }

      bar.querySelector('[name=q]').addEventListener('input', draw);
      bar.querySelector('[name=action]').addEventListener('change', draw);
      bar.querySelector('[data-act=refresh]').addEventListener('click', function () { renderAudit(body); });
      draw();
    }).catch(function (e) {
      if (!state.alive) return;
      body.innerHTML = emptyHTML('Could not load the audit log.');
      apiErr(e, 'Could not load the audit log.');
    });
  }

  /* ------------------------------------------------------------------ *
   *  APP SETTINGS TAB
   * ------------------------------------------------------------------ */

  function renderSettings(body) {
    body.innerHTML = loadingHTML();
    DR.api('GET', '/api/settings').then(function (res) {
      if (!state.alive || state.tab !== 'settings') return;
      var settings = (res && res.settings) || res || {};
      var app = settings.app || {};

      body.innerHTML = '';
      var panel = el('<div class="panel adm-card">' +
        '<div class="h-pix">App settings</div>' +
        '<div class="adm-form">' +
          '<div><label>Show name</label>' +
          '<input class="input" name="showName" maxlength="60" value="' + esc(app.showName || 'Donna Shar Dressage') + '">' +
          '<div class="adm-hint">Shown in the top bar and on printed reports.</div></div>' +
          '<label class="adm-check"><input type="checkbox" name="transitionHorse"' +
            (app.transitionHorse !== false ? ' checked' : '') + '>' +
            ' Trotting-horse page transitions</label>' +
          '<div><label>Pun level</label>' +
          '<select class="select" name="punLevel">' +
            '<option value="reined-in"' + (app.punLevel === 'reined-in' ? ' selected' : '') + '>Reined-in (calmer)</option>' +
            '<option value="unbridled"' + (app.punLevel !== 'reined-in' ? ' selected' : '') + '>Unbridled (full canter)</option>' +
          '</select></div>' +
        '</div>' +
        '<div class="adm-row adm-section-gap">' +
          '<button class="btn btn-primary btn-big" data-act="save">Save settings</button>' +
        '</div>' +
        '</div>');

      panel.querySelector('[data-act=save]').addEventListener('click', function () {
        var v = readForm(panel);
        var next = {
          showName: v.showName || 'Donna Shar Dressage',
          transitionHorse: v.transitionHorse,
          punLevel: v.punLevel === 'reined-in' ? 'reined-in' : 'unbridled'
        };
        DR.api('PUT', '/api/settings', { app: next }).then(function () {
          // Keep the live shell in step without a reload.
          if (DR.appconfig) {
            DR.appconfig.showName = next.showName;
            DR.appconfig.transitionHorse = next.transitionHorse;
            DR.appconfig.punLevel = next.punLevel;
          }
          DR.toast('Settings saved. ' + (next.punLevel === 'unbridled' ? 'Unbridled it is!' : 'Reined in, as you wish.'), 'ok');
        }).catch(function (e) { apiErr(e, 'Could not save settings.'); });
      });

      body.appendChild(panel);
    }).catch(function (e) {
      if (!state.alive) return;
      body.innerHTML = emptyHTML('Could not load settings.');
      apiErr(e, 'Could not load settings.');
    });
  }

  /* ------------------------------------------------------------------ *
   *  Page shell: tab bar + dispatch
   * ------------------------------------------------------------------ */

  var RENDERERS = {
    users: renderUsers,
    smtp: renderSmtp,
    reports: renderReports,
    audit: renderAudit,
    settings: renderSettings
  };

  function switchTab(id, tabsEl) {
    state.tab = id;
    tabsEl.querySelectorAll('.adm-tab').forEach(function (b) {
      var on = b.getAttribute('data-tab') === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    RENDERERS[id](state.body);
  }

  function render(root) {
    injectCSS();
    state.alive = true;
    root.innerHTML = '';

    var tabs = el('<div class="adm-tabs" role="tablist" aria-label="Admin sections">' +
      TABS.map(function (t) {
        return '<button class="adm-tab" role="tab" data-tab="' + t.id + '" aria-selected="false">' +
          esc(t.label) + '</button>';
      }).join('') +
      '</div>');
    tabs.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.adm-tab');
      if (btn) switchTab(btn.getAttribute('data-tab'), tabs);
    });

    state.body = el('<div class="adm-body"></div>');
    root.appendChild(tabs);
    root.appendChild(state.body);
    switchTab(state.tab in RENDERERS ? state.tab : 'users', tabs);
  }

  function onLeave() {
    state.alive = false;
    state.body = null;
  }

  function register() {
    DR.registerPage('admin', {
      title: 'Admin',
      icon: '⚙️', // gear
      order: 90,
      roles: ['admin'],
      render: render,
      onLeave: onLeave
    });
  }

  if (window.DR && typeof DR.onReady === 'function') {
    DR.onReady(register);
  } else if (window.DR && typeof DR.registerPage === 'function') {
    register();
  }
}());
