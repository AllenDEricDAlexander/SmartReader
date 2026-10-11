import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bookmark, ReaderAnnotation } from '../../annotations/annotationModels';
import type { DocumentSession } from '../../documents/documentModels';
import type { PersistenceApi } from '../../persistence/persistenceApi';
import { useReaderDecorations } from './useReaderDecorations';

const bookmark: Bookmark = {
  id: 7,
  documentKey: 'desktop:/tmp/book.pdf',
  page: 3,
  title: 'Page 3',
  note: null,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

const activeSession: DocumentSession = {
  id: 'session-book',
  documentKey: bookmark.documentKey,
  title: 'book.pdf',
  source: {
    kind: 'desktop-path',
    path: '/tmp/book.pdf',
    name: 'book.pdf',
  },
  page: 3,
  totalPages: 10,
  progress: 0.3,
  zoom: 1,
  history: {
    currentPage: 3,
    backStack: [],
    forwardStack: [],
  },
  status: 'ready',
  errorMessage: null,
  restored: false,
  updatedAt: '2026-07-18T00:00:00.000Z',
};

describe('useReaderDecorations bookmarks', () => {
  it('does not repopulate cleared bookmarks when a save completes after locking', async () => {
    let finish!: (value: Bookmark) => void;
    const pending = new Promise<Bookmark>((resolve) => { finish = resolve; });
    const persistence = { saveBookmark: vi.fn(() => pending) } as unknown as PersistenceApi;
    const { result } = renderHook(() => useReaderDecorations({ activeSession, persistence }));
    let saving!: Promise<void>;
    act(() => { saving = result.current.addBookmarkForActivePage(); });
    act(() => result.current.forgetDocumentDecorations([bookmark.documentKey]));
    await act(async () => { finish(bookmark); await saving; });
    expect(result.current.bookmarksByDocument).toEqual({});
  });

  it('does not repopulate cleared annotations when a save completes after locking', async () => {
    let finish!: (value: ReaderAnnotation) => void;
    const pending = new Promise<ReaderAnnotation>((resolve) => { finish = resolve; });
    const persistence = { saveAnnotation: vi.fn(() => pending) } as unknown as PersistenceApi;
    const { result } = renderHook(() => useReaderDecorations({ activeSession, persistence }));
    let saving!: Promise<ReaderAnnotation | undefined>;
    act(() => { saving = result.current.saveAnnotationForActiveDocument({ page: 3, type: 'note', color: '#fff', text: 'private', quote: null, areas: [] }); });
    act(() => result.current.forgetDocumentDecorations([bookmark.documentKey]));
    await act(async () => {
      finish({ id: 7, documentKey: bookmark.documentKey, page: 3, type: 'note', color: '#fff', text: 'private', quote: null, areas: [], createdAt: '', updatedAt: '' });
      expect(await saving).toBeUndefined();
    });
    expect(result.current.annotationsByDocument).toEqual({});
  });

  it('keeps annotations visible when persistence rejects deletion', async () => {
    const annotation: ReaderAnnotation = { id: 7, documentKey: bookmark.documentKey, page: 3, type: 'note', color: '#fff', text: 'my note', quote: null, areas: [], tagIds: [], createdAt: '', updatedAt: '' };
    const persistence = {
      listBookmarks: vi.fn().mockResolvedValue([]), listAnnotations: vi.fn().mockResolvedValue([annotation]),
      deleteAnnotation: vi.fn().mockRejectedValue(new Error('disk full')),
    } as unknown as PersistenceApi;
    const { result } = renderHook(() => useReaderDecorations({ activeSession, persistence }));
    await act(async () => { await result.current.loadDocumentDecorations(bookmark.documentKey); });
    await expect(result.current.deleteAnnotationForDocument(bookmark.documentKey, 7)).rejects.toThrow('disk full');
    expect(result.current.annotationsByDocument[bookmark.documentKey]).toEqual([annotation]);
  });
  it('persists a normalized title and note before updating loaded local state', async () => {
    const persistence = {
      listBookmarks: vi.fn().mockResolvedValue([bookmark]),
      listAnnotations: vi.fn().mockResolvedValue([]),
      saveBookmark: vi
        .fn()
        .mockImplementation(async (savedBookmark: Bookmark) => savedBookmark),
    } as unknown as PersistenceApi;
    const { result } = renderHook(() =>
      useReaderDecorations({
        activeSession,
        persistence,
      }),
    );

    await act(async () => {
      await result.current.loadDocumentDecorations(bookmark.documentKey);
      await result.current.updateBookmarkForDocument(bookmark.documentKey, bookmark, {
        title: '  核心结论  ',
        note: '  对照第 3 节  ',
      });
    });

    expect(persistence.saveBookmark).toHaveBeenCalledWith(
      expect.objectContaining({
        id: bookmark.id,
        title: '核心结论',
        note: '对照第 3 节',
      }),
    );
    expect(result.current.bookmarksByDocument[bookmark.documentKey][0]).toMatchObject({
      title: '核心结论',
      note: '对照第 3 节',
    });
  });

  it('keeps the loaded bookmark unchanged when an update fails', async () => {
    const persistence = {
      listBookmarks: vi.fn().mockResolvedValue([bookmark]),
      listAnnotations: vi.fn().mockResolvedValue([]),
      saveBookmark: vi.fn().mockRejectedValue(new Error('save failed')),
    } as unknown as PersistenceApi;
    const { result } = renderHook(() =>
      useReaderDecorations({
        activeSession,
        persistence,
      }),
    );

    await act(async () => {
      await result.current.loadDocumentDecorations(bookmark.documentKey);
    });

    await expect(
      act(async () => {
        await result.current.updateBookmarkForDocument(bookmark.documentKey, bookmark, {
          title: '核心结论',
          note: '对照第 3 节',
        });
      }),
    ).rejects.toThrow('save failed');
    expect(result.current.bookmarksByDocument[bookmark.documentKey]).toEqual([bookmark]);
  });

  it('persists rename and delete operations before updating local state', async () => {
    const persistence = {
      listBookmarks: vi.fn().mockResolvedValue([bookmark]),
      listAnnotations: vi.fn().mockResolvedValue([]),
      saveBookmark: vi
        .fn()
        .mockImplementation(async (savedBookmark: Bookmark) => savedBookmark),
      deleteBookmark: vi.fn().mockResolvedValue(undefined),
    } as unknown as PersistenceApi;
    const { result } = renderHook(() =>
      useReaderDecorations({
        activeSession,
        persistence,
      }),
    );

    await act(async () => {
      await result.current.loadDocumentDecorations(bookmark.documentKey);
    });

    await act(async () => {
      await result.current.renameBookmarkForDocument(
        bookmark.documentKey,
        bookmark,
        '  核心结论  ',
      );
    });

    expect(persistence.saveBookmark).toHaveBeenCalledWith(
      expect.objectContaining({
        id: bookmark.id,
        title: '核心结论',
      }),
    );
    expect(result.current.bookmarksByDocument[bookmark.documentKey][0].title).toBe('核心结论');

    await act(async () => {
      await result.current.deleteBookmarkForDocument(bookmark.documentKey, bookmark.id!);
    });

    expect(persistence.deleteBookmark).toHaveBeenCalledWith(bookmark.id);
    expect(result.current.bookmarksByDocument[bookmark.documentKey]).toEqual([]);
  });

  it('keeps local bookmarks when deletion fails', async () => {
    const persistence = {
      listBookmarks: vi.fn().mockResolvedValue([bookmark]),
      listAnnotations: vi.fn().mockResolvedValue([]),
      deleteBookmark: vi.fn().mockRejectedValue(new Error('delete failed')),
    } as unknown as PersistenceApi;
    const { result } = renderHook(() =>
      useReaderDecorations({
        activeSession,
        persistence,
      }),
    );

    await act(async () => {
      await result.current.loadDocumentDecorations(bookmark.documentKey);
    });

    await expect(
      act(async () => {
        await result.current.deleteBookmarkForDocument(bookmark.documentKey, bookmark.id!);
      }),
    ).rejects.toThrow('delete failed');
    expect(result.current.bookmarksByDocument[bookmark.documentKey]).toEqual([bookmark]);
  });
});
