import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { ReaderPreferences } from '../preferences/preferencesModels';
import type { CreateTagInput, MergeTagsInput, Tag } from '../tags/tagModels';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type PersistedDocument = {
  documentKey: string;
  path: string | null;
  displayName: string;
  fileSize: number | null;
  modifiedAt: string | null;
  pageCount: number | null;
  lastPage: number;
  progress: number;
  missing: boolean;
};

export type PersistedHistory = {
  currentPage: number;
  backStack: number[];
  forwardStack: number[];
};

export type PersistedSessionTab = {
  documentKey: string;
  tabOrder: number;
  page: number;
  zoom: number;
  history: PersistedHistory;
};

export type PersistedReaderSession = {
  activeDocumentKey: string | null;
  sidebarOpen: boolean;
  tabs: PersistedSessionTab[];
};

export type PersistedBookmark = {
  id: number | null;
  documentKey: string;
  page: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type PersistedBookmarkRecord = PersistedBookmark & {
  documentDisplayName: string | null;
  documentPath: string | null;
  documentMissing: boolean;
};

export type PersistedHighlightArea = {
  pageIndex: number;
  top: number;
  left: number;
  height: number;
  width: number;
};

export type PersistedAnnotation = {
  id: number | null;
  documentKey: string;
  page: number;
  type: 'highlight' | 'underline' | 'note';
  color: string;
  text: string | null;
  quote: string | null;
  areas: PersistedHighlightArea[];
  tagIds?: number[];
  createdAt: string;
  updatedAt: string;
};

export type PersistedAnnotationRecord = PersistedAnnotation & {
  documentDisplayName: string | null;
  documentPath: string | null;
  documentMissing: boolean;
};

export type CacheStats = {
  usedBytes: number;
  totalBytes: number;
  fileCount: number;
};

export type CorePersistenceApi = {
  saveDocument(document: PersistedDocument): Promise<void>;
  listRecentDocuments(): Promise<PersistedDocument[]>;
  saveReaderSession(session: PersistedReaderSession): Promise<void>;
  loadReaderSession(): Promise<PersistedReaderSession | null>;
  saveBookmark(bookmark: PersistedBookmark): Promise<PersistedBookmark>;
  listBookmarks(documentKey: string): Promise<PersistedBookmark[]>;
  listAllBookmarks(): Promise<PersistedBookmarkRecord[]>;
  deleteBookmark(id: number): Promise<void>;
  saveAnnotation(annotation: PersistedAnnotation): Promise<PersistedAnnotation>;
  listAnnotations(documentKey: string): Promise<PersistedAnnotation[]>;
  listAllAnnotations(): Promise<PersistedAnnotationRecord[]>;
  deleteAnnotation(id: number): Promise<void>;
  savePreferences(preferences: ReaderPreferences): Promise<void>;
  loadPreferences(): Promise<ReaderPreferences | null>;
  loadCacheStats(): Promise<CacheStats>;
};

export type FavoritesTagsPersistenceApi = {
  setDocumentFavorite(documentKey: string, favorite: boolean): Promise<void>;
  listFavoriteDocuments(): Promise<FavoriteDocument[]>;
  createTag(input: CreateTagInput): Promise<Tag>;
  renameTag(id: number, name: string): Promise<Tag>;
  deleteTag(id: number): Promise<void>;
  mergeTags(input: MergeTagsInput): Promise<Tag>;
  listTags(): Promise<Tag[]>;
  attachDocumentTag(documentKey: string, tagId: number): Promise<void>;
  detachDocumentTag(documentKey: string, tagId: number): Promise<void>;
  attachAnnotationTag(annotationId: number, tagId: number): Promise<void>;
  detachAnnotationTag(annotationId: number, tagId: number): Promise<void>;
};

export type PersistenceApi = CorePersistenceApi & FavoritesTagsPersistenceApi;

export function createPersistenceApi(invoke: Invoke = tauriInvoke): PersistenceApi {
  return {
    saveDocument(document) {
      return invoke<void>('save_document', { document });
    },
    listRecentDocuments() {
      return invoke<PersistedDocument[]>('list_recent_documents');
    },
    saveReaderSession(session) {
      return invoke<void>('save_reader_session', { session });
    },
    loadReaderSession() {
      return invoke<PersistedReaderSession | null>('load_reader_session');
    },
    saveBookmark(bookmark) {
      return invoke<PersistedBookmark>('save_bookmark', { bookmark });
    },
    listBookmarks(documentKey) {
      return invoke<PersistedBookmark[]>('list_bookmarks', { documentKey });
    },
    listAllBookmarks() {
      return invoke<PersistedBookmarkRecord[]>('list_all_bookmarks');
    },
    deleteBookmark(id) {
      return invoke<void>('delete_bookmark', { id });
    },
    saveAnnotation(annotation) {
      return invoke<PersistedAnnotation>('save_annotation', { annotation });
    },
    listAnnotations(documentKey) {
      return invoke<PersistedAnnotation[]>('list_annotations', { documentKey });
    },
    listAllAnnotations() {
      return invoke<PersistedAnnotationRecord[]>('list_all_annotations');
    },
    deleteAnnotation(id) {
      return invoke<void>('delete_annotation', { id });
    },
    savePreferences(preferences) {
      return invoke<void>('save_preferences', { preferences });
    },
    loadPreferences() {
      return invoke<ReaderPreferences | null>('load_preferences');
    },
    loadCacheStats() {
      return invoke<CacheStats>('load_cache_stats');
    },
    setDocumentFavorite(documentKey, favorite) {
      return invoke<void>('set_document_favorite', { documentKey, favorite });
    },
    listFavoriteDocuments() {
      return invoke<FavoriteDocument[]>('list_favorite_documents');
    },
    createTag(input) {
      return invoke<Tag>('create_tag', { input });
    },
    renameTag(id, name) {
      return invoke<Tag>('rename_tag', { id, name });
    },
    deleteTag(id) {
      return invoke<void>('delete_tag', { id });
    },
    mergeTags(input) {
      return invoke<Tag>('merge_tags', { input });
    },
    listTags() {
      return invoke<Tag[]>('list_tags');
    },
    attachDocumentTag(documentKey, tagId) {
      return invoke<void>('attach_document_tag', { documentKey, tagId });
    },
    detachDocumentTag(documentKey, tagId) {
      return invoke<void>('detach_document_tag', { documentKey, tagId });
    },
    attachAnnotationTag(annotationId, tagId) {
      return invoke<void>('attach_annotation_tag', { annotationId, tagId });
    },
    detachAnnotationTag(annotationId, tagId) {
      return invoke<void>('detach_annotation_tag', { annotationId, tagId });
    },
  };
}
