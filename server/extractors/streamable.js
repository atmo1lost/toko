const ytdlp = require("./ytdlp");

const STREAMABLE_RE =
  /^https?:\/\/(?:www\.)?streamable\.com\/(?:e\/|o\/)?[a-z0-9]+\/?(?:[?#].*)?$/i;

function match(url) {
  return typeof url === "string" && STREAMABLE_RE.test(url);
}

async function extract(url, options) {
  if (!match(url)) throw new Error("Invalid Streamable URL");
  return ytdlp.extract(url, "streamable", options);
}

async function download(sourceUrl, formatId, mediaType, options) {
  if (!sourceUrl || !match(sourceUrl)) throw new Error("Streamable URL is required");
  return ytdlp.download(sourceUrl, "streamable", formatId, mediaType, options);
}

module.exports = { match, extract, download };