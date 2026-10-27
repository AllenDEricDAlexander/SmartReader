import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { Paper } from './libraryModels';

export type NotesPdfDocument = Pick<Paper, 'fileName' | 'metadata' | 'annotations' | 'bookmarks'> & {
  tagNames?: Record<number, string>;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BODY_COLOR = rgb(0.13, 0.16, 0.21);
const MUTED_COLOR = rgb(0.35, 0.39, 0.45);
const ACCENT_COLOR = rgb(0.15, 0.32, 0.56);

// Keep supported text selectable and rasterize only unsupported character runs.
type FallbackGlyph = { width: number; height: number; descent: number; image: Uint8Array };
type Glyph = { text: string; width: number; fallback: boolean };
type TextStyle = { size: number; leading: number; color: RGB; indent?: number; after?: number };

function rasterizeGlyph(text: string, size: number): FallbackGlyph {
  const scale = 3;
  const canvas = document.createElement('canvas');
  let context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境无法显示笔记中的部分字符，无法导出 PDF。');
  context.font = `${size}px sans-serif`;
  const advance = Math.max(context.measureText(text).width, size * 0.3);
  const padding = size * 0.1;
  const height = size * 1.7;
  const descent = size * 0.4;
  canvas.width = Math.ceil((advance + padding * 2) * scale);
  canvas.height = Math.ceil(height * scale);
  context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境无法显示笔记中的部分字符，无法导出 PDF。');
  context.scale(scale, scale);
  context.font = `${size}px sans-serif`;
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#222935';
  context.fillText(text, padding, height - descent);
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  const binary = atob(base64);
  return { width: advance + padding * 2, height, descent, image: Uint8Array.from(binary, (char) => char.charCodeAt(0)) };
}

function graphemes(text: string): string[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => {
    segment(value: string): Iterable<{ segment: string }>;
  } }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (item) => item.segment) : Array.from(text);
}

class NotesPdfWriter {
  private page: PDFPage;
  private y = PAGE_HEIGHT - MARGIN;
  private readonly characters: Set<number>;
  private readonly glyphs = new Map<string, Glyph>();
  private fallbackContext: CanvasRenderingContext2D | null = null;
  private renderedLines = 0;

  constructor(private readonly document: PDFDocument, private readonly font: PDFFont, private readonly signal?: AbortSignal) {
    this.page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.characters = new Set(font.getCharacterSet());
  }

  private ensure(height: number) {
    if (this.y - height >= MARGIN) return;
    this.page = this.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private glyph(text: string, size: number): Glyph {
    const key = `${size}:${text}`;
    const cached = this.glyphs.get(key);
    if (cached) return cached;
    const supported = Array.from(text).every((char) => this.characters.has(char.codePointAt(0)!));
    if (!supported && !this.fallbackContext) this.fallbackContext = document.createElement('canvas').getContext('2d');
    if (!supported && !this.fallbackContext) throw new Error('当前环境无法显示笔记中的部分字符，无法导出 PDF。');
    if (!supported) this.fallbackContext!.font = `${size}px sans-serif`;
    const width = supported ? this.font.widthOfTextAtSize(text, size)
      : Math.max(this.fallbackContext!.measureText(text).width, size * 0.3) + size * 0.2;
    const result = { text, width, fallback: !supported };
    this.glyphs.set(key, result);
    return result;
  }

  async text(value: string, style: TextStyle): Promise<void> {
    const indent = style.indent ?? 0;
    const maxWidth = CONTENT_WIDTH - indent;
    const paragraphs = value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    for (const paragraph of paragraphs) {
      this.signal?.throwIfAborted();
      const units = graphemes(paragraph).map((char) => this.glyph(char, style.size));
      let start = 0;
      do {
        if (++this.renderedLines % 32 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        this.signal?.throwIfAborted();
        let end = start;
        let width = 0;
        let lastSpace = -1;
        while (end < units.length && (width + units[end].width <= maxWidth || end === start)) {
          width += units[end].width;
          if (/\s/u.test(units[end].text)) lastSpace = end;
          end++;
        }
        if (end < units.length && lastSpace >= start && lastSpace + 1 < end) end = lastSpace + 1;
        this.ensure(style.leading);
        const baseline = this.y - style.size;
        const line = units.slice(start, end);
        const text = line.map((unit) => unit.text).join('');
        if (!line.some((unit) => unit.fallback) && text) {
          this.page.drawText(text, { x: MARGIN + indent, y: baseline, size: style.size, font: this.font, color: style.color });
        } else if (text) {
          let x = MARGIN + indent;
          for (let index = 0; index < line.length;) {
            let end = index;
            let runWidth = 0;
            while (end < line.length && (line[end].fallback === line[index].fallback
              || (line[index].fallback && /^[\s\p{P}]+$/u.test(line[end].text) && line[end + 1]?.fallback))) {
              runWidth += line[end].width;
              end++;
            }
            const run = line.slice(index, end).map((unit) => unit.text).join('');
            if (line[index].fallback) {
              const fallback = rasterizeGlyph(run, style.size);
              const image = await this.document.embedPng(fallback.image);
              this.page.drawImage(image, { x, y: baseline - fallback.descent, width: Math.min(fallback.width, runWidth), height: fallback.height });
            } else {
              this.page.drawText(run, { x, y: baseline, size: style.size, font: this.font, color: style.color });
            }
            x += runWidth;
            index = end;
          }
        }
        this.y -= style.leading;
        start = end;
      } while (start < units.length);
    }
    this.y -= style.after ?? 0;
  }

  space(height: number) { this.y -= height; }
  keep(height: number) { this.ensure(height); }

  addFooters() {
    const pages = this.document.getPages();
    pages.forEach((page, index) => {
      const text = `${index + 1} / ${pages.length}`;
      page.drawText(text, { x: PAGE_WIDTH - MARGIN - this.font.widthOfTextAtSize(text, 9), y: 25, size: 9, font: this.font, color: MUTED_COLOR });
    });
  }
}

/** Generate a notes report without modifying or requiring the source PDFs. */
export async function createNotesPdf(papers: NotesPdfDocument[], fontBytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  if (!papers.length) throw new Error('请先选择要导出的文献。');
  signal?.throwIfAborted();
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  // The fontkit subset for this CJK font loses glyph outlines in PDF renderers.
  const font = await document.embedFont(fontBytes);
  document.setTitle('SmartReader 文献笔记');
  document.setCreator('SmartReader');
  const writer = new NotesPdfWriter(document, font, signal);
  await writer.text('文献笔记', { size: 22, leading: 31, color: ACCENT_COLOR, after: 4 });
  await writer.text(`共 ${papers.length} 篇文献 · 笔记、批注与书签`, { size: 10, leading: 16, color: MUTED_COLOR, after: 12 });

  let entryCount = 0;
  for (const [index, paper] of papers.entries()) {
    signal?.throwIfAborted();
    writer.keep(68);
    await writer.text(`${index + 1}. ${paper.metadata.title || paper.fileName}`, { size: 15, leading: 23, color: ACCENT_COLOR, after: 2 });
    const metadata = [paper.metadata.authors.join('、'), paper.metadata.year, paper.metadata.journal, paper.metadata.doi && `DOI: ${paper.metadata.doi}`].filter(Boolean).join(' · ');
    if (metadata) await writer.text(metadata, { size: 10, leading: 15, color: MUTED_COLOR, after: 4 });

    const entries = [
      ...paper.annotations.map((annotation) => ({ page: annotation.page, createdAt: annotation.createdAt, annotation })),
      ...paper.bookmarks.map((bookmark) => ({ page: bookmark.page, createdAt: bookmark.createdAt, bookmark })),
    ].sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
    if (!entries.length) await writer.text('暂无笔记、批注或书签。', { size: 11, leading: 17, color: MUTED_COLOR });
    for (const entry of entries) {
      if (++entryCount % 16 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      writer.keep(45);
      if ('annotation' in entry && entry.annotation) {
        const annotation = entry.annotation;
        const label = { note: '笔记', highlight: '高亮', underline: '划线' }[annotation.type];
        await writer.text(`第 ${entry.page} 页 · ${label}`, { size: 11, leading: 18, color: ACCENT_COLOR });
        const tags = (annotation.tagIds ?? []).map((id) => paper.tagNames?.[id] ?? `#${id}`);
        const details = [annotation.color && `颜色：${annotation.color}`, annotation.createdAt && `创建：${annotation.createdAt}`,
          annotation.updatedAt && `更新：${annotation.updatedAt}`,
          tags.length ? `标签：${tags.join('、')}` : ''].filter(Boolean).join(' · ');
        if (details) await writer.text(details, { size: 9, leading: 15, color: MUTED_COLOR, indent: 12 });
        if (annotation.quote) await writer.text(`摘录：${annotation.quote}`, { size: 11, leading: 18, color: BODY_COLOR, indent: 12 });
        if (annotation.text) await writer.text(`笔记：${annotation.text}`, { size: 11, leading: 18, color: BODY_COLOR, indent: 12 });
        if (annotation.areas?.length) {
          const areas = annotation.areas.map((area) => `第 ${area.pageIndex + 1} 页，距左 ${area.left}%、距上 ${area.top}%、宽 ${area.width}%、高 ${area.height}%`).join('；');
          await writer.text(`标注位置：${areas}`, { size: 9, leading: 15, color: MUTED_COLOR, indent: 12 });
        }
        if (!annotation.quote && !annotation.text) await writer.text('（无文字内容）', { size: 11, leading: 18, color: MUTED_COLOR, indent: 12 });
      } else if ('bookmark' in entry && entry.bookmark) {
        await writer.text(`第 ${entry.page} 页 · 书签：${entry.bookmark.title}`, { size: 11, leading: 18, color: ACCENT_COLOR });
        if (entry.bookmark.note) await writer.text(`备注：${entry.bookmark.note}`, { size: 11, leading: 18, color: BODY_COLOR, indent: 12 });
        const details = [entry.bookmark.createdAt && `创建：${entry.bookmark.createdAt}`,
          entry.bookmark.updatedAt && `更新：${entry.bookmark.updatedAt}`].filter(Boolean).join(' · ');
        if (details) await writer.text(details, { size: 9, leading: 15, color: MUTED_COLOR, indent: 12 });
      }
      writer.space(7);
    }
    writer.space(14);
  }
  signal?.throwIfAborted();
  writer.addFooters();
  return document.save();
}
