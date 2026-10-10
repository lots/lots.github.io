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
    assert.ok(html.includes('class="side-tag"'), '缺少 ' + side + ' 方的「白方/黑方」标签');
    assert.ok(!html.includes('class="pane-name"'), '姓名输入功能已移除，面板上不该再有姓名节点');
    assert.ok(html.includes('class="moves" data-side="' + side + '"'), '缺少 ' + side + ' 方步数显示');
    assert.ok(html.includes('class="state-chip" data-side="' + side + '"'), '缺少 ' + side + ' 方状态标记');
  });
  ['btnToggle', 'btnSound', 'btnRotate', 'btnFull', 'btnSetup', 'btnStartGame', 'btnRematch'].forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), '缺少按钮：#' + id);
  });
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

test('读秒模式在引擎 / 设置项 / 时间字段三处都接上了', () => {
  assert.ok(/BYOYOMI:\s*'byoyomi'/.test(engine), 'engine.js 应定义 byoyomi 模式');
  assert.ok(/data-mode="byoyomi"/.test(html), 'index.html 缺少读秒模式按钮');
  assert.ok(/byoyomi:/.test(app), 'app.js 缺少读秒模式说明');
  assert.ok(/id="periodsField"/.test(html), 'index.html 缺少读秒段数字段');
  assert.ok(/id="periods"/.test(html), 'index.html 缺少读秒段数输入框');
  assert.ok(/byoyomiMs/.test(app) && /byoyomiPeriods/.test(app), 'app.js 应把读秒参数传给引擎');
  assert.ok(/is-byoyomi/.test(css) && /is-byoyomi/.test(app), '读秒阶段应有独立的显示样式');
});
