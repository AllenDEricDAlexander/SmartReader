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
});
