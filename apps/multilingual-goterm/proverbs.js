/* ============================================================
   Proverbs section — 围棋棋谚 maintenance
   Loaded after app.js and uses the shared GoShared surface.
   ============================================================ */
(function () {
  'use strict';

  var BUNDLE = window.GO_PROVERBS_BUNDLE;
  var SHARED = window.GoShared;

  if (!BUNDLE || !Array.isArray(BUNDLE.proverbs) || !BUNDLE.proverbs.length || !SHARED) {
    return;
  }

  var LS_KEY = 'goterm.proverbs.v1';
  var LS_DISMISS = 'goterm.snapshotDismissed.proverbs';
  var el = {};
  var BASELINE = new Map(BUNDLE.proverbs.map(function (item) {
    return [Number(item.id), normalize(item, item.id)];
  }));

  var state = {
    items: [],
    query: '',
    category: 'ALL',
    filter: 'all',
    sort: 'order',
    dir: 'asc',
    selected: new Set(),
    editingId: null,
    history: [],
    future: [],
    savedAt: null,
    fileDirty: false,
    jsonHandle: null,
    stamp: BUNDLE.stamp,
  };

  var editorDirty = false;
  var editorOpen = false;
  var editorMode = 'edit';
  var editorOriginal = null;
  var editorHideTimer = null;
  var mediaDraft = [];
  var persistTimer = null;
  var storageWarned = false;

  var CATEGORY_ORDER = Object.keys(BUNDLE.counts_by_category || {});

  function $(id) { return document.getElementById(id); }
  function esc(value) { return SHARED.escapeHtml(value); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  /* ---------------- model ---------------- */
  function normalize(raw, idOverride) {
    raw = raw || {};
    var simplified = String(raw.simplified == null ? '' : raw.simplified)
      .normalize('NFKC').replace(/\s+/g, '');
    var traditional = String(raw.traditional == null ? '' : raw.traditional)
      .normalize('NFKC').replace(/\s+/g, '');
    if (traditional === simplified) traditional = '';
    var pinyin = String(raw.pinyin == null ? '' : raw.pinyin)
      .normalize('NFC').replace(/\s+/g, ' ').trim();
    var sourceId = idOverride != null ? idOverride : raw.id;
    var numericId = Number(sourceId);
    if (!Number.isFinite(numericId)) numericId = Number(raw.id) || 0;

    return {
      id: numericId,
      category: String(raw.category == null ? '' : raw.category).trim(),
      order: Number(raw.order) || 0,
      simplified: simplified,
      traditional: traditional,
      pinyin: pinyin,
      pinyin_plain: SHARED.toPlain(pinyin),
      english: String(raw.english == null ? '' : raw.english).replace(/\s+/g, ' ').trim(),
      explanation_zh: String(raw.explanation_zh == null ? '' : raw.explanation_zh).replace(/\s+/g, ' ').trim(),
      source: String(raw.source == null ? '' : raw.source).trim(),
      source_url: String(raw.source_url == null ? '' : raw.source_url).trim(),
      notes: String(raw.notes == null ? '' : raw.notes).replace(/\s+/g, ' ').trim(),
      media: window.GoMedia ? window.GoMedia.normalizeMedia(raw.media) : [],
    };
  }

  function signature(item) {
    return JSON.stringify([
      item.id, item.category, item.order, item.simplified, item.traditional,
      item.pinyin, item.pinyin_plain, item.english, item.explanation_zh,
      item.source, item.source_url, item.notes,
      (item.media || []).map(function (m) {
        return m.type + '|' + m.name + '|' + m.data.length + '|' + m.data.slice(0, 48) + '|' + m.data.slice(-32);
      }),
    ]);
  }

  function isEdited(item) {
    var base = BASELINE.get(Number(item.id));
    return !base || signature(base) !== signature(item);
  }

  function editedCount() {
    return state.items.filter(isEdited).length;
  }

  function nextId() {
    var max = 0;
    state.items.forEach(function (item) { max = Math.max(max, Number(item.id) || 0); });
    return max + 1;
  }

  function dupKey(item) {
    return item.simplified + '\u0000' + item.pinyin;
  }

  function buildIndex(items) {
    var index = { byKey: new Map(), idCounts: new Map() };
    items.forEach(function (item) {
      var key = dupKey(item);
      if (!index.byKey.has(key)) index.byKey.set(key, []);
      index.byKey.get(key).push(item);
      index.idCounts.set(item.id, (index.idCounts.get(item.id) || 0) + 1);
    });
    return index;
  }

  function issuesFor(item, index) {
    var issues = [];
    function push(level, field, message) { issues.push({ level: level, field: field, message: message }); }

    if (!item.category) push('warning', 'category', 'The proverb needs a category.');
    if (!item.simplified) push('error', 'simplified', 'The Chinese proverb is required.');
    else if (!/^[\u3400-\u9FFF\u3007\uF900-\uFAFF，。；：、！？·「」『』（）,.;:!?'"()]+$/.test(item.simplified)) {
      push('warning', 'simplified', 'The proverb contains characters outside the CJK range.');
    }
    if (!item.pinyin) push('warning', 'pinyin', 'Pinyin is missing.');
    else if (!/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(item.pinyin)) {
      push('note', 'pinyin', 'The pinyin has no tone marks — check the reading.');
    }
    if (!item.english) push('warning', 'english', 'The English rendering is missing.');
    if (!item.explanation_zh) push('warning', 'explanation_zh', 'A Chinese explanation is missing.');
    if (!item.source) push('warning', 'source', 'The source is missing.');
    if (item.source_url && !/^https?:\/\//i.test(item.source_url)) {
      push('warning', 'source_url', 'The source URL is not an http(s) address.');
    }

    var duplicates = (index.byKey.get(dupKey(item)) || []).filter(function (other) { return other !== item; });
    duplicates.forEach(function (other) {
      if (Number(other.id) > 0) {
        push('error', 'simplified', 'Duplicate of proverb #' + other.id + ' — same wording and reading.');
      }
    });
    if (Number(item.id) > 0 && (index.idCounts.get(item.id) || 0) > 1) {
      push('error', 'id', 'The ID #' + item.id + ' is used more than once.');
    }

    var order = { error: 0, warning: 1, note: 2 };
    return issues.sort(function (a, b) { return order[a.level] - order[b.level]; });
  }

  function hasReview(item, index) {
    return issuesFor(item, index).some(function (issue) { return issue.level !== 'note'; });
  }

  function issueSummary() {
    var index = buildIndex(state.items);
    var counts = { error: 0, warning: 0, note: 0 };
    state.items.forEach(function (item) {
      issuesFor(item, index).forEach(function (issue) { counts[issue.level] += 1; });
    });
    return counts;
  }

  function reviewCount() {
    var index = buildIndex(state.items);
    return state.items.filter(function (item) { return hasReview(item, index); }).length;
  }

  function collectIssues() {
    var index = buildIndex(state.items);
    var out = [];
    state.items.forEach(function (item) {
      issuesFor(item, index).forEach(function (issue) {
        out.push({ level: issue.level, id: item.id, simplified: item.simplified, message: issue.message });
      });
    });
    return out;
  }

  /* ---------------- persistence ---------------- */
  function persistNow() {
    clearTimeout(persistTimer);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        version: 1,
        stamp: state.stamp,
        savedAt: new Date().toISOString(),
        items: state.items,
      }));
      state.savedAt = new Date().toISOString();
    } catch (error) {
      if (!storageWarned) {
        storageWarned = true;
        SHARED.toast('Proverb autosave failed — use Save JSON.', 'error');
      }
    }
    renderStatus();
  }

  function persist() {
    state.fileDirty = true;
    renderStatus();
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 180);
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { raw = null; }
    var stored = null;
    if (raw) {
      try { stored = JSON.parse(raw); } catch (e) {
        try { localStorage.setItem(LS_KEY + '.corrupt', raw); } catch (ignored) { /* ignore */ }
      }
    }
    if (stored && Array.isArray(stored.items) && stored.items.length) {
      state.items = stored.items.map(function (item) { return normalize(item, item.id); });
      state.stamp = stored.stamp || BUNDLE.stamp;
      state.savedAt = stored.savedAt || null;
    } else {
      state.items = clone(BUNDLE.proverbs).map(function (item) { return normalize(item, item.id); });
      state.stamp = BUNDLE.stamp;
      persistNow();
    }
  }

  function dismissSnapshot() {
    try { localStorage.setItem(LS_DISMISS, BUNDLE.stamp); } catch (e) { /* ignore */ }
  }

  function maybeSnapshotBanner() {
    var dismissed = null;
    try { dismissed = localStorage.getItem(LS_DISMISS); } catch (e) { dismissed = null; }
    if (dismissed === BUNDLE.stamp || state.stamp === BUNDLE.stamp) return;

    SHARED.showBanner(
      'The bundled proverb list is newer (' + BUNDLE.count + ' rows, ' + esc(BUNDLE.retrieved || '') +
        ') than this browser\'s working copy. Nothing has been overwritten.',
      [
        { label: 'Keep my copy', kind: 'ghost', onClick: function () { dismissSnapshot(); SHARED.hideBanner(); } },
        { label: 'Use bundled proverbs', kind: 'primary', onClick: useBundled },
      ]
    );
  }

  async function useBundled() {
    var ok = await SHARED.confirmAction(
      'Use the bundled proverbs?',
      'Replace the current ' + state.items.length + ' proverbs with the bundled ' + BUNDLE.count + '?',
      'Use bundled'
    );
    if (!ok) return;
    pushHistory();
    state.items = clone(BUNDLE.proverbs).map(function (item) { return normalize(item, item.id); });
    state.stamp = BUNDLE.stamp;
    state.savedAt = null;
    state.selected.clear();
    dismissSnapshot();
    SHARED.hideBanner();
    persist();
    renderAll();
  }

  /* ---------------- history ---------------- */
  function pushHistory() {
    state.history.push(clone(state.items));
    if (state.history.length > 60) state.history.shift();
    state.future.length = 0;
  }

  function undo() {
    if (!state.history.length) { SHARED.toast('Nothing to undo in the proverb section.'); return; }
    closeEditor(true);
    state.future.push(clone(state.items));
    state.items = state.history.pop();
    state.selected.clear();
    persist();
    renderAll();
    SHARED.toast('Proverb change undone.');
  }

  function redo() {
    if (!state.future.length) { SHARED.toast('Nothing to redo in the proverb section.'); return; }
    closeEditor(true);
    state.history.push(clone(state.items));
    state.items = state.future.pop();
    state.selected.clear();
    persist();
    renderAll();
    SHARED.toast('Proverb change redone.');
  }

  /* ---------------- view ---------------- */
  function queryTokens() {
    var seen = new Set();
    state.query.toLowerCase().split(/\s+/).forEach(function (token) { if (token) seen.add(token); });
    return Array.from(seen).slice(0, 8);
  }

  function matchesQuery(item, tokens) {
    if (!tokens.length) return true;
    var haystack = [
      item.simplified, item.traditional, item.pinyin, item.pinyin_plain,
      item.english, item.explanation_zh, item.source, item.notes, item.category,
    ].join(' ').toLowerCase();
    return tokens.every(function (token) { return haystack.indexOf(token) !== -1; });
  }

  function categoryRank(category) {
    var at = CATEGORY_ORDER.indexOf(category);
    return at === -1 ? 999 : at;
  }

  function computeView() {
    var index = buildIndex(state.items);
    var tokens = queryTokens();
    var rows = state.items.filter(function (item) {
      if (state.category !== 'ALL' && item.category !== state.category) return false;
      if (!matchesQuery(item, tokens)) return false;
      if (state.filter === 'review') return hasReview(item, index);
      if (state.filter === 'edited') return isEdited(item);
      if (state.filter === 'media') return (item.media || []).length > 0;
      return true;
    });

    rows.sort(function (a, b) {
      var result = 0;
      if (state.sort === 'order') result = categoryRank(a.category) - categoryRank(b.category) || (a.order - b.order) || (a.id - b.id);
      else if (state.sort === 'category') result = categoryRank(a.category) - categoryRank(b.category) || a.simplified.localeCompare(b.simplified, 'zh');
      else if (state.sort === 'simplified') result = a.simplified.localeCompare(b.simplified, 'zh');
      else if (state.sort === 'pinyin') result = a.pinyin_plain.localeCompare(b.pinyin_plain) || a.simplified.localeCompare(b.simplified, 'zh');
      else result = a.english.localeCompare(b.english);
      return result || (a.id - b.id);
    });
    if (state.dir === 'desc') rows.reverse();
    return { rows: rows, index: index, tokens: tokens };
  }

  function makeHighlighter(tokens) {
    if (!tokens.length) return function (value) { return esc(value); };
    var pattern = tokens.slice().sort(function (a, b) { return b.length - a.length; }).map(function (token) {
      return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|');
    var regex = new RegExp('(' + pattern + ')', 'gi');
    return function (value) {
      return String(value == null ? '' : value).split(regex).map(function (part, index) {
        return index % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part);
      }).join('');
    };
  }

  function pinyinHtml(item, tokens) {
    if (!item.pinyin) return '<span class="muted">—</span>';
    if (!tokens.length) return esc(item.pinyin);
    var compact = item.pinyin_plain.replace(/\s+/g, '');
    var whole = tokens.some(function (token) { return token.replace(/\s+/g, '') === compact; });
    var syllables = item.pinyin.split(/\s+/);
    return syllables.map(function (syllable, index) {
      var plain = SHARED.toPlain(syllable);
      var hit = whole || tokens.some(function (token) {
        var cleaned = token.replace(/\s+/g, '');
        return cleaned && plain.indexOf(cleaned) !== -1;
      });
      return (hit ? '<mark>' : '') + esc(syllable) + (hit ? '</mark>' : '') +
        (index < syllables.length - 1 ? ' ' : '');
    }).join('');
  }

  function mediaThumb(item) {
    if (!item.media || !item.media.length) return '<span class="muted">—</span>';
    return '<button type="button" class="media-thumb" data-media-index="0" title="' +
      esc(window.GoMedia.describeMedia(item.media[0])) + '">' +
      window.GoMedia.mediaThumbHtml(item.media[0], 30) + '</button>' +
      (item.media.length > 1 ? '<span class="media-count">+' + (item.media.length - 1) + '</span>' : '');
  }

  function rowHtml(item, index, highlight, tokens) {
    var issues = issuesFor(item, index);
    var error = issues.some(function (issue) { return issue.level === 'error'; });
    var warning = issues.some(function (issue) { return issue.level === 'warning'; });
    var selected = state.selected.has(item.id);
    var issueTitle = issues.map(function (issue) { return issue.message; }).join(' · ');

    return '<tr data-pid="' + item.id + '"' + (selected ? ' class="selected"' : '') + ' tabindex="0">' +
      '<td class="col-check"><input type="checkbox" class="p-row-check"' + (selected ? ' checked' : '') +
        ' aria-label="Select proverb #' + item.id + '"></td>' +
      '<td class="col-id"><span class="id-cell">' +
        (isEdited(item) ? '<span class="edited-dot" title="Edited from the bundled list"></span>' : '') +
        item.id +
        ((error || warning) ? '<span class="issue-dot' + (error ? ' error' : '') + '" title="' +
          esc(issueTitle) + '"></span>' : '') + '</span></td>' +
      '<td class="col-category"><span class="category-chip">' + highlight(item.category || '—') + '</span></td>' +
      '<td class="col-cn"><span class="cn-simplified">' + highlight(item.simplified) + '</span>' +
        (item.traditional ? '<span class="cn-traditional">(' + highlight(item.traditional) + ')</span>' : '') +
        (item.pinyin ? '<span class="mobile-pinyin">' + pinyinHtml(item, tokens) + '</span>' : '') + '</td>' +
      '<td class="col-pinyin"><span class="pinyin-cell" title="' + esc(item.pinyin_plain) + '">' +
        pinyinHtml(item, tokens) + '</span></td>' +
      '<td class="col-english"><div class="proverb-en">' + highlight(item.english) + '</div>' +
        (item.explanation_zh ? '<div class="proverb-explanation">' + highlight(item.explanation_zh) + '</div>' : '') + '</td>' +
      '<td class="col-media">' + mediaThumb(item) + '</td>' +
      '<td class="col-actions"><div class="row-actions">' +
        '<button type="button" class="row-action" data-pact="edit" title="Edit proverb #' + item.id + '">' +
          '<svg class="icon"><use href="#i-edit"></use></svg></button>' +
        '<button type="button" class="row-action danger" data-pact="delete" title="Delete proverb #' + item.id + '">' +
          '<svg class="icon"><use href="#i-trash"></use></svg></button>' +
      '</div></td></tr>';
  }

  function renderStats() {
    el.pStatTotal.textContent = state.items.length;
    el.pStatEdited.textContent = editedCount();
    el.pStatReview.textContent = reviewCount();
    el.pStatCategories.textContent = new Set(state.items.map(function (item) { return item.category; }).filter(Boolean)).size;
    document.querySelectorAll('.stat[data-pstat]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.pstat === state.filter);
    });
    updateCategoryDatalist();
  }

  function renderCategories() {
    var counts = new Map();
    state.items.forEach(function (item) {
      var category = item.category || '其他';
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    var categories = Array.from(counts.keys()).sort(function (a, b) {
      return categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'zh');
    });
    var html = '<button type="button" class="letter-chip category-chip-btn' +
      (state.category === 'ALL' ? ' active' : '') + '" data-category="ALL" title="All groups">All<span class="chip-count">' +
      state.items.length + '</span></button>';
    categories.forEach(function (category) {
      html += '<button type="button" class="letter-chip category-chip-btn' +
        (state.category === category ? ' active' : '') + '" data-category="' + esc(category) + '" title="' +
        esc(category) + ' · ' + counts.get(category) + '">' + esc(category) +
        '<span class="chip-count">' + counts.get(category) + '</span></button>';
    });
    el.proverbCategories.innerHTML = html;
  }

  function renderTable() {
    var view = computeView();
    var highlight = makeHighlighter(view.tokens);
    el.proverbBody.innerHTML = view.rows.map(function (item) {
      return rowHtml(item, view.index, highlight, view.tokens);
    }).join('');
    el.proverbTable.style.display = view.rows.length ? '' : 'none';
    el.proverbEmptyState.hidden = view.rows.length > 0;

    var context = [];
    if (state.query.trim()) context.push('“' + state.query.trim() + '”');
    if (state.category !== 'ALL') context.push(state.category);
    if (state.filter === 'review') context.push('needs review');
    if (state.filter === 'edited') context.push('edited');
    if (state.filter === 'media') context.push('with diagrams');
    el.proverbResultSummary.textContent = context.length
      ? view.rows.length + ' of ' + state.items.length + ' proverbs · ' + context.join(' · ')
      : state.items.length + ' proverbs';

    document.querySelectorAll('#proverbTable th[data-psort]').forEach(function (th) {
      var active = th.dataset.psort === state.sort;
      th.classList.toggle('sorted', active);
      th.setAttribute('aria-sort', active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      var arrow = th.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = active ? (state.dir === 'asc' ? '↑' : '↓') : '';
    });

    updateSelection();
    var categories = new Set(state.items.map(function (item) { return item.category; }).filter(Boolean));
    el.proverbFooterSummary.textContent = categories.size + ' groups · ' +
      state.items.filter(function (item) { return (item.media || []).length; }).length + ' illustrated · snapshot ' +
      (BUNDLE.retrieved || '—');
    renderStatus();
  }

  function updateSelection() {
    var view = computeView();
    var visible = view.rows;
    var selectedVisible = visible.filter(function (item) { return state.selected.has(item.id); }).length;
    el.pSelectAll.checked = visible.length > 0 && selectedVisible === visible.length;
    el.pSelectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    el.proverbBulkBar.hidden = state.selected.size === 0;
    el.pSelCount.textContent = state.selected.size + ' selected';
  }

  function renderStatus() {
    el.proverbSavedIndicator.textContent = state.savedAt ? 'Autosaved ' + new Date(state.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not saved yet';
    el.proverbSavedIndicator.classList.toggle('dirty', state.fileDirty && !!state.jsonHandle);
    if (state.fileDirty && state.jsonHandle) {
      el.proverbSavedIndicator.innerHTML = '<span class="dot"></span>Unsaved file changes';
    }
    el.proverbFileStatus.innerHTML = state.jsonHandle
      ? '<span class="dot"></span>' + esc(state.jsonHandle.name) + (state.fileDirty ? ' · not written' : ' · up to date')
      : 'No proverb file connected';
    el.pUndoBtn.disabled = state.history.length === 0;
    el.pRedoBtn.disabled = state.future.length === 0;
    if (SHARED.getView() === 'proverbs') {
      document.getElementById('saveJsonBtn').title = 'Save ' + (state.jsonHandle ? state.jsonHandle.name : 'go-proverbs.json');
    }
  }

  function renderAll() {
    renderStats();
    renderCategories();
    renderTable();
    renderStatus();
    SHARED.notifyChanged();
  }

  function updateCategoryDatalist() {
    var categories = new Set(CATEGORY_ORDER);
    state.items.forEach(function (item) { if (item.category) categories.add(item.category); });
    el.proverbCategoryOptions.innerHTML = Array.from(categories).map(function (category) {
      return '<option value="' + esc(category) + '"></option>';
    }).join('');
  }

  /* ---------------- editor ---------------- */
  function draftFrom(item) {
    return {
      category: item.category,
      order: item.order,
      simplified: item.simplified,
      traditional: item.traditional,
      pinyin: item.pinyin,
      english: item.english,
      explanation_zh: item.explanation_zh,
      source: item.source,
      source_url: item.source_url,
      notes: item.notes,
      media: clone(item.media || []),
    };
  }

  function blankDraft() {
    var category = state.category !== 'ALL' ? state.category : (CATEGORY_ORDER[0] || '');
    var maxOrder = 0;
    state.items.filter(function (item) { return item.category === category; }).forEach(function (item) {
      maxOrder = Math.max(maxOrder, item.order || 0);
    });
    return {
      category: category,
      order: maxOrder + 1,
      simplified: '',
      traditional: '',
      pinyin: '',
      english: '',
      explanation_zh: '',
      source: '',
      source_url: '',
      notes: '',
      media: [],
    };
  }

  function draftKey(draft) {
    return JSON.stringify([
      draft.category, draft.order, draft.simplified, draft.traditional,
      draft.pinyin, draft.english, draft.explanation_zh,
      draft.source, draft.source_url, draft.notes,
      (draft.media || []).map(function (m) {
        return m.type + '|' + m.name + '|' + m.data.length + '|' + m.data.slice(0, 48) + '|' + m.data.slice(-32);
      }),
    ]);
  }

  function readEditor() {
    return {
      category: el.pf_category.value.trim(),
      order: Number(el.pf_order.value) || 0,
      simplified: el.pf_simplified.value,
      traditional: el.pf_traditional.value,
      pinyin: el.pf_pinyin.value,
      english: el.pf_english.value,
      explanation_zh: el.pf_explanation.value,
      source: el.pf_source.value.trim(),
      source_url: el.pf_source_url.value.trim(),
      notes: el.pf_notes.value,
      media: clone(mediaDraft),
    };
  }

  function fillEditor(draft) {
    el.pf_category.value = draft.category;
    el.pf_order.value = draft.order;
    el.pf_simplified.value = draft.simplified;
    el.pf_traditional.value = draft.traditional;
    el.pf_pinyin.value = draft.pinyin;
    el.pf_english.value = draft.english;
    el.pf_explanation.value = draft.explanation_zh;
    el.pf_source.value = draft.source;
    el.pf_source_url.value = draft.source_url;
    el.pf_notes.value = draft.notes;
    mediaDraft = clone(draft.media || []);
    renderMedia();
    updatePreview();
    refreshIssues();
    editorDirty = draftKey(readEditor()) !== draftKey(editorOriginal);
  }

  function updatePreview() {
    var draft = readEditor();
    var plain = SHARED.toPlain(draft.pinyin);
    el.pPinyinPreview.textContent = plain
      ? plain + ' · ' + draft.category + ' · #' + draft.order
      : 'The plain, searchable pinyin form is derived automatically.';
  }

  function refreshIssues() {
    var draft = readEditor();
    var existing = state.editingId != null
      ? state.items.find(function (item) { return item.id === state.editingId; })
      : null;
    var probe = normalize(Object.assign({}, draft, {
      id: state.editingId != null ? state.editingId : -1,
    }), state.editingId != null ? state.editingId : -1);
    var others = state.items.filter(function (item) { return item.id !== state.editingId; });
    var index = buildIndex(others.concat(probe));
    var issues = issuesFor(probe, index);
    var hasError = issues.some(function (issue) { return issue.level === 'error'; });
    el.pSave.disabled = hasError;
    el.pf_simplified.setAttribute('aria-invalid', String(issues.some(function (issue) {
      return issue.level === 'error' && issue.field === 'simplified';
    })));
    el.proverbIssues.innerHTML = issues.length
      ? issues.slice(0, 8).map(function (issue) {
        var icon = issue.level === 'error' ? '!' : (issue.level === 'warning' ? '!' : 'i');
        return '<div class="issue ' + issue.level + '"><span class="issue-icon">' + icon +
          '</span><span>' + esc(issue.message) + '</span></div>';
      }).join('')
      : '<div class="issue note"><span class="issue-icon">✓</span><span>No issues found for this proverb.</span></div>';
    editorDirty = draftKey(draft) !== draftKey(editorOriginal);
    return issues;
  }

  function renderMedia() {
    SHARED.renderMediaRows(el.proverbMediaRows, mediaDraft, function (next) {
      mediaDraft = next;
      editorDirty = draftKey(readEditor()) !== draftKey(editorOriginal);
    });
  }

  function updateChrome() {
    var item = state.editingId != null
      ? state.items.find(function (entry) { return entry.id === state.editingId; })
      : null;
    el.pDelete.hidden = !item;
    el.pDuplicate.hidden = !item;
    el.pPrev.hidden = !item;
    el.pNext.hidden = !item;
    el.pSave.textContent = item ? 'Save proverb' : 'Add proverb';
    if (item) {
      el.pEditorEyebrow.textContent = 'Proverb #' + item.id;
      el.pEditorTitle.textContent = 'Edit proverb';
    } else {
      el.pEditorEyebrow.textContent = editorMode === 'duplicate' ? 'New proverb · duplicated' : 'New proverb';
      el.pEditorTitle.textContent = 'Add a proverb';
    }
    var view = computeView();
    var position = item ? view.rows.findIndex(function (row) { return row.id === item.id; }) : -1;
    el.pNavPosition.textContent = position >= 0 ? (position + 1) + ' / ' + view.rows.length : '';
    el.pPrev.disabled = position <= 0;
    el.pNext.disabled = position < 0 || position >= view.rows.length - 1;
  }

  function showEditor() {
    editorOpen = true;
    clearTimeout(editorHideTimer);
    el.proverbEditor.hidden = false;
    el.proverbEditor.setAttribute('aria-hidden', 'false');
    document.getElementById('scrim').hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      document.getElementById('scrim').classList.add('show');
      el.proverbEditor.classList.add('open');
    });
    setTimeout(function () {
      if (editorOpen) el.pf_simplified.focus();
    }, 120);
  }

  function hideEditor() {
    editorOpen = false;
    editorDirty = false;
    clearTimeout(editorHideTimer);
    el.proverbEditor.classList.remove('open');
    el.proverbEditor.setAttribute('aria-hidden', 'true');
    document.getElementById('scrim').classList.remove('show');
    document.body.style.overflow = '';
    editorHideTimer = setTimeout(function () {
      if (editorOpen) return;
      if (document.getElementById('editor').classList.contains('open')) return;
      el.proverbEditor.hidden = true;
      document.getElementById('scrim').hidden = true;
      state.editingId = null;
    }, 280);
  }

  function openEditor(id) {
    if (state.editingId != null && editorDirty && Number(id) !== state.editingId) {
      // Navigation is handled explicitly by prev/next; opening a row while dirty
      // is cancelled by the shared view logic.
    }
    if (id === 'new') {
      editorMode = 'new';
      state.editingId = null;
      editorOriginal = blankDraft();
    } else {
      var item = state.items.find(function (entry) { return entry.id === Number(id); });
      if (!item) return;
      editorMode = 'edit';
      state.editingId = item.id;
      editorOriginal = draftFrom(item);
    }
    fillEditor(clone(editorOriginal));
    updateChrome();
    showEditor();
  }

  function closeEditor(force) {
    if (!force && editorDirty) {
      return SHARED.confirmAction('Discard changes?', 'This proverb has unsaved edits.', 'Discard', true)
        .then(function (ok) { if (ok) hideEditor(); return ok; });
    }
    hideEditor();
    return Promise.resolve(true);
  }

  async function saveEditor(event) {
    if (event) event.preventDefault();
    var draft = readEditor();
    var existing = state.editingId != null
      ? state.items.find(function (item) { return item.id === state.editingId; })
      : null;
    var id = existing ? existing.id : nextId();
    var item = normalize(Object.assign({}, draft, { id: id }), id);
    var others = state.items.filter(function (entry) { return entry.id !== id; });
    var issues = issuesFor(item, buildIndex(others.concat(item)));
    if (issues.some(function (issue) { return issue.level === 'error'; })) {
      refreshIssues();
      SHARED.toast('Fix the errors before saving.', 'error');
      return;
    }

    pushHistory();
    if (existing) {
      state.items[state.items.indexOf(existing)] = item;
    } else {
      state.items.push(item);
      state.category = item.category || state.category;
    }
    persist();
    editorDirty = false;
    hideEditor();
    renderAll();
    SHARED.toast(existing ? 'Saved proverb #' + item.id : 'Added proverb #' + item.id);
    reveal(item.id);
  }

  function reveal(id) {
    var visible = computeView().rows.some(function (item) { return item.id === id; });
    if (!visible) {
      state.query = '';
      state.category = 'ALL';
      state.filter = 'all';
      el.proverbSearch.value = '';
      el.pClearSearch.hidden = true;
      el.proverbFilter.value = 'all';
      renderAll();
    }
    requestAnimationFrame(function () {
      var row = el.proverbBody.querySelector('tr[data-pid="' + id + '"]');
      if (!row) return;
      row.classList.add('flash');
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(function () { row.classList.remove('flash'); }, 1200);
    });
  }

  async function deleteItem(id) {
    var item = state.items.find(function (entry) { return entry.id === Number(id); });
    if (!item) return;
    var ok = await SHARED.confirmAction(
      'Delete proverb?',
      'Delete #' + item.id + ' “' + item.simplified + '”? You can undo this.',
      'Delete',
      true
    );
    if (!ok) return;
    pushHistory();
    state.items = state.items.filter(function (entry) { return entry !== item; });
    state.selected.delete(item.id);
    if (state.editingId === item.id) closeEditor(true);
    persist();
    renderAll();
  }

  function duplicateCurrent() {
    var draft = readEditor();
    state.editingId = null;
    editorMode = 'duplicate';
    editorOriginal = blankDraft();
    fillEditor(draft);
    editorOriginal = blankDraft();
    editorDirty = true;
    updateChrome();
    el.pf_simplified.focus();
  }

  async function navigate(direction) {
    if (state.editingId == null) return;
    var rows = computeView().rows;
    var at = rows.findIndex(function (item) { return item.id === state.editingId; });
    if (at < 0) return;
    var target = rows[at + direction];
    if (!target) return;
    if (editorDirty) {
      var ok = await SHARED.confirmAction('Discard changes?', 'Move to another proverb and discard these edits?', 'Discard', true);
      if (!ok) return;
      editorDirty = false;
    }
    openEditor(target.id);
  }

  /* ---------------- import / export ---------------- */
  function parseImport(text, fileName) {
    var isCsv = fileName && /\.csv$/i.test(fileName);
    var trimmed = String(text).replace(/^\uFEFF/, '').trimStart();
    if (!isCsv && (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[')) {
      var data;
      try { data = JSON.parse(text); } catch (e) { return null; }
      var sourceList = Array.isArray(data) ? data
        : (data && Array.isArray(data.proverbs) ? data.proverbs : null);
      if (!sourceList) return null;
      var skipped = 0;
      var items = sourceList.map(function (raw) {
        if (!raw || typeof raw !== 'object') { skipped += 1; return null; }
        if (!raw.simplified && !raw.english) { skipped += 1; return null; }
        return normalize(raw, raw.id);
      }).filter(Boolean);
      rememberIds(items);
      return { items: items, skipped: skipped };
    }

    if (isCsv || trimmed.indexOf(',') !== -1) {
      var rows = parseCSV(text);
      if (!rows.length) return null;
      var headers = rows[0].map(function (header) { return String(header).trim().toLowerCase(); });
      if (headers.indexOf('category') === -1 && headers.indexOf('explanation_zh') === -1) return null;
      if (headers.indexOf('simplified') === -1) return null;
      var col = function (name) { return headers.indexOf(name); };
      var value = function (row, name) {
        var at = col(name);
        return at === -1 ? '' : String(row[at] == null ? '' : row[at]).trim();
      };
      var skippedCsv = 0;
      var list = [];
      for (var i = 1; i < rows.length; i += 1) {
        var row = rows[i];
        var simplified = String(row[col('simplified')] || '').trim();
        if (!simplified) { skippedCsv += 1; continue; }
        list.push(normalize({
          id: Number(value(row, 'id')),
          category: value(row, 'category'),
          order: Number(value(row, 'order')) || 0,
          simplified: simplified,
          traditional: value(row, 'traditional'),
          pinyin: value(row, 'pinyin'),
          english: value(row, 'english'),
          explanation_zh: value(row, 'explanation_zh'),
          source: value(row, 'source'),
          source_url: value(row, 'source_url'),
          notes: value(row, 'notes'),
        }, Number(value(row, 'id'))));
      }
      rememberIds(list);
      return { items: list, skipped: skippedCsv };
    }
    return null;
  }

  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    for (var i = 0; i < text.length; i += 1) {
      var character = text[i];
      if (quoted) {
        if (character === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else field += character;
      } else if (character === '"') quoted = true;
      else if (character === ',') { row.push(field); field = ''; }
      else if (character === '\r') {
        if (text[i + 1] === '\n') i += 1;
        row.push(field); rows.push(row); row = []; field = '';
      } else if (character === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else field += character;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (line) { return line.some(function (cell) { return String(cell).trim() !== ''; }); });
  }

  function rememberIds(items) {
    var used = new Set();
    var next = 1;
    items.forEach(function (item) {
      var id = Number(item.id);
      if (!Number.isInteger(id) || id < 1 || used.has(id)) {
        while (used.has(next)) next += 1;
        id = next;
      }
      item.id = id;
      used.add(id);
      next = Math.max(next, id + 1);
    });
  }

  function mergeStats(incoming) {
    var existing = new Map(state.items.map(function (item) { return [dupKey(item), item]; }));
    var matches = 0;
    incoming.forEach(function (item) { if (existing.has(dupKey(item))) matches += 1; });
    return { matches: matches, added: incoming.length - matches };
  }

  function applyImport(incoming, mode) {
    pushHistory();
    var items = incoming.map(function (item) { return normalize(item, item.id); });
    if (mode === 'replace') {
      state.items = items;
    } else {
      var byKey = new Map();
      state.items.forEach(function (item, index) { byKey.set(dupKey(item), index); });
      items.forEach(function (item) {
        var key = dupKey(item);
        if (byKey.has(key)) {
          var index = byKey.get(key);
          var existingId = state.items[index].id;
          state.items[index] = normalize(Object.assign({}, item, { id: existingId }), existingId);
        } else {
          item.id = nextId();
          state.items.push(item);
          byKey.set(key, state.items.length - 1);
        }
      });
    }
    state.selected.clear();
    persist();
    renderAll();
  }

  function project(item) {
    var out = {
      id: item.id,
      category: item.category,
      order: item.order,
      simplified: item.simplified,
      traditional: item.traditional,
      pinyin: item.pinyin,
      pinyin_plain: item.pinyin_plain,
      english: item.english,
      explanation_zh: item.explanation_zh,
      source: item.source,
      source_url: item.source_url,
      notes: item.notes,
    };
    if (item.media && item.media.length) out.media = clone(item.media);
    return out;
  }

  function exportObject() {
    var items = state.items.map(project);
    var countsByCategory = {};
    var countsBySource = {};
    items.forEach(function (item) {
      if (item.category) countsByCategory[item.category] = (countsByCategory[item.category] || 0) + 1;
      if (item.source) countsBySource[item.source] = (countsBySource[item.source] || 0) + 1;
    });
    return {
      source: BUNDLE.source,
      retrieved: BUNDLE.retrieved,
      license: BUNDLE.license,
      updated: new Date().toISOString(),
      count: items.length,
      counts_by_category: countsByCategory,
      counts_by_source: countsBySource,
      proverbs: items,
    };
  }

  function exportJSONString() {
    return JSON.stringify(exportObject(), null, 2) + '\n';
  }

  function csvEscape(value) {
    var text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportCSVString() {
    var header = ['id', 'category', 'order', 'simplified', 'traditional', 'pinyin',
      'pinyin_plain', 'english', 'explanation_zh', 'source', 'source_url', 'notes'];
    var lines = [header.join(',')];
    state.items.forEach(function (item) {
      lines.push([
        item.id, item.category, item.order, item.simplified, item.traditional, item.pinyin,
        item.pinyin_plain, item.english, item.explanation_zh, item.source, item.source_url, item.notes,
      ].map(csvEscape).join(','));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function downloadJSON() {
    SHARED.download('go-proverbs.json', exportJSONString(), 'application/json');
    SHARED.toast('Downloaded go-proverbs.json.');
  }

  function downloadCSV() {
    SHARED.download('go-proverbs.csv', exportCSVString(), 'text/csv');
    SHARED.toast('Downloaded go-proverbs.csv.');
  }

  async function saveJSON(asNew) {
    var text = exportJSONString();
    if (!SHARED.FS_SUPPORTED) {
      SHARED.download('go-proverbs.json', text, 'application/json');
      SHARED.toast('Downloaded go-proverbs.json — move it beside the project.');
      return;
    }
    var handle = asNew ? null : state.jsonHandle;
    try {
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: 'go-proverbs.json',
          types: [{ description: 'JSON data', accept: { 'application/json': ['.json'] } }],
        });
        state.jsonHandle = handle;
        SHARED.idbSet('proverbs.jsonHandle', handle);
      }
      if (!(await SHARED.ensureWritePermission(handle))) {
        SHARED.toast('Write permission was not granted.', 'error');
        return;
      }
      await SHARED.writeHandle(handle, text);
      state.fileDirty = false;
      renderStatus();
      SHARED.toast('Saved ' + handle.name + ' · ' + state.items.length + ' proverbs');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      SHARED.download('go-proverbs.json', text, 'application/json');
      SHARED.toast('Could not write directly — downloaded a copy instead.', 'error');
    }
  }

  async function saveCSV() {
    var text = exportCSVString();
    if (!SHARED.FS_SUPPORTED) {
      SHARED.download('go-proverbs.csv', text, 'text/csv');
      SHARED.toast('Downloaded go-proverbs.csv.');
      return;
    }
    try {
      var handle = await window.showSaveFilePicker({
        suggestedName: 'go-proverbs.csv',
        types: [{ description: 'CSV spreadsheet', accept: { 'text/csv': ['.csv'] } }],
      });
      if (!(await SHARED.ensureWritePermission(handle))) return;
      await SHARED.writeHandle(handle, text);
      SHARED.toast('Saved ' + handle.name + ' · ' + state.items.length + ' proverbs');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      SHARED.download('go-proverbs.csv', text, 'text/csv');
      SHARED.toast('Could not write directly — downloaded a copy instead.', 'error');
    }
  }

  async function connect() {
    if (!SHARED.OPEN_SUPPORTED) {
      SHARED.toast('This browser cannot connect files. Use Save JSON instead.', 'error');
      return;
    }
    try {
      var handles = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'JSON data', accept: { 'application/json': ['.json'] } }],
      });
      state.jsonHandle = handles[0];
      SHARED.idbSet('proverbs.jsonHandle', state.jsonHandle);
      renderStatus();
      SHARED.toast('Connected ' + state.jsonHandle.name + '.');
    } catch (error) {
      if (error && error.name !== 'AbortError') SHARED.toast('Could not connect that file.', 'error');
    }
  }

  async function copyJSON() {
    var text = exportJSONString();
    try {
      await navigator.clipboard.writeText(text);
      SHARED.toast('Proverb JSON copied to the clipboard.');
    } catch (error) {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); SHARED.toast('Proverb JSON copied.'); }
      catch (ignored) { SHARED.toast('Copy failed — use Download JSON.', 'error'); }
      area.remove();
    }
  }

  /* ---------------- maintenance ---------------- */
  function rebuildDerived() {
    var rebuilt = state.items.map(function (item) { return normalize(item, item.id); });
    if (JSON.stringify(rebuilt) === JSON.stringify(state.items)) {
      SHARED.toast('Proverb fields are already up to date.');
      return;
    }
    pushHistory();
    state.items = rebuilt;
    persist();
    renderAll();
    SHARED.toast('Rebuilt proverb derived fields.');
  }

  async function renumberIds() {
    var ok = await SHARED.confirmAction(
      'Renumber proverb IDs?',
      'Number all ' + state.items.length + ' proverbs 1–' + state.items.length + ' in current order?',
      'Renumber',
      true
    );
    if (!ok) return;
    pushHistory();
    state.items.forEach(function (item, index) { item.id = index + 1; });
    state.selected.clear();
    persist();
    renderAll();
  }

  async function resetToBundle() {
    var ok = await SHARED.confirmAction(
      'Reset proverbs to bundled data?',
      'Replace the working copy (' + state.items.length + ' rows) with the bundled ' + BUNDLE.count + '? You can undo.',
      'Reset',
      true
    );
    if (!ok) return;
    pushHistory();
    state.items = clone(BUNDLE.proverbs).map(function (item) { return normalize(item, item.id); });
    state.stamp = BUNDLE.stamp;
    state.savedAt = null;
    state.selected.clear();
    dismissSnapshot();
    persist();
    renderAll();
  }

  function clearFilters() {
    state.query = '';
    state.category = 'ALL';
    state.filter = 'all';
    el.proverbSearch.value = '';
    el.pClearSearch.hidden = true;
    el.proverbFilter.value = 'all';
    renderAll();
  }

  function setFilter(filter) {
    state.filter = filter;
    el.proverbFilter.value = filter;
    renderStats();
    renderTable();
  }

  function focusSearch() {
    el.proverbSearch.focus();
    el.proverbSearch.select();
  }

  function onActivate() {
    renderAll();
    maybeSnapshotBanner();
    renderStatus();
    el.proverbSearch.focus({ preventScroll: true });
  }

  /* ---------------- wiring ---------------- */
  function cache() {
    [
      'pStatTotal', 'pStatEdited', 'pStatReview', 'pStatCategories',
      'proverbSearch', 'pClearSearch', 'proverbCategories', 'proverbFilter',
      'proverbSort', 'proverbSortDir', 'proverbResultSummary', 'proverbBulkBar',
      'pSelCount', 'pBulkDelete', 'pBulkClear', 'proverbSavedIndicator',
      'proverbTable', 'proverbBody', 'pSelectAll', 'proverbEmptyState', 'pEmptyClear',
      'proverbFooterSummary', 'pUndoBtn', 'pRedoBtn', 'proverbFileStatus',
      'proverbEditor', 'pEditorEyebrow', 'pEditorTitle', 'pNavPosition', 'pPrev', 'pNext', 'pClose',
      'proverbForm', 'pf_category', 'pf_order', 'pf_simplified', 'pf_traditional',
      'pf_pinyin', 'pf_english', 'pf_explanation', 'pf_source', 'pf_source_url', 'pf_notes',
      'pPinyinPreview', 'pAddMediaImage', 'pAddMediaSgf', 'proverbMediaRows',
      'proverbIssues', 'pDelete', 'pDuplicate', 'pCancel', 'pSave',
      'proverbCategoryOptions',
    ].forEach(function (id) { el[id] = $(id); });
  }

  function wire() {
    el.proverbSearch.addEventListener('input', function () {
      state.query = el.proverbSearch.value;
      el.pClearSearch.hidden = !state.query;
      renderTable();
    });
    el.pClearSearch.addEventListener('click', function () {
      state.query = '';
      el.proverbSearch.value = '';
      el.pClearSearch.hidden = true;
      el.proverbSearch.focus();
      renderTable();
    });
    el.proverbCategories.addEventListener('click', function (event) {
      var button = event.target.closest('[data-category]');
      if (!button) return;
      state.category = button.dataset.category;
      renderCategories();
      renderTable();
    });
    el.proverbFilter.addEventListener('change', function () {
      state.filter = el.proverbFilter.value;
      renderStats();
      renderTable();
    });
    el.proverbSort.addEventListener('change', function () {
      state.sort = el.proverbSort.value;
      renderTable();
    });
    el.proverbSortDir.addEventListener('click', function () {
      state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      el.proverbSortDir.textContent = state.dir === 'asc' ? '↑' : '↓';
      renderTable();
    });
    document.querySelectorAll('#proverbTable th[data-psort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var sort = th.dataset.psort;
        if (state.sort === sort) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.sort = sort; state.dir = 'asc'; }
        el.proverbSort.value = state.sort;
        el.proverbSortDir.textContent = state.dir === 'asc' ? '↑' : '↓';
        renderTable();
      });
    });
    document.querySelectorAll('.stat[data-pstat]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = button.dataset.pstat;
        if (next === 'categories') {
          state.category = 'ALL';
          clearFilters();
          return;
        }
        setFilter(state.filter === next ? 'all' : next);
      });
    });
    el.pEmptyClear.addEventListener('click', clearFilters);
    el.pUndoBtn.addEventListener('click', undo);
    el.pRedoBtn.addEventListener('click', redo);

    el.proverbBody.addEventListener('click', function (event) {
      var thumb = event.target.closest('.media-thumb');
      if (thumb) {
        event.stopPropagation();
        var row = thumb.closest('tr[data-pid]');
        var item = row && state.items.find(function (entry) { return entry.id === Number(row.dataset.pid); });
        if (item && item.media[0]) SHARED.openMediaViewer(item.media[0]);
        return;
      }
      var action = event.target.closest('button[data-pact]');
      if (action) {
        event.stopPropagation();
        var actionRow = action.closest('tr[data-pid]');
        if (!actionRow) return;
        if (action.dataset.pact === 'edit') openEditor(Number(actionRow.dataset.pid));
        else deleteItem(Number(actionRow.dataset.pid));
        return;
      }
      if (event.target.closest('input, a')) return;
      var tr = event.target.closest('tr[data-pid]');
      if (tr) openEditor(Number(tr.dataset.pid));
    });
    el.proverbBody.addEventListener('change', function (event) {
      var checkbox = event.target.closest('.p-row-check');
      if (!checkbox) return;
      var row = checkbox.closest('tr[data-pid]');
      var id = Number(row.dataset.pid);
      if (checkbox.checked) state.selected.add(id); else state.selected.delete(id);
      row.classList.toggle('selected', checkbox.checked);
      updateSelection();
    });
    el.proverbBody.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.target.closest('button, input, a')) return;
      var row = event.target.closest('tr[data-pid]');
      if (row) { event.preventDefault(); openEditor(Number(row.dataset.pid)); }
    });
    el.pSelectAll.addEventListener('change', function () {
      computeView().rows.forEach(function (item) {
        if (el.pSelectAll.checked) state.selected.add(item.id);
        else state.selected.delete(item.id);
      });
      renderTable();
    });
    el.pBulkDelete.addEventListener('click', async function () {
      var count = state.selected.size;
      if (!count) return;
      var ok = await SHARED.confirmAction('Delete selected proverbs?', 'Delete ' + count + ' proverb(s)? You can undo.', 'Delete', true);
      if (!ok) return;
      pushHistory();
      state.items = state.items.filter(function (item) { return !state.selected.has(item.id); });
      state.selected.clear();
      persist();
      renderAll();
    });
    el.pBulkClear.addEventListener('click', function () {
      state.selected.clear();
      renderTable();
    });

    el.proverbForm.addEventListener('input', function () {
      updatePreview();
      refreshIssues();
    });
    el.proverbForm.addEventListener('submit', saveEditor);
    el.pClose.addEventListener('click', function () { closeEditor(false); });
    el.pCancel.addEventListener('click', function () { closeEditor(false); });
    el.pDelete.addEventListener('click', function () {
      if (state.editingId != null) deleteItem(state.editingId);
    });
    el.pDuplicate.addEventListener('click', duplicateCurrent);
    el.pPrev.addEventListener('click', function () { navigate(-1); });
    el.pNext.addEventListener('click', function () { navigate(1); });
    el.pAddMediaImage.addEventListener('click', function () {
      SHARED.pickMedia('image', function (item) {
        mediaDraft.push(item);
        renderMedia();
        refreshIssues();
      });
    });
    el.pAddMediaSgf.addEventListener('click', function () {
      SHARED.pickMedia('sgf', function (item) {
        mediaDraft.push(item);
        renderMedia();
        refreshIssues();
      });
    });

    el.proverbEditor.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        el.proverbForm.requestSubmit();
      }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        navigate(event.key === 'ArrowUp' ? -1 : 1);
      }
      if (event.key !== 'Tab') return;
      var focusable = Array.from(el.proverbEditor.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]'
      )).filter(function (node) { return node.offsetParent !== null; });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function init() {
    cache();
    load();
    wire();
    renderAll();
    SHARED.idbGet('proverbs.jsonHandle').then(function (handle) {
      state.jsonHandle = handle || null;
      renderStatus();
    });
  }

  window.GoProverbs = {
    count: function () { return state.items.length; },
    reviewCount: reviewCount,
    editedCount: editedCount,
    collectIssues: collectIssues,
    getItems: function () { return state.items; },
    exportJSONString: exportJSONString,
    exportCSVString: exportCSVString,
    exportObject: exportObject,
    parseImport: parseImport,
    mergeStats: mergeStats,
    applyImport: applyImport,
    openNew: function () { openEditor('new'); },
    openEditor: openEditor,
    closeEditor: closeEditor,
    isOpen: function () { return editorOpen; },
    isDirty: function () { return editorDirty; },
    focusSearch: focusSearch,
    onActivate: onActivate,
    undo: undo,
    redo: redo,
    saveJSON: saveJSON,
    saveCSV: saveCSV,
    connect: connect,
    downloadJSON: downloadJSON,
    downloadCSV: downloadCSV,
    copyJSON: copyJSON,
    rebuildDerived: rebuildDerived,
    renumberIds: renumberIds,
    resetToBundle: resetToBundle,
    clearFilters: clearFilters,
    setFilter: setFilter,
    render: renderAll,
  };

  init();
})();
