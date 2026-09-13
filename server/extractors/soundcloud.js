const ytdlp = require("./ytdlp");

const SOUNDCLOUD_RE =
  /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/[^/]+\/(?:sets\/)?[^/]+\/?(?:[?#].*)?$/i;

const SOUNDCLOUD_SHORT_RE =
  /^https?:\/\/on\.soundcloud\.com\/[A-Za-z0-9]+\/?(?:[?#].*)?$/i;

function match(url) {
  return typeof url === "string" && (SOUNDCLOUD_RE.test(url) || SOUNDCLOUD_SHORT_RE.test(url));
}

async function extract(url, options) {
  if (!match(url)) throw new Error("invalid soundcloud url");
  return ytdlp.extract(url, "soundcloud", options);
}

async function download(sourceUrl, formatId, mediaType, options) {
  if (!sourceUrl || !match(sourceUrl)) throw new Error("soundcloud url is required");
  return ytdlp.download(sourceUrl, "soundcloud", formatId, mediaType, options);
}

module.exports = { match, extract, download };
