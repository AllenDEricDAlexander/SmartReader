import type {
  AnnotationTag,
  AnnotationType,
  EpubTextAnchor,
  RecentFile,
  ReaderAnnotation,
  SmartReaderAdapterCache,
  SmartReaderCacheEnvelope,
  PersistedDocumentSession,
  SmartReaderReadingProgress,
  SmartReaderSearchIndexMetadata,
  SmartReaderSessionCache,
  SmartReaderSettings
} from "../types/reader";

export const smartReaderCacheKey = "smartreader.cache.v1";

const emptyAdapterCache: SmartReaderAdapterCache = {
  searchIndexes: []
};

export function createSmartReaderCacheEnvelope(input: {
  settings: SmartReaderSettings;
  recentFiles?: RecentFile[];
  readingProgress?: SmartReaderReadingProgress[];
  session: SmartReaderSessionCache;
  adapterCache?: SmartReaderAdapterCache;
  savedAt?: string;
  appVersion?: string;
}): SmartReaderCacheEnvelope {
  return sanitizeEnvelope({
    schemaVersion: 1,
    appVersion: input.appVersion,
    savedAt: input.savedAt ?? new Date().toISOString(),
    settings: input.settings,
    recentFiles: input.recentFiles ?? [],
    readingProgress: input.readingProgress ?? [],
    session: input.session,
    adapterCache: input.adapterCache ?? emptyAdapterCache
  });
}

export function validateSmartReaderCacheEnvelope(
  value: unknown
): SmartReaderCacheEnvelope | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return undefined;
  }

  if (!isSettings(value.settings) || !Array.isArray(value.recentFiles)) {
    return undefined;
  }

  if (!Array.isArray(value.readingProgress)) {
    return undefined;
  }

  if (!isSessionCache(value.session)) {
    return undefined;
  }

  if (value.adapterCache !== undefined && !isAdapterCache(value.adapterCache)) {
    return undefined;
  }

  try {
    return sanitizeEnvelope({
      schemaVersion: 1,
      appVersion: typeof value.appVersion === "string" ? value.appVersion : undefined,
      savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString(),
      settings: value.settings,
      recentFiles: value.recentFiles as RecentFile[],
      readingProgress: value.readingProgress as SmartReaderReadingProgress[],
      session: value.session,
      adapterCache: value.adapterCache ?? emptyAdapterCache
    });
  } catch {
    return undefined;
  }
}

export function exportSmartReaderCache(envelope: SmartReaderCacheEnvelope): string {
  return JSON.stringify(sanitizeEnvelope(envelope));
}

export function importSmartReaderCache(raw: string): SmartReaderCacheEnvelope | undefined {
  try {
    return validateSmartReaderCacheEnvelope(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function mergeSmartReaderCache(
  current: SmartReaderCacheEnvelope,
  incoming: SmartReaderCacheEnvelope
): SmartReaderCacheEnvelope {
  return createSmartReaderCacheEnvelope({
    settings: {
      ...current.settings,
      ...incoming.settings
    },
    recentFiles: mergeByKey(
      current.recentFiles,
      incoming.recentFiles,
      (item) => item.path,
      (left, right) => left.lastOpenedAt >= right.lastOpenedAt
    ),
    readingProgress: mergeByKey(
      current.readingProgress,
      incoming.readingProgress,
      (item) => item.documentId,
      (left, right) => left.updatedAt >= right.updatedAt
    ),
    session: incoming.session,
    adapterCache: {
      searchIndexes: mergeByKey(
        current.adapterCache.searchIndexes,
        incoming.adapterCache.searchIndexes,
        (item) => `${item.adapter}:${item.documentId}`,
        (left, right) => left.updatedAt >= right.updatedAt
      )
    },
    savedAt: incoming.savedAt > current.savedAt ? incoming.savedAt : current.savedAt,
    appVersion: incoming.appVersion ?? current.appVersion
  });
}

export function readSmartReaderCache(storage: Storage = localStorage): SmartReaderCacheEnvelope | undefined {
  try {
    const raw = storage.getItem(smartReaderCacheKey);

    return raw ? importSmartReaderCache(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function writeSmartReaderCache(
  envelope: SmartReaderCacheEnvelope,
  storage: Storage = localStorage
): void {
  storage.setItem(smartReaderCacheKey, exportSmartReaderCache(envelope));
}

function sanitizeEnvelope(envelope: SmartReaderCacheEnvelope): SmartReaderCacheEnvelope {
  const settings = sanitizeSettings(envelope.settings);
  const recentFiles = sanitizeArray(envelope.recentFiles, sanitizeRecentFile);
  const readingProgress = sanitizeArray(envelope.readingProgress, sanitizeReadingProgress);
  const session = sanitizeSessionCache(envelope.session);
  const adapterCache = sanitizeAdapterCache(envelope.adapterCache);

  if (!settings || !recentFiles || !readingProgress || !session || !adapterCache) {
    throw new Error("Invalid SmartReader cache envelope.");
  }

  return {
    schemaVersion: 1,
    appVersion: envelope.appVersion,
    savedAt: envelope.savedAt,
    settings,
    recentFiles,
    readingProgress,
    session,
    adapterCache
  };
}

function sanitizeSettings(settings: SmartReaderSettings): SmartReaderSettings | undefined {
  const shortcuts = sanitizeArray(settings.shortcuts, sanitizeShortcutBinding);

  if (!isSettings(settings) || !shortcuts) {
    return undefined;
  }

  return {
    reopenLastSession: settings.reopenLastSession,
    rememberPosition: settings.rememberPosition,
    defaultSidebarVisible: settings.defaultSidebarVisible,
    defaultPdfFitMode: settings.defaultPdfFitMode,
    epubFontSize: settings.epubFontSize,
    epubTheme: settings.epubTheme,
    recentRetention: settings.recentRetention,
    cacheLocation: {
      mode: settings.cacheLocation.mode,
      path: settings.cacheLocation.mode === "custom" ? settings.cacheLocation.path : undefined
    },
    search: {
      resultLimit: "unlimited",
      includePdf: settings.search.includePdf,
      includeEpub: settings.search.includeEpub
    },
    shortcuts,
    wasm: {
      enabled: settings.wasm.enabled,
      parserVersion: settings.wasm.parserVersion,
      searchIndexVersion: settings.wasm.searchIndexVersion
    },
    pdfKit: {
      enabled: settings.pdfKit?.enabled ?? false
    }
  };
}

function sanitizeShortcutBinding(binding: unknown): SmartReaderSettings["shortcuts"][number] | undefined {
  if (!isRecord(binding) || typeof binding.commandId !== "string" || typeof binding.shortcut !== "string") {
    return undefined;
  }

  return {
    commandId: binding.commandId,
    shortcut: binding.shortcut,
    enabled: typeof binding.enabled === "boolean" ? binding.enabled : undefined,
    source: binding.source === "default" || binding.source === "user" ? binding.source : undefined
  };
}

function sanitizeRecentFile(file: unknown): RecentFile | undefined {
  if (!isRecord(file)) {
    return undefined;
  }

  const location = sanitizeReaderLocation(file.location);

  if (
    typeof file.id !== "string" ||
    typeof file.title !== "string" ||
    typeof file.path !== "string" ||
    typeof file.parentPath !== "string" ||
    !isReadableFormat(file.format) ||
    (file.access !== "browser-file" && file.access !== "desktop-path") ||
    typeof file.lastOpenedAt !== "number" ||
    typeof file.resumeLabel !== "string" ||
    !location
  ) {
    return undefined;
  }

  return {
    id: file.id,
    title: file.title,
    path: file.path,
    parentPath: file.parentPath,
    format: file.format,
    access: file.access,
    lastOpenedAt: file.lastOpenedAt,
    resumeLabel: file.resumeLabel,
    location
  };
}

function sanitizeReadingProgress(progress: unknown): SmartReaderReadingProgress | undefined {
  if (!isRecord(progress)) {
    return undefined;
  }

  const location = sanitizeReaderLocation(progress.location);

  if (
    typeof progress.documentId !== "string" ||
    typeof progress.title !== "string" ||
    !isReadableFormat(progress.format) ||
    typeof progress.updatedAt !== "number" ||
    !location
  ) {
    return undefined;
  }

  return {
    documentId: progress.documentId,
    title: progress.title,
    path: typeof progress.path === "string" ? progress.path : undefined,
    format: progress.format,
    location,
    updatedAt: progress.updatedAt
  };
}

function sanitizeSessionCache(session: SmartReaderSessionCache): SmartReaderSessionCache | undefined {
  const tabs = sanitizeArray(session.tabs, sanitizePersistedDocumentSession);

  if (!isSessionCache(session) || !tabs) {
    return undefined;
  }

  return {
    activeTabId: session.activeTabId,
    sidebarOpen: session.sidebarOpen,
    tabs
  };
}

function sanitizePersistedDocumentSession(tab: unknown): PersistedDocumentSession | undefined {
  if (!isRecord(tab)) {
    return undefined;
  }

  const fileSource = sanitizePersistedFileSource(tab.fileSource);
  const error = sanitizeReaderError(tab.error);
  const bookmarks = sanitizeArray(Array.isArray(tab.bookmarks) ? tab.bookmarks : [], sanitizeBookmark);
  const annotations = sanitizeArray(Array.isArray(tab.annotations) ? tab.annotations : [], sanitizeAnnotation);
  const pendingDeletedAnnotations = sanitizeArray(
    Array.isArray(tab.pendingDeletedAnnotations) ? tab.pendingDeletedAnnotations : [],
    sanitizeAnnotation
  );
  const nativePdfAnnotations = sanitizeNativePdfAnnotationSnapshot(tab.nativePdfAnnotations);
  const epubSettings = sanitizeEpubSettings(tab.epubSettings);
  const location = sanitizeReaderLocation(tab.location);
  const lastLocation = sanitizeReaderLocation(tab.lastLocation);

  if (
    typeof tab.id !== "string" ||
    typeof tab.title !== "string" ||
    !fileSource ||
    !isDocumentFormat(tab.format) ||
    (tab.status !== "empty" && tab.status !== "loading" && tab.status !== "ready" && tab.status !== "error") ||
    !location ||
    !lastLocation ||
    typeof tab.zoom !== "number" ||
    !isFitMode(tab.fitMode) ||
    !isSidebarMode(tab.sidebarMode) ||
    !bookmarks ||
    !annotations ||
    !pendingDeletedAnnotations ||
    !epubSettings ||
    typeof tab.openedAt !== "number" ||
    typeof tab.updatedAt !== "number"
  ) {
    return undefined;
  }

  return {
    id: tab.id,
    title: tab.title,
    filePath: typeof tab.filePath === "string" ? tab.filePath : undefined,
    fileSource,
    format: tab.format,
    status: tab.status,
    error,
    location,
    lastLocation,
    zoom: tab.zoom,
    fitMode: tab.fitMode,
    sidebarMode: tab.sidebarMode,
    bookmarks,
    annotations,
    pendingDeletedAnnotations: pendingDeletedAnnotations.length > 0 ? pendingDeletedAnnotations : undefined,
    nativePdfAnnotations,
    pageCount: typeof tab.pageCount === "number" ? tab.pageCount : undefined,
    epubSettings,
    openedAt: tab.openedAt,
    updatedAt: tab.updatedAt
  };
}

function sanitizeSearchIndexMetadata(
  item: unknown
): SmartReaderSearchIndexMetadata | undefined {
  if (!isRecord(item)) {
    return undefined;
  }

  if (
    typeof item.documentId !== "string" ||
    !isReadableFormat(item.format) ||
    (item.adapter !== "rust" && item.adapter !== "wasm" && item.adapter !== "jszip") ||
    typeof item.version !== "string" ||
    typeof item.updatedAt !== "number"
  ) {
    return undefined;
  }

  return {
    documentId: item.documentId,
    path: typeof item.path === "string" ? item.path : undefined,
    format: item.format,
    adapter: item.adapter,
    version: item.version,
    updatedAt: item.updatedAt
  };
}

function sanitizeAdapterCache(adapterCache: SmartReaderAdapterCache): SmartReaderAdapterCache | undefined {
  const searchIndexes = sanitizeArray(adapterCache.searchIndexes, sanitizeSearchIndexMetadata);

  if (!isAdapterCache(adapterCache) || !searchIndexes) {
    return undefined;
  }

  return { searchIndexes };
}

function sanitizePersistedFileSource(value: unknown): PersistedDocumentSession["fileSource"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.kind === "empty") {
    return { kind: "empty" };
  }

  if (value.kind === "desktop-path" && typeof value.path === "string") {
    return { kind: "desktop-path", path: value.path };
  }

  return undefined;
}

function sanitizeReaderError(value: unknown): PersistedDocumentSession["error"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    isRecord(value) &&
    isReaderErrorKind(value.kind) &&
    typeof value.title === "string" &&
    typeof value.message === "string"
  ) {
    return {
      kind: value.kind as NonNullable<PersistedDocumentSession["error"]>["kind"],
      title: value.title,
      message: value.message
    };
  }

  return undefined;
}

function sanitizeBookmark(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  const location = sanitizeReaderLocation(value.location);

  if (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    location &&
    typeof value.createdAt === "number"
  ) {
    return {
      id: value.id,
      title: value.title,
      location,
      createdAt: value.createdAt
    };
  }

  return undefined;
}

function sanitizeAnnotation(value: unknown): ReaderAnnotation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const location = sanitizeReaderLocation(value.location);

  if (
    typeof value.id === "string" &&
    isAnnotationType(value.type) &&
    isAnnotationTag(value.tag) &&
    isAnnotationColor(value.color) &&
    isAnnotationThickness(value.thickness) &&
    location &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  ) {
    return {
      id: value.id,
      name: typeof value.name === "string" ? value.name : undefined,
      type: value.type,
      tag: value.tag,
      color: value.color,
      thickness: value.thickness,
      location,
      selectedText: typeof value.selectedText === "string" ? value.selectedText : undefined,
      area: sanitizeAnnotationArea(value.area),
      rects: sanitizeAnnotationRects(value.rects),
      note: typeof value.note === "string" ? value.note : undefined,
      noteFontFamily: typeof value.noteFontFamily === "string" ? value.noteFontFamily : undefined,
      noteFontSize: typeof value.noteFontSize === "number" ? value.noteFontSize : undefined,
      nativeEpub: sanitizeNativeEpubAnnotation(value.nativeEpub),
      nativePdfKit: sanitizeNativePdfKitAnnotation(value.nativePdfKit),
      hidden: typeof value.hidden === "boolean" ? value.hidden : undefined,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt
    };
  }

  return undefined;
}

function sanitizeNativeEpubAnnotation(value: unknown): ReaderAnnotation["nativeEpub"] | undefined {
  if (!isRecord(value) || typeof value.status !== "string") {
    return undefined;
  }

  return {
    supported: typeof value.supported === "boolean" ? value.supported : undefined,
    status: value.status,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    lastError: typeof value.lastError === "string" ? value.lastError : undefined,
    failedAt: typeof value.failedAt === "number" ? value.failedAt : undefined,
    syncedAt: typeof value.syncedAt === "number" ? value.syncedAt : undefined
  };
}

function sanitizeNativePdfKitAnnotation(value: unknown): ReaderAnnotation["nativePdfKit"] | undefined {
  if (!isRecord(value) || typeof value.status !== "string") {
    return undefined;
  }

  return {
    supported: typeof value.supported === "boolean" ? value.supported : undefined,
    status: value.status,
    annotationId: typeof value.annotationId === "string" ? value.annotationId : undefined,
    nativeId: typeof value.nativeId === "string" ? value.nativeId : undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    dirty: typeof value.dirty === "boolean" ? value.dirty : undefined,
    pendingOperation: isPdfKitPendingOperation(value.pendingOperation) ? value.pendingOperation : undefined,
    lastSyncError: typeof value.lastSyncError === "string" ? value.lastSyncError : undefined,
    failedAt: typeof value.failedAt === "number" ? value.failedAt : undefined,
    syncedAt: typeof value.syncedAt === "number" ? value.syncedAt : undefined
  };
}

function isPdfKitPendingOperation(value: unknown): value is NonNullable<ReaderAnnotation["nativePdfKit"]>["pendingOperation"] {
  return value === "upsert" || value === "delete";
}

function sanitizeNativePdfAnnotationSnapshot(value: unknown): PersistedDocumentSession["nativePdfAnnotations"] | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.annotations)) {
    return undefined;
  }

  const annotations = sanitizeJsonArray(value.annotations);
  if (!annotations) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    annotations,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now()
  };
}

function sanitizeJsonArray(value: unknown[]): unknown[] | undefined {
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;

    return Array.isArray(cloned) ? cloned : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeAnnotationArea(value: unknown): ReaderAnnotation["area"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.page === "number" &&
    typeof value.left === "number" &&
    typeof value.top === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number"
  ) {
    const area: ReaderAnnotation["area"] = {
      page: value.page,
      left: value.left,
      top: value.top,
      width: value.width,
      height: value.height
    };

    if (isPositiveFiniteNumber(value.viewportHeight)) {
      area.viewportHeight = value.viewportHeight;
    }

    if (isPositiveFiniteNumber(value.viewportScale)) {
      area.viewportScale = value.viewportScale;
    }

    return area;
  }

  return undefined;
}

function sanitizeAnnotationRects(value: unknown): ReaderAnnotation["rects"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const rects = sanitizeArray(value, sanitizeAnnotationArea);
  return rects && rects.length > 0 ? rects : undefined;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sanitizeEpubSettings(value: unknown) {
  if (
    isRecord(value) &&
    typeof value.fontSize === "number" &&
    (value.theme === "system" || value.theme === "light" || value.theme === "dark")
  ) {
    return {
      fontSize: value.fontSize,
      theme: value.theme as "system" | "light" | "dark"
    };
  }

  return undefined;
}

function isSessionCache(value: unknown): value is SmartReaderSessionCache {
  return isRecord(value) && typeof value.activeTabId === "string" && Array.isArray(value.tabs);
}

function isAdapterCache(value: unknown): value is SmartReaderAdapterCache {
  return isRecord(value) && Array.isArray(value.searchIndexes);
}

function isSettings(value: unknown): value is SmartReaderSettings {
  return (
    isRecord(value) &&
    typeof value.reopenLastSession === "boolean" &&
    typeof value.rememberPosition === "boolean" &&
    typeof value.defaultSidebarVisible === "boolean" &&
    isFitMode(value.defaultPdfFitMode) &&
    typeof value.epubFontSize === "number" &&
    (value.epubTheme === "system" || value.epubTheme === "light" || value.epubTheme === "dark") &&
    typeof value.recentRetention === "number" &&
    isRecord(value.cacheLocation) &&
    (value.cacheLocation.mode === "default" ||
      (value.cacheLocation.mode === "custom" && typeof value.cacheLocation.path === "string")) &&
    isRecord(value.search) &&
    value.search.resultLimit === "unlimited" &&
    typeof value.search.includePdf === "boolean" &&
    typeof value.search.includeEpub === "boolean" &&
    Array.isArray(value.shortcuts) &&
    isRecord(value.wasm) &&
    typeof value.wasm.enabled === "boolean" &&
    (value.wasm.parserVersion === undefined || typeof value.wasm.parserVersion === "string") &&
    (value.wasm.searchIndexVersion === undefined || typeof value.wasm.searchIndexVersion === "string") &&
    (value.pdfKit === undefined || (isRecord(value.pdfKit) && typeof value.pdfKit.enabled === "boolean"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDocumentFormat(value: unknown) {
  return value === "empty" || value === "pdf" || value === "epub" || value === "unsupported";
}

function isReadableFormat(value: unknown): value is "pdf" | "epub" {
  return value === "pdf" || value === "epub";
}

function isFitMode(value: unknown) {
  return (
    value === "continuous" ||
    value === "single" ||
    value === "fit-width" ||
    value === "fit-page" ||
    value === "actual-size"
  );
}

function isSidebarMode(value: unknown) {
  return (
    value === "contents" ||
    value === "thumbnails" ||
    value === "bookmarks" ||
    value === "search" ||
    value === "annotations"
  );
}

function isAnnotationType(value: unknown): value is AnnotationType {
  return (
    value === "highlight" ||
    value === "underline" ||
    value === "strike" ||
    value === "wavy" ||
    value === "red-text" ||
    value === "note" ||
    value === "area"
  );
}

function isAnnotationTag(value: unknown): value is AnnotationTag {
  return (
    value === "重点" ||
    value === "疑问" ||
    value === "引用备注" ||
    value === "创新点" ||
    value === "实验数据" ||
    value === "缺陷" ||
    value === "个人思考"
  );
}

function isAnnotationColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isAnnotationThickness(value: unknown): value is number {
  return typeof value === "number" && [1, 2, 3, 4].includes(value);
}

function isReaderLocation(value: unknown): value is PersistedDocumentSession["location"] {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind === "none") {
    return true;
  }

  if (value.kind === "page") {
    return typeof value.page === "number";
  }

  if (value.kind === "epub") {
    return (
      typeof value.progress === "number" &&
      (value.cfi === undefined || typeof value.cfi === "string") &&
      (value.anchor === undefined || isEpubTextAnchor(value.anchor)) &&
      (value.anchorOccurrenceIndex === undefined || typeof value.anchorOccurrenceIndex === "number") &&
      (value.chapterHref === undefined || typeof value.chapterHref === "string") &&
      (value.chapterLabel === undefined || typeof value.chapterLabel === "string") &&
      (value.scrollTop === undefined || typeof value.scrollTop === "number")
    );
  }

  return false;
}

function sanitizeReaderLocation(value: unknown): PersistedDocumentSession["location"] | undefined {
  if (!isReaderLocation(value)) {
    return undefined;
  }

  if (value.kind === "none") {
    return { kind: "none" };
  }

  if (value.kind === "page") {
    return { kind: "page", page: value.page };
  }

  return {
    kind: "epub",
    cfi: value.cfi,
    anchor: sanitizeEpubTextAnchor(value.anchor),
    anchorOccurrenceIndex: value.anchorOccurrenceIndex,
    chapterHref: value.chapterHref,
    chapterLabel: value.chapterLabel,
    progress: value.progress,
    scrollTop: value.scrollTop
  };
}

function isEpubTextAnchor(value: unknown): value is EpubTextAnchor {
  return (
    isRecord(value) &&
    typeof value.chapterHref === "string" &&
    typeof value.selectedText === "string" &&
    typeof value.occurrenceIndex === "number" &&
    typeof value.startOffset === "number" &&
    typeof value.endOffset === "number" &&
    typeof value.prefix === "string" &&
    typeof value.suffix === "string" &&
    typeof value.textHash === "string" &&
    typeof value.anchorHash === "string" &&
    (value.cfiHint === undefined || typeof value.cfiHint === "string")
  );
}

function sanitizeEpubTextAnchor(value: unknown): EpubTextAnchor | undefined {
  if (!isEpubTextAnchor(value)) {
    return undefined;
  }

  return {
    chapterHref: value.chapterHref,
    selectedText: value.selectedText,
    occurrenceIndex: value.occurrenceIndex,
    startOffset: value.startOffset,
    endOffset: value.endOffset,
    prefix: value.prefix,
    suffix: value.suffix,
    textHash: value.textHash,
    anchorHash: value.anchorHash,
    cfiHint: value.cfiHint
  };
}

function isReaderErrorKind(value: unknown) {
  return (
    value === "unsupported-format" ||
    value === "load-failed" ||
    value === "missing-file" ||
    value === "access-denied" ||
    value === "encrypted-document" ||
    value === "renderer-failed"
  );
}

function sanitizeArray<T>(values: unknown[], sanitizer: (value: unknown) => T | undefined): T[] | undefined {
  const sanitized = values.map(sanitizer);

  return sanitized.every((value): value is T => value !== undefined) ? sanitized : undefined;
}

function mergeByKey<T>(
  current: T[],
  incoming: T[],
  keyFor: (item: T) => string,
  keepCurrent: (current: T, incoming: T) => boolean
): T[] {
  const merged = new Map<string, T>();

  current.forEach((item) => merged.set(keyFor(item), item));
  incoming.forEach((item) => {
    const key = keyFor(item);
    const existing = merged.get(key);

    if (!existing || !keepCurrent(existing, item)) {
      merged.set(key, item);
    }
  });

  return Array.from(merged.values());
}
