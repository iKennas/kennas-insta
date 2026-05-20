const form = document.getElementById("form");
const urlInput = document.getElementById("url");
const submitBtn = document.getElementById("submit");
const btnLabel = submitBtn.querySelector(".btn-label");
const spinner = submitBtn.querySelector(".spinner");
const statusEl = document.getElementById("status");
const platformToggle = document.getElementById("platform-toggle");
const heroTitle = document.getElementById("hero-title");
const heroSubtitle = document.getElementById("hero-subtitle");
const urlLabel = document.getElementById("url-label");
const urlHint = document.getElementById("url-hint");
const featQuality = document.getElementById("feat-quality");
const featIphone = document.getElementById("feat-iphone");
const featSave = document.getElementById("feat-save");
const heroLogo = document.getElementById("hero-logo");
const iosSaveEl = document.getElementById("ios-save");
const iosSavePreview = document.getElementById("ios-save-preview");
const iosSaveLead = document.getElementById("ios-save-lead");
const iosSaveBtn = document.getElementById("ios-save-btn");
const iosSaveOpen = document.getElementById("ios-save-open");

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

let iosSaveObjectUrl = null;
let pendingIosSave = null;

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
    featSave:
      "After download, tap Save to Photos, then choose Save Video in the menu (not Install).",
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
    featIphone: "Videos save as MP4; photos save as JPG — both work with the iPhone share sheet.",
    featSave:
      "After download, tap Save to Photos, then choose Save Video or Save Image (not Install).",
    shareTitle: "Facebook Post",
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

function makeTypedBlob(blob, mime) {
  if (blob.type === mime) return blob;
  return new Blob([blob], { type: mime });
}

function makeFile(blob, filename) {
  const image = isImageFile(filename, blob);
  const name = normalizeFilename(filename, image);
  const mime = image
    ? blob.type && blob.type.startsWith("image/")
      ? blob.type
      : "image/jpeg"
    : "video/mp4";
  return { file: new File([makeTypedBlob(blob, mime)], name, { type: mime }), name, image };
}

function revokeIosSaveUrl() {
  if (iosSaveObjectUrl) {
    URL.revokeObjectURL(iosSaveObjectUrl);
    iosSaveObjectUrl = null;
  }
}

function closeIosSave(result = "cancelled") {
  if (pendingIosSave?.resolve) {
    pendingIosSave.resolve(result);
  }
  iosSaveEl.hidden = true;
  iosSavePreview.innerHTML = "";
  pendingIosSave = null;
  revokeIosSaveUrl();
}

iosSaveEl.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", closeIosSave);
});

/**
 * iPhone: show save panel so share runs on a real tap (gesture lost after async fetch).
 * @returns {'shared' | 'downloaded' | 'cancelled' | 'pending'}
 */
function saveToDevice(blob, filename, platform) {
  const { file, name, image } = makeFile(blob, filename);

  if (!IS_IOS) {
    return saveToDeviceDesktop(file, name);
  }

  return new Promise((resolve) => {
    pendingIosSave = { file, name, image, platform, resolve };
    revokeIosSaveUrl();
    iosSaveObjectUrl = URL.createObjectURL(file);
    iosSavePreview.innerHTML = "";

    if (image) {
      const img = document.createElement("img");
      img.src = iosSaveObjectUrl;
      img.alt = "Preview";
      iosSavePreview.appendChild(img);
      iosSaveLead.textContent = "Your photo is ready. Save it using the steps below.";
      iosSaveOpen.hidden = true;
    } else {
      const video = document.createElement("video");
      video.src = iosSaveObjectUrl;
      video.controls = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.preload = "auto";
      iosSavePreview.appendChild(video);
      iosSaveLead.textContent = "Your video is ready. Use the steps below to add it to Photos.";
      iosSaveOpen.hidden = false;
    }

    iosSaveEl.hidden = false;
  });
}

async function saveToDeviceDesktop(file, name) {
  const canShareFiles =
    typeof navigator.share === "function" &&
    (!navigator.canShare || navigator.canShare({ files: [file] }));

  if (canShareFiles && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
    }
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
  return "downloaded";
}

iosSaveBtn.addEventListener("click", async () => {
  if (!pendingIosSave) return;

  const { file, resolve } = pendingIosSave;

  if (typeof navigator.share !== "function") {
    showStatus("Sharing is not supported here. Try Open video instead.", "error");
    return;
  }

  if (navigator.canShare && !navigator.canShare({ files: [file] })) {
    showStatus("This browser cannot share files. Try Open video instead.", "error");
    return;
  }

  try {
    await navigator.share({ files: [file] });
    const done = pendingIosSave?.resolve;
    pendingIosSave = null;
    iosSaveEl.hidden = true;
    iosSavePreview.innerHTML = "";
    revokeIosSaveUrl();
    if (done) done("shared");
  } catch (err) {
    if (err?.name === "AbortError") {
      showStatus("Cancelled. Tap Save to Photos when you are ready.", "error");
      return;
    }
    showStatus(
      err?.message || "Could not open share menu. Try Open video instead.",
      "error"
    );
  }
});

iosSaveOpen.addEventListener("click", () => {
  if (!iosSaveObjectUrl) return;
  const opened = window.open(iosSaveObjectUrl, "_blank");
  if (!opened) {
    showStatus("Allow pop-ups, or use Save to Photos above.", "error");
  } else {
    showStatus(
      "In the new tab: tap the Share icon, then Save Video.",
      "loading"
    );
  }
});

function messageForSaveResult(result, platform, filename) {
  const image = isImageFile(filename, { type: "" });
  if (result === "pending") {
    return image
      ? "Ready — tap Save to Photos, then Save Image."
      : "Ready — tap Save to Photos, then Save Video (not Install).";
  }
  if (result === "shared") {
    return image
      ? "If Photos did not update, open Photos app and check Recents."
      : "If Photos did not update, open Photos app and check Recents.";
  }
  if (result === "cancelled") {
    return "Cancelled. Tap Download again when you're ready.";
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

    const blob = await res.blob();
    const fallback = COPY[platform]?.defaultFile || "download.mp4";
    const name = filenameFromDisposition(res.headers.get("Content-Disposition"), fallback);

    if (platform === "facebook" && !isImageFile(name, blob)) {
      const buf = await blob.slice(0, 12).arrayBuffer();
      const bytes = new Uint8Array(buf);
      const ftyp =
        bytes.length >= 8 &&
        String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp";
      if (!ftyp) {
        throw new Error(
          "Downloaded file is not a valid video. Try again or use a different public link."
        );
      }
    }

    return { blob, filename: name };
  }

  if (platform === "instagram") {
    if (!window.InstagramClient?.fetchVideoBlob) {
      throw new Error("Client module failed to load.");
    }
    return window.InstagramClient.fetchVideoBlob(url);
  }

  throw new Error(
    "Facebook downloads need the API server. Deploy the updated backend or use the hosted API."
  );
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

  const showIg = platform === "instagram";
  heroLogo.querySelector(".logo-ig").hidden = !showIg;
  heroLogo.querySelector(".logo-fb").hidden = showIg;

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
  closeIosSave();
  urlInput.focus();
}

platformToggle.addEventListener("click", switchPlatform);
applyPlatformUI(activePlatform);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();
  closeIosSave();

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
    setLoading(false);

    const result = await saveToDevice(blob, filename, activePlatform);
    const type = result === "cancelled" ? "error" : "success";
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
