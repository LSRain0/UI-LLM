const crypto = require("node:crypto");
const {
  getState,
  upsertProvider,
  removeProvider,
  updateMonthlyLimit,
  updateThemeMode,
  allowOneRequestOverLimit
} = require("../services/store");
const { setApiKey, deleteApiKey } = require("../services/credentials");

function toSafeProvider(provider) {
  const { apiKey, ...rest } = provider;
  return rest;
}

function registerConfigHandlers(ipcMain) {
  ipcMain.handle("providers:list", async () => {
    const { providers } = getState();
    return providers.map(toSafeProvider);
  });

  ipcMain.handle("providers:save", async (_event, provider) => {
    const refId = provider.credentialRefId || crypto.randomUUID();
    const next = {
      ...provider,
      credentialRefId: refId
    };

    if (provider.apiKey) {
      await setApiKey(refId, provider.apiKey);
    } else if (provider.apiKey === "" && provider.credentialRefId) {
      await deleteApiKey(provider.credentialRefId);
    }
    upsertProvider(next);
    return toSafeProvider(next);
  });

  ipcMain.handle("providers:delete", async (_event, providerId) => {
    const credentialRefId = removeProvider(providerId);
    if (!credentialRefId) {
      return false;
    }
    await deleteApiKey(credentialRefId);
    return true;
  });

  ipcMain.handle("config:get", async () => getState());

  ipcMain.handle("config:setMonthlyLimit", async (_event, amount) => {
    updateMonthlyLimit(amount);
    return getState().monthlyLimitCny;
  });

  ipcMain.handle("config:setThemeMode", async (_event, mode) => {
    updateThemeMode(mode);
    return getState().themeMode;
  });

  ipcMain.handle("config:allowCurrentRequestOverLimit", async () => {
    allowOneRequestOverLimit();
    return true;
  });
}

module.exports = {
  registerConfigHandlers
};
