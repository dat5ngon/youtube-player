# YouTube Player -- Project Instructions

## Overview

YouTube Player is a static web app (HTML/CSS/JS) that plays YouTube videos using the YouTube IFrame Player API and searches via the Invidious API (no API key needed). Playlists are stored in `localStorage` and can be backed up to Google Drive via the SafePlace iframe + postMessage API.

## Architecture

```
index.html   -- video player, search UI, playlist panel, modals, hidden SafePlace iframe
style.css    -- dark theme with YouTube red accents (Outfit + Oswald fonts)
app.js       -- Invidious search, YouTube IFrame playback, playlists, Google Drive sync
```

### Key concepts

- **Invidious API** -- searches YouTube videos via public Invidious instances. No API key required. Falls back to alternate instances on failure.
- **YouTube IFrame Player API** -- embeds and controls video playback. A new `YT.Player` instance is created for each video with the `videoId` in the constructor (YouTube's API now returns error 2 when using `loadVideoById()` on an empty player). Uses native YouTube controls (`controls: 1`) plus custom prev/next and repeat buttons.
- **Playlists** -- stored in `localStorage` under key `video_playlists`. Each playlist has `id`, `name`, `videos[]`, `createdAt`.
- **Google Drive sync** -- uses a hidden iframe embedding `https://dat5ngon.github.io/safe-place/`. Communication via `postMessage` (request/response with unique IDs). No OAuth in the video player itself.
- **No build tools** -- vanilla HTML/CSS/JS. No npm, no bundlers.

### SafePlace postMessage protocol

```js
// Request:  { type: 'safeplace-request', id, action, ...params }
// Response: { type: 'safeplace-response', id, ok, ...data }

// Actions:
//   save  -- { app: 'video-player', filename: 'playlists.json', data: [...] }
//   load  -- { app: 'video-player', filename: 'playlists.json' }
//   ping  -- check if user is authenticated
```

Data is stored on Google Drive at `SafePlace/video-player/playlists.json`.

### Import sources

1. **Google Drive** -- restore playlists from SafePlace backup (merge: add new, update existing by ID)
2. **YouTube URL** -- import by video URL or playlist URL (fetched via Invidious API)

### Export

- **Google Drive** -- backs up all playlists to SafePlace

### Invidious instance fallback

The app maintains a list of public Invidious instances. If a request fails, it rotates to the next instance. The current instance is persisted in `localStorage` under `video_inv_instance`.

## Development

### Local server

```bash
cd youtube-player
python -m http.server 3002 --bind 127.0.0.1
```

Open `http://localhost:3002`.

**Note**: Google Drive sync only works when both apps are on the same origin (`https://dat5ngon.github.io`). YouTube IFrame API works on any origin.

### Deployment

Hosted on GitHub Pages from the `main` branch root.

```bash
git add -A && git commit -m "description" && git push
```

GitHub Pages URL: `https://dat5ngon.github.io/youtube-player/`

### Repository

- **Personal GitHub**: `dat5ngon/youtube-player`
- **Branch**: `main`
- **Related project**: `dat5ngon/safe-place` (provides Google Drive storage API)

## Coding guidelines

1. **No build tools** -- keep it vanilla HTML/CSS/JS.
2. **No frameworks** -- DOM manipulation only.
3. **No OAuth in video player** -- all Google Drive operations go through SafePlace iframe via postMessage.
4. **SafePlace dependency** -- the video player relies on SafePlace's postMessage API. If SafePlace's API changes, update `spRequest()` and the sync functions in `app.js`.
5. **Theme**: dark background (`#0a0a0a`), YouTube red accent (`#ff0000`), Outfit body font, Oswald display font.
6. **Invidious instances** -- keep the instance list updated. Public instances can go offline; check https://api.invidious.io/ for current list.
