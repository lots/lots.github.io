# LotS.github.io

A static portal for small, offline-first tools — mostly for studying weiqi. No framework,
no runtime dependencies, no analytics: one HTML page, one stylesheet, one small script, and
a folder per app.

Live at **https://lots.github.io/** — the GitHub account and the URL stay lowercase (`lots`),
only the visible name is **LotS**.

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
  "title":       { "en": "web-A", "zh": "web-A" },
  "description": { "en": "Two or three lines: what it does, why it is nice.", "zh": "两三句话：它做什么、好在哪。" },
  "url": "/apps/web-a/",
  "icon": "/apps/web-a/assets/icon.png",
  "tags": ["tools"],
  "badges": ["offline"],
  "image": "/assets/apps/web-a-shot.png",
  "imageShape": "landscape",
  "imageAlt": { "en": "…", "zh": "…" }
}
```

3. Run `npm run build`, commit, push.

`slug` must be lowercase letters, digits and dashes; `url` must end in `/`. The build fails
if an icon is missing, a tag or badge is unknown, a slug is duplicated, an image has no
`imageAlt` in both languages, or the folder has no `index.html`.

Available `tags`: `games`, `study`, `tools` (used by the filter bar).
Available `badges`: `offline`, `installable`, `android`, `bilingual`, `desktop`, `windows`.

The first four apps turn on the filter + search toolbar automatically.

### Apps that are not hosted here

A desktop app has no folder to publish. Give it `"external": true` and an absolute https
`url` — the card links out (`target="_blank"`) and the app is left out of `sitemap.xml`:

```json
{
  "slug": "my-sabaki",
  "url": "https://github.com/lots/my-Sabaki/releases/latest",
  "external": true,
  "cta": { "en": "Download for Windows", "zh": "下载 Windows 版" },
  "badges": ["desktop", "windows", "offline"]
}
```

Release binaries belong on GitHub Releases, not in this repo: GitHub caps a single file at
100 MB and a Pages site at 1 GB, and a download is not something Pages serves well.

### Every app gets the same card

All apps render as the same showcase card: screenshot, title, description, badges, an
`Open …` button and a source link. There is no second tier, so nothing has to be "promoted"
to look finished.

- **`image`** is optional but strongly recommended — cards without one fall back to a
  text-only layout. `imageShape` is `portrait` for phone captures (shown tall, no crop) or
  `landscape` for window captures (shown at 8:5, cropped from the top-left).
- Screenshots live in `assets/apps/`, never in the app folder — a refresh of the app build
  then cannot delete them.
- **`cta`** defaults to `Open <title>`; set it when the app needs a better verb.
- **`featured: true`** (one app at most) only controls ordering and the `Featured` badge.

`updated` also feeds `sitemap.xml` (last `<lastmod>` wins for the homepage).

### Featured app

One entry may set `"featured": true`. It is rendered first and carries the `Featured` badge;
everything else about its card is identical.

```json
{
  "featured": true,
  "cta": { "en": "Open the clock", "zh": "打开棋钟" },
  "repo": "https://github.com/lots/ChessClock",
  "updated": "2026-11-15"
}
```

### Where the published copies come from

Each app folder is a copy of a build produced in the app's own repository — never edit it
here, or the next sync will overwrite the change.

| Folder | Built from | Refresh |
| --- | --- | --- |
| `apps/chessclock/` | `lots/ChessClock` (the published file whitelist) | copy the runtime files; its README lists the set |
| `apps/multigo-neo/` | `lots/my-MultiGoNeo` → `npm run dist:web` → `web-portable/` | copy `index.html`, `*.js`, `styles.css`, `themes/`, `embed.*`, `license.html` |
| `apps/sgfmill-ff4/` | `lots/my-sgfmill` → `WebApp/` | copy `index.html`, `styles.css`, `js/`, `standalone.html` |

The portable-only extras (`README.txt`, `Open MultiGo Neo.cmd`, `LICENSE`, the `sgf/` study
folder) are left out: they only make sense on a USB stick. `license.html` stays because the
app's Help menu links to it. For sgfmill the webapp's build tooling (`build_standalone.mjs`,
`package.json`, `node_modules/`, `tests/`, `serve.py`) is left out too — `standalone.html`
is kept so the page's "open the single-file version" fallback is not a dead end.

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
- **Shared origin.** Every app is served from `lots.github.io`, so they share one
  `localStorage`. Namespace keys per app — the clock uses `chessclock.*`, MultiGo Neo uses
  `figdesk.*` — otherwise two apps will fight over the same setting.
- **Cache.** Pages serves with a ~10 minute cache; version changed assets (`?v=<sha>`)
  rather than assuming an instant update.
- **The catalogue is generated.** Don't hand-edit between the `FEATURED`/`GRID`/`TOOLBAR`
  markers in `index.html`; edit `apps.json` and run the build.
