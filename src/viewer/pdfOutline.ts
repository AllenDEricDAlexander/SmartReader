import type { ViewerOutlineItem } from './viewerTypes';

type PdfOutline = {
  title: string;
  dest?: string | readonly unknown[] | null;
  items?: PdfOutline[] | null;
};

export type PdfOutlineDocument = {
  numPages: number;
  getOutline?(): Promise<PdfOutline[] | null>;
  getDestination?(name: string): Promise<readonly unknown[] | null>;
  getPageIndex?(ref: { num: number; gen: number }): Promise<number>;
};

export async function loadPdfOutline(doc: PdfOutlineDocument): Promise<ViewerOutlineItem[]> {
  const raw = await doc.getOutline?.();
  const pending: { source: PdfOutline; item: ViewerOutlineItem }[] = [];
  const named = new Map<string, Promise<readonly unknown[] | null>>();
  const references = new Map<string, Promise<number>>();
  const mapItems = (items: PdfOutline[], prefix = ''): ViewerOutlineItem[] => items.map((source, index) => {
    const id = `${prefix}${index}`;
    const item: ViewerOutlineItem = {
      id, title: source.title.trim() || '未命名章节', page: null,
      children: mapItems(source.items ?? [], `${id}.`),
    };
    pending.push({ source, item });
    return item;
  });
  const outline = mapItems(raw ?? []);
  const resolvePage = async (source: PdfOutline): Promise<number | null> => {
    try {
      let destination = source.dest;
      if (typeof destination === 'string') {
        if (!doc.getDestination) return null;
        if (!named.has(destination)) named.set(destination, doc.getDestination(destination));
        destination = await named.get(destination)!;
      }
      const target = destination?.[0];
      let index: number;
      if (typeof target === 'number') {
        index = target;
      } else if (target && typeof target === 'object' && 'num' in target && 'gen' in target
        && Number.isInteger(target.num) && Number.isInteger(target.gen)
        && typeof target.num === 'number' && typeof target.gen === 'number' && doc.getPageIndex) {
        const key = `${target.num}:${target.gen}`;
        if (!references.has(key)) references.set(key, doc.getPageIndex({ num: target.num, gen: target.gen }));
        index = await references.get(key)!;
      } else {
        return null;
      }
      return Number.isInteger(index) && index >= 0 && index < doc.numPages ? index + 1 : null;
    } catch {
      // Keep the chapter and its children visible even if its target is broken.
      return null;
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (next < pending.length) {
      const { source, item } = pending[next++];
      item.page = await resolvePage(source);
    }
  }));
  return outline;
}
