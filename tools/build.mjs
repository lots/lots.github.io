#!/usr/bin/env node
/*
  Build the catalogue blocks from apps.json, write sitemap.xml,
  and assemble the publishable site in _site/.

  node tools/build.mjs           regenerate index.html + _site/
  node tools/build.mjs --check   fail if the committed HTML/sitemap is stale
*/
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SITE_URL = 'https://lots.github.io';
const p = (...parts) => join(ROOT, ...parts);
const read = (file) => readFileSync(p(file), 'utf8');

const TAGS = {
  games: { en: 'Games', zh: '游戏' },
  study: { en: 'Study', zh: '学习' },
  tools: { en: 'Tools', zh: '工具' },
};
const BADGES = {
  offline: { en: 'Works offline', zh: '离线可用' },
  installable: { en: 'Installable', zh: '可安装' },
  android: { en: 'Android build', zh: '安卓版' },
  bilingual: { en: 'Bilingual', zh: '中英双语' },
  desktop: { en: 'Desktop', zh: '桌面端' },
};

const fail = (msg) => { console.error(`build: ${msg}`); process.exit(1); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const both = (en, zh) => `<span class="i18n-en">${en}</span><span class="i18n-zh">${zh}</span>`;

function imageSize(file) {
  const buf = readFileSync(p(file));
  if (buf.slice(1, 4).toString() === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
}

/* ---------------- data ---------------- */
let apps;
try {
  apps = JSON.parse(read('apps.json')).apps;
} catch (err) {
  fail(`apps.json is not valid JSON — ${err.message}`);
}
if (!Array.isArray(apps) || apps.length === 0) fail('apps.json needs at least one app');

const seen = new Set();
for (const app of apps) {
  const where = `apps.json › ${app.slug || '(no slug)'}`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(app.slug || '')) fail(`${where}: slug must be lowercase letters, digits and dashes`);
  if (seen.has(app.slug)) fail(`${where}: duplicate slug`);
  seen.add(app.slug);
  for (const key of ['title', 'description']) {
    if (!app[key] || !app[key].en || !app[key].zh) fail(`${where}: ${key} needs both "en" and "zh"`);
  }
  if (!app.url || !app.url.startsWith('/') || !app.url.endsWith('/')) fail(`${where}: url must be a site path like "/apps/${app.slug}/"`);
  if (!app.icon || !existsSync(p(app.icon.replace(/^\//, '')))) fail(`${where}: icon not found — ${app.icon}`);
  if (app.image && !existsSync(p(app.image.replace(/^\//, '')))) fail(`${where}: image not found — ${app.image}`);
  if (app.image && (!app.imageAlt || !app.imageAlt.en || !app.imageAlt.zh)) fail(`${where}: an image needs imageAlt in both languages`);
  if (app.imageShape && !['portrait', 'landscape'].includes(app.imageShape)) fail(`${where}: imageShape must be "portrait" or "landscape"`);
  (app.tags || []).forEach((t) => { if (!TAGS[t]) fail(`${where}: unknown tag "${t}"`); });
  (app.badges || []).forEach((b) => { if (!BADGES[b]) fail(`${where}: unknown badge "${b}"`); });
  if (app.url !== '/' && !existsSync(p(app.url.replace(/^\//, ''), 'index.html'))) {
    fail(`${where}: no index.html under ${app.url}`);
  }
}
if (apps.filter((a) => a.featured).length > 1) fail('apps.json: only one app can be featured');

const ordered = apps.slice().sort((a, b) => Number(!!b.featured) - Number(!!a.featured));

/* ---------------- markup ---------------- */
const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

function renderApp(app) {
  const shape = app.imageShape === 'portrait' ? 'is-portrait' : 'is-landscape';
  const size = app.image && app.image.toLowerCase().endsWith('.png') ? imageSize(app.image) : null;
  const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
  const cta = app.cta && app.cta.en && app.cta.zh
    ? app.cta
    : { en: `Open ${app.title.en}`, zh: `打开 ${app.title.zh}` };
  const badge = app.featured ? `        <span class="badge">${both('Featured', '精选')}</span>\n` : '';
  const badges = (app.badges || []).map((b) => `          <li>${both(esc(BADGES[b].en), esc(BADGES[b].zh))}</li>`).join('\n');
  const chips = badges ? `        <ul class="chips">\n${badges}\n        </ul>\n` : '';
  const source = app.repo
    ? `\n          <a class="link" href="${esc(app.repo)}">${both('Source on GitHub &rarr;', 'GitHub 源码 &rarr;')}</a>`
    : '';
  const shot = app.image
    ? `\n      <a class="app-shot ${shape}" href="${esc(app.url)}" tabindex="-1" aria-hidden="true">
        <img src="${esc(app.image)}" alt=""${dims} loading="lazy" decoding="async">
      </a>`
    : '';
  return `<article class="app-card js-app${app.image ? '' : ' no-shot'}" data-tags="${esc((app.tags || []).join(' '))}">
      <div class="app-copy">
${badge}        <h3>${both(esc(app.title.en), esc(app.title.zh))}</h3>
        <p>${both(esc(app.description.en), esc(app.description.zh))}</p>
${chips}        <div class="app-actions">
          <a class="btn btn-primary" href="${esc(app.url)}"><img class="btn-app" src="${esc(app.icon)}" alt="" width="20" height="20">${both(esc(cta.en), esc(cta.zh))}${arrow}</a>${source}
        </div>
      </div>${shot}
    </article>`;
}

function renderToolbar() {
  if (apps.length < 4) return '';
  const present = Object.keys(TAGS).filter((t) => apps.some((a) => (a.tags || []).includes(t)));
  const buttons = [['all', { en: 'All', zh: '全部' }], ...present.map((t) => [t, TAGS[t]])]
    .map(([value, label], i) =>
      `          <button type="button" data-filter="${value}" aria-pressed="${i === 0}">${both(esc(label.en), esc(label.zh))}</button>`)
    .join('\n');
  return `      <div class="toolbar" id="filters" role="group" aria-label="Filter apps">
        <div class="filter">
${buttons}
        </div>
        <label class="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="q" type="search" placeholder="Search apps" aria-label="Search apps" autocomplete="off">
        </label>
      </div>`;
}

/* ---------------- index.html blocks ---------------- */
const BLOCKS = {
  TOOLBAR: renderToolbar(),
  APPS: ordered.map(renderApp).join('\n'),
};

function fillBlocks(html) {
  let out = html;
  for (const [name, content] of Object.entries(BLOCKS)) {
    const re = new RegExp(`<!--\\s*${name}:START\\s*-->[\\s\\S]*?<!--\\s*${name}:END\\s*-->`);
    if (!re.test(out)) fail(`index.html is missing the ${name} markers`);
    const body = content ? `<!-- ${name}:START -->\n${content}\n    <!-- ${name}:END -->` : `<!-- ${name}:START -->\n    <!-- ${name}:END -->`;
    out = out.replace(re, body);
  }
  return out;
}

const indexNow = read('index.html');
const indexNext = fillBlocks(indexNow);

/* ---------------- sitemap ---------------- */
const lastmod = apps.map((a) => a.updated).filter(Boolean).sort().pop();
const urls = [
  `  <url>\n    <loc>${SITE_URL}/</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`,
  ...apps.map((a) => `  <url>\n    <loc>${SITE_URL}${a.url}</loc>${a.updated ? `\n    <lastmod>${a.updated}</lastmod>` : ''}\n  </url>`),
].join('\n');
const sitemapNext = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

let sitemapNow = '';
try { sitemapNow = read('sitemap.xml'); } catch (e) { sitemapNow = ''; }

if (CHECK) {
  const problems = [];
  if (indexNow !== indexNext) problems.push('index.html is stale — run: node tools/build.mjs');
  if (sitemapNow !== sitemapNext) problems.push('sitemap.xml is stale — run: node tools/build.mjs');
  if (problems.length) fail(problems.join('\n       '));
  console.log(`build: ok — ${apps.length} app(s), generated blocks are up to date`);
  process.exit(0);
}

writeFileSync(p('index.html'), indexNext);
writeFileSync(p('sitemap.xml'), sitemapNext);

/* ---------------- assemble _site ---------------- */
const OUT = '_site';
rmSync(p(OUT), { recursive: true, force: true });
mkdirSync(p(OUT), { recursive: true });

const PUBLISH = ['index.html', '404.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', '.nojekyll'];
for (const file of PUBLISH) {
  if (!existsSync(p(file))) fail(`missing publishable file: ${file}`);
  cpSync(p(file), p(OUT, file));
}
for (const dir of ['assets', 'apps']) {
  if (!existsSync(p(dir))) fail(`missing publishable folder: ${dir}`);
  cpSync(p(dir), p(OUT, dir), { recursive: true });
}

let bytes = 0;
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else bytes += statSync(full).size;
  }
})(p(OUT));

console.log(`build: wrote index.html, sitemap.xml and _site/ — ${apps.length} app(s), ${(bytes / 1024).toFixed(0)} KB`);
