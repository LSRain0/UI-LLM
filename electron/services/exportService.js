const fs = require("node:fs/promises");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

function normalizeTitle(text) {
  const cleaned = String(text || "conversation")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();
  return cleaned || "conversation";
}

function buildStats(messages) {
  const stats = {
    totalMessages: messages.length,
    userMessages: 0,
    assistantMessages: 0,
    systemMessages: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCostCny: 0
  };
  for (const item of messages) {
    if (item.role === "user") {
      stats.userMessages += 1;
    } else if (item.role === "assistant") {
      stats.assistantMessages += 1;
    } else if (item.role === "system") {
      stats.systemMessages += 1;
    }
    stats.totalPromptTokens += Number(item.promptTokens || 0);
    stats.totalCompletionTokens += Number(item.completionTokens || 0);
    stats.totalCostCny += Number(item.costCny || 0);
  }
  stats.totalCostCny = Number(stats.totalCostCny.toFixed(6));
  return stats;
}

function buildMarkdown(data) {
  const stats = buildStats(data.messages);
  const lines = [];
  lines.push(`# ${data.conversation.title || "Conversation"}`);
  lines.push("");
  lines.push(`- Conversation ID: ${data.conversation.id}`);
  lines.push(`- Provider: ${data.conversation.providerId}`);
  lines.push(`- Model: ${data.conversation.modelId}`);
  lines.push(`- Created At: ${data.conversation.createdAt}`);
  lines.push(`- Updated At: ${data.conversation.updatedAt}`);
  lines.push(`- Messages: ${stats.totalMessages} (user=${stats.userMessages}, assistant=${stats.assistantMessages}, system=${stats.systemMessages})`);
  lines.push(
    `- Tokens: prompt=${stats.totalPromptTokens}, completion=${stats.totalCompletionTokens}, cost=${stats.totalCostCny} CNY`
  );
  lines.push("");
  for (const message of data.messages) {
    lines.push(`## ${message.role.toUpperCase()}`);
    lines.push("");
    lines.push(message.content || "");
    lines.push("");
  }
  return lines.join("\n");
}

async function loadCjkFont(pdfDoc) {
  const candidates = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttc"
  ];
  for (const fontPath of candidates) {
    try {
      if (fs.existsSync(fontPath)) {
        const fontBytes = fs.readFileSync(fontPath);
        return await pdfDoc.embedFont(fontBytes, { subset: true });
      }
    } catch {
      // try next font
    }
  }
  return null;
}

async function buildPdf(data) {
  const stats = buildStats(data.messages);
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = (await loadCjkFont(pdfDoc)) || await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const lineHeight = 16;
  const maxWidth = 540;
  let y = 810;

  function writeLine(text) {
    if (y < 30) {
      return false;
    }
    page.drawText(text, {
      x: 30,
      y,
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.1)
    });
    y -= lineHeight;
    return true;
  }

  function wrapText(text) {
    const words = String(text || "").split(/\s+/);
    const rows = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, fontSize);
      if (width <= maxWidth) {
        current = candidate;
      } else {
        if (current) {
          rows.push(current);
        }
        current = word;
      }
    }
    if (current) {
      rows.push(current);
    }
    return rows.length ? rows : [""];
  }

  const header = [
    `Conversation: ${data.conversation.title || "Conversation"}`,
    `ID: ${data.conversation.id}`,
    `Provider: ${data.conversation.providerId}`,
    `Model: ${data.conversation.modelId}`,
    `Messages: ${stats.totalMessages} (u:${stats.userMessages}, a:${stats.assistantMessages}, s:${stats.systemMessages})`,
    `Tokens: p=${stats.totalPromptTokens}, c=${stats.totalCompletionTokens}, cost=${stats.totalCostCny} CNY`,
    ""
  ];
  for (const line of header) {
    if (!writeLine(line)) {
      break;
    }
  }

  for (const message of data.messages) {
    const roleLine = `[${message.role.toUpperCase()}]`;
    if (!writeLine(roleLine)) {
      break;
    }
    for (const row of wrapText(message.content)) {
      if (!writeLine(row)) {
        break;
      }
    }
    if (!writeLine("")) {
      break;
    }
  }

  return Buffer.from(await pdfDoc.save());
}

async function writeConversationExport({ format, targetPath, data }) {
  const payload = {
    ...data,
    stats: buildStats(data.messages)
  };
  if (format === "json") {
    const content = JSON.stringify(payload, null, 2);
    await fs.writeFile(targetPath, content, "utf8");
    return;
  }
  if (format === "md") {
    const content = buildMarkdown(payload);
    await fs.writeFile(targetPath, content, "utf8");
    return;
  }
  if (format === "pdf") {
    const bytes = await buildPdf(payload);
    await fs.writeFile(targetPath, bytes);
    return;
  }
  throw new Error(`不支持的导出格式: ${format}`);
}

module.exports = {
  normalizeTitle,
  writeConversationExport
};
