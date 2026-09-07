const express = require("express");
const path = require("path");
const { createBatch, getBatch } = require("./queue");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// POST { urls: [".."] } -> { batchId }
app.post("/api/batch", (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls must be a non-empty array" });
  }
  const batchId = createBatch(urls);
  res.json({ batchId });
});

// GET status of a batch, poll this from the frontend
app.get("/api/batch/:id", (req, res) => {
  const batch = getBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: "batch not found" });
  res.json(batch);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`toko running on http://localhost:${PORT}`));
