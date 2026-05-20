import json
import re
from urllib.parse import urlencode

import httpx

SHORTCODE_RE = re.compile(
    r"instagram\.com/(?:[A-Za-z0-9_.]+/)?(?:reel|reels|p|tv)/([A-Za-z0-9-_]+)",
    re.IGNORECASE,
)

# Public web app id (Instagram web client)
X_IG_APP_ID = "936619743392459"
DOC_ID = "10015901848480474"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def extract_shortcode(url: str) -> str | None:
    match = SHORTCODE_RE.search(url)
    return match.group(1) if match else None


def _best_video_url(media: dict) -> str | None:
    if media.get("video_url"):
        return media["video_url"]

    versions = media.get("video_versions") or []
    if versions:
        best = max(versions, key=lambda v: (v.get("width") or 0) * (v.get("height") or 0))
        return best.get("url")

    return None


async def fetch_media_graphql(shortcode: str) -> dict:
    graphql_url = "https://www.instagram.com/api/graphql"
    body = urlencode(
        {
            "variables": json.dumps({"shortcode": shortcode}),
            "doc_id": DOC_ID,
            "lsd": "AVqbxe3J_YA",
        }
    )
    headers = {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-IG-App-ID": X_IG_APP_ID,
        "X-FB-LSD": "AVqbxe3J_YA",
        "X-ASBD-ID": "129477",
        "Sec-Fetch-Site": "same-origin",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(graphql_url, content=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    media = data.get("data", {}).get("xdt_shortcode_media")
    if not media:
        raise ValueError("Instagram did not return media for this link.")
    return media


async def resolve_video_url(instagram_url: str) -> tuple[str, str]:
    """Return (direct_video_url, suggested_filename_stem)."""
    shortcode = extract_shortcode(instagram_url)
    if not shortcode:
        raise ValueError("Invalid Instagram URL.")

    media = await fetch_media_graphql(shortcode)
    video_url = _best_video_url(media)
    if not video_url:
        raise ValueError("No video found on this post (might be a photo carousel).")

    owner = (media.get("owner") or {}).get("username") or "reel"
    stem = f"{owner}_{shortcode}"
    return video_url, stem
