# toko - by atmoss

a simple media downloader.

no ads. no tracking. just toko.

### supported platforms

youtube, tiktok, instagram, reddit, x, streamable and soundcloud.

### discord

https://discord.gg/AGd3PgxwMA

come say hi, report something annoying, or suggest something stupid.

## run

```bash
npm install
npm start
```

open <http://localhost:3000>.

## vercel deployment

youtube may block vercel's server ip. browser cookies do not work in a
serverless function.

set these private environment variables:

```text
TOKO_YTDLP_COOKIES_BASE64=<your cookie export>
TOKO_YTDLP_PROXY=<your proxy>
```

the proxy should use the same network as the cookies.

never commit cookies or proxy urls. seriously.

for local browser cookies, use:

```bash
TOKO_YTDLP_BROWSER=chrome / firefox / brave npm start
```

## docs

for more, take a look at the **[docs](docs/)**.

- [env vars](docs/env_variables.md)

## important stuff

toko is still being worked on. things will break occasionally.

if something does break, tell us instead of staring at it for 20 minutes hoping it'll fix itself.

<3 from atmoss.