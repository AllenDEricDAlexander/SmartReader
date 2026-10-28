import type { FavoriteDocument } from '../../favorites/favoriteModels';
import { getDirectoryPath } from '../../home/homeDisplayUtils';
import type { Paper } from '../../library/libraryModels';
import { paperToPersistedDocument } from '../../library/libraryPersistence';
import type { PersistedDocument } from '../../persistence/persistenceApi';
import type { BookListItem } from './BookList';

export type BookSourceFilter = 'all' | 'paper' | 'desktop' | 'browser';

export function matchesBookSource(document: Pick<PersistedDocument, 'documentKey' | 'path'>, filter: BookSourceFilter): boolean {
  if (filter === 'all') return true;
  if (document.documentKey.startsWith('paper:')) return filter === 'paper';
  if (document.documentKey.startsWith('desktop:') || document.path) return filter === 'desktop';
  return filter === 'browser';
}

export function documentBookItem<T extends PersistedDocument | FavoriteDocument>(document: T, paper?: Paper): BookListItem<T> {
  return {
    key: document.documentKey, name: document.displayName, source: document,
    authors: paper?.metadata.authors, journal: paper?.metadata.journal,
    path: document.path, pathLabel: document.path ?? getDirectoryPath(document.path, document.documentKey),
    lastOpenedAt: document.lastOpenedAt, modifiedAt: 'modifiedAt' in document ? document.modifiedAt : null,
    modifiedLabel: document.documentKey.startsWith('paper:') ? '记录更新' : '文件修改',
    progress: paper && !paper.pageCount ? null : document.progress, lastPage: document.lastPage, pageCount: document.pageCount,
    favorite: paper?.favorite, pinned: paper?.pinned, missing: document.missing,
  };
}

export function paperBookItem(paper: Paper): BookListItem<Paper> {
  const document = paperToPersistedDocument(paper);
  return {
    ...documentBookItem(document, paper), source: paper,
    name: paper.metadata.title || paper.fileName,
    subtitle: paper.metadata.title && paper.metadata.title !== paper.fileName ? paper.fileName : null,
  };
}
