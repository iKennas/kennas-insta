/** Browser-side Instagram resolver (no backend). May be blocked by CORS on some networks. */
const IG = {
  X_IG_APP_ID: "936619743392459",
  DOC_ID: "10015901848480474",
  SHORTCODE_RE:
    /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9-_]+)/i,
};

function extractShortcode(url) {
  const m = IG.SHORTCODE_RE.exec(url);
  return m ? m[1] : null;
}

async function resolveVideoUrl(instagramUrl) {
  const shortcode = extractShortcode(instagramUrl);
  if (!shortcode) throw new Error("Invalid Instagram URL.");

  const body = new URLSearchParams({
    variables: JSON.stringify({ shortcode }),
    doc_id: IG.DOC_ID,
    lsd: "AVqbxe3J_YA",
  });

  const res = await fetch("https://www.instagram.com/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-IG-App-ID": IG.X_IG_APP_ID,
      "X-FB-LSD": "AVqbxe3J_YA",
      "X-ASBD-ID": "129477",
    },
    body,
  });

  if (!res.ok) throw new Error("Instagram blocked the request.");

  const data = await res.json();
  const media = data?.data?.xdt_shortcode_media;
  const videoUrl = media?.video_url;
  if (!videoUrl) throw new Error("No video found on this link.");

  const owner = media?.owner?.username || "reel";
  return { videoUrl, filename: `${owner}_${shortcode}.mp4` };
}

async function fetchVideoBlob(instagramUrl) {
  const { videoUrl, filename } = await resolveVideoUrl(instagramUrl);
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error("Could not fetch video file.");
  const blob = await videoRes.blob();
  return { blob, filename };
}

window.InstagramClient = { fetchVideoBlob, resolveVideoUrl };
