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

function commonArgs({ youtube = false, tiktok = false } = {}) {
  const args = ["--no-playlist", "--no-warnings", "--no-check-formats", "--force-ipv4"];

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

  if (process.env.TOKO_YTDLP_BROWSER) {
    args.push("--cookies-from-browser", process.env.TOKO_YTDLP_BROWSER);
  }
  if (process.env.TOKO_YTDLP_COOKIES) {
    args.push("--cookies", process.env.TOKO_YTDLP_COOKIES);
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
        reject(new Error(errorText.split("\n").slice(-8).join("\n") || `yt-dlp exited with ${code || signal}`));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: errorText });
    });
  });
}

function errorFromStderr(stderr, code, signal) {
  const errorText = Buffer.concat(stderr).toString("utf8").trim();
  return new Error(errorText.split("\n").slice(-8).join("\n") || `yt-dlp exited with ${code || signal}`);
}

// Keep the server response connected to yt-dlp's stdout. Waiting for the
// process to finish before returning a file stream makes the browser appear
// idle until the entire media file already exists.
function stream(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    const output = new PassThrough();
    const stderr = [];
    let started = false;
    let settled = false;

    // The server attaches its own error handler after this promise resolves.
    // This listener prevents an early spawn failure from becoming an
    // unhandled EventEmitter error while the promise is being rejected.
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
      if (error.code === "ENOENT") {
        fail(new Error(`yt-dlp was not found. Install it or set TOKO_YTDLP_PATH (${executable})`));
      } else {
        fail(error);
      }
    });

    child.on("close", (code, signal) => {
      if (code !== 0) {
        fail(errorFromStderr(stderr, code, signal));
      } else if (!started) {
        fail(new Error("yt-dlp completed without producing media bytes"));
      }
    });

    output.once("close", () => {
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

function toFormats(info, source, sourceUrl) {
  const formats = (info.formats || []).filter((format) => format.format_id && format.url);
  const output = [];
  const seen = new Set();

  const ordered = formats.slice().sort((a, b) => {
    const aCombined = hasVideo(a) && hasAudio(a);
    const bCombined = hasVideo(b) && hasAudio(b);
    return Number(bCombined) - Number(aCombined) || (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0);
  });

  for (const format of ordered) {
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

async function extract(url, source) {
  const info = await readInfo(url, source);
  const formats = toFormats(info, source, url);
  if (!formats.length) throw new Error("yt-dlp found no downloadable formats");
  return {
    title: info.title || `${source} video`,
    thumbnail: info.thumbnail || null,
    formats,
  };
}

function safeFormatId(formatId) {
  return typeof formatId === "string" && /^[a-zA-Z0-9_.-]+$/.test(formatId) ? formatId : null;
}

async function download(url, source, formatId, mediaType) {
  const selected = safeFormatId(formatId);
  const selector = selected
    ? mediaType === "video"
      ? `${selected}+bestaudio/${selected}/best`
      : mediaType === "audio"
      ? `${selected}/bestaudio/best`
      : `${selected}/best`
    : mediaType === "audio"
    ? "bestaudio/best"
    : "bestvideo*+bestaudio/best";

  return stream([
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
    url,
  ]);
}

module.exports = { extract, download };
