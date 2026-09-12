const express = require("express");
const dns = require("dns").promises;
const net = require("net");
const path = require("path");
const { Readable } = require("stream");
const { createBatch, processBatch, getBatch } = require("./queue");
const youtube = require("./extractors/youtube");
const tiktok = require("./extractors/tiktok");
const reddit = require("./extractors/reddit")
const x = require("./extractors/x")
const streamable = require("./extractors/streamable")

const app = express();
const maxBatchItems = process.env.VERCEL ? 4 : 25;
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  const origin = req.get("Origin");
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, "..", "public")));

const mediaHostPatterns = [
  /(^|\.)cdninstagram\.com$/i,
  /(^|\.)fbcdn\.net$/i,
  /(^|\.)tiktokcdn(?:-[a-z0-9-]+)?\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)tiktok(?:v|cdn|video|music)\.com$/i,
  /(^|\.)ibytedtos\.com$/i,
  /(^|\.)byteoversea\.com$/i,
  /(^|\.)googlevideo\.com$/i,
  /(^|\.)redd\.it$/i,
  /(^|\.)redditmedia\.com$/i,
  /(^|\.)twimg\.com$/i,
  /(^|\.)streamable\.com$/i,
];

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") || normalized.startsWith("fea") ||
      normalized.startsWith("feb") || normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:192.168.");
  }

  return true;
}

function isAllowedMediaHost(hostname) {
  return mediaHostPatterns.some((pattern) => pattern.test(hostname));
}

async function assertSafeMediaUrl(value) {
  const target = value instanceof URL ? value : new URL(value);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("unsupported media URL protocol");
  }
  if (!isAllowedMediaHost(target.hostname)) {
    throw new Error("media host is not allowed");
  }

  const addresses = await dns.lookup(target.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("media host resolves to a private address");
  }
  return target;
}

async function fetchAllowedMedia(value, options = {}) {
  let target = await assertSafeMediaUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(target, { ...options, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, target };
    }

    const location = response.headers.get("location");
    if (!location) return { response, target };
    target = await assertSafeMediaUrl(new URL(location, target));
  }
  throw new Error("too many media redirects");
}

function validQuality(value) {
  return ["auto", "audio", "2160", "1080", "720", "480"].includes(value) ? value : "auto";
}

app.post("/api/batch", async (req, res) => {
  const { urls, quality, metadata } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > maxBatchItems) {
    return res.status(400).json({ error: `urls must contain between 1 and ${maxBatchItems} items` });
  }
  if (urls.some((url) => typeof url !== "string" || url.trim().length === 0 || url.length > 2048)) {
    return res.status(400).json({ error: "each URL must be a non-empty string no longer than 2048 characters" });
  }

  const batchId = createBatch(urls, {
    quality: validQuality(quality),
    metadata: metadata === true,
  });
  const batch = getBatch(batchId);

  // vercel can send the follow-up GET to a different serverless instance.
  // The queue is intentionally in-memory, so waiting here is required to
  // return the finished batch instead of handing the client an ID that the
  // next instance cannot resolve.
  if (process.env.VERCEL) {
    try {
      await processBatch(batchId);
    } catch (err) {
      return res.status(500).json({ error: `batch processing failed: ${err.message}` });
    }
    return res.json(getBatch(batchId) || batch);
  }

  res.json(batch);
  processBatch(batchId).catch(() => {});
});

app.get("/api/batch/:id", (req, res) => {
  const batch = getBatch(req.params.id);

  if (!batch) {
    return res.status(404).json({ error: "batch not found" });
  }

  res.json(batch);
});

// proxy the media so the browser can download it from this site.
app.get("/api/download", async (req, res) => {
  const { url, filename, source, sourceUrl, videoId, itag, formatId, mediaType } = req.query;

  if (source === "youtube") {
    if (!sourceUrl && !videoId) {
      return res.status(400).json({ error: "YouTube source URL is required" });
    }
    if (sourceUrl && !youtube.match(sourceUrl)) {
      return res.status(400).json({ error: "YouTube source URL is invalid" });
    }
    try {
      const stream = await youtube.download(
        sourceUrl,
        formatId || itag,
        mediaType,
        videoId,
        { quality: validQuality(req.query.quality), metadata: req.query.metadata === "true" }
      );
      const safeName = String(filename || "download.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = safeName.split(".").pop().toLowerCase();
      const contentType = ext === "m4a" ? "audio/mp4" : ext === "webm" ? "video/webm" : "video/mp4";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      const nodeStream = stream instanceof Readable ? stream : Readable.fromWeb(stream);
      res.once("close", () => nodeStream.destroy());
      nodeStream.on("error", (streamError) => {
        // handle errors that happen after the stream starts.
        if (!res.headersSent) {
          res.status(502).json({ error: `YouTube download failed: ${streamError.message}` });
        } else {
          res.destroy(streamError);
        }
      });
      nodeStream.pipe(res);
    } catch (err) {
      res.status(502).json({ error: `YouTube download failed: ${err.message}` });
    }
    return;
  }

  if (source === "tiktok") {
    if (!sourceUrl) {
      return res.status(400).json({ error: "TikTok source URL is required" });
    }
    try {
      const stream = await tiktok.download(
        sourceUrl,
        formatId,
        mediaType,
        { quality: validQuality(req.query.quality), metadata: req.query.metadata === "true" }
      );
      const safeName = String(filename || "download.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = safeName.split(".").pop().toLowerCase();
      const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "m4a" ? "audio/mp4" : "video/mp4";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      const nodeStream = stream instanceof Readable ? stream : Readable.fromWeb(stream);
      res.once("close", () => nodeStream.destroy());
      nodeStream.on("error", (streamError) => res.destroy(streamError));
      nodeStream.pipe(res);
    } catch (err) {
      res.status(502).json({ error: `TikTok download failed: ${err.message}` });
    }
    return;
  }
  if (source === "reddit") {
    if (!sourceUrl) {
      return res.status(400).json({ error: "Reddit source URL is required" });
    }
    try {
      const stream = await reddit.download(
        sourceUrl,
        formatId,
        mediaType,
        { quality: validQuality(req.query.quality), metadata: req.query.metadata === "true" }
      );
      const safeName = String(filename || "download.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = safeName.split(".").pop().toLowerCase();
      const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "m4a" ? "audio/mp4" : "video/mp4";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      const nodeStream = stream instanceof Readable ? stream : Readable.fromWeb(stream);
      res.once("close", () => nodeStream.destroy());
      nodeStream.on("error", (streamError) => res.destroy(streamError));
      nodeStream.pipe(res);
    } catch (err) {
      res.status(502).json({ error: `Reddit download failed: ${err.message}` });
    }
    return;
  }

  if (source === "x") {
    if (!sourceUrl) {
      return res.status(400).json({ error: "X source URL is required" });
    }
    try {
      const stream = await x.download(
        sourceUrl,
        formatId,
        mediaType,
        { quality: validQuality(req.query.quality), metadata: req.query.metadata === "true" }
      );
      const safeName = String(filename || "download.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = safeName.split(".").pop().toLowerCase();
      const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "m4a" ? "audio/mp4" : "video/mp4";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      const nodeStream = stream instanceof Readable ? stream : Readable.fromWeb(stream);
      res.once("close", () => nodeStream.destroy());
      nodeStream.on("error", (streamError) => res.destroy(streamError));
      nodeStream.pipe(res);
    } catch (err) {
      res.status(502).json({ error: `X download failed: ${err.message}` });
    }
    return;
  }
  if (source === "streamable") {
    if (!sourceUrl) {
      return res.status(400).json({ error: "Streamable source URL is required" });
    }
    try {
      const stream = await streamable.download(
        sourceUrl,
        formatId,
        mediaType,
        { quality: validQuality(req.query.quality), metadata: req.query.metadata === "true" }
      );
      const safeName = String(filename || "download.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = safeName.split(".").pop().toLowerCase();
      const contentType = ext === "m4a" ? "audio/mp4" : "video/mp4";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      const nodeStream = stream instanceof Readable ? stream : Readable.fromWeb(stream);
      res.once("close", () => nodeStream.destroy());
      nodeStream.on("error", (streamError) => res.destroy(streamError));
      nodeStream.pipe(res);
    } catch (err) {
      res.status(502).json({ error: `streamable download failed: ${err.message}` });
    }
    return;
  }

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required" });
  }

  // refresh signed tiktok urls before downloading them.
  let targetUrl = url;
  let alternateUrls = [];
  if (source === "tiktok" && sourceUrl) {
    try {
      const fresh = await tiktok.extract(sourceUrl);
      const freshFormat = fresh.formats.find((format) => format.type === "video") || fresh.formats[0];
      if (freshFormat?.url) {
        targetUrl = freshFormat.url;
        alternateUrls = freshFormat.alternates || [];
      }
    } catch {
      // use the old url if refresh fails.
    }
  }

  let target;

  let clientClosed = false;
  try {
    target = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return res.status(400).json({ error: "unsupported protocol" });
  }
  try {
    await assertSafeMediaUrl(target);
  } catch (err) {
    return res.status(400).json({ error: `media URL rejected: ${err.message}` });
  }

  try {
    const requestedExtension = String(filename || "").split(".").pop().toLowerCase();
    const isTikTokCdn = /(^|\.)tiktokcdn(?:-[a-z0-9-]+)?\.com$/i.test(target.hostname) ||
      /(^|\.)tiktok\.com$/i.test(target.hostname) ||
      /(^|\.)tiktok(?:v|cdn|video|music)\.com$/i.test(target.hostname) ||
      /(^|\.)ibytedtos\.com$/i.test(target.hostname) ||
      /(^|\.)byteoversea\.com$/i.test(target.hostname);
    const isYouTubeCdn = /(^|\.)googlevideo\.com$/i.test(target.hostname);
    const youtubeClient = target.searchParams.get("c")?.toUpperCase();
    const youtubeUserAgent =
      youtubeClient === "IOS"
        ? "com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
    const mediaHeaders = {
      "User-Agent": isYouTubeCdn ? youtubeUserAgent : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      Referer: isTikTokCdn ? "https://www.tiktok.com/" : isYouTubeCdn ? "https://www.youtube.com/" : "https://www.google.com/",
      ...(isTikTokCdn ? { Origin: "https://www.tiktok.com" } : {}),
      ...(isYouTubeCdn ? { Origin: "https://www.youtube.com" } : {}),
      Accept: "video/*,audio/*,image/*,application/octet-stream;q=0.9,*/*;q=0.1",
      ...((isTikTokCdn || isYouTubeCdn) && ["mp4", "m4a", "webm"].includes(requestedExtension) ? { Range: "bytes=0-" } : {}),
    };
    const controller = new AbortController();
    res.once("close", () => {
      clientClosed = true;
      controller.abort();
    });
    let fetched = await fetchAllowedMedia(target, {
      headers: mediaHeaders,
      signal: controller.signal,
    });
    let upstream = fetched.response;
    target = fetched.target;

    // try another signed tiktok url after a 403.
    if (isTikTokCdn && upstream.status === 403) {
      for (const alternateUrl of alternateUrls) {
        let alternateTarget;
        try {
          alternateTarget = new URL(alternateUrl);
        } catch {
          continue;
        }
        let alternateResponse;
        try {
          const alternateFetch = await fetchAllowedMedia(alternateTarget, {
            headers: mediaHeaders,
            signal: controller.signal,
          });
          alternateResponse = alternateFetch.response;
          alternateTarget = alternateFetch.target;
        } catch {
          continue;
        }
        if (alternateResponse.ok) {
          target = alternateTarget;
          upstream = alternateResponse;
          break;
        }
      }
    }

    // retry youtube without a range header after a 403.
    if (isYouTubeCdn && upstream.status === 403) {
      const retryHeaders = { ...mediaHeaders };
      delete retryHeaders.Range;
      retryHeaders["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
      upstream = (await fetchAllowedMedia(target, {
        headers: retryHeaders,
        signal: controller.signal,
      })).response;
    }

    if (isTikTokCdn && upstream.status === 403) {
      const retryHeaders = { ...mediaHeaders };
      delete retryHeaders.Range;
      retryHeaders["Accept-Encoding"] = "identity";
      retryHeaders.Origin = "https://www.tiktok.com";
      upstream = (await fetchAllowedMedia(target, {
        headers: retryHeaders,
        signal: controller.signal,
      })).response;
    }

    if (!upstream.ok || !upstream.body) {
      return res
        .status(502)
        .json({ error: `upstream returned ${upstream.status}` });
    }

    let contentType =
      upstream.headers.get("content-type") ||
      (isTikTokCdn && requestedExtension === "mp4" ? "video/mp4" : "application/octet-stream");

    // resolve json wrappers that contain a media url.
    if (/application\/json/i.test(contentType)) {
      const body = await upstream.text();
      let resolvedMedia = false;
      try {
        const parsed = JSON.parse(body);
        const urls = [];
        const collectUrls = (value) => {
          if (typeof value === "string" && /^https?:\/\//i.test(value)) urls.push(value);
          else if (Array.isArray(value)) value.forEach(collectUrls);
          else if (value && typeof value === "object") Object.values(value).forEach(collectUrls);
        };
        collectUrls(parsed);
        const mediaUrl = urls.find((value) => /(?:\/video\/|\.(?:mp4|webm|mov)(?:[?#]|$))/i.test(value));
        if (mediaUrl) {
          upstream = (await fetchAllowedMedia(mediaUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              Referer: "https://www.tiktok.com/",
              Accept: "video/*,audio/*,*/*;q=0.1",
            },
            signal: controller.signal,
          })).response;
          contentType = upstream.headers.get("content-type") || "application/octet-stream";
          resolvedMedia = true;
        }
      } catch {
        // keep the original response and use the normal error path.
      }
      if (!resolvedMedia) {
        return res.status(502).json({ error: "upstream returned JSON instead of media bytes" });
      }
    }

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: `upstream returned ${upstream.status}` });
    }

    const contentLength = upstream.headers.get("content-length");

    const safeName = String(filename || "download").replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

    // keep media files from being saved as json.
    const extensionType = {
      mp4: "video/mp4",
      m4a: "audio/mp4",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webm: "video/webm",
    }[safeName.split(".").pop().toLowerCase()];
    if (extensionType && /^(application\/json|application\/octet-stream)$/i.test(contentType.split(";")[0])) {
      contentType = extensionType;
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}"`
    );

    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    // stream the response to avoid buffering the whole file.
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    if (clientClosed) return;
    if (res.headersSent) return res.destroy(err);
    res.status(502).json({
      error: `download failed: ${err.message}`,
    });
  }
});

const PORT = process.env.PORT || 3000;

const dim = (text) => `\x1b[2m${text}\x1b[0m`;

const lines = [
  "(\\_/)",
  "(o.o)",
  "(> <)",
  "",
  `toko running on http://localhost:${PORT}`,
  ``,
  dim("<3 from atmoss"),
  dim("join the discord: https://discord.gg/AGd3PgxwMA"),
];

const width = process.stdout.columns || 80;

const visibleLength = (text) =>
  text.replace(/\x1b\[[0-9;]*m/g, "").length;

const center = (text) => {
  const padding = Math.max(
    0,
    Math.floor((width - visibleLength(text)) / 2)
  );

  return " ".repeat(padding) + text;
};

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(lines.map(center).join("\n"));
  });
}

module.exports = app;
