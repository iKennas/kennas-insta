# Finish setup (one-time, free)

Code is on GitHub: https://github.com/iKennas/kennas-insta

The website is live at **https://kennas-insta.web.app**.  
Downloads need the free API — pick **one** option:

---

## Option A — Render (recommended, ~2 minutes)

1. Open: **[Deploy to Render](https://render.com/deploy?repo=https://github.com/iKennas/kennas-insta)**
2. Sign in with **GitHub** → approve access.
3. Keep defaults (free plan, service name `kennas-insta-api`) → **Apply**.

**If deploy failed:** open the Blueprint → **Syncs** → click the failed sync → read the error log. Then **Manual sync** after pulling the latest `main` (we use native Python, not Docker).
4. Wait until status is **Live** (~5–10 min first build).
5. Test: `https://kennas-insta-api.onrender.com/api/health` → `{"ok":true,...}`
6. Redeploy Firebase (if you changed `config.js`):

```powershell
firebase deploy --only hosting:kennas-insta --project prototype-kennas
```

`static/config.js` is already set to `https://kennas-insta-api.onrender.com`.

---

## Option B — Cloudflare Workers (free)

1. [Create API token](https://dash.cloudflare.com/profile/api-tokens) (Edit Cloudflare Workers).
2. In GitHub repo **Settings → Secrets** add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. **Actions** → **Deploy API to Cloudflare Workers** → Run workflow.
4. Copy your worker URL (e.g. `https://kennas-insta-api.<subdomain>.workers.dev`).
5. Set that URL in `static/config.js` as `API_BASE`, then run `.\deploy.ps1`.

---

## Option C — Local only

```powershell
.\run.bat
```

Set `API_BASE: ""` in `static/config.js` and open http://localhost:8000
