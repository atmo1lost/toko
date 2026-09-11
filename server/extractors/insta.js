const IG_POST_RE = /^(p|reel|reels|tv)$/;
const IG_APP_ID = "936619743392459";
const requestTimeoutMs = 20000;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function getPost(value) {
  if (typeof value !== "string") return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (host !== "instagram.com" || parts.length < 2 || !IG_POST_RE.test(parts[0])) {
    return null;
  }

  return { rawType: parts[0], shortcode: parts[1] };
}

function match(url) {
  return !!getPost(url);
}

function shortcodeToMediaId(shortcode) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let value = 0n;
  for (const char of shortcode) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) return null;
    value = value * 64n + BigInt(digit);
  }
  return value.toString();
}

async function extract(url) {
  const post = getPost(url);
  if (!post) throw new Error("Invalid Instagram URL");
  const { rawType, shortcode } = post;
  const pathType = rawType === "reels" ? "reel" : rawType;

  const targetUrl = `https://www.instagram.com/${pathType}/${shortcode}/?__a=1&__d=dis`;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    Accept: "*/*",
    "X-IG-App-ID": IG_APP_ID,
    "Sec-Fetch-Site": "same-origin",
  };

  if (process.env.IG_COOKIE) headers.Cookie = process.env.IG_COOKIE;

  let response = await fetchWithTimeout(targetUrl, { headers });
  let json = null;
  if (response.ok) {
    try {
      json = await response.json();
    } catch {
      // try the next endpoint.
    }
  }

  if (!json) {
    const mediaId = shortcodeToMediaId(shortcode);
    if (mediaId) {
      const mediaResponse = await fetchWithTimeout(`https://www.instagram.com/api/v1/media/${mediaId}/info/`, { headers });
      if (mediaResponse.ok) {
        try {
          json = await mediaResponse.json();
        } catch {
          json = null;
        }
      }
    }
  }

  if (!json) {
    const pageResponse = await fetchWithTimeout(url, { headers });
    if (!pageResponse.ok) {
      throw new Error(
        `instagram returned HTTP ${response.status}, likely needs a logged-in session cookie (set IG_COOKIE env var)`
      );
    }

    const html = await pageResponse.text();
    const jsonScripts = [
      ...html.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi),
      ...html.matchAll(/<script[^>]*>([\s\S]*?xdt_shortcode_media[\s\S]*?)<\/script>/gi),
      ...html.matchAll(/window\._sharedData\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/gi),
    ];
    for (const match of jsonScripts) {
      try {
        const parsed = JSON.parse(match[1]);
        const item =
          parsed?.items?.[0] ||
          parsed?.data?.xdt_shortcode_media ||
          parsed?.graphql?.shortcode_media ||
          parsed?.props?.pageProps?.data?.xdt_shortcode_media;
        if (item) {
          json = { data: { xdt_shortcode_media: item } };
          break;
        }
      } catch {
        // try the next script.
      }
    }
  }

  if (!json) {
    throw new Error("instagram returned no usable post data, probably a login wall");
  }

  const item =
    json?.items?.[0] ||
    json?.data?.xdt_shortcode_media ||
    json?.graphql?.shortcode_media;
  if (!item) {
    throw new Error("no post metadata found, post may be private or the endpoint is blocked");
  }

  const formats = [];

  if (Array.isArray(item.carousel_media) && item.carousel_media.length) {
    item.carousel_media.forEach((media, idx) => {
      const video = media.video_versions?.[0];
      const image = media.image_versions2?.candidates?.[0];
      if (video) {
        formats.push({ label: `carousel_video_${idx + 1} ${video.width}x${video.height}`, url: video.url, type: "video" });
      } else if (image) {
        formats.push({ label: `carousel_image_${idx + 1} ${image.width}x${image.height}`, url: image.url, type: "image" });
      }
    });
  } else if (Array.isArray(item.video_versions) && item.video_versions.length) {
    item.video_versions.forEach((v, index) => {
      formats.push({ label: `video_version_${index + 1} ${v.width}x${v.height}`, url: v.url, type: "video" });
    });
  } else if (item.image_versions2?.candidates) {
    item.image_versions2.candidates.forEach((img, index) => {
      formats.push({ label: `image_version_${index + 1} ${img.width}x${img.height}`, url: img.url, type: "image" });
    });
  }

  // normalize the web response shape when needed.
  if (!formats.length && Array.isArray(item.edge_sidecar_to_children?.edges)) {
    item.edge_sidecar_to_children.edges.forEach((edge, index) => {
      const media = edge.node;
      if (media.video_url) {
        formats.push({ label: `carousel_video_${index + 1}`, url: media.video_url, type: "video" });
      } else if (media.display_url) {
        formats.push({ label: `carousel_image_${index + 1}`, url: media.display_url, type: "image" });
      }
    });
  } else if (!formats.length && item.video_url) {
    formats.push({ label: "video", url: item.video_url, type: "video" });
  } else if (!formats.length && item.display_url) {
    formats.push({ label: "image", url: item.display_url, type: "image" });
  }

  if (!formats.length) {
    throw new Error("no media formats found in Instagram post");
  }

  const firstCarouselMedia = item.carousel_media?.[0];

  return {
    title:
      item.caption?.text ||
      item.edge_media_to_caption?.edges?.[0]?.node?.text ||
      `Instagram post by ${item.user?.username || "unknown"}`,
    thumbnail:
      item.image_versions2?.candidates?.[0]?.url ||
      firstCarouselMedia?.image_versions2?.candidates?.[0]?.url ||
      item.display_url ||
      item.edge_sidecar_to_children?.edges?.[0]?.node?.display_url ||
      null,
    formats,
  };
}

module.exports = { match, extract };
