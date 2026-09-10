// Keep the Express import in the root entrypoint so Vercel's framework
// detector recognizes this wrapper as the application entrypoint.
require("express");

module.exports = require("./server/index");
