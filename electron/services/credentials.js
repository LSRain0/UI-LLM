const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

let keytar = null;
try {
  // keytar may be unavailable when native module rebuild is not possible.
  // In that case we fallback to local storage so the app remains usable.
  keytar = require("keytar");
} catch (_err) {
  keytar = null;
  console.warn("[credentials] keytar 不可用，API Key 将以明文存储在本地文件中，安全性较低。建议安装 Visual Studio Build Tools 以启用 keytar。");
}

const SERVICE = "ui-llm";
const FALLBACK_FILE = "credentials.local.json";

function getFallbackPath() {
  return path.join(app.getPath("userData"), FALLBACK_FILE);
}

function readFallbackMap() {
  const file = getFallbackPath();
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function writeFallbackMap(data) {
  const file = getFallbackPath();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

async function setApiKey(refId, apiKey) {
  if (keytar) {
    await keytar.setPassword(SERVICE, refId, apiKey);
    return;
  }
  const map = readFallbackMap();
  map[refId] = apiKey;
  writeFallbackMap(map);
}

async function getApiKey(refId) {
  if (keytar) {
    return keytar.getPassword(SERVICE, refId);
  }
  const map = readFallbackMap();
  return map[refId] || null;
}

async function deleteApiKey(refId) {
  if (keytar) {
    await keytar.deletePassword(SERVICE, refId);
    return;
  }
  const map = readFallbackMap();
  if (Object.prototype.hasOwnProperty.call(map, refId)) {
    delete map[refId];
    writeFallbackMap(map);
  }
}

module.exports = {
  setApiKey,
  getApiKey,
  deleteApiKey
};
