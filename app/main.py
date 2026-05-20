import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

INSTAGRAM_RE = re.compile(
    r"^https?://(?:www\.)?instagram\.com/(?:reel|reels|p|tv)/[\w-]+",
    re.IGNORECASE,
)

# Prefer H.264 MP4 + AAC (M4A) — plays natively on iPhone without conversion.
FORMAT = (
    "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/"
    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/"
    "best[ext=mp4]/best"
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
    if not url.endswith("/"):
        url += "/"
    return url


def validate_instagram_url(url: str) -> str:
    normalized = normalize_url(url)
    if not INSTAGRAM_RE.match(normalized.rstrip("/")):
        raise HTTPException(
            status_code=400,
            detail="Paste a valid Instagram reel or post link (instagram.com/reel/...).",
        )
    return normalized.rstrip("/")


def find_ytdlp() -> str:
    exe = shutil.which("yt-dlp")
    if exe:
        return exe
    import sys

    return str(Path(sys.executable).parent / "yt-dlp.exe")


def _remove_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


@app.post("/api/download")
def download_reel(body: DownloadRequest, background_tasks: BackgroundTasks):
    url = validate_instagram_url(body.url)

    if not shutil.which("yt-dlp") and not Path(find_ytdlp()).exists():
        raise HTTPException(
            status_code=500,
            detail="yt-dlp is not installed. Run: pip install -r requirements.txt",
        )

    with tempfile.TemporaryDirectory() as tmp:
        out_template = str(Path(tmp) / "%(title).50B.%(ext)s")
        cmd = [
            find_ytdlp(),
            "--no-playlist",
            "--no-warnings",
            "-f",
            FORMAT,
            "--merge-output-format",
            "mp4",
            "-o",
            out_template,
            url,
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Download timed out. Try again.")

        if result.returncode != 0:
            err = (result.stderr or result.stdout or "").strip()
            if "Private" in err or "login" in err.lower():
                raise HTTPException(
                    status_code=403,
                    detail="This reel may be private or require login. Try a public reel.",
                )
            raise HTTPException(
                status_code=502,
                detail=err[-400:] if err else "Could not fetch video from Instagram.",
            )

        files = sorted(Path(tmp).glob("*.mp4"), key=lambda p: p.stat().st_size, reverse=True)
        if not files:
            raise HTTPException(status_code=502, detail="No video file was produced.")

        video = files[0]
        # Copy outside temp dir so FileResponse can stream after context exits
        persist = Path(tempfile.gettempdir()) / f"reel_{video.stem[:40]}.mp4"
        shutil.copy2(video, persist)

        safe_name = re.sub(r'[^\w\s-]', '', video.stem).strip() or "instagram_reel"
        filename = f"{safe_name[:60]}.mp4"

        background_tasks.add_task(_remove_file, persist)

        return FileResponse(
            path=persist,
            media_type="video/mp4",
            filename=filename,
            headers={"Cache-Control": "no-store"},
        )


@app.get("/api/health")
def health():
    return {"ok": True, "ytdlp": bool(shutil.which("yt-dlp") or Path(find_ytdlp()).exists())}


if STATIC.exists():
    app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
