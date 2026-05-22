export type DocumentFormat = "empty" | "pdf" | "epub" | "unsupported";

export type SidebarMode = "contents" | "thumbnails" | "bookmarks" | "search";

export type FitMode = "continuous" | "single" | "fit-width" | "fit-page" | "actual-size";

export type ReaderTheme = "system" | "light" | "dark";

export type ReaderLocation =
  | { kind: "none" }
  | { kind: "page"; page: number }
  | { kind: "epub"; cfi?: string; chapterHref?: string; chapterLabel?: string; progress: number };

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
}

export interface Bookmark {
  id: string;
  title: string;
  location: ReaderLocation;
  createdAt: number;
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
}
