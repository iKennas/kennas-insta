const form = document.getElementById("form");
const urlInput = document.getElementById("url");
const submitBtn = document.getElementById("submit");
const btnLabel = submitBtn.querySelector(".btn-label");
const spinner = submitBtn.querySelector(".spinner");
const statusEl = document.getElementById("status");

const API_BASE = (window.APP_CONFIG?.API_BASE ?? "").replace(/\/$/, "");
const IS_LOCAL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";
const NEEDS_API_CONFIG = !IS_LOCAL && !API_BASE;

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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const url = urlInput.value.trim();
  if (!INSTAGRAM_PATTERN.test(url.split("?")[0])) {
    showStatus("Please paste a valid Instagram reel or post URL.", "error");
    urlInput.focus();
    return;
  }

  if (NEEDS_API_CONFIG) {
    showStatus(
      "Download server is not connected yet. Deploy the free API (see FREE-DEPLOY.md) and set API_BASE in config.js.",
      "error"
    );
    return;
  }

  setLoading(true);

  try {
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
          detail = typeof data.detail === "string" ? data.detail : data.detail[0]?.msg || detail;
        }
      } catch {
        /* ignore */
      }
      showStatus(detail, "error");
      return;
    }

    const blob = await res.blob();
    const name = filenameFromDisposition(res.headers.get("Content-Disposition"));
    const objectUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name.endsWith(".mp4") ? name : `${name}.mp4`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);

    showStatus(
      "Download started. On iPhone: open the file and tap Share → Save Video.",
      "success"
    );
  } catch {
    showStatus(
      IS_LOCAL
        ? "Network error. Is the server running? (run.bat)"
        : "Network error. Check that the API is running and API_BASE in config.js is correct.",
      "error"
    );
  } finally {
    setLoading(false);
  }
});
