import re
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.facebook import prepare_facebook_media
from app.instagram import resolve_video_url

USER_AGENT_FB = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
    "Mobile/15E148 Safari/604.1"
)

INSTAGRAM_RE = re.compile(
    r"^https?://(?:www\.)?instagram\.com/(?:reel|reels|p|tv)/[\w-]+",
    re.IGNORECASE,
)

FACEBOOK_RE = re.compile(
    r"^https?://(?:www\.|m\.|web\.)?facebook\.com/.+",
    re.IGNORECASE,
)
FB_WATCH_RE = re.compile(r"^https?://(?:www\.)?fb\.watch/.+", re.IGNORECASE)

app = FastAPI(title="Reel & Facebook Downloader")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://kennas-insta.web.app",
        "https://kennas-insta.firebaseapp.com",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"https://.*\.(web\.app|firebaseapp\.com)",
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC = Path(__file__).resolve().parent.parent / "static"


class DownloadRequest(BaseModel):
    url: str = Field(..., min_length=10, max_length=2048)
    platform: str | None = Field(
        default=None,
        description='Optional: "instagram" or "facebook". Auto-detected from URL if omitted.',
    )


def normalize_url(url: str, platform: str = "") -> str:
    url = url.strip()
    lower = url.lower()
    is_instagram = platform == "instagram" or (
        not platform and "instagram.com" in lower
    )
    if is_instagram:
        if "?" in url:
            url = url.split("?", 1)[0]
        return url.rstrip("/")
    if url.endswith("/") and "?" not in url:
        return url.rstrip("/")
    return url


def detect_platform(url: str) -> str:
    normalized = normalize_url(url.strip())
    if INSTAGRAM_RE.match(normalized):
        return "instagram"
    if FACEBOOK_RE.match(normalized) or FB_WATCH_RE.match(normalized):
        return "facebook"
    return ""


def validate_url(url: str, platform: str) -> str:
    normalized = normalize_url(url, platform)
    if platform == "instagram":
        if not INSTAGRAM_RE.match(normalized):
            raise HTTPException(
                status_code=400,
                detail="Paste a valid Instagram reel or post link (instagram.com/reel/...).",
            )
    elif platform == "facebook":
        if not (FACEBOOK_RE.match(normalized) or FB_WATCH_RE.match(normalized)):
            raise HTTPException(
                status_code=400,
                detail="Paste a valid Facebook post, reel, photo, or fb.watch link.",
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="Unrecognized link. Use an Instagram or Facebook URL.",
        )
    return normalized


@app.post("/api/download")
async def download_media(body: DownloadRequest, background_tasks: BackgroundTasks):
    platform = (body.platform or "").strip().lower() or detect_platform(body.url)
    if platform not in ("instagram", "facebook"):
        raise HTTPException(
            status_code=400,
            detail="Paste a valid Instagram or Facebook link.",
        )

    url = validate_url(body.url, platform)

    fb_media = None
    media_url = None

    try:
        if platform == "instagram":
            media_url, stem = await resolve_video_url(url)
            kind = "video"
        else:
            fb_media = await prepare_facebook_media(url)
            stem = fb_media.stem
            kind = fb_media.kind
            media_url = fb_media.remote_url
    except ValueError as e:
        msg = str(e)
        if "private" in msg.lower() or "login" in msg.lower():
            raise HTTPException(status_code=403, detail=msg) from e
        raise HTTPException(status_code=502, detail=msg) from e
    except httpx.HTTPError as e:
        label = "Instagram" if platform == "instagram" else "Facebook"
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach {label}. Try again in a moment.",
        ) from e

    safe_stem = re.sub(r"[^\w\s-]", "", stem).strip() or f"{platform}_media"
    ext = ".mp4" if kind == "video" else _ext_from_url(media_url or "")
    filename = f"{safe_stem}{ext}"
    media_type = "video/mp4" if kind == "video" else _mime_for_ext(ext)
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store",
        "X-Media-Kind": kind,
    }

    # Facebook video: serve merged local MP4 (prevents corrupt streams)
    if platform == "facebook" and fb_media and fb_media.local_path:
        path = fb_media.local_path
        background_tasks.add_task(fb_media.cleanup)
        return FileResponse(
            path,
            media_type="video/mp4",
            filename=filename,
            headers=headers,
        )

    if not media_url:
        raise HTTPException(status_code=502, detail="No media URL resolved.")

    async def stream_media():
        fetch_headers = {"User-Agent": USER_AGENT_FB}
        if platform == "facebook":
            fetch_headers["Referer"] = "https://www.facebook.com/"

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream(
                "GET", media_url, headers=fetch_headers
            ) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk

    return StreamingResponse(
        stream_media(),
        media_type=media_type,
        headers=headers,
    )


def _ext_from_url(url: str) -> str:
    path = url.split("?", 1)[0].lower()
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        if ext in path:
            return ext if ext != ".jpeg" else ".jpg"
    return ".jpg"


def _mime_for_ext(ext: str) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(ext, "image/jpeg")


@app.get("/api/health")
def health():
    return {"ok": True, "platforms": ["instagram", "facebook"]}


if STATIC.exists():
    app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
