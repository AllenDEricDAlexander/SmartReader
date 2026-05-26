export type DocumentFormat = "empty" | "pdf" | "epub" | "unsupported";

export type SidebarMode = "contents" | "thumbnails" | "bookmarks" | "search" | "annotations";

export type FitMode = "continuous" | "single" | "fit-width" | "fit-page" | "actual-size";

export type ReaderTheme = "system" | "light" | "dark";

export type ReaderLocation =
  | { kind: "none" }
  | { kind: "page"; page: number }
  | {
      kind: "epub";
      cfi?: string;
      chapterHref?: string;
      chapterLabel?: string;
      progress: number;
      scrollTop?: number;
    };

export type ReaderErrorKind =
  | "unsupported-format"
  | "load-failed"
  | "missing-file"
  | "access-denied"
  | "encrypted-document"
  | "renderer-failed";

export interface ReaderError {
  kind: ReaderErrorKind;
  title: string;
  message: string;
}

export type ReaderFileSource =
  | { kind: "browser-file"; file: File; objectUrl?: string }
  | { kind: "desktop-path"; path: string };

export interface ReaderFileLike {
  kind?: ReaderFileSource["kind"];
  path?: string;
  name: string;
  size: number;
  lastModified: number;
  file?: File;
  objectUrl?: string;
}

export interface OutlineItem {
  id: string;
  title: string;
  location: ReaderLocation;
  level?: number;
}

export interface SearchResult {
  id: string;
  label: string;
  snippet: string;
  location: ReaderLocation;
  matchIndex?: number;
  matchOffset?: number;
}

export interface EpubResourceMetadata {
  id?: string;
  href: string;
  mediaType?: string;
  rewrittenUrl?: string;
}

export interface Bookmark {
  id: string;
  title: string;
  location: ReaderLocation;
  createdAt: number;
}

export type AnnotationType = "highlight" | "underline" | "strike" | "note";

export type AnnotationTag =
  | "重点"
  | "疑问"
  | "引用备注"
  | "创新点"
  | "实验数据"
  | "缺陷"
  | "个人思考";

export interface ReaderAnnotation {
  id: string;
  type: AnnotationType;
  tag: AnnotationTag;
  color: string;
  thickness: number;
  location: ReaderLocation;
  selectedText?: string;
  note?: string;
  hidden?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EpubReadingSettings {
  fontSize: number;
  theme: ReaderTheme;
}

export interface DocumentSession {
  id: string;
  title: string;
  filePath?: string;
  fileSource: ReaderFileSource | { kind: "empty" };
  source?: File;
  objectUrl?: string;
  format: DocumentFormat;
  status: "empty" | "loading" | "ready" | "error";
  error?: ReaderError;
  location: ReaderLocation;
  lastLocation: ReaderLocation;
  zoom: number;
  fitMode: FitMode;
  sidebarMode: SidebarMode;
  outline: OutlineItem[];
  searchResults: SearchResult[];
  bookmarks: Bookmark[];
  annotations: ReaderAnnotation[];
  pageCount?: number;
  epubSettings: EpubReadingSettings;
  openedAt: number;
  updatedAt: number;
}

export interface RecentFile {
  id: string;
  title: string;
  path: string;
  parentPath: string;
  format: Exclude<DocumentFormat, "empty" | "unsupported">;
  access: "browser-file" | "desktop-path";
  lastOpenedAt: number;
  resumeLabel: string;
  location: ReaderLocation;
}

export interface RendererAdapter {
  load: (session: DocumentSession) => Promise<void>;
  pageCount: () => number | undefined;
  currentLocation: () => ReaderLocation;
  goToLocation: (location: ReaderLocation) => Promise<void>;
  search: (query: string) => Promise<SearchResult[]>;
  getOutline: () => Promise<OutlineItem[]>;
  getThumbnail: (location: ReaderLocation) => Promise<string | undefined>;
  setZoom: (zoom: number) => Promise<void>;
  dispose: () => void;
}

export interface Preferences {
  reopenLastSession: boolean;
  rememberPosition: boolean;
  defaultSidebarVisible: boolean;
  defaultPdfFitMode: FitMode;
  epubFontSize: number;
  epubTheme: ReaderTheme;
  recentRetention: number;
  cacheLocation: {
    mode: "default" | "custom";
    path?: string;
  };
  search: {
    resultLimit: "unlimited";
    includePdf: boolean;
    includeEpub: boolean;
  };
  shortcuts: ShortcutBinding[];
  wasm: {
    enabled: boolean;
    parserVersion?: string;
    searchIndexVersion?: string;
  };
  pdfKit: {
    enabled: boolean;
  };
}

export interface ShortcutBinding {
  commandId: string;
  shortcut: string;
  enabled?: boolean;
  source?: "default" | "user";
}

export type SmartReaderSettings = Preferences;

export interface SmartReaderReadingProgress {
  documentId: string;
  title: string;
  path?: string;
  format: Exclude<DocumentFormat, "empty" | "unsupported">;
  location: ReaderLocation;
  updatedAt: number;
}

export interface SmartReaderSessionCache {
  activeTabId: string;
  sidebarOpen: boolean;
  tabs: PersistedDocumentSession[];
}

export interface SmartReaderSearchIndexMetadata {
  documentId: string;
  path?: string;
  format: Exclude<DocumentFormat, "empty" | "unsupported">;
  adapter: "rust" | "wasm" | "pdfjs" | "jszip";
  version: string;
  updatedAt: number;
}

export interface SmartReaderAdapterCache {
  searchIndexes: SmartReaderSearchIndexMetadata[];
}

export interface SmartReaderCacheEnvelope {
  schemaVersion: 1;
  appVersion?: string;
  savedAt: string;
  settings: SmartReaderSettings;
  recentFiles: RecentFile[];
  readingProgress: SmartReaderReadingProgress[];
  session: SmartReaderSessionCache;
  adapterCache: SmartReaderAdapterCache;
}

export type PersistedReaderFileSource = Extract<ReaderFileSource, { kind: "desktop-path" }> | { kind: "empty" };

export interface PersistedDocumentSession {
  id: string;
  title: string;
  filePath?: string;
  fileSource: PersistedReaderFileSource;
  format: DocumentFormat;
  status: DocumentSession["status"];
  error?: ReaderError;
  location: ReaderLocation;
  lastLocation: ReaderLocation;
  zoom: number;
  fitMode: FitMode;
  sidebarMode: SidebarMode;
  bookmarks: Bookmark[];
  annotations: ReaderAnnotation[];
  pageCount?: number;
  epubSettings: EpubReadingSettings;
  openedAt: number;
  updatedAt: number;
}

export interface AppSessionSnapshot {
  version: 1;
  activeTabId: string;
  sidebarOpen: boolean;
  preferences: Preferences;
  sessions: PersistedDocumentSession[];
}
