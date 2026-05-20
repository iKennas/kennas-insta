# Deploy for $0

Firebase **Hosting** is free (Spark plan). The download API needs a server with **yt-dlp** — Firebase Functions require the paid **Blaze** plan, so we split the app:

| Part | Where | Cost |
|------|--------|------|
| Website UI | Firebase `kennas-insta.web.app` | Free |
| Download API | Render.com (or Hugging Face) | Free tier |

---

## Step 1 — Website (already on Firebase)

```powershell
firebase deploy --only hosting:kennas-insta --project prototype-kennas
```

Live UI: **https://kennas-insta.web.app**

---

## Step 2 — Free API on Render (recommended)

1. Push this project to a **GitHub** repo (private or public).
2. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** (or **Web Service**).
3. Connect the repo. Render reads `render.yaml` and builds the **Docker** image (Python + yt-dlp + ffmpeg).
4. Choose plan **Free**. Deploy.
5. Copy your service URL, e.g. `https://kennas-insta-api.onrender.com`
6. Edit `static/config.js`:

```javascript
window.APP_CONFIG = {
  API_BASE: "https://kennas-insta-api.onrender.com",
};
```

7. Redeploy Firebase:

```powershell
firebase deploy --only hosting:kennas-insta --project prototype-kennas
```

**Note:** Free Render apps **sleep** after ~15 minutes idle. The first download after sleep can take 30–60 seconds (cold start).

Test API: open `https://YOUR-SERVICE.onrender.com/api/health` — should show `{"ok":true,...}`.

---

## Alternative — Hugging Face Space (also free)

1. Create a new [Space](https://huggingface.co/new-space) → **Docker**.
2. Upload `Dockerfile`, `app/`, `requirements.txt`, `static/` (or clone from GitHub).
3. Set the Space’s public URL as `API_BASE` in `config.js` (same as Render).
4. Redeploy Firebase hosting.

---

## Alternative — Your PC + ngrok (personal use, $0)

Good if only you use it occasionally:

```powershell
.\run.bat
# In another terminal:
ngrok http 8000
```

Put the `https://….ngrok-free.app` URL in `static/config.js` as `API_BASE`, redeploy Firebase. Your PC must stay on while downloading.

---

## Local development

Leave `API_BASE` empty in `config.js` and run:

```powershell
.\run.bat
```

Open http://localhost:8000 — UI and API are on the same server.

---

## What we removed (paid)

- Firebase **Functions** (needs Blaze / billing)
- Cloud Run from this project (needs APIs + billing account)

The **Dockerfile** in this repo is used by Render/Hugging Face, not Firebase.
