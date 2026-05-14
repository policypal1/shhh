const { ipcRenderer } = require("electron");

const ACCESS_CODE = "1111";

let clickCount = 0;
let clickTimer = null;
let lastLoadedUrl = "";

function $(id) {
  return document.getElementById(id);
}

function normalizeUrl(rawValue) {
  let value = String(rawValue || "").trim();

  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function injectExtraStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .device-shell {
      background: #111;
      border-radius: 24px;
      padding: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.55);
      display: flex;
      flex-direction: column;
      max-width: calc(100vw - 60px);
      max-height: calc(100vh - 130px);
    }

    .device-top {
      height: 38px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #aaa;
      font-size: 12px;
      padding: 0 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }

    .device-dot {
      width: 9px;
      height: 9px;
      background: #555;
      border-radius: 50%;
      flex: 0 0 auto;
    }

    .device-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-left: 6px;
    }

    #electronBrowserSlot {
      width: 100%;
      flex: 1;
      border-radius: 16px;
      background: white;
      overflow: hidden;
    }

    .viewer-note {
      color: #888;
      font-size: 12px;
      margin-top: 14px;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .browser-status-pill {
      color: #aaa;
      font-size: 12px;
      white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  `;
  document.head.appendChild(style);
}

function setStatus(message) {
  let status = $("browserStatus");

  if (!status) {
    status = document.createElement("span");
    status.id = "browserStatus";
    status.className = "browser-status-pill";

    const bar = document.querySelector(".viewer-bar");
    if (bar) bar.appendChild(status);
  }

  status.textContent = message;
}

function getUrlInput() {
  return $("browserUrlInput") || $("urlInput");
}

function getSelectedDeviceSize() {
  const deviceSelect = $("deviceSelect");
  const value = deviceSelect?.value || "1440x900";
  const [width, height] = value.split("x").map(Number);

  return {
    width: width || 1440,
    height: height || 900
  };
}

function getBrowserSlotBounds() {
  const slot = $("electronBrowserSlot");

  if (!slot) {
    return {
      x: -10000,
      y: -10000,
      width: 1,
      height: 1
    };
  }

  const rect = slot.getBoundingClientRect();

  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function renderElectronBrowserShell(url) {
  const viewerStage = $("viewerStage");
  const urlInput = getUrlInput();
  const { width, height } = getSelectedDeviceSize();

  if (!viewerStage) return;

  lastLoadedUrl = url;

  if (urlInput) {
    urlInput.value = url;
  }

  viewerStage.innerHTML = `
    <div class="device-shell" style="width:${width + 24}px;height:${height + 62}px;">
      <div class="device-top">
        <span class="device-dot"></span>
        <span class="device-dot"></span>
        <span class="device-dot"></span>
        <span class="device-title">${url}</span>
      </div>

      <div id="electronBrowserSlot"></div>
    </div>

    <div class="viewer-note">
      Real Electron browser mode. This avoids normal iframe blocking.
    </div>
  `;
}

async function loadUrl() {
  const urlInput = getUrlInput();
  const safeUrl = normalizeUrl(urlInput?.value);

  if (!safeUrl) {
    setStatus("Invalid URL");
    urlInput?.focus();
    return;
  }

  setStatus("Loading...");
  renderElectronBrowserShell(safeUrl);

  requestAnimationFrame(async () => {
    const result = await ipcRenderer.invoke("browser:load-url", {
      url: safeUrl,
      bounds: getBrowserSlotBounds()
    });

    if (!result.success) {
      setStatus(result.error || "Could not load");
      return;
    }

    lastLoadedUrl = result.url;
    setStatus("Ready");
  });
}

async function resizeBrowserView() {
  if (!lastLoadedUrl) return;
  await ipcRenderer.invoke("browser:set-bounds", getBrowserSlotBounds());
}

async function clearViewer() {
  const viewerStage = $("viewerStage");
  const urlInput = getUrlInput();

  lastLoadedUrl = "";

  if (urlInput) {
    urlInput.value = "";
  }

  if (viewerStage) {
    viewerStage.innerHTML = `
      <div class="empty-state">
        Paste a URL above and click Load.
      </div>
      <div class="viewer-note">
        Use https://chatgpt.com, not an iframe.
      </div>
    `;
  }

  await ipcRenderer.invoke("browser:hide");
  setStatus("Ready");
}

function openModal() {
  const modalBackdrop = $("modalBackdrop");
  const pwInput = $("pwInput");
  const pwError = $("pwError");

  modalBackdrop?.classList.add("active");

  if (pwInput) {
    pwInput.value = "";
    setTimeout(() => pwInput.focus(), 50);
  }

  if (pwError) {
    pwError.textContent = "";
  }
}

function closeModal() {
  $("modalBackdrop")?.classList.remove("active");
}

function openViewer() {
  const viewer = $("viewer");
  const urlInput = getUrlInput();

  viewer?.classList.add("active");

  setTimeout(() => {
    urlInput?.focus();
    resizeBrowserView();
  }, 100);
}

async function closeViewerPanel() {
  const viewer = $("viewer");

  viewer?.classList.remove("active");
  await ipcRenderer.invoke("browser:hide");
}

function checkPassword() {
  const pwInput = $("pwInput");
  const pwError = $("pwError");

  if (pwInput?.value === ACCESS_CODE) {
    closeModal();
    openViewer();
    return;
  }

  if (pwError) {
    pwError.textContent = "Incorrect code.";
  }

  if (pwInput) {
    pwInput.value = "";
    pwInput.focus();
  }
}

function stop(event) {
  event.preventDefault();
  event.stopPropagation();

  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  injectExtraStyles();
  setStatus("Ready");

  const trigger = $("trigger");
  const modalBackdrop = $("modalBackdrop");
  const pwInput = $("pwInput");
  const pwSubmit = $("pwSubmit");
  const pwCancel = $("pwCancel");
  const loadBtn = $("loadBtn");
  const closeViewer = $("closeViewer");
  const backBtn = $("backBtn");
  const forwardBtn = $("forwardBtn");
  const reloadBtn = $("reloadBtn");
  const homeBtn = $("homeBtn");
  const openNormalBtn = $("openNormalBtn");
  const deviceSelect = $("deviceSelect");
  const urlInput = getUrlInput();

  trigger?.addEventListener("click", (event) => {
    stop(event);

    clickCount++;
    clearTimeout(clickTimer);

    clickTimer = setTimeout(() => {
      clickCount = 0;
    }, 3000);

    if (clickCount >= 5) {
      clickCount = 0;
      openModal();
    }
  }, true);

  pwSubmit?.addEventListener("click", (event) => {
    stop(event);
    checkPassword();
  }, true);

  pwInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      stop(event);
      checkPassword();
    }
  }, true);

  pwCancel?.addEventListener("click", (event) => {
    stop(event);
    closeModal();
  }, true);

  modalBackdrop?.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) {
      stop(event);
      closeModal();
    }
  }, true);

  loadBtn?.addEventListener("click", (event) => {
    stop(event);
    loadUrl();
  }, true);

  urlInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      stop(event);
      loadUrl();
    }
  }, true);

  closeViewer?.addEventListener("click", (event) => {
    stop(event);
    closeViewerPanel();
  }, true);

  backBtn?.addEventListener("click", (event) => {
    stop(event);
    ipcRenderer.invoke("browser:back");
  }, true);

  forwardBtn?.addEventListener("click", (event) => {
    stop(event);
    ipcRenderer.invoke("browser:forward");
  }, true);

  reloadBtn?.addEventListener("click", (event) => {
    stop(event);
    ipcRenderer.invoke("browser:reload");
  }, true);

  homeBtn?.addEventListener("click", (event) => {
    stop(event);
    clearViewer();
  }, true);

  openNormalBtn?.addEventListener("click", (event) => {
    stop(event);

    const safeUrl = normalizeUrl(getUrlInput()?.value || lastLoadedUrl);

    if (!safeUrl) {
      setStatus("Invalid URL");
      return;
    }

    ipcRenderer.invoke("browser:open-external", safeUrl);
  }, true);

  deviceSelect?.addEventListener("change", (event) => {
    stop(event);

    if (lastLoadedUrl) {
      renderElectronBrowserShell(lastLoadedUrl);

      requestAnimationFrame(() => {
        ipcRenderer.invoke("browser:set-bounds", getBrowserSlotBounds());
      });
    }
  }, true);

  window.addEventListener("resize", resizeBrowserView);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if ($("modalBackdrop")?.classList.contains("active")) {
        closeModal();
      } else if ($("viewer")?.classList.contains("active")) {
        closeViewerPanel();
      }
    }
  }, true);
});

ipcRenderer.on("browser:url-changed", (_, url) => {
  lastLoadedUrl = url;

  const urlInput = getUrlInput();

  if (urlInput) {
    urlInput.value = url;
  }
});

ipcRenderer.on("browser:status", (_, status) => {
  setStatus(status);
});
