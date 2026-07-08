import { describe, expect, it } from 'vitest';
import type { DocumentSession } from '../documents/documentModels';
import type { PersistedDocument, PersistedSessionTab } from '../persistence/persistenceApi';
import {
  countRestorablePersistedTabs,
  mapSessionToPersistedDocument,
  mapSessionsToPersistedTabs,
  mergeRecentDocuments,
  upsertRecentDocument,
} from './readerAppMappers';

function createDesktopSession(overrides: Partial<DocumentSession> = {}): DocumentSession {
  return {
    id: 'session-a',
    documentKey: 'desktop:/tmp/book.pdf',
    title: 'book.pdf',
    source: {
      kind: 'desktop-path',
      path: '/tmp/book.pdf',
      name: 'book.pdf',
    },
    page: 3,
    totalPages: 10,
    progress: 30,
    zoom: 1.2,
    status: 'ready',
    errorMessage: null,
    restored: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
    history: {
      currentPage: 3,
      backStack: [1, 2],
      forwardStack: [4],
    },
    ...overrides,
  };
}

describe('reader app mappers', () => {
  it('maps a session to a persisted document using source metadata first', () => {
    const previous: PersistedDocument = {
      documentKey: 'desktop:/tmp/book.pdf',
      path: '/old/book.pdf',
      displayName: 'Old Book',
      fileSize: 50,
      modifiedAt: '2026-06-01T00:00:00.000Z',
      pageCount: 8,
      lastPage: 1,
      progress: 12,
      missing: true,
      lastOpenedAt: '2026-07-08T08:00:00.000Z',
      tagIds: [1, 2],
    };

    expect(mapSessionToPersistedDocument(createDesktopSession(), previous)).toEqual({
      documentKey: 'desktop:/tmp/book.pdf',
      path: '/tmp/book.pdf',
      displayName: 'book.pdf',
      fileSize: 50,
      modifiedAt: '2026-06-01T00:00:00.000Z',
      pageCount: 10,
      lastPage: 3,
      progress: 30,
      missing: false,
      lastOpenedAt: '2026-07-08T08:00:00.000Z',
      tagIds: [1, 2],
    });
  });

  it('preserves existing document ordering when upserting and merges restored records', () => {
    const first: PersistedDocument = {
      documentKey: 'a',
      path: '/a.pdf',
      displayName: 'A',
      fileSize: null,
      modifiedAt: null,
      pageCount: null,
      lastPage: 1,
      progress: 0,
      missing: false,
      lastOpenedAt: '2026-07-08T08:00:00.000Z',
      tagIds: [],
    };
    const second = { ...first, documentKey: 'b', path: '/b.pdf', displayName: 'B' };
    const updatedFirst = { ...first, displayName: 'A updated', progress: 50 };

    expect(upsertRecentDocument([first, second], updatedFirst)).toEqual([updatedFirst, second]);
    expect(mergeRecentDocuments([first], [updatedFirst, second])).toEqual([second, updatedFirst]);
  });

  it('maps ready sessions to persisted tabs and counts restorable tabs', () => {
    const ready = createDesktopSession();
    const browserFile = new File(['pdf'], 'browser.pdf', {
      type: 'application/pdf',
      lastModified: Date.parse('2026-07-02T00:00:00.000Z'),
    });
    const browserSession = createDesktopSession({
      id: 'session-b',
      documentKey: 'browser:browser.pdf:3:1782950400000',
      source: { kind: 'browser-file', file: browserFile, name: 'browser.pdf' },
    });

    const tabs = mapSessionsToPersistedTabs([ready, browserSession]);

    expect(tabs).toEqual<PersistedSessionTab[]>([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        tabOrder: 0,
        page: 3,
        zoom: 1.2,
        history: {
          currentPage: 3,
          backStack: [1, 2],
          forwardStack: [4],
        },
      },
    ]);
    expect(countRestorablePersistedTabs(tabs)).toBe(1);
    expect(countRestorablePersistedTabs([{ ...tabs[0], documentKey: 'browser:book.pdf' }])).toBe(0);
  });
});
