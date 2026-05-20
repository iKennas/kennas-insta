const { onRequest } = require("firebase-functions/v2/https");
const youtubedl = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const os = require("os");

const INSTAGRAM_RE =
  /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[\w-]+/i;

const FORMAT =
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/" +
  "bestvideo[ext=mp4]+bestaudio[ext=m4a]/" +
  "best[ext=mp4]/best";

function normalizeUrl(url) {
  let u = url.trim();
  if (u.includes("?")) u = u.split("?")[0];
  if (!u.endsWith("/")) u += "/";
  return u.replace(/\/$/, "");
}

function validateUrl(url) {
  const normalized = normalizeUrl(url);
  if (!INSTAGRAM_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

function safeFilename(name) {
  const base = (name || "instagram_reel")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, 60);
  return `${base || "instagram_reel"}.mp4`;
}

exports.api = onRequest(
  {
    region: "us-central1",
    memory: "2GiB",
    timeoutSeconds: 120,
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    const urlPath = req.path || req.url || "";

    if (urlPath.endsWith("/health") || urlPath === "/health") {
      res.json({ ok: true, service: "kennas-insta-api" });
      return;
    }

    if (req.method !== "POST" || !urlPath.includes("download")) {
      res.status(404).json({ detail: "Not found" });
      return;
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const reelUrl = body?.url;
    if (!reelUrl) {
      res.status(400).json({ detail: "Missing url in request body." });
      return;
    }

    const validUrl = validateUrl(reelUrl);
    if (!validUrl) {
      res.status(400).json({
        detail:
          "Paste a valid Instagram reel or post link (instagram.com/reel/...).",
      });
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
    const outTemplate = path.join(tmpDir, "%(title).50B.%(ext)s");

    try {
      await youtubedl(validUrl, {
        noPlaylist: true,
        noWarnings: true,
        format: FORMAT,
        mergeOutputFormat: "mp4",
        output: outTemplate,
      });

      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => f.endsWith(".mp4"))
        .map((f) => {
          const full = path.join(tmpDir, f);
          return { name: f, full, size: fs.statSync(full).size };
        })
        .sort((a, b) => b.size - a.size);

      if (!files.length) {
        res.status(502).json({ detail: "No video file was produced." });
        return;
      }

      const video = files[0];
      const filename = safeFilename(path.basename(video.name, ".mp4"));

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");

      const stream = fs.createReadStream(video.full);
      stream.pipe(res);
      stream.on("end", () => {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      });
      stream.on("error", () => {
        if (!res.headersSent) {
          res.status(502).json({ detail: "Failed to stream video." });
        }
      });
    } catch (err) {
      const msg = String(err?.stderr || err?.message || err || "");
      if (/private|login/i.test(msg)) {
        res.status(403).json({
          detail:
            "This reel may be private or require login. Try a public reel.",
        });
        return;
      }
      res.status(502).json({
        detail: msg.slice(-400) || "Could not fetch video from Instagram.",
      });
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
);
