import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProviderConfig } from "./types/api";

type TabKey = "providers" | "chat" | "rag" | "image" | "billing" | "settings";
type Locale = "zh" | "en";
type ThemeMode = "deep" | "dark" | "light";

const tabs: TabKey[] = ["providers", "chat", "rag", "image", "billing", "settings"];

type ConversationItem = {
  id: string;
  providerId: string;
  modelId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type ConversationMessage = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  aborted?: boolean;
  errorText?: string;
  promptTokens: number;
  completionTokens: number;
  costCny: number;
  createdAt: string;
};

type ChatViewMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  status?: "pending" | "aborted" | "error";
  errorText?: string;
};

type RecentExportItem = {
  id: string;
  path: string;
  kind: "file" | "directory";
  createdAt: string;
  exists?: boolean;
};

type LogLevel = "info" | "success" | "warning" | "error";

type LogEvent = {
  id: string;
  createdAt: string;
  level: LogLevel;
  message: string;
};

function formatRelativeTime(input: string, locale: Locale) {
  const ts = Date.parse(input);
  if (!ts) {
    return locale === "zh" ? "未知时间" : "Unknown time";
  }
  const diff = Date.now() - ts;
  if (diff < 0) {
    return locale === "zh" ? "刚刚" : "just now";
  }
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) {
    return locale === "zh" ? `${sec} 秒前` : `${sec}s ago`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return locale === "zh" ? `${min} 分钟前` : `${min}m ago`;
  }
  const hour = Math.floor(min / 60);
  if (hour < 24) {
    return locale === "zh" ? `${hour} 小时前` : `${hour}h ago`;
  }
  const day = Math.floor(hour / 24);
  return locale === "zh" ? `${day} 天前` : `${day}d ago`;
}

function formatRoleLabel(role: string, locale: Locale) {
  if (role === "user") {
    return locale === "zh" ? "用户" : "User";
  }
  if (role === "assistant") {
    return locale === "zh" ? "助手" : "Assistant";
  }
  if (role === "system") {
    return locale === "zh" ? "系统" : "System";
  }
  return role;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const isZh = locale === "zh";
  const [activeTab, setActiveTab] = useState<TabKey>("providers");
  const [themeMode, setThemeMode] = useState<ThemeMode>("deep");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [monthlyLimit, setMonthlyLimit] = useState<number>(0);
  const [providerForm, setProviderForm] = useState({
    id: "",
    name: "",
    baseUrl: "",
    apiKey: "",
    modelLines: "",
    inputCostPer1k: 0,
    outputCostPer1k: 0,
    imageCostPerCall: 0
  });
  const [chatPrompt, setChatPrompt] = useState("你好，做个自检");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatViewMessage[]>([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatStopping, setChatStopping] = useState(false);
  const [chatStreamId, setChatStreamId] = useState("");
  const pendingAssistantIdRef = useRef("");
  const activeStreamIdRef = useRef("");
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatAtBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const refreshHistoryRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [chatHasUnread, setChatHasUnread] = useState(false);
  const [temperature, setTemperature] = useState(1);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [contextLength, setContextLength] = useState(12);
  const [useRagInChat, setUseRagInChat] = useState(false);
  const [ragInjectMode, setRagInjectMode] = useState<"snippets" | "summary" | "auto">("auto");
  const [currentConversationId, setCurrentConversationId] = useState("");
  const [historyKeyword, setHistoryKeyword] = useState("");
  const [historySortBy, setHistorySortBy] = useState<"updated_desc" | "updated_asc" | "created_desc" | "created_asc">(
    "updated_desc"
  );
  const [historyItems, setHistoryItems] = useState<ConversationItem[]>([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [openDirAfterSingleExport, setOpenDirAfterSingleExport] = useState(true);
  const [openDirAfterBatchExport, setOpenDirAfterBatchExport] = useState(true);
  const [recentExports, setRecentExports] = useState<RecentExportItem[]>([]);
  const [exportRecordFilter, setExportRecordFilter] = useState<"all" | "file" | "directory" | "invalid">("all");
  const [exportRecordSort, setExportRecordSort] = useState<"created_desc" | "created_asc">("created_desc");
  const [exportRecordKeyword, setExportRecordKeyword] = useState("");
  const [onlyShowSelectedExports, setOnlyShowSelectedExports] = useState(false);
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
  const [batchRenameOrder, setBatchRenameOrder] = useState<
    "current_list" | "updated_desc" | "updated_asc" | "created_desc" | "created_asc"
  >("current_list");
  const [historyMessages, setHistoryMessages] = useState<ConversationMessage[]>([]);
  const [messageRoleFilter, setMessageRoleFilter] = useState<"all" | "user" | "assistant" | "system">("all");
  const [ragFilePaths, setRagFilePaths] = useState<string[]>([]);
  const [ragQuery, setRagQuery] = useState("请总结知识点");
  const [ragTopK, setRagTopK] = useState(4);
  const [ragAutoPromptThreshold, setRagAutoPromptThreshold] = useState(180);
  const [ragAutoTopKThreshold, setRagAutoTopKThreshold] = useState(5);
  const [imagePrompt, setImagePrompt] = useState("一幅日落时分的山间湖泊风景");
  const [referenceImagePath, setReferenceImagePath] = useState("");
  const [showRagAdvanced, setShowRagAdvanced] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [logEvents, setLogEvents] = useState<LogEvent[]>([
    {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      level: "info",
      message: "应用已启动。"
    }
  ]);

  function guessLogLevel(message: string): LogLevel {
    if (/失败|错误|error|fail/i.test(message)) {
      return "error";
    }
    if (/警告|超限|warning/i.test(message)) {
      return "warning";
    }
    if (/成功|完成|已保存|已更新|已导出|已复制|已打开|已删除|已清理|已去重/i.test(message)) {
      return "success";
    }
    return "info";
  }

  function setLog(message: string) {
    const normalized = String(message || "").trim() || (isZh ? "无日志内容" : "Empty log message");
    const event: LogEvent = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      level: guessLogLevel(normalized),
      message: normalized
    };
    setLogEvents((prev) => [event, ...prev].slice(0, 200));
  }

  async function copyLogMessage(message: string) {
    await navigator.clipboard.writeText(message || "");
    setLog(isZh ? "已复制日志详情。" : "Log detail copied.");
  }

  async function refreshConfig() {
    const cfg = await window.api.getAppConfig();
    setProviders(cfg.providers);
    setMonthlyLimit(cfg.monthlyLimitCny);
    setThemeMode(cfg.themeMode || "deep");
    if (!selectedProviderId && cfg.providers.length > 0) {
      setSelectedProviderId(cfg.providers[0].id);
      setSelectedModelId(cfg.providers[0].models[0]?.id || "");
    }
  }

  async function applyThemeMode(next: ThemeMode) {
    setThemeMode(next);
    try {
      const saved = await window.api.setThemeMode(next);
      setThemeMode(saved);
      setLog(isZh ? `已切换主题：${saved}` : `Theme changed: ${saved}`);
    } catch (error) {
      setLog(isZh ? `主题切换失败：${String(error?.message || error || "未知错误")}` : `Theme change failed: ${String(error?.message || error || "Unknown error")}`);
    }
  }

  useEffect(() => {
    refreshConfig().then(() => {
      // no-op
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    const key = "ui-llm.onboarding.dismissed.v1";
    const dismissed = window.localStorage.getItem(key);
    if (!dismissed) {
      setShowOnboarding(true);
    }
  }, []);

  useEffect(() => {
    reloadRecentExports().then(() => {
      // no-op
    });
  }, []);

  useEffect(() => {
    const provider = providers.find((p) => p.id === selectedProviderId) || providers[0];
    if (!provider) {
      return;
    }
    if (!selectedProviderId) {
      setSelectedProviderId(provider.id);
    }
    const hasModel = provider.models.some((m) => m.id === selectedModelId);
    if (!hasModel) {
      setSelectedModelId(provider.models[0]?.id || "");
    }
  }, [providers, selectedProviderId, selectedModelId]);

  useEffect(() => {
    if (activeTab !== "chat") {
      return;
    }
    refreshHistory().then(() => {
      // no-op
    });
  }, [activeTab, selectedProviderId, selectedModelId, historySortBy]);

  useEffect(() => {
    if (activeTab !== "chat") {
      return;
    }
    const t = setTimeout(() => {
      refreshHistory().then(() => {
        // no-op
      });
    }, 250);
    return () => clearTimeout(t);
  }, [historyKeyword, activeTab]);

  useEffect(() => {
    resizeChatInput();
  }, []);

  useEffect(() => {
    if (activeTab !== "chat") {
      return;
    }
    const el = chatListRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      const threshold = 48;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distance <= threshold;
      chatAtBottomRef.current = atBottom;
      if (atBottom) {
        setChatHasUnread(false);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [activeTab]);

  useEffect(() => {
    const offDelta = window.api.onChatStreamDelta((payload) => {
      if (!payload?.streamId || payload.streamId !== activeStreamIdRef.current) {
        return;
      }
      if (!payload.delta) {
        return;
      }
      const pendingId = pendingAssistantIdRef.current;
      if (!pendingId) {
        return;
      }
      setChatMessages((prev) =>
        prev.map((item) => (item.id === pendingId ? { ...item, content: `${item.content}${payload.delta}` } : item))
      );
      scheduleScrollChatToBottom();
    });
    const offDone = window.api.onChatStreamDone((payload) => {
      if (!payload?.streamId || payload.streamId !== activeStreamIdRef.current) {
        return;
      }
      activeStreamIdRef.current = "";
      setChatStreaming(false);
      setChatStopping(false);
      setChatStreamId("");
      const pendingId = pendingAssistantIdRef.current;
      pendingAssistantIdRef.current = "";
      setChatMessages((prev) =>
        prev.map((item) => {
          if (item.id !== pendingId) {
            return item;
          }
          return payload.aborted ? { ...item, status: "aborted" } : { ...item, status: undefined };
        })
      );
      void (async () => {
        setCurrentConversationId(payload.conversationId);
        const msgs = await window.api.getHistoryMessages(payload.conversationId);
        setHistoryMessages(msgs);
        setChatMessages(toChatViewMessages(msgs));
        await refreshHistoryRef.current();
        const usage = payload.usage as any;
        const usageText =
          usage && typeof usage === "object"
            ? isZh
              ? `用量：输入Token=${usage.promptTokens}，输出Token=${usage.completionTokens}，费用=${usage.totalCostCny}，来源=${usage.source}`
              : `Usage: promptToken=${usage.promptTokens}, completionToken=${usage.completionTokens}, cost=${usage.totalCostCny}, source=${usage.source}`
            : "";
        if (usageText) {
          setLog(payload.aborted ? `${isZh ? "已中止生成。" : "Generation aborted."}\n${usageText}` : usageText);
        } else {
          setLog(payload.aborted ? (isZh ? "已中止生成。" : "Generation aborted.") : isZh ? "生成完成。" : "Completed.");
        }
        scheduleScrollChatToBottom();
      })();
    });
    const offError = window.api.onChatStreamError((payload) => {
      if (!payload?.streamId || payload.streamId !== activeStreamIdRef.current) {
        return;
      }
      activeStreamIdRef.current = "";
      setChatStreaming(false);
      setChatStopping(false);
      setChatStreamId("");
      const pendingId = pendingAssistantIdRef.current;
      pendingAssistantIdRef.current = "";
      setChatMessages((prev) =>
        prev.map((item) =>
          item.id === pendingId ? { ...item, status: "error", errorText: payload?.message || (isZh ? "未知错误" : "Unknown error") } : item
        )
      );
      setLog(`${isZh ? "流式聊天失败" : "Streaming chat failed"}：${payload?.message || (isZh ? "未知错误" : "Unknown error")}`);
      void (async () => {
        const conversationId = String(payload?.conversationId || "");
        if (!conversationId) {
          return;
        }
        setCurrentConversationId(conversationId);
        const msgs = await window.api.getHistoryMessages(conversationId);
        setHistoryMessages(msgs);
        setChatMessages(toChatViewMessages(msgs));
        await refreshHistoryRef.current();
        scheduleScrollChatToBottom();
      })();
    });
    return () => {
      offDelta();
      offDone();
      offError();
    };
  }, [isZh, locale]);

  const providerOptions = useMemo(
    () => providers.map((p) => (isZh ? `${p.name}（${p.models.length} 个模型）` : `${p.name} (${p.models.length} models)`)),
    [providers, isZh]
  );
  const tabLabels: Record<TabKey, string> = isZh
    ? {
        providers: "供应商",
        chat: "聊天",
        rag: "知识库",
        image: "生图",
        billing: "限额/成本",
        settings: "设置"
      }
    : {
        providers: "Providers",
        chat: "Chat",
        rag: "RAG",
        image: "Image",
        billing: "Budget/Cost",
        settings: "Settings"
      };

  function resetProviderForm() {
    setProviderForm({
      id: "",
      name: "",
      baseUrl: "",
      apiKey: "",
      modelLines: "",
      inputCostPer1k: 0,
      outputCostPer1k: 0,
      imageCostPerCall: 0
    });
  }

  async function refreshHistory() {
    const rows = await window.api.listHistory({
      providerId: selectedProviderId || undefined,
      modelId: selectedModelId || undefined,
      keyword: historyKeyword || undefined,
      sortBy: historySortBy
    });
    setHistoryItems(rows);
    setSelectedHistoryIds((prev) => prev.filter((id) => rows.some((item) => item.id === id)));
  }

  useEffect(() => {
    refreshHistoryRef.current = refreshHistory;
  });

  function parseModelLines(lines: string) {
    return lines
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, name] = line.split(",").map((s) => s.trim());
        return {
          id: id || name,
          name: name || id,
          supportsChat: true,
          supportsImage: true,
          supportsEmbedding: true
        };
      });
  }

  async function saveProviderForm() {
    if (!providerForm.name || !providerForm.baseUrl) {
      setLog("供应商名称和接口地址（BaseURL）必填。");
      return;
    }
    const models = parseModelLines(providerForm.modelLines);
    if (!models.length) {
      setLog("至少配置一个模型，格式：模型ID,展示名");
      return;
    }
    const provider: ProviderConfig = {
      id: providerForm.id || crypto.randomUUID(),
      name: providerForm.name,
      baseUrl: providerForm.baseUrl,
      apiKey: providerForm.apiKey || undefined,
      models,
      inputCostPer1k: providerForm.inputCostPer1k,
      outputCostPer1k: providerForm.outputCostPer1k,
      imageCostPerCall: providerForm.imageCostPerCall
    };
    await window.api.saveProvider(provider);
    await refreshConfig();
    setSelectedProviderId(provider.id);
    setSelectedModelId(models[0].id);
    setLog(`已保存供应商：${provider.name}`);
  }

  function loadProviderToForm(provider: ProviderConfig) {
    setProviderForm({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: "",
      modelLines: provider.models.map((m) => `${m.id},${m.name}`).join("\n"),
      inputCostPer1k: Number(provider.inputCostPer1k || 0),
      outputCostPer1k: Number(provider.outputCostPer1k || 0),
      imageCostPerCall: Number(provider.imageCostPerCall || 0)
    });
  }

  async function removeProvider(providerId: string) {
    await window.api.deleteProvider(providerId);
    await refreshConfig();
    setLog("已删除供应商。");
  }

  function toChatViewMessages(messages: ConversationMessage[]) {
    return messages.map((item) => {
      const abortedByContent = /【已中止】\s*$/.test(String(item.content || ""));
      const aborted = Boolean(item.aborted) || abortedByContent;
      const errorText = String(item.errorText || "");
      const status: ChatViewMessage["status"] = errorText ? "error" : aborted ? "aborted" : undefined;
      const content =
        aborted && abortedByContent ? String(item.content || "").replace(/\n*\s*【已中止】\s*$/, "").trimEnd() : String(item.content || "");
      return {
        id: item.id,
        role: item.role,
        content,
        createdAt: item.createdAt,
        status,
        errorText
      };
    });
  }

  function scheduleScrollChatToBottom(force = false) {
    if (!force && !chatAtBottomRef.current) {
      setChatHasUnread(true);
      return;
    }
    const el = chatListRef.current;
    if (!el) {
      return;
    }
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      chatAtBottomRef.current = true;
      setChatHasUnread(false);
      scrollRafRef.current = null;
    });
  }

  function resizeChatInput() {
    const el = chatInputRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 220);
    el.style.height = `${next}px`;
  }

  async function runChat(overridePrompt?: string) {
    if (!selectedProviderId || !selectedModelId) {
      setLog("请先选择供应商和模型。");
      return;
    }
    if (chatStreaming) {
      setLog(isZh ? "正在生成中，请先停止或等待完成。" : "Generating, please stop or wait.");
      return;
    }
    const userText = String(overridePrompt ?? chatPrompt).trim();
    if (!userText) {
      setLog(isZh ? "请输入要发送的内容。" : "Please enter a message.");
      return;
    }
    setChatStopping(false);
    const localUser: ChatViewMessage = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      content: userText,
      createdAt: new Date().toISOString()
    };
    const assistantId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_assistant`;
    const localAssistant: ChatViewMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "pending"
    };
    pendingAssistantIdRef.current = assistantId;
    setChatMessages((prev) => [...prev, localUser, localAssistant]);
    setChatPrompt("");
    resizeChatInput();
    scheduleScrollChatToBottom(true);

    let start: { streamId: string; conversationId: string };
    try {
      start = await window.api.startChatStream({
        providerId: selectedProviderId,
        modelId: selectedModelId,
        conversationId: currentConversationId || undefined,
        prompt: userText,
        systemPrompt,
        temperature,
        maxTokens,
        contextLength,
        useRag: useRagInChat,
        ragEmbeddingModelId: selectedModelId,
        ragTopK,
        ragInjectMode,
        ragAutoPromptThreshold,
        ragAutoTopKThreshold
      });
    } catch (err) {
      pendingAssistantIdRef.current = "";
      setChatMessages((prev) => prev.filter((m) => m.id !== localUser.id && m.id !== localAssistant.id));
      setLog(`${isZh ? "发起聊天失败" : "Failed to start chat"}：${String(err?.message || err)}`);
      return;
    }
    setCurrentConversationId(start.conversationId);
    setChatStreaming(true);
    setChatStreamId(start.streamId);
    activeStreamIdRef.current = start.streamId;
  }

  async function stopChat() {
    if (!chatStreamId || !chatStreaming) {
      return;
    }
    if (chatStopping) {
      return;
    }
    setChatStopping(true);
    const ok = await window.api.stopChatStream({ streamId: chatStreamId });
    if (!ok) {
      setChatStopping(false);
      setLog(isZh ? "停止失败：未找到可停止的流。" : "Stop failed: no active stream.");
    }
  }

  async function loadConversation(conversationId: string) {
    if (chatStreaming) {
      setLog(isZh ? "正在生成中，无法切换会话。" : "Generating, cannot switch conversation.");
      return;
    }
    const messages = await window.api.getHistoryMessages(conversationId);
    setCurrentConversationId(conversationId);
    setHistoryMessages(messages);
    setChatMessages(toChatViewMessages(messages));
    scheduleScrollChatToBottom(true);
    setLog(isZh ? "已加载会话。" : "Conversation loaded.");
  }

  async function renameCurrentConversation() {
    if (!currentConversationId) {
      setLog("请先选择会话。");
      return;
    }
    const title = window.prompt("输入新的会话标题");
    if (title === null) {
      return;
    }
    await window.api.renameHistoryConversation({
      conversationId: currentConversationId,
      title
    });
    await refreshHistory();
    setLog("会话标题已更新。");
  }

  async function removeCurrentConversation() {
    if (!currentConversationId) {
      setLog("请先选择会话。");
      return;
    }
    if (!window.confirm("确认删除当前会话？此操作不可恢复。")) {
      return;
    }
    await window.api.deleteHistoryConversation(currentConversationId);
    setSelectedHistoryIds((prev) => prev.filter((id) => id !== currentConversationId));
    setCurrentConversationId("");
    setHistoryMessages([]);
    await refreshHistory();
    setLog("会话已删除。");
  }

  function toggleHistorySelection(conversationId: string, checked: boolean) {
    setSelectedHistoryIds((prev) => {
      if (checked) {
        if (prev.includes(conversationId)) {
          return prev;
        }
        return [...prev, conversationId];
      }
      return prev.filter((id) => id !== conversationId);
    });
  }

  function toggleSelectAllHistory(checked: boolean) {
    setSelectedHistoryIds(checked ? historyItems.map((item) => item.id) : []);
  }

  async function removeSelectedConversations() {
    if (selectedHistoryIds.length === 0) {
      setLog("请先勾选要删除的会话。");
      return;
    }
    if (!window.confirm(`确认删除选中的 ${selectedHistoryIds.length} 个会话？`)) {
      return;
    }
    const deleted = await window.api.deleteHistoryConversations(selectedHistoryIds);
    if (selectedHistoryIds.includes(currentConversationId)) {
      setCurrentConversationId("");
      setHistoryMessages([]);
    }
    setSelectedHistoryIds([]);
    await refreshHistory();
    setLog(`批量删除完成：${deleted} 个会话。`);
  }

  async function renameSelectedConversations() {
    if (selectedHistoryIds.length === 0) {
      setLog("请先勾选要重命名的会话。");
      return;
    }
    const prefix = window.prompt("输入批量重命名前缀", "会话");
    if (prefix === null) {
      return;
    }
    const startNoInput = window.prompt("输入起始序号", "1");
    if (startNoInput === null) {
      return;
    }
    const startNo = Math.max(1, Number.parseInt(startNoInput, 10) || 1);
    const normalizedPrefix = String(prefix || "").trim() || "会话";
    const selectedSet = new Set(selectedHistoryIds);
    const selectedItems = historyItems.filter((item) => selectedSet.has(item.id));
    const orderedItems = [...selectedItems];
    if (batchRenameOrder !== "current_list") {
      const key = batchRenameOrder.startsWith("updated_") ? "updatedAt" : "createdAt";
      const asc = batchRenameOrder.endsWith("_asc");
      orderedItems.sort((a, b) => {
        const ta = Date.parse(a[key]) || 0;
        const tb = Date.parse(b[key]) || 0;
        return asc ? ta - tb : tb - ta;
      });
    }
    const digits = String(startNo + orderedItems.length - 1).length;
    const items = orderedItems.map((item, index) => ({
      conversationId: item.id,
      title: `${normalizedPrefix}-${String(startNo + index).padStart(digits, "0")}`
    }));
    const previewLines = items.slice(0, 10).map((item, index) => {
      const oldTitle = orderedItems[index]?.title || "(无标题)";
      return `${index + 1}. ${oldTitle} -> ${item.title}`;
    });
    const hasMore = items.length > 10;
    const previewText =
      `将按规则 ${batchRenameOrder} 重命名 ${items.length} 个会话：\n\n` +
      previewLines.join("\n") +
      (hasMore ? `\n... 另有 ${items.length - 10} 个会话` : "");
    if (!window.confirm(previewText)) {
      return;
    }
    const changed = await window.api.renameHistoryConversations({ items });
    await refreshHistory();
    setLog(`批量重命名完成：${changed} 个会话。`);
  }

  async function copyMessage(content: string) {
    await navigator.clipboard.writeText(content || "");
    setLog("已复制消息到剪贴板。");
  }

  async function exportCurrentConversation(format: "json" | "md" | "pdf") {
    if (!currentConversationId) {
      setLog("请先选择一个会话再导出。");
      return;
    }
    const result = await window.api.exportConversation({
      conversationId: currentConversationId,
      format,
      openDirAfterExport: openDirAfterSingleExport
    });
    if (!result.exported) {
      setLog("已取消导出。");
      return;
    }
    const openStatus = result.openedDirectory
      ? "，已自动打开目录"
      : result.openError
        ? `，目录打开失败：${result.openError}`
        : "";
    await addRecentExport({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path: result.filePath,
      kind: "file",
      createdAt: new Date().toISOString(),
      exists: true
    });
    setLog(`已导出 ${format.toUpperCase()}：${result.filePath}${openStatus}`);
  }

  async function exportSelectedConversations(format: "json" | "md" | "pdf") {
    if (selectedHistoryIds.length === 0) {
      setLog("请先勾选要导出的会话。");
      return;
    }
    const result = await window.api.exportHistoryConversations({
      conversationIds: selectedHistoryIds,
      format,
      openDirAfterExport: openDirAfterBatchExport
    });
    if (!result.exported) {
      setLog("已取消批量导出。");
      return;
    }
    const openStatus = result.openedDirectory
      ? "，已自动打开目录"
      : result.openError
        ? `，目录打开失败：${result.openError}`
        : "";
    await addRecentExport({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path: result.directoryPath,
      kind: "directory",
      createdAt: new Date().toISOString(),
      exists: true
    });
    setLog(`批量导出完成：${result.exportedCount} 个 ${format.toUpperCase()}，目录：${result.directoryPath}${openStatus}`);
  }

  async function persistRecentExports(items: RecentExportItem[]) {
    const normalized = items.slice(0, 20);
    setRecentExports(normalized);
    setSelectedExportIds((prev) => prev.filter((id) => normalized.some((item) => item.id === id)));
    await window.api.setRecentExports(normalized);
  }

  async function refreshRecentExportsStatus(items: RecentExportItem[]) {
    const paths = items.map((item) => item.path).filter(Boolean);
    if (paths.length === 0) {
      setRecentExports(items);
      return;
    }
    const statuses = await window.api.checkHistoryPaths(paths);
    const statusMap = new Map(statuses.map((item) => [item.path, item.exists]));
    setRecentExports(items.map((item) => ({ ...item, exists: Boolean(statusMap.get(item.path)) })));
  }

  async function reloadRecentExports() {
    const items = await window.api.getRecentExports();
    const normalized = Array.isArray(items) ? items.slice(0, 20) : [];
    await refreshRecentExportsStatus(normalized);
  }

  async function addRecentExport(item: RecentExportItem) {
    const current = await window.api.getRecentExports();
    const list = Array.isArray(current) ? current : [];
    const next = [item, ...list.filter((row) => row.path !== item.path)].slice(0, 20);
    await persistRecentExports(next);
  }

  async function openRecentExportPath(targetPath: string) {
    const result = await window.api.openHistoryPath(targetPath);
    if (!result.ok) {
      setLog(`打开失败：${result.error || "未知错误"}`);
      return;
    }
    setLog(`已打开：${targetPath}`);
  }

  async function clearRecentExports() {
    await persistRecentExports([]);
    setLog("已清空导出记录。");
  }

  async function removeRecentExport(itemId: string) {
    const next = recentExports.filter((item) => item.id !== itemId);
    await persistRecentExports(next);
  }

  async function copyExportPath(targetPath: string) {
    await navigator.clipboard.writeText(targetPath || "");
    setLog("已复制导出路径。");
  }

  function toggleExportSelection(itemId: string, checked: boolean) {
    setSelectedExportIds((prev) => {
      if (checked) {
        if (prev.includes(itemId)) {
          return prev;
        }
        return [...prev, itemId];
      }
      return prev.filter((id) => id !== itemId);
    });
  }

  function toggleSelectAllFilteredExports(checked: boolean, filtered: RecentExportItem[]) {
    if (!checked) {
      setSelectedExportIds((prev) => prev.filter((id) => !filtered.some((item) => item.id === id)));
      return;
    }
    setSelectedExportIds((prev) => {
      const set = new Set(prev);
      for (const item of filtered) {
        set.add(item.id);
      }
      return Array.from(set);
    });
  }

  function invertSelectFilteredExports(filtered: RecentExportItem[]) {
    const filteredIds = new Set(filtered.map((item) => item.id));
    setSelectedExportIds((prev) => {
      const selectedSet = new Set(prev);
      for (const item of filtered) {
        if (selectedSet.has(item.id)) {
          selectedSet.delete(item.id);
        } else {
          selectedSet.add(item.id);
        }
      }
      return recentExports.filter((item) => selectedSet.has(item.id) || (!filteredIds.has(item.id) && prev.includes(item.id))).map((item) => item.id);
    });
  }

  async function removeSelectedExports() {
    if (selectedExportIds.length === 0) {
      setLog("请先勾选导出记录。");
      return;
    }
    if (!window.confirm(`确认删除选中的 ${selectedExportIds.length} 条导出记录？`)) {
      return;
    }
    const next = recentExports.filter((item) => !selectedExportIds.includes(item.id));
    await persistRecentExports(next);
    setLog(`已删除导出记录：${selectedExportIds.length} 条。`);
  }

  async function copySelectedExportPaths() {
    if (selectedExportIds.length === 0) {
      setLog("请先勾选导出记录。");
      return;
    }
    const paths = recentExports.filter((item) => selectedExportIds.includes(item.id)).map((item) => item.path);
    await navigator.clipboard.writeText(paths.join("\n"));
    setLog(`已复制 ${paths.length} 条导出路径。`);
  }

  function clearExportSelection() {
    setSelectedExportIds([]);
  }

  async function cleanInvalidRecentExports() {
    const current = await window.api.getRecentExports();
    const list = Array.isArray(current) ? current : [];
    if (list.length === 0) {
      return;
    }
    const statuses = await window.api.checkHistoryPaths(list.map((item) => item.path));
    const statusMap = new Map(statuses.map((item) => [item.path, item.exists]));
    const invalidCount = list.filter((item) => !Boolean(statusMap.get(item.path))).length;
    if (invalidCount === 0) {
      setLog("没有可清理的失效记录。");
      return;
    }
    if (!window.confirm(`发现 ${invalidCount} 条失效记录，确认清理吗？`)) {
      return;
    }
    const next = list.filter((item) => Boolean(statusMap.get(item.path)));
    await persistRecentExports(next);
    await refreshRecentExportsStatus(next);
    setLog(`已清理失效记录：${list.length - next.length} 条。`);
  }

  async function dedupeRecentExports() {
    if (recentExports.length <= 1) {
      setLog("暂无可去重记录。");
      return;
    }
    const seen = new Set<string>();
    const next: RecentExportItem[] = [];
    for (const item of recentExports) {
      if (seen.has(item.path)) {
        continue;
      }
      seen.add(item.path);
      next.push(item);
    }
    if (next.length === recentExports.length) {
      setLog("暂无可去重记录。");
      return;
    }
    await persistRecentExports(next);
    await refreshRecentExportsStatus(next);
    setLog(`已去重导出记录：${recentExports.length - next.length} 条。`);
  }

  async function pickRagFiles() {
    const paths = await window.api.pickRagFiles();
    setRagFilePaths(paths);
    setLog(`已选择 ${paths.length} 个文件。`);
  }

  async function runRagIngest() {
    if (!selectedProviderId || !selectedModelId) {
      setLog("请先选择嵌入模型对应的供应商和模型。");
      return;
    }
    if (ragFilePaths.length === 0) {
      setLog("请先选择知识库文件。");
      return;
    }
    const files = ragFilePaths.map((p) => ({
      name: p.split(/[/\\]/).pop() || p,
      size: 0,
      path: p
    }));
    const result = await window.api.ingestRagFiles({
      providerId: selectedProviderId,
      embeddingModelId: selectedModelId,
      files
    });
    setLog(`知识库入库：${result.message}（已接收 ${result.accepted} 个文件）`);
  }

  async function runRagSearch() {
    if (!selectedProviderId || !selectedModelId) {
      setLog("请先选择嵌入模型对应的供应商和模型。");
      return;
    }
    const result = await window.api.runRagSearch({
      providerId: selectedProviderId,
      embeddingModelId: selectedModelId,
      query: ragQuery,
      topK: ragTopK
    });
    setLog(`知识库检索命中：\n${JSON.stringify(result.chunks, null, 2)}`);
  }

  async function pickReferenceImage() {
    const imagePath = await window.api.pickImageFile();
    if (!imagePath) {
      return;
    }
    setReferenceImagePath(imagePath);
  }

  async function runImage() {
    if (!selectedProviderId || !selectedModelId) {
      setLog("请先选择供应商和模型。");
      return;
    }
    const result = await window.api.generateImage({
      providerId: selectedProviderId,
      modelId: selectedModelId,
      prompt: imagePrompt,
      imagePath: referenceImagePath || undefined
    });
    setLog(`生图结果：${result.info}\n图片链接：${result.imageUrl || "（无）"}`);
  }

  async function saveLimit() {
    await window.api.setMonthlyLimit(monthlyLimit);
    setLog(`月限额已更新：${monthlyLimit} 元`);
  }

  async function allowOnce() {
    await window.api.allowCurrentRequestOverLimit();
    setLog("已允许仅本次请求超限。");
  }

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const selectedModels = selectedProvider?.models || [];
  const selectedModelOptions = selectedModels.map((m) => m.id);

  const modelOptionsText = useMemo(
    () => providers.map((p) => `${p.name}: ${p.models.map((m) => m.id).join(", ")}`).join("\n"),
    [providers]
  );
  const visibleHistoryMessages = useMemo(
    () => historyMessages.filter((item) => (messageRoleFilter === "all" ? true : item.role === messageRoleFilter)),
    [historyMessages, messageRoleFilter]
  );
  const allHistorySelected = useMemo(
    () => historyItems.length > 0 && historyItems.every((item) => selectedHistoryIds.includes(item.id)),
    [historyItems, selectedHistoryIds]
  );
  const filteredRecentExports = useMemo(() => {
    let list = recentExports;
    if (exportRecordFilter === "all") {
      list = recentExports;
    } else if (exportRecordFilter === "invalid") {
      list = recentExports.filter((item) => item.exists === false);
    } else {
      list = recentExports.filter((item) => item.kind === exportRecordFilter);
    }

    const keyword = exportRecordKeyword.trim().toLowerCase();
    if (keyword) {
      list = list.filter((item) => {
        const name = item.path.split(/[/\\]/).pop() || item.path;
        return item.path.toLowerCase().includes(keyword) || name.toLowerCase().includes(keyword);
      });
    }

    if (onlyShowSelectedExports) {
      list = list.filter((item) => selectedExportIds.includes(item.id));
    }
    list = [...list].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return exportRecordSort === "created_desc" ? tb - ta : ta - tb;
    });
    return list;
  }, [recentExports, exportRecordFilter, exportRecordKeyword, onlyShowSelectedExports, selectedExportIds, exportRecordSort]);
  const selectedExportCountInFiltered = useMemo(
    () => filteredRecentExports.filter((item) => selectedExportIds.includes(item.id)).length,
    [filteredRecentExports, selectedExportIds]
  );
  const invalidExportCount = useMemo(() => recentExports.filter((item) => item.exists === false).length, [recentExports]);
  const allFilteredExportsSelected = useMemo(
    () => filteredRecentExports.length > 0 && filteredRecentExports.every((item) => selectedExportIds.includes(item.id)),
    [filteredRecentExports, selectedExportIds]
  );
  const onboardingCompleted = useMemo(
    () => ({
      provider: providers.length > 0,
      apiKey: providerForm.apiKey.trim().length > 0,
      testSent: historyMessages.length > 0
    }),
    [providers.length, providerForm.apiKey, historyMessages.length]
  );

  return (
    <>
      <div className="layout">
        <aside className="sidebar">
          <h1>UI-LLM</h1>
          {tabs.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </aside>
        <main className="content">
        {showOnboarding && (
          <section className="onboardingCard">
            <div className="sectionHeader">
              <h2>{isZh ? "首次使用引导（3 步）" : "Getting Started (3 Steps)"}</h2>
              <button
                className="secondary"
                onClick={() => {
                  window.localStorage.setItem("ui-llm.onboarding.dismissed.v1", "1");
                  setShowOnboarding(false);
                }}
              >
                {isZh ? "跳过" : "Skip"}
              </button>
            </div>
            <div className="quickStartSteps">
              <div className={`quickStep ${onboardingStep === 1 ? "active" : ""}`}>
                <strong>{isZh ? "步骤 1：选择供应商" : "Step 1: Choose provider"}</strong>
                <span>{onboardingCompleted.provider ? (isZh ? "已完成" : "Done") : isZh ? "未完成" : "Pending"}</span>
                <button
                  className="secondary"
                  onClick={() => {
                    setOnboardingStep(1);
                    setActiveTab("providers");
                  }}
                >
                  {isZh ? "前往配置" : "Open providers"}
                </button>
              </div>
              <div className={`quickStep ${onboardingStep === 2 ? "active" : ""}`}>
                <strong>{isZh ? "步骤 2：填写 API Key" : "Step 2: Fill API key"}</strong>
                <span>{onboardingCompleted.apiKey ? (isZh ? "已填写（本次）" : "Filled (this session)") : isZh ? "未填写" : "Pending"}</span>
                <button
                  className="secondary"
                  onClick={() => {
                    setOnboardingStep(2);
                    setActiveTab("providers");
                  }}
                >
                  {isZh ? "去供应商页" : "Go to providers"}
                </button>
              </div>
              <div className={`quickStep ${onboardingStep === 3 ? "active" : ""}`}>
                <strong>{isZh ? "步骤 3：发送测试消息" : "Step 3: Send test message"}</strong>
                <span>{onboardingCompleted.testSent ? (isZh ? "已完成" : "Done") : isZh ? "未完成" : "Pending"}</span>
                <button
                  className="secondary"
                  onClick={() => {
                    setOnboardingStep(3);
                    setActiveTab("chat");
                    if (!chatPrompt.trim()) {
                      setChatPrompt(isZh ? "你好，做个连通性测试" : "Hello, run a connectivity test.");
                    }
                  }}
                >
                  {isZh ? "去聊天页" : "Open chat"}
                </button>
              </div>
            </div>
            <div className="actions">
              <button
                onClick={() => {
                  window.localStorage.setItem("ui-llm.onboarding.dismissed.v1", "1");
                  setShowOnboarding(false);
                }}
              >
                {isZh ? "完成引导" : "Finish"}
              </button>
            </div>
          </section>
        )}
        {activeTab === "settings" && (
          <section>
            <div className="sectionHeader">
              <h2>{isZh ? "设置" : "Settings"}</h2>
              <div className="actions">
                <button className={locale === "zh" ? "active" : "secondary"} onClick={() => setLocale("zh")}>
                  中文
                </button>
                <button className={locale === "en" ? "active" : "secondary"} onClick={() => setLocale("en")}>
                  English
                </button>
              </div>
            </div>
            <h3>{isZh ? "外观" : "Appearance"}</h3>
            <div className="actions">
              <button className={themeMode === "deep" ? "active" : "secondary"} onClick={() => applyThemeMode("deep")}>
                {isZh ? "深色（蓝黑）" : "Deep (blue-black)"}
              </button>
              <button className={themeMode === "dark" ? "active" : "secondary"} onClick={() => applyThemeMode("dark")}>
                {isZh ? "暗色（灰黑）" : "Dark (neutral)"}
              </button>
              <button className={themeMode === "light" ? "active" : "secondary"} onClick={() => applyThemeMode("light")}>
                {isZh ? "浅色" : "Light"}
              </button>
            </div>
            <p className="hint">{isZh ? "主题会自动保存，重启后仍生效。" : "Theme is saved and persists after restart."}</p>
          </section>
        )}
        {activeTab !== "settings" && (
          <section>
            <h2>{isZh ? "当前选择" : "Current Selection"}</h2>
            <div className="grid2">
              <label>
                {isZh ? "供应商" : "Provider"}
                <select value={selectedProviderId} onChange={(e) => setSelectedProviderId(e.target.value)}>
                  <option value="">{isZh ? "请选择" : "Please select"}</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {isZh ? "模型" : "Model"}
                <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
                  <option value="">{isZh ? "请选择" : "Please select"}</option>
                  {selectedModelOptions.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint">
              {isZh ? "可用模型" : "Available models"}: {modelOptionsText || (isZh ? "暂无" : "None")}
            </p>
          </section>
        )}
        {activeTab === "providers" && (
          <section>
            <h2>{isZh ? "供应商管理" : "Provider Management"}</h2>
            <p>{isZh ? "已接入：" : "Configured: "}{providerOptions.length === 0 ? (isZh ? "暂无" : "None") : providerOptions.join("，")}</p>
            <div className="grid2">
              <label>
                {isZh ? "名称" : "Name"}
                <input value={providerForm.name} onChange={(e) => setProviderForm((s) => ({ ...s, name: e.target.value }))} />
              </label>
              <label>
                {isZh ? "接口地址（BaseURL）" : "Base URL"}
                <input value={providerForm.baseUrl} onChange={(e) => setProviderForm((s) => ({ ...s, baseUrl: e.target.value }))} />
              </label>
              <label>
                {isZh ? "API 密钥（留空表示不更新）" : "API Key (leave empty to keep unchanged)"}
                <input
                  type="password"
                  value={providerForm.apiKey}
                  onChange={(e) => setProviderForm((s) => ({ ...s, apiKey: e.target.value }))}
                />
              </label>
              <label>
                {isZh ? "输入单价(CNY/1k)" : "Input Cost (CNY/1k)"}
                <input
                  type="number"
                  value={providerForm.inputCostPer1k}
                  onChange={(e) => setProviderForm((s) => ({ ...s, inputCostPer1k: Number(e.target.value) }))}
                />
              </label>
              <label>
                {isZh ? "输出单价(CNY/1k)" : "Output Cost (CNY/1k)"}
                <input
                  type="number"
                  value={providerForm.outputCostPer1k}
                  onChange={(e) => setProviderForm((s) => ({ ...s, outputCostPer1k: Number(e.target.value) }))}
                />
              </label>
              <label>
                {isZh ? "生图单价(CNY/次)" : "Image Cost (CNY/call)"}
                <input
                  type="number"
                  value={providerForm.imageCostPerCall}
                  onChange={(e) => setProviderForm((s) => ({ ...s, imageCostPerCall: Number(e.target.value) }))}
                />
              </label>
            </div>
            <label className="block">
              {isZh ? "模型列表（每行：模型ID,展示名）" : "Models (one per line: model-id,display-name)"}
              <textarea
                rows={6}
                value={providerForm.modelLines}
                onChange={(e) => setProviderForm((s) => ({ ...s, modelLines: e.target.value }))}
              />
            </label>
            <div className="actions">
              <button onClick={saveProviderForm}>{isZh ? "保存供应商" : "Save Provider"}</button>
              <button className="secondary" onClick={resetProviderForm}>
                {isZh ? "清空表单" : "Reset Form"}
              </button>
            </div>
            <div className="list">
              {providers.map((provider) => (
                <div key={provider.id} className="listRow">
                  <span>{provider.name}</span>
                  <div className="actions">
                    <button className="secondary" onClick={() => loadProviderToForm(provider)}>
                      {isZh ? "编辑" : "Edit"}
                    </button>
                    <button className="danger" onClick={() => removeProvider(provider.id)}>
                      {isZh ? "删除" : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {activeTab === "chat" && (
          <section>
            <div className="sectionHeader">
              <h2>{isZh ? "聊天" : "Chat"}</h2>
              <div className="actions">
                <button className="secondary" onClick={refreshHistory} disabled={chatStreaming}>
                  {isZh ? "刷新会话" : "Refresh"}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    if (chatStreaming) {
                      return;
                    }
                    setCurrentConversationId("");
                    setHistoryMessages([]);
                    setChatMessages([]);
                    setChatPrompt("");
                    resizeChatInput();
                  }}
                  disabled={chatStreaming}
                >
                  {isZh ? "新会话" : "New Chat"}
                </button>
                <button className="secondary" onClick={renameCurrentConversation} disabled={!currentConversationId || chatStreaming}>
                  {isZh ? "重命名" : "Rename"}
                </button>
                <button className="danger" onClick={removeCurrentConversation} disabled={!currentConversationId || chatStreaming}>
                  {isZh ? "删除" : "Delete"}
                </button>
              </div>
            </div>
            <div className="chatShell">
              <aside className="chatSidebarPanel">
                <label>
                  {isZh ? "会话搜索" : "Search"}
                  <input value={historyKeyword} onChange={(e) => setHistoryKeyword(e.target.value)} />
                </label>
                <label>
                  {isZh ? "会话排序" : "Sort"}
                  <select value={historySortBy} onChange={(e) => setHistorySortBy(e.target.value as typeof historySortBy)}>
                    <option value="updated_desc">{isZh ? "最近活跃优先" : "Recently active first"}</option>
                    <option value="updated_asc">{isZh ? "最早活跃优先" : "Oldest active first"}</option>
                    <option value="created_desc">{isZh ? "最新创建优先" : "Newest created first"}</option>
                    <option value="created_asc">{isZh ? "最早创建优先" : "Oldest created first"}</option>
                  </select>
                </label>
                <div className="chatSidebarList">
                  {historyItems.length === 0 && <div className="hint">{isZh ? "暂无会话记录" : "No conversations"}</div>}
                  {historyItems.map((item) => (
                    <button
                      key={item.id}
                      className={`chatThreadRow ${item.id === currentConversationId ? "active" : ""}`}
                      disabled={chatStreaming}
                      onClick={() => loadConversation(item.id)}
                    >
                      <div className="chatThreadTitle">{item.title || (isZh ? "(无标题)" : "(Untitled)")}</div>
                      <div className="chatThreadMeta">
                        <span>{item.modelId}</span>
                        <span>{isZh ? `${item.messageCount} 条` : `${item.messageCount} msgs`}</span>
                        <span>{formatRelativeTime(item.updatedAt, locale)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </aside>
              <div className="chatMainPanel">
                <div className="chatMessages" ref={chatListRef}>
                  {chatMessages.length === 0 && (
                    <div className="hint">
                      {currentConversationId
                        ? isZh
                          ? "该会话暂无消息。"
                          : "No messages in this conversation."
                        : isZh
                          ? "请选择左侧会话，或直接发送消息开始新会话。"
                          : "Pick a conversation or send a message to start a new one."}
                    </div>
                  )}
                  {chatHasUnread && chatMessages.length > 0 && (
                    <button className="chatScrollToBottom" onClick={() => scheduleScrollChatToBottom(true)}>
                      {isZh ? "回到底部" : "Scroll to bottom"}
                    </button>
                  )}
                  {chatMessages.map((msg, idx) => (
                    <div key={msg.id} className={`chatBubbleRow role-${msg.role}`}>
                      <div className={`chatBubble role-${msg.role}`}>
                        <div className="chatBubbleMeta">
                          <span>
                            {formatRoleLabel(msg.role, locale)}
                            {msg.status === "aborted" && <span className="chatBadge">{isZh ? "已中止" : "Aborted"}</span>}
                            {msg.status === "error" && <span className="chatBadge danger">{isZh ? "失败" : "Failed"}</span>}
                          </span>
                          <span>{new Date(msg.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="chatBubbleContent">
                          {msg.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          ) : msg.status === "pending" ? (
                            <div className="hint">{isZh ? "生成中…" : "Generating..."}</div>
                          ) : msg.status === "error" ? (
                            <div className="chatErrorBox">
                              <div className="hint">{msg.errorText || (isZh ? "请求失败" : "Request failed")}</div>
                              <button
                                className="secondary"
                                onClick={() => {
                                  const prevUser = [...chatMessages].slice(0, idx).reverse().find((m) => m.role === "user")?.content || "";
                                  if (!prevUser) {
                                    return;
                                  }
                                  setChatPrompt(prevUser);
                                  resizeChatInput();
                                  scheduleScrollChatToBottom(true);
                                  void runChat(prevUser);
                                }}
                                disabled={chatStreaming}
                              >
                                {isZh ? "重试" : "Retry"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="chatComposer">
                  <textarea
                    ref={chatInputRef}
                    className="chatInput"
                    rows={1}
                    value={chatPrompt}
                    placeholder={isZh ? "在这里输入，Enter 发送，Shift+Enter 换行" : "Type here. Enter to send, Shift+Enter for newline."}
                    onChange={(e) => {
                      setChatPrompt(e.target.value);
                      resizeChatInput();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        runChat().then(() => {
                          // no-op
                        });
                      }
                    }}
                  />
                  <div className="chatComposerActions">
                    {chatStreaming ? (
                      <button className="danger" onClick={stopChat} disabled={chatStopping}>
                        {chatStopping ? (isZh ? "停止中…" : "Stopping...") : isZh ? "停止生成" : "Stop"}
                      </button>
                    ) : (
                      <button onClick={runChat}>{isZh ? "发送" : "Send"}</button>
                    )}
                    <button
                      className="secondary"
                      onClick={() => {
                        setChatPrompt("");
                        resizeChatInput();
                      }}
                      disabled={chatStreaming}
                    >
                      {isZh ? "清空输入" : "Clear"}
                    </button>
                    <label className="checkline">
                      <input type="checkbox" checked={useRagInChat} onChange={(e) => setUseRagInChat(e.target.checked)} disabled={chatStreaming} />
                      {isZh ? "聊天注入 RAG" : "Inject RAG"}
                    </label>
                  </div>
                  <details className="advancedPanel">
                    <summary>{isZh ? "参数设置" : "Parameters"}</summary>
                    <label className="block">
                      {isZh ? "系统提示词" : "System Prompt"}
                      <textarea rows={3} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} disabled={chatStreaming} />
                    </label>
                    <div className="grid2">
                      <label>
                        {isZh ? "上下文消息条数" : "Context Message Count"}
                        <input
                          type="number"
                          min={0}
                          value={contextLength}
                          onChange={(e) => setContextLength(Number(e.target.value))}
                          disabled={chatStreaming}
                        />
                      </label>
                      <label>
                        {isZh ? "温度" : "Temperature"}
                        <input
                          type="number"
                          step="0.1"
                          value={temperature}
                          onChange={(e) => setTemperature(Number(e.target.value))}
                          disabled={chatStreaming}
                        />
                      </label>
                    </div>
                    <div className="grid2">
                      <label>
                        {isZh ? "最大输出token" : "Max Output Tokens"}
                        <input type="number" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} disabled={chatStreaming} />
                      </label>
                      <label>
                        {isZh ? "RAG 注入模式" : "RAG Inject Mode"}
                        <select
                          value={ragInjectMode}
                          onChange={(e) => setRagInjectMode(e.target.value as "snippets" | "summary" | "auto")}
                          disabled={chatStreaming}
                        >
                          <option value="auto">{isZh ? "自动" : "Auto"}</option>
                          <option value="snippets">{isZh ? "原文片段" : "Source Snippets"}</option>
                          <option value="summary">{isZh ? "压缩摘要" : "Compressed Summary"}</option>
                        </select>
                      </label>
                    </div>
                    <details className="advancedPanel" open={showRagAdvanced} onToggle={(e) => setShowRagAdvanced(e.currentTarget.open)}>
                      <summary>{isZh ? "RAG 高级设置（TopK / 阈值）" : "RAG Advanced"}</summary>
                      <div className="grid2">
                        <label>
                          {isZh ? "RAG 检索数量（TopK）" : "RAG TopK"}
                          <input type="number" min={1} value={ragTopK} onChange={(e) => setRagTopK(Number(e.target.value))} disabled={chatStreaming} />
                        </label>
                        <label>
                          {isZh ? "自动切摘要阈值（问题长度）" : "Auto-summary Threshold (question length)"}
                          <input
                            type="number"
                            min={20}
                            value={ragAutoPromptThreshold}
                            onChange={(e) => setRagAutoPromptThreshold(Number(e.target.value))}
                            disabled={chatStreaming}
                          />
                        </label>
                      </div>
                      <label>
                        {isZh ? "自动切摘要阈值（TopK）" : "Auto-summary Threshold (TopK)"}
                        <input
                          type="number"
                          min={1}
                          value={ragAutoTopKThreshold}
                          onChange={(e) => setRagAutoTopKThreshold(Number(e.target.value))}
                          disabled={chatStreaming}
                        />
                      </label>
                    </details>
                  </details>
                  <details className="advancedPanel">
                    <summary>{isZh ? "导出与批量管理" : "Export & Batch"}</summary>
                    <label className="checkline">
                      <input
                        type="checkbox"
                        checked={openDirAfterSingleExport}
                        onChange={(e) => setOpenDirAfterSingleExport(e.target.checked)}
                        disabled={chatStreaming}
                      />
                      {isZh ? "单会话导出后自动打开目录" : "Open folder after single export"}
                    </label>
                    <div className="actions">
                      <button className="secondary" onClick={() => exportCurrentConversation("json")} disabled={!currentConversationId || chatStreaming}>
                        {isZh ? "导出JSON" : "Export JSON"}
                      </button>
                      <button className="secondary" onClick={() => exportCurrentConversation("md")} disabled={!currentConversationId || chatStreaming}>
                        {isZh ? "导出MD" : "Export MD"}
                      </button>
                      <button className="secondary" onClick={() => exportCurrentConversation("pdf")} disabled={!currentConversationId || chatStreaming}>
                        {isZh ? "导出PDF" : "Export PDF"}
                      </button>
                    </div>
                    <label className="checkline">
                      <input
                        type="checkbox"
                        checked={openDirAfterBatchExport}
                        onChange={(e) => setOpenDirAfterBatchExport(e.target.checked)}
                        disabled={chatStreaming}
                      />
                      {isZh ? "批量导出完成后自动打开目录" : "Open folder after batch export"}
                    </label>
                    <div className="actions">
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={allHistorySelected}
                          onChange={(e) => toggleSelectAllHistory(e.target.checked)}
                          disabled={chatStreaming}
                        />
                        {isZh ? "全选会话" : "Select all chats"}
                      </label>
                      <button className="secondary" onClick={renameSelectedConversations} disabled={selectedHistoryIds.length === 0 || chatStreaming}>
                        {isZh ? "批量重命名" : "Batch Rename"}
                      </button>
                      <button className="danger" onClick={removeSelectedConversations} disabled={selectedHistoryIds.length === 0 || chatStreaming}>
                        {isZh ? `批量删除(${selectedHistoryIds.length})` : `Batch Delete (${selectedHistoryIds.length})`}
                      </button>
                      <button className="secondary" onClick={() => exportSelectedConversations("json")} disabled={selectedHistoryIds.length === 0 || chatStreaming}>
                        {isZh ? "批量JSON" : "Batch JSON"}
                      </button>
                      <button className="secondary" onClick={() => exportSelectedConversations("md")} disabled={selectedHistoryIds.length === 0 || chatStreaming}>
                        {isZh ? "批量MD" : "Batch MD"}
                      </button>
                      <button className="secondary" onClick={() => exportSelectedConversations("pdf")} disabled={selectedHistoryIds.length === 0 || chatStreaming}>
                        {isZh ? "批量PDF" : "Batch PDF"}
                      </button>
                    </div>
                    <label>
                      {isZh ? "批量重命名排序" : "Batch Rename Order"}
                      <select
                        value={batchRenameOrder}
                        onChange={(e) =>
                          setBatchRenameOrder(
                            e.target.value as "current_list" | "updated_desc" | "updated_asc" | "created_desc" | "created_asc"
                          )
                        }
                        disabled={chatStreaming}
                      >
                        <option value="current_list">{isZh ? "按当前列表顺序" : "Current list order"}</option>
                        <option value="updated_desc">{isZh ? "按更新时间（新到旧）" : "Updated time (new to old)"}</option>
                        <option value="updated_asc">{isZh ? "按更新时间（旧到新）" : "Updated time (old to new)"}</option>
                        <option value="created_desc">{isZh ? "按创建时间（新到旧）" : "Created time (new to old)"}</option>
                        <option value="created_asc">{isZh ? "按创建时间（旧到新）" : "Created time (old to new)"}</option>
                      </select>
                    </label>
                    <div className="list compactList">
                      {historyItems.length === 0 && <div className="hint">{isZh ? "暂无会话记录" : "No conversation records"}</div>}
                      {historyItems.map((item) => (
                        <div key={item.id} className={`listRow ${item.id === currentConversationId ? "selectedRow" : ""}`}>
                          <span>
                            <input
                              type="checkbox"
                              checked={selectedHistoryIds.includes(item.id)}
                              onChange={(e) => toggleHistorySelection(item.id, e.target.checked)}
                              disabled={chatStreaming}
                            />{" "}
                            {item.title || (isZh ? "(无标题)" : "(Untitled)")} | {item.modelId} |{" "}
                            {isZh ? `${item.messageCount} 条` : `${item.messageCount} msgs`}
                          </span>
                          <div className="actions">
                            <button className="secondary" onClick={() => loadConversation(item.id)} disabled={chatStreaming}>
                              {isZh ? "打开" : "Open"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="actions">
                      <button className="secondary" onClick={reloadRecentExports} disabled={chatStreaming}>
                        {isZh ? "刷新导出记录状态" : "Refresh export status"}
                      </button>
                      <button className="secondary" onClick={dedupeRecentExports} disabled={chatStreaming}>
                        {isZh ? "去重导出记录" : "Dedupe export records"}
                      </button>
                      <button className="secondary" onClick={cleanInvalidRecentExports} disabled={chatStreaming}>
                        {isZh ? "清理失效导出记录" : "Clean invalid export records"}
                      </button>
                      <button className="secondary" onClick={clearRecentExports} disabled={chatStreaming}>
                        {isZh ? "清空导出记录" : "Clear export records"}
                      </button>
                    </div>
                    <div className="list compactList">
                      {filteredRecentExports.length === 0 && <div className="hint">{isZh ? "暂无导出记录" : "No export records"}</div>}
                      {filteredRecentExports.map((item) => {
                        const name = item.path.split(/[/\\]/).pop() || item.path;
                        return (
                          <div key={item.id} className="listRow">
                            <span>
                              [{item.kind === "directory" ? (isZh ? "目录" : "Directory") : isZh ? "文件" : "File"}] {name} |{" "}
                              {formatRelativeTime(item.createdAt, locale)} |{" "}
                              {item.exists === false ? (isZh ? "已失效" : "Invalid") : isZh ? "可用" : "Available"}
                            </span>
                            <div className="actions">
                              <button className="secondary" onClick={() => openRecentExportPath(item.path)} disabled={chatStreaming}>
                                {isZh ? "打开" : "Open"}
                              </button>
                              <button className="secondary" onClick={() => copyExportPath(item.path)} disabled={chatStreaming}>
                                {isZh ? "复制路径" : "Copy path"}
                              </button>
                              <button className="danger" onClick={() => removeRecentExport(item.id)} disabled={chatStreaming}>
                                {isZh ? "删除" : "Delete"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </section>
        )}
        {activeTab === "rag" && (
          <section>
            <h2>{isZh ? "知识库（RAG）" : "Knowledge Base (RAG)"}</h2>
            <p>{isZh ? "支持 txt/md/pdf，单次最多 3 文件，总大小 15MB。" : "Supports txt/md/pdf, up to 3 files per run, total 15MB."}</p>
            <div className="actions">
              <button onClick={pickRagFiles}>{isZh ? "选择文件" : "Choose Files"}</button>
              <button onClick={runRagIngest}>{isZh ? "执行入库" : "Ingest"}</button>
            </div>
            <p className="hint">{isZh ? "已选文件" : "Selected files"}: {ragFilePaths.length ? ragFilePaths.join(" | ") : isZh ? "无" : "None"}</p>
            <label className="block">
              {isZh ? "检索问题" : "Query"}
              <input value={ragQuery} onChange={(e) => setRagQuery(e.target.value)} />
            </label>
            <label>
              {isZh ? "检索数量（TopK）" : "TopK"}
              <input type="number" value={ragTopK} onChange={(e) => setRagTopK(Number(e.target.value))} />
            </label>
            <button onClick={runRagSearch}>{isZh ? "执行检索" : "Search"}</button>
          </section>
        )}
        {activeTab === "image" && (
          <section>
            <h2>{isZh ? "生图 / 图生图" : "Image Generation / Img2Img"}</h2>
            <label className="block">
              {isZh ? "生图提示词" : "Image Prompt"}
              <textarea rows={4} value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} />
            </label>
            <div className="actions">
              <button onClick={pickReferenceImage}>{isZh ? "选择参考图（可选）" : "Choose Reference Image (optional)"}</button>
              <button onClick={runImage}>{isZh ? "生成图片" : "Generate Image"}</button>
            </div>
            <p className="hint">{isZh ? "参考图" : "Reference image"}: {referenceImagePath || (isZh ? "未选择（文生图模式）" : "Not selected (text-to-image mode)")}</p>
          </section>
        )}
        {activeTab === "billing" && (
          <section>
            <h2>{isZh ? "限额与成本" : "Budget and Cost"}</h2>
            <label>
              {isZh ? "每月限额（CNY）" : "Monthly Limit (CNY)"}
              <input type="number" min={0} value={monthlyLimit} onChange={(e) => setMonthlyLimit(Number(e.target.value))} />
            </label>
            <div className="actions">
              <button onClick={saveLimit}>{isZh ? "保存限额" : "Save Limit"}</button>
              <button className="secondary" onClick={allowOnce}>
                {isZh ? "放开本次请求" : "Allow this request once"}
              </button>
            </div>
          </section>
        )}
        <section className="logBox">
          <div className="sectionHeader">
            <h3>{isZh ? "运行日志（事件时间线）" : "Runtime Log (Timeline)"}</h3>
            <button
              className="secondary"
              onClick={() => {
                setLogEvents([]);
              }}
            >
              {isZh ? "清空日志" : "Clear logs"}
            </button>
          </div>
          <div className="list compactList">
            {logEvents.length === 0 && <div className="hint">{isZh ? "暂无日志事件" : "No log events yet"}</div>}
            {logEvents.map((entry) => (
              <div key={entry.id} className={`timelineItem logTimelineItem level-${entry.level}`}>
                <div className="timelineMeta">
                  <span>
                    {entry.level === "error"
                      ? isZh
                        ? "错误"
                        : "Error"
                      : entry.level === "warning"
                        ? isZh
                          ? "警告"
                          : "Warning"
                        : entry.level === "success"
                          ? isZh
                            ? "成功"
                            : "Success"
                          : isZh
                            ? "信息"
                            : "Info"}
                  </span>
                  <div className="actions">
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    {entry.level === "error" && (
                      <button className="secondary" onClick={() => copyLogMessage(entry.message)}>
                        {isZh ? "复制错误详情" : "Copy error detail"}
                      </button>
                    )}
                  </div>
                </div>
                <pre>{entry.message}</pre>
              </div>
            ))}
          </div>
        </section>
        </main>
      </div>
      <footer className="appFooter">Made by LSRain</footer>
    </>
  );
}
