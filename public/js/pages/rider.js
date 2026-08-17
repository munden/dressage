/* Pixel Passage — rider.js
 * Rider's Notebook page (contract §6). Classic script, IIFE, zero deps.
 * Talks to /api/notes via DR.api; codes strictly to the §5 DR interface.
 */
(function () {
  'use strict';

  if (!window.DR || typeof DR.registerPage !== 'function') {
    // app.js defines DR before page scripts run; if not, fail loudly but safely.
    console.warn('[rider.js] DR shell not found — rider page not registered.');
    return;
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  var esc = function (s) { return DR.esc(s == null ? '' : String(s)); };

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function fmtDate(iso) {
    try {
      if (typeof DR.fmtDate === 'function') {
        var out = DR.fmtDate(iso);
        if (out) return String(out);
      }
    } catch (e) { /* fall through to plain */ }
    return iso || '';
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function normalizeTag(t) {
    return String(t || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
  }

  function byNewest(a, b) {
    // Sort by ride date desc, then most recently updated first.
    var ad = a.date || '', bd = b.date || '';
    if (ad !== bd) return ad < bd ? 1 : -1;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  }

  /* ------------------------------------------------------------------ *
   * Pixel horseshoe (inline SVG so this page never depends on assets)
   * ------------------------------------------------------------------ */

  var SHOE_PX = [
    // [x, y] cells on a 12x10 grid — a lucky horseshoe, heels up.
    [2, 0], [3, 0], [8, 0], [9, 0],
    [1, 1], [2, 1], [3, 1], [8, 1], [9, 1], [10, 1],
    [1, 2], [2, 2], [9, 2], [10, 2],
    [1, 3], [2, 3], [9, 3], [10, 3],
    [1, 4], [2, 4], [9, 4], [10, 4],
    [1, 5], [2, 5], [9, 5], [10, 5],
    [2, 6], [3, 6], [8, 6], [9, 6],
    [3, 7], [4, 7], [7, 7], [8, 7],
    [4, 8], [5, 8], [6, 8], [7, 8]
  ];

  var shoeSVG = (function () {
    var rects = SHOE_PX.map(function (p) {
      return '<rect x="' + p[0] + '" y="' + p[1] + '" width="1" height="1"/>';
    }).join('');
    return '<svg viewBox="0 0 12 10" aria-hidden="true" class="crisp" ' +
      'style="shape-rendering:crispEdges" fill="currentColor">' + rects + '</svg>';
  })();

  function shoeRow(mood, small) {
    var out = '<span class="rn-shoes' + (small ? ' rn-shoes-sm' : '') + '" aria-label="' +
      (mood ? mood + ' of 5 horseshoes' : 'no mood set') + '">';
    for (var i = 1; i <= 5; i++) {
      out += '<span class="rn-shoe ' + (i <= mood ? 'on' : 'off') + '">' + shoeSVG + '</span>';
    }
    return out + '</span>';
  }

  var MOOD_WORDS = ['', 'Rough ride', 'A bit sticky', 'Solid schooling', 'Lovely work', 'Dream ride!'];

  /* ------------------------------------------------------------------ *
   * Quick-note chips — rider-flavored take on the judge shorthand
   * ------------------------------------------------------------------ */

  function quickNoteGroups() {
    var qn = (window.DR_DEFAULTS && DR_DEFAULTS.quickNotes) || {};
    var groups = [];
    if (qn.praise && qn.praise.length) groups.push({ label: 'Wins', cls: 'ok', items: qn.praise });
    if (qn.faults && qn.faults.length) groups.push({ label: 'Needs work', cls: 'warn', items: qn.faults });
    if (qn.geometry && qn.geometry.length) groups.push({ label: 'Geometry', cls: 'geo', items: qn.geometry });
    if (!groups.length) {
      // Fallback so the page still shines if defaults haven't landed yet.
      groups = [
        { label: 'Wins', cls: 'ok', items: ['forward', 'relaxed', 'soft contact', 'square halt', 'good rhythm', 'uphill'] },
        { label: 'Needs work', cls: 'warn', items: ['tense', 'above bit', 'rushed', 'braced', 'crooked', 'behind leg'] },
        { label: 'Geometry', cls: 'geo', items: ['circle too small', 'off centerline', 'early transition', 'cut corner'] }
      ];
    }
    return groups;
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  var state = {
    notes: [],
    loaded: false,
    q: '',
    tagFilter: [],       // active filter tags on the list view
    view: 'list',        // 'list' | 'edit'
    draft: null,         // note being edited (working copy)
    root: null
  };

  function allTags() {
    var freq = {};
    state.notes.forEach(function (n) {
      (n.tags || []).forEach(function (t) { freq[t] = (freq[t] || 0) + 1; });
    });
    return Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a] || (a < b ? -1 : 1); });
  }

  function allHorses() {
    var seen = {};
    var out = [];
    state.notes.forEach(function (n) {
      var h = String(n.horse || '').trim();
      if (h && !seen[h.toLowerCase()]) { seen[h.toLowerCase()] = true; out.push(h); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  function filteredNotes() {
    var q = state.q.trim().toLowerCase();
    return state.notes.filter(function (n) {
      if (state.tagFilter.length) {
        var tags = n.tags || [];
        var hit = state.tagFilter.some(function (t) { return tags.indexOf(t) !== -1; });
        if (!hit) return false;
      }
      if (!q) return true;
      var hay = [n.title, n.horse, n.text, (n.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    }).sort(byNewest);
  }

  /* ------------------------------------------------------------------ *
   * Personal stats — punny streak lines
   * ------------------------------------------------------------------ */

  function streakLine(count) {
    if (count === 0) return 'No rides logged this fortnight — the tack room misses you.';
    if (count === 1) return '1 ride this fortnight — back in the saddle!';
    if (count <= 3) return count + ' rides this fortnight — trotting right along.';
    if (count <= 6) return count + ' rides this fortnight — unbridled dedication!';
    if (count <= 9) return count + ' rides this fortnight — you’re on a hot streak, no foalin’!';
    return count + ' rides this fortnight — full-on mane character energy!';
  }

  function statsHTML() {
    var now = new Date();
    var fortnightAgo = new Date(now.getTime() - 13 * 86400000); // today counts
    var floorISO = fortnightAgo.getFullYear() + '-' +
      String(fortnightAgo.getMonth() + 1).padStart(2, '0') + '-' +
      String(fortnightAgo.getDate()).padStart(2, '0');
    var ceilISO = todayISO();

    var recent = state.notes.filter(function (n) {
      return n.date && n.date >= floorISO && n.date <= ceilISO;
    });
    var horses = allHorses();
    var moods = state.notes.map(function (n) { return n.mood; }).filter(function (m) { return m >= 1; });
    var avgMood = moods.length ? Math.round(moods.reduce(function (a, b) { return a + b; }, 0) / moods.length) : 0;

    var horseLine;
    if (horses.length === 0) horseLine = 'No horses yet — the stable awaits.';
    else if (horses.length === 1) horseLine = 'One trusty partner: <b>' + esc(horses[0]) + '</b>.';
    else horseLine = horses.length + ' horses ridden — quite the herd!';

    return '' +
      '<div class="panel rn-stats">' +
        '<div class="rn-stats-head h-pix">Stable stats</div>' +
        '<div class="rn-stats-grid">' +
          '<div class="rn-stat"><div class="rn-stat-num">' + recent.length + '</div>' +
            '<div class="rn-stat-label">rides / fortnight</div></div>' +
          '<div class="rn-stat"><div class="rn-stat-num">' + state.notes.length + '</div>' +
            '<div class="rn-stat-label">notes total</div></div>' +
          '<div class="rn-stat"><div class="rn-stat-num">' + horses.length + '</div>' +
            '<div class="rn-stat-label">horses</div></div>' +
          '<div class="rn-stat">' +
            '<div class="rn-stat-num rn-stat-shoes">' + (avgMood ? shoeRow(avgMood, true) : '—') + '</div>' +
            '<div class="rn-stat-label">avg mood</div></div>' +
        '</div>' +
        '<div class="rn-streak">' + esc(streakLine(recent.length)) + '</div>' +
        '<div class="rn-streak rn-streak-dim">' + horseLine + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ *
   * List view
   * ------------------------------------------------------------------ */

  function noteCardHTML(n) {
    var preview = String(n.text || '').replace(/\s+/g, ' ').trim();
    if (preview.length > 140) preview = preview.slice(0, 140) + '…';
    var tags = (n.tags || []).map(function (t) {
      return '<span class="badge rn-tag">' + esc(t) + '</span>';
    }).join('');
    return '' +
      '<button class="panel rn-card" data-note="' + esc(n.id) + '" type="button">' +
        '<div class="rn-card-top">' +
          '<span class="rn-card-date">' + esc(fmtDate(n.date)) + '</span>' +
          shoeRow(n.mood | 0, true) +
        '</div>' +
        '<div class="rn-card-title">' + (esc(n.title) || '<span class="rn-untitled">Untitled ride</span>') + '</div>' +
        (n.horse ? '<div class="rn-card-horse">&#128052; ' + esc(n.horse) + '</div>' : '') +
        (preview ? '<div class="rn-card-preview">' + esc(preview) + '</div>' : '') +
        (tags ? '<div class="rn-card-tags">' + tags + '</div>' : '') +
      '</button>';
  }

  function emptyStateHTML(kind) {
    if (kind === 'no-notes') {
      return '' +
        '<div class="panel rn-empty">' +
          '<div class="rn-empty-art">' + shoeRow(5) + '</div>' +
          '<div class="rn-empty-big h-pix">Fresh as a dragged arena</div>' +
          '<div class="rn-empty-sub">Your notebook is empty. Every great ride starts with a single note — ' +
            'saddle up and jot your first one!</div>' +
          '<button class="btn btn-primary btn-big" data-act="new">&#9998; First note</button>' +
        '</div>';
    }
    return '' +
      '<div class="panel rn-empty">' +
        '<div class="rn-empty-big h-pix">No matches</div>' +
        '<div class="rn-empty-sub">Not a hoofprint in sight for that search. Try loosening the reins.</div>' +
        '<button class="btn btn-ghost" data-act="clear-filters">Clear search &amp; filters</button>' +
      '</div>';
  }

  function listHTML() {
    var tags = allTags();
    var tagChips = tags.map(function (t) {
      var on = state.tagFilter.indexOf(t) !== -1;
      return '<button class="chip' + (on ? ' on' : '') + '" data-tag="' + esc(t) + '" type="button">' +
        esc(t) + '</button>';
    }).join('');

    var notes = filteredNotes();
    var listBody;
    if (!state.notes.length) listBody = emptyStateHTML('no-notes');
    else if (!notes.length) listBody = emptyStateHTML('no-match');
    else listBody = notes.map(noteCardHTML).join('');

    return '' +
      '<div class="rn-wrap">' +
        '<div class="rn-toolbar">' +
          '<input class="input rn-search" id="rn-search" type="search" ' +
            'placeholder="Search notes, horses, tags…" autocomplete="off">' +
          '<button class="btn btn-primary btn-big rn-new" data-act="new" type="button">&#9998; New note</button>' +
        '</div>' +
        (tagChips ? '<div class="rn-tagbar" role="group" aria-label="Filter by tag">' + tagChips + '</div>' : '') +
        statsHTML() +
        '<div class="rn-list" id="rn-list">' + listBody + '</div>' +
      '</div>';
  }

  function bindRootClick(handler) {
    // The page re-renders into the same root; never stack click handlers.
    var el = state.root;
    el.removeEventListener('click', onListClick);
    el.removeEventListener('click', onEditorClick);
    el.addEventListener('click', handler);
  }

  function renderList() {
    state.view = 'list';
    var el = state.root;
    el.innerHTML = listHTML();

    var search = el.querySelector('#rn-search');
    search.value = state.q;
    search.addEventListener('input', function () {
      state.q = search.value;
      refreshListOnly();
    });

    bindRootClick(onListClick);
  }

  function refreshListOnly() {
    // Re-render just the results so the search box keeps focus.
    var list = state.root.querySelector('#rn-list');
    if (!list) return;
    var notes = filteredNotes();
    if (!state.notes.length) list.innerHTML = emptyStateHTML('no-notes');
    else if (!notes.length) list.innerHTML = emptyStateHTML('no-match');
    else list.innerHTML = notes.map(noteCardHTML).join('');
  }

  function onListClick(e) {
    var tagBtn = e.target.closest('[data-tag]');
    if (tagBtn) {
      var t = tagBtn.getAttribute('data-tag');
      var i = state.tagFilter.indexOf(t);
      if (i === -1) state.tagFilter.push(t); else state.tagFilter.splice(i, 1);
      tagBtn.classList.toggle('on', i === -1);
      refreshListOnly();
      return;
    }
    var actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      var act = actBtn.getAttribute('data-act');
      if (act === 'new') { openEditor(null); }
      if (act === 'clear-filters') {
        state.q = ''; state.tagFilter = [];
        renderList();
      }
      return;
    }
    var card = e.target.closest('[data-note]');
    if (card) {
      var id = card.getAttribute('data-note');
      var note = state.notes.find(function (n) { return n.id === id; });
      if (note) openEditor(note);
    }
  }

  /* ------------------------------------------------------------------ *
   * Editor view
   * ------------------------------------------------------------------ */

  var RECAP_TEMPLATE =
    'Warmup:\n- \n\n' +
    'Work:\n- \n\n' +
    'Wins:\n- \n\n' +
    'Homework:\n- \n';

  function openEditor(note) {
    state.draft = note ? {
      id: note.id,
      date: note.date || todayISO(),
      horse: note.horse || '',
      title: note.title || '',
      tags: (note.tags || []).slice(),
      text: note.text || '',
      mood: clamp(note.mood | 0, 0, 5) || 3
    } : {
      id: null, date: todayISO(), horse: '', title: '', tags: [], text: '', mood: 3
    };
    renderEditor();
  }

  function editorHTML(d) {
    var horses = allHorses().map(function (h) {
      return '<option value="' + esc(h) + '"></option>';
    }).join('');

    var moodBtns = '';
    for (var i = 1; i <= 5; i++) {
      moodBtns += '<button type="button" class="rn-mood-btn" data-mood="' + i +
        '" aria-label="' + i + ' horseshoe' + (i > 1 ? 's' : '') + '">' + shoeSVG + '</button>';
    }

    var groups = quickNoteGroups().map(function (g) {
      var chips = g.items.map(function (c) {
        return '<button type="button" class="chip rn-qn" data-qn="' + esc(c) + '">' + esc(c) + '</button>';
      }).join('');
      return '<div class="rn-qn-group"><span class="rn-qn-label rn-qn-' + g.cls + '">' +
        esc(g.label) + '</span>' + chips + '</div>';
    }).join('');

    return '' +
      '<div class="rn-wrap rn-editor">' +
        '<div class="rn-ed-top">' +
          '<button class="btn btn-ghost" data-act="back" type="button">&#9664; Notebook</button>' +
          '<span class="h-pix rn-ed-title">' + (d.id ? 'Edit note' : 'New note') + '</span>' +
        '</div>' +
        '<div class="panel rn-form">' +
          '<div class="rn-row rn-row-2">' +
            '<label class="rn-field"><span class="rn-label">Date</span>' +
              '<input class="input" id="rn-f-date" type="date"></label>' +
            '<label class="rn-field"><span class="rn-label">Horse</span>' +
              '<input class="input" id="rn-f-horse" list="rn-horses" placeholder="e.g. Pixel" ' +
                'maxlength="60" autocomplete="off">' +
              '<datalist id="rn-horses">' + horses + '</datalist></label>' +
          '</div>' +
          '<label class="rn-field"><span class="rn-label">Title</span>' +
            '<input class="input" id="rn-f-title" placeholder="How was the ride?" maxlength="120"></label>' +
          '<div class="rn-field"><span class="rn-label">Tags</span>' +
            '<div class="rn-tags-edit" id="rn-f-tags"></div>' +
            '<div class="rn-tag-addrow">' +
              '<input class="input rn-tag-input" id="rn-f-tag-input" placeholder="add tag + Enter" ' +
                'maxlength="24" autocomplete="off">' +
              '<button class="btn btn-ghost" data-act="add-tag" type="button">+ tag</button>' +
            '</div>' +
            '<div class="rn-tag-suggest" id="rn-tag-suggest"></div>' +
          '</div>' +
          '<div class="rn-field"><span class="rn-label">Mood</span>' +
            '<div class="rn-mood" id="rn-f-mood" role="radiogroup" aria-label="Mood, 1 to 5 horseshoes">' +
              moodBtns + '<span class="rn-mood-word" id="rn-mood-word"></span>' +
            '</div>' +
          '</div>' +
          '<div class="rn-field">' +
            '<div class="rn-text-toolbar">' +
              '<span class="rn-label">Notes</span>' +
              '<button class="btn btn-ghost rn-recap" data-act="recap" type="button" ' +
                'title="Pre-fill Warmup / Work / Wins / Homework">&#128221; Ride recap</button>' +
            '</div>' +
            '<textarea class="input rn-textarea" id="rn-f-text" rows="10" ' +
              'placeholder="How did it go? Tap chips below to add quick notes…"></textarea>' +
          '</div>' +
          '<div class="rn-qn-wrap">' + groups + '</div>' +
          '<div class="rn-actions">' +
            (d.id ? '<button class="btn btn-danger" data-act="delete" type="button">Delete</button>' : '') +
            '<span class="rn-spacer"></span>' +
            '<button class="btn btn-ghost" data-act="back" type="button">Cancel</button>' +
            '<button class="btn btn-primary btn-big" data-act="save" type="button">&#128190; Save note</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderEditor() {
    state.view = 'edit';
    var d = state.draft;
    var el = state.root;
    el.innerHTML = editorHTML(d);

    // Populate values via properties (no attribute-escaping worries).
    el.querySelector('#rn-f-date').value = d.date;
    el.querySelector('#rn-f-horse').value = d.horse;
    el.querySelector('#rn-f-title').value = d.title;
    el.querySelector('#rn-f-text').value = d.text;

    renderDraftTags();
    renderMood();

    bindRootClick(onEditorClick);

    var tagInput = el.querySelector('#rn-f-tag-input');
    tagInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagFromInput(); }
    });
  }

  function renderDraftTags() {
    var d = state.draft;
    var box = state.root.querySelector('#rn-f-tags');
    box.innerHTML = d.tags.length
      ? d.tags.map(function (t) {
          return '<button type="button" class="chip on rn-tag-rm" data-rmtag="' + esc(t) +
            '" aria-label="remove tag ' + esc(t) + '">' + esc(t) + ' &#10005;</button>';
        }).join('')
      : '<span class="rn-tags-none">no tags yet</span>';

    var suggest = state.root.querySelector('#rn-tag-suggest');
    var pool = allTags().filter(function (t) { return d.tags.indexOf(t) === -1; }).slice(0, 10);
    suggest.innerHTML = pool.map(function (t) {
      return '<button type="button" class="chip rn-tag-add" data-addtag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
  }

  function renderMood() {
    var d = state.draft;
    var btns = state.root.querySelectorAll('.rn-mood-btn');
    btns.forEach(function (b, idx) {
      var v = idx + 1;
      b.classList.toggle('on', v <= d.mood);
      b.setAttribute('aria-checked', v === d.mood ? 'true' : 'false');
      b.setAttribute('role', 'radio');
    });
    var word = state.root.querySelector('#rn-mood-word');
    if (word) word.textContent = MOOD_WORDS[d.mood] || '';
  }

  function addTagFromInput() {
    var input = state.root.querySelector('#rn-f-tag-input');
    var t = normalizeTag(input.value);
    if (!t) return;
    if (state.draft.tags.indexOf(t) === -1) {
      if (state.draft.tags.length >= 12) { DR.toast('Whoa — that’s enough tags for one saddle bag.', 'err'); return; }
      state.draft.tags.push(t);
    }
    input.value = '';
    renderDraftTags();
  }

  function appendQuickNote(text) {
    var ta = state.root.querySelector('#rn-f-text');
    var cur = ta.value;
    var sep = !cur ? '' : (/[\s,;.\-]$/.test(cur) ? (/\s$/.test(cur) ? '' : ' ') : ', ');
    ta.value = cur + sep + text;
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  }

  function applyRecapTemplate() {
    var ta = state.root.querySelector('#rn-f-text');
    if (ta.value.trim()) {
      DR.confirm('Replace your current notes with the Ride recap template?').then(function (ok) {
        if (ok) { ta.value = RECAP_TEMPLATE; ta.focus(); }
      });
    } else {
      ta.value = RECAP_TEMPLATE;
      ta.focus();
      DR.toast('Recap saddled up — fill in the blanks!', 'info');
    }
  }

  function collectDraft() {
    var el = state.root;
    var d = state.draft;
    d.date = el.querySelector('#rn-f-date').value || todayISO();
    d.horse = el.querySelector('#rn-f-horse').value.trim().slice(0, 60);
    d.title = el.querySelector('#rn-f-title').value.trim().slice(0, 120);
    d.text = el.querySelector('#rn-f-text').value.slice(0, 20000);
    return d;
  }

  function onEditorClick(e) {
    var moodBtn = e.target.closest('[data-mood]');
    if (moodBtn) {
      state.draft.mood = parseInt(moodBtn.getAttribute('data-mood'), 10);
      renderMood();
      return;
    }
    var rm = e.target.closest('[data-rmtag]');
    if (rm) {
      var t = rm.getAttribute('data-rmtag');
      state.draft.tags = state.draft.tags.filter(function (x) { return x !== t; });
      renderDraftTags();
      return;
    }
    var add = e.target.closest('[data-addtag]');
    if (add) {
      var at = add.getAttribute('data-addtag');
      if (state.draft.tags.indexOf(at) === -1) state.draft.tags.push(at);
      renderDraftTags();
      return;
    }
    var qn = e.target.closest('[data-qn]');
    if (qn) { appendQuickNote(qn.getAttribute('data-qn')); return; }

    var actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    var act = actBtn.getAttribute('data-act');
    if (act === 'back') { renderList(); }
    else if (act === 'add-tag') { addTagFromInput(); }
    else if (act === 'recap') { applyRecapTemplate(); }
    else if (act === 'save') { saveDraft(); }
    else if (act === 'delete') { deleteDraft(); }
  }

  /* ------------------------------------------------------------------ *
   * CRUD via /api/notes
   * ------------------------------------------------------------------ */

  function loadNotes() {
    return DR.api('GET', '/api/notes').then(function (res) {
      // Accept either a bare array or {notes:[...]}.
      var list = Array.isArray(res) ? res : (res && res.notes) || [];
      state.notes = list.slice();
      state.loaded = true;
    });
  }

  function saveDraft() {
    var d = collectDraft();
    if (!d.title && !d.text.trim()) {
      DR.toast('Give the note a title or a few words first — even a whinny will do.', 'err');
      return;
    }
    var body = {
      date: d.date, horse: d.horse, title: d.title,
      tags: d.tags, text: d.text, mood: clamp(d.mood | 0, 1, 5)
    };
    var req = d.id
      ? DR.api('PUT', '/api/notes/' + encodeURIComponent(d.id), body)
      : DR.api('POST', '/api/notes', body);

    req.then(function () {
      DR.toast(d.id ? 'Note updated — smooth as a good half-halt.' : 'Note stabled away safely!', 'ok');
      return loadNotes();
    }).then(function () {
      renderList();
    }).catch(function (err) {
      DR.toast((err && err.error) || 'Couldn’t save the note — reins slipped. Try again?', 'err');
    });
  }

  function deleteDraft() {
    var d = state.draft;
    if (!d.id) return;
    DR.confirm('Turn this note out to pasture for good?').then(function (ok) {
      if (!ok) return;
      DR.api('DELETE', '/api/notes/' + encodeURIComponent(d.id)).then(function () {
        DR.toast('Note deleted. Off to greener pastures.', 'info');
        return loadNotes();
      }).then(function () {
        renderList();
      }).catch(function (err) {
        DR.toast((err && err.error) || 'Couldn’t delete that note.', 'err');
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Page-scoped styles (injected once; everything namespaced .rn-)
   * ------------------------------------------------------------------ */

  var CSS = '' +
    '.rn-wrap{max-width:860px;margin:0 auto;padding:12px;display:grid;gap:14px;' +
      'padding-bottom:calc(24px + env(safe-area-inset-bottom))}' +
    '.rn-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:stretch}' +
    '.rn-search{flex:1 1 200px;min-width:0}' +
    '.rn-new{white-space:nowrap}' +
    '.rn-tagbar{display:flex;gap:8px;flex-wrap:wrap}' +
    /* stats */
    '.rn-stats{padding:14px;display:grid;gap:10px}' +
    '.rn-stats-head{font-size:12px}' +
    '.rn-stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}' +
    '.rn-stat{text-align:center;background:var(--panel-2,rgba(0,0,0,.05));padding:8px 4px;' +
      'border:2px solid var(--line,#0002)}' +
    '.rn-stat-num{font-family:var(--font-pix,monospace);font-size:20px;color:var(--brand,#7a4a21)}' +
    '.rn-stat-shoes{display:flex;justify-content:center}' +
    '.rn-stat-label{font-size:15px;color:var(--ink-dim,#777);margin-top:4px}' +
    '.rn-streak{font-size:19px;text-align:center}' +
    '.rn-streak-dim{color:var(--ink-dim,#777);font-size:17px}' +
    /* horseshoes */
    '.rn-shoes{display:inline-flex;gap:3px;vertical-align:middle}' +
    '.rn-shoe{display:inline-flex;width:22px;height:19px}' +
    '.rn-shoes-sm .rn-shoe{width:15px;height:13px}' +
    '.rn-shoe.on{color:var(--gold,#e8a33d)}' +
    '.rn-shoe.off{color:var(--line,#0003)}' +
    '.rn-shoe svg{width:100%;height:100%;display:block}' +
    /* list cards */
    '.rn-list{display:grid;gap:12px}' +
    '.rn-card{display:block;width:100%;text-align:left;cursor:pointer;padding:12px 14px;' +
      'font:inherit;color:inherit}' +
    '.rn-card-top{display:flex;justify-content:space-between;align-items:center;gap:8px}' +
    '.rn-card-date{font-family:var(--font-pix,monospace);font-size:11px;color:var(--ink-dim,#777)}' +
    '.rn-card-title{font-family:var(--font-pix,monospace);font-size:14px;margin-top:8px;' +
      'line-height:1.5;color:var(--brand,#7a4a21);overflow-wrap:anywhere}' +
    '.rn-untitled{color:var(--ink-dim,#777)}' +
    '.rn-card-horse{margin-top:6px;font-size:18px}' +
    '.rn-card-preview{margin-top:6px;font-size:18px;color:var(--ink-dim,#666);overflow-wrap:anywhere}' +
    '.rn-card-tags{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}' +
    '.rn-tag{text-transform:lowercase}' +
    /* empty states */
    '.rn-empty{text-align:center;padding:28px 16px;display:grid;gap:12px;justify-items:center}' +
    '.rn-empty-art .rn-shoe{width:30px;height:26px}' +
    '.rn-empty-art .rn-shoe.off{color:var(--gold,#e8a33d);opacity:.35}' +
    '.rn-empty-big{font-size:14px}' +
    '.rn-empty-sub{font-size:19px;color:var(--ink-dim,#777);max-width:44ch}' +
    /* editor */
    '.rn-ed-top{display:flex;align-items:center;gap:12px}' +
    '.rn-ed-title{font-size:13px}' +
    '.rn-form{padding:14px;display:grid;gap:14px}' +
    '.rn-row-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
    '@media (max-width:480px){.rn-row-2{grid-template-columns:1fr}}' +
    '.rn-field{display:grid;gap:6px}' +
    '.rn-label{font-family:var(--font-pix,monospace);font-size:10px;color:var(--ink-dim,#777);' +
      'text-transform:uppercase;letter-spacing:1px}' +
    '.rn-tags-edit{display:flex;gap:6px;flex-wrap:wrap;min-height:30px;align-items:center}' +
    '.rn-tags-none{color:var(--ink-dim,#999);font-size:16px}' +
    '.rn-tag-addrow{display:flex;gap:8px}' +
    '.rn-tag-input{flex:1;min-width:0}' +
    '.rn-tag-suggest{display:flex;gap:6px;flex-wrap:wrap}' +
    '.rn-mood{display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
    '.rn-mood-btn{background:none;border:none;padding:6px;cursor:pointer;width:48px;height:44px;' +
      'color:var(--line,#0003);touch-action:manipulation}' +
    '.rn-mood-btn.on{color:var(--gold,#e8a33d)}' +
    '.rn-mood-btn:active{transform:translateY(2px)}' +
    '.rn-mood-btn svg{width:100%;height:100%}' +
    '.rn-mood-word{font-size:18px;color:var(--ink-dim,#777);margin-left:4px}' +
    '.rn-text-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px}' +
    '.rn-textarea{width:100%;min-height:200px;resize:vertical;font-family:var(--font-body,monospace);' +
      'font-size:19px;line-height:1.45}' +
    '.rn-qn-wrap{display:grid;gap:8px}' +
    '.rn-qn-group{display:flex;gap:6px;flex-wrap:wrap;align-items:center}' +
    '.rn-qn-label{font-family:var(--font-pix,monospace);font-size:9px;text-transform:uppercase;' +
      'letter-spacing:1px;margin-right:2px}' +
    '.rn-qn-ok{color:var(--green,#3e8948)}' +
    '.rn-qn-warn{color:var(--red,#c8433b)}' +
    '.rn-qn-geo{color:var(--blue,#3b6ea5)}' +
    '.rn-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}' +
    '.rn-spacer{flex:1}' +
    '@media (prefers-reduced-motion:reduce){.rn-mood-btn:active{transform:none}}';

  function injectStyles() {
    if (document.getElementById('rn-styles')) return;
    var s = document.createElement('style');
    s.id = 'rn-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------ *
   * Page registration
   * ------------------------------------------------------------------ */

  DR.registerPage('rider', {
    title: 'Notebook',
    icon: '📓', // 📓
    order: 20,
    render: function (el) {
      injectStyles();
      state.root = el;
      var pun = (typeof DR.loadingPun === 'function' && DR.loadingPun()) || 'Fluffing the shavings…';
      el.innerHTML = '<div class="rn-wrap"><div class="panel rn-empty">' +
        '<div class="rn-empty-sub">' + esc(pun) + '</div></div></div>';
      loadNotes().then(function () {
        renderList();
      }).catch(function (err) {
        if (err && err.status === 401) return; // shell shows login
        el.innerHTML = '<div class="rn-wrap"><div class="panel rn-empty">' +
          '<div class="rn-empty-big h-pix">Spooked!</div>' +
          '<div class="rn-empty-sub">Couldn’t fetch your notes — the wifi horse bolted. ' +
          'Give it another try in a moment.</div>' +
          '<button class="btn btn-primary" id="rn-retry" type="button">Retry</button></div></div>';
        var retry = el.querySelector('#rn-retry');
        if (retry) retry.addEventListener('click', function () { DR.navigate('rider'); });
      });
    },
    onLeave: function () {
      state.view = 'list';
      state.draft = null;
      state.root = null;
    }
  });
})();
