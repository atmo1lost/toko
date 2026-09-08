const TIKTOK_RE =
  /^https?:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+/i;

function match(url) {
  return TIKTOK_RE.test(url);
}

function getMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
    "i"
  );

  return html.match(regex)?.[1] || null;
}

function decode(value) {
  if (!value) return null;

  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function extract(url) {
  if (!match(url)) {
    throw new Error("Invalid TikTok URL");
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/140.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`TikTok returned HTTP ${response.status}`);
  }

  const html = await response.text();

  const title = decode(
    getMeta(html, "og:title") ||
    getMeta(html, "twitter:title")
  );

  const thumbnail = decode(
    getMeta(html, "og:image") ||
    getMeta(html, "twitter:image")
  );

  const video = decode(
    getMeta(html, "og:video") ||
    getMeta(html, "og:video:url") ||
    getMeta(html, "twitter:player:stream")
  );

  const formats = [];

  if (thumbnail) {
    formats.push({
      label: "image",
      url: thumbnail,
      type: "image"
    });
  }

  if (video) {
    formats.push({
      label: "video",
      url: video,
      type: "video"
    });
  }

  return {
    title,
    thumbnail,
    formats
  };
}

module.exports = {
  match,
  extract
};