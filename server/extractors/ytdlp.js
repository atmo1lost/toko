const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { PassThrough } = require("stream");
const ytdlpPackage = require("youtube-dl-exec");
const bundledFfmpeg = require("ffmpeg-static");

const ytdlpDirectory = path.dirname(ytdlpPackage.constants.YOUTUBE_DL_PATH);
const bundledYtdlpCandidates = [
  process.platform === "linux" ? path.join(ytdlpDirectory, "yt-dlp_linux") : null,
  ytdlpPackage.constants.YOUTUBE_DL_PATH,
].filter(Boolean);
const bundledYtdlp = bundledYtdlpCandidates.find((candidate) => fs.existsSync(candidate));
const executable = process.env.TOKO_YTDLP_PATH || bundledYtdlp || "yt-dlp";
const ffmpegPath = process.env.TOKO_FFMPEG_PATH || bundledFfmpeg;
const configuredTimeout = Number(process.env.TOKO_YTDLP_TIMEOUT_MS || 45000);
const ytdlpTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 45000;
const runtimeCookieFile = "/tmp/toko-ytdlp-cookies.txt";

function getCookieFile() {
  const configuredFile = process.env.TOKO_YTDLP_COOKIES;
  if (configuredFile && fs.existsSync(configuredFile)) return configuredFile;

  const cookieContents = process.env.TOKO_YTDLP_COOKIES_CONTENT;
  const cookieBase64 = process.env.TOKO_YTDLP_COOKIES_BASE64;
  if (!cookieContents && !cookieBase64) return null;

  try {
    const contents = cookieBase64
      ? Buffer.from(cookieBase64, "base64").toString("utf8")
      : cookieContents;
    if (!contents || !contents.includes("youtube.com")) return null;
    fs.writeFileSync(runtimeCookieFile, contents, { mode: 0o600 });
    return runtimeCookieFile;
  } catch {
    return null;
  }
}

function formatYtdlpError(errorText) {
  if (!/sign in to confirm|not a bot|confirm you're not a bot/i.test(errorText)) {
    return errorText;
  }

  const deploymentHint = process.env.VERCEL
    ? "YouTube rejected the Vercel server IP. Configure TOKO_YTDLP_COOKIES_CONTENT (or TOKO_YTDLP_COOKIES_BASE64) with a fresh Netscape cookie export and TOKO_YTDLP_PROXY using the same egress network, then redeploy. TOKO_YTDLP_BROWSER cannot work in a Vercel serverless function."
    : "YouTube rejected this request. Use a fresh cookie export from the same browser and network, or configure TOKO_YTDLP_PROXY.";
  return `${errorText}\n\n${deploymentHint}`;
}

function commonArgs({ youtube = false, tiktok = false, playlist = false } = {}) {
  const args = ["--no-warnings", "--no-check-formats", "--force-ipv4"];
  if (!playlist) args.unshift("--no-playlist");

  if (ffmpegPath) {
    args.push("--ffmpeg-location", ffmpegPath);
  }

  if (tiktok && process.env.TOKO_YTDLP_IMPERSONATE !== "false") {
    args.push("--impersonate", process.env.TOKO_YTDLP_IMPERSONATE || "chrome");
  }

  if (youtube) {
    args.push("--js-runtimes", `${process.env.TOKO_YTDLP_JS_RUNTIME || "node"}`);
    args.push("--remote-components", "ejs:github");
  }

  // vercel has no local browser profile.
  if (process.env.TOKO_YTDLP_BROWSER && !process.env.VERCEL) {
    args.push("--cookies-from-browser", process.env.TOKO_YTDLP_BROWSER);
  }
  const cookieFile = getCookieFile();
  if (cookieFile) {
    args.push("--cookies", cookieFile);
  }
  if (process.env.TOKO_YTDLP_PROXY) {
    args.push("--proxy", process.env.TOKO_YTDLP_PROXY);
  }

  return args;
}

function run(args, { collectStdout = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`yt-dlp timed out after ${Math.ceil(ytdlpTimeoutMs / 1000)}s`));
    }, ytdlpTimeoutMs);

    child.stdout.on("data", (chunk) => {
      if (collectStdout) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        reject(new Error(`yt-dlp was not found. Install it or set TOKO_YTDLP_PATH (${executable})`));
      } else {
        reject(error);
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(formatYtdlpError(errorText.split("\n").slice(-8).join("\n") || `yt-dlp exited with ${code || signal}`)));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: errorText });
    });
  });
}

function errorFromStderr(stderr, code, signal) {
  const errorText = Buffer.concat(stderr).toString("utf8").trim();
  return new Error(formatYtdlpError(errorText.split("\n").slice(-8).join("\n") || `yt-dlp exited with ${code || signal}`));
}

// stream output as it arrives so the browser can start downloading at once.
function stream(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    const output = new PassThrough();
    const stderr = [];
    let started = false;
    let settled = false;
    const timeout = setTimeout(() => {
      const error = new Error(`yt-dlp timed out after ${Math.ceil(ytdlpTimeoutMs / 1000)}s`);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      fail(error);
    }, ytdlpTimeoutMs);

    // prevent an unhandled stream error during startup.
    output.on("error", () => {});

    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => stderr.push(chunk));

    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      } else {
        output.destroy(error);
      }
    };

    child.stdout.once("data", () => {
      started = true;
      if (!settled) {
        settled = true;
        resolve(output);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        fail(new Error(`yt-dlp was not found. Install it or set TOKO_YTDLP_PATH (${executable})`));
      } else {
        fail(error);
      }
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        fail(errorFromStderr(stderr, code, signal));
      } else if (!started) {
        fail(new Error("yt-dlp completed without producing media bytes"));
      }
    });

    output.once("close", () => {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    });
  });
}

async function readInfo(url, source) {
  const args = [
    ...commonArgs({ youtube: source === "youtube", tiktok: source === "tiktok" }),
    "--dump-single-json",
    "--skip-download",
    url,
  ];
  const { stdout } = await run(args);
  try {
    return JSON.parse(stdout.toString("utf8"));
  } catch {
    throw new Error("yt-dlp returned invalid metadata");
  }
}

function hasVideo(format) {
  return format.vcodec && format.vcodec !== "none";
}

function hasAudio(format) {
  return format.acodec && format.acodec !== "none";
}

function formatLabel(format, type) {
  if (type === "audio") {
    return `audio ${format.abr ? `${Math.round(format.abr)}kbps ` : ""}${format.ext || "audio"}`;
  }
  return `${format.resolution || format.format_note || format.ext || "video"} ${format.ext || ""}`.trim();
}

function toFormats(info, source, sourceUrl, options = {}) {
  // Only expose actual media streams. Some extractors also return thumbnails,
  // storyboards, or other entries without either an audio or video codec.
  const formats = (info.formats || []).filter((format) =>
    format.format_id && format.url && (hasVideo(format) || hasAudio(format))
  );
  const output = [];
  const seen = new Set();
  let candidates = formats;

  if (options.quality === "audio") {
    const audioOnly = formats.filter((format) => hasAudio(format) && !hasVideo(format));
    if (audioOnly.length) candidates = audioOnly;
  } else if (/^\d+$/.test(options.quality || "")) {
    const height = Number(options.quality);
    const withinQuality = formats.filter((format) => !hasVideo(format) || !format.height || format.height <= height);
    if (withinQuality.length) candidates = withinQuality;
  }

  const ordered = candidates.slice().sort((a, b) => {
    const aCombined = hasVideo(a) && hasAudio(a);
    const bCombined = hasVideo(b) && hasAudio(b);
    return Number(bCombined) - Number(aCombined) || (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0);
  });

  // yt-dlp commonly reports both a video-only stream and a combined stream at
  // the same quality. Keep one option per quality and prefer the one that
  // already contains audio, so the user does not have to choose between
  // duplicate-looking downloads.
  const selectedByQuality = new Map();
  for (const format of ordered) {
    const type = hasAudio(format) && !hasVideo(format) ? "audio" : "video";
    const quality = type === "audio"
      ? `audio:${format.abr || format.tbr || format.ext || "unknown"}`
      : `video:${format.height || format.resolution || format.format_note || format.ext || "unknown"}`;
    const existing = selectedByQuality.get(quality);
    const isBetter = !existing ||
      (hasVideo(format) && hasAudio(format) && !(hasVideo(existing) && hasAudio(existing))) ||
      (hasAudio(format) && !hasVideo(format) && (format.abr || format.tbr || 0) > (existing.abr || existing.tbr || 0));
    if (!isBetter) continue;
    selectedByQuality.set(quality, format);
  }

  for (const format of selectedByQuality.values()) {
    const type = hasAudio(format) && !hasVideo(format) ? "audio" : "video";
    const key = `${type}:${format.format_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      label: formatLabel(format, type),
      type,
      source,
      sourceUrl,
      formatId: String(format.format_id),
      url: "",
    });
    if (output.length >= 6) break;
  }

  return output;
}

async function extract(url, source, options = {}) {
  const info = await readInfo(url, source);
  const formats = toFormats(info, source, url, options);
  if (!formats.length) throw new Error("yt-dlp found no downloadable formats");
  return {
    title: info.title || `${source} video`,
    thumbnail: info.thumbnail || null,
    formats,
  };
}

async function extractPlaylist(url, source) {
  const args = [...commonArgs({ youtube: source === "youtube", playlist: true }), "--flat-playlist", "--dump-single-json", "--skip-download", url];
  const { stdout } = await run(args);
  let info;
  try { info = JSON.parse(stdout.toString("utf8")); } catch { throw new Error("yt-dlp returned invalid playlist metadata"); }
  const entries = (info.entries || []).filter((entry) => entry && entry.id).map((entry) => ({ url: `https://www.youtube.com/watch?v=${entry.id}` }));
  if (!entries.length) throw new Error("yt-dlp found no videos in this playlist");
  return { title: info.title || "YouTube playlist", playlist: entries };
}

function safeFormatId(formatId) {
  return typeof formatId === "string" && /^[a-zA-Z0-9_.-]+$/.test(formatId) ? formatId : null;
}

function qualitySelector(quality, mediaType) {
  if (quality === "audio") return "bestaudio/best";
  if (mediaType === "audio" || !/^\d+$/.test(quality)) return null;
  const height = Number(quality);
  return `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
}

async function download(url, source, formatId, mediaType, options = {}) {
  const selected = safeFormatId(formatId);
  const forcedSelector = qualitySelector(options.quality, mediaType);
  const selector = forcedSelector || (selected
    ? mediaType === "video"
      ? `${selected}+bestaudio/${selected}/best`
      : mediaType === "audio"
      ? `${selected}/bestaudio/best`
      : `${selected}/best`
    : mediaType === "audio"
    ? "bestaudio/best"
    : "bestvideo*+bestaudio/best");

  const args = [
    ...commonArgs({ youtube: source === "youtube", tiktok: source === "tiktok" }),
    "--format",
    selector,
    "--merge-output-format",
    "mp4",
    "--output",
    "-",
    "--downloader",
    "ffmpeg",
    "--downloader-args",
    "ffmpeg_o:-f mp4 -movflags frag_keyframe+empty_moov",
    "--no-part",
    "--no-continue",
  ];
  if (options.metadata === true) args.push("--embed-metadata");

  return stream([...args, url]);
}

module.exports = { extract, extractPlaylist, download };
