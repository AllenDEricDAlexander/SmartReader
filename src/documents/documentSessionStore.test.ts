import { describe, expect, it } from 'vitest';
import { desktopPdfSource } from '../test/fixtures';
import {
  addDocumentSession,
  closeDocumentSession,
  createEmptyDocumentState,
  restoreDocumentSessions,
  updateSessionProgress,
} from './documentSessionStore';

describe('documentSessionStore', () => {
  it('adds a new desktop document session', () => {
    const state = createEmptyDocumentState();

    const next = addDocumentSession(state, desktopPdfSource('/tmp/book.pdf'));

    expect(next.sessions).toHaveLength(1);
    expect(next.activeSessionId).toBe(next.sessions[0].id);
    expect(next.sessions[0]).toMatchObject({
      documentKey: 'desktop:/tmp/book.pdf',
      title: 'book.pdf',
      page: 1,
      totalPages: null,
      zoom: 1,
      status: 'loading',
    });
  });

  it('focuses an existing desktop path instead of duplicating it', () => {
    const first = addDocumentSession(createEmptyDocumentState(), desktopPdfSource('/tmp/book.pdf'));
    const second = addDocumentSession(first, desktopPdfSource('/tmp/other.pdf'));
    const third = addDocumentSession(second, desktopPdfSource('/tmp/book.pdf'));

    expect(third.sessions).toHaveLength(2);
    expect(third.activeSessionId).toBe(first.sessions[0].id);
  });

  it('updates progress on the active session', () => {
    const state = addDocumentSession(createEmptyDocumentState(), desktopPdfSource('/tmp/book.pdf'));

    const next = updateSessionProgress(state, state.activeSessionId!, {
      page: 7,
      totalPages: 20,
      zoom: 1.25,
    });

    expect(next.sessions[0]).toMatchObject({
      page: 7,
      totalPages: 20,
      zoom: 1.25,
      progress: 0.35,
    });
  });

  it('selects a neighboring tab when closing the active session', () => {
    const first = addDocumentSession(createEmptyDocumentState(), desktopPdfSource('/tmp/a.pdf'));
    const second = addDocumentSession(first, desktopPdfSource('/tmp/b.pdf'));

    const next = closeDocumentSession(second, second.activeSessionId!);

    expect(next.sessions).toHaveLength(1);
    expect(next.sessions[0].title).toBe('a.pdf');
    expect(next.activeSessionId).toBe(next.sessions[0].id);
  });
});

describe('restoreDocumentSessions', () => {
  it('restores desktop path sessions with saved progress', () => {
    const state = restoreDocumentSessions([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
        fileSize: 100,
        modifiedAt: '2026-06-15T00:00:00Z',
        pageCount: 20,
        lastPage: 6,
        progress: 0.3,
        missing: false,
      },
    ]);

    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(state.sessions[0].id);
    expect(state.sessions[0]).toMatchObject({
      documentKey: 'desktop:/tmp/book.pdf',
      page: 6,
      totalPages: 20,
      progress: 0.3,
      status: 'ready',
    });
  });
});
