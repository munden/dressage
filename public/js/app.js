/* ============================================================
   PIXEL PASSAGE — app shell + DR core API
   Defines window.DR BEFORE page scripts run. Classic script.
   ============================================================ */
(function () {
  'use strict';

  var DR = {};
  window.DR = DR;

  /* ---------------- state ---------------- */
  DR.user = null;
  DR.appconfig = { showName: 'Pixel Passage', transitionHorse: true, punLevel: 'unbridled' };

  var pages = {};          // id -> definition
  var pageOrder = [];      // ids in registration order (sorted at render)
  var currentPageId = null;
  var booted = false;
  var readyQueue = [];
  var hashLock = false;
  var miniCalMounted = false;

  /* ---------------- tiny DOM helpers ---------------- */
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---------------- DR.esc ---------------- */
  DR.esc = function (str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------------- DR.api ---------------- */
  DR.api = function (method, path, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).catch(function () {
      throw { status: 0, error: 'Lost the reins — network error. Check your connection.' };
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.status === 401 && path !== '/api/login' && path !== '/api/me') {
          // session died mid-ride — back to the gate
          DR.user = null;
          if (booted) renderLogin('Your session wandered off — please sign in again.');
          throw { status: 401, error: (data && data.error) || 'Not signed in.' };
        }
        if (!res.ok) {
          throw {
            status: res.status,
            error: (data && (data.error || data.message)) || ('Request failed (' + res.status + ')')
          };
        }
        return data;
      });
    });
  };

  /* ---------------- formatting ---------------- */
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  DR.fmtDate = function (d) {
    var dt;
    if (d instanceof Date) dt = d;
    else if (typeof d === 'number') dt = new Date(d);
    else if (typeof d === 'string') {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
      dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
    } else return '';
    if (!dt || isNaN(dt.getTime())) return String(d);
    var now = new Date();
    var yr = dt.getFullYear() === now.getFullYear() ? '' : ' ' + dt.getFullYear();
    return DAYS[dt.getDay()] + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getDate() + yr;
  };

  DR.fmtTime = function (t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t == null ? '' : t));
    if (!m) return String(t == null ? '' : t);
    var h = +m[1], min = m[2], ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + min + ' ' + ap;
  };

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* ---------------- toasts ---------------- */
  var TOAST_ICONS = { info: '📣', ok: '✅', err: '⚠️', pun: '🐴' };

  function toastRoot() {
    var r = document.getElementById('dr-toasts');
    if (!r) {
      r = el('div');
      r.id = 'dr-toasts';
      r.setAttribute('role', 'status');
      r.setAttribute('aria-live', 'polite');
      document.body.appendChild(r);
    }
    return r;
  }

  DR.toast = function (msg, type) {
    type = type || 'info';
    var t = el('div', 'toast toast-' + type);
    t.appendChild(el('span', 'toast-ico', TOAST_ICONS[type] || TOAST_ICONS.info));
    t.appendChild(el('span', 'toast-msg', String(msg == null ? '' : msg)));
    var root = toastRoot();
    while (root.children.length >= 3) root.removeChild(root.firstChild); // keep the stack short
    root.appendChild(t);
    var ttl = type === 'err' ? 5000 : 3200;
    var gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      t.classList.add('leaving');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
    }
    t.addEventListener('click', dismiss);
    setTimeout(dismiss, ttl);
    return t; // handy for pages that want to append an Undo button
  };

  /* ---------------- modal ---------------- */
  DR.modal = function (opts) {
    opts = opts || {};
    var backdrop = el('div', 'modal-backdrop');
    var modal = el('div', 'modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    if (opts.title) {
      var h = el('div', 'modal-title h-pix', opts.title);
      modal.appendChild(h);
    }
    var bodyEl = el('div', 'modal-body');
    if (opts.body && opts.body.nodeType) bodyEl.appendChild(opts.body);
    else if (opts.body != null) bodyEl.innerHTML = String(opts.body);
    modal.appendChild(bodyEl);

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (e) { console.error(e); } }
    }
    var handle = { close: close, el: modal };

    if (opts.actions && opts.actions.length) {
      var acts = el('div', 'modal-actions');
      opts.actions.forEach(function (a) {
        var b = el('button', 'btn ' + (a.className || ''), a.label);
        b.type = 'button';
        b.addEventListener('click', function () {
          var r;
          if (typeof a.onClick === 'function') {
            try { r = a.onClick(handle); } catch (e) { console.error(e); }
          }
          if (r !== false) close(); // return false from onClick to keep the modal open
        });
        acts.appendChild(b);
      });
      modal.appendChild(acts);
    }

    function onKey(e) {
      if (e.key === 'Escape' && opts.dismissable !== false) { e.stopPropagation(); close(); }
    }
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop && opts.dismissable !== false) close();
    });
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // focus the first control for keyboard/screen-reader riders
    setTimeout(function () {
      var f = modal.querySelector('input, select, textarea, button');
      if (f) f.focus();
    }, 30);
    return handle;
  };

  DR.confirm = function (msg) {
    return new Promise(function (resolve) {
      var done = false;
      DR.modal({
        title: 'Hold your horses',
        body: el('p', null, String(msg == null ? '' : msg)),
        dismissable: true,
        onClose: function () { if (!done) { done = true; resolve(false); } },
        actions: [
          { label: 'Cancel', className: 'btn-ghost', onClick: function () { done = true; resolve(false); } },
          { label: 'Yes, do it', className: 'btn-primary', onClick: function () { done = true; resolve(true); } }
        ]
      });
    });
  };

  /* ---------------- pages & navigation ---------------- */
  DR.registerPage = function (id, def) {
    pages[id] = Object.assign({ id: id, title: id, icon: '📄', order: 50 }, def);
    if (pageOrder.indexOf(id) === -1) pageOrder.push(id);
    if (booted && DR.user) renderNav();
  };

  function pageAllowed(p) {
    if (!p) return false;
    if (!p.roles || !p.roles.length) return true;
    return !!DR.user && p.roles.indexOf(DR.user.role) !== -1;
  }

  function visiblePages() {
    return pageOrder
      .map(function (id) { return pages[id]; })
      .filter(pageAllowed)
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  var navToken = 0;

  DR.navigate = function (pageId) {
    if (!DR.user) { renderLogin(); return; }
    var page = pages[pageId];
    if (!page || !pageAllowed(page)) { pageId = 'home'; page = pages.home; }
    if (!page) return;

    var token = ++navToken;
    var swapped = false;
    function swap() {
      if (swapped || token !== navToken) return; // superseded by a newer navigation
      swapped = true;
      doRender(pageId);
    }
    var useHorse = booted && currentPageId && currentPageId !== pageId &&
      DR.appconfig && DR.appconfig.transitionHorse &&
      typeof DR.horseTransition === 'function';
    if (useHorse) {
      try {
        DR.horseTransition(swap);
        setTimeout(swap, 1600); // safety net if the horse forgets to call done()
      } catch (e) { swap(); }
    } else {
      swap();
    }
  };

  function doRender(pageId) {
    var prev = pages[currentPageId];
    if (prev && typeof prev.onLeave === 'function') {
      try { prev.onLeave(); } catch (e) { console.error(e); }
    }
    currentPageId = pageId;
    var page = pages[pageId];

    var main = document.getElementById('dr-page');
    if (!main) { renderShell(); main = document.getElementById('dr-page'); }
    clear(main);
    main.scrollTop = 0;
    window.scrollTo(0, 0);

    try { page.render(main); } catch (e) {
      console.error('Page "' + pageId + '" threw:', e);
      clear(main);
      var oops = el('div', 'panel');
      oops.appendChild(el('h2', 'h-pix', 'Refusal at the fence'));
      oops.appendChild(el('p', null, 'This page stumbled. Try again, or trot back home.'));
      var back = el('button', 'btn btn-primary', 'Back to Home');
      back.addEventListener('click', function () { DR.navigate('home'); });
      oops.appendChild(back);
      main.appendChild(oops);
    }

    document.title = (page.title || 'Pixel Passage') + ' — ' + (DR.appconfig.showName || 'Pixel Passage');
    updateNavActive();
    mountMiniCalendar();

    if (location.hash !== '#/' + pageId) {
      hashLock = true;
      location.hash = '/' + pageId;
    }
    try {
      document.dispatchEvent(new CustomEvent('dr:navigate', { detail: { page: pageId } }));
    } catch (e) { /* older browsers: no biggie */ }
  }

  function pageFromHash() {
    var m = /^#\/([a-z0-9_-]+)/i.exec(location.hash || '');
    return m ? m[1] : null;
  }

  window.addEventListener('hashchange', function () {
    if (hashLock) { hashLock = false; return; }
    if (!DR.user || !booted) return;
    var id = pageFromHash();
    if (id && id !== currentPageId) DR.navigate(id);
  });

  /* ---------------- DR.onReady ---------------- */
  DR.onReady = function (fn) {
    if (booted) { try { fn(); } catch (e) { console.error(e); } }
    else readyQueue.push(fn);
  };
  function flushReady() {
    while (readyQueue.length) {
      var fn = readyQueue.shift();
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  /* ---------------- login screen ---------------- */
  function friendlyLoginError(err) {
    var msg = (err && err.error) || '';
    var low = msg.toLowerCase();
    if (err && err.status === 429) {
      return 'Too many tries from this barn — the gate needs a breather. Wait a few minutes and try again.';
    }
    if (low.indexOf('lock') !== -1 || (err && err.status === 423)) {
      return 'This stall is locked after too many missed passwords. Give it ~15 minutes, then try again. 🔒';
    }
    if (err && err.status === 401) {
      return 'Whoa there — that username and password don’t match. Check your reins and try again.';
    }
    if (err && err.status === 0) return msg;
    return msg || 'Couldn’t sign in. Try again in a moment.';
  }

  function renderLogin(notice) {
    currentPageId = null;
    miniCalMounted = false;
    var app = document.getElementById('app');
    clear(app);

    var wrap = el('div', 'login-wrap');

    // gate art: pixel logo if the asset agent delivered, emoji gate otherwise
    var gate = el('div', 'login-gate');
    var art = el('div', 'gate-art crisp');
    var img = document.createElement('img');
    img.src = 'assets/logo.svg';
    img.alt = '';
    img.className = 'crisp';
    img.addEventListener('error', function () {
      art.removeChild(img);
      art.textContent = '🐴';
    });
    art.appendChild(img);
    gate.appendChild(art);
    wrap.appendChild(gate);

    var panel = el('div', 'panel login-panel');
    panel.appendChild(el('h1', 'login-title', DR.appconfig.showName || 'Pixel Passage'));
    panel.appendChild(el('p', 'login-sub', 'The arena gate is closed. Sign in to ride.'));

    var form = document.createElement('form');
    form.setAttribute('novalidate', '');

    var lu = el('label', null, 'Username');
    lu.setAttribute('for', 'dr-login-user');
    var user = el('input', 'input');
    user.id = 'dr-login-user';
    user.name = 'username';
    user.autocomplete = 'username';
    user.setAttribute('autocapitalize', 'none');
    user.setAttribute('spellcheck', 'false');
    user.required = true;

    var lp = el('label', null, 'Password');
    lp.setAttribute('for', 'dr-login-pass');
    var pass = el('input', 'input');
    pass.id = 'dr-login-pass';
    pass.name = 'password';
    pass.type = 'password';
    pass.autocomplete = 'current-password';
    pass.required = true;

    var errBox = el('div', 'login-err hidden');
    errBox.setAttribute('role', 'alert');
    if (notice) { errBox.textContent = notice; errBox.classList.remove('hidden'); }

    var submit = el('button', 'btn btn-primary btn-big', 'Open the Gate');
    submit.type = 'submit';
    submit.style.width = '100%';
    submit.style.marginTop = '16px';

    form.appendChild(lu); form.appendChild(user);
    form.appendChild(lp); form.appendChild(pass);
    form.appendChild(errBox);
    form.appendChild(submit);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errBox.classList.add('hidden');
      var u = user.value.trim(), p = pass.value;
      if (!u || !p) {
        errBox.textContent = 'Both reins, please — enter a username and password.';
        errBox.classList.remove('hidden');
        return;
      }
      submit.disabled = true;
      var origLabel = submit.textContent;
      var lp2 = (typeof DR.loadingPun === 'function') ? DR.loadingPun() : 'Opening the gate…';
      submit.textContent = lp2;
      DR.api('POST', '/api/login', { username: u, password: p }).then(function (data) {
        DR.user = (data && data.user) || null;
        if (!DR.user) throw { status: 500, error: 'Login came back empty-saddled.' };
        enterApp();
        DR.toast('Welcome back, ' + firstName(DR.user) + '!', 'ok');
      }).catch(function (err) {
        submit.disabled = false;
        submit.textContent = origLabel;
        errBox.textContent = friendlyLoginError(err);
        errBox.classList.remove('hidden');
        pass.value = '';
        pass.focus();
      });
    });

    panel.appendChild(form);
    panel.appendChild(el('div', 'login-hint',
      'Stable staff: ask Donna for your reins. 🎟️'));
    wrap.appendChild(panel);
    app.appendChild(wrap);
    setTimeout(function () { user.focus(); }, 50);
  }

  /* ---------------- change password ---------------- */
  function showChangePassword(forced) {
    var body = el('div');
    if (forced) {
      body.appendChild(el('p', null,
        'Fresh horse, fresh reins — you must pick a new password before riding on.'));
    }
    function field(labelText, id, auto) {
      var l = el('label', null, labelText);
      l.setAttribute('for', id);
      var i = el('input', 'input');
      i.type = 'password';
      i.id = id;
      i.autocomplete = auto;
      body.appendChild(l); body.appendChild(i);
      return i;
    }
    var cur = field('Current password', 'dr-pw-cur', 'current-password');
    var next = field('New password', 'dr-pw-next', 'new-password');
    var again = field('New password, again', 'dr-pw-again', 'new-password');
    var err = el('div', 'login-err hidden');
    err.setAttribute('role', 'alert');
    body.appendChild(err);

    function fail(msg) { err.textContent = msg; err.classList.remove('hidden'); return false; }

    var actions = [{
      label: 'Save new password',
      className: 'btn-primary',
      onClick: function (handle) {
        err.classList.add('hidden');
        if (!cur.value || !next.value) return fail('All three fields, please.');
        if (next.value.length < 6) return fail('New password needs at least 6 characters — a short rein is no rein.');
        if (next.value !== again.value) return fail('Those two new passwords don’t match strides.');
        DR.api('POST', '/api/me/password', { current: cur.value, next: next.value }).then(function () {
          if (DR.user) DR.user.mustChangePassword = false;
          handle.close();
          DR.toast('Password changed. New reins, who dis?', 'ok');
        }).catch(function (e2) {
          fail((e2 && e2.error) || 'Couldn’t change the password.');
        });
        return false; // stay open; we close on success above
      }
    }];
    if (!forced) actions.unshift({ label: 'Cancel', className: 'btn-ghost' });

    DR.modal({
      title: forced ? 'New Reins Required' : 'Change Password',
      body: body,
      dismissable: !forced,
      actions: actions
    });
  }

  /* ---------------- shell ---------------- */
  function firstName(u) {
    return ((u && (u.name || u.username)) || 'rider').split(/\s+/)[0];
  }

  function iconNode(icon, cls) {
    var wrap = el('span', cls);
    if (typeof icon === 'string' && (icon.indexOf('/') !== -1 || /\.(svg|png)$/i.test(icon))) {
      var img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      img.className = 'crisp';
      img.addEventListener('error', function () { wrap.textContent = '📄'; });
      wrap.appendChild(img);
    } else {
      wrap.textContent = icon || '📄';
    }
    return wrap;
  }

  function renderShell() {
    var app = document.getElementById('app');
    clear(app);
    miniCalMounted = false;

    // top bar
    var top = el('header', 'topbar');
    var logo = el('span', 'topbar-logo crisp');
    logo.id = 'dr-logo';
    logo.setAttribute('role', 'button');
    logo.setAttribute('aria-label', 'Pixel Passage logo');
    logo.tabIndex = 0;
    var logoImg = document.createElement('img');
    logoImg.src = 'assets/logo.svg';
    logoImg.alt = '';
    logoImg.className = 'crisp';
    logoImg.addEventListener('error', function () {
      logo.removeChild(logoImg);
      logo.textContent = '🐴';
    });
    logo.appendChild(logoImg);
    logo.addEventListener('click', function () { DR.navigate('home'); });
    top.appendChild(logo);

    var title = el('h1', 'topbar-title', DR.appconfig.showName || 'Pixel Passage');
    top.appendChild(title);

    var chip = el('button', 'user-chip');
    chip.type = 'button';
    chip.setAttribute('aria-label', 'Account menu');
    chip.appendChild(el('span', 'uc-name', firstName(DR.user)));
    var roleBadge = el('span', 'badge ' +
      (DR.user.role === 'admin' ? 'gold' : DR.user.role === 'judge' ? 'blue' : 'green'),
      DR.user.role);
    chip.appendChild(roleBadge);
    chip.addEventListener('click', showUserMenu);
    top.appendChild(chip);
    app.appendChild(top);

    // body: main + sidebar
    var bodyWrap = el('div', 'shell-body');
    var main = el('main', 'page-main');
    main.id = 'dr-page';
    bodyWrap.appendChild(main);

    var aside = el('aside', 'sidebar panel');
    aside.id = 'dr-sidebar';
    bodyWrap.appendChild(aside);
    app.appendChild(bodyWrap);

    // tab bar / rail
    var nav = el('nav', 'tabbar');
    nav.id = 'dr-tabbar';
    nav.setAttribute('aria-label', 'Main navigation');
    app.appendChild(nav);

    renderNav();
    mountMiniCalendar();
  }

  function renderNav() {
    var nav = document.getElementById('dr-tabbar');
    if (!nav) return;
    clear(nav);
    visiblePages().forEach(function (p) {
      var b = el('button', 'tab-btn' + (p.id === currentPageId ? ' active' : ''));
      b.type = 'button';
      b.dataset.page = p.id;
      b.setAttribute('aria-label', p.title);
      b.appendChild(iconNode(p.icon, 'tab-ico crisp'));
      b.appendChild(el('span', 'tab-label', p.title));
      b.addEventListener('click', function () { DR.navigate(p.id); });
      nav.appendChild(b);
    });
  }

  function updateNavActive() {
    var nav = document.getElementById('dr-tabbar');
    if (!nav) return;
    Array.prototype.forEach.call(nav.children, function (b) {
      b.classList.toggle('active', b.dataset.page === currentPageId);
    });
  }

  function mountMiniCalendar() {
    var aside = document.getElementById('dr-sidebar');
    if (!aside) return;
    if (typeof DR.renderMiniCalendar === 'function') {
      if (miniCalMounted) return;
      clear(aside);
      aside.appendChild(el('h3', 'h-pix', 'Arena Calendar'));
      var host = el('div');
      try {
        DR.renderMiniCalendar(host);
        miniCalMounted = true;
      } catch (e) {
        console.error('mini calendar:', e);
        host.appendChild(el('p', 'dim', 'The calendar spooked. It’ll settle.'));
      }
      aside.appendChild(host);
    } else if (!miniCalMounted && !aside.firstChild) {
      // calendar module not loaded (yet) — charming placeholder
      aside.appendChild(el('h3', 'h-pix', 'Arena Calendar'));
      var ph = el('div', 'empty-state');
      ph.appendChild(el('span', 'empty-art', '📅'));
      ph.appendChild(document.createTextNode('The calendar is out grazing.'));
      aside.appendChild(ph);
    }
  }

  function showUserMenu() {
    var body = el('div');
    var p = el('p');
    p.appendChild(document.createTextNode('Signed in as '));
    var strong = el('strong', null, (DR.user.name || DR.user.username));
    p.appendChild(strong);
    p.appendChild(document.createTextNode(' (' + DR.user.role + ')'));
    body.appendChild(p);
    DR.modal({
      title: 'Tack Room',
      body: body,
      actions: [
        { label: 'Change password', className: '', onClick: function () { showChangePassword(false); } },
        {
          label: 'Dismount (log out)', className: 'btn-danger', onClick: function () {
            DR.api('POST', '/api/logout').catch(function () { /* session may already be gone */ })
              .then(function () {
                DR.user = null;
                renderLogin();
                DR.toast('Unsaddled. See you at the barn! 👋', 'info');
              });
          }
        },
        { label: 'Back to the arena', className: 'btn-ghost' }
      ]
    });
  }

  /* ---------------- Home page ---------------- */
  DR.registerPage('home', {
    title: 'Home',
    icon: '🏠',
    order: 0,
    render: renderHome
  });

  function renderHome(root) {
    var u = DR.user;

    // hero
    var hero = el('div', 'panel home-hero');
    hero.appendChild(el('h2', 'home-greet', 'Good ride, ' + firstName(u) + '!'));
    var pun = (typeof DR.pun === 'function') ? DR.pun() : 'Welcome back to the arena.';
    var punEl = el('p', 'home-pun', '“' + pun + '”');
    punEl.title = 'Pun of the moment';
    hero.appendChild(punEl);
    // idle horse mascot if the pixelart agent delivered
    if (typeof DR.horseIdleMount === 'function') {
      var mount = el('div', 'crisp');
      mount.style.marginTop = '8px';
      try { DR.horseIdleMount(mount, { mood: 5 }); hero.appendChild(mount); } catch (e) { /* horse is shy */ }
    }
    root.appendChild(hero);

    // big nav tiles for whichever page modules actually loaded
    var tiles = el('div', 'home-tiles');
    var wanted = [
      { id: 'judge', label: 'Judge', ico: '📋' },
      { id: 'rider', label: 'Notebook', ico: '📓' },
      { id: 'calendar', label: 'Calendar', ico: '📅' },
      { id: 'admin', label: 'Stable Office', ico: '🔑' }
    ];
    wanted.forEach(function (w) {
      var p = pages[w.id];
      if (!p || !pageAllowed(p)) return;
      var t = el('button', 'home-tile');
      t.type = 'button';
      t.appendChild(iconNode(p.icon || w.ico, 'tile-ico crisp'));
      t.appendChild(el('span', null, p.title || w.label));
      t.addEventListener('click', function () { DR.navigate(w.id); });
      tiles.appendChild(t);
    });
    if (tiles.children.length) root.appendChild(tiles);

    // stats strip
    var stats = el('div', 'stat-strip');
    root.appendChild(stats);

    // today's events
    var evPanel = el('div', 'panel');
    var evHead = el('h3', 'h-pix', 'Today at the Arena');
    evPanel.appendChild(evHead);
    var evBody = el('div');
    evBody.appendChild(el('p', 'dim', (typeof DR.loadingPun === 'function' ? DR.loadingPun() : 'Fetching the day sheet…')));
    evPanel.appendChild(evBody);
    root.appendChild(evPanel);

    var isJudge = u.role === 'judge' || u.role === 'admin';
    var today = todayISO();

    Promise.allSettled([
      DR.api('GET', '/api/events'),
      DR.api('GET', '/api/notes'),
      isJudge ? DR.api('GET', '/api/rides') : Promise.reject({ skipped: true })
    ]).then(function (results) {
      if (!root.isConnected) return; // user already trotted elsewhere

      var events = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
      var notes = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : [];
      var rides = results[2].status === 'fulfilled' && Array.isArray(results[2].value) ? results[2].value : null;

      // --- stats ---
      var upcoming = events.filter(function (e) { return e && e.date >= today; });
      function stat(num, label) {
        var s = el('div', 'panel stat-tile');
        s.appendChild(el('span', 'stat-num', String(num)));
        s.appendChild(el('span', 'stat-label', label));
        return s;
      }
      clear(stats);
      if (rides) {
        var inProg = rides.filter(function (r) { return r && r.status === 'in-progress'; }).length;
        stats.appendChild(stat(rides.length, 'rides judged'));
        if (inProg) stats.appendChild(stat(inProg, 'in progress'));
      }
      stats.appendChild(stat(notes.length, notes.length === 1 ? 'notebook entry' : 'notebook entries'));
      stats.appendChild(stat(upcoming.length, 'events ahead'));

      // --- today's events ---
      clear(evBody);
      var todays = events.filter(function (e) { return e && e.date === today; })
        .sort(function (a, b) { return String(a.start || '').localeCompare(String(b.start || '')); });
      if (!todays.length) {
        var empty = el('div', 'empty-state');
        empty.appendChild(el('span', 'empty-art', '🧹'));
        empty.appendChild(document.createTextNode('No events today — the arena is freshly dragged.'));
        evBody.appendChild(empty);
      } else {
        todays.forEach(function (ev) {
          var card = el('div', 'event-card');
          card.appendChild(el('span', 'ev-time', ev.start ? DR.fmtTime(ev.start) : '—'));
          var bodyCol = el('span', 'ev-body');
          bodyCol.appendChild(el('span', 'ev-title', ev.title || 'Untitled event'));
          var sub = el('span', 'ev-sub');
          var bits = [];
          if (ev.end) bits.push('until ' + DR.fmtTime(ev.end));
          if (ev.entries && ev.entries.length) bits.push(ev.entries.length + ' entries');
          sub.textContent = bits.join(' · ');
          bodyCol.appendChild(sub);
          card.appendChild(bodyCol);
          var ringCls = { A: 'ring-a', B: 'ring-b', warmup: 'ring-warmup', clinic: 'ring-clinic' }[ev.ring] || 'ring-other';
          card.appendChild(el('span', 'badge ' + ringCls, ev.ring === 'A' || ev.ring === 'B' ? 'Ring ' + ev.ring : (ev.ring || 'other')));
          if (pages.calendar && pageAllowed(pages.calendar)) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', function () { DR.navigate('calendar'); });
          }
          evBody.appendChild(card);
        });
      }
    });
  }

  /* ---------------- boot ---------------- */
  function enterApp() {
    renderShell();
    if (typeof DR.initEggs === 'function') {
      try { DR.initEggs(); } catch (e) { console.error('eggs:', e); }
    }
    var target = pageFromHash() || 'home';
    DR.navigate(target);
    if (DR.user && DR.user.mustChangePassword) showChangePassword(true);
  }

  function boot() {
    Promise.allSettled([
      DR.api('GET', '/api/appconfig'),
      DR.api('GET', '/api/me')
    ]).then(function (results) {
      if (results[0].status === 'fulfilled' && results[0].value) {
        DR.appconfig = Object.assign({}, DR.appconfig, results[0].value);
      }
      DR.user = (results[1].status === 'fulfilled' && results[1].value && results[1].value.user) || null;

      booted = true;
      flushReady(); // page scripts queued via DR.onReady register now

      if (DR.user) enterApp();
      else renderLogin();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
