// extractor registry
//
// if you want to contribute
// to add a new source: drop a file in this folder exporting
// { match(url), extract(url) } and require it below.
//
// match(url)   -> boolean, does this extractor handle the url
// extract(url) -> { title, formats: [{ label, url, type: 'video'|'audio'|'image' }] }

const youtube = require("./youtube");
const tiktok = require("./tiktok")

const extractors = [youtube, tiktok];

function findExtractor(url) {
  return extractors.find((e) => e.match(url));
}

module.exports = { extractors, findExtractor };
