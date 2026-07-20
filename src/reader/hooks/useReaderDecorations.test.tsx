import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '../../annotations/annotationModels';
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
