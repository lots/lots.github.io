/*!
 * engine.js — CoQ 棋钟「计时引擎」
 *
 * 设计原则：
 *  1) 纯逻辑，不依赖 DOM；
 *  2) 不自己读取系统时间，所有函数都要求调用方注入 now（毫秒时间戳），
 *     因此可以在 Node 里以任意时间步进做单元测试；
 *  3) 时间只在「按键换手 / 暂停」的瞬间结算，倒计时永远由
 *        剩余 = 已入账时间 - (now - 本手开始时刻)
 *     实时算出。这样即使网页被切到后台、定时器被浏览器限流甚至冻结，
 *     回到前台后剩余时间与超时判定依然完全正确（不会白送时间）。
 *
 * 读秒（Byoyomi）模型：
 *  读秒不是状态机，而是一条连续的「窗口」：
 *    主时间余额 > 0                    → 还在主时间阶段；
 *    主时间用完后，每 X 秒一个窗口，窗口重置 = 消耗一段；
 *    已消耗段数 = floor(读秒已用时间 / X)；
 *    已消耗段数 ≥ 本局拥有的段数        → 判负。
 *  于是「5 段 × 30 秒 = 可以超时思考 4 次，第 5 次判负」「每步重新满格」
 *  都是同一行算术的自然结果，也便于写测试。
 *
 * 兼容：浏览器挂到 window.ChessClockEngine；Node 通过 module.exports 引入。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.ChessClockEngine = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 计时模式 */
  var MODES = {
    FISCHER: 'fischer', // 费舍尔加秒：每走完一步，立即给自己加上固定秒数
    DELAY: 'delay',     // 布朗斯坦延时：每步开始后的前 N 秒不计时
    BYOYOMI: 'byoyomi', // 读秒：主时间用完后，每一手重新给固定的 X 秒（可多段）
    SUDDEN: 'sudden'    // 无加秒（突然死亡）
  };

  var MODE_LABELS = {
    fischer: 'Fischer 加秒',
    delay: 'Bronstein 延时',
    byoyomi: 'Byoyomi 读秒',
    sudden: '无加秒（突然死亡）'
  };

  var LOW_TIME_MS = 60000;      // 低于 1 分钟：黄色警示
  var CRITICAL_TIME_MS = 20000; // 低于 20 秒：红色警示 + 显示十分之一秒
  var MIN_PRESS_GAP_MS = 40;    // 防止同一次触摸被重复投递（人手不可能 40ms 内完成两步）

  var SIDES = ['w', 'b'];
  var MIN_BASE_MS = 1000;
  var MAX_BASE_MS = 6 * 60 * 60 * 1000; // 6 小时上限
  var MAX_ADD_MS = 180 * 1000;          // 单步加/延时/读秒上限 180 秒
  var MIN_BYOYOMI_MS = 1000;            // 读秒至少 1 秒（0 秒读秒等同于突然死亡）
  var MAX_PERIODS = 20;                 // 读秒段数上限

  function other(side) { return side === 'w' ? 'b' : 'w'; }

  function clampInt(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) { n = fallback; }
    n = Math.round(n);
    if (n < min) { n = min; }
    if (n > max) { n = max; }
    return n;
  }

  /** 取第一个「有给值」的字段（null / undefined 视为没给） */
  function firstNumber() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] != null) { return arguments[i]; }
    }
    return null;
  }

  /** 规范化配置，保证引擎内部数值始终合法 */
  function normalizeConfig(config) {
    config = config || {};
    var mode = MODES.FISCHER;
    if (config.mode === MODES.DELAY || config.mode === MODES.SUDDEN ||
        config.mode === MODES.FISCHER || config.mode === MODES.BYOYOMI) {
      mode = config.mode;
    }
    var baseMs = clampInt(config.baseMs, MIN_BASE_MS, MAX_BASE_MS, 5 * 60000);

    // 按模式优先取对应的字段：这样把「已归一化的配置」再传进来也是幂等的
    // （归一化后的 byoyomi 配置里 incMs 恒为 0，若先看 incMs 会把读秒读成 0）
    var rawAdd;
    if (mode === MODES.BYOYOMI) {
      rawAdd = firstNumber(config.byoyomiMs, config.incMs, config.delayMs);
    } else if (mode === MODES.DELAY) {
      rawAdd = firstNumber(config.delayMs, config.incMs, config.byoyomiMs);
    } else {
      rawAdd = firstNumber(config.incMs, config.byoyomiMs, config.delayMs);
    }
    var addMs = clampInt(rawAdd, 0, MAX_ADD_MS, 0);

    var rawPeriods = config.byoyomiPeriods != null ? config.byoyomiPeriods : config.periods;
    var periods = clampInt(rawPeriods, 1, MAX_PERIODS, 1);

    return {
      mode: mode,
      baseMs: baseMs,
      incMs: mode === MODES.FISCHER ? addMs : 0,
      delayMs: mode === MODES.DELAY ? addMs : 0,
      byoyomiMs: mode === MODES.BYOYOMI ? Math.max(MIN_BYOYOMI_MS, addMs) : 0,
      byoyomiPeriods: mode === MODES.BYOYOMI ? periods : 1
    };
  }

  /** 建立一局新棋（未启动状态，等待第一次 start/press） */
  function newGame(config) {
    var cfg = normalizeConfig(config);
    return {
      cfg: cfg,
      ms: { w: cfg.baseMs, b: cfg.baseMs }, // 已入账的主时间（不含当前这一手正在流逝的部分）
      periods: { w: cfg.byoyomiPeriods, b: cfg.byoyomiPeriods }, // 剩余读秒段数
      active: null,      // 'w' | 'b' | null
      running: false,    // 该走的这一方是否正在倒计时
      paused: false,     // 是否被暂停（暂停时不计时）
      started: false,    // 是否已经开表
      turnStart: 0,      // 当前这一手开始计时的时刻
      moves: { w: 0, b: 0 },
      flagged: null,     // 超时的一方
      finished: false,
      lastPressAt: -Infinity
    };
  }

  /** 当前这一手已经「消耗」掉多少毫秒（延时模式下先白送 delayMs） */
  function elapsedCharged(state, now) {
    var raw = Math.max(0, now - state.turnStart);
    var delay = state.cfg.mode === MODES.DELAY ? state.cfg.delayMs : 0;
    if (delay > 0) { raw = Math.max(0, raw - delay); }
    return raw;
  }

  /**
   * 某一方此刻的主时间余额（毫秒）。
   * 只有「正在走棋的一方」才会实时递减；读秒阶段该项恒为 0（读秒另见 readout）。
   */
  function remainingMs(state, side, now) {
    if (typeof now !== 'number') { now = Date.now(); }
    if (state.finished) { return Math.max(0, state.ms[side]); }
    if (state.running && !state.paused && state.active === side) {
      return Math.max(0, state.ms[side] - elapsedCharged(state, now));
    }
    return Math.max(0, state.ms[side]);
  }

  /** 双方主时间之和（便于测试/统计） */
  function totalRemainingMs(state, now) {
    return remainingMs(state, 'w', now) + remainingMs(state, 'b', now);
  }

  /**
   * 读秒阶段的实时状态（仅 byoyomi 模式有意义）：
   *   phase        'main' 主时间阶段 / 'byoyomi' 读秒阶段
   *   ms           界面该显示的毫秒数（读秒阶段 = 当前窗口剩余）
   *   periodsLeft  剩余段数（0 = 已用尽，再超即判负）
   *   windowIndex  已经重置了几个窗口（= 本手已消耗的段数），用于每秒提示音去重
   */
  function byoyomiState(state, side, now) {
    var cfg = state.cfg;
    var x = cfg.byoyomiMs;
    var periods = state.periods[side];

    if (state.finished && state.flagged === side) {
      return { phase: 'byoyomi', ms: 0, periodsLeft: 0, windowIndex: 0 };
    }

    var live = state.running && !state.paused && state.active === side;
    if (!live) {
      if (state.ms[side] > 0) {
        return { phase: 'main', ms: state.ms[side], periodsLeft: periods, windowIndex: 0 };
      }
      // 主时间已经没了，钟上预备好一格完整的读秒
      return { phase: 'byoyomi', ms: x, periodsLeft: periods, windowIndex: 0 };
    }

    var elapsed = Math.max(0, now - state.turnStart);
    var mainLeft = Math.max(0, state.ms[side] - elapsed);
    if (mainLeft > 0) {
      return { phase: 'main', ms: mainLeft, periodsLeft: periods, windowIndex: 0 };
    }

    var byo = Math.max(0, elapsed - state.ms[side]);
    var overruns = x > 0 ? Math.floor(byo / x) : 0;
    var inWindow = x > 0 ? byo - overruns * x : 0;
    return {
      phase: 'byoyomi',
      ms: Math.max(0, x - inWindow),
      periodsLeft: Math.max(0, periods - overruns),
      windowIndex: overruns
    };
  }

  /** 界面统一入口：不管什么模式，都返回 { phase, ms, periodsLeft, windowIndex } */
  function readout(state, side, now) {
    if (typeof now !== 'number') { now = Date.now(); }
    if (state.cfg.mode === MODES.BYOYOMI) { return byoyomiState(state, side, now); }
    return {
      phase: 'main',
      ms: remainingMs(state, side, now),
      periodsLeft: null,
      windowIndex: 0
    };
  }

  /** 开表：默认白方先走 */
  function start(state, now, side) {
    if (state.finished) { return { type: 'ignored', reason: 'finished' }; }
    if (state.started) { return { type: 'ignored', reason: 'already-started' }; }
    if (typeof now !== 'number') { now = Date.now(); }
    state.started = true;
    state.running = true;
    state.paused = false;
    state.active = (side === 'b') ? 'b' : 'w';
    state.turnStart = now;
    return { type: 'start', side: state.active };
  }

  /** 这一手是否已经用光时间（读秒模式看段数，其它模式看主时间） */
  function isOutOfTime(state, side, now) {
    if (state.cfg.mode === MODES.BYOYOMI) {
      var info = byoyomiState(state, side, now);
      return info.phase === 'byoyomi' && info.periodsLeft <= 0;
    }
    return remainingMs(state, side, now) <= 0;
  }

  /** 结算读秒：把这一手跨过的读秒段数扣掉，主时间扣到 0 */
  function commitByoyomi(state, side, now, consumePeriods) {
    var cfg = state.cfg;
    var elapsed = Math.max(0, now - state.turnStart);
    var overrunMs = Math.max(0, elapsed - state.ms[side]);
    var overruns = cfg.byoyomiMs > 0 ? Math.floor(overrunMs / cfg.byoyomiMs) : 0;
    if (consumePeriods && overruns > 0) {
      state.periods[side] = Math.max(0, state.periods[side] - overruns);
    }
    state.ms[side] = Math.max(0, state.ms[side] - elapsed);
    return { overruns: overruns };
  }

  /**
   * 按下某一方的按键（走完一步）。
   * 返回 { type: 'move' | 'start' | 'flag' | 'ignored', ... }
   */
  function press(state, side, now) {
    if (typeof now !== 'number') { now = Date.now(); }
    if (side !== 'w' && side !== 'b') { return { type: 'ignored', reason: 'bad-side' }; }
    if (state.finished) { return { type: 'ignored', reason: 'finished' }; }
    if (state.paused) { return { type: 'ignored', reason: 'paused' }; }

    // 尚未开表：按任意一方都视为「开表」，由调用方决定从哪一方开始
    if (!state.started) { return start(state, now, side); }

    if (!state.running) { return { type: 'ignored', reason: 'not-running' }; }
    // 按在「不是自己」的一侧：实体棋钟上跷跷板已经压在对侧，什么都不会发生
    if (state.active !== side) { return { type: 'ignored', reason: 'not-active' }; }
    if (now - state.lastPressAt < MIN_PRESS_GAP_MS) { return { type: 'ignored', reason: 'debounced' }; }

    // 先判超时：读秒段数用尽 / 主时间归零
    if (isOutOfTime(state, side, now)) {
      return { type: 'flag', side: checkFlag(state, now) };
    }

    state.lastPressAt = now;
    if (state.cfg.mode === MODES.BYOYOMI) {
      commitByoyomi(state, side, now, true); // 超时思考过的段数要扣掉
    } else {
      var remain = remainingMs(state, side, now);
      state.ms[side] = remain + (state.cfg.mode === MODES.FISCHER ? state.cfg.incMs : 0);
    }
    state.moves[side] += 1;
    state.active = other(side);
    state.turnStart = now;
    return {
      type: 'move',
      side: side,
      remainingMs: state.ms[side],
      periodsLeft: state.periods[side],
      active: state.active,
      moves: state.moves[side]
    };
  }

  /** 暂停：把正在流逝的时间先入账，之后再恢复不会丢时间也不会多走 */
  function pause(state, now) {
    if (typeof now !== 'number') { now = Date.now(); }
    if (state.finished) { return { type: 'ignored', reason: 'finished' }; }
    if (!state.started) { return { type: 'ignored', reason: 'not-started' }; }
    if (state.paused || !state.running) { return { type: 'ignored', reason: 'not-running' }; }

    var side = state.active;
    if (state.cfg.mode === MODES.BYOYOMI) {
      // 暂停期间不让选手白丢读秒段：已跨过的段数照扣，恢复后当前窗口重新开始
      commitByoyomi(state, side, now, true);
    } else {
      state.ms[side] = remainingMs(state, side, now);
    }
    state.running = false;
    state.paused = true;
    return { type: 'pause', side: side, remainingMs: state.ms[side] };
  }

  function resume(state, now) {
    if (typeof now !== 'number') { now = Date.now(); }
    if (state.finished) { return { type: 'ignored', reason: 'finished' }; }
    if (!state.paused) { return { type: 'ignored', reason: 'not-paused' }; }
    state.paused = false;
    state.running = true;
    state.turnStart = now;
    return { type: 'resume', side: state.active };
  }

  /**
   * 判定超时。返回超时的一方（'w' / 'b'）或 null。
   * 因为时间由 wall-clock 推算，即使页面被挂起很久，回到前台调用一次即可得到正确结果。
   */
  function checkFlag(state, now) {
    if (typeof now !== 'number') { now = Date.now(); }
    if (!state.running || state.paused || state.finished) { return null; }
    var side = state.active;
    if (!isOutOfTime(state, side, now)) { return null; }

    state.ms[side] = 0;
    if (state.cfg.mode === MODES.BYOYOMI) { state.periods[side] = 0; }
    state.running = false;
    state.finished = true;
    state.flagged = side;
    return side;
  }

  /** 供界面显示用的毫秒数（读秒模式下返回当前窗口剩余） */
  function displayMs(state, side, now) {
    return readout(state, side, now).ms;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /**
   * 时间格式化，模仿实体棋钟的显示习惯：
   *   ≥ 1 小时 → H:MM:SS
   *   < 1 小时 → M:SS
   *   < 20 秒  → SS.d（十分之一秒）
   * 采用「向上取整」，与实体钟一致：剩 5:00.0 时显示 5:00，走掉 0.1 秒后显示 4:59。
   */
  function formatTime(ms) {
    if (!isFinite(ms) || ms < 0) { ms = 0; }
    if (ms < CRITICAL_TIME_MS) {
      return (Math.ceil(ms / 100) / 10).toFixed(1);
    }
    var totalSec = Math.ceil(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) { return h + ':' + pad2(m) + ':' + pad2(s); }
    return m + ':' + pad2(s);
  }

  function secs(ms) {
    var s = ms / 1000;
    return (s % 1 === 0 ? String(s) : s.toFixed(1));
  }

  /** 把配置描述成一句人话，例如「10 分钟 + 每步 5 秒 · Fischer 加秒」 */
  function describeConfig(config) {
    var cfg = normalizeConfig(config);
    var mins = cfg.baseMs / 60000;
    var base = (mins % 1 === 0 ? String(mins) : mins.toFixed(1)) + ' 分钟';

    if (cfg.mode === MODES.BYOYOMI) {
      var byo = ' + 读秒 ' + secs(cfg.byoyomiMs) + ' 秒';
      if (cfg.byoyomiPeriods > 1) { byo += ' × ' + cfg.byoyomiPeriods + ' 段'; }
      return base + byo + ' · ' + MODE_LABELS[cfg.mode];
    }
    var add = cfg.mode === MODES.FISCHER ? cfg.incMs : cfg.delayMs;
    var addText = add > 0 ? ' + 每步 ' + secs(add) + ' 秒' : '';
    return base + addText + ' · ' + MODE_LABELS[cfg.mode];
  }

  return {
    MODES: MODES,
    MODE_LABELS: MODE_LABELS,
    SIDES: SIDES,
    LOW_TIME_MS: LOW_TIME_MS,
    CRITICAL_TIME_MS: CRITICAL_TIME_MS,
    MIN_PRESS_GAP_MS: MIN_PRESS_GAP_MS,
    MIN_BASE_MS: MIN_BASE_MS,
    MAX_BASE_MS: MAX_BASE_MS,
    MAX_ADD_MS: MAX_ADD_MS,
    MIN_BYOYOMI_MS: MIN_BYOYOMI_MS,
    MAX_PERIODS: MAX_PERIODS,
    other: other,
    normalizeConfig: normalizeConfig,
    newGame: newGame,
    start: start,
    press: press,
    pause: pause,
    resume: resume,
    checkFlag: checkFlag,
    remainingMs: remainingMs,
    totalRemainingMs: totalRemainingMs,
    byoyomiState: byoyomiState,
    readout: readout,
    displayMs: displayMs,
    isOutOfTime: isOutOfTime,
    formatTime: formatTime,
    describeConfig: describeConfig
  };
});
