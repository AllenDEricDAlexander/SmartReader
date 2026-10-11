import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist';
import { extractPdf } from './pdfExtraction';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));

afterEach(() => vi.clearAllMocks());

function mockPdf(
  pageLines: string[][],
  info: Record<string, unknown> = {},
  xmp: Record<string, unknown> = {},
) {
  const pages = pageLines.map((lines) => ({
    getTextContent: vi.fn().mockResolvedValue({
      items: [{ type: 'beginMarkedContent' }, ...lines.map((str) => ({ str, hasEOL: true }))],
    }),
    cleanup: vi.fn(),
  }));
  const doc = {
    numPages: pages.length,
    getMetadata: vi.fn().mockResolvedValue({ info, metadata: { get: (key: string) => xmp[key] } }),
    getPage: vi.fn().mockImplementation(async (page: number) => pages[page - 1]),
  };
  const task = { promise: Promise.resolve(doc), destroy: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(getDocument).mockReturnValue(task as unknown as ReturnType<typeof getDocument>);
  return { doc, pages, task };
}

const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]);

describe('PDF extraction', () => {
  it('extracts standard academic XMP fields ahead of PDF Info without inventing indexing status', async () => {
    const { pages, task } = mockPdf([['Body text']], { Title: 'Old title', Author: 'Old author' }, {
      'dc:title': 'Cognitive control',
      'dc:creator': ['Ada Researcher', 'Li Scientist'],
      'prism:publicationname': 'Journal of Cognitive Science',
      'prism:coverdate': '2025-03-01',
      'prism:doi': 'https://doi.org/10.1234/Cog.2025.001',
      'dc:description': 'An experiment in cognitive control.',
      'dc:subject': ['cognition', 'attention'],
    });

    const result = await extractPdf(pdfBytes);

    expect(result.metadata).toMatchObject({
      title: 'Cognitive control',
      authors: ['Ada Researcher', 'Li Scientist'],
      journal: 'Journal of Cognitive Science',
      year: '2025',
      doi: '10.1234/Cog.2025.001',
      abstract: 'An experiment in cognitive control.',
      keywords: ['cognition', 'attention'],
      indexingStatus: '未知',
      researchFields: [],
      disciplines: [],
    });
    expect(result.pages).toEqual([{ page: 1, text: 'Body text' }]);
    expect(result.pageCount).toBe(1);
    expect(pages[0].cleanup).toHaveBeenCalledOnce();
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it('extracts explicitly labelled publication facts and an abstract from the opening pages', async () => {
    mockPdf([[
      'Attention in machine learning',
      'Journal: Example Research',
      'Published online: 2024-04-12',
      'DOI: 10.1234/example.001.',
      'Abstract',
      'We compare attention mechanisms across tasks.',
      'Our experiment measures transfer.',
      'Keywords: attention; machine learning; transfer',
      '1 Introduction',
      'This must not be part of the abstract.',
    ]], { Author: 'Ada Researcher; Li Scientist', CreationDate: 'D:20260101000000Z' });

    expect((await extractPdf(pdfBytes)).metadata).toMatchObject({
      title: 'Attention in machine learning',
      authors: ['Ada Researcher', 'Li Scientist'],
      journal: 'Example Research',
      year: '2024',
      doi: '10.1234/example.001',
      abstract: 'We compare attention mechanisms across tasks. Our experiment measures transfer.',
      keywords: ['attention', 'machine learning', 'transfer'],
    });
  });

  it('recognizes Chinese abstract and keyword labels and retains DOI balanced parentheses', async () => {
    mockPdf([[
      '教育认知过程研究',
      '期刊：认知科学研究',
      '发表年份：2023',
      '摘 要：研究学习者的认知过程。',
      '分析学习策略与记忆之间的关系。',
      '关键词：认知；教育；记忆',
      '1 引言',
      'doi:10.1234/example(2023).',
    ]]);
    expect((await extractPdf(pdfBytes)).metadata).toMatchObject({
      journal: '认知科学研究',
      year: '2023',
      doi: '10.1234/example(2023)',
      abstract: '研究学习者的认知过程。 分析学习策略与记忆之间的关系。',
      keywords: ['认知', '教育', '记忆'],
    });
  });

  it('does not mistake PDF creation dates or reference citations for publication years', async () => {
    mockPdf([['A study without publication information', 'Previous work (1998) informed our design.']], {
      CreationDate: 'D:20260615120000Z',
      ModDate: 'D:20261001120000Z',
    });
    expect((await extractPdf(pdfBytes)).metadata).toMatchObject({ year: '', journal: '', doi: '', abstract: '', indexingStatus: '未知' });
  });

  it('handles a separate keyword heading and stops a Chinese abstract at the introduction', async () => {
    mockPdf([['学习策略研究', '摘要', '这是摘要。', '1 引言', '这是正文。', 'Keywords', 'learning; cognition']]);
    expect((await extractPdf(pdfBytes)).metadata).toMatchObject({
      abstract: '这是摘要。',
      keywords: ['learning', 'cognition'],
    });
  });

  it('retains empty scanned pages and does not transfer the caller-owned bytes to PDF.js', async () => {
    const { task } = mockPdf([[], ['A later text page']]);
    const input = new Uint8Array(pdfBytes);
    const result = await extractPdf(input, { password: 'document-password' });
    const options = vi.mocked(getDocument).mock.calls[0][0] as { data: Uint8Array; password: string };
    expect(options.password).toBe('document-password');
    expect(options.data).not.toBe(input);
    options.data.fill(0);
    expect(input).toEqual(pdfBytes);
    expect(result.pages).toEqual([{ page: 1, text: '' }, { page: 2, text: 'A later text page' }]);
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it.each([1, 2])('reports password error code %s and destroys the failed loading task', async (code) => {
    const error = Object.assign(new Error('password error'), { name: 'PasswordException', code });
    const task = { promise: Promise.reject(error), destroy: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(getDocument).mockReturnValue(task as unknown as ReturnType<typeof getDocument>);

    await expect(extractPdf(pdfBytes)).rejects.toMatchObject({ name: 'PasswordException', code });
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it('does not begin loading an already-aborted import', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractPdf(pdfBytes, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('cancels while the PDF worker is still loading the document', async () => {
    const controller = new AbortController();
    const task = { promise: new Promise(() => undefined), destroy: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(getDocument).mockReturnValue(task as unknown as ReturnType<typeof getDocument>);
    const extraction = extractPdf(pdfBytes, { signal: controller.signal });
    controller.abort();
    await expect(extraction).rejects.toMatchObject({ name: 'AbortError' });
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it('interrupts an in-flight page extraction and frees the page and loading task', async () => {
    const controller = new AbortController();
    const { pages, task } = mockPdf([['pending']]);
    let startPage: () => void = () => undefined;
    const pageStarted = new Promise<void>((resolve) => { startPage = resolve; });
    pages[0].getTextContent.mockImplementation(() => {
      startPage();
      return new Promise(() => undefined);
    });
    const extraction = extractPdf(pdfBytes, { signal: controller.signal });
    await pageStarted;
    controller.abort();

    await expect(extraction).rejects.toMatchObject({ name: 'AbortError' });
    expect(pages[0].cleanup).toHaveBeenCalledOnce();
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it('preserves the extraction error when resource teardown also fails', async () => {
    const { pages, task } = mockPdf([['failed page']]);
    const error = new Error('damaged content stream');
    pages[0].getTextContent.mockRejectedValueOnce(error);
    task.destroy.mockRejectedValueOnce(new Error('worker already closed'));

    await expect(extractPdf(pdfBytes)).rejects.toBe(error);
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it('extracts metadata and searchable text from an actual minimal PDF with the installed PDF.js', async () => {
    const actual = await vi.importActual<typeof import('pdfjs-dist')>('pdfjs-dist');
    actual.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/build/pdf.worker.js');
    vi.mocked(getDocument).mockImplementation(actual.getDocument);

    const result = await extractPdf(minimalPdf());

    expect(result.metadata).toMatchObject({ title: 'A real PDF fixture', authors: ['Ada Researcher'] });
    expect(result.pageCount).toBe(1);
    expect(result.pages[0].text).toContain('Searchable cognition evidence');
  });
});

function minimalPdf(): Uint8Array {
  const stream = 'BT /F1 12 Tf 72 700 Td (Searchable cognition evidence) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Title (A real PDF fixture) /Author (Ada Researcher) >>',
  ];
  let content = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = content.length;
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = content.length;
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(content);
}
