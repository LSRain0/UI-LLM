const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getProviders: () => ipcRenderer.invoke("providers:list"),
  saveProvider: (provider) => ipcRenderer.invoke("providers:save", provider),
  deleteProvider: (providerId) => ipcRenderer.invoke("providers:delete", providerId),

  getAppConfig: () => ipcRenderer.invoke("config:get"),
  setMonthlyLimit: (amount) => ipcRenderer.invoke("config:setMonthlyLimit", amount),
  setThemeMode: (mode) => ipcRenderer.invoke("config:setThemeMode", mode),
  allowCurrentRequestOverLimit: () => ipcRenderer.invoke("config:allowCurrentRequestOverLimit"),

  sendChat: (payload) => ipcRenderer.invoke("chat:send", payload),
  startChatStream: (payload) => ipcRenderer.invoke("chat:stream:start", payload),
  stopChatStream: (payload) => ipcRenderer.invoke("chat:stream:stop", payload),
  onChatStreamDelta: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("chat:stream:delta", listener);
    return () => ipcRenderer.removeListener("chat:stream:delta", listener);
  },
  onChatStreamDone: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("chat:stream:done", listener);
    return () => ipcRenderer.removeListener("chat:stream:done", listener);
  },
  onChatStreamError: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("chat:stream:error", listener);
    return () => ipcRenderer.removeListener("chat:stream:error", listener);
  },
  generateImage: (payload) => ipcRenderer.invoke("image:generate", payload),
  runRagSearch: (payload) => ipcRenderer.invoke("rag:search", payload),
  ingestRagFiles: (payload) => ipcRenderer.invoke("rag:ingest", payload),
  listHistory: (payload) => ipcRenderer.invoke("history:list", payload),
  getHistoryMessages: (conversationId) => ipcRenderer.invoke("history:messages", conversationId),
  renameHistoryConversation: (payload) => ipcRenderer.invoke("history:rename", payload),
  renameHistoryConversations: (payload) => ipcRenderer.invoke("history:renameBatch", payload),
  deleteHistoryConversation: (conversationId) => ipcRenderer.invoke("history:delete", conversationId),
  deleteHistoryConversations: (conversationIds) => ipcRenderer.invoke("history:deleteBatch", conversationIds),
  openHistoryPath: (targetPath) => ipcRenderer.invoke("history:openPath", targetPath),
  getRecentExports: () => ipcRenderer.invoke("history:recentExports:get"),
  setRecentExports: (items) => ipcRenderer.invoke("history:recentExports:set", items),
  checkHistoryPaths: (paths) => ipcRenderer.invoke("history:pathsStatus", paths),
  exportConversation: (payload) => ipcRenderer.invoke("history:export", payload),
  exportHistoryConversations: (payload) => ipcRenderer.invoke("history:exportBatch", payload),

  pickRagFiles: () => ipcRenderer.invoke("fs:pickRagFiles"),
  pickImageFile: () => ipcRenderer.invoke("fs:pickImageFile")
});
