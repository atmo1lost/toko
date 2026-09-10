const express = require("express");
const app = express();

app.use(require("./server/index"));

module.exports = app;
