import type { FileSource } from '../platform/fileSource';

export type DocumentStatus = 'loading' | 'ready' | 'error';

export type DocumentSession = {
  id: string;
  documentKey: string;
  title: string;
  source: FileSource;
  page: number;
  totalPages: number | null;
  progress: number;
  zoom: number;
  status: DocumentStatus;
  errorMessage: string | null;
  updatedAt: string;
};

export type DocumentState = {
  sessions: DocumentSession[];
  activeSessionId: string | null;
};

export type ProgressUpdate = {
  page: number;
  totalPages: number | null;
  zoom: number;
};
