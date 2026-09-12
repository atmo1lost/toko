# toko! - enviroment variables
## here you will find all env vars used for your instance.

| env var          | content                              | importance                                                                                   |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `TOKO_YTDLP_COOKIES_BASE64`   | base64-encoded netscape youtube cookies | **100%** (fixes youtube sign in request)                                                                                   |
| `TOKO_YTDLP_PROXY`            | proxy url                            | **40%**                                                                                      |
| `TOKO_YTDLP_BROWSER`          | firefox / chrome / brave + `npm start` | **25%** — if used, the first two variables are not needed, but this will not work in serverless deployments. |
| `TOKO_YTDLP_IMPERSONATE`      | `IOS`, `ANDROID`, `WEB` (`WEB` is recommended) | **10%** — adds some additional reliability.                                                 |
