import type { Bookmark, ReaderAnnotation } from '../annotations/annotationModels';

export type PaperMetadata = {
  title: string;
  authors: string[];
  journal: string;
  year: string;
  doi: string;
  abstract: string;
  keywords: string[];
  researchTopics: string[];
  researchFields: string[];
  disciplines: string[];
  journalType: string;
  indexingStatus: string;
};

export type MetadataField = keyof PaperMetadata;
export type ClassificationDimension =
  | 'researchFields'
  | 'disciplines'
  | 'year'
  | 'journalType'
  | 'researchTopics';

export type IndexedPage = { page: number; text: string };
export type Paper = {
  id: string;
  fileName: string;
  fileSize: number;
  addedAt: string;
  updatedAt: string;
  metadata: PaperMetadata;
  manualFields: MetadataField[];
  pages: IndexedPage[];
  pageCount: number;
  indexStatus: 'pending' | 'ready' | 'empty' | 'error';
  indexError: string | null;
  aiStatus: 'idle' | 'pending' | 'ready' | 'error';
  aiError: string | null;
  favorite: boolean;
  pinned: boolean;
  readingSeconds: number;
  lastReadAt: string | null;
  lastPage: number;
  zoom: number;
  recentHidden: boolean;
  /** Missing on older papers, which remain included in the AI knowledge base. */
  knowledgeExcluded?: boolean;
  annotations: ReaderAnnotation[];
  bookmarks: Bookmark[];
  tagIds: number[];
};

export type EncryptedData = { iv: string; data: string };
export type EncryptedSecret = { salt: string; encrypted: EncryptedData };
export type StoredPaper =
  | { id: string; kind: 'plain'; paper: Paper }
  | { id: string; kind: 'encrypted'; vaultId: string; encrypted: EncryptedData };

export type LibraryFolder = {
  id: string;
  name: string;
  parentId: string | null;
  dimension: ClassificationDimension | null;
  automatic: boolean;
  createdAt: string;
};

export type FolderVault = {
  id: string;
  folderId: string;
  salt: string;
  verifier: EncryptedData;
};

export type AiProviderProfile = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** Chat model presets; older profiles use only `model`. */
  models?: string[];
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  savedKey: EncryptedSecret | null;
  /**
   * API key kept on this device without a password, when the user asks for it.
   * It persists with the library file, so it is readable by anything that can
   * read that file; `savedKey` remains the password-protected alternative.
   */
  storedKey?: string | null;
};

export type AiSettings = {
  providers: AiProviderProfile[];
  activeProviderId: string | null;
  autoEnrich: boolean;
  knowledge?: { backend: 'local' | 'milvus'; milvusUrl: string };
};

export type LibraryPreferences = {
  previewMode: 'hover' | 'pinned' | 'off';
  fieldUsage: Partial<Record<MetadataField, number>>;
};

export type LibraryReaderSession = {
  activePaperId: string | null;
  openPaperIds: string[];
};

export type AiSource = { label: string; paperId: string; title: string; page: number; excerpt: string };
export type AiRetrieval = 'local-vector' | 'milvus-vector' | 'fulltext' | 'none';
export type AiChatTurn = { role: 'user' | 'assistant'; content: string };
export type AiChatMessage = AiChatTurn & {
  id: number;
  contextKey: string;
  reasoning?: string;
  sources?: AiSource[];
  retrieval?: AiRetrieval;
  providerName?: string;
  model?: string;
  error?: string;
  streaming?: boolean;
};
export type AiAssistantSession = {
  epoch: number;
  messages: AiChatMessage[];
  draft: string;
  scope: 'all' | 'selected';
  selectedPaperIds: string[];
  fileQuery: string;
  mode: 'library' | 'direct' | null;
  initialPaperId?: string;
};
export type StoredAiAssistantSession = { paperIds: string[] } & (
  | { kind: 'plain'; session: Omit<AiAssistantSession, 'epoch'> }
  | { kind: 'encrypted'; vaultIds: string[]; encrypted: EncryptedData }
);
export type AiModelSelection = { providerId: string | null; model: string };
export type AiConversation = {
  id: string;
  createdAt: string;
  updatedAt: string;
  session: StoredAiAssistantSession | null;
  selection?: AiModelSelection;
};
export type AiConversationSummary = { id: string; title: string; updatedAt: string; locked: boolean; messageCount: number | null };
export type AiConversationHistory = { activeId: string; entries: AiConversation[] };

export type LibrarySnapshot = {
  schemaVersion: 1;
  updatedAt: string;
  papers: StoredPaper[];
  folders: LibraryFolder[];
  memberships: Record<string, string[]>;
  automaticMemberships: Record<string, string[]>;
  vaults: FolderVault[];
  preferences: LibraryPreferences;
  ai: AiSettings;
  nextDecorationId: number;
  readerSession?: LibraryReaderSession;
  aiSession?: StoredAiAssistantSession | null;
  aiConversations?: AiConversationHistory;
};

export function emptyMetadata(title = ''): PaperMetadata {
  return {
    title,
    authors: [],
    journal: '',
    year: '',
    doi: '',
    abstract: '',
    keywords: [],
    researchTopics: [],
    researchFields: [],
    disciplines: [],
    journalType: '',
    indexingStatus: '未知',
  };
}

export function emptyLibrary(): LibrarySnapshot {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    papers: [],
    folders: [],
    memberships: {},
    automaticMemberships: {},
    vaults: [],
    preferences: { previewMode: 'hover', fieldUsage: {} },
    ai: { providers: [], activeProviderId: null, autoEnrich: false },
    nextDecorationId: -1,
  };
}

export function providerModels(provider: AiProviderProfile): string[] {
  return [...new Set([...(provider.models ?? []), provider.model].map((model) => model.trim()).filter(Boolean))];
}

export function paperDocumentKey(id: string): string {
  return `paper:${id}`;
}

export function paperIdFromDocumentKey(key: string): string | null {
  return key.startsWith('paper:') ? key.slice('paper:'.length) : null;
}
