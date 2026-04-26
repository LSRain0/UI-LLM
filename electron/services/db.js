const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

let db;

function nowIso() {
  return new Date().toISOString();
}

function monthKey() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

function initDatabase(userDataPath) {
  if (userDataPath && !fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  const dbPath = path.join(userDataPath, "app.db");
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      input_cost_per_1k REAL DEFAULT 0,
      output_cost_per_1k REAL DEFAULT 0,
      image_cost_per_call REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      supports_chat INTEGER DEFAULT 0,
      supports_image INTEGER DEFAULT 0,
      supports_embedding INTEGER DEFAULT 0,
      FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      aborted INTEGER DEFAULT 0,
      error_text TEXT DEFAULT "",
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      cost_cny REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rag_documents (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      snapshot_path TEXT NOT NULL,
      content_hash TEXT,
      file_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text_content TEXT NOT NULL,
      token_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rag_vectors (
      id TEXT PRIMARY KEY,
      chunk_id TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      vector_dim INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(chunk_id) REFERENCES rag_chunks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS usage_ledger (
      id TEXT PRIMARY KEY,
      month_key TEXT NOT NULL,
      provider_id TEXT,
      model_id TEXT,
      feature TEXT NOT NULL,
      cost_cny REAL NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const messageCols = db.prepare(`PRAGMA table_info(messages)`).all().map((r) => r.name);
  if (!messageCols.includes("aborted")) {
    db.exec(`ALTER TABLE messages ADD COLUMN aborted INTEGER DEFAULT 0`);
  }
  if (!messageCols.includes("error_text")) {
    db.exec(`ALTER TABLE messages ADD COLUMN error_text TEXT DEFAULT ""`);
  }

  upsertConfig("monthly_limit_cny", "0");
  upsertConfig("temporary_over_limit_for_one_request", "false");
  upsertConfig("theme_mode", "deep");
}

function upsertConfig(key, value) {
  db.prepare(
    `INSERT INTO app_config(key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function readConfig(key, fallback) {
  const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function getConfig() {
  return {
    monthlyLimitCny: Number(readConfig("monthly_limit_cny", "0")),
    temporaryOverLimitForOneRequest: readConfig("temporary_over_limit_for_one_request", "false") === "true",
    themeMode: readConfig("theme_mode", "deep")
  };
}

function setMonthlyLimit(value) {
  upsertConfig("monthly_limit_cny", String(value));
}

function allowCurrentRequestOverLimit() {
  upsertConfig("temporary_over_limit_for_one_request", "true");
}

function setThemeMode(mode) {
  const value = String(mode || "").trim();
  const normalized = ["deep", "dark", "light"].includes(value) ? value : "deep";
  upsertConfig("theme_mode", normalized);
  return normalized;
}

function consumeOverLimitAllowance() {
  upsertConfig("temporary_over_limit_for_one_request", "false");
}

function getRecentExports() {
  const raw = readConfig("recent_exports_json", "[]");
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function setRecentExports(items) {
  const list = Array.isArray(items) ? items : [];
  upsertConfig("recent_exports_json", JSON.stringify(list));
}

function listProviders() {
  const providers = db.prepare("SELECT * FROM providers ORDER BY updated_at DESC").all();
  const modelStmt = db.prepare("SELECT * FROM provider_models WHERE provider_id = ? ORDER BY id ASC");
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.base_url,
    credentialRefId: p.credential_ref_id,
    inputCostPer1k: p.input_cost_per_1k,
    outputCostPer1k: p.output_cost_per_1k,
    imageCostPerCall: p.image_cost_per_call,
    models: modelStmt.all(p.id).map((m) => ({
      id: m.model_id,
      name: m.model_name,
      supportsChat: Boolean(m.supports_chat),
      supportsImage: Boolean(m.supports_image),
      supportsEmbedding: Boolean(m.supports_embedding)
    }))
  }));
}

function getProviderById(providerId) {
  const p = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId);
  if (!p) {
    return null;
  }
  const models = db
    .prepare("SELECT * FROM provider_models WHERE provider_id = ? ORDER BY id ASC")
    .all(providerId)
    .map((m) => ({
      id: m.model_id,
      name: m.model_name,
      supportsChat: Boolean(m.supports_chat),
      supportsImage: Boolean(m.supports_image),
      supportsEmbedding: Boolean(m.supports_embedding)
    }));
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.base_url,
    credentialRefId: p.credential_ref_id,
    inputCostPer1k: p.input_cost_per_1k,
    outputCostPer1k: p.output_cost_per_1k,
    imageCostPerCall: p.image_cost_per_call,
    models
  };
}

function saveProvider(provider) {
  const ts = nowIso();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO providers (
        id, name, base_url, credential_ref_id,
        input_cost_per_1k, output_cost_per_1k, image_cost_per_call,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        base_url = excluded.base_url,
        credential_ref_id = excluded.credential_ref_id,
        input_cost_per_1k = excluded.input_cost_per_1k,
        output_cost_per_1k = excluded.output_cost_per_1k,
        image_cost_per_call = excluded.image_cost_per_call,
        updated_at = excluded.updated_at`
    ).run(
      provider.id,
      provider.name,
      provider.baseUrl,
      provider.credentialRefId,
      provider.inputCostPer1k || 0,
      provider.outputCostPer1k || 0,
      provider.imageCostPerCall || 0,
      ts,
      ts
    );

    db.prepare("DELETE FROM provider_models WHERE provider_id = ?").run(provider.id);
    const insertModel = db.prepare(
      `INSERT INTO provider_models (
        provider_id, model_id, model_name, supports_chat, supports_image, supports_embedding
      ) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const model of provider.models || []) {
      insertModel.run(
        provider.id,
        model.id,
        model.name,
        model.supportsChat ? 1 : 0,
        model.supportsImage ? 1 : 0,
        model.supportsEmbedding ? 1 : 0
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function deleteProviderById(providerId) {
  const row = db.prepare("SELECT credential_ref_id FROM providers WHERE id = ?").get(providerId);
  if (!row) {
    return null;
  }
  db.prepare("DELETE FROM providers WHERE id = ?").run(providerId);
  return row.credential_ref_id;
}

function getCurrentMonthCost() {
  const key = monthKey();
  const row = db
    .prepare("SELECT COALESCE(SUM(cost_cny), 0) AS total FROM usage_ledger WHERE month_key = ?")
    .get(key);
  return Number(row.total || 0);
}

function addUsageRecord(entry) {
  db.prepare(
    `INSERT INTO usage_ledger (
      id, month_key, provider_id, model_id, feature, cost_cny, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.id,
    monthKey(),
    entry.providerId || null,
    entry.modelId || null,
    entry.feature,
    entry.costCny,
    entry.source,
    nowIso()
  );
}

function upsertConversation(conversation) {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO conversations (
      id, provider_id, model_id, title, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider_id = excluded.provider_id,
      model_id = excluded.model_id,
      title = excluded.title,
      updated_at = excluded.updated_at`
  ).run(conversation.id, conversation.providerId, conversation.modelId, conversation.title || "", ts, ts);
}

function addMessage(message) {
  db.prepare(
    `INSERT INTO messages (
      id, conversation_id, role, content, aborted, error_text, prompt_tokens, completion_tokens, cost_cny, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    message.id,
    message.conversationId,
    message.role,
    message.content,
    message.aborted ? 1 : 0,
    message.errorText || "",
    message.promptTokens || 0,
    message.completionTokens || 0,
    message.costCny || 0,
    nowIso()
  );
}

function listConversations(options = {}) {
  const { providerId, modelId, keyword, sortBy } = options;
  const where = [];
  const params = [];
  if (providerId) {
    where.push("c.provider_id = ?");
    params.push(providerId);
  }
  if (modelId) {
    where.push("c.model_id = ?");
    params.push(modelId);
  }
  if (keyword) {
    where.push("(c.title LIKE ? OR m.content LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortMap = {
    updated_desc: "c.updated_at DESC",
    updated_asc: "c.updated_at ASC",
    created_desc: "c.created_at DESC",
    created_asc: "c.created_at ASC"
  };
  const orderBySql = sortMap[sortBy] || sortMap.updated_desc;
  return db
    .prepare(
      `SELECT
        c.id AS id,
        c.provider_id AS provider_id,
        c.model_id AS model_id,
        c.title AS title,
        c.created_at AS created_at,
        c.updated_at AS updated_at,
        COUNT(m.id) AS message_count
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      ${whereSql}
      GROUP BY c.id
      ORDER BY ${orderBySql}`
    )
    .all(...params)
    .map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      modelId: row.model_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: Number(row.message_count || 0)
    }));
}

function deleteConversationsByIds(conversationIds) {
  const ids = Array.isArray(conversationIds) ? conversationIds.filter(Boolean) : [];
  if (ids.length === 0) {
    return 0;
  }
  const placeholders = ids.map(() => "?").join(", ");
  const result = db.prepare(`DELETE FROM conversations WHERE id IN (${placeholders})`).run(...ids);
  return Number(result.changes || 0);
}

function listMessagesByConversationId(conversationId, limit) {
  const sql = limit
    ? `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`
    : `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`;
  const rows = limit ? db.prepare(sql).all(conversationId, limit) : db.prepare(sql).all(conversationId);
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    aborted: Boolean(row.aborted),
    errorText: row.error_text || "",
    promptTokens: Number(row.prompt_tokens || 0),
    completionTokens: Number(row.completion_tokens || 0),
    costCny: Number(row.cost_cny || 0),
    createdAt: row.created_at
  }));
}

function getConversationById(conversationId) {
  const row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    providerId: row.provider_id,
    modelId: row.model_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function renameConversationById(conversationId, title) {
  const ts = nowIso();
  const result = db
    .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
    .run(String(title || "").trim(), ts, conversationId);
  return Number(result.changes || 0) > 0;
}

function renameConversationsByRule(items) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) {
    return 0;
  }
  const ts = nowIso();
  const stmt = db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    let changed = 0;
    for (const item of rows) {
      if (!item?.conversationId) {
        continue;
      }
      const title = String(item.title || "").trim();
      const result = stmt.run(title, ts, item.conversationId);
      changed += Number(result.changes || 0);
    }
    db.exec("COMMIT");
    return changed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function deleteConversationById(conversationId) {
  const result = db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
  return Number(result.changes || 0) > 0;
}

function insertRagDocument(doc) {
  db.prepare(
    `INSERT INTO rag_documents (
      id, file_name, file_path, snapshot_path, content_hash, file_size, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(doc.id, doc.fileName, doc.filePath, doc.snapshotPath, doc.contentHash || "", doc.fileSize, nowIso());
}

function insertRagChunkWithVector(item) {
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO rag_chunks (
        id, document_id, chunk_index, text_content, token_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(item.chunkId, item.documentId, item.chunkIndex, item.textContent, item.tokenCount || 0, nowIso());

    db.prepare(
      `INSERT INTO rag_vectors (
        id, chunk_id, embedding_json, vector_dim, created_at
      ) VALUES (?, ?, ?, ?, ?)`
    ).run(item.vectorId, item.chunkId, JSON.stringify(item.embedding), item.embedding.length, nowIso());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function listRagVectors() {
  return db
    .prepare(
      `SELECT
        rv.id AS vector_id,
        rv.embedding_json AS embedding_json,
        rv.vector_dim AS vector_dim,
        rc.id AS chunk_id,
        rc.text_content AS text_content,
        rc.document_id AS document_id
      FROM rag_vectors rv
      JOIN rag_chunks rc ON rc.id = rv.chunk_id`
    )
    .all()
    .map((row) => ({
      vectorId: row.vector_id,
      vectorDim: row.vector_dim,
      chunkId: row.chunk_id,
      documentId: row.document_id,
      textContent: row.text_content,
      embedding: JSON.parse(row.embedding_json)
    }));
}

module.exports = {
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
};
