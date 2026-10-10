'use strict';
/**
 * 可视化验证台：把 index.html 复制一份并注入「自动操作脚本」，
 * 交给无头 Chrome 用 --screenshot 截图，用来检查真实浏览器里的渲染与交互。
 *
 *   node tests/visual/build.js          # 生成 out/*.html
 *   （随后用 tests/visual/shoot.ps1 调用 Chrome 截图）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');

/** 注入到页面里的自动操作脚本（在 app.js 初始化完成后再执行） */
function driver() {
  return [
    '(function () {',
    '  function $(sel) { return document.querySelector(sel); }',
    '  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }',
    '  function setNum(id, value) {',
    '    var el = document.getElementById(id);',
    '    el.value = String(value);',
    '    el.dispatchEvent(new Event("input", { bubbles: true }));',
    '    el.dispatchEvent(new Event("change", { bubbles: true }));',
    '  }',
    '  function press(side) {',
    '    var pane = document.querySelector(\'.pane[data-side="\' + side + \'"]\');',
    '    pane.dispatchEvent(new PointerEvent("pointerdown", {',
    '      bubbles: true, cancelable: true, pointerType: "mouse", button: 0, isPrimary: true',
    '    }));',
    '  }',
    '  function mode(m) { document.querySelector(\'#modeGroup .seg[data-mode="\' + m + \'"]\').click(); }',
    '  function beginClock() { document.getElementById("btnStartGame").click(); }',
    '  function start() { document.getElementById("btnToggle").click(); }',
    '',
    '  window.addEventListener("load", function () {',
    '    var q = new URLSearchParams(location.search);',
    '    var scene = q.get("scene") || "midgame";',
    '    var vw = parseInt(q.get("w") || "390", 10);',
    '    var vh = parseInt(q.get("h") || "844", 10);',
    '    // 无头 Chrome 的 --window-size 并不改变布局视口，这里把页面钉成精确的设备尺寸，',
    '    // 保证面板宽高与真实手机一致（字号自适应才会算得准）。',
    '    var st = document.createElement("style");',
    '    st.textContent = "html,body{width:" + vw + "px !important;height:" + vh + "px !important;overflow:hidden}"',
    '      + ".screen{position:absolute !important;left:0 !important;top:0 !important;right:auto !important;"',
    '      + "bottom:auto !important;width:" + vw + "px !important;height:" + vh + "px !important}"',
    '      + ".overlay{position:absolute !important;width:" + vw + "px;height:" + vh + "px}";',
    '    document.head.appendChild(st);',
    '    var run = Promise.resolve();',
    '',
    '    if (scene === "measure") {',
    '      run = (function () {',
    '        setNum("baseMin", 3); setNum("incSec", 2);',
    '        beginClock(); start();',
    '        return wait(500).then(function(){ press("w"); })',
    '          .then(function(){ return wait(200); })',
    '          .then(function(){',
    '            var pane = document.querySelector(\'.pane[data-side="w"]\');',
    '            var t = document.querySelector(\'.time[data-side="w"]\');',
    '            var cs = getComputedStyle(t);',
    '            var pr = pane.getBoundingClientRect();',
    '            var tr = t.getBoundingClientRect();',
    '            var info = {',
    '              innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio,',
    '              pane: [Math.round(pr.left), Math.round(pr.width), Math.round(pr.height)],',
    '              paneClientW: pane.clientWidth, paneClientH: pane.clientHeight,',
    '              text: t.textContent, fontSize: cs.fontSize,',
    '              fontFamily: cs.fontFamily.slice(0, 40),',
    '              textRect: [Math.round(tr.left), Math.round(tr.width)],',
    '              bodyScrollW: document.body.scrollWidth',
    '            };',
    '            var box = document.createElement("pre");',
    '            box.style.cssText = "position:fixed;left:0;top:0;right:0;z-index:999;background:#fff;color:#000;'
      + 'font:12px/1.5 monospace;padding:8px;margin:0;white-space:pre-wrap;word-break:break-all";',
    '            box.textContent = JSON.stringify(info, null, 1);',
    '            document.body.appendChild(box);',
    '          });',
    '      })();',
    '    }',
    '',
    '    if (scene === "setup") { return; }',
    '',
    '    if (scene === "midgame") {',
    '      run = (function () {',
    '        setNum("baseMin", 3); setNum("incSec", 2);',
    '        beginClock(); start();',
    '        return wait(1400).then(function(){ press("w"); })',
    '          .then(function(){ return wait(1100); }).then(function(){ press("b"); })',
    '          .then(function(){ return wait(1600); }).then(function(){ press("w"); })',
    '          .then(function(){ return wait(700); });',
    '      })();',
    '    }',
    '',
    '    if (scene === "byoyomi") {',
    '      run = (function () {',
    '        mode("byoyomi");',
    '        setNum("baseMin", 1); setNum("incSec", 30); setNum("periods", 3);',
    '        beginClock(); start();',
    '        // 主时间 60 秒用尽后进入读秒，并已跨过 1 段（剩 2/3 段）',
    '        return wait(95000);',
    '      })();',
    '    }',
    '',
    '    if (scene === "critical" || scene === "flag") {',
    '      var budget = (scene === "flag") ? 64000 : 50000;',
    '      run = (function () {',
    '        mode("sudden");',
    '        setNum("baseMin", 1); setNum("incSec", 0);',
    '        beginClock(); start();',
    '        return wait(budget).then(function(){',
    '          if (scene === "critical") { press("w"); return wait(2000); }',
    '          return wait(1000);',
    '        });',
    '      })();',
    '    }',
    '',
    '    if (scene === "states") {',
    '      run = (function () {',
    '        beginClock();',
    '        return wait(50).then(function () {',
    '          var w = document.querySelector(\'.pane[data-side="w"]\');',
    '          var b = document.querySelector(\'.pane[data-side="b"]\');',
    '          document.querySelector(\'.time[data-side="w"]\').textContent = "0:47";',
    '          document.querySelector(\'.time[data-side="b"]\').textContent = "12.6";',
    '          document.querySelector(\'.state-chip[data-side="w"]\').textContent = "计时中";',
    '          document.querySelector(\'.state-chip[data-side="b"]\').textContent = "等待";',
    '          w.classList.add("is-active", "is-low");',
    '          b.classList.add("is-critical");',
    '        });',
    '      })();',
    '    }',
    '',
    '    run.then(function () { document.title = "READY"; });',
    '  });',
    '})();'
  ].join('\n');
}

const SCENES = ['setup', 'midgame', 'byoyomi', 'critical', 'states', 'flag', 'measure'];

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  SCENES.forEach((scene) => {
    // 场景页直接生成在项目根目录：styles.css / app.js 等相对路径与 index.html 完全一致，
    // 避免因目录层级不同而漏加载资源（截图时必须看到和真实页面一样的样式）。
    const injected = html.replace('</body>', () => '<script>\n' + driver() + '\n</script>\n</body>');
    fs.writeFileSync(path.join(ROOT, '_scene-' + scene + '.html'), injected, 'utf8');
  });
  console.log('已生成：' + SCENES.map((s) => 'scene-' + s + '.html').join(', ') + ' → ' + OUT);
}

main();
