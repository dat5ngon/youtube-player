# YouTube Player

A browser-based video player that searches and plays YouTube videos using the [Invidious API](https://docs.invidious.io/) (no API key needed) and the [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference). Manage playlists with Google Drive backup.

## Features

- **Search** -- find YouTube videos by keyword, channel, or topic via Invidious API
- **Play** -- stream videos with YouTube native controls plus custom prev/next and repeat
- **Playlists** -- create, rename, delete, and manage playlists (stored in localStorage)
- **Grid / List view** -- toggle between grid and list layout for playlists
- **Import from YouTube** -- import videos by URL or entire YouTube playlists
- **Google Drive backup** -- export/import playlists to Google Drive via [SafePlace](https://dat5ngon.github.io/safe-place/) (hidden iframe + postMessage)
- **Keyboard shortcuts** -- Space to play/pause, Ctrl+Arrow to skip videos
- **Repeat modes** -- off, repeat all, repeat one
- **Sort options** -- relevance, date, views
- **Instance fallback** -- automatically rotates Invidious instances on failure
- **Responsive** -- works on desktop and mobile

## Usage

Open `index.html` in any modern browser. No build step, no server required.

**Google Drive sync**: Sign in at [Safe Place](https://dat5ngon.github.io/safe-place/) first, then use the Export/Import buttons to backup or restore playlists.

Live: [https://dat5ngon.github.io/youtube-player/](https://dat5ngon.github.io/youtube-player/)

## Files

| File | Purpose |
|------|---------|
| `index.html` | App structure -- player, panels, modals, hidden SafePlace iframe |
| `style.css` | Dark theme styling (Outfit + Oswald fonts, YouTube red accents) |
| `app.js` | Invidious search, YouTube IFrame playback, playlists, Google Drive sync |
| `CLAUDE.md` | AI assistant project instructions |

## How it works

1. **Search**: Queries the Invidious API (a privacy-friendly YouTube frontend) for video metadata
2. **Playback**: Uses the official YouTube IFrame Player API to embed and control videos
3. **Playlists**: Stored locally in `localStorage`; optionally backed up to Google Drive via SafePlace
4. **No API key**: Invidious provides a public API that mirrors YouTube's data without requiring authentication
