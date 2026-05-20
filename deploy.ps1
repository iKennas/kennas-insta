# Free deploy: Firebase Hosting only (Spark plan). API goes on Render — see FREE-DEPLOY.md
$ErrorActionPreference = "Stop"

if (-not (Select-String -Path "static\config.js" -Pattern 'API_BASE:\s*"https?://' -Quiet)) {
  Write-Host "Warning: static/config.js has no API_BASE URL. Downloads on the live site will not work until you deploy the API and set API_BASE." -ForegroundColor Yellow
}

Write-Host "Deploying site to https://kennas-insta.web.app ..." -ForegroundColor Cyan
firebase deploy --only hosting:kennas-insta --project prototype-kennas

Write-Host "Done. UI: https://kennas-insta.web.app" -ForegroundColor Green
Write-Host "Next: deploy free API (FREE-DEPLOY.md) and set API_BASE in static/config.js, then run this script again." -ForegroundColor Yellow
