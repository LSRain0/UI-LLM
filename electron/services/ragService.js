const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const pdfParse = require("pdf-parse");

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function chunkText(text, chunkSize = 1200, overlap = 150) {
  if (!text.trim()) {
    return [];
  }
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize);
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= text.length) {
      break;
    }
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

async function parseFileText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".txt" || ext === ".md") {
    return fs.promises.readFile(filePath, "utf8");
  }
  if (ext === ".pdf") {
    const pdfBuf = await fs.promises.readFile(filePath);
    const parsed = await pdfParse(pdfBuf);
    return parsed.text || "";
  }
  throw new Error(`不支持的文件类型: ${ext}`);
}

async function createSnapshot(userDataPath, sourceFilePath, fileName) {
  const dir = path.join(userDataPath, "rag-snapshots");
  await fs.promises.mkdir(dir, { recursive: true });
  const snapshotPath = path.join(dir, `${Date.now()}-${crypto.randomUUID()}-${fileName}`);
  await fs.promises.copyFile(sourceFilePath, snapshotPath);
  return snapshotPath;
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length || a.length === 0) {
    return -1;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) {
    return -1;
  }
  return dot / denom;
}

module.exports = {
  estimateTokens,
  chunkText,
  parseFileText,
  createSnapshot,
  cosineSimilarity
};

