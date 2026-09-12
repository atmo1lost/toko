# toko - by atmoss

a simple media downloader.

### discord: https://discord.gg/AGd3PgxwMA

## run

```bash
npm install
npm start
```

open <http://localhost:3000>.

supports youtube, tiktok, instagram, reddit and X (formerly "twitter").

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
## for more, take a look at the **docs**
1. [env vars](docs/env_variables.md)

<3 from atmoss.
