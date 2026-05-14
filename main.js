const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require("electron");
const path = require("path");

let mainWindow;
let browserView;
let lastBounds = { x: -10000, y: -10000, width: 1, height: 1 };

function normalizeUrl(input) {
  let value = String(input || "").trim();

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

function hideBrowserView() {
  if (!browserView) return;

  lastBounds = { x: -10000, y: -10000, width: 1, height: 1 };
  browserView.setBounds(lastBounds);
}

function setBrowserBounds(bounds) {
  if (!browserView || !bounds) return;

  const cleanBounds = {
    x: Math.round(Number(bounds.x) || 0),
    y: Math.round(Number(bounds.y) || 0),
    width: Math.max(1, Math.round(Number(bounds.width) || 1)),
    height: Math.max(1, Math.round(Number(bounds.height) || 1))
  };

  lastBounds = cleanBounds;
  browserView.setBounds(cleanBounds);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1250,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    title: "Historical Archives Quarterly",
    backgroundColor: "#f9f6f1",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile("index.html");

  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:hidden-url-viewer"
    }
  });

  mainWindow.contentView.addChildView(browserView);
  hideBrowserView();

  browserView.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = normalizeUrl(url);

    if (safeUrl) {
      browserView.webContents.loadURL(safeUrl);
    }

    return { action: "deny" };
  });

  browserView.webContents.on("did-navigate", (_, url) => {
    mainWindow.webContents.send("browser:url-changed", url);
  });

  browserView.webContents.on("did-navigate-in-page", (_, url) => {
    mainWindow.webContents.send("browser:url-changed", url);
  });

  browserView.webContents.on("did-start-loading", () => {
    mainWindow.webContents.send("browser:status", "Loading");
  });

  browserView.webContents.on("did-stop-loading", () => {
    mainWindow.webContents.send("browser:status", "Ready");
  });

  mainWindow.on("resize", () => {
    browserView.setBounds(lastBounds);
  });
}

ipcMain.handle("browser:load-url", async (_, payload) => {
  const safeUrl = normalizeUrl(payload?.url);

  if (!safeUrl) {
    return {
      success: false,
      error: "Only normal http:// and https:// links are allowed."
    };
  }

  setBrowserBounds(payload.bounds);
  await browserView.webContents.loadURL(safeUrl);

  return {
    success: true,
    url: safeUrl
  };
});

ipcMain.handle("browser:set-bounds", (_, bounds) => {
  setBrowserBounds(bounds);
  return { success: true };
});

ipcMain.handle("browser:hide", () => {
  hideBrowserView();
  return { success: true };
});

ipcMain.handle("browser:back", () => {
  if (browserView.webContents.canGoBack()) {
    browserView.webContents.goBack();
  }

  return { success: true };
});

ipcMain.handle("browser:forward", () => {
  if (browserView.webContents.canGoForward()) {
    browserView.webContents.goForward();
  }

  return { success: true };
});

ipcMain.handle("browser:reload", () => {
  browserView.webContents.reload();
  return { success: true };
});

ipcMain.handle("browser:open-external", async (_, rawUrl) => {
  const safeUrl = normalizeUrl(rawUrl);

  if (!safeUrl) {
    return {
      success: false,
      error: "Invalid URL."
    };
  }

  await shell.openExternal(safeUrl);

  return {
    success: true,
    url: safeUrl
  };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
