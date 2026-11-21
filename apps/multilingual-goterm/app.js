/* ============================================================
   Go Term Manager — application logic
   Runs as a classic script from file:// — no modules, no fetch.
   ============================================================ */
(function () {
  'use strict';

  var BUNDLES = window.GO_TERM_BUNDLES;

  if (!BUNDLES && window.GO_TERMS_BUNDLE) {
    BUNDLES = {
      base: Object.assign({
        key: 'base',
        label: 'Base extraction',
        kind: 'base',
        file: 'go-terms.json',
      }, window.GO_TERMS_BUNDLE),
    };
  }

  var EDITION_KEYS = BUNDLES ? Object.keys(BUNDLES) : [];
  var LS_KEY = 'goterm.manager.v1';
  var LS_THEME = 'goterm.theme';
  var LS_DISMISS = 'goterm.snapshotDismissed';
  var LS_EDITION = 'goterm.edition';
  var LS_VIEW = 'goterm.view';
  var LS_LAYOUT = 'goterm.layout';
  var LS_STATS = 'goterm.statsVisible';
  var LS_COLUMNS = 'goterm.columns';
  var TOOL_VERSION = 3;

  var COLUMN_DEFS = {
    terms: [
      { key: 'id', label: '#', className: 'col-id' },
      { key: 'rank', label: 'Rank 等级', className: 'col-rank' },
      { key: 'letter', label: 'Sec 段', className: 'col-letter' },
      { key: 'cn', label: '中文 Chinese', className: 'col-cn' },
      { key: 'pinyin', label: '拼音 Pinyin', className: 'col-pinyin' },
      { key: 'english', label: '英文 English', className: 'col-english' },
      { key: 'links', label: '链接 Links', className: 'col-links' },
      { key: 'media', label: '图 Media', className: 'col-media' },
    ],
    proverbs: [
      { key: 'id', label: '#', className: 'col-id' },
      { key: 'rank', label: 'Rank 等级', className: 'col-rank' },
      { key: 'letter', label: 'Sec 字母', className: 'col-letter' },
      { key: 'category', label: '分类 Group', className: 'col-category' },
      { key: 'cn', label: '谚语 Proverb', className: 'col-cn' },
      { key: 'pinyin', label: '拼音 Pinyin', className: 'col-pinyin' },
      { key: 'english', label: '英文 · 简释 English · Meaning', className: 'col-english' },
      { key: 'links', label: '链接 Links', className: 'col-links' },
      { key: 'media', label: '图 Media', className: 'col-media' },
    ],
  };

  var columnPrefs = { terms: [], proverbs: [] };
  try {
    var storedColumns = JSON.parse(localStorage.getItem(LS_COLUMNS) || 'null');
    ['terms', 'proverbs'].forEach(function (section) {
      var list = storedColumns && Array.isArray(storedColumns[section]) ? storedColumns[section] : [];
      columnPrefs[section] = list.filter(function (key) {
        return COLUMN_DEFS[section].some(function (def) { return def.key === key; });
      });
    });
  } catch (e) {
    columnPrefs = { terms: [], proverbs: [] };
  }

  var savedEdition = null;
  try { savedEdition = localStorage.getItem(LS_EDITION); } catch (e) { savedEdition = null; }
  var hasLegacyWorkingCopy = false;
  try { hasLegacyWorkingCopy = !!localStorage.getItem(LS_KEY); } catch (e) { hasLegacyWorkingCopy = false; }

  var DEFAULT_EDITION = savedEdition && BUNDLES && BUNDLES[savedEdition]
    ? savedEdition
    : (hasLegacyWorkingCopy && BUNDLES && BUNDLES.base
      ? 'base'
      : (BUNDLES && BUNDLES.merged ? 'merged' : EDITION_KEYS[0]));
  var BUNDLE = BUNDLES ? BUNDLES[DEFAULT_EDITION] : null;

  function inferLayout() {
    var width = window.innerWidth;
    var height = Math.max(1, window.innerHeight);
    if (width < 900) return 'portrait';
    return (width / height >= 1.45 || height < 720) ? 'landscape' : 'portrait';
  }

  var savedLayout = null;
  try { savedLayout = localStorage.getItem(LS_LAYOUT); } catch (e) { savedLayout = null; }
  var DEFAULT_LAYOUT = savedLayout === 'portrait' || savedLayout === 'landscape'
    ? savedLayout
    : inferLayout();
  var savedStatsVisible = null;
  try { savedStatsVisible = localStorage.getItem(LS_STATS); } catch (e) { savedStatsVisible = null; }
  var DEFAULT_STATS_VISIBLE = savedStatsVisible === null
    ? DEFAULT_LAYOUT === 'portrait'
    : savedStatsVisible === '1';

  if (!BUNDLE || !Array.isArray(BUNDLE.terms) || !BUNDLE.terms.length) {
    document.body.innerHTML =
      '<div style="max-width:640px;margin:80px auto;padding:0 24px;font-family:system-ui,sans-serif;line-height:1.6">' +
      '<h1>Data file missing</h1><p><code>app/data.js</code> could not be loaded or contains no terms. ' +
      'From the project folder run <code>node build-app.js</code>, then reopen this page.</p></div>';
    return;
  }

  var TONE_RE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
  var CJK_RE = /^[\u3400-\u9FFF\u3007\uF900-\uFAFF]+$/;
  var HTTP_RE = /^https?:\/\//i;
  var FS_SUPPORTED = typeof window.showSaveFilePicker === 'function';
  var OPEN_SUPPORTED = typeof window.showOpenFilePicker === 'function';

  var CN_COLLATOR = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' });
  var EN_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });

  var state = {
    terms: [],
    editionKey: DEFAULT_EDITION,
    view: 'terms',
    query: '',
    letter: 'ALL',
    rank: 'ALL',
    filter: 'all',
    sort: 'id',
    dir: 'asc',
    selected: new Set(),
    editingId: null,
    history: [],
    future: [],
    savedAt: null,
    fileDirty: false,
    fileSavedAt: null,
    jsonHandle: null,
    csvHandle: null,
    theme: 'auto',
    layout: DEFAULT_LAYOUT,
    statsVisible: DEFAULT_STATS_VISIBLE,
    stamp: BUNDLE.stamp,
  };

  var BASELINE = new Map(BUNDLE.terms.map(function (t) { return [Number(t.id), normalizeTerm(t, t.id)]; }));

  var E = {};
  var editorDraft = null;
  var editorOriginal = null;
  var editorMode = 'edit';
  var editorDirty = false;
  var drawerOpen = false;
  var drawerHideTimer = null;
  var mediaDrafts = { term: [], proverb: [] };
  var mediaPickHandler = null;
  var confirmResolver = null;
  var pendingImport = null;
  var persistTimer = null;
  var storageWarned = false;
  var toastTimer = null;

  /* ------------------------------------------------------------
     Utilities
     ------------------------------------------------------------ */
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneMedia(media) {
    return (media || []).map(function (item) { return Object.assign({}, item); });
  }

  function $(id) { return document.getElementById(id); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function isHttp(url) { return HTTP_RE.test(String(url || '')); }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  }

  function plural(count, singular, pluralForm) {
    return count + ' ' + (count === 1 ? singular : (pluralForm || singular + 's'));
  }

  function toast(message, kind) {
    E.toast.textContent = message;
    E.toast.className = 'toast show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { E.toast.className = 'toast'; }, 3400);
  }

  function deriveLabel(url) {
    var last = String(url || '').split(/[/?#]/).filter(Boolean).pop() || url;
    try { last = decodeURIComponent(last); } catch (e) { /* keep raw */ }
    return String(last).replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  /* ------------------------------------------------------------
     Normalisation / derivation
     ------------------------------------------------------------ */
  function toPlain(pinyin) {
    return String(pinyin || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeRank(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim();
    if (text === '') return null;
    var numeric = Number(text);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 9) return null;
    return numeric;
  }

  function normalizeTerm(raw, idOverride) {
    raw = raw || {};
    var simplified = String(raw.simplified == null ? '' : raw.simplified)
      .normalize('NFKC')
      .replace(/\s+/g, '');
    var traditional = String(raw.traditional == null ? '' : raw.traditional)
      .normalize('NFKC')
      .replace(/\s+/g, '');
    if (traditional === simplified) traditional = '';

    var pinyin = String(raw.pinyin == null ? '' : raw.pinyin)
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim();
    var pinyinPlain = toPlain(pinyin);
    var english = String(raw.english == null ? '' : raw.english)
      .replace(/\s+/g, ' ')
      .trim();
    var senses = english ? english.split(/\s*;\s*/).map(function (s) { return s.trim(); }).filter(Boolean) : [];

    var rawLinks = Array.isArray(raw.sensei_links) ? raw.sensei_links : [];
    if (!rawLinks.length && typeof raw.sensei_urls === 'string' && raw.sensei_urls.trim()) {
      rawLinks = raw.sensei_urls.split('|').map(function (url) { return { url: url.trim(), label: '' }; });
    }
    var links = rawLinks.map(function (link) {
      if (typeof link === 'string') return { url: link.trim(), label: deriveLabel(link) };
      var url = String((link && link.url) || '').trim();
      return {
        url: url,
        label: String((link && link.label) || '').trim() || deriveLabel(url),
      };
    }).filter(function (link) { return link.url; });

    var altForms = Array.isArray(raw.alt_forms)
      ? raw.alt_forms.join('|')
      : String(raw.alt_forms == null ? '' : raw.alt_forms).trim();
    var definitionZh = String(raw.definition_zh == null ? '' : raw.definition_zh)
      .replace(/\s+/g, ' ')
      .trim();
    var notes = String(raw.notes == null ? '' : raw.notes)
      .replace(/\s+/g, ' ')
      .trim();
    var source = String(raw.source == null ? '' : raw.source).trim();

    var legacyRaw = raw.legacy_id;
    var legacyId = '';
    if (legacyRaw !== '' && legacyRaw != null) {
      var legacyNumber = Number(legacyRaw);
      legacyId = Number.isFinite(legacyNumber) && String(legacyNumber) === String(legacyRaw).trim()
        ? legacyNumber
        : String(legacyRaw).trim();
    }

    var generalMeaning = raw.general_meaning === true || raw.general_meaning === 'true' || raw.general_meaning === 1;

    var fallbackLetter = String(raw.letter || '').trim();
    var letter = (pinyinPlain ? pinyinPlain.charAt(0) : fallbackLetter.charAt(0)).toUpperCase();

    var idSource = idOverride != null ? idOverride : raw.id;
    var numericId = Number(idSource);
    if (!Number.isFinite(numericId)) numericId = Number(raw.id);
    if (!Number.isFinite(numericId)) numericId = 0;

    return {
      id: numericId,
      rank: normalizeRank(raw.rank),
      legacy_id: legacyId,
      letter: letter,
      simplified: simplified,
      traditional: traditional,
      traditional_variants: traditional ? [simplified, traditional] : [simplified],
      alt_forms: altForms,
      chinese_raw: traditional ? simplified + ' (' + traditional + ')' : simplified,
      pinyin: pinyin,
      pinyin_plain: pinyinPlain,
      english: english,
      senses: senses,
      definition_zh: definitionZh,
      source: source,
      general_meaning: generalMeaning,
      notes: notes,
      sensei_links: links,
      media: window.GoMedia ? window.GoMedia.normalizeMedia(raw.media) : [],
    };
  }

  function termSignature(term) {
    return JSON.stringify([
      term.id,
      term.rank,
      term.legacy_id,
      term.letter,
      term.simplified,
      term.traditional,
      term.alt_forms,
      term.pinyin,
      term.pinyin_plain,
      term.english,
      term.senses,
      term.definition_zh,
      term.source,
      term.general_meaning,
      term.notes,
      term.sensei_links.map(function (link) { return link.url + '|' + link.label; }),
      (term.media || []).map(function (item) {
        return item.type + '|' + item.name + '|' + item.data.length + '|' + item.data.slice(0, 48) + '|' + item.data.slice(-32);
      }),
    ]);
  }

  function isEdited(term) {
    var base = BASELINE.get(Number(term.id));
    return !base || termSignature(base) !== termSignature(term);
  }

  function countEdited() {
    return state.terms.filter(isEdited).length;
  }

  function nextId() {
    var max = 0;
    state.terms.forEach(function (term) { max = Math.max(max, Number(term.id) || 0); });
    return max + 1;
  }

  function draftFromTerm(term) {
    return {
      rank: term.rank == null ? '' : String(term.rank),
      simplified: term.simplified,
      traditional: term.traditional,
      pinyin: term.pinyin,
      english: term.english,
      legacy_id: term.legacy_id === '' || term.legacy_id == null ? '' : String(term.legacy_id),
      alt_forms: term.alt_forms || '',
      definition_zh: term.definition_zh || '',
      source: term.source || '',
      general_meaning: !!term.general_meaning,
      notes: term.notes || '',
      links: term.sensei_links.map(function (link) { return { url: link.url, label: link.label }; }),
      media: (term.media || []).map(function (item) { return Object.assign({}, item); }),
    };
  }

  function blankDraft() {
    return {
      rank: '',
      simplified: '',
      traditional: '',
      pinyin: '',
      english: '',
      legacy_id: '',
      alt_forms: '',
      definition_zh: '',
      source: '',
      general_meaning: false,
      notes: '',
      links: [],
      media: [],
    };
  }

  function draftKey(draft) {
    return JSON.stringify([
      draft.rank,
      draft.simplified,
      draft.traditional,
      draft.pinyin,
      draft.english,
      draft.legacy_id,
      draft.alt_forms,
      draft.definition_zh,
      draft.source,
      !!draft.general_meaning,
      draft.notes,
      (draft.links || []).map(function (link) { return link.url + '|' + link.label; }),
      (draft.media || []).map(function (item) {
        return item.type + '|' + item.name + '|' + item.data.length + '|' + item.data.slice(0, 48) + '|' + item.data.slice(-32);
      }),
    ]);
  }

  /* ------------------------------------------------------------
     Indexing and validation
     ------------------------------------------------------------ */
  function dupKey(term) {
    return term.simplified + '\u0000' + term.pinyin;
  }

  function buildIndex(terms) {
    var index = {
      byId: new Map(),
      byKey: new Map(),
      bySimplified: new Map(),
      idCounts: new Map(),
    };
    terms.forEach(function (term) {
      var id = Number(term.id) || 0;
      index.byId.set(id, term);
      index.idCounts.set(id, (index.idCounts.get(id) || 0) + 1);

      var key = dupKey(term);
      if (!index.byKey.has(key)) index.byKey.set(key, []);
      index.byKey.get(key).push(term);

      var simplified = term.simplified;
      if (!index.bySimplified.has(simplified)) index.bySimplified.set(simplified, []);
      index.bySimplified.get(simplified).push(term);
    });
    return index;
  }

  function issuesFor(term, index) {
    var issues = [];
    function push(level, field, message) { issues.push({ level: level, field: field, message: message }); }

    if (!term.simplified) {
      push('error', 'simplified', 'Simplified characters are required.');
    } else if (!CJK_RE.test(term.simplified)) {
      push('warning', 'simplified', 'The simplified form contains characters outside the CJK range.');
    }

    if (term.traditional && !CJK_RE.test(term.traditional)) {
      push('warning', 'traditional', 'The traditional form contains characters outside the CJK range.');
    }

    if (!term.pinyin) {
      push('warning', 'pinyin', 'Pinyin is missing.');
    } else if (!TONE_RE.test(term.pinyin)) {
      push('note', 'pinyin', 'The pinyin has no tone marks — check the reading.');
    }

    if (!term.english) {
      push('warning', 'english', 'An English gloss is missing.');
    }

    if (BUNDLE.kind === 'merged') {
      if (!term.source) {
        push('warning', 'source', 'The origin source is missing.');
      }
      if (term.alt_forms) {
        var badForm = term.alt_forms.split('|').some(function (form) {
          return form.trim() && !CJK_RE.test(form.trim());
        });
        if (badForm) {
          push('warning', 'alt_forms', 'Alternative forms should be CJK characters separated by |.');
        }
      }
      if (term.legacy_id !== '' && !Number.isInteger(Number(term.legacy_id))) {
        push('note', 'legacy_id', 'The legacy ID is not a number.');
      }
    }

    term.sensei_links.forEach(function (link, index_) {
      if (!isHttp(link.url)) {
        push('warning', 'links', 'Link ' + (index_ + 1) + ' is not an http(s) URL.');
      }
    });

    var duplicates = (index.byKey.get(dupKey(term)) || []).filter(function (other) { return other !== term; });
    duplicates.forEach(function (other) {
      if (Number(other.id) > 0) {
        push('error', 'simplified', 'Duplicate of #' + other.id + ' — the same characters and reading already exist.');
      }
    });

    var sameCharacters = (index.bySimplified.get(term.simplified) || []).filter(function (other) { return other !== term; });
    if (sameCharacters.length && !duplicates.length && term.simplified) {
      var ids = sameCharacters.map(function (other) { return '#' + other.id; }).join(', ');
      push('note', 'simplified', 'The characters ' + term.simplified + ' also appear in ' + ids + ' with another reading — verify this is intentional.');
    }

    var idCount = index.idCounts.get(Number(term.id)) || 0;
    if (Number(term.id) > 0 && idCount > 1) {
      push('error', 'id', 'The ID #' + term.id + ' is used by more than one term.');
    }

    var order = { error: 0, warning: 1, note: 2 };
    return issues.sort(function (a, b) { return order[a.level] - order[b.level]; });
  }

  function hasReview(term, index) {
    return issuesFor(term, index).some(function (issue) { return issue.level !== 'note'; });
  }

  function countIssues() {
    var index = buildIndex(state.terms);
    var counts = { error: 0, warning: 0, note: 0, termsWithErrors: 0, termsWithWarnings: 0 };
    state.terms.forEach(function (term) {
      var issues = issuesFor(term, index);
      var err = false;
      var warn = false;
      issues.forEach(function (issue) {
        if (issue.level === 'error') { counts.error += 1; err = true; }
        else if (issue.level === 'warning') { counts.warning += 1; warn = true; }
        else { counts.note += 1; }
      });
      if (err) counts.termsWithErrors += 1;
      if (warn) counts.termsWithWarnings += 1;
    });
    counts.termsToReview = counts.termsWithErrors + counts.termsWithWarnings;
    return counts;
  }

  /* ------------------------------------------------------------
     View: search, filter, sort
     ------------------------------------------------------------ */
  function queryTokens() {
    var seen = new Set();
    state.query.toLowerCase().split(/\s+/).forEach(function (token) {
      if (token) seen.add(token);
    });
    return Array.from(seen).slice(0, 8);
  }

  function matchesQuery(term, tokens) {
    if (!tokens.length) return true;
    var haystack = [
      term.simplified,
      term.traditional,
      term.pinyin,
      term.pinyin_plain,
      term.english,
      term.letter,
      term.definition_zh,
      term.alt_forms,
      term.source,
      term.notes,
      term.sensei_links.map(function (link) { return link.label; }).join(' '),
    ].join(' ').toLowerCase();
    var compact = String(term.pinyin_plain || '').replace(/\s+/g, '');
    return tokens.every(function (token) {
      return haystack.indexOf(token) !== -1 || (compact && compact.indexOf(token.replace(/\s+/g, '')) !== -1);
    });
  }

  function sortValue(term) {
    switch (state.sort) {
      case 'simplified': return term.simplified;
      case 'pinyin': return term.pinyin_plain || term.pinyin;
      case 'english': return term.english;
      case 'letter': return (term.letter || '') + String(term.id).padStart(6, '0');
      default: return Number(term.id) || 0;
    }
  }

  function compareTerms(a, b) {
    var result;
    if (state.sort === 'id') {
      result = (Number(a.id) || 0) - (Number(b.id) || 0);
    } else if (state.sort === 'simplified') {
      result = CN_COLLATOR.compare(a.simplified, b.simplified);
    } else if (state.sort === 'rank') {
      if (a.rank == null && b.rank == null) result = 0;
      else if (a.rank == null) result = 1;
      else if (b.rank == null) result = -1;
      else result = a.rank - b.rank;
    } else {
      result = EN_COLLATOR.compare(String(sortValue(a)), String(sortValue(b)));
    }
    if (result === 0) result = (Number(a.id) || 0) - (Number(b.id) || 0);
    return result;
  }

  function computeView() {
    var index = buildIndex(state.terms);
    var tokens = queryTokens();
    var rows = state.terms.filter(function (term) {
      var letter = term.letter || '#';
      if (state.letter !== 'ALL' && letter !== state.letter) return false;
      if (state.rank !== 'ALL') {
        if (state.rank === 'NONE') {
          if (term.rank != null) return false;
        } else if (term.rank !== Number(state.rank)) {
          return false;
        }
      }
      if (!matchesQuery(term, tokens)) return false;

      switch (state.filter) {
        case 'review': return hasReview(term, index);
        case 'edited': return isEdited(term);
        case 'multisense': return term.senses.length > 1;
        case 'nolink': return term.sensei_links.length === 0;
        case 'general': return term.general_meaning;
        case 'media': return (term.media || []).length > 0;
        case 'source-yf': return term.source === 'yeefan.sg';
        case 'source-sl': return term.source === 'senseis.xmp.net';
        case 'source-gm': return term.source === 'gomagic.org';
        case 'duplicates': return (index.bySimplified.get(term.simplified) || []).length > 1;
        default: return true;
      }
    });

    rows.sort(compareTerms);
    if (state.dir === 'desc') rows.reverse();
    return { rows: rows, index: index, tokens: tokens };
  }

  /* ------------------------------------------------------------
     Rendering — table
     ------------------------------------------------------------ */
  function makeHighlighter(tokens) {
    if (!tokens.length) {
      return function (value) { return escapeHtml(value); };
    }
    var pattern = tokens.slice().sort(function (a, b) { return b.length - a.length; }).map(escapeRegExp).join('|');
    var regex = new RegExp('(' + pattern + ')', 'gi');
    return function (value) {
      var text = String(value == null ? '' : value);
      return text.split(regex).map(function (part, index) {
        return index % 2 ? '<mark>' + escapeHtml(part) + '</mark>' : escapeHtml(part);
      }).join('');
    };
  }

  function pinyinHtml(term, tokens) {
    if (!term.pinyin) return '<span class="muted">—</span>';
    if (!tokens.length) return escapeHtml(term.pinyin);
    var compact = String(term.pinyin_plain || '').replace(/\s+/g, '');
    var wholeHit = tokens.some(function (token) {
      var cleaned = token.replace(/\s+/g, '');
      return cleaned && cleaned === compact;
    });
    var syllables = term.pinyin.split(/\s+/);
    return syllables.map(function (syllable, index) {
      var plain = toPlain(syllable);
      var hit = wholeHit || tokens.some(function (token) {
        var cleaned = token.replace(/\s+/g, '');
        return cleaned && plain.indexOf(cleaned) !== -1;
      });
      return (hit ? '<mark>' : '') + escapeHtml(syllable) + (hit ? '</mark>' : '') +
        (index < syllables.length - 1 ? ' ' : '');
    }).join('');
  }

  function sourceTag(term) {
    if (BUNDLE.kind !== 'merged' || !term.source) return '';
    var key = 'other';
    var label = term.source.slice(0, 2).toUpperCase();
    if (/yeefan/i.test(term.source)) { key = 'yf'; label = 'YF'; }
    else if (/senseis/i.test(term.source)) { key = 'sl'; label = 'SL'; }
    else if (/gomagic/i.test(term.source)) { key = 'gm'; label = 'GM'; }
    return '<span class="source-tag src-' + key + '" title="Source: ' + escapeHtml(term.source) +
      '" aria-label="Source: ' + escapeHtml(term.source) + '">' + escapeHtml(label) + '</span>';
  }

  function rowHtml(term, index, highlight, tokens) {
    var issues = issuesFor(term, index);
    var hasError = issues.some(function (issue) { return issue.level === 'error'; });
    var hasWarning = issues.some(function (issue) { return issue.level === 'warning'; });
    var edited = isEdited(term);
    var selected = state.selected.has(term.id);
    var links = term.sensei_links.filter(function (link) { return isHttp(link.url); });

    var traditional = term.traditional
      ? '<span class="cn-traditional">(' + highlight(term.traditional) + ')</span>'
      : '';

    var meta = sourceTag(term);
    if (term.general_meaning) {
      meta += '<span class="general-tag" title="General vocabulary, not Go jargon">general</span>';
    }
    var senseParts = term.senses.map(function (sense) {
      return '<span class="sense">' + highlight(sense) + '</span>';
    });
    var senses = (senseParts.length || meta)
      ? '<div class="senses">' + meta + senseParts.join('') + '</div>'
      : '<span class="muted">—</span>';

    var linkHtml = links.length
      ? '<div class="link-cell">' + links.map(function (link, index_) {
        return '<a class="link-chip" href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener" ' +
          'title="' + escapeHtml(link.label || link.url) + '" aria-label="Open source link ' + (index_ + 1) + '">' +
          '<svg class="icon"><use href="#i-external"></use></svg></a>';
      }).join('') + '</div>'
      : '<span class="muted">—</span>';

    var mediaHtml = '<span class="muted">—</span>';
    if (term.media && term.media.length) {
      mediaHtml = '<button type="button" class="media-thumb" data-media-index="0" title="' +
        escapeHtml(window.GoMedia.describeMedia(term.media[0])) + '">' +
        window.GoMedia.mediaThumbHtml(term.media[0], 30) + '</button>' +
        (term.media.length > 1 ? '<span class="media-count">+' + (term.media.length - 1) + '</span>' : '');
    }

    var issueTitle = issues.map(function (issue) { return issue.message; }).join(' · ');

    return '<tr data-id="' + term.id + '"' + (selected ? ' class="selected"' : '') + ' tabindex="0">' +
      '<td class="col-check"><input type="checkbox" class="row-check"' + (selected ? ' checked' : '') +
        ' aria-label="Select #' + term.id + ' ' + escapeHtml(term.simplified) + '"></td>' +
      '<td class="col-id"><span class="id-cell">' +
        (edited ? '<span class="edited-dot" title="Edited from the bundled snapshot"></span>' : '') +
        term.id +
        ((hasError || hasWarning) ? '<span class="issue-dot' + (hasError ? ' error' : '') + '" title="' +
          escapeHtml(issueTitle) + '"></span>' : '') +
        '</span></td>' +
      '<td class="col-rank">' + (term.rank == null ? '' :
        '<span class="rank-badge">' + term.rank + '</span>') + '</td>' +
      '<td class="col-letter"><span class="letter-chip-cell">' + escapeHtml(term.letter || '–') + '</span></td>' +
      '<td class="col-cn"><span class="cn-simplified">' + highlight(term.simplified) + '</span>' + traditional +
        (term.pinyin ? '<span class="mobile-pinyin">' + pinyinHtml(term, tokens) + '</span>' : '') + '</td>' +
      '<td class="col-pinyin"><span class="pinyin-cell" title="' + escapeHtml(term.pinyin_plain || '') + '">' +
        pinyinHtml(term, tokens) + '</span></td>' +
      '<td class="col-english">' + senses + '</td>' +
      '<td class="col-links">' + linkHtml + '</td>' +
      '<td class="col-media">' + mediaHtml + '</td>' +
      '<td class="col-actions"><div class="row-actions">' +
        '<button type="button" class="row-action" data-act="edit" title="Edit #' + term.id + '">' +
          '<svg class="icon"><use href="#i-edit"></use></svg></button>' +
        '<button type="button" class="row-action danger" data-act="delete" title="Delete #' + term.id + '">' +
          '<svg class="icon"><use href="#i-trash"></use></svg></button>' +
      '</div></td>' +
    '</tr>';
  }

  function renderTable() {
    var view = computeView();
    var highlight = makeHighlighter(view.tokens);
    var rows = view.rows;

    E.termBody.innerHTML = rows.map(function (term) {
      return rowHtml(term, view.index, highlight, view.tokens);
    }).join('');
    E.termTable.style.display = rows.length ? '' : 'none';
    E.emptyState.hidden = rows.length > 0;

    var filterLabels = {
      all: '',
      review: 'needs review',
      edited: 'edited',
      multisense: 'multiple senses',
      nolink: 'no source link',
      general: 'general vocabulary',
      media: 'with diagrams',
      'source-yf': 'from Yee Fan',
      'source-sl': 'from Sensei',
      'source-gm': 'from Go Magic',
      duplicates: 'shared characters',
    };
    var context = [];
    if (state.query.trim()) context.push('“' + state.query.trim() + '”');
    if (state.letter !== 'ALL') context.push('section ' + state.letter);
    if (state.rank !== 'ALL') context.push(state.rank === 'NONE' ? 'unranked' : 'rank ' + state.rank);
    if (state.filter !== 'all') context.push(filterLabels[state.filter]);

    E.resultSummary.textContent = context.length
      ? rows.length + ' of ' + state.terms.length + ' terms · ' + context.join(' · ')
      : plural(state.terms.length, 'term');

    $$('th[data-sort]').forEach(function (th) {
      var active = th.dataset.sort === state.sort;
      th.classList.toggle('sorted', active);
      th.setAttribute('aria-sort', active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      var arrow = th.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = active ? (state.dir === 'asc' ? '↑' : '↓') : '';
    });

    updateSelectionUI();

    var letters = new Set(state.terms.map(function (term) { return term.letter || '#'; }));
    var linkCount = state.terms.reduce(function (total, term) { return total + term.sensei_links.length; }, 0);
    var origins = new Set(state.terms.map(function (term) { return term.source; }).filter(Boolean));
    var snapshot = BUNDLE.retrieved ? ' · snapshot ' + fmtDate(BUNDLE.retrieved) : '';
    var originText = BUNDLE.kind === 'merged' ? ' · ' + origins.size + ' sources' : '';
    E.footerSummary.textContent = letters.size + ' sections · ' + linkCount + ' source links' + originText + snapshot;

    E.brandCount.textContent = state.terms.length;
    E.brandEdition.textContent = BUNDLE.label;
    return view;
  }

  function updateSelectionUI() {
    var view = computeView();
    var visible = view.rows;
    var selectedVisible = visible.filter(function (term) { return state.selected.has(term.id); }).length;

    E.selectAll.checked = visible.length > 0 && selectedVisible === visible.length;
    E.selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    E.bulkBar.hidden = state.selected.size === 0;
    E.selCount.textContent = plural(state.selected.size, 'selected term', 'selected terms');
  }

  function renderStats() {
    var counts = countIssues();
    var merged = BUNDLE.kind === 'merged';
    E.statTotal.textContent = state.terms.length;
    E.statEdited.textContent = countEdited();
    E.statReview.textContent = counts.termsToReview;

    if (merged) {
      E.statExtra.textContent = state.terms.filter(function (term) { return term.general_meaning; }).length;
      E.statExtraLabel.textContent = 'General vocab';
      E.statExtraNote.textContent = 'ordinary words, not Go jargon';
      E.statExtraButton.dataset.stat = 'general';
    } else {
      E.statExtra.textContent = state.terms.filter(function (term) { return term.sensei_links.length === 0; }).length;
      E.statExtraLabel.textContent = 'No source link';
      E.statExtraNote.textContent = "no Sensei's Library link";
      E.statExtraButton.dataset.stat = 'nolink';
    }

    E.reviewCount.textContent = counts.termsToReview;
    E.reviewCount.dataset.tone = counts.error ? 'error' : (counts.warning ? 'warn' : '');
    E.reviewBtn.title = counts.error + ' term errors, ' + counts.warning + ' term warnings';

    $$('.stat[data-stat]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.stat === state.filter);
    });
    E.reviewDialog.dataset.ready = '1';
    updateGlobalBadges(counts);
  }

  function renderFilterOptions() {
    var merged = BUNDLE.kind === 'merged';
    var options = [
      { value: 'all', label: 'All terms' },
      { value: 'review', label: 'Needs review' },
      { value: 'edited', label: 'Edited only' },
      { value: 'multisense', label: 'Multiple senses' },
      { value: 'media', label: 'With diagrams' },
    ];
    if (merged) {
      options.push({ value: 'general', label: 'General vocabulary' });
      options.push({ value: 'source-yf', label: 'From Yee Fan' });
      options.push({ value: 'source-sl', label: 'From Sensei' });
      options.push({ value: 'source-gm', label: 'From Go Magic' });
    } else {
      options.push({ value: 'nolink', label: 'No source link' });
    }
    options.push({ value: 'duplicates', label: 'Shared characters' });

    var values = new Set(options.map(function (option) { return option.value; }));
    if (!values.has(state.filter)) state.filter = 'all';
    E.filterSelect.innerHTML = options.map(function (option) {
      return '<option value="' + option.value + '">' + option.label + '</option>';
    }).join('');
    E.filterSelect.value = state.filter;
  }

  function renderLetters() {
    var counts = new Map();
    state.terms.forEach(function (term) {
      var letter = term.letter || '#';
      counts.set(letter, (counts.get(letter) || 0) + 1);
    });
    var letters = Array.from(counts.keys()).sort(function (a, b) {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });

    var html = '<button type="button" class="letter-chip' + (state.letter === 'ALL' ? ' active' : '') +
      '" data-letter="ALL" title="All sections">All<span class="chip-count">' + state.terms.length + '</span></button>';
    letters.forEach(function (letter) {
      html += '<button type="button" class="letter-chip' + (state.letter === letter ? ' active' : '') +
        '" data-letter="' + escapeHtml(letter) + '" title="Section ' + escapeHtml(letter) + ' · ' +
        counts.get(letter) + ' terms">' + escapeHtml(letter) +
        '<span class="chip-count">' + counts.get(letter) + '</span></button>';
    });
    E.letterChips.innerHTML = html;
  }

  function renderStatus() {
    if (state.fileDirty && state.jsonHandle) {
      E.savedIndicator.innerHTML = '<span class="dot"></span>Unsaved file changes';
      E.savedIndicator.classList.add('dirty');
    } else if (state.savedAt) {
      E.savedIndicator.textContent = 'Autosaved ' + fmtTime(state.savedAt);
      E.savedIndicator.classList.remove('dirty');
    } else {
      E.savedIndicator.textContent = 'Not saved yet';
      E.savedIndicator.classList.remove('dirty');
    }

    if (state.jsonHandle) {
      var stateText = state.fileDirty ? 'not written' : 'up to date';
      E.fileStatus.innerHTML = '<span class="dot"></span>' + escapeHtml(state.jsonHandle.name) + ' · ' + stateText;
      E.saveJsonBtn.title = 'Write ' + state.jsonHandle.name + ' in place';
    } else {
      E.fileStatus.textContent = 'No data file connected';
      E.saveJsonBtn.title = 'Save ' + (BUNDLE.file || 'go-terms.json') + ' (choose a file)';
    }

    E.undoBtn.disabled = state.history.length === 0;
    E.redoBtn.disabled = state.future.length === 0;
  }

  function renderAll() {
    renderStats();
    renderLetters();
    renderTable();
    renderStatus();
  }

  function updateGlobalBadges(termCounts) {
    if (!E.brandCount) return;
    var pCount = window.GoProverbs ? window.GoProverbs.count() : 0;
    var pReview = window.GoProverbs ? window.GoProverbs.reviewCount() : 0;
    var counts = termCounts || countIssues();
    var total = counts.termsToReview + pReview;

    E.brandCount.textContent = state.terms.length;
    E.brandProverbs.textContent = pCount;
    E.tabTermCount.textContent = state.terms.length;
    E.tabProverbCount.textContent = pCount;
    if (E.statsBadge) {
      E.statsBadge.textContent = state.view === 'proverbs' ? pCount : state.terms.length;
    }

    E.reviewCount.textContent = total;
    E.reviewCount.dataset.tone = counts.error ? 'error' : ((counts.warning || pReview) ? 'warn' : '');
    E.reviewBtn.title = counts.error + ' term errors, ' + counts.warning + ' term warnings, ' +
      pReview + ' proverb issues';
  }

  function updateFileLabels() {
    if (!E.fileMenu) return;
    var proverbs = state.view === 'proverbs';
    var connect = E.fileMenu.querySelector('[data-action="connect"]');
    var importAction = E.fileMenu.querySelector('[data-action="import"]');
    if (connect) connect.textContent = proverbs ? 'Connect go-proverbs.json…' : 'Connect ' + (BUNDLE.file || 'go-terms.json') + '…';
    if (importAction) importAction.textContent = proverbs ? 'Import proverbs…' : 'Import terms…';
    E.globalHint.textContent = proverbs ? '棋谚 · Proverbs' : BUNDLE.label + ' · Terms';
    E.newTermBtn.innerHTML = '<svg class="icon"><use href="#i-plus"></use></svg> ' +
      (proverbs ? 'New proverb' : 'New term');
  }

  async function setView(view, options) {
    options = options || {};
    if (view !== 'terms' && view !== 'proverbs') return;
    if (view === state.view && !options.force) {
      updateGlobalBadges();
      return;
    }
    if (view === 'proverbs' && !window.GoProverbs) {
      toast('No proverb bundle is available.', 'error');
      return;
    }

    if (!options.initial) {
      if (editorDirty) {
        var discardTerms = await confirmAction(
          'Switch section?',
          'The term in the editor has unsaved changes. Switch and discard them?',
          'Switch',
          true
        );
        if (!discardTerms) return;
      }
      if (window.GoProverbs && window.GoProverbs.isDirty()) {
        var discardProverbs = await confirmAction(
          'Switch section?',
          'The proverb in the editor has unsaved changes. Switch and discard them?',
          'Switch',
          true
        );
        if (!discardProverbs) return;
      }
    }

    closeDrawer(true);
    if (window.GoProverbs) window.GoProverbs.closeEditor(true);

    state.view = view;
    try { localStorage.setItem(LS_VIEW, view); } catch (e) { /* ignore */ }

    E.termsView.hidden = view !== 'terms';
    E.proverbsView.hidden = view !== 'proverbs';
    E.tabTerms.classList.toggle('active', view === 'terms');
    E.tabProverbs.classList.toggle('active', view === 'proverbs');
    E.tabTerms.setAttribute('aria-selected', String(view === 'terms'));
    E.tabProverbs.setAttribute('aria-selected', String(view === 'proverbs'));

    updateFileLabels();
    updateGlobalBadges();
    renderColumnsMenu();
    applyColumns();

    if (view === 'proverbs') {
      window.GoProverbs.onActivate();
    } else {
      renderTable();
      renderStatus();
      if (!options.initial) E.search.focus({ preventScroll: true });
    }
  }

  function openPdf() {
    var popup = window.open('', '_blank');
    if (!popup) {
      toast('Allow pop-ups to open the PDF preview.', 'error');
      return;
    }
    var proverbs = window.GoProverbs ? window.GoProverbs.getItems() : [];
    var html = window.GoPrint.buildHtml({
      terms: state.terms,
      proverbs: proverbs,
      kind: BUNDLE.kind,
      editionLabel: BUNDLE.label,
      locale: undefined,
    });
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
  }

  /* ------------------------------------------------------------
     Persistence
     ------------------------------------------------------------ */
  function storageKey() {
    return LS_KEY + '.' + state.editionKey;
  }

  function persistNow() {
    clearTimeout(persistTimer);
    try {
      var payload = {
        version: TOOL_VERSION,
        stamp: state.stamp,
        savedAt: new Date().toISOString(),
        terms: state.terms,
      };
      localStorage.setItem(storageKey(), JSON.stringify(payload));
      state.savedAt = payload.savedAt;
    } catch (error) {
      if (!storageWarned) {
        storageWarned = true;
        toast('Local autosave is unavailable. Use Save JSON to keep your changes.', 'error');
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

  function loadWorkingCopy() {
    var key = storageKey();
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { raw = null; }

    // Older builds stored the base edition under the un-suffixed key.
    if (!raw && state.editionKey === 'base') {
      try {
        raw = localStorage.getItem(LS_KEY);
        if (raw) localStorage.setItem(key, raw);
      } catch (e) { /* ignore */ }
    }

    var stored = null;
    if (raw) {
      try {
        stored = JSON.parse(raw);
      } catch (error) {
        try { localStorage.setItem(key + '.corrupt', raw); } catch (e) { /* ignore */ }
        toast('The saved working copy was unreadable — starting from the bundled snapshot.', 'error');
      }
    }

    if (stored && Array.isArray(stored.terms) && stored.terms.length) {
      state.terms = stored.terms.map(function (term) { return normalizeTerm(term, term.id); });
      state.stamp = stored.stamp || BUNDLE.stamp;
      state.savedAt = stored.savedAt || null;
      if (BUNDLE.stamp && state.stamp !== BUNDLE.stamp) showSnapshotBanner();
    } else {
      state.terms = clone(BUNDLE.terms).map(function (term) { return normalizeTerm(term, term.id); });
      state.stamp = BUNDLE.stamp;
      persistNow();
    }
  }

  function dismissSnapshot() {
    try { localStorage.setItem(LS_DISMISS + '.' + state.editionKey, BUNDLE.stamp); } catch (e) { /* ignore */ }
  }

  function hideBanner() {
    E.banner.hidden = true;
  }

  function showBanner(html, actions) {
    E.bannerText.innerHTML = html;
    E.bannerActions.innerHTML = '';
    (actions || []).forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn mini ' + (action.kind || '');
      button.textContent = action.label;
      button.addEventListener('click', action.onClick);
      E.bannerActions.appendChild(button);
    });
    E.banner.hidden = false;
  }

  function showSnapshotBanner() {
    var dismissed = null;
    try { dismissed = localStorage.getItem(LS_DISMISS + '.' + state.editionKey); } catch (e) { dismissed = null; }
    if (dismissed === BUNDLE.stamp) return;

    E.bannerText.innerHTML = 'The bundled ' + escapeHtml(BUNDLE.label.toLowerCase()) + ' snapshot is newer (' +
      plural(BUNDLE.count, 'term') + (BUNDLE.retrieved ? ', ' + fmtDate(BUNDLE.retrieved) : '') +
      ') than the working copy stored in this browser. Nothing has been overwritten.';
    E.bannerActions.innerHTML = '';

    var keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn mini ghost';
    keep.textContent = 'Keep my copy';
    keep.addEventListener('click', function () {
      dismissSnapshot();
      E.banner.hidden = true;
    });

    var use = document.createElement('button');
    use.type = 'button';
    use.className = 'btn mini primary';
    use.textContent = 'Use bundled data';
    use.addEventListener('click', useBundledData);

    E.bannerActions.appendChild(keep);
    E.bannerActions.appendChild(use);
    E.banner.hidden = false;
  }

  async function useBundledData() {
    var ok = await confirmAction(
      'Use the bundled snapshot?',
      'This replaces the current working copy (' + plural(state.terms.length, 'term') +
        ') with the bundled ' + plural(BUNDLE.count, 'term') + '. You can undo this.',
      'Use bundled data'
    );
    if (!ok) return;
    pushHistory();
    state.terms = clone(BUNDLE.terms).map(function (term) { return normalizeTerm(term, term.id); });
    state.stamp = BUNDLE.stamp;
    state.savedAt = null;
    state.selected.clear();
    E.banner.hidden = true;
    dismissSnapshot();
    persist();
    renderAll();
    toast('Loaded the bundled ' + BUNDLE.label.toLowerCase() + '.');
  }

  /* ------------------------------------------------------------
     History
     ------------------------------------------------------------ */
  function pushHistory() {
    state.history.push(clone(state.terms));
    if (state.history.length > 60) state.history.shift();
    state.future.length = 0;
  }

  function undo() {
    if (!state.history.length) {
      toast('Nothing to undo.');
      return;
    }
    closeDrawer(true);
    state.future.push(clone(state.terms));
    state.terms = state.history.pop();
    state.selected.clear();
    persist();
    renderAll();
    toast('Undone.');
  }

  function redo() {
    if (!state.future.length) {
      toast('Nothing to redo.');
      return;
    }
    closeDrawer(true);
    state.history.push(clone(state.terms));
    state.terms = state.future.pop();
    state.selected.clear();
    persist();
    renderAll();
    toast('Redone.');
  }

  /* ------------------------------------------------------------
     Drawer / editor
     ------------------------------------------------------------ */
  function showDrawer() {
    drawerOpen = true;
    clearTimeout(drawerHideTimer);
    E.scrim.hidden = false;
    E.editor.hidden = false;
    E.editor.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      E.scrim.classList.add('show');
      E.editor.classList.add('open');
    });
    setTimeout(function () {
      if (!drawerOpen) return;
      if (E.f_simplified) {
        E.f_simplified.focus();
        if (E.f_simplified.value) E.f_simplified.select();
      }
    }, 120);
  }

  function closeDrawer(force) {
    if (!force && editorDirty) {
      return confirmAction(
        'Discard changes?',
        'Your edits to this term have not been saved.',
        'Discard',
        true
      ).then(function (ok) {
        if (!ok) return false;
        hideDrawer();
        return true;
      });
    }
    hideDrawer();
    return Promise.resolve(true);
  }

  function hideDrawer() {
    editorDirty = false;
    drawerOpen = false;
    clearTimeout(drawerHideTimer);

    var wasVisible = E.editor.classList.contains('open') || !E.editor.hidden;
    if (!wasVisible) {
      E.scrim.hidden = true;
      E.editor.hidden = true;
      document.body.style.overflow = '';
      state.editingId = null;
      return;
    }

    E.editor.classList.remove('open');
    E.editor.setAttribute('aria-hidden', 'true');
    E.scrim.classList.remove('show');
    document.body.style.overflow = '';
    drawerHideTimer = setTimeout(function () {
      if (drawerOpen) return;
      if (document.getElementById('proverbEditor').classList.contains('open')) return;
      E.scrim.hidden = true;
      E.editor.hidden = true;
      state.editingId = null;
    }, 280);
  }

  function updateEditorChrome() {
    var term = state.editingId != null
      ? state.terms.find(function (item) { return item.id === state.editingId; })
      : null;

    E.deleteTerm.hidden = !term;
    E.duplicateTerm.hidden = !term;
    E.prevTerm.hidden = !term;
    E.nextTerm.hidden = !term;
    E.editionFields.hidden = BUNDLE.kind !== 'merged';
    E.saveTerm.textContent = term ? 'Save term' : 'Add term';

    if (term) {
      E.editorEyebrow.textContent = 'Term #' + term.id;
      E.editorTitle.textContent = 'Edit term';
    } else if (editorMode === 'duplicate') {
      E.editorEyebrow.textContent = 'New term · duplicated';
      E.editorTitle.textContent = 'Duplicate term';
    } else {
      E.editorEyebrow.textContent = 'New term';
      E.editorTitle.textContent = 'Add a term';
    }

    var view = computeView();
    var position = term ? view.rows.findIndex(function (item) { return item.id === term.id; }) : -1;
    E.navPosition.textContent = position >= 0 ? (position + 1) + ' / ' + view.rows.length : '';
    E.prevTerm.disabled = position <= 0;
    E.nextTerm.disabled = position < 0 || position >= view.rows.length - 1;
  }

  function fillEditor(draft) {
    E.f_rank.value = draft.rank == null ? '' : String(draft.rank);
    E.f_simplified.value = draft.simplified;
    E.f_traditional.value = draft.traditional;
    E.f_pinyin.value = draft.pinyin;
    E.f_english.value = draft.english;
    E.f_source.value = draft.source || '';
    E.f_legacy_id.value = draft.legacy_id == null ? '' : draft.legacy_id;
    E.f_definition_zh.value = draft.definition_zh || '';
    E.f_alt_forms.value = draft.alt_forms || '';
    E.f_notes.value = draft.notes || '';
    E.f_general_meaning.checked = !!draft.general_meaning;
    renderLinkRows(draft.links || []);
    renderTermMedia();
    updateEditorPreview();
    refreshEditorIssues();
    editorDirty = draftKey(readEditor()) !== draftKey(editorOriginal);
  }

  function openEditor(id) {
    closeMenus();
    if (id === 'new') {
      editorMode = 'new';
      state.editingId = null;
      editorOriginal = blankDraft();
      editorDraft = blankDraft();
      mediaDrafts.term = [];
    } else {
      var term = state.terms.find(function (item) { return item.id === Number(id); });
      if (!term) return;
      editorMode = 'edit';
      state.editingId = term.id;
      editorOriginal = draftFromTerm(term);
      editorDraft = clone(editorOriginal);
      mediaDrafts.term = cloneMedia(term.media);
    }
    fillEditor(editorDraft);
    updateEditorChrome();
    showDrawer();
  }

  function readEditor() {
    var links = $$('.link-row', E.linkRows).map(function (row) {
      return {
        url: row.querySelector('.link-url').value.trim(),
        label: row.querySelector('.link-label').value.trim(),
      };
    }).filter(function (link) { return link.url; });
    return {
      rank: E.f_rank.value,
      simplified: E.f_simplified.value,
      traditional: E.f_traditional.value,
      pinyin: E.f_pinyin.value,
      english: E.f_english.value,
      source: E.f_source.value.trim(),
      legacy_id: E.f_legacy_id.value.trim(),
      definition_zh: E.f_definition_zh.value,
      alt_forms: E.f_alt_forms.value,
      notes: E.f_notes.value,
      general_meaning: E.f_general_meaning.checked,
      links: links,
      media: cloneMedia(mediaDrafts.term),
    };
  }

  function updateEditorPreview() {
    var draft = readEditor();
    var plain = toPlain(draft.pinyin);
    var letter = plain ? plain.charAt(0).toUpperCase() : '';
    E.pinyinPreview.textContent = plain
      ? plain + ' · section ' + letter
      : 'The plain, searchable form and section letter are derived automatically.';
    var senses = draft.english.split(/\s*;\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    E.sensesPreview.textContent = senses.length
      ? plural(senses.length, 'sense') + ': ' + senses.join(' · ')
      : 'Separate multiple senses with semicolons.';
  }

  function refreshEditorIssues() {
    var draft = readEditor();
    var existing = state.editingId != null
      ? state.terms.find(function (item) { return item.id === state.editingId; })
      : null;
    var draftTerm = normalizeTerm(
      Object.assign({}, draft, { id: state.editingId != null ? state.editingId : -1, letter: existing ? existing.letter : '' }),
      state.editingId != null ? state.editingId : -1
    );
    var others = state.terms.filter(function (item) { return item.id !== state.editingId; });
    var index = buildIndex(others.concat(draftTerm));
    var issues = issuesFor(draftTerm, index);
    var hasError = issues.some(function (issue) { return issue.level === 'error'; });

    E.saveTerm.disabled = hasError;
    E.f_simplified.setAttribute('aria-invalid', String(issues.some(function (issue) {
      return issue.level === 'error' && issue.field === 'simplified';
    })));
    renderIssueList(issues);

    editorDirty = draftKey(draft) !== draftKey(editorOriginal);
    return issues;
  }

  function renderIssueList(issues) {
    if (!issues.length) {
      E.editorIssues.innerHTML = '<div class="issue note"><span class="issue-icon">✓</span><span>No issues found for this term.</span></div>';
      return;
    }
    E.editorIssues.innerHTML = issues.slice(0, 8).map(function (issue) {
      var icon = issue.level === 'error' ? '!' : (issue.level === 'warning' ? '!' : 'i');
      var extra = issue.level === 'error' ? '' : '';
      return '<div class="issue ' + issue.level + '"><span class="issue-icon">' + icon + '</span><span>' +
        escapeHtml(issue.message) + extra + '</span></div>';
    }).join('');
  }

  function renderLinkRows(links) {
    E.linkRows.innerHTML = '';
    if (!links.length) {
      var empty = document.createElement('p');
      empty.className = 'link-empty';
      empty.textContent = 'No links yet.';
      E.linkRows.appendChild(empty);
      return;
    }
    links.forEach(function (link) { addLinkRow(link); });
    markEditorDirty();
  }

  function addLinkRow(link) {
    var empty = E.linkRows.querySelector('.link-empty');
    if (empty) empty.remove();

    var row = document.createElement('div');
    row.className = 'link-row';

    var url = document.createElement('input');
    url.type = 'url';
    url.className = 'link-url';
    url.placeholder = 'https://senseis.xmp.net?Tesuji';
    url.value = (link && link.url) || '';

    var label = document.createElement('input');
    label.type = 'text';
    label.className = 'link-label';
    label.placeholder = 'Label (optional)';
    label.value = (link && link.label) || '';

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-remove';
    remove.title = 'Remove link';
    remove.setAttribute('aria-label', 'Remove link');
    remove.textContent = '×';

    row.appendChild(url);
    row.appendChild(label);
    row.appendChild(remove);
    E.linkRows.appendChild(row);
    return url;
  }

  function renderTermMedia() {
    renderMediaRows(E.termMediaRows, mediaDrafts.term, function (next) {
      mediaDrafts.term = next;
      markEditorDirty();
      refreshEditorIssues();
    });
  }

  function renderMediaRows(container, media, onChange) {
    if (!container) return;
    var items = media || [];
    if (!items.length) {
      container.innerHTML = '<p class="media-empty">No diagrams yet.</p>';
      return;
    }

    container.innerHTML = '';
    items.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'media-row';

      var preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'media-preview';
      preview.title = 'View diagram';
      preview.innerHTML = window.GoMedia.mediaThumbHtml(item, 54);
      preview.addEventListener('click', function () { openMediaViewer(item); });

      var meta = document.createElement('div');
      meta.className = 'media-meta';
      var name = document.createElement('strong');
      name.textContent = window.GoMedia.describeMedia(item);
      var caption = document.createElement('input');
      caption.type = 'text';
      caption.className = 'media-caption';
      caption.placeholder = 'Caption / 说明';
      caption.value = item.caption || '';
      caption.addEventListener('input', function () {
        item.caption = caption.value;
        onChange(items);
      });
      meta.appendChild(name);
      meta.appendChild(caption);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link-remove media-remove';
      remove.title = 'Remove diagram';
      remove.setAttribute('aria-label', 'Remove diagram');
      remove.textContent = '×';
      remove.addEventListener('click', function () {
        var next = items.filter(function (_, at) { return at !== index; });
        onChange(next);
        renderMediaRows(container, next, onChange);
      });

      row.appendChild(preview);
      row.appendChild(meta);
      row.appendChild(remove);
      container.appendChild(row);
    });
  }

  function pickMedia(kind, callback) {
    var input = kind === 'image' ? E.imageInput : E.sgfInput;
    if (!input) return;
    input.value = '';
    mediaPickHandler = { kind: kind, callback: callback };
    input.click();
  }

  function handleMediaFile(file) {
    if (!file || !mediaPickHandler) return;
    var handler = mediaPickHandler;
    mediaPickHandler = null;

    if (handler.kind === 'image') {
      if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) &&
          !/\.(png|jpe?g|gif|webp)$/i.test(file.name || '')) {
        toast('Use a PNG, JPG, GIF or WebP image.', 'error');
        return;
      }
      if (file.size > 1.6 * 1024 * 1024) {
        toast('That image is larger than 1.6 MB. Please shrink it first.', 'error');
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var data = String(reader.result || '');
        if (!/^data:image\//i.test(data)) {
          var mime = /\.png$/i.test(file.name) ? 'image/png'
            : /\.gif$/i.test(file.name) ? 'image/gif'
              : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg';
          data = data.replace(/^data:[^;,]*/i, 'data:' + mime);
        }
        handler.callback({
          id: window.GoMedia.mediaId(),
          type: 'image',
          name: file.name,
          caption: '',
          data: data,
        });
      };
      reader.onerror = function () { toast('Could not read that image.', 'error'); };
      reader.readAsDataURL(file);
      return;
    }

    if (file.size > 240 * 1024) {
      toast('That SGF is larger than 240 KB.', 'error');
      return;
    }
    file.text().then(function (text) {
      if (text.indexOf('(') === -1 || !/;\s*[BW]\s*\[|A[BW]\s*\[/i.test(text)) {
        toast('That file does not look like an SGF game record.', 'error');
        return;
      }
      handler.callback({
        id: window.GoMedia.mediaId(),
        type: 'sgf',
        name: file.name,
        caption: '',
        data: text,
      });
    }).catch(function () { toast('Could not read that SGF.', 'error'); });
  }

  function openMediaViewer(media) {
    if (!media || !E.mediaDialogBody) return;
    var large = media.type === 'sgf'
      ? window.GoMedia.sgfBoardSvg(media.data, 560)
      : '<img src="' + escapeHtml(media.data) + '" alt="' + escapeHtml(media.caption || media.name || 'diagram') + '">';
    E.mediaDialogBody.innerHTML = '<figure class="media-large">' + large + '</figure>' +
      '<div class="media-detail"><strong>' + escapeHtml(media.name || 'Diagram') + '</strong>' +
      '<span>' + escapeHtml(window.GoMedia.describeMedia(media)) + '</span>' +
      (media.caption ? '<p>' + escapeHtml(media.caption) + '</p>' : '') + '</div>';
    if (typeof E.mediaDialog.showModal === 'function') E.mediaDialog.showModal();
  }

  function markEditorDirty() {
    if (!editorOriginal) return;
    editorDirty = draftKey(readEditor()) !== draftKey(editorOriginal);
  }

  async function saveEditor(event) {
    if (event) event.preventDefault();

    var draft = readEditor();
    var existing = state.editingId != null
      ? state.terms.find(function (item) { return item.id === state.editingId; })
      : null;
    var id = existing ? existing.id : nextId();
    var term = normalizeTerm(
      Object.assign({}, draft, { id: id, letter: existing ? existing.letter : '' }),
      id
    );

    var others = state.terms.filter(function (item) { return item.id !== id; });
    var index = buildIndex(others.concat(term));
    var issues = issuesFor(term, index);

    if (issues.some(function (issue) { return issue.level === 'error'; })) {
      renderIssueList(issues);
      toast('Fix the errors before saving.', 'error');
      var firstField = issues.find(function (issue) { return issue.level === 'error'; });
      if (firstField && E['f_' + firstField.field]) E['f_' + firstField.field].focus();
      return;
    }

    pushHistory();
    if (existing) {
      var position = state.terms.indexOf(existing);
      state.terms[position] = term;
    } else {
      state.terms.push(term);
    }

    persist();
    editorDirty = false;
    hideDrawer();
    renderAll();
    toast(existing ? 'Saved #' + term.id + ' ' + term.simplified : 'Added #' + term.id + ' ' + term.simplified);
    revealTerm(term.id);
  }

  function revealTerm(id) {
    var visible = computeView().rows.some(function (term) { return term.id === id; });
    if (!visible) {
      state.query = '';
      state.letter = 'ALL';
      state.rank = 'ALL';
      state.filter = 'all';
      E.search.value = '';
      E.clearSearch.hidden = true;
      E.rankFilter.value = 'ALL';
      E.filterSelect.value = 'all';
      renderStats();
      renderLetters();
    }
    renderTable();
    renderStatus();
    requestAnimationFrame(function () {
      var row = E.termBody.querySelector('tr[data-id="' + id + '"]');
      if (!row) return;
      row.classList.add('flash');
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(function () { row.classList.remove('flash'); }, 1200);
    });
  }

  async function deleteTermById(id) {
    var term = state.terms.find(function (item) { return item.id === Number(id); });
    if (!term) return;
    var ok = await confirmAction(
      'Delete term?',
      'Delete #' + term.id + ' “' + term.simplified + '”' + (term.english ? ' (' + term.english + ')' : '') +
        '? You can undo this.',
      'Delete',
      true
    );
    if (!ok) return;
    pushHistory();
    state.terms = state.terms.filter(function (item) { return item !== term; });
    state.selected.delete(term.id);
    if (state.editingId === term.id) closeDrawer(true);
    persist();
    renderAll();
    toast('Deleted #' + term.id + ' ' + term.simplified + '.');
  }

  function duplicateCurrent() {
    var draft = readEditor();
    state.editingId = null;
    editorMode = 'duplicate';
    editorOriginal = blankDraft();
    fillEditor(draft);
    updateEditorChrome();
    editorDirty = draftKey(readEditor()) !== draftKey(editorOriginal);
    E.f_simplified.focus();
    E.f_simplified.select();
    toast('Copied into a new term — change the characters or reading before saving.');
  }

  async function navigateEditor(direction) {
    if (state.editingId == null) return;
    var rows = computeView().rows;
    var index = rows.findIndex(function (term) { return term.id === state.editingId; });
    if (index < 0) return;
    var target = rows[index + direction];
    if (!target) return;

    if (editorDirty) {
      var ok = await confirmAction('Discard changes?', 'Move to another term and discard these edits?', 'Discard', true);
      if (!ok) return;
      editorDirty = false;
    }
    openEditor(target.id);
  }

  /* ------------------------------------------------------------
     Confirmation dialog
     ------------------------------------------------------------ */
  function confirmAction(title, message, okLabel, danger) {
    E.confirmTitle.textContent = title;
    E.confirmMsg.textContent = message;
    E.confirmOk.textContent = okLabel || 'Confirm';
    E.confirmOk.className = 'btn ' + (danger ? 'danger' : 'primary');
    if (typeof E.confirmDialog.showModal === 'function') E.confirmDialog.showModal();
    return new Promise(function (resolve) { confirmResolver = resolve; });
  }

  function finishConfirm(value) {
    if (E.confirmDialog.open) E.confirmDialog.close();
    if (confirmResolver) {
      var resolve = confirmResolver;
      confirmResolver = null;
      resolve(value);
    }
  }

  /* ------------------------------------------------------------
     Import / export
     ------------------------------------------------------------ */
  function jsonFileName() {
    return BUNDLE.file || (BUNDLE.kind === 'merged' ? 'go-terms-merged.json' : 'go-terms.json');
  }

  function csvFileName() {
    return jsonFileName().replace(/\.json$/i, '.csv');
  }

  function projectBaseTerm(term) {
    var projected = {
      id: term.id,
      letter: term.letter,
      simplified: term.simplified,
      traditional: term.traditional,
      traditional_variants: term.traditional ? [term.simplified, term.traditional] : [term.simplified],
      chinese_raw: term.chinese_raw,
      pinyin: term.pinyin,
      pinyin_plain: term.pinyin_plain,
      english: term.english,
      senses: term.senses.slice(),
      sensei_links: term.sensei_links.map(function (link) {
        return { url: link.url, label: link.label };
      }),
    };
    if (term.rank != null) projected.rank = term.rank;
    if (term.media && term.media.length) projected.media = cloneMedia(term.media);
    return projected;
  }

  function projectMergedTerm(term) {
    var projected = {
      id: term.id,
      letter: term.letter,
      simplified: term.simplified,
      traditional: term.traditional,
      alt_forms: term.alt_forms,
      pinyin: term.pinyin,
      pinyin_plain: term.pinyin_plain,
      english: term.english,
      definition_zh: term.definition_zh,
      source: term.source,
      general_meaning: !!term.general_meaning,
      sense_count: term.senses.length,
      sensei_urls: term.sensei_links.map(function (link) { return link.url; }).join('|'),
      notes: term.notes,
      legacy_id: term.legacy_id,
    };
    if (term.rank != null) projected.rank = term.rank;
    if (term.media && term.media.length) projected.media = cloneMedia(term.media);
    return projected;
  }

  function projectTerm(term) {
    return BUNDLE.kind === 'merged' ? projectMergedTerm(term) : projectBaseTerm(term);
  }

  function countSources(terms) {
    var counts = {};
    terms.forEach(function (term) {
      if (!term.source) return;
      counts[term.source] = (counts[term.source] || 0) + 1;
    });
    return counts;
  }

  function exportObject() {
    var terms = state.terms.map(projectTerm);
    var updated = new Date().toISOString();

    if (BUNDLE.kind === 'merged') {
      return {
        source: BUNDLE.source,
        retrieved: BUNDLE.retrieved,
        purpose: BUNDLE.purpose,
        updated: updated,
        count: terms.length,
        counts_by_source: countSources(terms),
        terms: terms,
      };
    }

    return {
      source: BUNDLE.source,
      retrieved: BUNDLE.retrieved,
      license: BUNDLE.license,
      updated: updated,
      count: terms.length,
      terms: terms,
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
    var merged = BUNDLE.kind === 'merged';
    var header = merged
      ? ['id', 'letter', 'simplified', 'traditional', 'alt_forms', 'pinyin', 'pinyin_plain',
        'english', 'definition_zh', 'source', 'general_meaning', 'sense_count', 'sensei_urls',
        'notes', 'legacy_id', 'rank']
      : ['id', 'letter', 'simplified', 'traditional', 'pinyin', 'pinyin_plain', 'english',
        'sense_count', 'sensei_urls', 'rank'];

    var lines = [header.join(',')];
    state.terms.forEach(function (term) {
      var row = merged
        ? [
          term.id, term.letter, term.simplified, term.traditional, term.alt_forms,
          term.pinyin, term.pinyin_plain, term.english, term.definition_zh, term.source,
          String(!!term.general_meaning), term.senses.length,
          term.sensei_links.map(function (link) { return link.url; }).join('|'),
          term.notes, term.legacy_id, term.rank == null ? '' : term.rank,
        ]
        : [
          term.id, term.letter, term.simplified, term.traditional, term.pinyin,
          term.pinyin_plain, term.english, term.senses.length,
          term.sensei_links.map(function (link) { return link.url; }).join('|'),
          term.rank == null ? '' : term.rank,
        ];
      lines.push(row.map(csvEscape).join(','));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  async function ensureWritePermission(handle) {
    if (!handle || typeof handle.queryPermission !== 'function') return true;
    var options = { mode: 'readwrite' };
    if ((await handle.queryPermission(options)) === 'granted') return true;
    return (await handle.requestPermission(options)) === 'granted';
  }

  async function writeHandle(handle, text) {
    var writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function saveJSON(asNew) {
    var text = exportJSONString();
    var fileName = jsonFileName();

    if (!FS_SUPPORTED) {
      download(fileName, text, 'application/json');
      toast('Downloaded ' + fileName + ' — move it into this folder.');
      return;
    }

    var handle = asNew ? null : state.jsonHandle;
    try {
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'JSON data', accept: { 'application/json': ['.json'] } }],
        });
        state.jsonHandle = handle;
        idbSet('jsonHandle.' + state.editionKey, handle);
      }
      if (!(await ensureWritePermission(handle))) {
        toast('Write permission was not granted.', 'error');
        return;
      }
      await writeHandle(handle, text);
      state.fileDirty = false;
      state.fileSavedAt = new Date().toISOString();
      renderStatus();
      toast('Saved ' + handle.name + ' · ' + plural(state.terms.length, 'term'));
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      console.warn(error);
      download(fileName, text, 'application/json');
      toast('Could not write the file directly — downloaded a copy instead.', 'error');
    }
  }

  async function saveCSV() {
    var text = exportCSVString();
    var fileName = csvFileName();

    if (!FS_SUPPORTED) {
      download(fileName, text, 'text/csv');
      toast('Downloaded ' + fileName + ' — move it into this folder.');
      return;
    }

    try {
      var handle = state.csvHandle;
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'CSV spreadsheet', accept: { 'text/csv': ['.csv'] } }],
        });
        state.csvHandle = handle;
        idbSet('csvHandle.' + state.editionKey, handle);
      }
      if (!(await ensureWritePermission(handle))) {
        toast('Write permission was not granted.', 'error');
        return;
      }
      await writeHandle(handle, text);
      toast('Saved ' + handle.name + ' · ' + plural(state.terms.length, 'term'));
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      console.warn(error);
      download(fileName, text, 'text/csv');
      toast('Could not write the file directly — downloaded a copy instead.', 'error');
    }
  }

  async function connectFile() {
    if (!OPEN_SUPPORTED) {
      toast('This browser cannot connect files. Use Save JSON instead.', 'error');
      return;
    }
    try {
      var handles = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'JSON data', accept: { 'application/json': ['.json'] } }],
      });
      state.jsonHandle = handles[0];
      idbSet('jsonHandle.' + state.editionKey, state.jsonHandle);
      renderStatus();
      toast('Connected ' + state.jsonHandle.name + '. Save JSON now writes to it.');
    } catch (error) {
      if (error && error.name !== 'AbortError') toast('Could not connect that file.', 'error');
    }
  }

  async function copyJSON() {
    var text = exportJSONString();
    try {
      await navigator.clipboard.writeText(text);
      toast('JSON copied to the clipboard.');
    } catch (error) {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        toast('JSON copied to the clipboard.');
      } catch (fallbackError) {
        toast('Copy failed — use Download JSON instead.', 'error');
      }
      area.remove();
    }
  }

  /* ----- CSV parsing ----- */
  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;

    for (var i = 0; i < text.length; i += 1) {
      var char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\r') {
        if (text[i + 1] === '\n') i += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(function (line) { return line.some(function (cell) { return String(cell).trim() !== ''; }); });
  }

  function rememberIds(terms, start) {
    var used = new Set();
    var next = Math.max(1, start || 1);
    return terms.map(function (term) {
      var id = Number(term.id);
      if (!Number.isInteger(id) || id < 1 || used.has(id)) {
        while (used.has(next)) next += 1;
        id = next;
      }
      used.add(id);
      next = Math.max(next, id + 1);
      term.id = id;
      return term;
    });
  }

  function parseJSONImport(text) {
    var data = JSON.parse(text);
    var collection = Array.isArray(data) ? data
      : (data && Array.isArray(data.terms) ? data.terms
        : (data && Array.isArray(data.rows) ? data.rows : null));
    if (!collection) throw new Error('Expected a JSON array or an object with a "terms" array.');

    var skipped = 0;
    var terms = [];
    collection.forEach(function (raw) {
      if (!raw || typeof raw !== 'object') { skipped += 1; return; }
      if (!raw.simplified && !raw.english && !raw.pinyin) { skipped += 1; return; }
      terms.push(normalizeTerm(raw, raw.id));
    });
    rememberIds(terms, 1);
    return { terms: terms, skipped: skipped, source: (data && data.source) || '' };
  }

  function parseCSVImport(text) {
    var rows = parseCSV(text);
    if (!rows.length) throw new Error('The CSV file is empty.');
    var headers = rows[0].map(function (header) { return String(header).trim().toLowerCase(); });
    var simplifiedColumn = headers.indexOf('simplified');
    if (simplifiedColumn === -1) throw new Error('The CSV needs a "simplified" column.');

    function column(name) { return headers.indexOf(name); }
    function value(row, name) {
      var at = column(name);
      return at === -1 ? '' : String(row[at] == null ? '' : row[at]).trim();
    }

    var skipped = 0;
    var terms = [];
    for (var i = 1; i < rows.length; i += 1) {
      var row = rows[i];
      var simplified = String(row[simplifiedColumn] || '').trim();
      if (!simplified) { skipped += 1; continue; }
      var urls = value(row, 'sensei_urls').split('|').map(function (url) { return url.trim(); }).filter(Boolean);
      terms.push(normalizeTerm({
        id: Number(value(row, 'id')),
        rank: value(row, 'rank'),
        legacy_id: value(row, 'legacy_id'),
        letter: value(row, 'letter'),
        simplified: simplified,
        traditional: value(row, 'traditional'),
        alt_forms: value(row, 'alt_forms'),
        pinyin: value(row, 'pinyin'),
        english: value(row, 'english'),
        definition_zh: value(row, 'definition_zh'),
        source: value(row, 'source'),
        general_meaning: /^(true|1|yes)$/i.test(value(row, 'general_meaning')),
        notes: value(row, 'notes'),
        sensei_links: urls.map(function (url) { return { url: url, label: deriveLabel(url) }; }),
      }, Number(value(row, 'id'))));
    }
    rememberIds(terms, 1);
    return { terms: terms, skipped: skipped, source: '' };
  }

  function looksLikeCSV(text) {
    var first = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)[0].toLowerCase();
    return first.indexOf('simplified') !== -1 && first.indexOf(',') !== -1;
  }

  function openImport() {
    pendingImport = null;
    E.importFile.value = '';
    E.importPreview.hidden = true;
    E.importConfirm.disabled = true;
    E.importSummary.innerHTML = '';
    E.importDialog.showModal();
  }

  async function handleImportFile(file) {
    if (!file) return;
    try {
      var text = await file.text();
      var isCsv = /\.csv$/i.test(file.name) || looksLikeCSV(text);
      var proverbParsed = window.GoProverbs
        ? window.GoProverbs.parseImport(text, file.name)
        : null;

      if (proverbParsed) {
        if (!proverbParsed.items.length) throw new Error('No usable proverbs were found in that file.');
        pendingImport = {
          kind: 'proverbs',
          items: proverbParsed.items,
          skipped: proverbParsed.skipped,
          fileName: file.name,
          source: '',
        };
      } else {
        var parsed = isCsv ? parseCSVImport(text) : parseJSONImport(text);
        if (!parsed.terms.length) throw new Error('No usable terms were found in that file.');
        pendingImport = {
          kind: 'terms',
          items: parsed.terms,
          skipped: parsed.skipped,
          fileName: file.name,
          source: parsed.source || '',
        };
      }

      renderImportPreview();
      E.importPreview.hidden = false;
      E.importConfirm.disabled = false;
    } catch (error) {
      console.warn(error);
      pendingImport = null;
      E.importPreview.hidden = true;
      E.importConfirm.disabled = true;
      toast(error && error.message ? error.message : 'Could not read that file.', 'error');
    }
  }

  function importMode() {
    var checked = document.querySelector('input[name="importMode"]:checked');
    return checked ? checked.value : 'replace';
  }

  function mergeStats() {
    if (!pendingImport) return { matches: 0, added: 0 };
    if (pendingImport.kind === 'proverbs' && window.GoProverbs) {
      return window.GoProverbs.mergeStats(pendingImport.items);
    }
    var current = new Map(state.terms.map(function (term) { return [dupKey(term), term]; }));
    var matches = 0;
    pendingImport.items.forEach(function (term) {
      if (current.has(dupKey(term))) matches += 1;
    });
    return { matches: matches, added: pendingImport.items.length - matches };
  }

  function renderImportPreview() {
    if (!pendingImport) return;
    var isProverbs = pendingImport.kind === 'proverbs';
    var mode = importMode();
    var stats = mergeStats();
    var currentCount = isProverbs && window.GoProverbs ? window.GoProverbs.count() : state.terms.length;
    var unit = isProverbs ? 'proverb' : 'term';
    var skipped = pendingImport.skipped
      ? ' · ' + plural(pendingImport.skipped, 'row') + ' skipped'
      : '';
    var modeText = mode === 'replace'
      ? 'This replaces the current <strong>' + plural(currentCount, unit) + '</strong>.'
      : '<strong>' + stats.matches + '</strong> matching ' + unit + 's will be updated and <strong>' +
        stats.added + '</strong> added.';

    if (!isProverbs) {
      var hasMergedFields = pendingImport.items.some(function (term) {
        return term.source || term.notes || term.definition_zh || term.legacy_id !== '';
      });
      if (BUNDLE.kind !== 'merged' && hasMergedFields) {
        modeText += '<br><span class="warn-text">This file carries merged-edition fields. Switch to the merged edition before exporting if you want to keep source, notes and definitions.</span>';
      }
      var missingSource = BUNDLE.kind === 'merged'
        ? pendingImport.items.filter(function (term) { return !term.source; }).length
        : 0;
      if (missingSource) {
        modeText += '<br><span class="warn-text">' + plural(missingSource, 'row') + ' has no origin source.</span>';
      }
    }

    E.importSummary.innerHTML =
      '<strong>' + plural(pendingImport.items.length, unit) + '</strong> ready from <code>' +
      escapeHtml(pendingImport.fileName) + '</code>' + skipped + '.<br>' + modeText +
      '<br><span class="muted">Detected section: ' + (isProverbs ? '围棋棋谚 Proverbs' : '围棋术语 Terms') + '.</span>';
  }

  function applyImport() {
    if (!pendingImport) return;
    var mode = importMode();

    if (pendingImport.kind === 'proverbs' && window.GoProverbs) {
      var proverbCount = pendingImport.items.length;
      window.GoProverbs.applyImport(pendingImport.items, mode);
      E.importDialog.close();
      pendingImport = null;
      setView('proverbs', { initial: true });
      toast('Imported ' + plural(proverbCount, 'proverb') + ' (' + mode + ').');
      return;
    }

    var incoming = pendingImport.items.map(function (term) { return clone(term); });

    pushHistory();

    if (mode === 'replace') {
      state.terms = incoming;
    } else {
      var byKey = new Map();
      state.terms.forEach(function (term, index) { byKey.set(dupKey(term), index); });
      incoming.forEach(function (term) {
        var key = dupKey(term);
        if (byKey.has(key)) {
          var index = byKey.get(key);
          var existingId = state.terms[index].id;
          state.terms[index] = normalizeTerm(Object.assign({}, term, { id: existingId }), existingId);
        } else {
          var id = nextId();
          term.id = id;
          state.terms.push(term);
          byKey.set(key, state.terms.length - 1);
        }
      });
    }

    state.selected.clear();
    persist();
    renderAll();
    E.importDialog.close();
    toast('Imported ' + plural(incoming.length, 'term') + ' (' + mode + ').');
    pendingImport = null;
  }

  /* ------------------------------------------------------------
     Review dialog
     ------------------------------------------------------------ */
  function openReview() {
    var index = buildIndex(state.terms);
    var buckets = { error: [], warning: [], note: [] };
    state.terms.forEach(function (term) {
      issuesFor(term, index).forEach(function (issue) {
        buckets[issue.level].push({ kind: 'term', id: term.id, simplified: term.simplified, issue: issue });
      });
    });
    if (window.GoProverbs) {
      window.GoProverbs.collectIssues().forEach(function (entry) {
        buckets[entry.level].push({
          kind: 'proverb',
          id: entry.id,
          simplified: entry.simplified,
          issue: { message: entry.message, level: entry.level },
        });
      });
    }

    var total = buckets.error.length + buckets.warning.length + buckets.note.length;
    E.reviewSummary.innerHTML = total
      ? '<strong>' + buckets.error.length + '</strong> errors · <strong>' + buckets.warning.length +
        '</strong> warnings · <strong>' + buckets.note.length + '</strong> notes across ' +
        plural(state.terms.length, 'term') + ' and ' + plural(window.GoProverbs ? window.GoProverbs.count() : 0, 'proverb') + '.'
      : '';

    var titles = { error: 'Errors', warning: 'Warnings', note: 'Notes' };
    var html = '';
    ['error', 'warning', 'note'].forEach(function (level) {
      if (!buckets[level].length) return;
      html += '<section class="review-group"><h3>' + titles[level] + ' · ' + buckets[level].length + '</h3>';
      buckets[level].forEach(function (entry) {
        html += '<button type="button" class="review-item" data-kind="' + entry.kind + '" data-id="' + entry.id + '">' +
          '<span class="review-id">' + (entry.kind === 'proverb' ? '谚' : '#') + entry.id + '</span>' +
          '<span class="review-cn">' + escapeHtml(entry.simplified) + '</span>' +
          '<span class="review-msg">' + escapeHtml(entry.issue.message) + '</span></button>';
      });
      html += '</section>';
    });

    if (!html) {
      html = '<div class="review-empty">✓ Everything checks out — no errors, warnings, or notes.</div>';
    }
    E.reviewBody.innerHTML = html;
    E.reviewDialog.showModal();
  }

  /* ------------------------------------------------------------
     Maintenance tools
     ------------------------------------------------------------ */
  function rebuildDerived() {
    var before = JSON.stringify(state.terms);
    var rebuilt = state.terms.map(function (term) { return normalizeTerm(term, term.id); });
    var after = JSON.stringify(rebuilt);
    if (before === after) {
      toast('Derived fields are already up to date.');
      return;
    }

    pushHistory();
    state.terms = rebuilt;
    persist();
    renderAll();
    toast('Rebuilt derived fields.');
  }

  async function renumberIds() {
    var ok = await confirmAction(
      'Renumber IDs?',
      'All ' + plural(state.terms.length, 'term') + ' will be numbered 1–' + state.terms.length +
        ' in dataset order. IDs are stable keys, so this can affect references. You can undo it.',
      'Renumber',
      true
    );
    if (!ok) return;
    pushHistory();
    state.terms.forEach(function (term, index) { term.id = index + 1; });
    state.selected.clear();
    persist();
    renderAll();
    toast('Renumbered ' + plural(state.terms.length, 'term') + '.');
  }

  async function resetToBundle() {
    var ok = await confirmAction(
      'Reset to bundled data?',
      'Discard the working copy (' + plural(state.terms.length, 'term') + ') and restore the bundled snapshot (' +
        plural(BUNDLE.count, 'term') + ')? You can undo this.',
      'Reset',
      true
    );
    if (!ok) return;
    pushHistory();
    state.terms = clone(BUNDLE.terms).map(function (term) { return normalizeTerm(term, term.id); });
    state.stamp = BUNDLE.stamp;
    state.savedAt = null;
    state.selected.clear();
    dismissSnapshot();
    persist();
    renderAll();
    toast('Restored the bundled ' + BUNDLE.label.toLowerCase() + '.');
  }

  function clearFilters() {
    state.query = '';
    state.letter = 'ALL';
    state.rank = 'ALL';
    state.filter = 'all';
    E.search.value = '';
    E.clearSearch.hidden = true;
    E.rankFilter.value = 'ALL';
    E.filterSelect.value = 'all';
    renderAll();
  }

  function setFilter(filter) {
    state.filter = filter;
    E.filterSelect.value = filter;
    renderStats();
    renderTable();
  }

  /* ------------------------------------------------------------
     Editions
     ------------------------------------------------------------ */
  function renderEditionPicker() {
    if (!E.editionSelect) return;
    E.editionSelect.innerHTML = EDITION_KEYS.map(function (key) {
      var edition = BUNDLES[key];
      var short = edition.kind === 'merged' ? 'Merged' : (edition.kind === 'base' ? 'Base' : edition.label);
      return '<option value="' + escapeHtml(key) + '">' + escapeHtml(short) + ' · ' + edition.count + '</option>';
    }).join('');
    E.editionSelect.value = state.editionKey;
  }

  async function setEdition(key) {
    if (!BUNDLES[key] || key === state.editionKey) {
      renderEditionPicker();
      return;
    }

    if (editorDirty) {
      var ok = await confirmAction(
        'Switch edition?',
        'The term in the editor has unsaved changes. Switch editions and discard them?',
        'Switch',
        true
      );
      if (!ok) {
        renderEditionPicker();
        return;
      }
    }

    closeDrawer(true);
    persistNow();

    state.editionKey = key;
    try { localStorage.setItem(LS_EDITION, key); } catch (e) { /* ignore */ }
    BUNDLE = BUNDLES[key];
    BASELINE = new Map(BUNDLE.terms.map(function (term) {
      return [Number(term.id), normalizeTerm(term, term.id)];
    }));

    state.terms = [];
    state.history = [];
    state.future = [];
    state.selected.clear();
    state.query = '';
    state.letter = 'ALL';
    state.rank = 'ALL';
    state.filter = 'all';
    state.sort = 'id';
    state.dir = 'asc';
    state.savedAt = null;
    state.fileDirty = false;
    state.jsonHandle = null;
    state.csvHandle = null;
    state.stamp = BUNDLE.stamp;

    E.search.value = '';
    E.clearSearch.hidden = true;
    E.rankFilter.value = 'ALL';
    E.banner.hidden = true;
    E.sortSelect.value = 'id';
    E.sortDirBtn.textContent = '↑';

    loadWorkingCopy();
    renderFilterOptions();
    renderEditionPicker();
    renderAll();
    await loadHandles();
    E.editionSelect.value = key;
    toast('Switched to ' + BUNDLE.label + ' · ' + plural(BUNDLE.count, 'term') + '.');
  }

  /* ------------------------------------------------------------
     File handles (IndexedDB)
     ------------------------------------------------------------ */
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      var request = indexedDB.open('goterm-manager', 1);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv');
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function idbGet(key) {
    try {
      var database = await idbOpen();
      return await new Promise(function (resolve, reject) {
        var transaction = database.transaction('kv', 'readonly');
        var request = transaction.objectStore('kv').get(key);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    } catch (error) {
      return null;
    }
  }

  async function idbSet(key, value) {
    try {
      var database = await idbOpen();
      await new Promise(function (resolve, reject) {
        var transaction = database.transaction('kv', 'readwrite');
        transaction.objectStore('kv').put(value, key);
        transaction.oncomplete = function () { resolve(); };
        transaction.onerror = function () { reject(transaction.error); };
      });
    } catch (error) { /* handles just won't persist */ }
  }

  async function loadHandles() {
    state.jsonHandle = await idbGet('jsonHandle.' + state.editionKey);
    if (!state.jsonHandle && state.editionKey === 'base') {
      state.jsonHandle = await idbGet('jsonHandle');
    }
    state.csvHandle = await idbGet('csvHandle.' + state.editionKey);
    if (!state.csvHandle && state.editionKey === 'base') {
      state.csvHandle = await idbGet('csvHandle');
    }
    renderStatus();
  }

  /* ------------------------------------------------------------
     Menus
     ------------------------------------------------------------ */
  function closeMenus() {
    [E.fileMenu, E.toolsMenu, E.themeMenu, E.columnsMenu].forEach(function (menu) {
      if (menu) menu.hidden = true;
    });
    [E.fileMenuBtn, E.toolsMenuBtn, E.themeBtn, E.columnsMenuBtn].forEach(function (button) {
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleMenu(menu, button) {
    var willOpen = menu.hidden;
    closeMenus();
    if (willOpen) {
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
    }
  }

  function renderColumnsMenu() {
    if (!E.columnsMenu) return;
    var defs = COLUMN_DEFS[state.view] || [];
    var hidden = columnPrefs[state.view] || [];
    var html = defs.map(function (def) {
      var visible = hidden.indexOf(def.key) === -1;
      return '<button type="button" data-column="' + def.key + '" aria-checked="' + visible + '">' +
        '<span class="column-check">' + (visible ? '✓' : '') + '</span><span>' +
        escapeHtml(def.label) + '</span></button>';
    }).join('');
    html += '<hr><button type="button" data-column-action="all">Show all columns</button>';
    html += '<p class="column-note">These settings are saved per section. Narrow screens may hide some columns automatically.</p>';
    E.columnsMenu.innerHTML = html;
  }

  function applyColumns() {
    var table = state.view === 'terms' ? E.termTable : E.proverbTable;
    if (!table) return;
    var defs = COLUMN_DEFS[state.view] || [];
    var hidden = columnPrefs[state.view] || [];
    defs.forEach(function (def) {
      table.classList.toggle('hide-col-' + def.key, hidden.indexOf(def.key) !== -1);
    });
  }

  function saveColumns() {
    try { localStorage.setItem(LS_COLUMNS, JSON.stringify(columnPrefs)); } catch (e) { /* ignore */ }
  }

  function toggleColumn(key) {
    var list = columnPrefs[state.view];
    var at = list.indexOf(key);
    if (at === -1) list.push(key);
    else list.splice(at, 1);
    saveColumns();
    applyColumns();
    renderColumnsMenu();
  }

  function showAllColumns() {
    columnPrefs[state.view] = [];
    saveColumns();
    applyColumns();
    renderColumnsMenu();
  }

  function proverbsActive() {
    return state.view === 'proverbs' && window.GoProverbs;
  }

  function closeActiveEditor(force) {
    if (proverbsActive()) return window.GoProverbs.closeEditor(force);
    return closeDrawer(force);
  }

  async function handleFileAction(action) {
    closeMenus();
    var p = proverbsActive() ? window.GoProverbs : null;
    switch (action) {
      case 'import': openImport(); break;
      case 'connect': p ? p.connect() : connectFile(); break;
      case 'save-json': p ? p.saveJSON(false) : saveJSON(false); break;
      case 'save-as': p ? p.saveJSON(true) : saveJSON(true); break;
      case 'save-csv': p ? p.saveCSV() : saveCSV(); break;
      case 'download-json':
        if (p) p.downloadJSON(); else {
          download(jsonFileName(), exportJSONString(), 'application/json');
          toast('Downloaded ' + jsonFileName() + '.');
        }
        break;
      case 'download-csv':
        if (p) p.downloadCSV(); else {
          download(csvFileName(), exportCSVString(), 'text/csv');
          toast('Downloaded ' + csvFileName() + '.');
        }
        break;
      case 'copy-json': p ? p.copyJSON() : copyJSON(); break;
      case 'pdf': openPdf(); break;
      default: break;
    }
  }

  async function handleToolAction(action) {
    closeMenus();
    var p = proverbsActive() ? window.GoProverbs : null;
    switch (action) {
      case 'review': openReview(); break;
      case 'rebuild': p ? p.rebuildDerived() : rebuildDerived(); break;
      case 'renumber': p ? p.renumberIds() : renumberIds(); break;
      case 'clear-filters': p ? p.clearFilters() : clearFilters(); break;
      case 'reset': p ? p.resetToBundle() : resetToBundle(); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------
     Theme, layout and statistics visibility
     ------------------------------------------------------------ */
  function applyTheme(mode, save) {
    var resolved = mode;
    if (mode === 'auto') {
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      resolved = prefersDark ? 'dark' : 'light';
    }
    if (['light', 'medium', 'dark'].indexOf(resolved) === -1) resolved = 'light';
    state.theme = resolved;
    if (save) {
      try { localStorage.setItem(LS_THEME, resolved); } catch (error) { /* ignore */ }
    }
    document.documentElement.setAttribute('data-theme', resolved);
    E.themeBtn.textContent = resolved === 'light' ? '☀' : (resolved === 'medium' ? '◒' : '☾');
    E.themeBtn.title = 'Theme: ' + resolved + ' — choose Light, Medium or Dark';
    $$('[data-theme-choice]').forEach(function (button) {
      var active = button.dataset.themeChoice === resolved;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setStatsVisible(visible, save) {
    state.statsVisible = !!visible;
    document.body.classList.toggle('stats-hidden', !state.statsVisible);
    if (E.statsToggleBtn) {
      E.statsToggleBtn.setAttribute('aria-pressed', String(state.statsVisible));
      E.statsToggleBtn.title = state.statsVisible ? 'Hide statistics' : 'Show statistics';
    }
    if (save) {
      try { localStorage.setItem(LS_STATS, state.statsVisible ? '1' : '0'); } catch (error) { /* ignore */ }
    }
  }

  function applyLayout(mode, options) {
    options = options || {};
    if (mode !== 'portrait' && mode !== 'landscape') return;
    state.layout = mode;
    document.body.setAttribute('data-layout', mode);
    [E.layoutPortrait, E.layoutLandscape].forEach(function (button) {
      if (!button) return;
      var active = button.dataset.layoutChoice === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (!options.keepStats) {
      setStatsVisible(mode === 'portrait', options.save !== false);
    }
    if (options.save) {
      try { localStorage.setItem(LS_LAYOUT, mode); } catch (error) { /* ignore */ }
    }
    if (E.statsToggleBtn) E.statsToggleBtn.hidden = false;
  }

  /* ------------------------------------------------------------
     Wiring
     ------------------------------------------------------------ */
  function cacheElements() {
    [
      'brandCount', 'brandEdition', 'brandProverbs', 'pdfBtn', 'reviewBtn', 'reviewCount', 'themeBtn', 'helpBtn',
      'layoutPortrait', 'layoutLandscape', 'statsToggleBtn', 'statsBadge', 'themeMenu',
      'columnsMenuBtn', 'columnsMenu',
      'banner', 'bannerText', 'bannerActions',
      'tabTerms', 'tabProverbs', 'tabTermCount', 'tabProverbCount', 'termsView', 'proverbsView', 'globalHint',
      'statTotal', 'statEdited', 'statReview', 'statExtra', 'statExtraLabel', 'statExtraNote', 'statExtraButton',
      'search', 'clearSearch', 'letterChips', 'editionSelect', 'rankFilter', 'filterSelect', 'sortSelect', 'sortDirBtn',
      'toolsMenuBtn', 'toolsMenu', 'fileMenuBtn', 'fileMenu', 'importBtn', 'saveJsonBtn', 'newTermBtn',
      'resultSummary', 'bulkBar', 'selCount', 'bulkDelete', 'bulkClear', 'savedIndicator',
      'termTable', 'termBody', 'selectAll', 'emptyState', 'emptyClear', 'proverbTable',
      'footerSummary', 'undoBtn', 'redoBtn', 'fileStatus',
      'scrim', 'editor', 'editorEyebrow', 'editorTitle', 'navPosition', 'prevTerm', 'nextTerm', 'closeEditor',
      'termForm', 'f_simplified', 'f_traditional', 'f_pinyin', 'f_english', 'f_rank', 'pinyinPreview', 'sensesPreview',
      'editionFields', 'f_source', 'f_legacy_id', 'f_definition_zh', 'f_alt_forms', 'f_notes', 'f_general_meaning',
      'addLink', 'linkRows', 'editorIssues', 'deleteTerm', 'duplicateTerm', 'cancelEdit', 'saveTerm',
      'termAddMediaImage', 'termAddMediaSgf', 'termMediaRows', 'imageInput', 'sgfInput',
      'mediaDialog', 'mediaDialogBody', 'mediaDialogClose',
      'confirmDialog', 'confirmTitle', 'confirmMsg', 'confirmCancel', 'confirmOk',
      'importDialog', 'dropzone', 'importFile', 'importPreview', 'importSummary',
      'importCancel', 'importConfirm',
      'reviewDialog', 'reviewSummary', 'reviewBody', 'reviewClose',
      'helpDialog', 'helpClose', 'toast',
    ].forEach(function (id) { E[id] = $(id); });
  }

  function wireEvents() {
    /* Sections */
    E.tabTerms.addEventListener('click', function () { setView('terms'); });
    E.tabProverbs.addEventListener('click', function () { setView('proverbs'); });
    E.pdfBtn.addEventListener('click', openPdf);

    /* Media */
    E.imageInput.addEventListener('change', function () {
      if (E.imageInput.files && E.imageInput.files[0]) handleMediaFile(E.imageInput.files[0]);
    });
    E.sgfInput.addEventListener('change', function () {
      if (E.sgfInput.files && E.sgfInput.files[0]) handleMediaFile(E.sgfInput.files[0]);
    });
    E.termAddMediaImage.addEventListener('click', function () {
      pickMedia('image', function (item) {
        mediaDrafts.term.push(item);
        renderTermMedia();
        markEditorDirty();
      });
    });
    E.termAddMediaSgf.addEventListener('click', function () {
      pickMedia('sgf', function (item) {
        mediaDrafts.term.push(item);
        renderTermMedia();
        markEditorDirty();
      });
    });
    E.mediaDialogClose.addEventListener('click', function () { E.mediaDialog.close(); });

    /* Search / filters */
    E.editionSelect.addEventListener('change', function () {
      setEdition(E.editionSelect.value);
    });
    E.search.addEventListener('input', function () {
      state.query = E.search.value;
      E.clearSearch.hidden = !E.search.value;
      renderTable();
      renderStatus();
    });
    E.clearSearch.addEventListener('click', function () {
      state.query = '';
      E.search.value = '';
      E.clearSearch.hidden = true;
      E.search.focus();
      renderTable();
    });
    E.letterChips.addEventListener('click', function (event) {
      var button = event.target.closest('.letter-chip');
      if (!button) return;
      state.letter = button.dataset.letter;
      renderLetters();
      renderTable();
      renderStatus();
    });
    E.filterSelect.addEventListener('change', function () {
      state.filter = E.filterSelect.value;
      renderStats();
      renderTable();
    });
    E.rankFilter.addEventListener('change', function () {
      state.rank = E.rankFilter.value;
      renderTable();
    });
    E.sortSelect.addEventListener('change', function () {
      state.sort = E.sortSelect.value;
      renderTable();
    });
    E.sortDirBtn.addEventListener('click', function () {
      state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      E.sortDirBtn.textContent = state.dir === 'asc' ? '↑' : '↓';
      E.sortDirBtn.title = 'Sort ' + (state.dir === 'asc' ? 'ascending' : 'descending');
      renderTable();
    });
    $$('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var sort = th.dataset.sort;
        if (state.sort === sort) {
          state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = sort;
          state.dir = 'asc';
        }
        E.sortSelect.value = state.sort;
        E.sortDirBtn.textContent = state.dir === 'asc' ? '↑' : '↓';
        renderTable();
      });
    });
    $$('.stat[data-stat]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = button.dataset.stat;
        setFilter(state.filter === next ? 'all' : next);
      });
    });
    E.emptyClear.addEventListener('click', clearFilters);

    /* Table */
    E.termBody.addEventListener('click', function (event) {
      var thumb = event.target.closest('.media-thumb');
      if (thumb) {
        event.stopPropagation();
        var thumbRow = thumb.closest('tr[data-id]');
        if (!thumbRow) return;
        var thumbTerm = state.terms.find(function (item) { return item.id === Number(thumbRow.dataset.id); });
        var thumbIndex = Number(thumb.dataset.mediaIndex) || 0;
        if (thumbTerm && thumbTerm.media[thumbIndex]) openMediaViewer(thumbTerm.media[thumbIndex]);
        return;
      }
      var action = event.target.closest('button[data-act]');
      if (action) {
        event.stopPropagation();
        var row = action.closest('tr[data-id]');
        if (!row) return;
        var id = Number(row.dataset.id);
        if (action.dataset.act === 'edit') openEditor(id);
        else deleteTermById(id);
        return;
      }
      if (event.target.closest('input, a')) return;
      var tr = event.target.closest('tr[data-id]');
      if (tr) openEditor(Number(tr.dataset.id));
    });
    E.termBody.addEventListener('change', function (event) {
      var checkbox = event.target.closest('.row-check');
      if (!checkbox) return;
      var row = checkbox.closest('tr[data-id]');
      var id = Number(row.dataset.id);
      if (checkbox.checked) state.selected.add(id);
      else state.selected.delete(id);
      row.classList.toggle('selected', checkbox.checked);
      updateSelectionUI();
    });
    E.termBody.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      if (event.target.closest('button, input, a')) return;
      var row = event.target.closest('tr[data-id]');
      if (row) {
        event.preventDefault();
        openEditor(Number(row.dataset.id));
      }
    });
    E.selectAll.addEventListener('change', function () {
      var view = computeView();
      if (E.selectAll.checked) view.rows.forEach(function (term) { state.selected.add(term.id); });
      else view.rows.forEach(function (term) { state.selected.delete(term.id); });
      renderTable();
    });
    E.bulkDelete.addEventListener('click', async function () {
      var count = state.selected.size;
      if (!count) return;
      var ok = await confirmAction(
        'Delete selected terms?',
        'Delete ' + plural(count, 'selected term') + '? You can undo this.',
        'Delete selected',
        true
      );
      if (!ok) return;
      pushHistory();
      state.terms = state.terms.filter(function (term) { return !state.selected.has(term.id); });
      state.selected.clear();
      persist();
      renderAll();
      toast('Deleted ' + plural(count, 'term') + '.');
    });
    E.bulkClear.addEventListener('click', function () {
      state.selected.clear();
      renderTable();
    });

    /* Menus */
    E.fileMenuBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleMenu(E.fileMenu, E.fileMenuBtn);
    });
    E.toolsMenuBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleMenu(E.toolsMenu, E.toolsMenuBtn);
    });
    E.columnsMenuBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      renderColumnsMenu();
      toggleMenu(E.columnsMenu, E.columnsMenuBtn);
    });
    E.columnsMenu.addEventListener('click', function (event) {
      event.stopPropagation();
      var column = event.target.closest('button[data-column]');
      if (column) {
        toggleColumn(column.dataset.column);
        return;
      }
      if (event.target.closest('[data-column-action="all"]')) {
        showAllColumns();
      }
    });
    E.fileMenu.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (button) handleFileAction(button.dataset.action);
    });
    E.toolsMenu.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (button) handleToolAction(button.dataset.action);
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.menu-wrap')) closeMenus();
    });

    /* Primary actions */
    E.newTermBtn.addEventListener('click', function () {
      if (proverbsActive()) window.GoProverbs.openNew();
      else openEditor('new');
    });
    E.importBtn.addEventListener('click', openImport);
    E.saveJsonBtn.addEventListener('click', function () {
      if (proverbsActive()) window.GoProverbs.saveJSON(false);
      else saveJSON(false);
    });
    E.undoBtn.addEventListener('click', undo);
    E.redoBtn.addEventListener('click', redo);

    /* Editor */
    E.closeEditor.addEventListener('click', function () { closeDrawer(false); });
    E.cancelEdit.addEventListener('click', function () { closeDrawer(false); });
    E.scrim.addEventListener('click', function () { closeActiveEditor(false); });
    E.prevTerm.addEventListener('click', function () { navigateEditor(-1); });
    E.nextTerm.addEventListener('click', function () { navigateEditor(1); });
    E.termForm.addEventListener('input', function () {
      updateEditorPreview();
      refreshEditorIssues();
    });
    E.termForm.addEventListener('submit', saveEditor);
    E.deleteTerm.addEventListener('click', function () {
      if (state.editingId != null) deleteTermById(state.editingId);
    });
    E.duplicateTerm.addEventListener('click', duplicateCurrent);
    E.addLink.addEventListener('click', function () {
      var input = addLinkRow({ url: '', label: '' });
      markEditorDirty();
      if (input) input.focus();
    });
    E.linkRows.addEventListener('click', function (event) {
      var remove = event.target.closest('.link-remove');
      if (!remove) return;
      var row = remove.closest('.link-row');
      if (row) row.remove();
      if (!E.linkRows.querySelector('.link-row')) {
        E.linkRows.innerHTML = '<p class="link-empty">No links yet.</p>';
      }
      markEditorDirty();
      refreshEditorIssues();
    });
    E.linkRows.addEventListener('change', function (event) {
      var input = event.target.closest('.link-url');
      if (!input) return;
      var row = input.closest('.link-row');
      var label = row.querySelector('.link-label');
      if (label && !label.value.trim() && input.value.trim()) {
        label.value = deriveLabel(input.value.trim());
        markEditorDirty();
      }
    });
    E.editor.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        E.termForm.requestSubmit();
        return;
      }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        navigateEditor(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (event.key !== 'Tab') return;
      var focusable = $$('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]', E.editor)
        .filter(function (element) { return element.offsetParent !== null; });
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

    /* Confirm dialog */
    E.confirmOk.addEventListener('click', function () { finishConfirm(true); });
    E.confirmCancel.addEventListener('click', function () { finishConfirm(false); });
    E.confirmDialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      finishConfirm(false);
    });

    /* Import dialog */
    E.dropzone.addEventListener('click', function () { E.importFile.click(); });
    E.dropzone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        E.importFile.click();
      }
    });
    E.importFile.addEventListener('change', function () {
      if (E.importFile.files && E.importFile.files[0]) handleImportFile(E.importFile.files[0]);
    });
    ['dragenter', 'dragover'].forEach(function (type) {
      E.dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        E.dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      E.dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        E.dropzone.classList.remove('dragover');
      });
    });
    E.dropzone.addEventListener('drop', function (event) {
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
        handleImportFile(event.dataTransfer.files[0]);
      }
    });
    E.importCancel.addEventListener('click', function () { E.importDialog.close(); });
    E.importConfirm.addEventListener('click', applyImport);
    $$('input[name="importMode"]').forEach(function (radio) {
      radio.addEventListener('change', renderImportPreview);
    });

    /* Review + help */
    E.reviewBtn.addEventListener('click', openReview);
    E.reviewBody.addEventListener('click', function (event) {
      var item = event.target.closest('.review-item');
      if (!item) return;
      E.reviewDialog.close();
      if (item.dataset.kind === 'proverb' && window.GoProverbs) {
        setView('proverbs', { initial: true });
        window.GoProverbs.openEditor(Number(item.dataset.id));
      } else {
        setView('terms', { initial: true });
        openEditor(Number(item.dataset.id));
      }
    });
    E.reviewClose.addEventListener('click', function () { E.reviewDialog.close(); });
    E.helpBtn.addEventListener('click', function () { E.helpDialog.showModal(); });
    E.helpClose.addEventListener('click', function () { E.helpDialog.close(); });

    /* Theme, layout and statistics */
    E.themeBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleMenu(E.themeMenu, E.themeBtn);
    });
    $$('[data-theme-choice]').forEach(function (button) {
      button.addEventListener('click', function () {
        applyTheme(button.dataset.themeChoice, true);
        closeMenus();
      });
    });
    E.layoutPortrait.addEventListener('click', function () { applyLayout('portrait', { save: true }); });
    E.layoutLandscape.addEventListener('click', function () { applyLayout('landscape', { save: true }); });
    E.statsToggleBtn.addEventListener('click', function () {
      setStatsVisible(!state.statsVisible, true);
    });

    /* Keyboard */
    document.addEventListener('keydown', function (event) {
      var target = event.target;
      var tag = String(target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
      var mod = event.ctrlKey || event.metaKey;
      var dialogOpen = !!document.querySelector('dialog[open]');

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (proverbsActive()) window.GoProverbs.focusSearch();
        else { E.search.focus(); E.search.select(); }
        return;
      }
      if (!typing && !mod && event.key === '/') {
        event.preventDefault();
        if (proverbsActive()) window.GoProverbs.focusSearch();
        else E.search.focus();
        return;
      }
      if (!typing && !mod && !dialogOpen && event.key.toLowerCase() === 'n' &&
          !drawerOpen && !(proverbsActive() && window.GoProverbs.isOpen())) {
        event.preventDefault();
        if (proverbsActive()) window.GoProverbs.openNew(); else openEditor('new');
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (proverbsActive()) window.GoProverbs.saveJSON(false); else saveJSON(false);
        return;
      }
      if (mod && !typing && !dialogOpen && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (proverbsActive()) {
          if (event.shiftKey) window.GoProverbs.redo(); else window.GoProverbs.undo();
        } else if (event.shiftKey) redo(); else undo();
        return;
      }
      if (mod && !typing && !dialogOpen && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        if (proverbsActive()) window.GoProverbs.redo(); else redo();
        return;
      }
      if (event.key === 'Escape') {
        closeMenus();
        if (!dialogOpen && (drawerOpen || (proverbsActive() && window.GoProverbs.isOpen()))) {
          closeActiveEditor(false);
        }
      }
    });

    window.addEventListener('beforeunload', function (event) {
      if (editorDirty || (proverbsActive() && window.GoProverbs.isDirty())) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  /* ------------------------------------------------------------
     Init
     ------------------------------------------------------------ */
  function init() {
    cacheElements();
    renderEditionPicker();
    loadWorkingCopy();
    renderFilterOptions();
    applyTheme((function () {
      try { return localStorage.getItem(LS_THEME) || 'auto'; } catch (e) { return 'auto'; }
    })(), false);

    if (window.innerWidth < 900 && state.layout === 'landscape') {
      state.layout = 'portrait';
      state.statsVisible = true;
    }
    applyLayout(state.layout, { initial: true, keepStats: true, save: false });
    setStatsVisible(state.statsVisible, false);
    renderColumnsMenu();
    applyColumns();

    wireEvents();
    renderAll();
    updateFileLabels();

    var savedView = null;
    try { savedView = localStorage.getItem(LS_VIEW); } catch (e) { savedView = null; }
    if (savedView === 'proverbs') {
      if (window.GoProverbs) {
        setView('proverbs', { initial: true, force: true });
      } else {
        setTimeout(function () {
          if (window.GoProverbs) setView('proverbs', { initial: true, force: true });
        }, 0);
      }
    } else {
      setView('terms', { initial: true, force: true });
    }

    loadHandles();
    E.sortDirBtn.textContent = state.dir === 'asc' ? '↑' : '↓';
    if (state.view === 'terms') E.search.focus({ preventScroll: true });
    else if (window.GoProverbs) window.GoProverbs.focusSearch();
  }

  /* Small debug/automation surface. Harmless for a local tool. */
  window.__goterm = {
    get terms() { return state.terms; },
    get state() { return state; },
    get bundle() { return BUNDLE; },
    bundles: BUNDLES,
    normalizeTerm: normalizeTerm,
    buildIndex: buildIndex,
    issuesFor: issuesFor,
    computeView: computeView,
    exportJSONString: exportJSONString,
    exportCSVString: exportCSVString,
    exportObject: exportObject,
    parseCSV: parseCSV,
    setEdition: setEdition,
    filterOptions: renderFilterOptions,
    addTerm: function (draft) {
      var id = nextId();
      var term = normalizeTerm(Object.assign({}, draft, { id: id }), id);
      pushHistory();
      state.terms.push(term);
      persist();
      renderAll();
      return term;
    },
    updateTerm: function (id, draft) {
      var term = normalizeTerm(Object.assign({}, draft, { id: id }), id);
      var index = state.terms.findIndex(function (item) { return item.id === Number(id); });
      if (index < 0) return null;
      pushHistory();
      state.terms[index] = term;
      persist();
      renderAll();
      return term;
    },
    importText: function (text, fileName, mode) {
      var parsed = (fileName && /\.csv$/i.test(fileName)) || looksLikeCSV(text)
        ? parseCSVImport(text)
        : parseJSONImport(text);
      pendingImport = {
        kind: 'terms',
        items: parsed.terms,
        skipped: parsed.skipped,
        fileName: fileName || 'import',
        source: parsed.source || '',
      };
      if (mode) {
        var radio = document.querySelector('input[name="importMode"][value="' + mode + '"]');
        if (radio) radio.checked = true;
      }
      applyImport();
      return parsed.terms.length;
    },
    undo: undo,
    redo: redo,
    openEditor: openEditor,
    closeEditor: function (force) { return closeDrawer(force !== false); },
    deleteTerm: deleteTermById,
    setFilter: setFilter,
    clearFilters: clearFilters,
    refresh: function () { renderAll(); },
    setView: setView,
    openPdf: openPdf,
    setTheme: applyTheme,
    setLayout: applyLayout,
    setStatsVisible: setStatsVisible,
  };

  /* Shared surface used by the proverb section module. */
  window.GoShared = {
    state: state,
    escapeHtml: escapeHtml,
    toPlain: toPlain,
    toast: toast,
    confirmAction: confirmAction,
    download: download,
    clone: clone,
    cloneMedia: cloneMedia,
    idbGet: idbGet,
    idbSet: idbSet,
    ensureWritePermission: ensureWritePermission,
    writeHandle: writeHandle,
    FS_SUPPORTED: FS_SUPPORTED,
    OPEN_SUPPORTED: OPEN_SUPPORTED,
    renderMediaRows: renderMediaRows,
    pickMedia: pickMedia,
    openMediaViewer: openMediaViewer,
    showBanner: showBanner,
    hideBanner: hideBanner,
    getView: function () { return state.view; },
    setView: setView,
    notifyChanged: function () { updateGlobalBadges(); updateFileLabels(); },
    updateFileLabels: updateFileLabels,
    proverbsActive: proverbsActive,
    openPdf: openPdf,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
