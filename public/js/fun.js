/* Pixel Passage — fun.js
 * Puns, loading lines, pixel confetti, and easter eggs (contract §8).
 * Classic script. Loads BEFORE app.js, so everything here is defensive:
 * DR.toast / DR.appconfig / DR.horseParade may not exist yet.
 * No globals beyond window.DR. Zero dependencies.
 */
(function () {
  'use strict';

  var DR = window.DR = window.DR || {};

  /* ------------------------------------------------------------------ *
   * Puns
   * ------------------------------------------------------------------ */

  // Full stable of puns (punLevel 'unbridled').
  DR.puns = [
    'Stable genius at work.',
    'Canter believe that score!',
    'No need to rein it in.',
    'That halt was a bit much.',
    "Straight from the horse's mouth.",
    'Unbridled talent.',
    'Foal-proof plan.',
    'Mane character energy.',
    'Hay, nice transition!',
    "Every day I'm shufflin'… into piaffe.",
    'Quit stalling — the judge is waiting.',
    "You've got to be trotting me.",
    'Half-pass? More like whole sass.',
    'Withers you like it or not, it’s showtime.',
    'Pace yourself. Actually don’t — that’s a gait fault.',
    'Free walk? In this economy?',
    'The judge at C sees everything. Especially that circle.',
    'Twenty-metre circle, nineteen excuses.',
    'Impulsion buying is fine when it’s a horse.',
    'Submission accomplished.',
    'Get your act to-gaits-her.',
    'A perfect ten? Neigh way!',
    'Long and low is a lifestyle.',
    'Shoulder-in, worries out.',
    'Keep calm and canter on.',
    'Behind the vertical, ahead of the drama.',
    'The answer is always more leg.',
    'Inside leg to outside rein — the ancient texts were right.',
    'X marks the halt.',
    'Enter at A, panic at K.',
    'My horse is a 10; my geometry is a 4.',
    'Change of rein, same old excuses.',
    'Foal disclosure: treats were promised.',
    'Bridle party of one.',
    'Neigh-sayers will be lunged.',
    'That flying change really took off.',
    'Halt happens. Salute anyway.',
    'Working trot, hardly working.',
    'In dressage we say “it’s the farrier’s fault.”',
    'Rhythm is a dancer. Also the first thing the judge marks.',
    'Give him a longer rein — he’s earned it.',
    'Some people pursue happiness. We canter after it.',
    'It’s not hoarding if it’s saddle pads.',
    'Sound horse, sound mind.',
    'Serpentine? I hardly know ’er-pentine.',
    'Trot on — professionally.'
  ];

  // Calmer subset for punLevel 'reined-in' (gentle, classic wordplay only).
  var CALM_PUNS = [
    'Stable genius at work.',
    'That halt was a bit much.',
    "Straight from the horse's mouth.",
    'Unbridled talent.',
    'Foal-proof plan.',
    'Keep calm and canter on.',
    'The answer is always more leg.',
    'Inside leg to outside rein — the ancient texts were right.',
    'X marks the halt.',
    'Halt happens. Salute anyway.',
    'Give him a longer rein — he’s earned it.',
    'Sound horse, sound mind.',
    'Working trot, hardly working.',
    'Long and low is a lifestyle.'
  ];

  var LOADING_PUNS = [
    'Braiding the mane…',
    'Dragging the arena…',
    'Polishing the tack…',
    'Warming up at the trot…',
    'Picking hooves…',
    'Memorising the test…',
    'Painting the letters…',
    'Counting strides…',
    'Oiling the bridle…',
    'Finding the other glove…',
    'Convincing the horse the flowers aren’t scary…',
    'Topping up the haynet…',
    'Whitening the saddle pad…',
    'Deciphering the judge’s handwriting…',
    'Rolling the polo wraps…'
  ];

  var LUCK_PUNS = [
    'Lucky horseshoe! Heels up so the luck can’t run out.',
    'Four nails of fortune, freshly tapped.',
    'Shoe-in for a good ride today.',
    'That’s some real farrier-tale luck.',
    'Rub the shoe, ride the ten.'
  ];

  var TEN_PUNS = [
    'A PERFECT TEN! Neigh way!',
    'Ten out of ten — would trot again.',
    'That wasn’t a movement, that was a miracle.',
    'Somebody call the FEI — a unicorn got loose.',
    'Ten! The judge’s pencil is weeping with joy.'
  ];

  // Pick from a pool without repeating the previous pick.
  var lastPick = {};
  function pick(pool, key) {
    if (!pool.length) return '';
    if (pool.length === 1) return pool[0];
    var p;
    do { p = pool[Math.floor(Math.random() * pool.length)]; }
    while (p === lastPick[key]);
    lastPick[key] = p;
    return p;
  }

  DR.pun = function () {
    var reined = DR.appconfig && DR.appconfig.punLevel === 'reined-in';
    return pick(reined ? CALM_PUNS : DR.puns, 'pun');
  };

  DR.loadingPun = function () {
    return pick(LOADING_PUNS, 'loading');
  };

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function reducedMotion() {
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function toast(msg, type) {
    if (typeof DR.toast === 'function') DR.toast(msg, type || 'pun');
  }

  // Inject our CSS once (idempotent).
  function ensureCss() {
    if (document.getElementById('dr-fun-css')) return;
    var s = document.createElement('style');
    s.id = 'dr-fun-css';
    s.textContent = [
      '@keyframes dr-rear{0%{transform:rotate(0)}30%{transform:rotate(-16deg) translateY(-4px)}55%{transform:rotate(-10deg) translateY(-2px)}100%{transform:rotate(0)}}',
      '.dr-rear{animation:dr-rear .7s steps(7);transform-origin:75% 100%}',
      '@keyframes dr-spin{to{transform:rotate(360deg)}}',
      '.dr-spin{animation:dr-spin .7s steps(8)}',
      '.dr-freeze{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;',
      'background:rgba(22,15,7,.78);color:#fff;text-align:center;',
      "font-family:'Press Start 2P',monospace;font-size:clamp(12px,3.4vw,22px);line-height:2.1;letter-spacing:.08em;pointer-events:all}",
      'body.dr-frozen *{animation-play-state:paused!important}',
      '.dr-parade{position:fixed;left:0;right:0;bottom:14%;height:2.4em;overflow:hidden;pointer-events:none;z-index:9999;font-size:24px}',
      '.dr-parade span{position:absolute;left:100%;top:0;will-change:transform;animation:dr-trot-across 2.6s linear forwards}',
      '@keyframes dr-trot-across{to{transform:translateX(calc(-100vw - 4em))}}',
      '.dr-confetti{position:fixed;inset:0;z-index:9998;pointer-events:none;image-rendering:pixelated}',
      '@media (prefers-reduced-motion:reduce){.dr-rear,.dr-spin,.dr-parade span{animation:none}}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------------ *
   * Confetti — canvas pixel confetti (squares + horseshoes)
   * ------------------------------------------------------------------ */

  var PALETTE = ['#e8a33d', '#3e8948', '#c8433b', '#3b6ea5', '#8d5bb9', '#7a4a21'];

  // 5x6 horseshoe bitmap, heels up (open at the top) so the luck stays in.
  var SHOE = [
    '1   1',
    '1   1',
    '1   1',
    '1   1',
    '11 11',
    ' 111 '
  ];

  var confState = null; // { canvas, ctx, parts, raf, killTimer }

  function confettiCleanup() {
    if (!confState) return;
    if (confState.raf) cancelAnimationFrame(confState.raf);
    if (confState.killTimer) clearTimeout(confState.killTimer);
    if (confState.canvas.parentNode) confState.canvas.parentNode.removeChild(confState.canvas);
    confState = null;
  }

  function confettiCanvas() {
    if (confState) return confState;
    ensureCss();
    var canvas = document.createElement('canvas');
    canvas.className = 'dr-confetti crisp';
    canvas.setAttribute('aria-hidden', 'true');
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    confState = { canvas: canvas, ctx: ctx, parts: [], raf: 0, killTimer: 0 };
    return confState;
  }

  function drawShoe(ctx, x, y, cell, color) {
    ctx.fillStyle = color;
    for (var r = 0; r < SHOE.length; r++) {
      for (var c = 0; c < SHOE[r].length; c++) {
        if (SHOE[r][c] !== ' ') {
          ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
        }
      }
    }
  }

  function drawPart(ctx, p, t) {
    // Snap to a 2px grid — chunky, deliberate pixels.
    var x = Math.round(p.x / 2) * 2;
    var y = Math.round(p.y / 2) * 2;
    if (p.kind === 'shoe') {
      drawShoe(ctx, x, y, p.cell, p.color);
    } else {
      // Squares "tumble" by squashing height in steps — no anti-aliased rotation.
      var phase = Math.abs(Math.cos(t / 180 + p.seed));
      var h = Math.max(2, Math.round(p.size * phase / 2) * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y + ((p.size - h) >> 1), p.size, h);
    }
  }

  DR.confetti = function (opts) {
    opts = opts || {};
    var w = window.innerWidth, h = window.innerHeight;
    var ox = typeof opts.x === 'number' ? opts.x : w / 2;
    var oy = typeof opts.y === 'number' ? opts.y : h * 0.35;
    var count = Math.max(8, Math.min(400, opts.count || (w < 480 ? 70 : 110)));

    var st = confettiCanvas();
    var i, p;

    if (reducedMotion()) {
      // Static celebratory sprinkle: one calm frame, then fade away.
      for (i = 0; i < count; i++) {
        p = makePart(ox, oy, true, w, h);
        drawPart(st.ctx, p, 0);
      }
      st.canvas.style.transition = 'opacity .6s linear';
      st.killTimer = setTimeout(function () {
        if (confState) confState.canvas.style.opacity = '0';
        setTimeout(confettiCleanup, 650);
      }, 900);
      return;
    }

    for (i = 0; i < count; i++) st.parts.push(makePart(ox, oy, false, w, h));

    // Hard cap so an event storm can never leave a canvas behind.
    if (st.killTimer) clearTimeout(st.killTimer);
    st.killTimer = setTimeout(confettiCleanup, 6000);

    if (!st.raf) {
      var last = performance.now();
      var tick = function (now) {
        if (!confState) return;
        var dt = Math.min(48, now - last) / 16.67; // ~frames elapsed
        last = now;
        var ctx = confState.ctx;
        ctx.clearRect(0, 0, w, h);
        var parts = confState.parts, alive = [];
        for (var j = 0; j < parts.length; j++) {
          var q = parts[j];
          q.vy += 0.18 * dt;         // gravity
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.vx *= 0.99;
          if (q.y < h + 20) {
            drawPart(ctx, q, now);
            alive.push(q);
          }
        }
        confState.parts = alive;
        if (alive.length) {
          confState.raf = requestAnimationFrame(tick);
        } else {
          confettiCleanup();
        }
      };
      st.raf = requestAnimationFrame(tick);
    }
  };

  function makePart(ox, oy, scattered, w, h) {
    var shoe = Math.random() < 0.22;
    var a = Math.random() * Math.PI * 2;
    var v = 2 + Math.random() * 6;
    return {
      kind: shoe ? 'shoe' : 'sq',
      x: scattered ? Math.random() * w : ox + (Math.random() - 0.5) * 30,
      y: scattered ? Math.random() * h * 0.7 : oy + (Math.random() - 0.5) * 20,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 4,     // bias the burst upward
      size: 4 + Math.floor(Math.random() * 3) * 2, // 4/6/8
      cell: 2,
      seed: Math.random() * 6,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)]
    };
  }

  /* ------------------------------------------------------------------ *
   * Emoji horse parade (toast override + Konami fallback)
   * ------------------------------------------------------------------ */

  function emojiParade() {
    ensureCss();
    if (document.querySelector('.dr-parade')) return; // one parade at a time
    var strip = document.createElement('div');
    strip.className = 'dr-parade';
    strip.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 4; i++) {
      var s = document.createElement('span');
      s.textContent = '🐎';
      s.style.animationDelay = (i * 0.22) + 's';
      strip.appendChild(s);
    }
    document.body.appendChild(strip);
    setTimeout(function () {
      if (strip.parentNode) strip.parentNode.removeChild(strip);
    }, 3800);
  }

  /* ------------------------------------------------------------------ *
   * Freeze overlay — "HALT AT X. SALUTE."
   * ------------------------------------------------------------------ */

  var frozen = false;
  function haltAtX() {
    if (frozen) return;
    frozen = true;
    ensureCss();
    var o = document.createElement('div');
    o.className = 'dr-freeze';
    o.setAttribute('role', 'status');
    o.innerHTML = 'HALT AT X.<br>SALUTE.';
    document.body.appendChild(o);
    document.body.classList.add('dr-frozen');
    setTimeout(function () {
      document.body.classList.remove('dr-frozen');
      if (o.parentNode) o.parentNode.removeChild(o);
      frozen = false;
    }, 1000);
  }

  /* ------------------------------------------------------------------ *
   * Easter-egg wiring
   * ------------------------------------------------------------------ */

  // Per-element tap counting (works for click AND touch — click fires on tap).
  var tapState = new WeakMap();
  function countTap(el, needed, windowMs) {
    var now = Date.now();
    var st = tapState.get(el) || { n: 0, last: 0 };
    st.n = (now - st.last <= windowMs) ? st.n + 1 : 1;
    st.last = now;
    tapState.set(el, st);
    if (st.n >= needed) { st.n = 0; return true; }
    return false;
  }

  function findLogo(target) {
    return target.closest(
      '#logo, .logo, [data-logo], .pix-logo, .brand-logo, ' +
      'header img[src*="logo"], .topbar img[src*="logo"], img[src*="logo.svg"]'
    );
  }

  function findFooterYear(target) {
    var el = target.closest('#year, .year, [data-year], .footer-year, footer time');
    if (el) return el;
    var f = target.closest('footer, .footer, .app-footer');
    if (!f) return null;
    var txt = (target.textContent || '').trim();
    // A short bit of footer text containing a year, e.g. "© 2026"
    if (txt.length <= 24 && /\b20\d{2}\b/.test(txt)) return target;
    return null;
  }

  function runParade() {
    if (typeof DR.horseParade === 'function') DR.horseParade();
    else emojiParade();
  }

  function rear(el) {
    if (!reducedMotion()) {
      el.classList.remove('dr-rear');
      void el.offsetWidth; // restart animation
      el.classList.add('dr-rear');
      el.addEventListener('animationend', function h() {
        el.classList.remove('dr-rear');
        el.removeEventListener('animationend', h);
      });
    }
    toast('🐴 WHINNY! ' + DR.pun(), 'pun');
  }

  // Wrap DR.toast so 5% of toasts become a tiny horse parade.
  // app.js loads after us, so keep trying until the real toast exists.
  function wrapToast() {
    var t = DR.toast;
    if (typeof t !== 'function' || t.__drParade) return false;
    var wrapped = function (msg, type) {
      // Never eat error toasts — data/feedback beats a gag.
      if (type !== 'err' && Math.random() < 0.05 && !reducedMotion()) {
        emojiParade();
        return;
      }
      return t.apply(this, arguments);
    };
    wrapped.__drParade = true;
    DR.toast = wrapped;
    return true;
  }

  DR.initEggs = function () {
    if (DR._eggsWired) return; // idempotent
    DR._eggsWired = true;
    ensureCss();

    // --- taps: logo (rear + pun), footer year (parade), horseshoes (spin + luck)
    document.addEventListener('click', function (e) {
      if (!(e.target instanceof Element)) return;

      var shoe = e.target.closest('.egg-horseshoe');
      if (shoe) {
        if (!reducedMotion()) {
          shoe.classList.remove('dr-spin');
          void shoe.offsetWidth;
          shoe.classList.add('dr-spin');
        }
        toast(pick(LUCK_PUNS, 'luck'), 'pun');
        return;
      }

      var logo = findLogo(e.target);
      if (logo) {
        if (countTap(logo, 5, 1600)) rear(logo);
        return;
      }

      var year = findFooterYear(e.target);
      if (year && countTap(year, 5, 1600)) {
        runParade();
        toast('Hoof, two, three, four — it’s a parade!', 'pun');
      }
    }, true);

    // --- keyboard: Konami code + typing "xhalt"
    var KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown',
                  'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
    var kIdx = 0;
    var typed = '';
    document.addEventListener('keydown', function (e) {
      var key = (e.key || '').toLowerCase();

      // Konami
      kIdx = (key === KONAMI[kIdx]) ? kIdx + 1 : (key === KONAMI[0] ? 1 : 0);
      if (kIdx === KONAMI.length) {
        kIdx = 0;
        runParade();
        toast('KONAMI CANTER!', 'pun');
      }

      // "xhalt" typed anywhere (yes, even mid-note — halt means halt)
      if (key.length === 1 && /[a-z]/.test(key)) {
        typed = (typed + key).slice(-5);
        if (typed === 'xhalt') { typed = ''; haltAtX(); }
      } else if (key !== 'shift') {
        typed = '';
      }
    });

    // --- perfect ten: judge page dispatches CustomEvent 'dr:perfect-ten'
    var lastTen = 0;
    function onTen(e) {
      var now = Date.now();
      if (now - lastTen < 150) return; // window+document double-delivery guard
      lastTen = now;
      var d = (e && e.detail) || {};
      DR.confetti({ count: 150, x: d.x, y: d.y });
      toast(pick(TEN_PUNS, 'ten'), 'pun');
    }
    window.addEventListener('dr:perfect-ten', onTen);
    document.addEventListener('dr:perfect-ten', onTen);

    // --- 5% toast parade override (wrap now, or as soon as app.js provides it)
    if (!wrapToast()) {
      if (typeof DR.onReady === 'function') DR.onReady(wrapToast);
      window.addEventListener('load', wrapToast);
      document.addEventListener('DOMContentLoaded', wrapToast);
    }
  };

  // If the shell never calls DR.initEggs (older shell build), self-arm politely.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () { if (!DR._eggsWired) DR.initEggs(); }, 0);
    });
  } else {
    setTimeout(function () { if (!DR._eggsWired) DR.initEggs(); }, 0);
  }
}());
