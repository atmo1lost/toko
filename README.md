# toko

cobalt-inspired downloader, built around batch downloads from day one instead of one-url-at-a-time.

## run it

```
npm install
npm start
```

youtube and tiktok extraction/downloads use the current `yt-dlp` extractor
instead of forwarding short-lived CDN URLs. Install a current yt-dlp release,
`ffmpeg`, and a JavaScript runtime before starting toko:

```bash
brew install ffmpeg
python3 -m pip install --upgrade "yt-dlp[default,curl-cffi]"
```

if your Python installation is externally managed, install the same extra in
your virtual environment or with pipx instead. Verify the setup with
`yt-dlp --version` and `yt-dlp --list-impersonate-targets`.

for YouTubes current javascript challenges, node is used automatically. If a
site requires browser verification, run toko with fresh cookies from the same
browser and network session:

```bash
TOKO_YTDLP_BROWSER=firefox npm start
```

use the browser that can open the post successfully (`chrome`, `firefox`, or
another supported browser), and keep the browser and toko on the same network.
If TikTok still reports that the IP is blocked, set
`TOKO_YTDLP_PROXY` to a proxy whose IP can access TikTok; cookies from a
different network will not fix a signed media request.

Other supported settings are `TOKO_YTDLP_PATH`, `TOKO_YTDLP_JS_RUNTIME`,
`TOKO_YTDLP_COOKIES`, `TOKO_YTDLP_PROXY`, and `TOKO_YTDLP_IMPERSONATE`.
TikTok uses Chrome impersonation by default; this requires yt-dlp's optional
`curl-cffi` dependency.

open http://localhost:3000

## structure

- `server/extractors/` — one file per source, each exports `match(url)` and `extract(url)`. registry is `server/extractors/index.js`.
- `server/queue.js` — batch job manager, runs up to 4 extractions concurrently (`p-limit`), in-memory store.
- `server/index.js` — express api: `POST /api/batch` to submit urls, `GET /api/batch/:id` to poll status.
- `public/index.html` — paste urls, watch the queue, click through to direct file urls.

## adding a source

1. new file in `server/extractors/`, e.g. `threads.js`:

```js
function match(url) { return url.includes("threads.net"); }
async function extract(url) {
  // scrape/fetch, return { title, formats: [{ label, url, type }] }
}
module.exports = { match, extract };
```

2. require it and add to the array in `server/extractors/index.js`. that's it, the queue and frontend don't need to change.

## known gaps in this beta

- only youtube, tiktok and instagram implemented, everything else is stubbed by the registry pattern above
- in-memory job store, restart wipes queue state — swap for redis/sqlite before this goes anywhere real
