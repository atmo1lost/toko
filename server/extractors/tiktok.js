const ytdlp = require("./ytdlp");

const TIKTOK_RE =
  /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+\/?(?:[?#].*)?$/i;

const TIKTOK_SHORT_RE =
  /^https?:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9]+\/?(?:[?#].*)?$/i;

function match(url) {
  return typeof url === "string" && (TIKTOK_RE.test(url) || TIKTOK_SHORT_RE.test(url));
}

async function extract(url, options) {
  if (!match(url)) throw new Error("invalid tiktok url");
  return ytdlp.extract(url, "tiktok", options);
}

async function download(sourceUrl, formatId, mediaType, options) {
  if (!sourceUrl || !match(sourceUrl)) throw new Error("tiktok url is required");
  return ytdlp.download(sourceUrl, "tiktok", formatId, mediaType, options);
}

module.exports = { match, extract, download };
