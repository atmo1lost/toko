const express = require("express");
const path = require("path");
const { Readable } = require("stream");
const { createBatch, getBatch } = require("./queue");
const youtube = require("./extractors/youtube");
const tiktok = require("./extractors/tiktok");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.post("/api/batch", (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls must be a non-empty array" });
  }

  const batchId = createBatch(urls);
  res.json({ batchId });
});

app.get("/api/batch/:id", (req, res) => {
  const batch = getBatch(req.params.id);

  if (!batch) {
    return res.status(404).json({ error: "batch not found" });
  }

  res.json(batch);
});

// proxies the remote media file so the browser sees a same-origin url it can
// actually download instead of navigating to a third-party cdn link
app.get("/api/download", async (req, res) => {
  const { url, filename, source, sourceUrl, videoId, itag, formatId, mediaType } = req.query;

  if (source === "youtube") {
    if (!sourceUrl && !videoId) {
      return res.status(400).json({ error: "YouTube source URL is required" });
    }
    try {
      const stream = await youtube.download(sourceUrl, formatId || itag, mediaType, videoId);
      const safeName = String(filename || "download.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = safeName.split(".").pop().toLowerCase();
      const contentType = ext === "m4a" ? "audio/mp4" : ext === "webm" ? "video/webm" : "video/mp4";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      const nodeStream = stream instanceof Readable ? stream : Readable.fromWeb(stream);
      nodeStream.on("error", (streamError) => {
        // The stream can fail after youtube.download() has resolved. Keep
        // this from becoming an uncaught EventEmitter error.
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
      const stream = await tiktok.download(sourceUrl, formatId, mediaType);
      const safeName = String(filename || "download.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = safeName.split(".").pop().toLowerCase();
      const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "m4a" ? "audio/mp4" : "video/mp4";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      const nodeStream = stream instanceof Readable ? stream : Readable.fromWeb(stream);
      nodeStream.on("error", (streamError) => res.destroy(streamError));
      nodeStream.pipe(res);
    } catch (err) {
      res.status(502).json({ error: `TikTok download failed: ${err.message}` });
    }
    return;
  }

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required" });
  }

  // TikTok CDN URLs are signed and can expire between extraction and the
  // user's click. Re-extract the post when possible so the proxy uses a
  // fresh signed URL instead of returning the CDN's 403 response.
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
      // Continue with the original signed URL if the post cannot be refreshed.
    }
  }

  let target;

  try {
    target = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return res.status(400).json({ error: "unsupported protocol" });
  }

  try {
    const requestedExtension = String(filename || "").split(".").pop().toLowerCase();
    const isTikTokCdn = /(^|\.)tiktokcdn(?:-[a-z0-9-]+)?\.com$/i.test(target.hostname) ||
      /(^|\.)tiktok\.com$/i.test(target.hostname) ||
      /(^|\.)tiktok(?:v|cdn|video|music)\.com$/i.test(target.hostname) ||
      /(^|\.)ibytedtos\.com$/i.test(target.hostname) ||
      /(^|\.)byteoversea\.com$/i.test(target.hostname);
    const isYouTubeCdn = /(^|\.)googlevideo\.com$/i.test(target.hostname) ||
      /(^|\.)youtube\.com$/i.test(target.hostname);
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
    let upstream = await fetch(target, { headers: mediaHeaders });

    // TikTok returns several equivalent signed CDN URLs. If one edge rejects
    // the request, try the other signed URLs before giving up.
    if (isTikTokCdn && upstream.status === 403) {
      for (const alternateUrl of alternateUrls) {
        let alternateTarget;
        try {
          alternateTarget = new URL(alternateUrl);
        } catch {
          continue;
        }
        const alternateResponse = await fetch(alternateTarget, { headers: mediaHeaders });
        if (alternateResponse.ok) {
          target = alternateTarget;
          upstream = alternateResponse;
          break;
        }
      }
    }

    // Some googlevideo edges reject a ranged request or an iOS UA even when
    // the signed URL is valid. Retry once with a browser identity and no
    // Range header before exposing the 403 to the user.
    if (isYouTubeCdn && upstream.status === 403) {
      const retryHeaders = { ...mediaHeaders };
      delete retryHeaders.Range;
      retryHeaders["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
      upstream = await fetch(target, { headers: retryHeaders });
    }

    if (isTikTokCdn && upstream.status === 403) {
      const retryHeaders = { ...mediaHeaders };
      delete retryHeaders.Range;
      retryHeaders["Accept-Encoding"] = "identity";
      retryHeaders.Origin = "https://www.tiktok.com";
      upstream = await fetch(target, { headers: retryHeaders });
    }

    if (!upstream.ok || !upstream.body) {
      return res
        .status(502)
        .json({ error: `upstream returned ${upstream.status}` });
    }

    let contentType =
      upstream.headers.get("content-type") ||
      (isTikTokCdn && requestedExtension === "mp4" ? "video/mp4" : "application/octet-stream");

    // TikTok occasionally answers a CDN media URL with a JSON redirect
    // wrapper. Resolve the embedded media URL before streaming the response.
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
          upstream = await fetch(mediaUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              Referer: "https://www.tiktok.com/",
              Accept: "video/*,audio/*,*/*;q=0.1",
            },
          });
          contentType = upstream.headers.get("content-type") || "application/octet-stream";
          resolvedMedia = true;
        }
      } catch {
        // Keep the original response; the normal upstream error path follows.
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

    // Some social CDNs report application/json or octet-stream for a media
    // URL. Keep the browser from saving a requested .mp4/.m4a/.jpg as .json.
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

    // stream straight through, this is the part that stops the OOM
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
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
  dim("join the discord: not created yet :/"),
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
