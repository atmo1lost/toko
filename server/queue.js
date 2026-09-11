const { nanoid } = require("nanoid");
const pLimit = require("p-limit");
const { findExtractor } = require("./extractors");

const jobs = new Map();
const jobTtlMs = 15 * 60 * 1000;

function normalizeUrl(value) {
  if (typeof value !== "string") return value;
  const markdown = value.match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  return (markdown ? markdown[1] : value).trim();
}

const limit = pLimit(4);

function createBatch(urls, options = {}) {
  const batchId = nanoid();
  const items = urls.map((url) => ({
    id: nanoid(),
    url: normalizeUrl(url),
    status: "queued",
    result: null,
    error: null,
  }));

  const batch = {
    id: batchId,
    items,
    options: {
      quality: options.quality || "auto",
      metadata: options.metadata === true,
    },
    createdAt: Date.now(),
  };
  jobs.set(batchId, batch);

  const cleanup = setTimeout(() => jobs.delete(batchId), jobTtlMs);
  cleanup.unref?.();

  return batchId;
}

async function processBatch(batchId) {
  const batch = jobs.get(batchId);
  if (!batch) return null;

  // vercel may freeze the function after the response is sent.
  await Promise.all(batch.items.map((item) => limit(() => processItem(batchId, item.id))));
  return batch;
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
    item.result = await extractor.extract(item.url, batch.options);
    if (Array.isArray(item.result.playlist)) {
      const playlistItems = item.result.playlist.map((entry) => ({
        id: nanoid(), url: entry.url, status: "queued", result: null, error: null,
      }));
      const index = batch.items.findIndex((entry) => entry.id === item.id);
      batch.items.splice(index, 1, ...playlistItems);
      await Promise.all(playlistItems.map((entry) => limit(() => processItem(batchId, entry.id))));
      return;
    }
    item.status = "done";
  } catch (err) {
    item.status = "error";
    item.error = err.message;
  }
}

function getBatch(batchId) {
  return jobs.get(batchId) || null;
}

module.exports = { createBatch, processBatch, getBatch };
