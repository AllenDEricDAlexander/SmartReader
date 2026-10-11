import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { emptyMetadata, type IndexedPage, type PaperMetadata } from './libraryModels';

export type PdfExtraction = {
  metadata: PaperMetadata;
  pages: IndexedPage[];
  pageCount: number;
};

export async function extractPdf(
  bytes: Uint8Array,
  options: { password?: string; signal?: AbortSignal } = {},
): Promise<PdfExtraction> {
  const { signal, password } = options;
  if (signal?.aborted) {
    throw abortError();
  }
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  }

  // PDF.js transfers its input buffer to the worker; the library still owns its copy.
  const task = getDocument({ data: bytes.slice(), password, isEvalSupported: false });
  let destruction: Promise<void> | undefined;
  const destroy = () => (destruction ??= task.destroy());
  let rejectAborted: (error: Error) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
  const onAbort = () => {
    rejectAborted(abortError());
    // Teardown starts immediately; finally observes the same promise and preserves
    // the primary extraction error if worker teardown fails as well.
    void destroy().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
  }

  let failed = false;
  try {
    const doc = await Promise.race([task.promise, aborted]);
    const embedded = await Promise.race([doc.getMetadata(), aborted]);
    const pages: IndexedPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await Promise.race([doc.getPage(pageNumber), aborted]);
      try {
        const content = await Promise.race([page.getTextContent(), aborted]);
        const text = content.items
          .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
          .join('')
          .replace(/\u0000/g, '')
          .replace(/[^\S\n]+/g, ' ')
          .replace(/ *\n */g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        pages.push({ page: pageNumber, text });
      } finally {
        page.cleanup();
      }
    }
    return { metadata: extractMetadata(embedded, pages), pages, pageCount: doc.numPages };
  } catch (error) {
    failed = true;
    if (signal?.aborted) {
      throw abortError();
    }
    if (isPasswordError(error)) {
      throw Object.assign(new Error(error.code === 2 ? 'PDF 密码错误，请重新输入。' : '此 PDF 需要密码才能建立索引。'), {
        name: 'PasswordException',
        code: error.code,
      });
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      await destroy();
    } catch (error) {
      if (!failed) {
        throw error;
      }
    }
  }
}

function abortError(): Error {
  return new DOMException('文档索引已取消。', 'AbortError');
}

function isPasswordError(error: unknown): error is { name: string; code: number } {
  return typeof error === 'object' && error !== null &&
    'name' in error && error.name === 'PasswordException' &&
    'code' in error && typeof error.code === 'number';
}

function extractMetadata(
  embedded: Awaited<ReturnType<PDFDocumentProxy['getMetadata']>>,
  pages: IndexedPage[],
): PaperMetadata {
  const info = embedded.info as Record<string, unknown>;
  // PDF.js exposes nonstandard Info dictionary entries under Custom, retaining
  // the producer's original field casing rather than promoting them to info.
  const customInfo = info.Custom && typeof info.Custom === 'object' && !Array.isArray(info.Custom)
    ? new Map(Object.entries(info.Custom).map(([key, value]) => [key.toLowerCase(), value]))
    : new Map<string, unknown>();
  const xmp = (key: string): unknown => embedded.metadata?.get(key);
  const openingText = pages.slice(0, 2).map((page) => page.text).join('\n');
  const metadata = emptyMetadata();
  metadata.title = cleanTitle(textValue(xmp('dc:title'))) || cleanTitle(textValue(info.Title)) || extractTitle(pages[0]?.text ?? '');
  metadata.authors = listValue(xmp('dc:creator'));
  if (metadata.authors.length === 0) {
    metadata.authors = listValue(info.Author);
  }
  metadata.journal = textValue(xmp('prism:publicationname')) || textValue(customInfo.get('journal')) || textValue(info.Journal) ||
    labelledLine(openingText, /(?:Journal|Publication|期刊|发表期刊)\s*[:：]\s*([^\n]+)/i);
  metadata.year = extractYear(textValue(xmp('prism:publicationdate')) || textValue(xmp('prism:coverdate')) || textValue(xmp('dc:date'))) ||
    explicitPublicationYear(customInfo.get('publicationyear')) || explicitPublicationYear(customInfo.get('publicationdate')) ||
    extractYear(labelledLine(openingText, /(?:Published(?:\s+online)?|Publication\s+date|发表年份|发表时间|出版年份|出版时间)\s*[:：]?\s*([^\n]+)/i)) ||
    extractYear(openingText.match(/(?:©|Copyright(?:\s+\(c\))?)\s*((?:19|20)\d{2})/i)?.[1] ?? '');
  metadata.doi = extractDoi(textValue(xmp('prism:doi'))) || extractDoi(textValue(xmp('dc:identifier'))) ||
    extractDoi(textValue(customInfo.get('doi'))) || extractDoi(textValue(info.DOI)) || extractDoi(openingText);
  metadata.abstract = textValue(xmp('dc:description')) || extractAbstract(openingText);
  metadata.keywords = listValue(xmp('dc:subject'));
  if (metadata.keywords.length === 0) {
    metadata.keywords = listValue(xmp('pdf:keywords'));
  }
  if (metadata.keywords.length === 0) {
    metadata.keywords = listValue(info.Keywords);
  }
  if (metadata.keywords.length === 0) {
    metadata.keywords = listValue(labelledLine(openingText, /(?:Keywords?|Key\s+words|Index\s+terms|关\s*键\s*词)[^\S\n]*(?:[:：—–-]\s*|\n\s*)([^\n]+)/i));
  }
  metadata.researchTopics = subjectTopics(info.Subject);
  metadata.journalType = textValue(xmp('prism:aggregationtype'));
  return metadata;
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').join('; ').replace(/\s+/g, ' ').trim();
  }
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function listValue(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[;,；、\n]|\s+and\s+/i) : [];
  return [...new Set(values.map(textValue).filter(Boolean))];
}

function cleanTitle(value: string): string {
  return /^(?:untitled|unknown|document|microsoft word.*)$/i.test(value) ? '' : value;
}

function extractTitle(text: string): string {
  return text.split('\n').map((line) => line.trim()).find((line) =>
    line.length >= 6 && line.length <= 240 &&
    !/^(?:https?:|doi\b|abstract\b|keywords?\b|journal\b|published\b|copyright\b|©|\d|摘\s*要|关\s*键\s*词|期刊)/i.test(line),
  ) ?? '';
}

function labelledLine(text: string, label: RegExp): string {
  return textValue(text.match(new RegExp(`(?:^|\n)\\s*${label.source}`, label.flags))?.[1]);
}

function extractYear(text: string): string {
  return text.match(/\b((?:18|19|20)\d{2})\b/)?.[1] ?? '';
}

function explicitPublicationYear(value: unknown): string {
  const text = typeof value === 'number' && Number.isInteger(value) ? String(value) : textValue(value);
  return text.match(/^D:((?:18|19|20)\d{2})/)?.[1] ?? extractYear(text);
}

function subjectTopics(value: unknown): string[] {
  const subject = textValue(value);
  if (!subject || subject.length > 100 || /[.!?。！？]/.test(subject) ||
    /\babstract\b|摘\s*要|本文|本研究|结果表明|\bthis\s+(?:paper|study|research)\b|\bwe\s+(?:present|propose|investigate|study|show|compare|demonstrate|analy[sz]e)\b/i.test(subject)) {
    return [];
  }
  return listValue(subject);
}

function extractDoi(text: string): string {
  let doi = text.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0] ?? '';
  doi = doi.replace(/[.,;:]+$/, '');
  while (doi.endsWith(')') && (doi.match(/\)/g)?.length ?? 0) > (doi.match(/\(/g)?.length ?? 0)) {
    doi = doi.slice(0, -1);
  }
  return doi.replace(/[.,;:]+$/, '');
}

function extractAbstract(text: string): string {
  const heading = /(?:^|\n)\s*(?:abstract\b|摘\s*要)\s*[:：—–-]?\s*/i.exec(text);
  if (!heading) {
    return '';
  }
  const remaining = text.slice(heading.index + heading[0].length);
  const nextHeading = /\n\s*(?:(?:keywords?|key\s+words|index\s+terms|关\s*键\s*词)(?:\s*[:：—–-]|[^\S\n]*\n)|(?:\d+(?:\.\d+)*[.)]?\s*)?(?:introduction\b|background\b|引言(?=\s|$)|绪论(?=\s|$)))/i.exec(remaining);
  const paragraphEnd = remaining.indexOf('\n\n');
  const end = nextHeading?.index ?? (paragraphEnd >= 0 ? paragraphEnd : remaining.length);
  return remaining.slice(0, Math.min(end, 4000)).replace(/\s+/g, ' ').trim();
}
