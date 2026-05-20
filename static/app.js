const form = document.getElementById("form");
const urlInput = document.getElementById("url");
const submitBtn = document.getElementById("submit");
const btnLabel = submitBtn.querySelector(".btn-label");
const spinner = submitBtn.querySelector(".spinner");
const statusEl = document.getElementById("status");

const API_BASE = (window.APP_CONFIG?.API_BASE ?? "").replace(/\/$/, "");
const USE_BACKEND = Boolean(API_BASE);

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const INSTAGRAM_PATTERN =
  /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[\w-]+/i;

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  btnLabel.hidden = loading;
  spinner.hidden = !loading;
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

function filenameFromDisposition(header) {
  if (!header) return "instagram_reel.mp4";
  const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(header);
  if (match) return decodeURIComponent(match[1].replace(/["']/g, ""));
  return "instagram_reel.mp4";
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

function normalizeFilename(name) {
  return name.endsWith(".mp4") ? name : `${name}.mp4`;
}

/**
 * iPhone: opens share sheet with Save Video. Others: share if supported, else file download.
 * @returns {'shared' | 'downloaded' | 'cancelled'}
 */
async function saveToDevice(blob, filename) {
  const name = normalizeFilename(filename);
  const file = new File([blob], name, { type: "video/mp4" });

  const canShareFiles =
    typeof navigator.share === "function" &&
    (!navigator.canShare || navigator.canShare({ files: [file] }));

  if (canShareFiles && (IS_IOS || navigator.canShare?.({ files: [file] }))) {
    try {
      await navigator.share({
        files: [file],
        title: "Instagram Reel",
      });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
    }
  }

  const objectUrl = URL.createObjectURL(blob);
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

function messageForSaveResult(result) {
  if (result === "shared") {
    return IS_IOS
      ? "Share sheet opened — tap Save Video to add to Photos."
      : "Share sheet opened — choose Save or Save to Files.";
  }
  if (result === "cancelled") {
    return "Cancelled. Tap Download again when you're ready.";
  }
  return IS_IOS
    ? "Video ready — check Downloads, or try again for the share sheet."
    : "Download started — check your Downloads folder.";
}

async function fetchVideoBlob(url) {
  if (USE_BACKEND) {
    const res = await fetch(apiUrl("/api/download"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

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
    const name = filenameFromDisposition(res.headers.get("Content-Disposition"));
    return { blob, filename: name };
  }

  if (!window.InstagramClient?.fetchVideoBlob) {
    throw new Error("Client module failed to load.");
  }
  return window.InstagramClient.fetchVideoBlob(url);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const url = urlInput.value.trim();
  if (!INSTAGRAM_PATTERN.test(url.split("?")[0])) {
    showStatus("Please paste a valid Instagram reel or post URL.", "error");
    urlInput.focus();
    return;
  }

  setLoading(true);

  try {
    const { blob, filename } = await fetchVideoBlob(url);
    const result = await saveToDevice(blob, filename);
    const type = result === "cancelled" ? "error" : "success";
    showStatus(messageForSaveResult(result), type);
  } catch (err) {
    if (!USE_BACKEND && isCorsError(err)) {
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
