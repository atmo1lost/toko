const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const bundledFfmpeg = require("ffmpeg-static");
const { randomUUID } = require("crypto");
const { del: delBlob } = require("@vercel/blob");
const { handleUpload } = require("@vercel/blob/client");
const { remuxFile, extOf } = require("./remux");

const ffmpegPath = process.env.TOKO_FFMPEG_PATH || bundledFfmpeg || "ffmpeg";
const remuxTimeoutMs = Number(process.env.TOKO_REMUX_TIMEOUT_MS || 120000);

// containers that need the moov atom relocated to the front to be playable/seekable.
const FASTSTART_EXTS = new Set(["mp4", "mov", "m4a", "m4v"]);

function extOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name || "");
  return match ? match[1].toLowerCase() : "";
}

function buildArgs(inputPath, outputPath, ext) {
  const args = [
    "-y",
    "-fflags", "+genpts+igndts",
    "-err_detect", "ignore_err",
    "-i", inputPath,
    "-map", "0",
    "-c", "copy",
  ];
  if (FASTSTART_EXTS.has(ext)) args.push("-movflags", "+faststart");
  args.push(outputPath);
  return args;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`remux timed out after ${Math.ceil(remuxTimeoutMs / 1000)}s`));
    }, remuxTimeoutMs);

    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const text = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(text.split("\n").slice(-6).join("\n") || `ffmpeg exited with ${code || signal}`));
        return;
      }
      resolve();
    });
  });
}

// stream copy remux: fixes moov atom placement, container/muxer mismatches,
// timestamp gaps, and most "won't play" issues without touching the codec data.
// files with actually corrupted stream data can still fail here, that's
// expected, a real fix in that case means re-encoding, not remuxing.
async function remuxFile(inputPath, originalName) {
  const ext = extOf(originalName) || "mp4";
  const outputPath = path.join(os.tmpdir(), `toko-remux-${randomUUID()}.${ext}`);
  try {
    await runFfmpeg(buildArgs(inputPath, outputPath, ext));
  } catch (err) {
    fs.rm(outputPath, { force: true }, () => {});
    throw err;
  }
  return { outputPath, ext };
}

module.exports = { remuxFile, extOf };