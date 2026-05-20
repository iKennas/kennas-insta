import asyncio
import json
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
import httpx

USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
    "Mobile/15E148 Safari/604.1"
)

# iPhone Photos-friendly MP4 (H.264 + AAC)
YTDLP_FORMAT = (
    "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/"
    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/"
    "best[ext=mp4]/best"
)

IMAGE_PATTERNS = [
    re.compile(r'"viewer_image":\{"uri":"([^"]+)"'),
    re.compile(r'"photo_image":\{"uri":"([^"]+)"'),
    re.compile(r'"image":\{"uri":"([^"]+)"'),
    re.compile(r'property="og:image" content="([^"]+)"'),
]

STEM_RE = re.compile(
    r"facebook\.com/(?:watch/?\?v=|reel/|[^/]+/videos/|photo|[^/]+/posts/|[^/]+/photos/)([\w.-]+)",
    re.IGNORECASE,
)
FB_WATCH_RE = re.compile(r"fb\.watch/([\w-]+)", re.IGNORECASE)


@dataclass
class FacebookMedia:
    """Either local_path (video) or remote_url (image) is set."""

    stem: str
    kind: str  # "video" | "image"
    local_path: Path | None = None
    remote_url: str | None = None
    _tmp_dir: str | None = None

    def cleanup(self) -> None:
        if self._tmp_dir:
            shutil.rmtree(self._tmp_dir, ignore_errors=True)


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


def _stem_from_url(url: str) -> str:
    watch = FB_WATCH_RE.search(url)
    if watch:
        return f"facebook_{watch.group(1)}"
    match = STEM_RE.search(url)
    if match:
        return f"facebook_{match.group(1)}"
    return "facebook_post"


def _is_valid_mp4(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            head = f.read(12)
        if len(head) < 8:
            return False
        # MP4/MOV files contain an ftyp box
        return head[4:8] == b"ftyp" or b"ftyp" in head
    except OSError:
        return False


def _ensure_ffmpeg() -> None:
    try:
        import static_ffmpeg

        static_ffmpeg.add_paths()
    except ImportError:
        pass


def _download_video_ytdlp(facebook_url: str) -> FacebookMedia:
    import yt_dlp

    _ensure_ffmpeg()
    tmp_dir = tempfile.mkdtemp(prefix="fb-dl-")
    out_tmpl = str(Path(tmp_dir) / "%(id)s.%(ext)s")

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": YTDLP_FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": out_tmpl,
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(facebook_url, download=True)

        if not info:
            raise ValueError("yt-dlp returned no info.")

        video_id = info.get("id") or "facebook_post"
        clean_id = re.sub(r"[^\w-]", "", str(video_id))[:50] or "post"
        stem = f"facebook_{clean_id}"

        candidates = sorted(
            Path(tmp_dir).glob("*"),
            key=lambda p: p.stat().st_size if p.is_file() else 0,
            reverse=True,
        )
        for path in candidates:
            if not path.is_file():
                continue
            if path.suffix.lower() not in (".mp4", ".m4v", ".mov", ".webm"):
                continue
            if path.stat().st_size < 50_000:
                continue
            if not _is_valid_mp4(path):
                continue
            return FacebookMedia(
                stem=stem,
                kind="video",
                local_path=path,
                _tmp_dir=tmp_dir,
            )

        raise ValueError("Download finished but no valid MP4 was produced.")
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise


async def _fetch_html(url: str) -> str:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
    }
    async with httpx.AsyncClient(
        timeout=45.0, follow_redirects=True, headers=headers
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.text


def _pick_best_image(candidates: list[str]) -> str | None:
    unique = []
    seen = set()
    for raw in candidates:
        url = _unescape_url(raw)
        if not url.startswith("http") or url in seen:
            continue
        lower = url.lower()
        if "emoji" in lower or "static.xx.fbcdn.net/rsrc" in lower:
            continue
        seen.add(url)
        unique.append(url)
    if not unique:
        return None
    return max(unique, key=len)


async def _resolve_image(facebook_url: str) -> FacebookMedia:
    urls_to_try = [facebook_url]
    if "facebook.com" in facebook_url:
        m_url = facebook_url.replace("://www.facebook.com", "://m.facebook.com")
        m_url = m_url.replace("://facebook.com", "://m.facebook.com")
        if m_url not in urls_to_try:
            urls_to_try.append(m_url)

    errors = []
    for page_url in urls_to_try:
        try:
            html = await _fetch_html(page_url)
            found = []
            for pattern in IMAGE_PATTERNS:
                found.extend(pattern.findall(html))
            image_url = _pick_best_image(found)
            if image_url and "scontent" in image_url.lower():
                return FacebookMedia(
                    stem=_stem_from_url(facebook_url),
                    kind="image",
                    remote_url=image_url,
                )
            errors.append("No photo found on page.")
        except (ValueError, httpx.HTTPError) as e:
            errors.append(str(e))

    raise ValueError(
        errors[-1] if errors else "Could not find a photo on this Facebook link."
    )


async def prepare_facebook_media(facebook_url: str) -> FacebookMedia:
    """
    Videos: download + merge to MP4 via yt-dlp (avoids corrupt partial/HLS URLs).
    Photos: resolve direct image URL from page HTML.
    """
    try:
        return await asyncio.to_thread(_download_video_ytdlp, facebook_url)
    except Exception as video_err:
        video_msg = str(video_err).lower()
        # Photo posts — fall back to image scrape
        if any(
            x in video_msg
            for x in ("no video", "no formats", "unsupported url", "nothing to download")
        ):
            return await _resolve_image(facebook_url)
        if "private" in video_msg or "login" in video_msg:
            raise ValueError(
                "This Facebook post may be private or require login."
            ) from video_err
        raise ValueError(
            "Could not download this Facebook video. Try a public reel or video link."
        ) from video_err
