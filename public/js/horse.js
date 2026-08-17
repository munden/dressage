/* ==========================================================================
   PIXEL PASSAGE — horse.js (pixelart agent)
   The signature horse in motion:
     DR.horseTransition(done)   sweeping-curtain page transition (~650ms)
     DR.horseParade()           full-screen gallop easter egg
     DR.horseIdleMount(el, o)   idle horse: blinks, flicks tail, piaffes on tap
   Zero dependencies; works even if app.js hasn't booted (attaches to a
   bare window.DR namespace) and degrades to a fast fade under
   prefers-reduced-motion.
   ========================================================================== */
(function () {
  'use strict';

  var DR = (window.DR = window.DR || {});

  var TRANSITION_MS = 650; // full sweep; page swap at the midpoint
  var FADE_MS = 160;       // reduced-motion fallback

  function reducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function el(tag, className, parent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }

  function remove(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  // call fn exactly once, whatever path fires first
  function once(fn) {
    var called = false;
    return function () {
      if (called) return;
      called = true;
      if (typeof fn === 'function') fn();
    };
  }

  var animate = typeof Element !== 'undefined' && Element.prototype.animate
    ? function (node, frames, opts) { return node.animate(frames, opts); }
    : null;

  /* ------------------------------------------------------------------------
     DR.horseTransition(done)
     A saddle-brown curtain with a gold leading rail sweeps left -> right;
     the pixel horse trots along the rail. done() fires at the midpoint,
     while the screen is fully covered, so the page swaps unseen.
     Transform-only (one translateX on the panel; the sprite loop is a
     background-position steps() animation) — cheap at 60fps.
     ------------------------------------------------------------------------ */
  var transitionBusy = false;

  DR.horseTransition = function (done) {
    var swap = once(done);
    if (!document.body || transitionBusy || !animate) {
      // no stage (or a sweep already mid-flight): swap immediately
      swap();
      return;
    }

    if (reducedMotion()) {
      // fast fade: brief veil, swap underneath, lift
      var veil = el('div', 'pp-fade', document.body);
      transitionBusy = true;
      var lift = function () {
        var out = animate(veil, [{ opacity: 1 }, { opacity: 0 }],
          { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' });
        out.onfinish = out.oncancel = function () {
          remove(veil);
          transitionBusy = false;
        };
      };
      var into = animate(veil, [{ opacity: 0 }, { opacity: 1 }],
        { duration: FADE_MS, easing: 'ease-in', fill: 'forwards' });
      into.onfinish = into.oncancel = function () { swap(); lift(); };
      // belt and braces: never leave the veil up
      setTimeout(function () { swap(); remove(veil); transitionBusy = false; },
        FADE_MS * 2 + 300);
      return;
    }

    transitionBusy = true;
    var stage = el('div', 'pp-curtain', document.body);
    var panel = el('div', 'pp-curtain__panel', stage);
    el('div', 'spr-horse-trot crisp pp-curtain__horse', panel);

    var cleanup = once(function () {
      remove(stage);
      transitionBusy = false;
    });

    // panel is 170vw wide: travels 270vw so the viewport is fully covered
    // for a comfortable window around the midpoint
    var sweep = animate(panel, [
      { transform: 'translateX(-170vw)' },
      { transform: 'translateX(100vw)' }
    ], { duration: TRANSITION_MS, easing: 'linear', fill: 'forwards' });
    sweep.onfinish = sweep.oncancel = cleanup;

    setTimeout(swap, TRANSITION_MS / 2);      // swap under full cover
    setTimeout(cleanup, TRANSITION_MS + 400); // safety net
  };

  /* ------------------------------------------------------------------------
     DR.horseParade()
     Konami-canter: a herd gallops across the screen at staggered heights,
     sizes and speeds (small = far away). Auto-cleans up; re-entrant calls
     while a parade is running are ignored.
     ------------------------------------------------------------------------ */
  var paradeStage = null;

  DR.horseParade = function () {
    if (!document.body || paradeStage) return;

    if (reducedMotion() || !animate) {
      // one dignified horse, center stage, no sweep
      var solo = el('div', 'pp-parade', document.body);
      var still = el('div', 'spr-horse-idle crisp', solo);
      still.style.cssText =
        'position:absolute;left:50%;top:40%;margin-left:-64px;--spr-size:128px;';
      paradeStage = solo;
      setTimeout(function () { remove(solo); paradeStage = null; }, 1600);
      return;
    }

    var stage = el('div', 'pp-parade', document.body);
    paradeStage = stage;
    var vh = window.innerHeight || 600;
    var herd = 7;
    var running = 0;
    var disband = once(function () { remove(stage); paradeStage = null; });

    for (var i = 0; i < herd; i++) {
      var horse = el('div', 'spr-horse-trot crisp', stage);
      var size = 48 + Math.round(Math.random() * 96);       // 48..144px
      var lane = Math.round((0.08 + 0.72 * (i / herd)) * vh); // spread lanes
      horse.style.setProperty('--spr-size', size + 'px');
      horse.style.top = lane + 'px';
      horse.style.animationDuration = '0.34s'; // flat-out gallop cadence
      var duration = 2600 - size * 9 + Math.random() * 500; // big = fast/near
      var run = animate(horse, [
        { transform: 'translateX(-160px)' },
        { transform: 'translateX(100vw)' }
      ], {
        duration: Math.max(1100, duration),
        delay: Math.random() * 650,
        easing: 'linear',
        fill: 'both'
      });
      running++;
      run.onfinish = run.oncancel = function () {
        if (--running <= 0) disband();
      };
    }
    setTimeout(disband, 4500); // safety net
  };

  /* ------------------------------------------------------------------------
     DR.horseIdleMount(el, {mood})
     Mounts a living idle horse: random blinks, tail flicks and ear swivels
     from the 4-frame idle sheet; tap/click (or Enter/Space) -> piaffe.
     mood: 1..5 horseshoes (rider notebook scale) or 'sleepy'|'neutral'|
     'perky'. Sleepy horses doze ears-back; perky ones flick and blink more.
     Returns { destroy(), piaffe() }; remounting on the same element replaces
     the previous horse.
     ------------------------------------------------------------------------ */
  var IDLE_FRAMES = { neutral: 0, blink: 1, flick: 2, ears: 3 };

  DR.horseIdleMount = function (host, opts) {
    if (!host || !host.appendChild) return null;
    if (host.__ppIdle) host.__ppIdle.destroy();

    var mood = (opts && opts.mood) != null ? opts.mood : 'neutral';
    if (typeof mood === 'number') {
      mood = mood <= 2 ? 'sleepy' : mood >= 4 ? 'perky' : 'neutral';
    }
    var tempo = mood === 'perky' ? 0.6 : mood === 'sleepy' ? 1.7 : 1;

    var wrap = el('div', 'pp-idle');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'A pixel horse. Tap for a piaffe.');
    wrap.setAttribute('tabindex', '0');
    var horse = el('div', 'spr-horse-idle crisp', wrap);
    host.appendChild(wrap);

    var timers = [];
    var dancing = false;
    var destroyed = false;

    function later(fn, ms) {
      var t = setTimeout(fn, ms);
      timers.push(t);
      return t;
    }
    function setFrame(i) {
      horse.style.backgroundPosition =
        'calc(var(--spr-size, 64px) * -' + i + ') 0px';
    }

    // one random fidget, then schedule the next
    function fidget() {
      if (destroyed || dancing) return;
      var roll = Math.random();
      if (mood === 'sleepy' && roll < 0.45) {
        setFrame(IDLE_FRAMES.ears);               // dozing
        later(function () { setFrame(IDLE_FRAMES.blink); }, 900);
        later(function () { setFrame(IDLE_FRAMES.neutral); }, 1500);
      } else if (roll < 0.5) {
        setFrame(IDLE_FRAMES.blink);              // blink
        later(function () { setFrame(IDLE_FRAMES.neutral); }, 130);
      } else if (roll < 0.8) {
        setFrame(IDLE_FRAMES.flick);              // double tail flick
        later(function () { setFrame(IDLE_FRAMES.neutral); }, 180);
        later(function () { setFrame(IDLE_FRAMES.flick); }, 360);
        later(function () { setFrame(IDLE_FRAMES.neutral); }, 540);
      } else {
        setFrame(IDLE_FRAMES.ears);               // listen behind
        later(function () { setFrame(IDLE_FRAMES.neutral); }, 600);
      }
      schedule();
    }
    function schedule() {
      if (destroyed || reducedMotion()) return; // still horse, calm horse
      later(fidget, (900 + Math.random() * 2400) * tempo);
    }

    function piaffe() {
      if (destroyed || dancing) return;
      dancing = true;
      horse.className = 'spr-horse-piaffe crisp';
      // under reduced motion the CSS freezes this on the lifted-diagonal
      // pose, which still reads as the answer to the tap
      later(function () {
        horse.className = 'spr-horse-idle crisp';
        setFrame(IDLE_FRAMES.neutral);
        dancing = false;
        schedule();
      }, 1900);
    }

    function onTap(ev) {
      if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
      if (ev.type === 'keydown') ev.preventDefault();
      piaffe();
    }
    wrap.addEventListener('click', onTap);
    wrap.addEventListener('keydown', onTap);

    function destroy() {
      destroyed = true;
      timers.forEach(clearTimeout);
      timers.length = 0;
      wrap.removeEventListener('click', onTap);
      wrap.removeEventListener('keydown', onTap);
      remove(wrap);
      if (host.__ppIdle === handle) delete host.__ppIdle;
    }

    setFrame(IDLE_FRAMES.neutral);
    schedule();

    var handle = { el: wrap, destroy: destroy, piaffe: piaffe };
    host.__ppIdle = handle;
    return handle;
  };
})();
