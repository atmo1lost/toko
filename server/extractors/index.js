const youtube = require("./youtube");
const tiktok = require("./tiktok");
const insta = require("./insta");

const extractors = [youtube, tiktok, insta];

function findExtractor(url) {
  return extractors.find((e) => e.match(url));
}

module.exports = { extractors, findExtractor };
