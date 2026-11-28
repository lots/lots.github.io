# Toolbar icon assets

Each `.svg` file here is the source for one toolbar icon. The app loads an
inline sprite generated from these files, so editing a file here is the way
to change an icon.

After editing, rebuild the sprite:

```powershell
npm run icons:build
```

Then rebuild/reload the app. The file name becomes the sprite id: `new.svg`
→ `#i-new`. Keep the `viewBox` (normally `0 0 24 24`) and use
`currentColor` for fills/strokes so the icon follows the toolbar text colour.

Files currently in use: new, open, save, undo, redo, first, rewind, prev,
next, forward, last, autoplay, pause, delete, setup, black, white, erase.
