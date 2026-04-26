const { dialog } = require("electron");

function registerSystemHandlers(ipcMain, browserWindow) {
  ipcMain.handle("fs:pickRagFiles", async () => {
    const result = await dialog.showOpenDialog(browserWindow, {
      title: "选择 RAG 文件",
      buttonLabel: "添加文件",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Supported Files", extensions: ["txt", "md", "pdf"] }]
    });
    if (result.canceled || !result.filePaths.length) {
      return [];
    }
    return result.filePaths;
  });

  ipcMain.handle("fs:pickImageFile", async () => {
    const result = await dialog.showOpenDialog(browserWindow, {
      title: "选择参考图",
      buttonLabel: "选择图片",
      properties: ["openFile"],
      filters: [{ name: "Image Files", extensions: ["png", "jpg", "jpeg"] }]
    });
    if (result.canceled || !result.filePaths.length) {
      return "";
    }
    return result.filePaths[0];
  });
}

module.exports = {
  registerSystemHandlers
};

