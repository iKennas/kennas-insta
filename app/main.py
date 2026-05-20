import re
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.instagram import resolve_video_url

INSTAGRAM_RE = re.compile(
    r"^https?://(?:www\.)?instagram\.com/(?:reel|reels|p|tv)/[\w-]+",
    re.IGNORECASE,
)

app = FastAPI(title="Instagram Reel Downloader")
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


def normalize_url(url: str) -> str:
    url = url.strip()
    if "?" in url:
        url = url.split("?", 1)[0]
    return url.rstrip("/")


def validate_instagram_url(url: str) -> str:
    normalized = normalize_url(url)
    if not INSTAGRAM_RE.match(normalized):
        raise HTTPException(
            status_code=400,
            detail="Paste a valid Instagram reel or post link (instagram.com/reel/...).",
        )
    return normalized


@app.post("/api/download")
async def download_reel(body: DownloadRequest):
    url = validate_instagram_url(body.url)

    try:
        video_url, stem = await resolve_video_url(url)
    except ValueError as e:
        msg = str(e)
        if "private" in msg.lower() or "login" in msg.lower():
            raise HTTPException(status_code=403, detail=msg) from e
        raise HTTPException(status_code=502, detail=msg) from e
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail="Could not reach Instagram. Try again in a moment.",
        ) from e

    filename = f"{re.sub(r'[^\w\s-]', '', stem).strip() or 'instagram_reel'}.mp4"

    async def stream_video():
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", video_url) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk

    return StreamingResponse(
        stream_video(),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/health")
def health():
    return {"ok": True, "method": "graphql"}


if STATIC.exists():
    app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
