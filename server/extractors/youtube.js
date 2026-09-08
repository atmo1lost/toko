const { Innertube } = require("youtubei.js");

const VIDEO_ID_RE = /(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/;

let ytClient = null;
async function getClient() {
  if (!ytClient) ytClient = await Innertube.create();
  return ytClient;
}

function match(url) {
  return VIDEO_ID_RE.test(url);
}

async function extract(url) {
  const match = url.match(VIDEO_ID_RE);
  if (!match) {
    throw new Error("Invalid YouTube URL");
  }
  const id = match[1];
  const yt = await getClient();
  const info = await yt.getInfo(id);

  const rawFormats = info.streaming_data.formats.concat(info.streaming_data.adaptive_formats);

  const candidates = rawFormats.filter(
    (f) => f.url || f.cipher || f.signature_cipher
  );

  const resolved = await Promise.all(
    candidates.map(async (f) => {
      try {
        const resolvedUrl = await f.decipher(yt.session.player);
        if (!resolvedUrl) return null;
        return {
          label: f.has_video
            ? `${f.quality_label || f.quality} ${f.mime_type.split(";")[0].split("/")[1]}`
            : `audio ${Math.round((f.bitrate || 0) / 1000)}kbps ${f.mime_type.split(";")[0].split("/")[1]}`,
          url: resolvedUrl,
          type: f.has_video ? "video" : "audio",
        };
      } catch {
        return null; 
      }
    })
  );

  const formats = resolved.filter(Boolean);

  return {
    title: info.basic_info.title,
    thumbnail: info.basic_info.thumbnail?.slice(-1)[0]?.url,
    formats,
  };
}

module.exports = { match, extract };