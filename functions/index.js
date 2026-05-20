const { onRequest } = require("firebase-functions/v2/https");
const youtubedl = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const os = require("os");

const INSTAGRAM_RE =
  /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[\w-]+/i;

const FACEBOOK_RE =
  /^https?:\/\/(?:(?:www\.|m\.|web\.)?facebook\.com\/.+|(?:www\.)?fb\.watch\/[\w-]+)/i;

const FORMAT =
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/" +
  "bestvideo[ext=mp4]+bestaudio[ext=m4a]/" +
  "best[ext=mp4]/best";

function normalizeUrl(url, platform) {
  let u = url.trim();
  if (platform === "instagram" && u.includes("?")) {
    u = u.split("?")[0];
  }
  if (u.endsWith("/") && !u.includes("?")) {
    u = u.replace(/\/$/, "");
  }
  return u;
}

function detectPlatform(url) {
  const trimmed = url.trim();
  const igNorm = normalizeUrl(trimmed, "instagram");
  if (INSTAGRAM_RE.test(igNorm)) return { platform: "instagram", url: igNorm };
  const fbNorm = normalizeUrl(trimmed, "facebook");
  if (FACEBOOK_RE.test(fbNorm)) return { platform: "facebook", url: fbNorm };
  return null;
}

function safeFilename(name, ext) {
  const base = (name || "download")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, 60);
  const suffix = ext || ".mp4";
  return `${base || "download"}${suffix}`;
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

    const mediaUrl = body?.url;
    const requestedPlatform = (body?.platform || "").toLowerCase();
    if (!mediaUrl) {
      res.status(400).json({ detail: "Missing url in request body." });
      return;
    }

    const detected = detectPlatform(mediaUrl);
    if (!detected) {
      res.status(400).json({
        detail: "Paste a valid Instagram or Facebook link.",
      });
      return;
    }

    if (requestedPlatform && requestedPlatform !== detected.platform) {
      res.status(400).json({
        detail: `This link is for ${detected.platform}, not ${requestedPlatform}.`,
      });
      return;
    }

    const { platform, url: validUrl } = detected;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
    const outTemplate = path.join(tmpDir, "%(title).50B.%(ext)s");

    try {
      const ytdlOpts = {
        noPlaylist: true,
        noWarnings: true,
        output: outTemplate,
      };

      if (platform === "instagram") {
        ytdlOpts.format = FORMAT;
        ytdlOpts.mergeOutputFormat = "mp4";
      } else {
        ytdlOpts.format = "best";
      }

      await youtubedl(validUrl, ytdlOpts);

      const exts =
        platform === "facebook"
          ? [".mp4", ".jpg", ".jpeg", ".png", ".webp"]
          : [".mp4"];

      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => exts.some((ext) => f.toLowerCase().endsWith(ext)))
        .map((f) => {
          const full = path.join(tmpDir, f);
          return { name: f, full, size: fs.statSync(full).size };
        })
        .sort((a, b) => b.size - a.size);

      if (!files.length) {
        res.status(502).json({ detail: "No media file was produced." });
        return;
      }

      const media = files[0];
      const ext = path.extname(media.name).toLowerCase() || ".mp4";
      const mime =
        ext === ".mp4"
          ? "video/mp4"
          : ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : "image/jpeg";
      const filename = safeFilename(
        path.basename(media.name, ext),
        ext
      );

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");

      const stream = fs.createReadStream(media.full);
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
        detail: msg.slice(-400) || "Could not fetch media from the link.",
      });
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
);
