import asyncio
import json
import re
from urllib.parse import quote

import httpx

USER_AGENT_MOBILE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
    "Mobile/15E148 Safari/604.1"
)
USER_AGENT_DESKTOP = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

VIDEO_PATTERNS = [
    re.compile(r'"playable_url(?:_quality_hd)?":"([^"]+)"'),
    re.compile(r'"playable_url":"([^"]+)"'),
    re.compile(r'"browser_native_hd_url":"([^"]+)"'),
    re.compile(r'"browser_native_sd_url":"([^"]+)"'),
    re.compile(r'"hd_src":"([^"]+)"'),
    re.compile(r'"sd_src":"([^"]+)"'),
    re.compile(r'"src":"(https://[^"]+\.mp4[^"]*)"'),
    re.compile(r'property="og:video:secure_url" content="([^"]+)"'),
    re.compile(r'property="og:video(?::url)?" content="([^"]+)"'),
]

IMAGE_PATTERNS = [
    re.compile(r'"viewer_image":\{"uri":"([^"]+)"'),
    re.compile(r'"image":\{"uri":"([^"]+)"'),
    re.compile(r'"photo_image":\{"uri":"([^"]+)"'),
    re.compile(r'"preferred_thumbnail":\{"image":\{"uri":"([^"]+)"'),
    re.compile(r'property="og:image" content="([^"]+)"'),
]

STEM_RE = re.compile(
    r"facebook\.com/(?:watch/?\?v=|reel/|[^/]+/videos/|photo|[^/]+/posts/|[^/]+/photos/)([\w.-]+)",
    re.IGNORECASE,
)
FB_WATCH_RE = re.compile(r"fb\.watch/([\w-]+)", re.IGNORECASE)


def _unescape_url(raw: str) -> str:
    if not raw:
        return raw
    try:
        return json.loads(f'"{raw}"')
    except json.JSONDecodeError:
        return (
            raw.replace("\\/", "/")
            .replace("\\u0025", "%")
            .replace("\\u0026", "&")
            .replace("\\u003d", "=")
        )


def _pick_best(candidates: list[str], prefer_video: bool = True) -> str | None:
    unique = []
    seen = set()
    for url in candidates:
        url = _unescape_url(url)
        if not url.startswith("http") or url in seen:
            continue
        seen.add(url)
        unique.append(url)
    if not unique:
        return None

    def score(u: str) -> int:
        s = len(u)
        lower = u.lower()
        if prefer_video and (".mp4" in lower or "video" in lower):
            s += 5000
        if "scontent" in lower:
            s += 1000
        if "emoji" in lower or "static" in lower:
            s -= 3000
        return s

    return max(unique, key=score)


def _extract_all(html: str, patterns: list[re.Pattern[str]]) -> list[str]:
    found = []
    for pattern in patterns:
        found.extend(pattern.findall(html))
    return found


def _stem_from_url(url: str) -> str:
    watch = FB_WATCH_RE.search(url)
    if watch:
        return f"facebook_{watch.group(1)}"
    match = STEM_RE.search(url)
    if match:
        return f"facebook_{match.group(1)}"
    return "facebook_post"


def _resolve_from_html(html: str, page_url: str) -> tuple[str, str, str]:
    videos = _extract_all(html, VIDEO_PATTERNS)
    video_url = _pick_best(videos, prefer_video=True)
    if video_url:
        return video_url, _stem_from_url(page_url), "video"

    images = _extract_all(html, IMAGE_PATTERNS)
    image_url = _pick_best(images, prefer_video=False)
    if image_url and "scontent" in image_url.lower():
        return image_url, _stem_from_url(page_url), "image"

    raise ValueError("No media found in page HTML.")


async def _fetch_html(url: str, user_agent: str = USER_AGENT_MOBILE) -> str:
    headers = {
        "User-Agent": user_agent,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
    }
    async with httpx.AsyncClient(
        timeout=45.0, follow_redirects=True, headers=headers
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.text


def _fetch_urls_to_try(facebook_url: str) -> list[str]:
    urls = [facebook_url]
    if "fb.watch" in facebook_url:
        urls.append(facebook_url)
    if "facebook.com" in facebook_url:
        encoded = quote(facebook_url, safe="")
        urls.append(
            f"https://www.facebook.com/plugins/video.php?href={encoded}&show_text=0"
        )
        m_url = facebook_url.replace("://www.facebook.com", "://m.facebook.com")
        m_url = m_url.replace("://facebook.com", "://m.facebook.com")
        if m_url not in urls:
            urls.append(m_url)
    return urls


async def _resolve_via_scrape(facebook_url: str) -> tuple[str, str, str]:
    errors = []
    agents = [USER_AGENT_MOBILE, USER_AGENT_DESKTOP]
    for page_url in _fetch_urls_to_try(facebook_url):
        for agent in agents:
            try:
                html = await _fetch_html(page_url, agent)
                return _resolve_from_html(html, facebook_url)
            except (ValueError, httpx.HTTPError) as e:
                errors.append(str(e))
    raise ValueError(
        errors[-1] if errors else "Could not load Facebook page."
    )


def _resolve_via_ytdlp(facebook_url: str) -> tuple[str, str, str]:
    import yt_dlp

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": "best/bestvideo+bestaudio/best",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(facebook_url, download=False)

    if not info:
        raise ValueError("yt-dlp could not read this Facebook link.")

    media_url = info.get("url")
    if not media_url and info.get("formats"):
        formats = [f for f in info["formats"] if f.get("url") and f.get("vcodec") != "none"]
        if formats:
            best = max(formats, key=lambda f: (f.get("height") or 0, f.get("tbr") or 0))
            media_url = best["url"]

    if not media_url:
        thumbs = info.get("thumbnails") or []
        if thumbs:
            best_thumb = max(thumbs, key=lambda t: (t.get("width") or 0))
            media_url = best_thumb.get("url")
            if media_url:
                title = info.get("id") or "facebook_post"
                return media_url, f"facebook_{title}", "image"

    if not media_url:
        raise ValueError("No downloadable media found on this Facebook post.")

    ext = (info.get("ext") or "mp4").lower()
    title = info.get("id") or info.get("title") or "facebook_post"
    stem = re.sub(r"[^\w\s-]", "", str(title)).strip()[:50] or "facebook_post"
    kind = "video" if ext in ("mp4", "webm", "mov", "m4v") else "image"
    return media_url, f"facebook_{stem}", kind


async def resolve_media_url(facebook_url: str) -> tuple[str, str, str]:
    """Return (direct_media_url, suggested_filename_stem, kind)."""
    try:
        return await _resolve_via_scrape(facebook_url)
    except (ValueError, httpx.HTTPError):
        pass

    try:
        return await asyncio.to_thread(_resolve_via_ytdlp, facebook_url)
    except Exception as e:
        msg = str(e).lower()
        if "private" in msg or "login" in msg:
            raise ValueError(
                "This Facebook post may be private or require login."
            ) from e
        raise ValueError(
            "Could not download this Facebook post. Try a public reel, video, or photo link."
        ) from e
