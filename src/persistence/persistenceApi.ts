import { invoke as tauriInvoke } from '@tauri-apps/api/core';

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

export type PersistenceApi = {
  saveDocument(document: PersistedDocument): Promise<void>;
  listRecentDocuments(): Promise<PersistedDocument[]>;
};

export function createPersistenceApi(invoke: Invoke = tauriInvoke): PersistenceApi {
  return {
    saveDocument(document) {
      return invoke<void>('save_document', { document });
    },
    listRecentDocuments() {
      return invoke<PersistedDocument[]>('list_recent_documents');
    },
  };
}
