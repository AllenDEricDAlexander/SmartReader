import type {
  PersistedAnnotationRecord,
  PersistedBookmarkRecord,
  PersistedDocument,
} from '../persistence/persistenceApi';
import type { FavoriteDocument } from '../favorites/favoriteModels';

export type GlobalSearchSource = 'file' | 'bookmark' | 'annotation' | 'fullText';

export type GlobalSearchActiveSession = {
  documentKey: string;
  title: string;
};

export type GlobalSearchResult = {
  id: string;
  source: GlobalSearchSource;
  title: string;
  subtitle: string;
  actionLabel: string;
  documentKey: string | null;
  path: string | null;
  page: number | null;
  query?: string;
  missing?: boolean;
};

type BuildGlobalSearchResultsInput = {
  query: string;
  recentDocuments: PersistedDocument[];
  favoriteDocuments: FavoriteDocument[];
  bookmarks: PersistedBookmarkRecord[];
  annotations: PersistedAnnotationRecord[];
  activeSession: GlobalSearchActiveSession | null;
};

type SearchableDocument = {
  documentKey: string;
  displayName: string;
  path: string | null;
  lastPage: number;
  progress: number;
  missing: boolean;
};

const maxResultsPerSource = 8;

export function buildGlobalSearchResults({
  query,
  recentDocuments,
  favoriteDocuments,
  bookmarks,
  annotations,
  activeSession,
}: BuildGlobalSearchResultsInput): GlobalSearchResult[] {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  return [
    ...buildFileResults(normalizedQuery, recentDocuments, favoriteDocuments),
    ...buildBookmarkResults(normalizedQuery, bookmarks),
    ...buildAnnotationResults(normalizedQuery, annotations),
    ...buildFullTextResult(normalizedQuery, activeSession),
  ];
}

function buildFileResults(
  normalizedQuery: string,
  recentDocuments: PersistedDocument[],
  favoriteDocuments: FavoriteDocument[],
): GlobalSearchResult[] {
  const documents = new Map<string, SearchableDocument>();

  for (const document of recentDocuments) {
    documents.set(document.documentKey, {
      documentKey: document.documentKey,
      displayName: document.displayName,
      path: document.path,
      lastPage: document.lastPage,
      progress: document.progress,
      missing: document.missing,
    });
  }

  for (const document of favoriteDocuments) {
    if (!documents.has(document.documentKey)) {
      documents.set(document.documentKey, {
        documentKey: document.documentKey,
        displayName: document.displayName,
        path: document.path,
        lastPage: document.lastPage,
        progress: document.progress,
        missing: false,
      });
    }
  }

  return [...documents.values()]
    .filter((document) =>
      matchesAny(normalizedQuery, [document.displayName, document.path ?? '']),
    )
    .slice(0, maxResultsPerSource)
    .map((document) => ({
      id: `file:${document.documentKey}`,
      source: 'file',
      title: document.displayName,
      subtitle: document.path ?? '浏览器选择的本地文件',
      actionLabel: document.missing ? '文件缺失' : '打开文件',
      documentKey: document.documentKey,
      path: document.path,
      page: document.lastPage,
      missing: document.missing,
    }));
}

function buildBookmarkResults(
  normalizedQuery: string,
  bookmarks: PersistedBookmarkRecord[],
): GlobalSearchResult[] {
  return bookmarks
    .filter((bookmark) =>
      matchesAny(normalizedQuery, [
        bookmark.title,
        bookmark.note ?? '',
        bookmark.documentDisplayName ?? '',
        bookmark.documentPath ?? '',
      ]),
    )
    .slice(0, maxResultsPerSource)
    .map((bookmark) => ({
      id: `bookmark:${bookmark.id ?? `${bookmark.documentKey}:${bookmark.page}:${bookmark.title}`}`,
      source: 'bookmark',
      title: bookmark.title,
      subtitle: `${bookmark.documentDisplayName ?? bookmark.documentKey} · 第 ${bookmark.page} 页`,
      actionLabel: bookmark.documentMissing ? '文件缺失' : '跳转书签',
      documentKey: bookmark.documentKey,
      path: bookmark.documentPath,
      page: bookmark.page,
      missing: bookmark.documentMissing,
    }));
}

function buildAnnotationResults(
  normalizedQuery: string,
  annotations: PersistedAnnotationRecord[],
): GlobalSearchResult[] {
  return annotations
    .filter((annotation) =>
      matchesAny(normalizedQuery, [
        annotation.text ?? '',
        annotation.quote ?? '',
        annotation.documentDisplayName ?? '',
        annotation.documentPath ?? '',
      ]),
    )
    .slice(0, maxResultsPerSource)
    .map((annotation) => ({
      id: `annotation:${annotation.id ?? `${annotation.documentKey}:${annotation.page}`}`,
      source: 'annotation',
      title: annotation.text || annotation.quote || '未命名批注',
      subtitle: `${annotation.documentDisplayName ?? annotation.documentKey} · 第 ${annotation.page} 页`,
      actionLabel: annotation.documentMissing ? '文件缺失' : '跳转批注',
      documentKey: annotation.documentKey,
      path: annotation.documentPath,
      page: annotation.page,
      missing: annotation.documentMissing,
    }));
}

function buildFullTextResult(
  normalizedQuery: string,
  activeSession: GlobalSearchActiveSession | null,
): GlobalSearchResult[] {
  if (!activeSession) {
    return [];
  }

  return [
    {
      id: `fullText:${activeSession.documentKey}:${normalizedQuery}`,
      source: 'fullText',
      title: `在当前文档中搜索 "${normalizedQuery}"`,
      subtitle: activeSession.title,
      actionLabel: '搜索全文',
      documentKey: activeSession.documentKey,
      path: null,
      page: null,
      query: normalizedQuery,
    },
  ];
}

function matchesAny(normalizedQuery: string, values: string[]): boolean {
  return values.some((value) => normalizeQuery(value).includes(normalizedQuery));
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}
