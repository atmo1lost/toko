const { nanoid } = require("nanoid");
const pLimit = require("p-limit");
const { findExtractor } = require("./extractors");

const jobs = new Map();

function normalizeUrl(value) {
  if (typeof value !== "string") return value;
  const markdown = value.match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  return (markdown ? markdown[1] : value).trim();
}

// cap concurrent extractions
const limit = pLimit(4);

function createBatch(urls) {
  const batchId = nanoid();
  const items = urls.map((url) => ({
    id: nanoid(),
    url: normalizeUrl(url),
    status: "queued", // queued -> processing -> done or error
    result: null,
    error: null,
  }));

  jobs.set(batchId, { id: batchId, items, createdAt: Date.now() });

  items.forEach((item) => {
    limit(() => processItem(batchId, item.id));
  });

  return batchId;
}

async function processItem(batchId, itemId) {
  const batch = jobs.get(batchId);
  if (!batch) return;
  const item = batch.items.find((i) => i.id === itemId);
  if (!item) return;

  item.status = "processing";

  const extractor = findExtractor(item.url);
  if (!extractor) {
    item.status = "error";
    item.error = "idfk what this is ";
    return;
  }

  try {
    item.result = await extractor.extract(item.url);
    item.status = "done";
  } catch (err) {
    item.status = "error";
    item.error = err.message;
  }
}

function getBatch(batchId) {
  return jobs.get(batchId) || null;
}

module.exports = { createBatch, getBatch };
