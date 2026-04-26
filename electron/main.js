const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { registerConfigHandlers } = require("./ipc/configHandlers");
const { registerFeatureHandlers } = require("./ipc/featureHandlers");
const { registerSystemHandlers } = require("./ipc/systemHandlers");
const { registerHistoryHandlers } = require("./ipc/historyHandlers");
const { initStore } = require("./services/store");
const { cleanupLogs } = require("./services/logManager");

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  return win;
}

app.whenReady().then(() => {
  try {
    const userDataPath = app.getPath("userData");
    initStore(userDataPath);
    cleanupLogs(path.join(userDataPath, "logs"));
    registerConfigHandlers(ipcMain);
    registerFeatureHandlers(ipcMain, userDataPath);
    const win = createWindow();
    registerSystemHandlers(ipcMain, win);
    registerHistoryHandlers(ipcMain, win);
  } catch (error) {
    dialog.showErrorBox("启动失败", String(error?.message || error || "未知错误"));
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
