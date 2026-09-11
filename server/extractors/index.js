const youtube = require("./youtube");
const tiktok = require("./tiktok");
const insta = require("./insta");
const x = require("./x")
const reddit = require("./reddit")

const extractors = [youtube, tiktok, insta, x, reddit];

function findExtractor(url) {
  return extractors.find((e) => e.match(url));
}

module.exports = { extractors, findExtractor };
