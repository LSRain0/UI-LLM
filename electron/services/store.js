const {
  initDatabase,
  getConfig,
  setMonthlyLimit,
  setThemeMode,
  allowCurrentRequestOverLimit,
  consumeOverLimitAllowance,
  getRecentExports,
  setRecentExports,
  listProviders,
  getProviderById,
  saveProvider,
  deleteProviderById,
  getCurrentMonthCost,
  addUsageRecord,
  upsertConversation,
  addMessage,
  listConversations,
  listMessagesByConversationId,
  getConversationById,
  renameConversationById,
  renameConversationsByRule,
  deleteConversationById,
  deleteConversationsByIds,
  insertRagDocument,
  insertRagChunkWithVector,
  listRagVectors
} = require("./db");

function initStore(userDataPath) {
  initDatabase(userDataPath);
}

function getState() {
  const config = getConfig();
  return {
    ...config,
    providers: listProviders()
  };
}

function upsertProvider(provider) {
  saveProvider(provider);
}

function removeProvider(providerId) {
  return deleteProviderById(providerId);
}

function updateMonthlyLimit(amount) {
  setMonthlyLimit(amount);
}

function updateThemeMode(mode) {
  return setThemeMode(mode);
}

function allowOneRequestOverLimit() {
  allowCurrentRequestOverLimit();
}

function listRecentExports() {
  return getRecentExports();
}

function saveRecentExports(items) {
  setRecentExports(items);
}

function assertWithinMonthlyLimit(expectedCostCny) {
  const config = getConfig();
  if (config.monthlyLimitCny <= 0) {
    return;
  }

  const total = getCurrentMonthCost();
  if (total + expectedCostCny <= config.monthlyLimitCny) {
    return;
  }

  if (config.temporaryOverLimitForOneRequest) {
    consumeOverLimitAllowance();
    return;
  }

  throw new Error("已达到每月限额，默认已阻断。你可手动放开本次请求。");
}

function recordUsage(entry) {
  addUsageRecord(entry);
}

function findProvider(providerId) {
  return getProviderById(providerId);
}

function saveConversation(conversation) {
  upsertConversation(conversation);
}

function saveMessage(message) {
  addMessage(message);
}

function saveRagDocument(doc) {
  insertRagDocument(doc);
}

function saveRagChunkWithVector(item) {
  insertRagChunkWithVector(item);
}

function getAllRagVectors() {
  return listRagVectors();
}

function getConversations(options) {
  return listConversations(options);
}

function getConversationMessages(conversationId, limit) {
  return listMessagesByConversationId(conversationId, limit);
}

function getConversation(conversationId) {
  return getConversationById(conversationId);
}

function renameConversation(conversationId, title) {
  return renameConversationById(conversationId, title);
}

function renameConversations(items) {
  return renameConversationsByRule(items);
}

function deleteConversation(conversationId) {
  return deleteConversationById(conversationId);
}

function deleteConversations(conversationIds) {
  return deleteConversationsByIds(conversationIds);
}

module.exports = {
  initStore,
  getState,
  upsertProvider,
  removeProvider,
  updateMonthlyLimit,
  updateThemeMode,
  allowOneRequestOverLimit,
  listRecentExports,
  saveRecentExports,
  assertWithinMonthlyLimit,
  recordUsage,
  findProvider,
  saveConversation,
  saveMessage,
  saveRagDocument,
  saveRagChunkWithVector,
  getAllRagVectors,
  getConversations,
  getConversationMessages,
  getConversation,
  renameConversation,
  renameConversations,
  deleteConversation,
  deleteConversations
};
