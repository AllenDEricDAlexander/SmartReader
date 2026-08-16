import { describe, expect, it } from 'vitest';
import { desktopPdfSource } from '../test/fixtures';
import {
  addDocumentSession,
  closeDocumentSession,
  createEmptyDocumentState,
  markSessionError,
  recordHardNavigation,
  restoreDocumentSessions,
  selectNextSession,
  selectPreviousSession,
  stepSessionHistoryBack,
  stepSessionHistoryForward,
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

  it('closes a background session without changing the active session or sidebar state', () => {
    const first = addDocumentSession(createEmptyDocumentState(), desktopPdfSource('/tmp/a.pdf'));
    const state = addDocumentSession(first, desktopPdfSource('/tmp/b.pdf'));
    const backgroundSessionId = state.sessions[0].id;

    const next = closeDocumentSession(state, backgroundSessionId);

    expect(next.sessions).toHaveLength(1);
    expect(next.sessions[0].title).toBe('b.pdf');
    expect(next.activeSessionId).toBe(state.activeSessionId);
    expect(next.sidebarOpen).toBe(state.sidebarOpen);
  });

  it('closes the final session while preserving the sidebar state', () => {
    const state = addDocumentSession(createEmptyDocumentState(), desktopPdfSource('/tmp/a.pdf'));

    const next = closeDocumentSession(state, state.activeSessionId!);

    expect(next.sessions).toEqual([]);
    expect(next.activeSessionId).toBeNull();
    expect(next.sidebarOpen).toBe(state.sidebarOpen);
  });

  it('ignores an unknown session id', () => {
    const state = addDocumentSession(createEmptyDocumentState(), desktopPdfSource('/tmp/a.pdf'));

    const next = closeDocumentSession(state, 'missing-session');

    expect(next).toEqual(state);
  });

  it('moves active tab forward and backward', () => {
    const first = addDocumentSession(createEmptyDocumentState(), {
      kind: 'desktop-path',
      path: '/tmp/a.pdf',
      name: 'a.pdf',
    });
    const second = addDocumentSession(first, {
      kind: 'desktop-path',
      path: '/tmp/b.pdf',
      name: 'b.pdf',
    });

    expect(selectNextSession(second).activeSessionId).toBe(first.sessions[0].id);
    expect(selectPreviousSession(second).activeSessionId).toBe(first.sessions[0].id);
  });

  it('records hard navigation and steps through history', () => {
    const state = addDocumentSession(createEmptyDocumentState(), {
      kind: 'desktop-path',
      path: '/tmp/a.pdf',
      name: 'a.pdf',
    });
    const sessionId = state.activeSessionId!;

    const jumped = recordHardNavigation(state, sessionId, 5);
    const backed = stepSessionHistoryBack(jumped, sessionId);
    const forwarded = stepSessionHistoryForward(backed, sessionId);

    expect(jumped.sessions[0].history).toMatchObject({ currentPage: 5, backStack: [1] });
    expect(backed.sessions[0].page).toBe(1);
    expect(forwarded.sessions[0].page).toBe(5);
  });
});

describe('restoreDocumentSessions', () => {
  it('restores desktop path sessions with saved progress', () => {
    const state = restoreDocumentSessions(
      [
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
          lastOpenedAt: null,
          tagIds: [],
        },
      ],
      {
        activeDocumentKey: 'desktop:/tmp/book.pdf',
        sidebarOpen: true,
        tabs: [
          {
            documentKey: 'desktop:/tmp/book.pdf',
            tabOrder: 0,
            page: 6,
            zoom: 1,
            history: { currentPage: 6, backStack: [], forwardStack: [] },
          },
        ],
      },
    );

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

  it('marks restored missing files as recoverable errors', () => {
    const state = markSessionError(
      restoreDocumentSessions(
        [
          {
            documentKey: 'desktop:/tmp/missing.pdf',
            path: '/tmp/missing.pdf',
            displayName: 'missing.pdf',
            fileSize: 100,
            modifiedAt: '2026-06-16T00:00:00Z',
            pageCount: 10,
            lastPage: 2,
            progress: 0.2,
            missing: false,
            lastOpenedAt: null,
            tagIds: [],
          },
        ],
        {
          activeDocumentKey: 'desktop:/tmp/missing.pdf',
          sidebarOpen: true,
          tabs: [
            {
              documentKey: 'desktop:/tmp/missing.pdf',
              tabOrder: 0,
              page: 2,
              zoom: 1,
              history: { currentPage: 2, backStack: [], forwardStack: [] },
            },
          ],
        },
      ),
      'session-ZGVza3RvcDovdG1wL21pc3NpbmcucGRm',
      'file does not exist',
    );

    expect(state.sessions[0]).toMatchObject({
      status: 'error',
      errorMessage: 'file does not exist',
    });
  });
});
