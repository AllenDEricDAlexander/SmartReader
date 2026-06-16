import type { FileSource } from '../platform/fileSource';
import type { ReadingHistory } from './readingHistory';

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
  history: ReadingHistory;
  status: DocumentStatus;
  errorMessage: string | null;
  restored: boolean;
  updatedAt: string;
};

export type DocumentState = {
  sessions: DocumentSession[];
  activeSessionId: string | null;
  sidebarOpen: boolean;
};

export type ProgressUpdate = {
  page: number;
  totalPages: number | null;
  zoom: number;
};
