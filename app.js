/*!
 * app.js — CoQ 棋钟「界面与操作层」
 * 计时逻辑全部在 engine.js（纯函数，带单元测试），这里只负责：
 *   设置界面 / 渲染 / 触摸与键盘输入 / 声音 / 屏幕常亮 / 本地存储
 */
(function () {
  'use strict';

  var E = window.ChessClockEngine;
  if (!E) { window.alert('engine.js 未能加载，请确认文件完整。'); return; }

  var STORAGE_KEY = 'chessclock.settings.v1';

  /** 常见比赛用时（单时段） */
  var PRESETS = [
    { id: '1+0',   baseMin: 1,  incSec: 0,  name: '子弹' },
    { id: '3+2',   baseMin: 3,  incSec: 2,  name: '超快棋' },
    { id: '5+0',   baseMin: 5,  incSec: 0,  name: '快棋' },
    { id: '5+3',   baseMin: 5,  incSec: 3,  name: '快棋' },
    { id: '10+0',  baseMin: 10, incSec: 0,  name: '快棋' },
    { id: '10+5',  baseMin: 10, incSec: 5,  name: '快棋' },
    { id: '15+10', baseMin: 15, incSec: 10, name: '快棋' },
    { id: '25+10', baseMin: 25, incSec: 10, name: '慢棋' },
    { id: '30+0',  baseMin: 30, incSec: 0,  name: '慢棋' },
    { id: '60+30', baseMin: 60, incSec: 30, name: '慢棋' },
    { id: '90+30', baseMin: 90, incSec: 30, name: '慢棋' }
  ];

  var MODE_HINTS = {
    fischer: 'Fischer 加秒：每走完一步，自己钟上立即加上固定秒数（如 10+5）。国际比赛最常用，推荐。',
    delay: 'Bronstein 延时：每步开始后的前 N 秒不计时，超过 N 秒才开始扣（适合初学者，不会一慌就掉时间）。',
    byoyomi: 'Byoyomi 读秒：主时间用完后，每一手重新给固定的 N 秒，用不完不累积。超过读秒额度就算超时；' +
      '多段读秒（如 30 秒 × 5 段）允许你在几步上超时思考，段数用尽后再超即判负。围棋、将棋、中国象棋常用。',
    sudden: '无加秒：只有基础时间，走完就没了（突然死亡）。最简单的模式。'
  };

  var DEFAULTS = {
    mode: 'fischer',
    baseMin: 10,
    incSec: 5,
    periods: 1,
    presetId: '10+5',
    sound: true,
    facing: true,
    keepAwake: true
  };

  var cfg = loadSettings();
  var S = null;                       // 当前对局（engine 状态）
  var lastText = { w: null, b: null };// 上次渲染的文本，避免无谓的 DOM 写入
  var rafId = null;
  var alarmTimer = null;
  var wakeLock = null;
  var toastTimer = null;
  var lastTickKey = null;             // 读秒每秒提示音去重

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
    return side === 'w' ? '白方' : '黑方';
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

  function buildPresets() {
    var box = $('#presets');
    box.innerHTML = '';
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.id = p.id;
      b.innerHTML = '<strong>' + p.baseMin + '+' + p.incSec + '</strong><span>' + p.name + '</span>';
      b.addEventListener('click', function () {
        cfg.baseMin = p.baseMin;
        cfg.incSec = p.incSec;
        cfg.presetId = p.id;
        syncSetupUI();
        saveSettings();
      });
      box.appendChild(b);
    });
  }

  /** 只更新派生显示（不清空用户正在输入的内容） */
  function updateDerivedUI() {
    var isByoyomi = (cfg.mode === E.MODES.BYOYOMI);
    $('#modeHint').textContent = MODE_HINTS[cfg.mode] || '';
    $('#summary').textContent = '本局用时：' + E.describeConfig(engineConfig());
    $('#incSec').disabled = (cfg.mode === E.MODES.SUDDEN);
    $('#periodsField').hidden = !isByoyomi;
    $('#incLabel').textContent = cfg.mode === E.MODES.DELAY
      ? '每步延时（秒）'
      : (isByoyomi
        ? '每步读秒（秒）'
        : (cfg.mode === E.MODES.SUDDEN ? '每步加秒（本模式不使用）' : '每步加秒（秒）'));

    var match = null;
    PRESETS.forEach(function (p) {
      if (p.baseMin === cfg.baseMin && p.incSec === cfg.incSec) { match = p.id; }
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

  /** 按钟：整块面板就是那个跷跷板 */
  function handlePress(side) {
    if (!S || S.finished) { return; }
    Sound.unlock();
    // 尚未开表时，按任意一方都由白方开始（白先走），且不计步数
    var target = S.started ? side : 'w';
    var res = E.press(S, target, Date.now());

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

  function togglePause() {
    if (!S || S.finished) { return; }
    Sound.unlock();
    if (!S.started) { handlePress('w'); return; }
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
    $('#overlayTitle').textContent = sideLabel(side) + ' 超时';
    $('#overlaySub').textContent = sideLabel(E.other(side)) + ' 获胜';
    $('#overlayDetail').textContent = E.describeConfig(S.cfg) +
      ' · 共 ' + (S.moves.w + S.moves.b) + ' 步';
    $('#overlay').hidden = false;
  }

  function hideOverlay() { $('#overlay').hidden = true; }

  /** 再来一局 */
  function rematch() {
    newGame();
  }

  function backToSetup() {
    if (S && S.started && !S.finished) {
      if (!window.confirm('返回设置会结束当前对局，确定吗？')) { return; }
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
    if (S.finished) { return S.flagged === side ? '超时' : '获胜'; }
    if (S.paused) { return '暂停'; }
    if (!S.started) { return '待开始'; }
    var byo = (info && info.phase === 'byoyomi');
    if (S.active === side) { return byo ? '读秒中' : '计时中'; }
    return byo ? '待读秒' : '等待';
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

      var foot = '第 ' + S.moves[side] + ' 步';
      if (inByoyomi && !S.finished && S.cfg.byoyomiPeriods > 1) {
        foot += ' · 读秒 ' + info.periodsLeft + '/' + S.cfg.byoyomiPeriods + ' 段';
      }
      moveEls[side].textContent = foot;
      chipEls[side].textContent = chipText(side, info);

      if (running && S.active === side) { byoyomiTick(side, info); }
    });

    $('#screen-clock').classList.toggle('is-paused', !!S.paused);

    var btn = $('#btnToggle');
    btn.disabled = !!S.finished;
    btn.classList.toggle('primary', !S.started || S.paused);
    $('#btnToggleLabel').textContent = S.finished
      ? '已结束'
      : (!S.started ? '开始' : (S.paused ? '继续' : '暂停'));
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
          toast('此浏览器不支持网页全屏；iPhone 可「分享 → 添加到主屏幕」后从主屏图标打开。');
          return;
        }
        var p = req.call(el);
        if (p && p['catch']) {
          p['catch'](function () { toast('全屏被浏览器拒绝，可尝试「添加到主屏幕」方式打开。'); });
        }
      } else {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) { exit.call(document); }
      }
    } catch (e) { toast('无法切换全屏。'); }
  }

  /* ================= 声音开关按钮 ================= */

  function updateSoundButton() {
    var b = $('#btnSound');
    b.textContent = cfg.sound ? '🔊' : '🔇';
    b.setAttribute('aria-pressed', cfg.sound ? 'true' : 'false');
    b.title = cfg.sound ? '关闭声音' : '打开声音';
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
    bindEvents();
    updateSoundButton();
    applyFacing();
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
