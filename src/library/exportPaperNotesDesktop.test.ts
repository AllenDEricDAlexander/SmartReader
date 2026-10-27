import { webcrypto } from 'node:crypto';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPaperNotesPdf } from './exportPaperNotes';
import { libraryUiFixture } from './libraryUiTestUtils';

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({ ...await importOriginal<typeof import('@tauri-apps/api/core')>(), invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('../platform/tauriRuntime', () => ({ isTauriRuntimeAvailable: () => true }));
vi.mock('./notesPdf', () => ({ createNotesPdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) }));

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('desktop notes export boundary', () => {
  it('uses the native new-file resource and binary IPC to finish the PDF', async () => {
    const { library, ai } = await libraryUiFixture();
    vi.mocked(save).mockResolvedValue('/tmp/new-notes.pdf');
    vi.mocked(invoke).mockImplementation(async (command) => command === 'begin_notes_export' ? 41 : undefined);
    expect(await exportPaperNotesPdf(library, ['paper-1'])).toBe(true);
    expect(invoke).toHaveBeenCalledWith('begin_notes_export', { path: '/tmp/new-notes.pdf' });
    expect(invoke).toHaveBeenCalledWith('write_notes_export', new Uint8Array([37, 80, 68, 70]), { headers: { 'x-smartreader-export': '41' } });
    expect(invoke).toHaveBeenCalledWith('flush_notes_export', { id: 41 });
    expect(invoke).toHaveBeenCalledWith('finish_notes_export', { id: 41 });
    expect(invoke).toHaveBeenCalledWith('release_notes_export', { id: 41 });
    expect(invoke).not.toHaveBeenCalledWith('abort_notes_export', expect.anything());
    ai.dispose();
  });

  it('surfaces an existing-file rejection without attempting cleanup of that path', async () => {
    const { library, ai } = await libraryUiFixture();
    vi.mocked(save).mockResolvedValue('/tmp/existing.pdf');
    vi.mocked(invoke).mockRejectedValueOnce('无法创建笔记 PDF：目标文件已存在');
    await expect(exportPaperNotesPdf(library, ['paper-1'])).rejects.toThrow('目标文件已存在');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('begin_notes_export', { path: '/tmp/existing.pdf' });
    ai.dispose();
  });
});
