import { describe, expect, it, vi } from 'vitest';
import { createPersistenceApi, type PersistedDocument } from './persistenceApi';

describe('persistenceApi', () => {
  it('saves a document through Tauri invoke', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createPersistenceApi(invoke);
    const document: PersistedDocument = {
      documentKey: 'desktop:/tmp/book.pdf',
      path: '/tmp/book.pdf',
      displayName: 'book.pdf',
      fileSize: 120,
      modifiedAt: '2026-06-15T00:00:00Z',
      pageCount: 20,
      lastPage: 3,
      progress: 0.15,
      missing: false,
    };

    await api.saveDocument(document);

    expect(invoke).toHaveBeenCalledWith('save_document', { document });
  });

  it('lists recent documents through Tauri invoke', async () => {
    const invoke = vi.fn().mockResolvedValue([{ documentKey: 'desktop:/tmp/book.pdf' }]);
    const api = createPersistenceApi(invoke);

    await expect(api.listRecentDocuments()).resolves.toEqual([
      { documentKey: 'desktop:/tmp/book.pdf' },
    ]);
  });

  it('saves and loads reader sessions', async () => {
    const invoke = vi.fn().mockResolvedValue([{ documentKey: 'desktop:/tmp/book.pdf', page: 4 }]);
    const api = createPersistenceApi(invoke);

    await api.saveReaderSession({
      activeDocumentKey: 'desktop:/tmp/book.pdf',
      sidebarOpen: true,
      tabs: [
        {
          documentKey: 'desktop:/tmp/book.pdf',
          tabOrder: 0,
          page: 4,
          zoom: 1.25,
          history: { currentPage: 4, backStack: [1], forwardStack: [] },
        },
      ],
    });

    expect(invoke).toHaveBeenCalledWith('save_reader_session', {
      session: {
        activeDocumentKey: 'desktop:/tmp/book.pdf',
        sidebarOpen: true,
        tabs: [
          {
            documentKey: 'desktop:/tmp/book.pdf',
            tabOrder: 0,
            page: 4,
            zoom: 1.25,
            history: { currentPage: 4, backStack: [1], forwardStack: [] },
          },
        ],
      },
    });

    await api.loadReaderSession();
    expect(invoke).toHaveBeenCalledWith('load_reader_session');
  });

  it('persists bookmarks and annotations', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const api = createPersistenceApi(invoke);

    await api.saveBookmark({
      id: null,
      documentKey: 'desktop:/tmp/book.pdf',
      page: 3,
      title: 'Method',
      createdAt: '2026-06-16T00:00:00Z',
      updatedAt: '2026-06-16T00:00:00Z',
    });
    await api.listBookmarks('desktop:/tmp/book.pdf');
    await api.deleteBookmark(8);

    await api.saveAnnotation({
      id: null,
      documentKey: 'desktop:/tmp/book.pdf',
      page: 5,
      type: 'highlight',
      color: '#facc15',
      text: 'Important',
      quote: 'quoted text',
      areas: [{ pageIndex: 4, top: 10, left: 12, height: 3, width: 30 }],
      createdAt: '2026-06-16T00:00:00Z',
      updatedAt: '2026-06-16T00:00:00Z',
    });
    await api.listAnnotations('desktop:/tmp/book.pdf');
    await api.deleteAnnotation(9);

    expect(invoke).toHaveBeenCalledWith('save_bookmark', expect.any(Object));
    expect(invoke).toHaveBeenCalledWith('list_bookmarks', {
      documentKey: 'desktop:/tmp/book.pdf',
    });
    expect(invoke).toHaveBeenCalledWith('delete_bookmark', { id: 8 });
    expect(invoke).toHaveBeenCalledWith('save_annotation', expect.any(Object));
    expect(invoke).toHaveBeenCalledWith('list_annotations', {
      documentKey: 'desktop:/tmp/book.pdf',
    });
    expect(invoke).toHaveBeenCalledWith('delete_annotation', { id: 9 });
  });

  it('persists reader preferences', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const api = createPersistenceApi(invoke);
    const preferences = {
      sessionRestoreEnabled: true,
      defaultZoomMode: 'fit-width' as const,
      shortcuts: {
        'file.open': 'Meta+O',
        'tab.close': 'Meta+W',
        'find.open': 'Meta+F',
        'find.next': 'Meta+G',
        'find.previous': 'Shift+Meta+G',
        'sidebar.toggle': 'Meta+B',
        'zoom.in': 'Meta+=',
        'zoom.out': 'Meta+-',
        'zoom.fitWidth': 'Meta+0',
        'zoom.fitPage': 'Meta+9',
        'page.focus': 'Meta+L',
        'history.back': 'Meta+[',
        'history.forward': 'Meta+]',
        'tab.next': 'Control+Tab',
        'tab.previous': 'Shift+Control+Tab',
        'bookmark.add': 'Meta+D',
        'annotation.note': 'Meta+Shift+N',
        'preferences.open': 'Meta+,',
        'annotation.export': null,
        'annotation.import': null,
      },
    };

    await api.savePreferences(preferences);
    await api.loadPreferences();

    expect(invoke).toHaveBeenCalledWith('save_preferences', { preferences });
    expect(invoke).toHaveBeenCalledWith('load_preferences');
  });
});
