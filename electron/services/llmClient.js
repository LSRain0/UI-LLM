const fs = require("node:fs");
const path = require("node:path");
const { imageSizeFromFile } = require("image-size/fromFile");
const { getApiKey } = require("./credentials");

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

async function getProviderAuth(provider) {
  if (!provider) {
    throw new Error("未找到供应商配置");
  }
  const apiKey = await getApiKey(provider.credentialRefId);
  if (!apiKey) {
    throw new Error(`供应商 ${provider.name} 未配置有效 API Key`);
  }
  return {
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    apiKey
  };
}

async function requestJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const message = data.error?.message || data.message || `请求失败: HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function createChatCompletion(provider, payload) {
  const { baseUrl, apiKey } = await getProviderAuth(provider);
  return requestJson(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: payload.modelId,
      messages: payload.messages,
      temperature: payload.temperature,
      max_tokens: payload.maxTokens,
      stream: false
    })
  });
}

async function createChatCompletionStream(provider, payload, options) {
  const { baseUrl, apiKey } = await getProviderAuth(provider);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: payload.modelId,
      messages: payload.messages,
      temperature: payload.temperature,
      max_tokens: payload.maxTokens,
      stream: true,
      stream_options: { include_usage: true }
    }),
    signal: options?.signal
  });
  if (!res.ok) {
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    const message = data.error?.message || data.message || `请求失败: HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (!res.body) {
    throw new Error("流式响应缺少 body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];

  function flushEvent() {
    if (dataLines.length === 0) {
      return;
    }
    const dataText = dataLines.join("\n");
    dataLines = [];
    if (!dataText) {
      return;
    }
    if (dataText === "[DONE]") {
      return "done";
    }
    let obj = null;
    try {
      obj = JSON.parse(dataText);
    } catch {
      obj = null;
    }
    if (obj) {
      options?.onChunk?.(obj);
    }
    return null;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      if (!line) {
        const result = flushEvent();
        if (result === "done") {
          return;
        }
        continue;
      }
      if (line.startsWith(":")) {
        continue;
      }
      if (!line.startsWith("data:")) {
        continue;
      }
      let valueText = line.slice(5);
      if (valueText.startsWith(" ")) {
        valueText = valueText.slice(1);
      }
      dataLines.push(valueText);
    }
  }
  const result = flushEvent();
  if (result === "done") {
    return;
  }
}

async function createEmbedding(provider, payload) {
  const { baseUrl, apiKey } = await getProviderAuth(provider);
  return requestJson(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: payload.modelId,
      input: payload.input
    })
  });
}

async function createImage(provider, payload) {
  const { baseUrl, apiKey } = await getProviderAuth(provider);
  if (!payload.imagePath) {
    return requestJson(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: payload.modelId,
        prompt: payload.prompt
      })
    });
  }

  const form = new FormData();
  form.set("model", payload.modelId);
  form.set("prompt", payload.prompt);
  const bytes = await fs.promises.readFile(payload.imagePath);
  const fileName = path.basename(payload.imagePath);
  const mime = fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  form.set("image", new Blob([bytes], { type: mime }), fileName);

  return requestJson(`${baseUrl}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });
}

async function assertImageConstraints(imagePath, maxBytes, maxEdge) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
    throw new Error("图生图仅支持 png / jpg");
  }
  const stat = await fs.promises.stat(imagePath);
  if (stat.size > maxBytes) {
    throw new Error("参考图超过 10MB 限制");
  }
  const dim = await imageSizeFromFile(imagePath);
  if (!dim.width || !dim.height) {
    throw new Error("无法识别图片尺寸");
  }
  if (dim.width > maxEdge || dim.height > maxEdge) {
    throw new Error(`图片分辨率超过最大边长 ${maxEdge}px`);
  }
}

module.exports = {
  createChatCompletion,
  createChatCompletionStream,
  createEmbedding,
  createImage,
  assertImageConstraints
};
