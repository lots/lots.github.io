# lots.github.io

A static portal for small, offline-first web apps. No framework, no runtime dependencies,
no analytics: one HTML page, one stylesheet, one small script, and a folder per app.

Live at **https://lots.github.io/**.

```
.
├── index.html              the portal (catalogue blocks are generated)
├── 404.html                styled not-found page — also catches old clock links
├── styles.css              all styling: two themes, responsive, bilingual
├── app.js                  theme + language toggles, filter, search
├── apps.json               ★ the catalogue: one entry per app
├── apps/
│   └── chessclock/         the CoQ chess & Weiqi clock, served at /apps/chessclock/
├── assets/
│   ├── mark.svg            site mark / favicon
│   └── apps/               card art and screenshots (not app runtime files)
├── tools/
│   ├── build.mjs           apps.json → cards, sitemap.xml, _site/
│   └── serve.mjs           zero-dependency preview server
└── .github/workflows/pages.yml
```

## Add an app

1. Put the app in `apps/<slug>/` — a static folder that works from a subpath
   (`/apps/<slug>/`), with its entry point at `apps/<slug>/index.html`.
2. Add an entry to `apps.json`:

```json
{
  "slug": "web-a",
  "title":    { "en": "web-A", "zh": "web-A" },
  "tagline":  { "en": "One line for the card.", "zh": "卡片上的一句话。" },
  "url": "/apps/web-a/",
  "icon": "/apps/web-a/assets/icon.png",
  "tags": ["tools"],
  "badges": ["offline"]
}
```

3. Run `npm run build`, commit, push.

`slug` must be lowercase letters, digits and dashes; `url` must end in `/`. The build fails
if an icon is missing, a tag or badge is unknown, a slug is duplicated, or the folder has no
`index.html`.

Available `tags`: `games`, `study`, `tools` (used by the filter bar).
Available `badges` (featured app only): `offline`, `installable`, `android`, `bilingual`, `desktop`.

The first four apps turn on the filter + search toolbar automatically.

### Featured app

One entry may set `"featured": true`. It then gets the large card and needs an extra
`description`, a `cta` and (optionally) an `image` + `imageAlt`:

```json
{
  "featured": true,
  "description": { "en": "…", "zh": "…" },
  "cta": { "en": "Open the clock", "zh": "打开棋钟" },
  "image": "/assets/apps/web-a-shot.png",
  "imageAlt": { "en": "…", "zh": "…" },
  "repo": "https://github.com/lots/web-a",
  "updated": "2026-11-15"
}
```

`updated` also feeds `sitemap.xml` (last `<lastmod>` wins for the homepage).

## Local preview

```bash
npm start          # build, then serve _site/ on http://localhost:4173/
npm run build      # regenerate index.html + sitemap.xml + _site/
npm run check      # fail if the committed HTML is stale (what CI runs first)
```

Open the preview at **http://localhost:4173/** — not `file://`, because all site paths are
root-absolute (`/apps/...`).

## Deploy

`.github/workflows/pages.yml` publishes `_site/` on every push to `main`:

1. `node tools/build.mjs --check` — fails if `index.html` or `sitemap.xml` wasn't rebuilt.
2. `node tools/build.mjs` — regenerates and assembles `_site/` (only publishable files;
   `tools/`, `apps.json`, this README and the workflow never reach the web).
3. `upload-pages-artifact` + `deploy-pages`.

**One-time switch from the old branch build:**

```bash
gh api -X PUT repos/lots/lots.github.io/pages -f build_type=workflow
```

(or Settings → Pages → Source: GitHub Actions). After that, pushes to `main` deploy.
Rolling back is `git revert` + push, or re-running the workflow on an earlier commit.

## House rules

- **Subpath safe.** Apps live under `/apps/<slug>/`: use relative asset URLs, or
  `<base href="/apps/<slug>/">` / Vite `base`. History-routing SPAs need a 404 fallback —
  GitHub Pages serves one site-wide `404.html` and cannot rewrite per app.
- **No Jekyll.** `.nojekyll` is published, so files beginning with `_` are served.
- **Cache.** Pages serves with a ~10 minute cache; version changed assets (`?v=<sha>`)
  rather than assuming an instant update.
- **The catalogue is generated.** Don't hand-edit between the `FEATURED`/`GRID`/`TOOLBAR`
  markers in `index.html`; edit `apps.json` and run the build.
