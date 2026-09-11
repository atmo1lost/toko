const ytdlp = require("./ytdlp");

const X_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/[^/]+\/status\/\d+\/?(?:[?#].*)?$/i;

function match(url) {
  return typeof url === "string" && X_RE.test(url);
}

async function extract(url, options) {
  if (!match(url)) throw new Error("invalid x url");
  return ytdlp.extract(url, "x", options);
}

async function download(sourceUrl, formatId, mediaType, options) {
  if (!sourceUrl || !match(sourceUrl)) throw new Error("x url is required");
  return ytdlp.download(sourceUrl, "x", formatId, mediaType, options);
}

module.exports = { match, extract, download };
