export type ProviderModel = {
  id: string;
  name: string;
  supportsChat?: boolean;
  supportsImage?: boolean;
  supportsEmbedding?: boolean;
};

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  credentialRefId?: string;
  models: ProviderModel[];
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  imageCostPerCall?: number;
  apiKey?: string;
};

export type AppConfig = {
  monthlyLimitCny: number;
  temporaryOverLimitForOneRequest: boolean;
  themeMode: "deep" | "dark" | "light";
  providers: ProviderConfig[];
};

export type DesktopApi = {
  getProviders: () => Promise<ProviderConfig[]>;
  saveProvider: (provider: ProviderConfig) => Promise<ProviderConfig>;
  deleteProvider: (providerId: string) => Promise<boolean>;
  getAppConfig: () => Promise<AppConfig>;
  setMonthlyLimit: (amount: number) => Promise<number>;
  setThemeMode: (mode: "deep" | "dark" | "light") => Promise<"deep" | "dark" | "light">;
  allowCurrentRequestOverLimit: () => Promise<boolean>;
  sendChat: (payload: {
    providerId: string;
    modelId: string;
    conversationId?: string;
    prompt: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    contextLength?: number;
    useRag?: boolean;
    ragEmbeddingModelId?: string;
    ragTopK?: number;
    ragInjectMode?: "snippets" | "summary" | "auto";
    ragAutoPromptThreshold?: number;
    ragAutoTopKThreshold?: number;
  }) => Promise<{
    conversationId: string;
    text: string;
    usage: { promptTokens: number; completionTokens: number; totalCostCny: number; source: string };
  }>;
  startChatStream: (payload: {
    providerId: string;
    modelId: string;
    conversationId?: string;
    prompt: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    contextLength?: number;
    useRag?: boolean;
    ragEmbeddingModelId?: string;
    ragTopK?: number;
    ragInjectMode?: "snippets" | "summary" | "auto";
    ragAutoPromptThreshold?: number;
    ragAutoTopKThreshold?: number;
  }) => Promise<{ streamId: string; conversationId: string }>;
  stopChatStream: (payload: { streamId: string }) => Promise<boolean>;
  onChatStreamDelta: (handler: (payload: { streamId: string; delta: string }) => void) => () => void;
  onChatStreamDone: (handler: (payload: { streamId: string; conversationId: string; text: string; usage: unknown; aborted: boolean }) => void) => () => void;
  onChatStreamError: (handler: (payload: { streamId: string; message: string; conversationId?: string }) => void) => () => void;
  generateImage: (payload: {
    providerId: string;
    modelId: string;
    prompt: string;
    imagePath?: string;
  }) => Promise<{ info: string; imageUrl: string }>;
  runRagSearch: (payload: {
    providerId: string;
    embeddingModelId: string;
    query: string;
    topK?: number;
  }) => Promise<{ query: string; chunks: unknown[] }>;
  ingestRagFiles: (payload: {
    providerId: string;
    embeddingModelId: string;
    userDataPath?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    files: Array<{ name: string; size: number; path?: string; filePath?: string }>;
  }) => Promise<{ accepted: number; message: string }>;
  listHistory: (payload: {
    providerId?: string;
    modelId?: string;
    keyword?: string;
    sortBy?: "updated_desc" | "updated_asc" | "created_desc" | "created_asc";
  }) => Promise<
    Array<{
      id: string;
      providerId: string;
      modelId: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
    }>
  >;
  getHistoryMessages: (conversationId: string) => Promise<
    Array<{
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
    }>
  >;
  renameHistoryConversation: (payload: { conversationId: string; title: string }) => Promise<boolean>;
  renameHistoryConversations: (payload: {
    items: Array<{ conversationId: string; title: string }>;
  }) => Promise<number>;
  deleteHistoryConversation: (conversationId: string) => Promise<boolean>;
  deleteHistoryConversations: (conversationIds: string[]) => Promise<number>;
  openHistoryPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
  getRecentExports: () => Promise<Array<{ id: string; path: string; kind: "file" | "directory"; createdAt: string }>>;
  setRecentExports: (items: Array<{ id: string; path: string; kind: "file" | "directory"; createdAt: string }>) => Promise<boolean>;
  checkHistoryPaths: (paths: string[]) => Promise<Array<{ path: string; exists: boolean }>>;
  exportConversation: (payload: {
    conversationId: string;
    format: "json" | "md" | "pdf";
    openDirAfterExport?: boolean;
  }) => Promise<{ exported: boolean; filePath: string; openedDirectory?: boolean; openError?: string }>;
  exportHistoryConversations: (payload: {
    conversationIds: string[];
    format: "json" | "md" | "pdf";
    openDirAfterExport?: boolean;
  }) => Promise<{
    exported: boolean;
    exportedCount: number;
    directoryPath: string;
    files: string[];
    openedDirectory?: boolean;
    openError?: string;
  }>;
  pickRagFiles: () => Promise<string[]>;
  pickImageFile: () => Promise<string>;
};
