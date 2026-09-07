# toko

cobalt-inspired downloader, built around batch downloads from day one instead of one-url-at-a-time.

## run it

```
npm install
npm start
```

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

- only youtube implemented, everything else is stubbed by the registry pattern above
- in-memory job store, restart wipes queue state — swap for redis/sqlite before this goes anywhere real
- no rate limiting on the api itself, someone could spam `/api/batch`
- no auth, don't expose this publicly as-is
- `@distube/ytdl-core` breaks periodically when youtube changes internals, same problem cobalt has, budget time for maintenance
