const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const {
  assertWithinMonthlyLimit,
  recordUsage,
  findProvider,
  saveConversation,
  saveMessage,
  saveRagDocument,
  saveRagChunkWithVector,
  getAllRagVectors,
  getConversationMessages
} = require("../services/store");
const { createChatCompletion, createChatCompletionStream, createEmbedding, createImage, assertImageConstraints } = require("../services/llmClient");
const { estimateTokens, chunkText, parseFileText, createSnapshot, cosineSimilarity } = require("../services/ragService");

const CHAT_TIMEOUT_MS = 60_000;
const CHAT_STREAM_TIMEOUT_MS = 180_000;
const RAG_TIMEOUT_MS = 90_000;
const IMAGE_TIMEOUT_MS = 120_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 4096;
const MAX_FILES = 3;
const MAX_TOTAL_UPLOAD_BYTES = 15 * 1024 * 1024;
const RETRY_MAX = 3;
const RETRY_BASE_MS = 500;

function assertRagUpload(files) {
  if (files.length > MAX_FILES) {
    throw new Error("单次最多上传 3 个文件");
  }
  const totalSize = files.reduce((sum, file) => {
    const filePath = file.path || file.filePath;
    const size = Number(file.size || (filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0));
    return sum + size;
  }, 0);
  if (totalSize > MAX_TOTAL_UPLOAD_BYTES) {
    throw new Error("文件总大小超过 15MB 限制");
  }
}

async function withTimeout(promiseFactory, timeoutMs) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`请求超时(${timeoutMs}ms)`)), timeoutMs);
  });
  return Promise.race([promiseFactory(), timeoutPromise]);
}

function isRetriableError(error) {
  if (error && typeof error.status === "number") {
    return error.status === 429 || error.status >= 500;
  }
  const msg = String(error?.message || "");
  return msg.includes("fetch") || msg.includes("network") || msg.includes("ECONN") || msg.includes("ETIMEDOUT");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn) {
  let attempt = 0;
  let lastError;
  while (attempt < RETRY_MAX) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= RETRY_MAX || !isRetriableError(error)) {
        throw lastError;
      }
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function getUsageAndCostFromChat(provider, response, userPromptText, assistantText) {
  const usage = response.usage || {};
  const promptTokens = Number(usage.prompt_tokens || estimateTokens(userPromptText));
  const completionTokens = Number(usage.completion_tokens || estimateTokens(assistantText));
  const hasOfficialUsage = Number.isFinite(Number(usage.prompt_tokens)) || Number.isFinite(Number(usage.completion_tokens));
  const cost =
    ((promptTokens / 1000) * Number(provider.inputCostPer1k || 0)) +
    ((completionTokens / 1000) * Number(provider.outputCostPer1k || 0));
  return {
    promptTokens,
    completionTokens,
    totalCostCny: Number(cost.toFixed(6)),
    source: hasOfficialUsage ? "official" : "estimated"
  };
}

function pickFirstImageUrl(response) {
  if (!Array.isArray(response.data) || response.data.length === 0) {
    return "";
  }
  return response.data[0].url || "";
}

const chatStreamMap = new Map();

function summarizeChunk(text, maxLen = 240) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen)}...`;
}

async function buildRagContext(payload, provider) {
  if (!payload.useRag || !payload.ragEmbeddingModelId) {
    return "";
  }
  const emb = await withRetry(() =>
    createEmbedding(provider, {
      modelId: payload.ragEmbeddingModelId,
      input: payload.prompt || ""
    })
  );
  const queryVec = emb.data?.[0]?.embedding;
  if (!Array.isArray(queryVec) || queryVec.length === 0) {
    return "";
  }
  const vectors = getAllRagVectors();
  const topK = Math.max(1, Number(payload.ragTopK || 4));
  const ranked = vectors
    .map((item) => ({
      ...item,
      score: cosineSimilarity(queryVec, item.embedding)
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  if (!ranked.length) {
    return "";
  }
  const autoPromptThreshold = Math.max(20, Number(payload.ragAutoPromptThreshold || 180));
  const autoTopKThreshold = Math.max(1, Number(payload.ragAutoTopKThreshold || 5));
  const requestedMode = payload.ragInjectMode || "snippets";
  const mode =
    requestedMode === "auto"
      ? String(payload.prompt || "").length > autoPromptThreshold || topK > autoTopKThreshold
        ? "summary"
        : "snippets"
      : requestedMode === "summary"
        ? "summary"
        : "snippets";
  if (mode === "summary") {
    return ranked
      .map((item, index) => `摘要${index + 1} (score=${item.score.toFixed(3)}): ${summarizeChunk(item.textContent)}`)
      .join("\n");
  }
  return ranked
    .map((item, index) => `片段${index + 1} (score=${item.score.toFixed(3)}):\n${item.textContent}`)
    .join("\n\n");
}

function registerFeatureHandlers(ipcMain, defaultUserDataPath) {
  ipcMain.handle("chat:send", async (_event, payload) =>
    withTimeout(async () => {
      if (!payload.providerId || !payload.modelId) {
        throw new Error("聊天请求缺少 providerId 或 modelId");
      }
      const provider = findProvider(payload.providerId);
      const conversationId = payload.conversationId || crypto.randomUUID();
      const userMessage = payload.prompt || "";
      const contextLimit = Math.max(0, Number(payload.contextLength || 12));
      const historyMessages = payload.conversationId ? getConversationMessages(payload.conversationId, contextLimit) : [];
      const ragContext = await buildRagContext(payload, provider);
      const messages = [
        ...(payload.systemPrompt ? [{ role: "system", content: payload.systemPrompt }] : []),
        ...(ragContext
          ? [
              {
                role: "system",
                content: `以下是检索到的RAG上下文，请优先基于这些内容回答；若无法支持结论请明确说明。\n\n${ragContext}`
              }
            ]
          : []),
        ...historyMessages.map((item) => ({ role: item.role, content: item.content })),
        { role: "user", content: userMessage }
      ];

      const response = await withRetry(() =>
        createChatCompletion(provider, {
          modelId: payload.modelId,
          temperature: payload.temperature ?? 1,
          maxTokens: payload.maxTokens,
          messages
        })
      );

      const assistantText = response.choices?.[0]?.message?.content || "";
      const usage = getUsageAndCostFromChat(provider, response, userMessage, assistantText);
      assertWithinMonthlyLimit(usage.totalCostCny);

      saveConversation({
        id: conversationId,
        providerId: payload.providerId,
        modelId: payload.modelId,
        title: userMessage.slice(0, 40)
      });
      saveMessage({
        id: crypto.randomUUID(),
        conversationId,
        role: "user",
        content: userMessage
      });
      saveMessage({
        id: crypto.randomUUID(),
        conversationId,
        role: "assistant",
        content: assistantText,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        costCny: usage.totalCostCny
      });
      recordUsage({
        id: crypto.randomUUID(),
        providerId: payload.providerId,
        modelId: payload.modelId,
        feature: "chat",
        costCny: usage.totalCostCny,
        source: usage.source
      });
      return {
        conversationId,
        text: assistantText,
        usage
      };
    }, CHAT_TIMEOUT_MS)
  );

  ipcMain.handle("chat:stream:start", async (event, payload) => {
    if (!payload?.providerId || !payload?.modelId) {
      throw new Error("聊天请求缺少 providerId 或 modelId");
    }
    const provider = findProvider(payload.providerId);
    const conversationId = payload.conversationId || crypto.randomUUID();
    const streamId = crypto.randomUUID();
    const userMessage = payload.prompt || "";
    const contextLimit = Math.max(0, Number(payload.contextLength || 12));
    const historyMessages = payload.conversationId ? getConversationMessages(payload.conversationId, contextLimit) : [];
    const ragContext = await buildRagContext(payload, provider);
    const messages = [
      ...(payload.systemPrompt ? [{ role: "system", content: payload.systemPrompt }] : []),
      ...(ragContext
        ? [
            {
              role: "system",
              content: `以下是检索到的RAG上下文，请优先基于这些内容回答；若无法支持结论请明确说明。\n\n${ragContext}`
            }
          ]
        : []),
      ...historyMessages.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: userMessage }
    ];

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), CHAT_STREAM_TIMEOUT_MS);
    chatStreamMap.set(streamId, { abortController, timer });

    (async () => {
      let assistantText = "";
      let usageFromStream = null;
      let aborted = false;
      try {
        await createChatCompletionStream(
          provider,
          {
            modelId: payload.modelId,
            temperature: payload.temperature ?? 1,
            maxTokens: payload.maxTokens,
            messages
          },
          {
            signal: abortController.signal,
            onChunk: (chunk) => {
              const delta = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.text ?? "";
              if (delta) {
                assistantText += String(delta);
                event.sender.send("chat:stream:delta", { streamId, delta: String(delta) });
              }
              if (chunk?.usage) {
                usageFromStream = chunk.usage;
              }
            }
          }
        );
      } catch (error) {
        aborted = Boolean(abortController.signal.aborted) || String(error?.name || "").toLowerCase().includes("abort");
        if (!aborted) {
          const message = String(error?.message || error || "未知错误");
          try {
            saveConversation({
              id: conversationId,
              providerId: payload.providerId,
              modelId: payload.modelId,
              title: userMessage.slice(0, 40)
            });
            saveMessage({
              id: crypto.randomUUID(),
              conversationId,
              role: "user",
              content: userMessage
            });
            saveMessage({
              id: crypto.randomUUID(),
              conversationId,
              role: "assistant",
              content: "",
              aborted: false,
              errorText: message
            });
          } catch {
          }
          event.sender.send("chat:stream:error", { streamId, conversationId, message });
          const active = chatStreamMap.get(streamId);
          if (active?.timer) {
            clearTimeout(active.timer);
          }
          chatStreamMap.delete(streamId);
          return;
        }
      }

      const usage = getUsageAndCostFromChat(provider, { usage: usageFromStream || {} }, userMessage, assistantText);
      try {
        assertWithinMonthlyLimit(usage.totalCostCny);
        saveConversation({
          id: conversationId,
          providerId: payload.providerId,
          modelId: payload.modelId,
          title: userMessage.slice(0, 40)
        });
        saveMessage({
          id: crypto.randomUUID(),
          conversationId,
          role: "user",
          content: userMessage
        });
        const assistantStoredText = aborted ? `${assistantText}\n\n【已中止】` : assistantText;
        saveMessage({
          id: crypto.randomUUID(),
          conversationId,
          role: "assistant",
          content: assistantStoredText,
          aborted,
          errorText: "",
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costCny: usage.totalCostCny
        });
        recordUsage({
          id: crypto.randomUUID(),
          providerId: payload.providerId,
          modelId: payload.modelId,
          feature: "chat",
          costCny: usage.totalCostCny,
          source: usage.source
        });
        event.sender.send("chat:stream:done", { streamId, conversationId, text: assistantText, usage, aborted });
      } catch (error) {
        event.sender.send("chat:stream:error", { streamId, message: String(error?.message || error || "未知错误") });
      } finally {
        const active = chatStreamMap.get(streamId);
        if (active?.timer) {
          clearTimeout(active.timer);
        }
        chatStreamMap.delete(streamId);
      }
    })();

    return { streamId, conversationId };
  });

  ipcMain.handle("chat:stream:stop", async (_event, payload) => {
    const streamId = payload?.streamId;
    if (!streamId) {
      return false;
    }
    const active = chatStreamMap.get(streamId);
    if (!active?.abortController) {
      return false;
    }
    try {
      active.abortController.abort();
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("image:generate", async (_event, payload) =>
    withTimeout(async () => {
      if (!payload.providerId || !payload.modelId) {
        throw new Error("生图请求缺少 providerId 或 modelId");
      }
      const provider = findProvider(payload.providerId);
      if (payload.imagePath) {
        await assertImageConstraints(payload.imagePath, MAX_IMAGE_BYTES, MAX_IMAGE_EDGE);
      }

      const response = await withRetry(() =>
        createImage(provider, {
          modelId: payload.modelId,
          prompt: payload.prompt,
          imagePath: payload.imagePath
        })
      );
      const imageUrl = pickFirstImageUrl(response);
      const cost = Number(provider.imageCostPerCall || 0);
      assertWithinMonthlyLimit(cost);
      recordUsage({
        id: crypto.randomUUID(),
        providerId: payload.providerId,
        modelId: payload.modelId,
        feature: "image",
        costCny: cost,
        source: "estimated"
      });
      return {
        imageUrl,
        info: imageUrl ? "生图成功" : "生图成功，但供应商未返回可直接访问的 URL"
      };
    }, IMAGE_TIMEOUT_MS)
  );

  ipcMain.handle("rag:ingest", async (_event, payload) =>
    withTimeout(async () => {
      if (!payload.providerId || !payload.embeddingModelId) {
        throw new Error("RAG 入库缺少 providerId 或 embeddingModelId");
      }
      assertRagUpload(payload.files);
      const provider = findProvider(payload.providerId);
      let accepted = 0;
      const userDataPath = payload.userDataPath || defaultUserDataPath;
      for (const file of payload.files) {
        const filePath = file.path || file.filePath;
        const ext = path.extname(filePath).toLowerCase();
        if (![".txt", ".md", ".pdf"].includes(ext)) {
          throw new Error(`不支持的 RAG 文件类型: ${ext}`);
        }
        const sourceText = await parseFileText(filePath);
        const snapshotPath = await createSnapshot(userDataPath, filePath, file.name);
        const documentId = crypto.randomUUID();
        saveRagDocument({
          id: documentId,
          fileName: file.name,
          filePath,
          snapshotPath,
          contentHash: crypto.createHash("sha256").update(sourceText).digest("hex"),
          fileSize: file.size
        });
        const chunks = chunkText(sourceText, payload.chunkSize || 1200, payload.chunkOverlap || 150);
        let idx = 0;
        for (const chunk of chunks) {
          const emb = await withRetry(() =>
            createEmbedding(provider, {
              modelId: payload.embeddingModelId,
              input: chunk
            })
          );
          const vector = emb.data?.[0]?.embedding;
          if (!Array.isArray(vector) || vector.length === 0) {
            continue;
          }
          saveRagChunkWithVector({
            chunkId: crypto.randomUUID(),
            vectorId: crypto.randomUUID(),
            documentId,
            chunkIndex: idx,
            textContent: chunk,
            tokenCount: estimateTokens(chunk),
            embedding: vector
          });
          idx += 1;
        }
        accepted += 1;
      }

      const estimatedCost = Number((accepted * 0.01).toFixed(6));
      assertWithinMonthlyLimit(estimatedCost);
      recordUsage({
        id: crypto.randomUUID(),
        providerId: payload.providerId,
        modelId: payload.embeddingModelId,
        feature: "rag",
        costCny: estimatedCost,
        source: "estimated"
      });
      return {
        accepted,
        message: "RAG 入库完成"
      };
    }, RAG_TIMEOUT_MS)
  );

  ipcMain.handle("rag:search", async (_event, payload) =>
    withTimeout(async () => {
      if (!payload.providerId || !payload.embeddingModelId) {
        throw new Error("RAG 检索缺少 providerId 或 embeddingModelId");
      }
      const provider = findProvider(payload.providerId);
      const emb = await withRetry(() =>
        createEmbedding(provider, {
          modelId: payload.embeddingModelId,
          input: payload.query
        })
      );
      const queryVec = emb.data?.[0]?.embedding;
      if (!Array.isArray(queryVec) || queryVec.length === 0) {
        return { query: payload.query, chunks: [] };
      }
      const vectors = getAllRagVectors();
      const topK = Math.max(1, Number(payload.topK || 4));
      const ranked = vectors
        .map((item) => ({
          ...item,
          score: cosineSimilarity(queryVec, item.embedding)
        }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((item) => ({
          chunkId: item.chunkId,
          text: item.textContent,
          score: Number(item.score.toFixed(6))
        }));
      return {
        query: payload.query,
        chunks: ranked
      };
    }, RAG_TIMEOUT_MS)
  );
}

module.exports = {
  registerFeatureHandlers
};
