const ytdlp = require("./ytdlp");

const REDDIT_RE =
  /^https?:\/\/(?:www\.|old\.|new\.|m\.)?reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+(?:\/[^/]*)?\/?(?:[?#].*)?$/i;

const REDDIT_SHORT_RE =
  /^https?:\/\/redd\.it\/[a-z0-9]+\/?(?:[?#].*)?$/i;

function match(url) {
  return typeof url === "string" && (REDDIT_RE.test(url) || REDDIT_SHORT_RE.test(url));
}

async function extract(url, options) {
  if (!match(url)) throw new Error("invalid reddit url");
  return ytdlp.extract(url, "reddit", options);
}

async function download(sourceUrl, formatId, mediaType, options) {
  if (!sourceUrl || !match(sourceUrl)) throw new Error("reddit url is required");
  return ytdlp.download(sourceUrl, "reddit", formatId, mediaType, options);
}

module.exports = { match, extract, download };
