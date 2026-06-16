import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { ReaderPreferences } from '../preferences/preferencesModels';

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
  type: 'highlight' | 'note';
  color: string;
  text: string | null;
  quote: string | null;
  areas: PersistedHighlightArea[];
  createdAt: string;
  updatedAt: string;
};

export type PersistenceApi = {
  saveDocument(document: PersistedDocument): Promise<void>;
  listRecentDocuments(): Promise<PersistedDocument[]>;
  saveReaderSession(session: PersistedReaderSession): Promise<void>;
  loadReaderSession(): Promise<PersistedReaderSession | null>;
  saveBookmark(bookmark: PersistedBookmark): Promise<PersistedBookmark>;
  listBookmarks(documentKey: string): Promise<PersistedBookmark[]>;
  deleteBookmark(id: number): Promise<void>;
  saveAnnotation(annotation: PersistedAnnotation): Promise<PersistedAnnotation>;
  listAnnotations(documentKey: string): Promise<PersistedAnnotation[]>;
  deleteAnnotation(id: number): Promise<void>;
  savePreferences(preferences: ReaderPreferences): Promise<void>;
  loadPreferences(): Promise<ReaderPreferences | null>;
};

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
    deleteBookmark(id) {
      return invoke<void>('delete_bookmark', { id });
    },
    saveAnnotation(annotation) {
      return invoke<PersistedAnnotation>('save_annotation', { annotation });
    },
    listAnnotations(documentKey) {
      return invoke<PersistedAnnotation[]>('list_annotations', { documentKey });
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
  };
}
