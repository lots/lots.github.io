'use strict';
/**
 * 项目完整性检查：
 *  1) index.html 引用的本地资源都存在；
 *  2) 页面不引用任何外部网络资源（保证断网可用 / 可离线托管）；
 *  3) app.js 里用到的每个元素 id 都能在 index.html 中找到（防拼写错误）；
 *  4) app.js / engine.js 语法可编译；
 *  5) 棋钟界面两块面板（白/黑）的关键节点齐全。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const app = read('app.js');
const engine = read('engine.js');

/**
 * 去掉 JS 里的注释（逐字符跟踪「字符串 / 行注释 / 块注释」三种状态）。
 * 不能只用正则：行尾注释（`code(); // 中文注释`）会被误当成字符串内容，
 * 于是「app.js 里不许有写死中文」这条检查会误报。
 */
function stripJsComments(src) {
  let out = '';
  let i = 0;
  let state = null;          // "'" / '"' / '`' / 'line' / 'block'
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'line') { if (c === '\n') { state = null; out += c; } i += 1; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = null; i += 2; } else { i += 1; } continue; }
    if (state === "'" || state === '"' || state === '`') {
      out += c;
      if (c === '\\') { out += n === undefined ? '' : n; i += 2; continue; }
      if (c === state) { state = null; }
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
    if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { state = c; }
    out += c;
    i += 1;
  }
  return out;
}

test('index.html 引用的本地资源都存在', () => {
  const refs = [];
  const re = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) { refs.push(m[1]); }
  const local = refs.filter((r) => !/^(data:|https?:|#|mailto:)/.test(r));
  assert.ok(local.length >= 3, '至少应引用 styles.css / engine.js / app.js');
  local.forEach((r) => {
    const p = path.join(ROOT, r.split('?')[0]);
    assert.ok(fs.existsSync(p), '缺少被引用的文件：' + r);
  });
});

test('不引用任何外部网络资源（断网也能用）', () => {
  const external = html.match(/(?:src|href)\s*=\s*"https?:\/\/[^"]+"/g) || [];
  assert.deepEqual(external, [], 'index.html 不应引用外部 URL：' + external.join(', '));
  assert.ok(!/@import\s+url\(\s*['"]?https?:/.test(css), 'styles.css 不应 @import 外部样式');
  assert.ok(!/fonts\.googleapis|cdn\./.test(html + css + app), '不应依赖任何 CDN');
});

test('app.js 引用的元素 id 在 index.html 中都存在', () => {
  const ids = new Set();
  const re = /\$\$?\(\s*'#([A-Za-z0-9_-]+)/g;
  let m;
  while ((m = re.exec(app)) !== null) { ids.add(m[1]); }
  assert.ok(ids.size > 10, '应能解析出若干 id，实际：' + ids.size);
  ids.forEach((id) => {
    assert.ok(
      new RegExp('id="' + id + '"').test(html),
      'index.html 缺少 app.js 需要的 id：#' + id
    );
  });
});

test('棋钟界面关键节点齐全（白/黑两块面板）', () => {
  ['w', 'b'].forEach((side) => {
    assert.ok(html.includes('class="pane pane-' + side + '" data-side="' + side + '"'), '缺少 ' + side + ' 方面板');
    assert.ok(html.includes('class="time" data-side="' + side + '"'), '缺少 ' + side + ' 方时间显示');
    assert.ok(html.includes('class="side-tag" data-i18n="side.' + side + '"'), '缺少 ' + side + ' 方的「白方/黑方」标签（应带 data-i18n）');
    assert.ok(!html.includes('class="pane-name"'), '姓名输入功能已移除，面板上不该再有姓名节点');
    assert.ok(html.includes('class="moves" data-side="' + side + '"'), '缺少 ' + side + ' 方步数显示');
    assert.ok(html.includes('class="state-chip" data-side="' + side + '"'), '缺少 ' + side + ' 方状态标记');
  });
  ['btnToggle', 'btnSound', 'btnRotate', 'btnFull', 'btnSetup', 'btnStartGame', 'btnRematch', 'btnLang'].forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), '缺少按钮：#' + id);
  });
});

/* ================= 双语（i18n） ================= */

const I18N = require(path.join(ROOT, 'i18n.js'));

test('i18n：中英词条的 key 完全一致（少一个就会露出 key 本身）', () => {
  const zh = Object.keys(I18N.DICT.zh).sort();
  const en = Object.keys(I18N.DICT.en).sort();
  const missingInEn = zh.filter((k) => !(k in I18N.DICT.en));
  const missingInZh = en.filter((k) => !(k in I18N.DICT.zh));
  assert.deepEqual(missingInEn, [], '英文缺少这些词条：' + missingInEn.join(', '));
  assert.deepEqual(missingInZh, [], '中文缺少这些词条：' + missingInZh.join(', '));
  assert.deepEqual(zh, en, '两种语言的 key 集合不一致');
  I18N.LANGS.forEach((l) => { assert.ok(I18N.DICT[l], '缺少语言表：' + l); });
});

test('i18n：页面与 JS 里用到的 key 都存在，且占位符能对上', () => {
  const dicts = [I18N.DICT.zh, I18N.DICT.en];

  // 1) index.html 上的 data-i18n* 标记（先去掉 HTML 注释，注释里举例的 key 不算）
  const htmlCode = html.replace(/<!--[\s\S]*?-->/g, '');
  const used = new Set();
  const reAttr = /data-i18n(?:-html|-title|-aria-label|-alt|-placeholder)?="([^"]+)"/g;
  let m;
  while ((m = reAttr.exec(htmlCode)) !== null) { used.add(m[1]); }

  // 2) app.js 里的 t('key')（先去掉注释，免得注释里举例的 t('key') 被当成调用）
  const appCode = stripJsComments(app);
  const reCall = /\bt\('([a-z][\w]*\.[a-z][\w.]*)'/g;
  while ((m = reCall.exec(appCode)) !== null) { used.add(m[1]); }
  ['fischer', 'delay', 'byoyomi', 'sudden'].forEach((mode) => { used.add('hint.' + mode); });

  // 3) app.js 里 PRESETS 的类别名（预设按钮上显示的那行字）
  const rePreset = /name:\s*'(preset\.[a-z]+)'/g;
  while ((m = rePreset.exec(app)) !== null) { used.add(m[1]); }

  assert.ok(used.size > 40, '解析出的词条太少（' + used.size + '），检查上面的正则是否失效');

  const missing = [];
  dicts.forEach((d, i) => {
    const name = i === 0 ? 'zh' : 'en';
    used.forEach((k) => { if (d[k] === undefined) { missing.push(name + ':' + k); } });
  });
  assert.deepEqual(missing, [], '这些词条缺失：' + missing.join(', '));

  // 占位符必须两种语言一致（否则切换语言会出现 {n} 字样）
  used.forEach((k) => {
    const holders = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');
    assert.equal(holders(I18N.DICT.en[k]), holders(I18N.DICT.zh[k]),
      k + ' 的占位符两种语言不一致：' + I18N.DICT.zh[k] + ' / ' + I18N.DICT.en[k]);
  });
});

test('i18n：语言按钮、脚本顺序与「不许再写死文案」的防线', () => {
  // ENG / 华文 按钮：两个语言各一个可点亮的名字
  assert.ok(/class="lang-btn"[^>]*id="btnLang"/.test(html), '设置页应有 ENG / 华文 语言按钮');
  I18N.LANGS.forEach((l) => {
    assert.ok(html.includes('data-lang-name="' + l + '"'), '语言按钮缺少 ' + l + ' 那一半');
  });
  assert.ok(/data-i18n-aria-label="lang\.button\.aria"/.test(html), '语言按钮缺少无障碍标签');

  // i18n.js 必须在 app.js 之前加载
  const i18nAt = html.indexOf('src="i18n.js"');
  const appAt = html.indexOf('src="app.js"');
  assert.ok(i18nAt > 0 && appAt > i18nAt, 'index.html 里 i18n.js 必须在 app.js 之前');

  // app.js 里除了「i18n 还没加载」时的双语告警，不该再有写死的中文
  const stripped = stripJsComments(app);
  const hard = [];
  const reStr = /'([^'\\]*)'|"([^"\\]*)"/g;
  let m;
  while ((m = reStr.exec(stripped)) !== null) {
    const s = m[1] !== undefined ? m[1] : m[2];
    if (!/[\u4e00-\u9fff]/.test(s)) { continue; }
    // 启动早期（i18n 尚未就绪）用于提示脚本加载失败的整句，允许直接写成双语
    if (/engine\.js|i18n\.js/.test(s)) { continue; }
    hard.push(s.trim());
  }
  assert.deepEqual(hard, [],
    'app.js 里还有写死的中文文案，请挪进 i18n.js 并改用 t(\'key\')：\n  ' + hard.join('\n  '));
});

test('app.js 与 engine.js 语法可编译', () => {
  assert.doesNotThrow(() => { new Function(app); }, 'app.js 存在语法错误');
  assert.doesNotThrow(() => { new Function(engine); }, 'engine.js 存在语法错误');
});

test('页面具备移动端必需的基础设置', () => {
  assert.ok(/<meta\s+name="viewport"[^>]*viewport-fit=cover/.test(html), '缺少适配刘海屏的 viewport');
  assert.ok(/user-scalable=no/.test(html), '应禁止用户缩放，避免误触放大');
  assert.ok(/touch-action:\s*manipulation/.test(css), 'CSS 应设置 touch-action: manipulation 去掉点击延迟');
  assert.ok(/orientation:\s*landscape/.test(css), 'CSS 应处理横屏布局');
  assert.ok(/-webkit-tap-highlight-color/.test(css), 'CSS 应去掉移动端点击高亮');
});

test('对坐模式只旋转竖屏下「对面」那块面板（几何正确性）', () => {
  // 手机平放桌面时，读向正常的是近侧玩家；只有对面那一块的数字需要转 180°。
  // 竖屏布局是上下分屏，对面 = 上方面板 = .panes 的第一个子元素。
  assert.ok(css.includes('@media (orientation: portrait)'), '缺少竖屏专用规则');
  assert.ok(
    css.includes('.facing .pane:first-child .pane-inner { transform: rotate(180deg); }'),
    '竖屏应旋转上方面板'
  );
  // 横屏是左右分屏，两块面板都在同一侧视线上，任何单面板旋转都无法让两人同时读正，
  // 因此横屏不旋转（见 README「摆放方式」）。
  assert.ok(!/rotate\(180deg\)/.test(css.split('@media (orientation: portrait)')[0]), '竖屏规则之外不应出现 180° 旋转');

  // 黑方在前 → 竖屏在上（对面选手）、横屏在左；白方在后 → 竖屏在下（近侧）
  const panes = html.slice(html.indexOf('class="panes"'));
  assert.ok(
    panes.indexOf('pane pane-b') < panes.indexOf('pane pane-w'),
    '黑方面板应排在白方面板之前（竖屏置顶）'
  );
  assert.ok(!/rotate-black/.test(css + app), '已废弃的 rotate-black 类名不应残留');
});

/* ================= 界面主题 ================= */

test('主题：下拉框三项与三套 CSS 变量一一对应（另含首屏防闪脚本）', () => {
  const THEME_KEYS = ['light', 'medium', 'dark'];

  assert.ok(/<select id="themeSelect"/.test(html), '设置页缺少主题下拉框 #themeSelect');
  const opts = [];
  const optRe = /<option value="(\w+)" data-i18n="theme\.(\w+)"/g;
  let m;
  while ((m = optRe.exec(html)) !== null) {
    assert.equal(m[1], m[2], '选项值与词条名应一致：' + m[1] + ' / theme.' + m[2]);
    opts.push(m[1]);
  }
  assert.deepEqual(opts, THEME_KEYS, '主题下拉框应有且仅有 light / medium / dark 三项');

  const listMatch = /var THEMES = \[([^\]]+)\]/.exec(app);
  assert.ok(listMatch, 'app.js 里应有 THEMES 列表');
  const jsKeys = listMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
  assert.deepEqual(jsKeys, THEME_KEYS, 'app.js 的 THEMES 应与下拉框完全一致（含顺序）');

  // 每套主题都要在 styles.css 里落地；浅色/中性必须显式覆盖 --bg，否则切了看不出变化
  THEME_KEYS.forEach((k) => {
    const block = new RegExp(':root\\[data-theme="' + k + '"\\][\\s\\S]*?\\}').exec(css);
    assert.ok(block, 'styles.css 缺少 :root[data-theme="' + k + '"] 变量块');
    if (k !== 'dark') {
      assert.ok(/--bg:\s*#[0-9a-f]{3,8}/i.test(block[0]), '主题 ' + k + ' 必须显式覆盖 --bg');
      assert.ok(/--fg:\s*#[0-9a-f]{3,8}/i.test(block[0]), '主题 ' + k + ' 必须显式覆盖 --fg');
      assert.ok(/--card:\s*#[0-9a-f]{3,8}/i.test(block[0]), '主题 ' + k + ' 必须显式覆盖 --card');
    }
  });

  // 首屏防闪：<head> 里要有「读存档 → 设 data-theme」的内联脚本（在样式表之后）
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(/data-theme/.test(head) && /chessclock\.settings\.v1/.test(head),
    '缺少首屏主题内联脚本（否则选了浅色的人每次打开都会先闪一下深色）');
  assert.ok(head.indexOf('styles.css') < head.indexOf('data-theme'),
    '主题脚本应放在样式表之后');

  // ?theme= 覆盖（截图三个主题时用得上）
  assert.ok(/queryParam\('theme'\)/.test(app), 'app.js 应支持 ?theme= 覆盖');
});

/* ================= 首次打开的默认值 / 围棋预设 ================= */

test('首次打开：英文 + Byoyomi 10+3×20，且围棋预设恰好是那 8 档', () => {
  const defs = /var DEFAULTS = \{([\s\S]*?)\n  \};/.exec(app);
  assert.ok(defs, '找不到 app.js 的 DEFAULTS');
  const d = defs[1];
  assert.ok(/mode:\s*'byoyomi'/.test(d), '默认计时模式应为 Byoyomi');
  assert.ok(/baseMin:\s*10\b/.test(d), '默认基础时间应为 10 分钟');
  assert.ok(/incSec:\s*20\b/.test(d), '默认读秒应为每手 20 秒');
  assert.ok(/periods:\s*3\b/.test(d), '默认读秒段数应为 3');
  assert.ok(/presetId:\s*'10\+3x20'/.test(d), '默认预设应为 10+3×20');
  assert.ok(/lang:\s*'en'/.test(d), '默认语言应为英文');
  assert.ok(!/lang:\s*I18N\.detect\(\)/.test(d),
    '默认语言不应该再跟随浏览器（需求：首次打开固定 ENG）');

  // 围棋预设 = 需求给的那 8 档，顺序也保持
  const block = /var PRESETS_BYOYOMI = \[([\s\S]*?)\n  \];/.exec(app);
  assert.ok(block, '找不到 PRESETS_BYOYOMI');
  const got = [];
  const re = /\{ id:\s*'([^']+)',\s*baseMin:\s*(\d+),\s*incSec:\s*(\d+),\s*periods:\s*(\d+)/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    got.push(m[2] + '+' + m[4] + '×' + m[3]);      // 基础时间 + 段数×每手秒数
  }
  assert.deepEqual(got, [
    '5+3×20', '10+3×20', '10+3×30', '15+3×30',
    '20+5×30', '30+5×30', '30+3×60', '60+5×60'
  ], '围棋预设应恰好是这 8 档（含顺序）');

  // 这组预设只用在 Byoyomi；其它模式仍用国际象棋那组
  assert.ok(/mode === E\.MODES\.BYOYOMI \? PRESETS_BYOYOMI : PRESETS_CHESS/.test(app),
    'presetsFor() 应只把围棋预设用在 Byoyomi 模式');
  assert.ok(/var PRESETS_CHESS = \[/.test(app), '应保留国际象棋那组预设给其它模式');

  // 静态兜底与默认一致：没有 JS / 首屏时不会看到另一套默认值
  assert.ok(/<html lang="en">/.test(html), '静态 HTML 的语言应为英文（默认语言）');
  assert.ok(/id="incSec"[^>]*value="20"/.test(html), '静态 HTML 的读秒输入框应为 20');
  assert.ok(/id="periods"[^>]*value="3"/.test(html), '静态 HTML 的段数输入框应为 3');
  assert.ok(/data-mode="byoyomi"[^>]*aria-pressed="true"/.test(html), '静态 HTML 应默认选中 Byoyomi');
  assert.ok(!/id="periodsField"[^>]*hidden/.test(html), 'Byoyomi 是默认模式，段数字段不该默认隐藏');
});

/* ================= 截图场景（视觉验证台） ================= */

test('截图场景：每个场景显式设模式，且不会写进用户设置', () => {
  const driver = read('tests/visual/build.js');

  // 场景页靠真实交互驱动界面 → 会触发 saveSettings()。
  // 必须把 setItem 打桩，否则谁用普通浏览器打开 _scene-*.html，谁的设置就被改了。
  assert.ok(/localStorage\.setItem = function \(\) \{\}/.test(driver),
    '场景脚本应把 localStorage.setItem 打桩（否则打开 _scene-*.html 会覆盖用户设置）');

  // 每个非 setup 场景都要显式选模式：不能依赖默认值，默认值是会变的
  ['measure', 'midgame', 'byoyomi', 'critical', 'states'].forEach((s) => {
    const re = new RegExp('scene === "' + s + '"[\\s\\S]{0,500}?mode\\("');
    assert.ok(re.test(driver), '场景 ' + s + ' 应显式调用 mode("…")，不要依赖默认模式');
  });

  // 读秒场景的读秒部分应与默认档 10+3×20 一致（20 秒 × 3 段），免得看图的人以为默认是别的
  assert.ok(/setNum\("baseMin", 1\); setNum\("incSec", 20\); setNum\("periods", 3\);/.test(driver),
    'byoyomi 场景的读秒应为 20 秒 × 3 段（与默认档的读秒部分一致）');
});

/* ================= 图标 / logo ================= */

test('logo：原图 → 各尺寸 PNG，每个用途只有一个文件且不用 srcset', () => {
  // 原图（换 logo 就覆盖它，再跑 node tools/export-icons.js）
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'logo-source.png')),
    '缺少原图 assets/logo-source.png');

  // 两处显示位置各引用一个 PNG
  assert.ok(
    /class="brand-logo"[^>]*assets\/logo-brand\.png[^>]*width="96"[^>]*height="96"/.test(html),
    '设置页应引用 assets/logo-brand.png（按 96×96 显示）'
  );
  assert.ok(
    /class="strip-logo"[^>]*assets\/logo-strip\.png[^>]*width="48"[^>]*height="48"/.test(html),
    '棋钟页应引用 assets/logo-strip.png（按 48×48 显示）'
  );

  // ⚠️ 这条是那次「PC 正常、手机没图」事故的回归防线：
  // srcset 一旦出现 2x 候选，手机就只会取 2x 那个文件；手工只换 1x 就会两边不一致。
  assert.ok(!/class="(brand|strip)-logo"[^>]*srcset=/.test(html),
    'logo 不要用 srcset（手机只会取 2x 候选，手换 1x 会「PC 正常、手机没图」）；' +
    '改成单个文件按 3 倍尺寸导出，见 assets/README.md');

  assert.ok(/\.brand-logo\s*\{[^}]*width:\s*96px/.test(css), 'CSS 应把 .brand-logo 固定为 96px');
  assert.ok(/\.strip-logo\s*\{[^}]*width:\s*48px/.test(css), 'CSS 应把 .strip-logo 固定为 48px');

  // PNG 的**像素尺寸**必须和显示尺寸成 3 倍关系（直接读 PNG 头里的 IHDR，别信文件名）
  const pngSize = (file) => {
    const b = fs.readFileSync(path.join(ROOT, 'assets', file));
    assert.equal(b.slice(12, 16).toString('ascii'), 'IHDR', file + ' 不是合法 PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(pngSize('logo-brand.png'), [288, 288],
    'logo-brand.png 应是 288×288（页面显示 96×96 的 3 倍）；换图后请重跑 node tools/export-icons.js');
  assert.deepEqual(pngSize('logo-strip.png'), [144, 144],
    'logo-strip.png 应是 144×144（页面显示 48×48 的 3 倍）；换图后请重跑 node tools/export-icons.js');
});

test('站点图标（favicon / iOS 主屏）都指向 logo 资源，且 PNG 已生成', () => {
  // 标签页图标统一用从原图导出的 PNG（不再挂那个旧版 CoQ 的 SVG）
  assert.ok(!/rel="icon"[^>]*assets\/logo\.svg/.test(html),
    'favicon 不该再指向旧的 logo.svg（那是 CoQ 旧图形，当前图形在 logo-source.png）');
  assert.ok(/rel="icon"[^>]*sizes="32x32"[^>]*assets\/icon-32\.png/.test(html), '缺少 32×32 PNG favicon');
  assert.ok(/rel="apple-touch-icon"[^>]*assets\/icon-180\.png/.test(html), '缺少 iOS 主屏图标');
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'export-icons.js')), '缺少图标导出脚本');
  ['icon-32.png', 'icon-64.png', 'icon-180.png'].forEach((f) => {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'assets', f)),
      '缺少 assets/' + f + '（运行 node tools/export-icons.js 生成）'
    );
  });
});

test('读秒模式在引擎 / 设置项 / 文案 / 时间字段四处都接上了', () => {
  assert.ok(/BYOYOMI:\s*'byoyomi'/.test(engine), 'engine.js 应定义 byoyomi 模式');
  assert.ok(/data-mode="byoyomi"/.test(html), 'index.html 缺少读秒模式按钮');
  assert.ok(/t\('hint\.'\s*\+/.test(app), 'app.js 应按模式取说明（t(\'hint.\' + mode)）');
  assert.ok(/'hint\.byoyomi'/.test(fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8')),
    'i18n.js 缺少读秒说明词条 hint.byoyomi');
  assert.ok(/id="periodsField"/.test(html), 'index.html 缺少读秒段数字段');
  assert.ok(/id="periods"/.test(html), 'index.html 缺少读秒段数输入框');
  assert.ok(/byoyomiMs/.test(app) && /byoyomiPeriods/.test(app), 'app.js 应把读秒参数传给引擎');
  assert.ok(/is-byoyomi/.test(css) && /is-byoyomi/.test(app), '读秒阶段应有独立的显示样式');
});
