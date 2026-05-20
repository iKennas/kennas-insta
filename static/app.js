const form = document.getElementById("form");
const urlInput = document.getElementById("url");
const submitBtn = document.getElementById("submit");
const btnLabel = submitBtn.querySelector(".btn-label");
const spinner = submitBtn.querySelector(".spinner");
const statusEl = document.getElementById("status");
const saveAgainBtn = document.getElementById("save-again");
const platformToggle = document.getElementById("platform-toggle");
const heroTitle = document.getElementById("hero-title");
const heroSubtitle = document.getElementById("hero-subtitle");
const urlLabel = document.getElementById("url-label");
const urlHint = document.getElementById("url-hint");
const featQuality = document.getElementById("feat-quality");
const featIphone = document.getElementById("feat-iphone");
const featSave = document.getElementById("feat-save");

const API_BASE = (window.APP_CONFIG?.API_BASE ?? "").replace(/\/$/, "");
const USE_BACKEND = Boolean(API_BASE);

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const INSTAGRAM_PATTERN =
  /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[\w-]+/i;

const FACEBOOK_PATTERN =
  /^https?:\/\/(?:(?:www\.|m\.|web\.)?facebook\.com\/.+|(?:www\.)?fb\.watch\/[\w-]+)/i;

const PLATFORM_KEY = "kennas-platform";

/** Last fetched file — used when iOS needs a second tap to open the share sheet */
let lastSave = null;

const COPY = {
  instagram: {
    title: "Instagram Reel Downloader",
    subtitle:
      "Paste a reel link. Get the highest-quality MP4 — ready for iPhone Photos and Files.",
    label: "Instagram reel URL",
    placeholder: "https://www.instagram.com/reel/...",
    hint: 'Works with <code>/reel/</code>, <code>/reels/</code>, and post links that contain a reel.',
    invalid: "Please paste a valid Instagram reel or post URL.",
    toggleLabel: "Switch to Facebook",
    featQuality: "Pulls the best available stream and merges to MP4 when needed.",
    featIphone:
      "H.264 video + AAC audio in an MP4 container — plays in Photos without converting.",
    featSave: "Share sheet opens automatically — tap Save Video to add to Photos.",
    shareTitle: "Instagram Reel",
    defaultFile: "instagram_reel.mp4",
    loading: "Fetching your reel…",
  },
  facebook: {
    title: "Facebook Post Downloader",
    subtitle:
      "Paste a Facebook video or photo link. Save to iPhone Photos or Files in one tap.",
    loading: "Preparing your Facebook video… this can take up to a minute. Please wait.",
    label: "Facebook post URL",
    placeholder: "https://www.facebook.com/reel/... or fb.watch/...",
    hint: 'Videos, reels, photos, and <code>fb.watch</code> short links are supported.',
    invalid: "Please paste a valid Facebook post, reel, photo, or fb.watch link.",
    toggleLabel: "Switch to Instagram",
    featQuality: "Downloads the best available video or full-size image from the post.",
    featIphone: "Same MP4 format as Instagram — works with the iPhone share sheet.",
    featSave: "Share sheet opens automatically — tap Save Video to add to Photos.",
    shareTitle: "Facebook Video",
    defaultFile: "facebook_post.mp4",
  },
};

let activePlatform = localStorage.getItem(PLATFORM_KEY) || "instagram";
if (activePlatform !== "instagram" && activePlatform !== "facebook") {
  activePlatform = "instagram";
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function setLoading(loading, statusMessage) {
  submitBtn.disabled = loading;
  btnLabel.hidden = loading;
  spinner.hidden = !loading;
  if (loading && statusMessage) {
    showStatus(statusMessage, "loading");
  }
}

function showStatus(message, type) {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
  statusEl.className = "status";
}

function hideSaveAgain() {
  saveAgainBtn.hidden = true;
  lastSave = null;
}

function filenameFromDisposition(header, fallback) {
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(header);
  if (match) return decodeURIComponent(match[1].replace(/["']/g, ""));
  return fallback;
}

function isCorsError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    err?.name === "TypeError" ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("cors")
  );
}

function normalizeFilename(name, isImage) {
  if (isImage) {
    if (/\.(jpe?g|png|webp)$/i.test(name)) return name;
    return name.endsWith(".") ? `${name}jpg` : `${name}.jpg`;
  }
  return name.endsWith(".mp4") ? name : `${name}.mp4`;
}

function isImageFile(filename, blob) {
  if (/\.(jpe?g|png|webp)$/i.test(filename)) return true;
  return blob.type.startsWith("image/");
}

function buildFile(blob, filename) {
  const image = isImageFile(filename, blob);
  const name = normalizeFilename(filename, image);
  const mime = image
    ? blob.type && blob.type.startsWith("image/")
      ? blob.type
      : "image/jpeg"
    : "video/mp4";
  const typed =
    blob.type === mime ? blob : new Blob([blob], { type: mime });
  return {
    file: new File([typed], name, { type: mime }),
    name,
    image,
  };
}

/**
 * Same flow for Instagram and Facebook (Instagram-style share sheet).
 * @returns {'shared' | 'downloaded' | 'cancelled' | 'needs_tap'}
 */
async function saveToDevice(blob, filename, platform) {
  const { file, name, image } = buildFile(blob, filename);
  const copy = COPY[platform] || COPY.instagram;

  lastSave = { file, name, image, platform };

  const canShareFiles =
    typeof navigator.share === "function" &&
    (!navigator.canShare || navigator.canShare({ files: [file] }));

  if (canShareFiles && (IS_IOS || navigator.canShare?.({ files: [file] }))) {
    try {
      await navigator.share({
        files: [file],
        title: copy.shareTitle,
      });
      hideSaveAgain();
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") {
        if (IS_IOS) {
          saveAgainBtn.hidden = false;
          return "needs_tap";
        }
        return "cancelled";
      }
      if (IS_IOS) {
        saveAgainBtn.hidden = false;
        return "needs_tap";
      }
    }
  }

  if (IS_IOS) {
    saveAgainBtn.hidden = false;
    return "needs_tap";
  }

  const objectUrl = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  hideSaveAgain();
  return "downloaded";
}

saveAgainBtn.addEventListener("click", async () => {
  if (!lastSave) return;
  const { file, platform } = lastSave;
  const copy = COPY[platform] || COPY.instagram;
  try {
    await navigator.share({ files: [file], title: copy.shareTitle });
    hideSaveAgain();
    showStatus(
      IS_IOS
        ? "Share sheet opened — tap Save Video to add to Photos."
        : "Share sheet opened.",
      "success"
    );
  } catch (err) {
    if (err?.name !== "AbortError") {
      showStatus(err?.message || "Could not open share menu.", "error");
    }
  }
});

function messageForSaveResult(result, platform, filename) {
  const image = isImageFile(filename, { type: "" });
  if (result === "needs_tap") {
    return image
      ? "Ready! Tap Save to Photos below, then choose Save Image."
      : "Ready! Tap Save to Photos below, then choose Save Video.";
  }
  if (result === "shared") {
    return IS_IOS
      ? image
        ? "Share sheet opened — tap Save Image to add to Photos."
        : "Share sheet opened — tap Save Video to add to Photos."
      : "Share sheet opened — choose Save or Save to Files.";
  }
  if (result === "cancelled") {
    return "Cancelled. Tap Download again when you're ready.";
  }
  if (IS_IOS) {
    return image
      ? "Photo ready — check Files, or tap Save to Photos."
      : "Video ready — check Downloads, or tap Save to Photos.";
  }
  return "Download started — check your Downloads folder.";
}

async function fetchMediaBlob(url, platform) {
  if (USE_BACKEND) {
    const fetchOpts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, platform }),
    };
    if (typeof AbortSignal?.timeout === "function") {
      fetchOpts.signal = AbortSignal.timeout(platform === "facebook" ? 180000 : 120000);
    }
    const res = await fetch(apiUrl("/api/download"), fetchOpts);

    if (!res.ok) {
      let detail = "Download failed. Try again.";
      try {
        const data = await res.json();
        if (data.detail) {
          detail =
            typeof data.detail === "string" ? data.detail : data.detail[0]?.msg || detail;
        }
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }

    const mediaKind = res.headers.get("X-Media-Kind") || "video";
    let blob = await res.blob();
    const fallback = COPY[platform]?.defaultFile || "download.mp4";
    const name = filenameFromDisposition(res.headers.get("Content-Disposition"), fallback);

    if (mediaKind === "video" && !blob.type.startsWith("video/")) {
      blob = new Blob([blob], { type: "video/mp4" });
    }
    if (mediaKind === "image" && !blob.type.startsWith("image/")) {
      blob = new Blob([blob], { type: "image/jpeg" });
    }

    return { blob, filename: name };
  }

  if (platform === "instagram") {
    if (!window.InstagramClient?.fetchVideoBlob) {
      throw new Error("Client module failed to load.");
    }
    return window.InstagramClient.fetchVideoBlob(url);
  }

  throw new Error("Facebook downloads need the API server.");
}

function validateUrl(url, platform) {
  const trimmed = url.trim();
  const testUrl = platform === "instagram" ? trimmed.split("?")[0] : trimmed;
  if (platform === "instagram") return INSTAGRAM_PATTERN.test(testUrl);
  return FACEBOOK_PATTERN.test(testUrl);
}

function applyPlatformUI(platform) {
  const copy = COPY[platform];
  document.body.dataset.platform = platform;
  heroTitle.textContent = copy.title;
  heroSubtitle.textContent = copy.subtitle;
  urlLabel.textContent = copy.label;
  urlInput.placeholder = copy.placeholder;
  urlHint.innerHTML = copy.hint;
  featQuality.textContent = copy.featQuality;
  featIphone.textContent = copy.featIphone;
  featSave.textContent = copy.featSave;
  platformToggle.setAttribute("aria-label", copy.toggleLabel);
  document.title = copy.title;

  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.content = platform === "facebook" ? "#0a0a12" : "#0a0a0f";

  if (urlInput.value.trim()) {
    const valid = validateUrl(urlInput.value.trim(), platform);
    if (!valid) urlInput.value = "";
  }
}

function switchPlatform() {
  activePlatform = activePlatform === "instagram" ? "facebook" : "instagram";
  localStorage.setItem(PLATFORM_KEY, activePlatform);
  applyPlatformUI(activePlatform);
  clearStatus();
  hideSaveAgain();
  urlInput.focus();
}

platformToggle.addEventListener("click", switchPlatform);
applyPlatformUI(activePlatform);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();
  hideSaveAgain();

  const url = urlInput.value.trim();
  const copy = COPY[activePlatform];

  if (!validateUrl(url, activePlatform)) {
    showStatus(copy.invalid, "error");
    urlInput.focus();
    return;
  }

  setLoading(true, copy.loading);

  try {
    const { blob, filename } = await fetchMediaBlob(url, activePlatform);
    const result = await saveToDevice(blob, filename, activePlatform);
    const type =
      result === "cancelled" ? "error" : result === "needs_tap" ? "success" : "success";
    showStatus(messageForSaveResult(result, activePlatform, filename), type);
  } catch (err) {
    if (!USE_BACKEND && activePlatform === "instagram" && isCorsError(err)) {
      showStatus(
        "Firebase-only mode is blocked by Instagram in the browser. Keep using the free Render API (already configured) or upgrade Firebase to Blaze for Functions.",
        "error"
      );
      return;
    }
    showStatus(err?.message || "Download failed. Try again.", "error");
  } finally {
    setLoading(false);
  }
});
