// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';
import { createNotesPdf } from './notesPdf';
import { exportDocumentNotesPdf } from './exportPaperNotes';
import { libraryUiFixture, paperFixture } from './libraryUiTestUtils';
import type { ReaderAnnotation } from '../annotations/annotationModels';
import type { PersistenceApi } from '../persistence/persistenceApi';

const font = new Uint8Array(readFileSync(resolve('src/library/assets/NotoSansSC-Regular.ttf')));
GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/build/pdf.worker.js');
vi.setConfig({ testTimeout: 20_000 });

function annotation(type: ReaderAnnotation['type'], page: number, quote: string | null, text: string | null): ReaderAnnotation {
  return { id: -page, documentKey: 'paper:paper-1', page, type, color: '#facc15', quote, text, areas: [], createdAt: '2026-10-27', updatedAt: '2026-10-27' };
}

async function pdfText(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true });
  const document = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= document.numPages; i++) {
    const content = await (await document.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(''));
  }
  await task.destroy();
  return pages;
}

describe('batch notes PDF export', () => {
  it('preserves all selected library and legacy content in the generated batch PDF', async () => {
    const first = paperFixture('first', '第一篇');
    first.annotations = [{ ...annotation('note', 1, '第一篇摘录', '第一篇笔记'), documentKey: 'paper:first', tagIds: [7] }];
    const second = paperFixture('second', '第二篇');
    second.annotations = [{ ...annotation('underline', 2, '第二篇划线', '第二篇批注'), documentKey: 'paper:second' }];
    const excluded = paperFixture('excluded', '未选择的文献');
    const { library, ai } = await libraryUiFixture([first, second, excluded]);
    const legacyNote = { ...annotation('highlight', 3, '旧文档摘录', '旧文档笔记'), documentKey: 'desktop:/legacy.pdf' };
    const legacyBookmark = { id: 9, documentKey: 'desktop:/legacy.pdf', page: 4, title: '旧书签', note: '旧备注', createdAt: '2026-10-27', updatedAt: '2026-10-27' };
    const persistence = { listAnnotations: vi.fn().mockResolvedValue([legacyNote]), listBookmarks: vi.fn().mockResolvedValue([legacyBookmark]),
      listTags: vi.fn().mockResolvedValue([{ id: 7, name: '重点' }]) } as unknown as PersistenceApi;
    const chunks: Uint8Array[] = [];
    const io = {
      choosePath: async () => '/tmp/batch.pdf',
      createPdf: (papers: Parameters<typeof createNotesPdf>[0], signal: AbortSignal) => createNotesPdf(papers, font, signal),
      openPdf: async () => ({ write: async (bytes: Uint8Array) => { chunks.push(bytes.slice()); }, flush: async () => {},
        finish: async () => {}, release: async () => {}, abort: async () => { chunks.length = 0; } }),
    };
    expect(await exportDocumentNotesPdf(library, persistence, [
      { documentKey: 'paper:first', displayName: '第一篇' },
      { documentKey: 'paper:second', displayName: '第二篇' },
      { documentKey: 'desktop:/legacy.pdf', displayName: '旧文档' },
    ], io)).toBe(true);
    const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const text = (await pdfText(bytes)).join('');
    for (const expected of ['第一篇', '第一篇摘录', '第一篇笔记', '重点', '第二篇', '第二篇划线', '第二篇批注', '旧文档摘录', '旧文档笔记', '旧书签', '旧备注']) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('未选择的文献');
    ai.dispose();
  });

});
