# toko - by atmoss

a simple batch media downloader.

## run

```bash
npm install
npm start
```

open <http://localhost:3000>.

supports youtube, tiktok, and instagram.

## vercel

youtube may block vercel's server ip. browser cookies do not work in a
serverless function.

set these private environment variables:

```text
TOKO_YTDLP_COOKIES_BASE64=<your cookie export>
TOKO_YTDLP_PROXY=<your proxy>
```

the proxy should use the same network as the cookies. never commit cookies or
proxy urls.

for local browser cookies, use:

```bash
TOKO_YTDLP_BROWSER=firefox npm start
```
<3 from atmoss.