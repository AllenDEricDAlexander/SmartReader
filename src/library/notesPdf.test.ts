// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotesPdf } from './notesPdf';
import { paperFixture } from './libraryUiTestUtils';
import type { ReaderAnnotation } from '../annotations/annotationModels';

const font = new Uint8Array(readFileSync(resolve('src/library/assets/NotoSansSC-Regular.ttf')));
GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/build/pdf.worker.js');
vi.setConfig({ testTimeout: 20_000 });
const hasPoppler = !spawnSync('pdftoppm', ['-v']).error;

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

afterEach(() => vi.unstubAllGlobals());

describe('notes PDF', () => {
  it('contains searchable Chinese notes, highlights, underlines and bookmark remarks grouped by paper and page', async () => {
    const first = paperFixture();
    first.annotations = [annotation('note', 5, '选中的原文', '第一行笔记\n第二行笔记'), annotation('highlight', 2, '高亮原文', '高亮批注'), annotation('underline', 3, '划线原文', null)];
    first.bookmarks = [{ id: -4, documentKey: 'paper:paper-1', page: 4, title: '重点章节', note: '书签备注', createdAt: '2026-10-27', updatedAt: '2026-10-27' }];
    const second = paperFixture('paper-2', '空白文献');
    const pages = await pdfText(await createNotesPdf([first, second], font));
    const text = pages.join('');
    for (const expected of ['认知研究', '高亮原文', '高亮批注', '划线原文', '重点章节', '书签备注', '选中的原文', '第一行笔记', '第二行笔记', '空白文献', '暂无笔记、批注或书签']) {
      expect(text).toContain(expected);
    }
    expect(text.indexOf('高亮原文')).toBeLessThan(text.indexOf('划线原文'));
    expect(text.indexOf('划线原文')).toBeLessThan(text.indexOf('重点章节'));
    expect(text.indexOf('重点章节')).toBeLessThan(text.indexOf('选中的原文'));
  });

  it('flows long notes across PDF pages without losing their ending', async () => {
    const paper = paperFixture();
    paper.annotations = [annotation('note', 1, null, `${'长文本内容'.repeat(700)}结尾标记`)];
    const pages = await pdfText(await createNotesPdf([paper], font));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toContain('结尾标记');
    expect(pages.join('').match(/长/g)?.length).toBe(700);
    expect(pages.join('').match(/容/g)?.length).toBe(700);
  });

  it.skipIf(!hasPoppler)('renders every Chinese character rather than only retaining its text mapping', async () => {
    const paper = paperFixture();
    paper.annotations = [annotation('note', 1, null, '中文显示测试')];
    const bytes = await createNotesPdf([paper], font);
    const task = getDocument({ data: bytes.slice(), isEvalSupported: false });
    const pdf = await task.promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    const item = content.items.find((value) => 'str' in value && value.str.includes('笔记：中文显示测试'));
    expect(item && 'str' in item).toBe(true);
    if (!item || !('str' in item)) throw new Error('未找到目标文本');
    const measure = await PDFDocument.create();
    measure.registerFontkit(fontkit);
    const embedded = await measure.embedFont(font);
    const directory = mkdtempSync(join(tmpdir(), 'smartreader-notes-render-'));
    try {
      const path = join(directory, 'notes.pdf');
      writeFileSync(path, bytes);
      const result = spawnSync('pdftoppm', ['-f', '1', '-l', '1', '-r', '72', '-gray', '-singlefile', path, join(directory, 'page')]);
      expect(result.status).toBe(0);
      const pgm = readFileSync(join(directory, 'page.pgm'));
      const header = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(pgm.toString('ascii', 0, 80));
      if (!header) throw new Error('无法读取渲染图像');
      const width = Number(header[1]), height = Number(header[2]);
      const pixels = pgm.subarray(header[0].length);
      let x = item.transform[4] + embedded.widthOfTextAtSize('笔记：', 11);
      const top = Math.max(0, Math.floor(height - item.transform[5] - 12));
      const bottom = Math.min(height, Math.ceil(height - item.transform[5] + 3));
      for (const character of '中文显示测试') {
        const next = x + embedded.widthOfTextAtSize(character, 11);
        let dark = 0;
        for (let y = top; y < bottom; y++) for (let column = Math.floor(x); column < Math.ceil(next); column++) {
          if (column >= 0 && column < width && pixels[y * width + column] < 180) dark++;
        }
        expect(dark, `${character} 应有可见字形`).toBeGreaterThan(2);
        x = next;
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
      await task.destroy();
    }
  });

  it('renders unsupported characters as images while retaining surrounding Chinese text', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aRcAAAAASUVORK5CYII=';
    const context = { font: '', textBaseline: '', fillStyle: '', measureText: () => ({ width: 11 }), scale: vi.fn(), fillText: vi.fn() };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context, toDataURL: () => `data:image/png;base64,${png}` }) });
    const paper = paperFixture();
    paper.annotations = [annotation('note', 1, null, '前文😀后文'), annotation('note', 2, null, 'مرحبا بالعالم')];
    const bytes = await createNotesPdf([paper], font);
    const document = await PDFDocument.load(bytes);
    const resources = document.getPage(0).node.Resources();
    expect(resources?.lookup(PDFName.of('XObject'))).toBeDefined();
    expect(context.fillText).toHaveBeenCalledWith('😀', expect.any(Number), expect.any(Number));
    expect(context.fillText).toHaveBeenCalledWith('مرحبا بالعالم', expect.any(Number), expect.any(Number));
    const text = (await pdfText(bytes)).join('');
    expect(text).toContain('前文');
    expect(text).toContain('后文');
  });

  it('includes annotation colors, timestamps, tags and source positions', async () => {
    const paper = paperFixture();
    paper.annotations = [{ ...annotation('highlight', 2, '原文', '批注'), tagIds: [7],
      areas: [{ pageIndex: 1, left: 12, top: 25, width: 30, height: 3 }] }];
    const pages = await pdfText(await createNotesPdf([{ ...paper, tagNames: { 7: '重要' } }], font));
    const text = pages.join('');
    for (const expected of ['颜色：#facc15', '创建：2026-10-27', '更新：2026-10-27', '标签：重要', '距左 12%', '距上 25%', '宽 30%', '高 3%']) {
      expect(text).toContain(expected);
    }
  });


  it('interrupts a long batch when its access is revoked', async () => {
    const paper = paperFixture();
    paper.annotations = Array.from({ length: 40 }, (_, index) => annotation('note', index + 1, null, `笔记 ${index}`));
    const controller = new AbortController();
    const reason = new Error('文献已锁定');
    setTimeout(() => controller.abort(reason), 0);
    await expect(createNotesPdf([paper], font, controller.signal)).rejects.toThrow('文献已锁定');
  });

  it('interrupts a long single note when its access is revoked', async () => {
    const paper = paperFixture();
    paper.annotations = [annotation('note', 1, null, '长笔记内容'.repeat(900))];
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('文献已锁定')), 0);
    await expect(createNotesPdf([paper], font, controller.signal)).rejects.toThrow('文献已锁定');
  });
});
