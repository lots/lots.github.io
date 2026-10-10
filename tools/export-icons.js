#!/usr/bin/env node
'use strict';
/**
 * export-icons.js —— 从唯一原图导出版本所需的各种尺寸
 *
 *     node tools/export-icons.js
 *
 * 原图：assets/logo-source.png（当前是 TARUMT 校徽，447×447，带透明通道）
 *      换 logo = 用新图覆盖它，再跑一次本脚本；也可以直接覆盖下面的成品文件。
 *
 * 产出（**每个用途只有一个文件**，页面里不再用 srcset —— 见文末说明）：
 *
 *   assets/logo-brand.png   设置页标题旁的 logo，288×288（页面按 96×96 显示 → 3 倍）
 *   assets/logo-strip.png   棋钟操作条里的 logo，144×144（页面按 48×48 显示 → 3 倍）
 *   assets/icon-180.png     iOS「添加到主屏幕」图标
 *   assets/icon-64.png      高分屏 favicon
 *   assets/icon-32.png      普通 favicon
 *
 * 为什么不用 srcset：原先写成 `src="…-96.png 1x, …-96@2x.png 2x"` 时，
 * 手机（像素密度 ≥2）只会取 2× 那个文件 —— 手工只换掉 1× 就会「PC 正常、手机没图」。
 * 现在每个用途只有一个文件、且按 3 倍尺寸导出：手机上清晰，PC 上由浏览器顺手缩小，
 * 手换文件也只需要换一个。
 *
 * 用无头 Chrome/Edge 渲染，不需要安装任何依赖；也可用 CHROME_PATH 指定浏览器。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets');
const SOURCE = path.join(OUT_DIR, 'logo-source.png');

const JOBS = [
  { name: 'logo-brand.png', size: 288, note: '设置页显示 96×96' },
  { name: 'logo-strip.png', size: 144, note: '操作条显示 48×48' },
  { name: 'icon-180.png', size: 180, note: 'iOS 主屏' },
  { name: 'icon-64.png', size: 64, note: '高分屏 favicon' },
  { name: 'icon-32.png', size: 32, note: 'favicon' }
];

function findChrome() {
  if (process.env.CHROME_PATH) { return process.env.CHROME_PATH; }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) { return c; }
  }
  return null;
}

function buildHtml(sourceUrl, size) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
    'img{display:block;width:' + size + 'px;height:' + size + 'px}' +
    '</style></head><body><img src="' + sourceUrl + '"></body></html>';
}

function render(chrome, tmpDir, job) {
  const htmlPath = path.join(tmpDir, job.name + '.html');
  const pngPath = path.join(OUT_DIR, job.name);
  const sourceUrl = 'file:///' + SOURCE.replace(/\\/g, '/');
  fs.writeFileSync(htmlPath, buildHtml(sourceUrl, job.size), 'utf8');
  if (fs.existsSync(pngPath)) { fs.unlinkSync(pngPath); }

  const res = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--default-background-color=00000000',
    '--user-data-dir=' + path.join(tmpDir, 'profile-' + job.name),
    '--window-size=' + job.size + ',' + job.size,
    '--force-device-scale-factor=1',
    '--virtual-time-budget=2000',
    '--screenshot=' + pngPath,
    'file:///' + htmlPath.replace(/\\/g, '/')
  ], { stdio: 'ignore' });

  if (res.error) {
    console.error('启动浏览器失败：' + res.error.message);
    process.exit(1);
  }
  const ok = fs.existsSync(pngPath);
  console.log((ok ? 'OK   ' : 'FAIL ') + job.name.padEnd(16) +
    String(job.size + '×' + job.size).padEnd(10) +
    (ok ? fs.statSync(pngPath).size + ' bytes' : '') +
    '   ' + job.note);
  return ok;
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('找不到原图：' + SOURCE);
    console.error('把要用的 logo 存成这个文件名再跑本脚本即可（正方形 PNG，建议 ≥288×288）。');
    process.exit(1);
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error('没找到 Chrome / Edge，可用 CHROME_PATH 指定，例如：');
    console.error('  CHROME_PATH="/usr/bin/chromium" node tools/export-icons.js');
    process.exit(1);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-logos-'));
  let allOk = true;
  JOBS.forEach((job) => { if (!render(chrome, tmpDir, job)) { allOk = false; } });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(allOk ? 0 : 1);
}

main();
