const ytdlp = require("./ytdlp");

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function getVideoId(value) {
  if (typeof value !== "string") return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let id = null;
  if (host === "youtu.be") {
    id = parsed.pathname.split("/").filter(Boolean)[0];
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.pathname === "/watch") id = parsed.searchParams.get("v");
    else if (["shorts", "embed", "live"].includes(parts[0])) id = parts[1];
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

function match(url) {
  return !!getVideoId(url);
}

async function extract(url, options) {
  if (!match(url)) throw new Error("Invalid YouTube URL");
  return ytdlp.extract(url, "youtube", options);
}

async function download(sourceUrl, formatId, mediaType, videoId, options) {
  const url = sourceUrl || (videoId && `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
  if (!url) throw new Error("YouTube URL is required");
  return ytdlp.download(url, "youtube", formatId, mediaType, options);
}

module.exports = { match, extract, download };
