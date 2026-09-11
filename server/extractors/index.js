const youtube = require("./youtube");
const tiktok = require("./tiktok");
const insta = require("./insta");
const twitter = require("./x(twitter)")
const reddit = require("./reddit")

const extractors = [youtube, tiktok, insta, twitter, reddit];

function findExtractor(url) {
  return extractors.find((e) => e.match(url));
}

module.exports = { extractors, findExtractor };
