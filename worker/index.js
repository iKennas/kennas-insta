const X_IG_APP_ID = "936619743392459";
const DOC_ID = "10015901848480474";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SHORTCODE_RE =
  /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9-_]+)/i;

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed =
    origin === "https://kennas-insta.web.app" ||
    origin === "https://kennas-insta.firebaseapp.com" ||
    origin.startsWith("http://localhost");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://kennas-insta.web.app",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

async function resolveVideoUrl(instagramUrl) {
  const match = SHORTCODE_RE.exec(instagramUrl);
  if (!match) throw new Error("Invalid Instagram URL.");
  const shortcode = match[1];

  const body = new URLSearchParams({
    variables: JSON.stringify({ shortcode }),
    doc_id: DOC_ID,
    lsd: "AVqbxe3J_YA",
  });

  const gql = await fetch("https://www.instagram.com/api/graphql", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-IG-App-ID": X_IG_APP_ID,
      "X-FB-LSD": "AVqbxe3J_YA",
      "X-ASBD-ID": "129477",
    },
    body,
  });

  const data = await gql.json();
  const media = data?.data?.xdt_shortcode_media;
  const videoUrl = media?.video_url;
  if (!videoUrl) throw new Error("No video found for this link.");
  const owner = media?.owner?.username || "reel";
  return { videoUrl, filename: `${owner}_${shortcode}.mp4` };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, method: "graphql-worker" }, 200, request);
    }

    if (url.pathname === "/api/download" && request.method === "POST") {
      try {
        const { url: reelUrl } = await request.json();
        const { videoUrl, filename } = await resolveVideoUrl(reelUrl);
        const video = await fetch(videoUrl);
        if (!video.ok) throw new Error("Failed to fetch video bytes.");

        const headers = {
          ...corsHeaders(request),
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        };
        return new Response(video.body, { status: 200, headers });
      } catch (e) {
        return json({ detail: e.message || "Download failed." }, 502, request);
      }
    }

    return json({ detail: "Not found" }, 404, request);
  },
};
