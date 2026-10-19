/**
 * i18n.js — CoQ 棋钟的双语文案表
 * ==================================================================
 * 用法：
 *     var t = window.ChessClockI18N.make('en');   // 或 'zh'
 *     t('clock.pause')                 → "P"（按钮上只写一个字，title / aria-label 用
 *                                        clock.pause.title「Pause」把含义说全）
 *     t('moves.n', { n: 3 })           → "Move 3"
 *
 * 约定：
 *  · key 用点分层级，页面静态文字用 index.html 上的 data-i18n="key" 标记，
 *    JS 里的动态文字走 t('key', vars)；
 *  · 占位符写成 {name}，由 make() 里的 vars 替换；
 *  · 两种语言的 key 必须**完全一致**（tests/project.test.js 会逐个核对），
 *    少一个就会在对应语言下露出 key 本身。
 *
 * 想加第三种语言：在 DICT 里加一份同 key 的表，再把 LANGS 与 index.html 的
 * 语言按钮各加一个即可（其余代码不用动）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (root) { root.ChessClockI18N = api; }
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DICT = {
    /* ================= 中文 ================= */
    zh: {
      'html.lang': 'zh-Hans',
      'app.title': 'CoQ 棋钟',
      'app.subtitle': '国际象棋与围棋通用 · 按实体棋钟习惯设计 · 手机横竖屏通用 · 断网可用',
      'app.description': '可在手机浏览器直接使用的棋类比赛虚拟棋钟（国际象棋 / 围棋）：Fischer 加秒 / Bronstein 延时 / Byoyomi 读秒 / 无加秒，纯本地运行，无需联网。',
      'app.noscript': '本棋钟需要启用 JavaScript 才能运行。',
      'lang.button.aria': '切换界面语言：ENG / 华文',

      // —— 设置页 ——
      'setup.mode.heading': '1. 计时模式',
      'setup.mode.aria': '计时模式',
      'mode.fischer': 'Fischer 加秒',
      'mode.delay': 'Bronstein 延时',
      'mode.byoyomi': 'Byoyomi 读秒',
      'mode.sudden': '无加秒',
      'hint.fischer': 'Fischer 加秒：每走完一步，自己钟上立即加上固定秒数（如 10+5）。国际比赛最常用，推荐。',
      'hint.delay': 'Bronstein 延时：每步开始后的前 N 秒不计时，超过 N 秒才开始扣（适合初学者，不会一慌就掉时间）。',
      'hint.byoyomi': 'Byoyomi 读秒：主时间用完后，每一手重新给固定的 N 秒，用不完不累积。超过读秒额度就算超时；多段读秒（如 30 秒 × 5 段）允许你在几步上超时思考，段数用尽后再超即判负。围棋、将棋、中国象棋常用。',
      'hint.sudden': '无加秒：只有基础时间，走完就没了（突然死亡）。最简单的模式。',

      'setup.time.heading': '2. 时间',
      'setup.base.label': '基础时间（分钟）',
      'inc.fischer': '每步加秒（秒）',
      'inc.delay': '每步延时（秒）',
      'inc.byoyomi': '每步读秒（秒）',
      'inc.sudden': '每步加秒（本模式不使用）',
      'setup.periods.label': '读秒段数（段）',
      'preset.bullet': '子弹',
      'preset.blitz': '超快棋',
      'preset.rapid': '快棋',
      'preset.classical': '慢棋',

      'setup.options.heading': '3. 选项',
      'setup.theme.label': '界面主题',
      'theme.light': '浅色',
      'theme.medium': '中性',
      'theme.dark': '深色',
      'opt.sound': '走子提示音与超时警报',
      'opt.facing': '对坐模式：把对面那一侧的数字转正（竖屏）',
      'opt.wake': '对局中保持屏幕常亮',
      'setup.keys.hint': '电脑上可用键盘当棋钟：<kbd>A</kbd>/<kbd>←</kbd> 白方按键 · <kbd>L</kbd>/<kbd>→</kbd> 黑方按键 · <kbd>空格</kbd> 开始 / 暂停 · <kbd>F</kbd> 全屏',

      'setup.how.heading': '怎么用',
      'how.facing': '<strong>竖屏平放在两位选手之间</strong>（推荐）：下半屏是白方，上半屏是黑方，并且黑方的数字已旋转 180°，坐在对面的选手看到的就是正的。谁走完棋，就用手掌拍一下自己那一侧的整块面板，时间立刻交给对方。<br>点「开始对局」后<strong>没有第二次「开始」</strong>：白先走时由黑方拍自己那一侧 → <strong>白方的钟随即开始走</strong>；此后谁走完棋就拍自己那一侧，<strong>对方的钟立即开始计时</strong>。<br>横屏时左右分屏（黑左白右），适合把手机立起来、或由裁判/观众查看。',
      'how.byoyomi': '<strong>读秒（Byoyomi）</strong>：主时间用完后，每一手重新给固定的秒数（用不完不累积），超了就算输；「30 秒 × 5 段」表示允许你超时思考 4 次，第 5 次才判负。读秒阶段数字转紫色，最后 10 秒每秒有提示音。围棋、将棋、中国象棋常用这种制式。',
      'setup.start': '开始对局',

      // —— 棋钟页 ——
      // 没有「开始」按钮：开局是拍面板（拍对侧那一半 → 自己的钟开始走），
      // 所以这颗按钮只有「暂停 / 继续」两种状态，未开表时整颗隐藏。
      'side.w': '白方',
      'side.b': '黑方',
      'pane.w.aria': '白方按键（走完棋按这里）',
      'pane.b.aria': '黑方按键（走完棋按这里）',
      'strip.aria': '棋钟操作',
      // 按钮上只写一个字（停 / 续），完整含义放在 .title 里给悬停提示与读屏软件用
      'clock.resume': '续',
      'clock.pause': '停',
      'clock.pause.title': '暂停',
      'clock.resume.title': '继续',
      'clock.sound.on': '打开声音',
      'clock.sound.off': '关闭声音',
      'clock.facing.title': '对坐模式开关',
      'clock.swap.title': '交换两侧位置',
      'clock.full.title': '全屏',
      'clock.setup.title': '返回设置',
      'moves.n': '第 {n} 步',
      'foot.byoyomi': '读秒 {left}/{total} 段',
      'chip.flagged': '超时',
      'chip.won': '获胜',
      'chip.paused': '暂停',
      'chip.ready': '待开始',
      'chip.running': '计时中',
      'chip.waiting': '等待',
      'chip.byoyomiRunning': '读秒中',
      'chip.byoyomiWaiting': '待读秒',

      'summary.prefix': '本局用时：',
      'summary.fischer': '{base} 分钟 + 每步 {add} 秒 · Fischer 加秒',
      'summary.delay': '{base} 分钟 + 每步延时 {add} 秒 · Bronstein 延时',
      'summary.byoyomi': '{base} 分钟 + 读秒 {add} 秒{periods} · Byoyomi 读秒',
      'summary.byoyomi.periods': ' × {n} 段',
      'summary.sudden': '{base} 分钟 · 无加秒（突然死亡）',
      'detail.moves': '共 {n} 步',
      'detail.moveOne': '共 1 步',

      'overlay.title': '{side} 超时',
      'overlay.sub': '{side} 获胜',
      'overlay.rematch': '再来一局（交换先后手）',
      'overlay.back': '返回设置',
      'confirm.leave': '返回设置会结束当前对局，确定吗？',

      'toast.engineMissing': 'engine.js 未能加载，请确认文件完整。',
      'toast.fullscreenUnsupported': '此浏览器不支持网页全屏；iPhone 可「分享 → 添加到主屏幕」后从主屏图标打开。',
      'toast.fullscreenDenied': '全屏被浏览器拒绝，可尝试「添加到主屏幕」方式打开。',
      'toast.fullscreenFailed': '无法切换全屏。'
    },

    /* ================= English ================= */
    en: {
      'html.lang': 'en',
      'app.title': 'CoQ Chess & Weiqi Clock',
      'app.subtitle': 'For chess and Weiqi (Go) · modelled on real clocks · portrait & landscape · works offline',
      'app.description': 'A board-game clock that runs in any phone browser — for chess and Weiqi (Go): Fischer increment / Bronstein delay / Byoyomi / sudden death. Fully local, no network needed.',
      'app.noscript': 'This clock needs JavaScript to be enabled.',
      'lang.button.aria': 'Switch interface language: ENG / 华文',

      'setup.mode.heading': '1. Time mode',
      'setup.mode.aria': 'Time mode',
      'mode.fischer': 'Fischer (increment)',
      'mode.delay': 'Bronstein (delay)',
      'mode.byoyomi': 'Byoyomi',
      'mode.sudden': 'Sudden death',
      'hint.fischer': 'Fischer increment: after each move a fixed number of seconds is added to your own clock (e.g. 10+5). The most common system in tournaments — recommended.',
      'hint.delay': 'Bronstein delay: the first N seconds of each move do not tick; only time beyond N is deducted. Forgiving — you never lose time to a panic.',
      'hint.byoyomi': 'Byoyomi: once the main time is used up, every move gets a fresh N seconds (unused time does not carry over). Going past the byoyomi allowance loses. With several periods (e.g. 30s × 5) you may overstep on a few moves — the loss comes when the last period is exhausted. Common in Weiqi (Go), Shogi and Xiangqi.',
      'hint.sudden': 'Sudden death: base time only, no increment. The simplest mode.',

      'setup.time.heading': '2. Time control',
      'setup.base.label': 'Base time (minutes)',
      'inc.fischer': 'Increment (seconds)',
      'inc.delay': 'Delay (seconds)',
      'inc.byoyomi': 'Byoyomi (seconds)',
      'inc.sudden': 'Increment (unused in this mode)',
      'setup.periods.label': 'Byoyomi periods',
      'preset.bullet': 'Bullet',
      'preset.blitz': 'Blitz',
      'preset.rapid': 'Rapid',
      'preset.classical': 'Classical',

      'setup.options.heading': '3. Options',
      'setup.theme.label': 'Colour theme',
      'theme.light': 'Light',
      'theme.medium': 'Medium',
      'theme.dark': 'Dark',
      'opt.sound': 'Move sound and time-up alarm',
      'opt.facing': 'Facing mode: turn the far side’s digits upright (portrait)',
      'opt.wake': 'Keep the screen awake during a game',
      'setup.keys.hint': 'On a computer you can use the keyboard: <kbd>A</kbd>/<kbd>←</kbd> White · <kbd>L</kbd>/<kbd>→</kbd> Black · <kbd>Space</kbd> start / pause · <kbd>F</kbd> fullscreen',

      'setup.how.heading': 'How to use',
      'how.facing': '<strong>Lay the phone flat between the two players</strong> (recommended): the lower half is White, the upper half is Black, and Black’s digits are rotated 180° so the player sitting opposite reads them upright. After your move, tap your own half with your palm — the time passes to the opponent.<br><strong>There is no second "Start"</strong>: after "Start game", the side not to move first (Black, when White opens) taps its own half — and <strong>White’s clock starts</strong>. From then on, whoever has just moved taps their own half and <strong>the opponent’s clock starts running</strong>.<br>In landscape the screen splits left/right (Black left, White right) — handy for propping the phone up or for the arbiter and spectators.',
      'how.byoyomi': '<strong>Byoyomi</strong>: after the main time is gone, every move gets a fresh fixed number of seconds (unused time does not accumulate); overstepping loses. “30s × 5 periods” means you may overthink on four moves and lose on the fifth. During byoyomi the digits turn purple and the last 10 seconds tick audibly. Common in Weiqi (Go), Shogi and Xiangqi.',
      'setup.start': 'Start game',

      // —— clock page ——
      // No Start button: the game starts from a panel tap (tap the far side → your clock runs),
      // so this button only ever says Pause / Resume and stays hidden until the clock is live.
      'side.w': 'White',
      'side.b': 'Black',
      'pane.w.aria': 'White button (tap here after your move)',
      'pane.b.aria': 'Black button (tap here after your move)',
      'strip.aria': 'Clock controls',
      // the button shows one character (P / C); the .title keys spell it out
      'clock.resume': 'C',
      'clock.pause': 'P',
      'clock.pause.title': 'Pause',
      'clock.resume.title': 'Resume',
      'clock.sound.on': 'Turn sound on',
      'clock.sound.off': 'Turn sound off',
      'clock.facing.title': 'Facing mode',
      'clock.swap.title': 'Swap sides',
      'clock.full.title': 'Fullscreen',
      'clock.setup.title': 'Back to setup',
      'moves.n': 'Move {n}',
      'foot.byoyomi': 'Byoyomi {left}/{total}',
      'chip.flagged': 'Time up',
      'chip.won': 'Wins',
      'chip.paused': 'Paused',
      'chip.ready': 'Ready',
      'chip.running': 'Running',
      'chip.waiting': 'Waiting',
      'chip.byoyomiRunning': 'Byoyomi',
      'chip.byoyomiWaiting': 'Byoyomi next',

      'summary.prefix': 'Time control: ',
      'summary.fischer': '{base} min + {add}s per move · Fischer',
      'summary.delay': '{base} min + {add}s delay per move · Bronstein',
      'summary.byoyomi': '{base} min + byoyomi {add}s{periods} · Byoyomi',
      'summary.byoyomi.periods': ' × {n}',
      'summary.sudden': '{base} min · sudden death',
      'detail.moves': '{n} moves',
      'detail.moveOne': '1 move',

      'overlay.title': '{side} time’s up',
      'overlay.sub': '{side} wins',
      'overlay.rematch': 'Rematch (swap colours)',
      'overlay.back': 'Back to setup',
      'confirm.leave': 'Going back to setup ends the current game. Continue?',

      'toast.engineMissing': 'engine.js failed to load — please check that the file is intact.',
      'toast.fullscreenUnsupported': 'This browser does not support page fullscreen; on iPhone use Share → Add to Home Screen and open it from the home screen icon.',
      'toast.fullscreenDenied': 'Fullscreen was refused by the browser; try opening it via Add to Home Screen.',
      'toast.fullscreenFailed': 'Could not switch to fullscreen.'
    }
  };

  var LANGS = ['zh', 'en'];

  /** 把各种写法（zh-CN / zh-Hans / EN / en-US）归一到受支持的语言代码 */
  function normalize(lang) {
    var s = String(lang || '').toLowerCase();
    if (s.indexOf('zh') === 0) { return 'zh'; }
    if (s.indexOf('en') === 0) { return 'en'; }
    return null;
  }

  /** 没存过设置时：跟随浏览器语言，中文环境给中文，其余给英文 */
  function detect() {
    try {
      if (typeof navigator !== 'undefined' && navigator.language) {
        return normalize(navigator.language) || (String(navigator.language).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en');
      }
    } catch (e) { /* 隐私模式等取不到 navigator.language 时给中文 */ }
    return 'zh';
  }

  /** 生成翻译函数：t(key, {vars})；缺词时回退到英文，再回退到 key 本身 */
  function make(lang) {
    var code = normalize(lang) || 'zh';
    var table = DICT[code] || DICT.zh;
    return function (key, vars) {
      var s = table[key];
      if (s === undefined) { s = DICT.en[key]; }
      if (s === undefined) { return key; }
      if (vars) {
        s = s.replace(/\{(\w+)\}/g, function (m, name) {
          return (vars[name] === undefined || vars[name] === null) ? m : String(vars[name]);
        });
      }
      return s;
    };
  }

  return {
    DICT: DICT,
    LANGS: LANGS,
    normalize: normalize,
    detect: detect,
    make: make
  };
}));
