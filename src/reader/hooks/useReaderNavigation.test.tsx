import { act, renderHook } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlobUrlCache } from '../../cache/blobUrlCache';
import {
  addDocumentSession,
  createEmptyDocumentState,
} from '../../documents/documentSessionStore';
import type { DocumentState } from '../../documents/documentModels';
import { desktopPdfSource } from '../../test/fixtures';
import type { ViewerActions } from '../../viewer/viewerController';
import { useReaderNavigation } from './useReaderNavigation';

function createNavigationFixture() {
  const first = addDocumentSession(
    createEmptyDocumentState(),
    desktopPdfSource('/tmp/a.pdf'),
  );
  const state = addDocumentSession(first, desktopPdfSource('/tmp/b.pdf'));
  const stateWithProgress: DocumentState = {
    ...state,
    sessions: state.sessions.map((session, index) =>
      index === 0
        ? {
            ...session,
            page: 42,
            zoom: 1.5,
            history: { ...session.history, currentPage: 42 },
          }
        : {
            ...session,
            page: 7,
            zoom: 0.9,
            history: { ...session.history, currentPage: 7 },
          },
    ),
  };
  let currentState = stateWithProgress;
  const setDocuments: Dispatch<SetStateAction<DocumentState>> = vi.fn((update) => {
    currentState = typeof update === 'function' ? update(currentState) : update;
  });
  const setViewerSource = vi.fn();
  const getForSession = vi.fn((sessionId: string) => {
    if (sessionId === state.sessions[0].id) {
      return 'blob:a';
    }

    if (sessionId === state.sessions[1].id) {
      return 'blob:b';
    }

    return null;
  });
  const blobUrlCache = {
    getForSession,
    revokeForSession: vi.fn(),
  } as unknown as BlobUrlCache;

  return {
    activeSession: stateWithProgress.sessions[1],
    activeViewerController: {} as ViewerActions,
    blobUrlCache,
    getCurrentState: () => currentState,
    getForSession,
    setDocuments,
    setViewerSource,
    state: stateWithProgress,
  };
}

describe('useReaderNavigation session activation', () => {
  it('restores the selected session page and zoom', () => {
    const fixture = createNavigationFixture();
    const targetSession = fixture.state.sessions[0];
    const { result } = renderHook(() => useReaderNavigation(fixture));

    act(() => {
      result.current.selectReaderSession(targetSession.id);
    });

    expect(fixture.getCurrentState().activeSessionId).toBe(targetSession.id);
    expect(fixture.setViewerSource).toHaveBeenLastCalledWith({
      sessionId: targetSession.id,
      url: 'blob:a',
      restore: { page: 42, zoom: 1.5 },
    });
  });

  it('restores each target while cycling sessions', () => {
    const fixture = createNavigationFixture();
    const firstSession = fixture.state.sessions[0];
    const secondSession = fixture.state.sessions[1];
    const { result } = renderHook(() => useReaderNavigation(fixture));

    act(() => {
      result.current.selectNextReaderSession();
    });

    expect(fixture.setViewerSource).toHaveBeenLastCalledWith({
      sessionId: firstSession.id,
      url: 'blob:a',
      restore: { page: 42, zoom: 1.5 },
    });

    act(() => {
      result.current.selectPreviousReaderSession();
    });

    expect(fixture.setViewerSource).toHaveBeenLastCalledWith({
      sessionId: secondSession.id,
      url: 'blob:b',
      restore: { page: 7, zoom: 0.9 },
    });
  });

  it('clears the viewer source when the target session has no Blob URL', () => {
    const fixture = createNavigationFixture();
    const targetSession = fixture.state.sessions[0];
    fixture.getForSession.mockReturnValue(null);
    const { result } = renderHook(() => useReaderNavigation(fixture));

    act(() => {
      result.current.selectReaderSession(targetSession.id);
    });

    expect(fixture.setViewerSource).toHaveBeenLastCalledWith(null);
    expect(fixture.getCurrentState().sessions[0]).toMatchObject({
      page: 42,
      zoom: 1.5,
    });
  });
});

describe('useReaderNavigation document closing', () => {
  it('closes a background session without synchronizing the active viewer', () => {
    const fixture = createNavigationFixture();
    const backgroundSessionId = fixture.state.sessions[0].id;
    const { result } = renderHook(() => useReaderNavigation(fixture));

    act(() => {
      result.current.closeReaderSession(backgroundSessionId);
    });

    expect(fixture.blobUrlCache.revokeForSession).toHaveBeenCalledWith(backgroundSessionId);
    expect(fixture.getCurrentState().sessions).toHaveLength(1);
    expect(fixture.getCurrentState().activeSessionId).toBe(fixture.activeSession.id);
    expect(fixture.setViewerSource).not.toHaveBeenCalled();
  });

  it('closes the active session and synchronizes the fallback viewer', () => {
    const fixture = createNavigationFixture();
    const activeSessionId = fixture.activeSession.id;
    const fallbackSessionId = fixture.state.sessions[0].id;
    const { result } = renderHook(() => useReaderNavigation(fixture));

    act(() => {
      result.current.closeReaderSession(activeSessionId);
    });

    expect(fixture.blobUrlCache.revokeForSession).toHaveBeenCalledWith(activeSessionId);
    expect(fixture.getCurrentState().activeSessionId).toBe(fallbackSessionId);
    expect(fixture.setViewerSource).toHaveBeenCalledWith({
      sessionId: fallbackSessionId,
      url: 'blob:a',
      restore: { page: 42, zoom: 1.5 },
    });
  });

  it('clears the viewer source when the final session is closed', () => {
    const fixture = createNavigationFixture();
    const { result } = renderHook(() => useReaderNavigation(fixture));

    act(() => {
      result.current.closeReaderSession(fixture.activeSession.id);
      result.current.closeReaderSession(fixture.state.sessions[0].id);
    });

    expect(fixture.getCurrentState().sessions).toEqual([]);
    expect(fixture.getCurrentState().activeSessionId).toBeNull();
    expect(fixture.setViewerSource).toHaveBeenLastCalledWith(null);
  });

  it('keeps state and viewer source unchanged for an unknown session', () => {
    const fixture = createNavigationFixture();
    const { result } = renderHook(() => useReaderNavigation(fixture));

    act(() => {
      result.current.closeReaderSession('missing-session');
    });

    expect(fixture.getCurrentState()).toEqual(fixture.state);
    expect(fixture.blobUrlCache.revokeForSession).toHaveBeenCalledWith('missing-session');
    expect(fixture.setViewerSource).not.toHaveBeenCalled();
  });

  it('keeps closeActiveTab as the active-session compatibility entry point', () => {
    const fixture = createNavigationFixture();
    const { result } = renderHook(() => useReaderNavigation(fixture));

    act(() => {
      result.current.closeActiveTab();
    });

    expect(fixture.blobUrlCache.revokeForSession).toHaveBeenCalledWith(fixture.activeSession.id);
    expect(fixture.getCurrentState().activeSessionId).toBe(fixture.state.sessions[0].id);
  });
});
