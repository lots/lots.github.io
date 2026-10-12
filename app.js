/*!
 * app.js — CoQ 棋钟「界面与操作层」
 * 计时逻辑全部在 engine.js（纯函数，带单元测试），这里只负责：
 *   设置界面 / 渲染 / 触摸与键盘输入 / 声音 / 屏幕常亮 / 本地存储 / 中英双语
 * 界面文案一律走 i18n.js 的 t('key')，不要在代码里写死中文或英文。
 */
(function () {
  'use strict';

  var E = window.ChessClockEngine;
  var I18N = window.ChessClockI18N;
  if (!E) { window.alert('engine.js 未能加载 / engine.js failed to load.'); return; }
  if (!I18N) { window.alert('i18n.js 未能加载 / i18n.js failed to load.'); return; }

  var STORAGE_KEY = 'chessclock.settings.v1';

  /**
   * 常见比赛用时（国际象棋类：Fischer 加秒 / Bronstein 延时 / 无加秒共用）。
   * name 是 i18n 的 key，不是显示文字。
   */
  var PRESETS_CHESS = [
    { id: '1+0',   baseMin: 1,  incSec: 0,  name: 'preset.bullet' },
    { id: '3+2',   baseMin: 3,  incSec: 2,  name: 'preset.blitz' },
    { id: '5+0',   baseMin: 5,  incSec: 0,  name: 'preset.rapid' },
    { id: '5+3',   baseMin: 5,  incSec: 3,  name: 'preset.rapid' },
    { id: '10+0',  baseMin: 10, incSec: 0,  name: 'preset.rapid' },
    { id: '10+5',  baseMin: 10, incSec: 5,  name: 'preset.rapid' },
    { id: '15+10', baseMin: 15, incSec: 10, name: 'preset.rapid' },
    { id: '25+10', baseMin: 25, incSec: 10, name: 'preset.classical' },
    { id: '30+0',  baseMin: 30, incSec: 0,  name: 'preset.classical' },
    { id: '60+30', baseMin: 60, incSec: 30, name: 'preset.classical' },
    { id: '90+30', baseMin: 90, incSec: 30, name: 'preset.classical' }
  ];

  /**
   * 围棋（Byoyomi）常用制式。记法沿用围棋习惯：
   *
   *     基础时间 + 段数 × 每手秒数
   *
   * 例：10+3×20 = 主时间 10 分钟；主时间用完后每手 20 秒、共 3 段
   *（可超时思考 2 次，第 3 次超时判负）。段数=1 时可自定义为「超时即负」。
   *
   * sub 是按钮下方那行小字：写成「20s × 3」把顺序讲明白，
   * 免得与主记法「3×20」的读法混淆（两种写法意思相同）。
   */
  var PRESETS_BYOYOMI = [
    { id: '5+3x20',  baseMin: 5,  incSec: 20, periods: 3, sub: '20s × 3' },
    { id: '10+3x20', baseMin: 10, incSec: 20, periods: 3, sub: '20s × 3' },
    { id: '10+3x30', baseMin: 10, incSec: 30, periods: 3, sub: '30s × 3' },
    { id: '15+3x30', baseMin: 15, incSec: 30, periods: 3, sub: '30s × 3' },
    { id: '20+5x30', baseMin: 20, incSec: 30, periods: 5, sub: '30s × 5' },
    { id: '30+5x30', baseMin: 30, incSec: 30, periods: 5, sub: '30s × 5' },
    { id: '30+3x60', baseMin: 30, incSec: 60, periods: 3, sub: '60s × 3' },
    { id: '60+5x60', baseMin: 60, incSec: 60, periods: 5, sub: '60s × 5' }
  ];

  /** 当前模式下该显示哪一组预设 */
  function presetsFor(mode) {
    return mode === E.MODES.BYOYOMI ? PRESETS_BYOYOMI : PRESETS_CHESS;
  }

  /** 预设按钮上的主记法：10+5 / 10+3×20 */
  function presetLabel(p) {
    return p.periods
      ? (p.baseMin + '+' + p.periods + '×' + p.incSec)
      : (p.baseMin + '+' + p.incSec);
  }

  var DEFAULTS = {
    mode: 'byoyomi',                  // 首次打开：围棋读秒制
    baseMin: 10,
    incSec: 20,                       // 读秒每手 20 秒
    periods: 3,                       // 共 3 段
    presetId: '10+3x20',              // = 10+3×20（主时间 10 分钟 + 20 秒 × 3 段）
    sound: true,
    facing: true,
    swapped: false,                   // 「交换两侧位置」：false = 默认（竖屏上黑下白 / 横屏左黑右白）
    keepAwake: true,
    lang: 'en',                       // 首次打开：英文（按钮可随时切到华文，之后记住选择）
    theme: 'dark'                     // 深色（最初那套配色）为默认
  };

  var cfg = loadSettings();
  var S = null;                       // 当前对局（engine 状态）
  var lastText = { w: null, b: null };// 上次渲染的文本，避免无谓的 DOM 写入
  var rafId = null;
  var alarmTimer = null;
  var wakeLock = null;
  var toastTimer = null;
  var lastTickKey = null;             // 读秒每秒提示音去重

  /* ================= 界面主题 ================= */

  /** 顺序与设置页下拉框一致：浅色 / 中性 / 深色 */
  var THEMES = ['light', 'medium', 'dark'];
  function normalizeTheme(v) { return THEMES.indexOf(v) >= 0 ? v : 'dark'; }

  /**
   * 主题只做一件事：给 <html> 打上 data-theme="…"，
   * 三个主题的全部色值都写在 styles.css 的变量块里（:root[data-theme="…"]）。
   * 想加主题：改 styles.css + 这里的 THEMES + index.html 的一个 <option> + i18n 词条。
   */
  function applyTheme(next) {
    var theme = normalizeTheme(next);
    cfg.theme = theme;
    document.documentElement.dataset.theme = theme;
    var sel = $('#themeSelect');
    if (sel) { sel.value = theme; }
    // 手机浏览器的地址栏/状态栏颜色跟着走；色值直接读 CSS 变量，避免两处各写一份
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) { meta.setAttribute('content', bg); }
    }
  }

  /* ================= 语言 ================= */

  var lang = I18N.normalize(cfg.lang) || 'zh';
  var t = I18N.make(lang);            // 当前语言的翻译函数

  /** URL 上的 ?lang=en / ?lang=zh 优先（方便分享指定语言的链接，也供截图脚本用） */
  function queryParam(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([\\w-]+)').exec(window.location.search);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }
  function langFromQuery() { return I18N.normalize(queryParam('lang')); }
  var queryLang = langFromQuery();
  if (queryLang) { lang = queryLang; cfg.lang = queryLang; t = I18N.make(lang); }

  // 同理 ?theme=light / medium / dark（截图脚本三个主题各拍一张时用）
  var queryTheme = queryParam('theme');
  if (queryTheme && THEMES.indexOf(queryTheme) >= 0) { cfg.theme = queryTheme; }

  /** 把语言应用到整页：<html lang> / <title> / 描述 / 所有 data-i18n* 标记 / 动态文案 */
  function applyLanguage(next) {
    lang = I18N.normalize(next) || 'zh';
    cfg.lang = lang;
    t = I18N.make(lang);

    document.documentElement.lang = t('html.lang');
    document.title = t('app.title');
    var meta = document.querySelector('meta[name="description"]');
    if (meta) { meta.setAttribute('content', t('app.description')); }

    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-i18n-html]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    $$('[data-i18n-title]').forEach(function (el) {
      var s = t(el.getAttribute('data-i18n-title'));
      el.title = s;
      if (!el.hasAttribute('aria-label')) { el.setAttribute('aria-label', s); }
    });
    $$('[data-i18n-aria-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    $$('[data-i18n-alt]').forEach(function (el) { el.alt = t(el.getAttribute('data-i18n-alt')); });
    $$('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });

    // 语言按钮：ENG / 华文 里把当前语言那半边点亮
    $$('[data-lang-name]').forEach(function (el) {
      el.classList.toggle('is-on', el.getAttribute('data-lang-name') === lang);
    });

    renderLanguageDependentUI();
  }

  /** 语言一变就要重画的那几处（模式提示、加秒标签、预设、摘要、棋钟页状态） */
  function renderLanguageDependentUI() {
    $('#modeHint').textContent = t('hint.' + cfg.mode);
    updateDerivedUI();          // 内含 buildPresets()：语言一变，预设的类别名也跟着换
    updateSoundButton();
    updateToggleButton();
    if (S) { render(); }
  }

  var paneEls = {}, timeEls = {}, moveEls = {}, chipEls = {};

  /* ================= 小工具 ================= */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function num(value, fallback) {
    var n = parseFloat(value);
    return isFinite(n) ? n : fallback;
  }
  function clampInt(value, min, max, fallback) {
    var n = num(value, fallback);
    n = Math.round(n);
    if (n < min) { n = min; }
    if (n > max) { n = max; }
    return n;
  }
  function sideLabel(side) {
    return side === 'w' ? t('side.w') : t('side.b');
  }

  /* ================= 设置持久化 ================= */

  function loadSettings() {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = DEFAULTS[k]; });
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
          Object.keys(DEFAULTS).forEach(function (k) {
            if (saved[k] !== undefined && saved[k] !== null) { out[k] = saved[k]; }
          });
        }
      }
    } catch (e) { /* 隐私模式 / 禁用存储时静默降级 */ }
    return out;
  }

  function saveSettings() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function engineConfig() {
    var addSec = clampInt(cfg.incSec, 0, 180, 0);
    return {
      mode: cfg.mode,
      baseMs: clampInt(cfg.baseMin, 1, 180, DEFAULTS.baseMin) * 60000,
      incMs: addSec * 1000,
      delayMs: addSec * 1000,
      byoyomiMs: addSec * 1000,
      byoyomiPeriods: clampInt(cfg.periods, 1, 20, DEFAULTS.periods)
    };
  }

  /* ================= 声音（现场合成，不依赖音频文件） ================= */

  var Sound = (function () {
    var ctx = null;

    function ensure() {
      if (!cfg.sound) { return null; }
      try {
        if (!ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) { return null; }
          ctx = new AC();
        }
        if (ctx.state === 'suspended' && ctx.resume) { ctx.resume(); }
        return ctx;
      } catch (e) { return null; }
    }

    function blip(freq, dur, vol, type) {
      var c = ensure();
      if (!c) { return; }
      try {
        var t = c.currentTime;
        var osc = c.createOscillator();
        var gain = c.createGain();
        osc.type = type || 'square';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(vol, t + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      } catch (e) {}
    }

    return {
      unlock: function () { ensure(); },
      click: function () { blip(1500, 0.03, 0.09, 'square'); },
      alarm: function () {
        stopAlarm();
        if (!cfg.sound) { return; }
        var n = 0;
        blip(880, 0.16, 0.16, 'sine');
        alarmTimer = window.setInterval(function () {
          blip(880, 0.16, 0.16, 'sine');
          n += 1;
          if (n >= 6) { stopAlarm(); }
        }, 240);
      },
      // 读秒阶段最后 10 秒的每秒提示音
      tick: function () { blip(1320, 0.05, 0.12, 'square'); }
    };
  })();

  function stopAlarm() {
    if (alarmTimer) { window.clearInterval(alarmTimer); alarmTimer = null; }
  }

  /* ================= 屏幕常亮（Wake Lock） ================= */

  function requestWake() {
    if (!cfg.keepAwake || wakeLock) { return; }
    if (!navigator.wakeLock || !navigator.wakeLock.request) { return; }
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        if (lock.addEventListener) {
          lock.addEventListener('release', function () { wakeLock = null; });
        }
      })['catch'](function () { /* 不支持或被拒绝：忽略 */ });
    } catch (e) {}
  }

  function releaseWake() {
    try { if (wakeLock && wakeLock.release) { wakeLock.release(); } } catch (e) {}
    wakeLock = null;
  }

  /* ================= 界面切换 ================= */

  function showScreen(name) {
    $('#screen-setup').hidden = (name !== 'setup');
    $('#screen-clock').hidden = (name !== 'clock');
    if (name === 'clock') {
      window.requestAnimationFrame(fitTime);
    }
  }

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  /* ================= 设置界面 ================= */

  /**
   * 重建预设按钮。模式或语言变了都要重建（主记法与副标题都依赖这两者），
   * 用一个 key 记住上次建的是哪一套，避免每次刷新都重建 DOM。
   */
  var builtPresetKey = null;
  function buildPresets() {
    var key = cfg.mode + '|' + lang;
    if (key === builtPresetKey) { return; }
    builtPresetKey = key;

    var box = $('#presets');
    box.innerHTML = '';
    presetsFor(cfg.mode).forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.id = p.id;
      b.innerHTML = '<strong>' + presetLabel(p) + '</strong><span>' +
        (p.sub || t(p.name)) + '</span>';
      b.addEventListener('click', function () {
        cfg.baseMin = p.baseMin;
        cfg.incSec = p.incSec;
        if (p.periods) { cfg.periods = p.periods; }
        cfg.presetId = p.id;
        syncSetupUI();
        saveSettings();
      });
      box.appendChild(b);
    });
  }

  /**
   * 本局用时的可读描述（**在界面层拼**，因为引擎是纯逻辑、不带语言）。
   * 例：中文「10 分钟 + 每步 5 秒 · Fischer 加秒」／英文「10 min + 5s per move · Fischer」。
   */
  function describeConfig() {
    var c = engineConfig();
    var base = Math.round(c.baseMs / 60000);
    var add = Math.round(c.incMs / 1000);
    if (c.mode === E.MODES.BYOYOMI) {
      var periods = c.byoyomiPeriods > 1
        ? t('summary.byoyomi.periods', { n: c.byoyomiPeriods })
        : '';
      return t('summary.byoyomi', { base: base, add: add, periods: periods });
    }
    if (c.mode === E.MODES.DELAY) { return t('summary.delay', { base: base, add: add }); }
    if (c.mode === E.MODES.SUDDEN) { return t('summary.sudden', { base: base }); }
    return t('summary.fischer', { base: base, add: add });
  }

  /** 只更新派生显示（不清空用户正在输入的内容） */
  function updateDerivedUI() {
    var isByoyomi = (cfg.mode === E.MODES.BYOYOMI);
    $('#modeHint').textContent = t('hint.' + cfg.mode);
    $('#summary').textContent = t('summary.prefix') + describeConfig();
    $('#incSec').disabled = (cfg.mode === E.MODES.SUDDEN);
    $('#periodsField').hidden = !isByoyomi;
    $('#incLabel').textContent = cfg.mode === E.MODES.DELAY
      ? t('inc.delay')
      : (isByoyomi
        ? t('inc.byoyomi')
        : (cfg.mode === E.MODES.SUDDEN ? t('inc.sudden') : t('inc.fischer')));

    var match = null;
    buildPresets();                       // 模式/语言变了就换一套预设（内部按 key 去重）
    presetsFor(cfg.mode).forEach(function (p) {
      if (p.baseMin === cfg.baseMin && p.incSec === cfg.incSec &&
          (!p.periods || p.periods === cfg.periods)) { match = p.id; }
    });
    if (match) { cfg.presetId = match; }
    $$('#presets .preset').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.id === cfg.presetId);
    });
  }

  /** 把 cfg 完整写回控件 */
  function syncSetupUI() {
    $$('#modeGroup .seg').forEach(function (b) {
      var on = (b.dataset.mode === cfg.mode);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('#baseMin').value = cfg.baseMin;
    $('#incSec').value = cfg.incSec;
    $('#periods').value = cfg.periods;
    $('#optSound').checked = !!cfg.sound;
    $('#optFacing').checked = !!cfg.facing;
    $('#optWake').checked = !!cfg.keepAwake;
    updateDerivedUI();
  }

  /** 开始对局前读一遍控件，并夹到合法范围 */
  function readSetupUI() {
    cfg.baseMin = clampInt($('#baseMin').value, 1, 180, DEFAULTS.baseMin);
    // 读秒模式下 0 秒读秒没有意义（等于突然死亡），至少 1 秒
    cfg.incSec = clampInt($('#incSec').value, cfg.mode === E.MODES.BYOYOMI ? 1 : 0, 180, DEFAULTS.incSec);
    cfg.periods = clampInt($('#periods').value, 1, E.MAX_PERIODS, DEFAULTS.periods);
    cfg.sound = !!$('#optSound').checked;
    cfg.facing = !!$('#optFacing').checked;
    cfg.keepAwake = !!$('#optWake').checked;
    cfg.presetId = null;
    syncSetupUI();
  }

  /* ================= 对局 ================= */

  function newGame() {
    readSetupUI();
    saveSettings();
    stopAlarm();
    hideOverlay();
    if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }

    S = E.newGame(engineConfig());
    lastText = { w: null, b: null };
    lastTickKey = null;

    applyFacing();
    applySwap();
    $('#screen-clock').classList.remove('is-paused');
    $('#overlay').hidden = true;

    showScreen('clock');
    render();
    fitTime();
    updateSoundButton();
  }

  function applyFacing() {
    $('#screen-clock').classList.toggle('facing', !!cfg.facing);
  }

  /**
   * 「交换两侧位置」：只改 CSS 的 order（面板与操作条都写好了 order），**不动 DOM** ——
   * 操作条在标记里夹在两块面板中间，挪节点会把布局弄坏。
   * 竖屏 order 决定上下、横屏决定左右，同一套规则两边通用。
   */
  function applySwap() {
    $('#screen-clock').classList.toggle('is-swapped', !!cfg.swapped);
    applyFarPane();
  }

  /**
   * 对坐模式要旋转的是**视觉上排在最前的那一块**（竖屏=上方、横屏=左侧）。
   * 这跟 DOM 顺序无关（DOM 里永远是 黑 → 操作条 → 白，用的是 CSS order），
   * 所以必须按「是否交换过」来算：交换过就是白方在前，否则黑方在前。
   */
  function applyFarPane() {
    var farSide = cfg.swapped ? 'w' : 'b';
    ['w', 'b'].forEach(function (side) {
      paneEls[side].classList.toggle('is-far', side === farSide);
    });
  }

  /**
   * 按钟：整块面板就是那个跷跷板。
   *
   * 未开表时拍某一侧 = 开表，**由对侧开始计时** —— 与实体钟一致：跷跷板压在自己这边，
   * 走的是对方的钟。白先走，所以开局拍「黑方」那一侧 → 白方的钟开始倒数（反之亦然）。
   * 这一下不算步数（开局谁都没走过棋）。
   *
   * 开表之后：拍自己那一侧 = 走完一手，时间交给对方；拍非走棋方不产生任何效果。
   */
  function handlePress(side) {
    if (!S || S.finished) { return; }
    Sound.unlock();

    if (!S.started) {
      var res0 = E.start(S, Date.now(), E.other(side));
      if (res0.type === 'start') {
        Sound.click();
        requestWake();
        ensureLoop();
      }
      render();
      return;
    }

    var res = E.press(S, side, Date.now());
    if (res.type === 'move' || res.type === 'start') {
      Sound.click();
      requestWake();
      ensureLoop();
    } else if (res.type === 'flag') {
      tick();
      return;
    }
    render();
  }

  /** 暂停 / 继续；未开表时是空操作（开局靠拍面板，没有「开始」按钮） */
  function togglePause() {
    if (!S || S.finished || !S.started) { return; }
    Sound.unlock();
    if (S.paused) {
      E.resume(S, Date.now());
      requestWake();
      ensureLoop();
    } else {
      E.pause(S, Date.now());
    }
    render();
  }

  function onFlag(side) {
    stopAlarm();
    Sound.alarm();
    if (navigator.vibrate) {
      try { navigator.vibrate([240, 120, 240, 120, 400]); } catch (e) {}
    }
    releaseWake();
    render();
    $('#overlayTitle').textContent = t('overlay.title', { side: sideLabel(side) });
    $('#overlaySub').textContent = t('overlay.sub', { side: sideLabel(E.other(side)) });
    var moves = S.moves.w + S.moves.b;
    $('#overlayDetail').textContent = describeConfig() + ' · ' +
      (moves === 1 ? t('detail.moveOne') : t('detail.moves', { n: moves }));
    $('#overlay').hidden = false;
  }

  function hideOverlay() { $('#overlay').hidden = true; }

  /** 再来一局 */
  function rematch() {
    newGame();
  }

  function backToSetup() {
    if (S && S.started && !S.finished) {
      if (!window.confirm(t('confirm.leave'))) { return; }
    }
    stopAlarm();
    hideOverlay();
    releaseWake();
    if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }
    S = null;
    syncSetupUI();
    showScreen('setup');
  }

  /* ================= 渲染 ================= */

  function chipText(side, info) {
    if (!S) { return ''; }
    if (S.finished) { return S.flagged === side ? t('chip.flagged') : t('chip.won'); }
    if (S.paused) { return t('chip.paused'); }
    if (!S.started) { return t('chip.ready'); }
    var byo = (info && info.phase === 'byoyomi');
    if (S.active === side) { return byo ? t('chip.byoyomiRunning') : t('chip.running'); }
    return byo ? t('chip.byoyomiWaiting') : t('chip.waiting');
  }

  /** 读秒阶段最后 10 秒每秒提示一次（实体读秒钟就是这样滴答的） */
  function byoyomiTick(side, info) {
    if (!S || !S.running || S.paused || info.phase !== 'byoyomi') { return; }
    var sec = Math.ceil(info.ms / 1000);
    if (sec < 1 || sec > 10) { return; }
    var key = side + ':' + info.windowIndex + ':' + sec;
    if (key === lastTickKey) { return; }
    lastTickKey = key;
    Sound.tick();
  }

  /**
   * 让时间数字尽量占满面板：不猜字体宽度，而是先用 100px 字号实测一次文本宽度，
   * 再按面板可用宽/高反推字号（不同手机字体不同，实测才可靠）。
   * 同一任务内改回原字号，不会产生闪烁。
   */
  function fitTime() {
    ['w', 'b'].forEach(function (side) {
      var pane = paneEls[side];
      var el = timeEls[side];
      if (!pane || !el) { return; }
      var w = pane.clientWidth;
      var h = pane.clientHeight;
      if (!w || !h) { return; }

      var prev = el.style.fontSize;
      el.style.fontSize = '100px';
      var probe = el.getBoundingClientRect().width;
      el.style.fontSize = prev;
      if (!probe) { probe = 100 * Math.max(4, (el.textContent || '').length) * 0.62; }

      var size = Math.min((w * 0.92) / (probe / 100), h * 0.56);
      el.style.fontSize = Math.max(18, Math.floor(size)) + 'px';
    });
  }

  function render() {
    if (!S) { return; }
    var now = Date.now();
    var running = S.running && !S.paused;

    ['w', 'b'].forEach(function (side) {
      // 读秒模式下 ms 是「当前读秒窗口剩余」，主时间阶段就是主时间余额
      var info = E.readout(S, side, now);
      var ms = info.ms;
      var txt = E.formatTime(ms);
      var el = timeEls[side];

      if (lastText[side] !== txt) {
        var lenChanged = (lastText[side] === null || lastText[side].length !== txt.length);
        lastText[side] = txt;
        el.textContent = txt;
        if (lenChanged) { fitTime(); }
      }

      var inByoyomi = (info.phase === 'byoyomi');
      var pane = paneEls[side];
      pane.classList.toggle('is-active', running && S.active === side);
      pane.classList.toggle('is-byoyomi', inByoyomi && !S.finished);
      // 琥珀色只用于「主时间告急」；读秒阶段有自己的配色，最后 20 秒照样转红
      pane.classList.toggle('is-low',
        !S.finished && !inByoyomi && ms > E.CRITICAL_TIME_MS && ms <= E.LOW_TIME_MS);
      pane.classList.toggle('is-critical', !S.finished && ms <= E.CRITICAL_TIME_MS);
      pane.classList.toggle('is-out', S.finished && S.flagged === side);

      var foot = t('moves.n', { n: S.moves[side] });
      if (inByoyomi && !S.finished && S.cfg.byoyomiPeriods > 1) {
        foot += ' · ' + t('foot.byoyomi', {
          left: info.periodsLeft, total: S.cfg.byoyomiPeriods
        });
      }
      moveEls[side].textContent = foot;
      chipEls[side].textContent = chipText(side, info);

      if (running && S.active === side) { byoyomiTick(side, info); }
    });

    $('#screen-clock').classList.toggle('is-paused', !!S.paused);

    updateToggleButton();
  }

  /**
   * 中间那颗按钮**只有「暂停 / 继续」**：开局靠拍面板（拍对侧 → 自己开始计时），
   * 所以未开表时整颗隐藏，一局结束（结果覆盖层已出来）时也隐藏。
   */
  function updateToggleButton() {
    var btn = $('#btnToggle');
    if (!btn) { return; }
    var live = !!(S && S.started && !S.finished);
    btn.hidden = !live;
    if (!live) { return; }
    var paused = !!S.paused;
    btn.classList.toggle('primary', paused);
    $('#btnToggleLabel').textContent = paused ? t('clock.resume') : t('clock.pause');
  }

  /* ================= 计时循环 ================= */

  function tick() {
    if (!S) { return; }
    var flagged = E.checkFlag(S, Date.now());
    render();
    if (flagged) { onFlag(flagged); }
  }

  function loop() {
    rafId = null;
    tick();
    if (S && S.running) { rafId = window.requestAnimationFrame(loop); }
  }

  function ensureLoop() {
    if (rafId === null && S && S.running) { rafId = window.requestAnimationFrame(loop); }
  }

  // 页面被切到后台时 rAF 会停，这里用定时器兜底；两者都基于绝对时间戳，
  // 所以即使定时器被浏览器限流，回到前台时的时间与超时判定依旧正确。
  window.setInterval(function () {
    if (S && S.running && document.hidden) { tick(); }
  }, 500);

  /* ================= 全屏 ================= */

  function toggleFullscreen() {
    var el = document.documentElement;
    var isFull = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (!isFull) {
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!req) {
          toast(t('toast.fullscreenUnsupported'));
          return;
        }
        var p = req.call(el);
        if (p && p['catch']) {
          p['catch'](function () { toast(t('toast.fullscreenDenied')); });
        }
      } else {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) { exit.call(document); }
      }
    } catch (e) { toast(t('toast.fullscreenFailed')); }
  }

  /* ================= 声音开关按钮 ================= */

  function updateSoundButton() {
    var b = $('#btnSound');
    b.textContent = cfg.sound ? '🔊' : '🔇';
    b.setAttribute('aria-pressed', cfg.sound ? 'true' : 'false');
    b.title = cfg.sound ? t('clock.sound.off') : t('clock.sound.on');
  }

  /* ================= 输入绑定 ================= */

  function bindEvents() {
    // 模式
    $$('#modeGroup .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        cfg.mode = b.dataset.mode;
        // 切到读秒时给个合理的默认额度（0 秒读秒没有意义）
        if (cfg.mode === E.MODES.BYOYOMI && !(cfg.incSec >= 1)) { cfg.incSec = 30; }
        syncSetupUI();
        saveSettings();
        b.blur();
      });
    });

    // 自定义时间：输入时不夹取（避免打字被打断），失焦时再校正
    var numericFields = { baseMin: '#baseMin', incSec: '#incSec', periods: '#periods' };
    Object.keys(numericFields).forEach(function (key) {
      var el = $(numericFields[key]);
      el.addEventListener('input', function () {
        cfg[key] = num(el.value, cfg[key]);
        cfg.presetId = null;
        updateDerivedUI();
      });
      el.addEventListener('change', function () {
        cfg.baseMin = clampInt($('#baseMin').value, 1, 180, DEFAULTS.baseMin);
        cfg.incSec = clampInt($('#incSec').value, cfg.mode === E.MODES.BYOYOMI ? 1 : 0, 180, DEFAULTS.incSec);
        cfg.periods = clampInt($('#periods').value, 1, E.MAX_PERIODS, DEFAULTS.periods);
        syncSetupUI();
        saveSettings();
      });
    });

    $('#optSound').addEventListener('change', function () {
      cfg.sound = this.checked;
      saveSettings();
      updateSoundButton();
      if (cfg.sound) { Sound.unlock(); }
    });
    $('#optFacing').addEventListener('change', function () {
      cfg.facing = this.checked;
      saveSettings();
      applyFacing();
      fitTime();
    });
    $('#optWake').addEventListener('change', function () {
      cfg.keepAwake = this.checked;
      saveSettings();
      if (cfg.keepAwake) { requestWake(); } else { releaseWake(); }
    });

    $('#btnStartGame').addEventListener('click', function () {
      Sound.unlock();
      newGame();
    });

    // 右上角 ENG / 华文：切一次语言并记住
    $('#btnLang').addEventListener('click', function () {
      applyLanguage(lang === 'zh' ? 'en' : 'zh');
      saveSettings();
      fitTime();          // 文案长度变了，时间数字的可用宽度也跟着变
    });

    // 界面主题下拉框
    $('#themeSelect').addEventListener('change', function () {
      applyTheme(this.value);
      saveSettings();
    });

    // 面板按键：用 pointerdown（按下即响应，和实体钟一样），并阻止后续 click/长按菜单
    ['w', 'b'].forEach(function (side) {
      var pane = paneEls[side];
      pane.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) { return; }
        e.preventDefault();
        handlePress(side);
      }, { passive: false });
      pane.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      pane.addEventListener('dragstart', function (e) { e.preventDefault(); });
    });

    $$('.icon-btn, .btn').forEach(function (b) {
      b.addEventListener('click', function () { b.blur(); });
    });

    $('#btnToggle').addEventListener('click', function () { togglePause(); });
    $('#btnSound').addEventListener('click', function () {
      cfg.sound = !cfg.sound;
      saveSettings();
      updateSoundButton();
      if (cfg.sound) { Sound.unlock(); Sound.click(); }
    });
    $('#btnFull').addEventListener('click', function () { toggleFullscreen(); });
    $('#btnSetup').addEventListener('click', function () { backToSetup(); });
    $('#btnRotate').addEventListener('click', function () {
      cfg.facing = !cfg.facing;
      saveSettings();
      applyFacing();
      fitTime();
    });
    // 交换两侧位置：和别的选项一样存进 localStorage，再来一局 / 切语言 / 换主题都保持
    $('#btnSwap').addEventListener('click', function () {
      cfg.swapped = !cfg.swapped;
      saveSettings();
      applySwap();
      fitTime();
    });

    $('#btnRematch').addEventListener('click', function () { rematch(); });
    $('#btnBackToSetup').addEventListener('click', function () { backToSetup(); });

    // 键盘（电脑当棋钟用时很方便）
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') { return; }
      if ($('#screen-clock').hidden) { return; }
      var k = e.key;
      if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
        e.preventDefault();
        togglePause();
      } else if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        e.preventDefault();
        handlePress('w');
      } else if (k === 'ArrowRight' || k === 'l' || k === 'L') {
        e.preventDefault();
        handlePress('b');
      } else if (k === 'f' || k === 'F') {
        toggleFullscreen();
      }
    });

    window.addEventListener('resize', fitTime);
    window.addEventListener('orientationchange', function () {
      window.setTimeout(fitTime, 250);
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        tick();
        ensureLoop();
        if (S && S.running) { requestWake(); }
      }
    });
    // 避免 iOS 双指缩放 / 双击缩放干扰按键
    ['gesturestart', 'gesturechange'].forEach(function (evt) {
      document.addEventListener(evt, function (e) { e.preventDefault(); });
    });
    window.addEventListener('beforeunload', function (e) {
      if (S && S.running) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
      return undefined;
    });
  }

  /* ================= 启动 ================= */

  function init() {
    ['w', 'b'].forEach(function (side) {
      paneEls[side] = $('.pane[data-side="' + side + '"]');
      timeEls[side] = $('.time[data-side="' + side + '"]', paneEls[side]);
      moveEls[side] = $('.moves[data-side="' + side + '"]', paneEls[side]);
      chipEls[side] = $('.state-chip[data-side="' + side + '"]', paneEls[side]);
    });

    buildPresets();
    syncSetupUI();
    applyTheme(cfg.theme);    // 主题（head 里的内联脚本已先落一次，避免首屏闪深色）
    applyLanguage(lang);      // 应用 data-i18n 标记 + 所有动态文案（含按语言重画预设/摘要）
    bindEvents();
    applyFacing();
    applySwap();
    timeEls.w.textContent = E.formatTime(engineConfig().baseMs);
    timeEls.b.textContent = E.formatTime(engineConfig().baseMs);
    showScreen('setup');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
