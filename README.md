# toko

cobalt-inspired downloader, built around batch downloads from day one instead of one-url-at-a-time.

## run it

```
npm install
npm start
```

youtube and tiktok extraction/downloads use the current `yt-dlp` extractor
instead of forwarding short-lived CDN URLs. `npm install` installs yt-dlp and
a static ffmpeg binary for the app, including the Linux binaries used by
Vercel:

```bash
npm install
```

you can override the bundled executables with `TOKO_YTDLP_PATH` and
`TOKO_FFMPEG_PATH`.

for current YouTube javascript challenges, node is used automatically. if a
site requires browser verification, run toko with fresh cookies from the same
browser and network session:

```bash
TOKO_YTDLP_BROWSER=firefox npm start
```

use the browser that can open the post successfully (`chrome`, `firefox`, or
another supported browser), and keep the browser and toko on the same network.
if TikTok still reports that the IP is blocked, set
`TOKO_YTDLP_PROXY` to a proxy whose IP can access TikTok; cookies from a
different network will not fix a signed media request.

other supported settings are `TOKO_YTDLP_JS_RUNTIME`, `TOKO_YTDLP_COOKIES`,
`TOKO_YTDLP_PROXY`, and `TOKO_YTDLP_IMPERSONATE`.
TikTok uses Chrome impersonation by default; this requires the optional
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

2. require it and add to the array in `server/extractors/index.js`. the queue and frontend do not need to change.

## known gaps in this beta

- only youtube, tiktok and instagram implemented, everything else is stubbed by the registry pattern above
- in-memory job store, restart wipes queue state — swap for redis/sqlite before this goes anywhere real
