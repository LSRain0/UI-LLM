const fs = require("node:fs");
const path = require("node:path");

const MAX_DAYS = 40;
const MAX_BYTES = 500 * 1024 * 1024;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function listLogs(logDir) {
  if (!fs.existsSync(logDir)) {
    return [];
  }
  return fs
    .readdirSync(logDir)
    .filter((name) => name.endsWith(".log"))
    .map((name) => {
      const filePath = path.join(logDir, name);
      const stat = fs.statSync(filePath);
      return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function cleanupLogs(logDir) {
  ensureDir(logDir);
  const now = Date.now();
  const expireMs = MAX_DAYS * 24 * 60 * 60 * 1000;
  let logs = listLogs(logDir);

  for (const log of logs) {
    if (now - log.mtimeMs > expireMs) {
      fs.unlinkSync(log.filePath);
    }
  }

  logs = listLogs(logDir);
  let total = logs.reduce((sum, item) => sum + item.size, 0);
  let idx = 0;
  while (total > MAX_BYTES && idx < logs.length) {
    fs.unlinkSync(logs[idx].filePath);
    total -= logs[idx].size;
    idx += 1;
  }
}

module.exports = {
  cleanupLogs
};

