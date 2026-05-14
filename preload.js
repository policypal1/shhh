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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character];
  });
}

function setStatus(message) {
  const status = $("browserStatus");

  if (status) {
    status.textContent = message;
  }
}

function getSelectedDeviceSize() {
  const deviceSelect = $("deviceSelect");
  const value = deviceSelect?.value || "390x844";
  const [width, height] = value.split("x").map(Number);

  return {
    width: width || 390,
    height: height || 844
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
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
}

function renderElectronBrowserShell(url) {
  const viewerStage = $("viewerStage");
  const browserUrlInput = $("browserUrlInput");
  const { width, height } = getSelectedDeviceSize();

  if (!viewerStage) return;

  lastLoadedUrl = url;

  if (browserUrlInput) {
    browserUrlInput.value = url;
  }

  viewerStage.innerHTML = `
    <div class="device-shell" style="width: ${width + 34}px; height: ${height + 72}px;">
      <div class="device-top">
        <span class="device-dot"></span>
        <span class="device-dot"></span>
        <span class="device-dot"></span>
        <span class="device-title">${escapeHtml(url)}</span>
      </div>

      <div
        id="electronBrowserSlot"
        style="
          width: 100%;
          flex: 1;
          border-radius: 18px;
          background: #fff;
          overflow: hidden;
        "
      ></div>
    </div>

    <div class="viewer-note">
      Electron mode: this loads websites in a real Chromium view instead of a normal iframe.
    </div>
  `;
}

async function loadUrl() {
  const browserUrlInput = $("browserUrlInput");
  const safeUrl = normalizeUrl(browserUrlInput?.value);

  if (!safeUrl) {
    setStatus("Invalid URL");
    browserUrlInput?.focus();
    return;
  }

  setStatus("Loading");
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
  });
}

async function resizeBrowserView() {
  if (!lastLoadedUrl) return;

  await ipcRenderer.invoke("browser:set-bounds", getBrowserSlotBounds());
}

async function clearViewer() {
  const viewerStage = $("viewerStage");
  const browserUrlInput = $("browserUrlInput");

  lastLoadedUrl = "";

  if (browserUrlInput) {
    browserUrlInput.value = "";
  }

  if (viewerStage) {
    viewerStage.innerHTML = `
      <div class="empty-state">
        <strong>Private URL Viewer</strong>
        Paste a normal website link above and press Enter.
      </div>
      <div class="viewer-note">This is a local hidden viewer, not a filter bypass or untrackable browser.</div>
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
  const browserUrlInput = $("browserUrlInput");

  viewer?.classList.add("active");
  viewer?.setAttribute("aria-hidden", "false");

  setTimeout(() => {
    browserUrlInput?.focus();
    resizeBrowserView();
  }, 75);
}

async function closeViewer() {
  const viewer = $("viewer");

  viewer?.classList.remove("active");
  viewer?.setAttribute("aria-hidden", "true");

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
  const trigger = $("trigger");
  const modalBackdrop = $("modalBackdrop");
  const pwInput = $("pwInput");
  const pwSubmit = $("pwSubmit");
  const pwCancel = $("pwCancel");
  const urlForm = $("urlForm");
  const loadBtn = $("loadBtn");
  const closeViewerBtn = $("closeViewer");
  const backBtn = $("backBtn");
  const forwardBtn = $("forwardBtn");
  const reloadBtn = $("reloadBtn");
  const homeBtn = $("homeBtn");
  const openNormalBtn = $("openNormalBtn");
  const deviceSelect = $("deviceSelect");

  trigger?.addEventListener(
    "click",
    (event) => {
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
    },
    true
  );

  pwSubmit?.addEventListener(
    "click",
    (event) => {
      stop(event);
      checkPassword();
    },
    true
  );

  pwInput?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        stop(event);
        checkPassword();
      }
    },
    true
  );

  pwCancel?.addEventListener(
    "click",
    (event) => {
      stop(event);
      closeModal();
    },
    true
  );

  modalBackdrop?.addEventListener(
    "click",
    (event) => {
      if (event.target === modalBackdrop) {
        stop(event);
        closeModal();
      }
    },
    true
  );

  urlForm?.addEventListener(
    "submit",
    (event) => {
      stop(event);
      loadUrl();
    },
    true
  );

  loadBtn?.addEventListener(
    "click",
    (event) => {
      stop(event);
      loadUrl();
    },
    true
  );

  closeViewerBtn?.addEventListener(
    "click",
    (event) => {
      stop(event);
      closeViewer();
    },
    true
  );

  backBtn?.addEventListener(
    "click",
    (event) => {
      stop(event);
      ipcRenderer.invoke("browser:back");
    },
    true
  );

  forwardBtn?.addEventListener(
    "click",
    (event) => {
      stop(event);
      ipcRenderer.invoke("browser:forward");
    },
    true
  );

  reloadBtn?.addEventListener(
    "click",
    (event) => {
      stop(event);
      ipcRenderer.invoke("browser:reload");
    },
    true
  );

  homeBtn?.addEventListener(
    "click",
    (event) => {
      stop(event);
      clearViewer();
    },
    true
  );

  openNormalBtn?.addEventListener(
    "click",
    (event) => {
      stop(event);

      const safeUrl = normalizeUrl($("browserUrlInput")?.value || lastLoadedUrl);

      if (!safeUrl) {
        setStatus("Invalid URL");
        return;
      }

      ipcRenderer.invoke("browser:open-external", safeUrl);
    },
    true
  );

  deviceSelect?.addEventListener(
    "change",
    (event) => {
      stop(event);

      if (lastLoadedUrl) {
        renderElectronBrowserShell(lastLoadedUrl);

        requestAnimationFrame(() => {
          ipcRenderer.invoke("browser:set-bounds", getBrowserSlotBounds());
        });
      }
    },
    true
  );

  window.addEventListener("resize", () => {
    resizeBrowserView();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        if ($("modalBackdrop")?.classList.contains("active")) {
          closeModal();
        } else if ($("viewer")?.classList.contains("active")) {
          closeViewer();
        }
      }
    },
    true
  );
});

ipcRenderer.on("browser:url-changed", (_, url) => {
  lastLoadedUrl = url;

  const browserUrlInput = $("browserUrlInput");

  if (browserUrlInput) {
    browserUrlInput.value = url;
  }
});

ipcRenderer.on("browser:status", (_, status) => {
  setStatus(status);
});
