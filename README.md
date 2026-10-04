# webos-legacy-stremio (LiteStream)

A lightweight client for **Stremio addons** built for **old LG webOS TVs** (webOS 3.x / 4.x, roughly 2016–2019 models) that the official Stremio app and most community ports don't support.

Old LG TVs ship a very old browser engine (Chromium 38 on webOS 3.x). Modern streaming web apps either don't start at all, or crash the moment playback begins because the TV can't decode the file. LiteStream is written in plain ES5 with no framework, plays video with the TV's native `<video>` pipeline, and **only shows sources the TV can actually play**.

> The UI is in Turkish (metadata language `tr-TR`). Translating it is a welcome contribution.

## Features

- **Stremio account login.** Your installed addons (e.g. AIOStreams, Torrentio with a debrid service, OpenSubtitles, Cinemeta) are loaded from your account automatically.
- **Codec-aware source list.** Hides what the TV can't play: 4K, HEVC/x265, AV1, HDR/Dolby Vision, 10-bit, DTS/TrueHD/Atmos, remux, oversized files and uncached debrid links. Compatible sources are sorted by preference. You can still reveal the hidden ones.
- **Safe seeking.** Remote presses only move a target marker. A single real seek happens 900 ms after the last press, with the video paused during the jump. Rapid repeated seeks were a common crash cause on these TVs.
- **In-app subtitles.** Subtitles are fetched from your subtitle addons and drawn by the app, not by the TV's decoder. Supports SRT/VTT, UTF-8 and Windows-1254. Subtitle delay is adjustable.
- **TMDB metadata.** Movies and Series tabs with trending, popular, top rated, local-language and genre rows. Rows load infinitely and lazily, and off-screen posters are released to keep RAM usage low.
- **Netflix-style detail page.** Backdrop, logo, overview, crew, cast row with photos and person pages, similar titles, and an episode list with progress.
- **Ratings.** TMDB, IMDb, Rotten Tomatoes and Metacritic (via OMDb), plus an awards line.
- **Watchlist and continue watching.** Stored locally on the TV, with resume points and next-episode detection.
- **Audio and subtitle language preference.** Sources with Turkish audio come first, and subtitles try Turkish, then English. Both are easy to change in the code.
- **Remote control.** Works with both the arrow keys and the Magic Remote pointer.

## Download

**Latest release: [LiteStream 1.2.0](https://github.com/SinanKulen/webos-legacy-stremio/releases/tag/v1.2.0)** — direct download: [`litestream-1.2.0.ipk`](https://github.com/SinanKulen/webos-legacy-stremio/releases/download/v1.2.0/litestream-1.2.0.ipk)

The release build contains no API keys. Enter your own TMDB and OMDb keys under **Ayarlar** (Settings) after installing.

## Requirements

- An LG webOS TV with **Developer Mode** (free LG developer account).
- A Stremio account with at least one **stream addon that returns direct HTTP links**, for example an addon configured with a debrid service. Plain torrent streams can't be played on the TV.
- Optional: a free **TMDB API key** for metadata and a free **OMDb API key** for IMDb, RT and Metacritic ratings. Without TMDB the app falls back to Cinemeta.

## Install on the TV

1. Install the **Developer Mode** app from the LG Content Store, sign in, and turn on *Dev Mode Status* and *Key Server*. Note the IP address and passphrase.
2. Install [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) on your computer and add the TV using that IP and passphrase.
3. Download [`litestream-1.2.0.ipk`](https://github.com/SinanKulen/webos-legacy-stremio/releases/download/v1.2.0/litestream-1.2.0.ipk) from the [latest release](https://github.com/SinanKulen/webos-legacy-stremio/releases/latest), or build it yourself (see below). In Dev Manager, open **Apps → Install** and pick the file.
4. Open **LiteStream** on the TV and sign in with your Stremio account. If you didn't build with keys, enter your TMDB and OMDb keys under **Ayarlar** (Settings).

**Alternative: install from the command line** with the webOS CLI:

```bash
npm i -g @webos-tools/cli
ares-setup-device                         # add the TV (IP, port 9922, passphrase)
ares-install -d <tv-name> litestream-1.2.0.ipk
ares-launch -d <tv-name> com.sinan.litestream
```

Developer Mode expires after a while, and sideloaded apps are removed when it does. Extend the session from Dev Manager now and then. On a rooted TV with Homebrew Channel this limit doesn't apply.

## Build

```bash
npm i -g @webos-tools/cli
cp app/config.example.js app/config.js   # optional: put your API keys here (git-ignored)
./scripts/build.sh                       # -> dist/com.sinan.litestream_<version>_all.ipk
```

Do **not** publish an `.ipk` built with your personal keys. Release builds should use an empty `config.js`, and users enter their own keys in Settings.

## Remote control

| Where | Key | Action |
|---|---|---|
| Everywhere | Arrows / OK / Back | Navigate / select / go back |
| Everywhere | Blue | Show / hide the debug log |
| Player | OK | Play / pause |
| Player | ◀ ▶ | −10 s / +10 s |
| Player | ▲ ▼ (or ⏩ ⏪) | +1 min / −1 min |
| Player | Red | Next audio track (if the TV exposes `audioTracks`) |
| Player | Yellow | Next subtitle / off |
| Player | CH+ / CH− | Subtitle delay ±0.5 s |

## Project layout

```
app/
  appinfo.json        webOS app manifest
  index.html          all screens (markup only)
  style.css           1920×1080 TV layout
  app.js              the whole app (ES5)
  config.example.js   optional build-time API keys
scripts/
  build.sh            package .ipk with ares-package
  check_es5.js        fail if app.js uses syntax newer than ES5
tests/
  e2e_test.py         headless UI test with mocked Stremio/TMDB/OMDb APIs
```

## Development notes

- **ES5 only.** No arrow functions, `let`/`const`, template literals, `fetch`, `Object.assign`, `Array#find`/`includes`, and so on. Run `node scripts/check_es5.js` before packaging.
- Rendering is plain DOM with a small spatial-navigation helper. There is no virtual DOM, and memory use on 1–1.5 GB TVs is the main constraint.
- `tests/e2e_test.py` drives the UI with the keyboard in headless Chromium against mocked APIs. It checks logic and layout. Real playback still has to be tested on a TV.
- Debugging on the TV: press **Blue** for the in-app log, or use `ares-inspect` with Developer Mode.

## Known limitations

- **Old hardware.** Even "compatible" sources depend on the TV model. 1080p x264 with AAC/AC3 audio is the safest choice.
- **Audio tracks.** Switching audio tracks inside a file only works if the TV's engine exposes `video.audioTracks`, which many webOS 3.x models don't.
- **No trailers.** YouTube blocks embeds from pages without a web origin (error 153), and webOS apps run from `file://`.
- **Local only.** The watchlist and progress are stored on the TV and don't sync with the Stremio library.

## Disclaimer

This project is a **client only**. It does not host, index or provide any media, and it ships with no addons. What you can watch depends entirely on the addons you install in your own Stremio account. Use it only with content you have the right to access.

Not affiliated with or endorsed by Stremio, LG Electronics, TMDB or OMDb.
This product uses the TMDB API but is not endorsed or certified by TMDB.

## License

[MIT](LICENSE)
