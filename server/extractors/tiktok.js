const ytdlp = require("./ytdlp");

const TIKTOK_RE =
  /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+\/?(?:[?#].*)?$/i;

function match(url) {
  return typeof url === "string" && TIKTOK_RE.test(url);
}

async function extract(url) {
  if (!match(url)) throw new Error("Invalid TikTok URL");
  return ytdlp.extract(url, "tiktok");
}

async function download(sourceUrl, formatId, mediaType) {
  if (!sourceUrl || !match(sourceUrl)) throw new Error("TikTok URL is required");
  return ytdlp.download(sourceUrl, "tiktok", formatId, mediaType);
}

module.exports = { match, extract, download };
