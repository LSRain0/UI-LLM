const path = require("node:path");
const fs = require("node:fs");
const { dialog, shell, app } = require("electron");
const {
  getConversation,
  getConversations,
  getConversationMessages,
  renameConversation,
  renameConversations,
  deleteConversation,
  deleteConversations,
  listRecentExports,
  saveRecentExports
} = require("../services/store");
const { normalizeTitle, writeConversationExport } = require("../services/exportService");

const FORMAT_EXT = {
  json: "json",
  md: "md",
  pdf: "pdf"
};

function ensureDirExists(dirPath) {
  if (!dirPath) {
    return;
  }
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getDefaultExportDir() {
  const docs = app.getPath("documents");
  const dir = path.join(docs, "UI-LLM Exports");
  ensureDirExists(dir);
  return dir;
}

function buildExportPayload(conversationId) {
  const conversation = getConversation(conversationId);
  if (!conversation) {
    throw new Error("会话不存在");
  }
  const messages = getConversationMessages(conversationId);
  return { conversation, messages };
}

function ensureUniquePath(filePath) {
  if (!fs.existsSync(filePath)) {
    return filePath;
  }
  const ext = path.extname(filePath);
  const name = path.basename(filePath, ext);
  const dir = path.dirname(filePath);
  let idx = 1;
  let candidate = filePath;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${name}_${idx}${ext}`);
    idx += 1;
  }
  return candidate;
}

function registerHistoryHandlers(ipcMain, mainWindow) {
  ipcMain.handle("history:list", async (_event, payload) => {
    return getConversations({
      providerId: payload?.providerId || "",
      modelId: payload?.modelId || "",
      keyword: payload?.keyword || "",
      sortBy: payload?.sortBy || "updated_desc"
    });
  });

  ipcMain.handle("history:messages", async (_event, conversationId) => {
    if (!conversationId) {
      return [];
    }
    return getConversationMessages(conversationId);
  });

  ipcMain.handle("history:rename", async (_event, payload) => {
    if (!payload?.conversationId) {
      throw new Error("缺少 conversationId");
    }
    return renameConversation(payload.conversationId, payload.title || "");
  });

  ipcMain.handle("history:renameBatch", async (_event, payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return renameConversations(items);
  });

  ipcMain.handle("history:delete", async (_event, conversationId) => {
    if (!conversationId) {
      throw new Error("缺少 conversationId");
    }
    return deleteConversation(conversationId);
  });

  ipcMain.handle("history:deleteBatch", async (_event, conversationIds) => {
    const ids = Array.isArray(conversationIds) ? conversationIds : [];
    return deleteConversations(ids);
  });

  ipcMain.handle("history:openPath", async (_event, targetPath) => {
    const filePath = String(targetPath || "").trim();
    if (!filePath) {
      return { ok: false, error: "缺少路径" };
    }
    const errorText = await shell.openPath(filePath);
    if (!errorText) {
      return { ok: true, error: "" };
    }
    return { ok: false, error: String(errorText) };
  });

  ipcMain.handle("history:recentExports:get", async () => {
    return listRecentExports();
  });

  ipcMain.handle("history:recentExports:set", async (_event, items) => {
    const normalized = Array.isArray(items) ? items.slice(0, 20) : [];
    saveRecentExports(normalized);
    return true;
  });

  ipcMain.handle("history:pathsStatus", async (_event, paths) => {
    const list = Array.isArray(paths) ? paths : [];
    return list.map((item) => {
      const targetPath = String(item || "");
      return {
        path: targetPath,
        exists: targetPath ? fs.existsSync(targetPath) : false
      };
    });
  });

  ipcMain.handle("history:export", async (_event, payload) => {
    const format = payload?.format;
    if (!FORMAT_EXT[format]) {
      throw new Error("导出格式仅支持 json/md/pdf");
    }
    const data = buildExportPayload(payload.conversationId);
    const title = normalizeTitle(data.conversation.title || data.conversation.id);
    const defaultPath = path.join(getDefaultExportDir(), `${title}.${FORMAT_EXT[format]}`);
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: format.toUpperCase(), extensions: [FORMAT_EXT[format]] }]
    });
    if (result.canceled || !result.filePath) {
      return { exported: false, filePath: "" };
    }
    await writeConversationExport({
      format,
      targetPath: result.filePath,
      data
    });
    let openedDirectory = false;
    let openError = "";
    if (payload?.openDirAfterExport) {
      const errorText = await shell.openPath(path.dirname(result.filePath));
      if (!errorText) {
        openedDirectory = true;
      } else {
        openError = String(errorText);
      }
    }
    return { exported: true, filePath: result.filePath, openedDirectory, openError };
  });

  ipcMain.handle("history:exportBatch", async (_event, payload) => {
    const format = payload?.format;
    if (!FORMAT_EXT[format]) {
      throw new Error("导出格式仅支持 json/md/pdf");
    }
    const conversationIds = Array.isArray(payload?.conversationIds) ? payload.conversationIds.filter(Boolean) : [];
    if (conversationIds.length === 0) {
      return { exported: false, exportedCount: 0, directoryPath: "", files: [] };
    }
    const dirPick = await dialog.showOpenDialog(mainWindow, {
      title: "选择导出目录",
      defaultPath: getDefaultExportDir(),
      properties: ["openDirectory", "createDirectory"]
    });
    if (dirPick.canceled || !Array.isArray(dirPick.filePaths) || dirPick.filePaths.length === 0) {
      return { exported: false, exportedCount: 0, directoryPath: "", files: [] };
    }
    const directoryPath = dirPick.filePaths[0];
    const files = [];
    for (const conversationId of conversationIds) {
      const data = buildExportPayload(conversationId);
      const title = normalizeTitle(data.conversation.title || data.conversation.id);
      const targetPath = ensureUniquePath(path.join(directoryPath, `${title}.${FORMAT_EXT[format]}`));
      await writeConversationExport({
        format,
        targetPath,
        data
      });
      files.push(targetPath);
    }
    let openedDirectory = false;
    let openError = "";
    if (payload?.openDirAfterExport) {
      const errorText = await shell.openPath(directoryPath);
      if (!errorText) {
        openedDirectory = true;
      } else {
        openError = String(errorText);
      }
    }
    return {
      exported: true,
      exportedCount: files.length,
      directoryPath,
      files,
      openedDirectory,
      openError
    };
  });
}

module.exports = {
  registerHistoryHandlers
};
