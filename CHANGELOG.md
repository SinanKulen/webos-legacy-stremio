# Changelog

## 1.2.0
- Netflix-style detail page: full-width backdrop, title logo, tagline, genres, runtime.
- Ratings strip: TMDB, IMDb (with vote count), Rotten Tomatoes and Metacritic (via OMDb), plus awards line.
- Crew line (director, writer, music, cinematography) and a cast row with photos.
- Person page: photo, biography, directed / movies / series rows.
- "Similar titles" row (TMDB recommendations).
- Watchlist ("Listem"): add/remove from the detail page, new Listem tab, row on the home screen.
- "Continue watching" row built from local playback progress, with time remaining.
- Episode rows show rating and a progress bar.

## 1.1.0
- Turkish metadata from TMDB (titles, overviews, episode names), English fallback when missing.
- Separate Movies and Series tabs with popular / trending / top rated / Turkish rows and genre rows.
- Infinite, lazily loaded poster rows (up to 200 items per row); off-screen posters are released to save RAM.
- TMDB search.
- Settings screen (API keys, reload addons, log out).
- Turkish-audio sources ranked first; audio track selection Turkish > English where the TV exposes `audioTracks`.
- Subtitles auto-select Turkish, then English; off by default for Turkish-audio sources. CH+/CH- adjusts subtitle delay.

## 1.0.0
- First version: Stremio account login, addon catalogs, search, detail, streams, player.
- Stream filter that hides sources an old LG TV cannot decode (4K, HEVC/x265, AV1, HDR/DV, 10-bit, DTS/TrueHD, remux, uncached debrid).
- Native `<video>` playback with debounced, paused "safe seek".
- Subtitles fetched from addons and rendered in-app (SRT/VTT, UTF-8 or Windows-1254).
- Local resume points and "next episode".
