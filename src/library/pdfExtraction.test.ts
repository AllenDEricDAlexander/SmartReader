import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
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

  it('keeps short PDF subjects as research topics without promoting XMP keywords into disciplines', async () => {
    mockPdf([['Body text']], { Subject: '认知神经；注意力' }, { 'dc:subject': ['fMRI', 'experiment'] });
    expect((await extractPdf(pdfBytes)).metadata).toMatchObject({
      researchTopics: ['认知神经', '注意力'],
      keywords: ['fMRI', 'experiment'],
      researchFields: [],
      disciplines: [],
    });
  });

  it.each([
    'Abstract: We compare the performance of learning mechanisms.',
    '摘 要：本文比较不同学习机制的表现。',
    'This study investigates how cognitive control influences learning',
    'An experiment was conducted. The results support the proposed mechanism.',
    'A'.repeat(101),
  ])('does not turn an abstract-like or long Subject into a research topic: %s', async (subject) => {
    mockPdf([['Body text']], { Subject: subject });
    expect((await extractPdf(pdfBytes)).metadata.researchTopics).toEqual([]);
  });

  it('accepts a topic phrase at the 100-character boundary and prefers XMP over Custom facts', async () => {
    mockPdf([['Body text']], {
      Subject: 'A'.repeat(100),
      Custom: { DOI: '10.1234/custom', Journal: 'Custom journal', PublicationYear: 2020 },
    }, { 'prism:doi': '10.1234/xmp', 'prism:publicationname': 'XMP journal', 'prism:publicationdate': '2025-01-01' });
    expect((await extractPdf(pdfBytes)).metadata).toMatchObject({
      researchTopics: ['A'.repeat(100)], doi: '10.1234/xmp', journal: 'XMP journal', year: '2025',
    });
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
    expect(options).toMatchObject({ cMapUrl: '/cmaps/', cMapPacked: true, standardFontDataUrl: '/standard_fonts/', isEvalSupported: false });
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
    await useInstalledPdfJs();

    const result = await extractPdf(minimalPdf());

    expect(result.metadata).toMatchObject({ title: 'A real PDF fixture', authors: ['Ada Researcher'] });
    expect(result.pageCount).toBe(1);
    expect(result.pages[0].text).toContain('Searchable cognition evidence');
  });

  it.each([
    ['/PublicationYear 2024', '2024'],
    ['/pUbLiCaTiOnDaTe (2023-09-12)', '2023'],
    ['/PublicationDate (D:20220912000000Z)', '2022'],
  ])('extracts real PDF.js Custom Info DOI/Journal and explicit publication year from %s', async (publicationInfo, year) => {
    const actual = await useInstalledPdfJs();
    const bytes = minimalPdf(`/dOi (10.1234/custom.2024) /jOuRnAl (Journal of Real Fixtures) ${publicationInfo} /CreationDate (D:20261011000000Z) /Subject (Cognitive neuroscience)`);
    const task = actual.getDocument({ data: bytes.slice(), isEvalSupported: false });
    try {
      const doc = await task.promise;
      const { info } = await doc.getMetadata();
      expect(info).toMatchObject({ Custom: { dOi: '10.1234/custom.2024', jOuRnAl: 'Journal of Real Fixtures' } });
      expect(info).not.toHaveProperty('dOi');
      expect(info).not.toHaveProperty('jOuRnAl');
    } finally {
      await task.destroy();
    }

    expect((await extractPdf(bytes)).metadata).toMatchObject({
      doi: '10.1234/custom.2024', journal: 'Journal of Real Fixtures', year,
      researchTopics: ['Cognitive neuroscience'], indexingStatus: '未知',
    });
  });

  it('extracts actual Chinese text using a predefined Type0 CMap without an embedded ToUnicode map', async () => {
    await useInstalledPdfJs();
    const result = await extractPdf(minimalPdf('', '海马体记忆巩固'));
    expect(result.pageCount).toBe(1);
    expect(result.pages[0].text).toContain('海马体记忆巩固');
  });
});

async function useInstalledPdfJs() {
  const actual = await vi.importActual<typeof import('pdfjs-dist')>('pdfjs-dist');
  actual.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/build/pdf.worker.js');
  vi.mocked(getDocument).mockImplementation((source) => {
    const options = source as DocumentInitParameters;
    // Node reads installed files directly; production URLs remain local webview assets.
    return actual.getDocument({
      ...options,
      cMapUrl: options.cMapUrl ? `${resolve('node_modules/pdfjs-dist', options.cMapUrl.slice(1))}/` : undefined,
      standardFontDataUrl: options.standardFontDataUrl ? `${resolve('node_modules/pdfjs-dist', options.standardFontDataUrl.slice(1))}/` : undefined,
    });
  });
  return actual;
}

function minimalPdf(extraInfo = '', chineseText?: string): Uint8Array {
  const text = chineseText ? `<${Array.from(chineseText).map((character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>` : '(Searchable cognition evidence)';
  const stream = `BT /F1 12 Tf 72 700 Td ${text} Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    chineseText
      ? '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [7 0 R] >>'
      : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Title (A real PDF fixture) /Author (Ada Researcher) ${extraInfo} >>`,
  ];
  if (chineseText) {
    objects.push(
      '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 8 0 R /DW 1000 >>',
      '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-250 -143 600 857] /ItalicAngle 0 /Ascent 857 /Descent -143 /CapHeight 857 /StemV 80 >>',
    );
  }
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
