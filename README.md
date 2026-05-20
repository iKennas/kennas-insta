# kennas-insta

Instagram reel downloader — paste a link, get a high-quality MP4 for iPhone.

- **Site:** https://kennas-insta.web.app
- **Repo:** https://github.com/iKennas/kennas-insta

## Quick start (local)

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
.\run.bat
```

Open http://localhost:8000

## Free production deploy

| Part | Host | Cost |
|------|------|------|
| UI | [Firebase Hosting](https://kennas-insta.web.app) | Free |
| API | [Render](https://render.com) (Docker) | Free tier |

See **[FREE-DEPLOY.md](FREE-DEPLOY.md)** for full steps.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/iKennas/kennas-insta)

After Render deploy, set `API_BASE` in `static/config.js` and run `.\deploy.ps1`.

## Stack

- `static/` — Web UI (KENNAS branding)
- `app/` — FastAPI + yt-dlp
- `Dockerfile` — Production API image
- `firebase.json` — Hosting for `kennas-insta` site
