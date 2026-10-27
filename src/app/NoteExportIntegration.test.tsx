import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportDocumentNotesPdf } from '../library/exportPaperNotes';
import { libraryUiFixture, paperFixture } from '../library/libraryUiTestUtils';
import { createPersistenceApi, type Invoke } from '../persistence/persistenceApi';
import { App } from './App';

vi.mock('../platform/openWithEvents', () => ({ listenForOpenWith: vi.fn(async () => () => undefined) }));
vi.mock('../library/exportPaperNotes', () => ({ exportDocumentNotesPdf: vi.fn().mockResolvedValue(true), exportPaperNotesPdf: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('note export integration', () => {
  it('loads legacy records when opening notes and offers a mixed library and legacy export', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const { library, ai } = await libraryUiFixture([paperFixture()]);
    const legacy = { id: 4, documentKey: 'desktop:/old.pdf', page: 2, type: 'note', color: '#facc15', text: '旧笔记', quote: null, areas: [], tagIds: [], createdAt: '2026-10-01', updatedAt: '2026-10-01', documentDisplayName: 'old.pdf', documentPath: '/old.pdf', documentMissing: false };
    const responses: Record<string, unknown> = {
      list_all_annotations: [legacy], list_tags: [], list_favorite_documents: [], list_recent_documents: [],
      load_bookmark_dashboard: { totalBookmarks: 0, groups: [] }, load_reader_session: null,
      load_preferences: null, load_cache_stats: { usedBytes: 0, totalBytes: 1000, fileCount: 0 },
    };
    const invoke: Invoke = async <T,>(command: string) => (responses[command] ?? null) as T;
    const persistence = createPersistenceApi(invoke);
    render(<App research={{ library, ai }} persistence={persistence} bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: '笔记管理' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择导出 认知研究' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择导出 old.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: '导出笔记 PDF（2）' }));
    await waitFor(() => expect(exportDocumentNotesPdf).toHaveBeenCalledWith(library, expect.any(Object), [
      expect.objectContaining({ documentKey: 'paper:paper-1' }),
      expect.objectContaining({ documentKey: 'desktop:/old.pdf' }),
    ]));
    ai.dispose();
  });

  it('keeps a cleanup failure visible after navigating away from note management', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const { library, ai } = await libraryUiFixture([paperFixture()]);
    let reject!: (failure: Error) => void;
    vi.mocked(exportDocumentNotesPdf).mockReturnValueOnce(new Promise<boolean>((_resolve, fail) => { reject = fail; }));
    const responses: Record<string, unknown> = { list_all_annotations: [], list_tags: [], list_favorite_documents: [], list_recent_documents: [],
      load_bookmark_dashboard: { totalBookmarks: 0, groups: [] }, load_reader_session: null, load_preferences: null,
      load_cache_stats: { usedBytes: 0, totalBytes: 1000, fileCount: 0 } };
    const invoke: Invoke = async <T,>(command: string) => (responses[command] ?? null) as T;
    render(<App research={{ library, ai }} persistence={createPersistenceApi(invoke)} bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: '笔记管理' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择导出 认知研究' }));
    fireEvent.click(screen.getByRole('button', { name: '导出笔记 PDF（1）' }));
    fireEvent.click(screen.getByRole('button', { name: '我的文献' }));
    const failure = new Error('清理新文件失败：/tmp/notes.pdf');
    failure.name = 'NotesExportCleanupError';
    reject(failure);
    expect(await screen.findByText('清理新文件失败：/tmp/notes.pdf')).toBeInTheDocument();
    ai.dispose();
  });
});
