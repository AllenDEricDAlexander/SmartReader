import type { OutlineItem, ReaderLocation } from "../types/reader";

interface PdfOutlineItemLike {
  title?: string;
  dest?: unknown;
  items?: PdfOutlineItemLike[];
}

interface PdfDocumentLike {
  getOutline: () => Promise<PdfOutlineItemLike[] | null>;
  getDestination: (name: string) => Promise<unknown[] | null>;
  getPageIndex: (ref: any) => Promise<number>;
}

export async function outlineFromPdf(pdf: PdfDocumentLike): Promise<OutlineItem[]> {
  const outline = await pdf.getOutline();

  if (!outline) {
    return [];
  }

  const resolved = await resolveOutlineItems(pdf, outline, 0, []);
  return resolved.slice(0, 80);
}

async function resolveOutlineItems(
  pdf: PdfDocumentLike,
  items: PdfOutlineItemLike[],
  level: number,
  path: number[]
): Promise<OutlineItem[]> {
  const resolved: OutlineItem[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemPath = [...path, index];
    const location = await resolveOutlineLocation(pdf, item.dest);

    if (item.title && location) {
      resolved.push({
        id: `outline-${itemPath.join("-")}`,
        title: item.title,
        location,
        level
      });
    }

    if (item.items?.length) {
      resolved.push(...(await resolveOutlineItems(pdf, item.items, level + 1, itemPath)));
    }
  }

  return resolved;
}

async function resolveOutlineLocation(
  pdf: PdfDocumentLike,
  destination: unknown
): Promise<ReaderLocation | undefined> {
  try {
    const explicitDestination =
      typeof destination === "string" ? await pdf.getDestination(destination) : destination;

    if (!Array.isArray(explicitDestination) || explicitDestination.length === 0) {
      return undefined;
    }

    const pageReference = explicitDestination[0];
    const pageIndex =
      typeof pageReference === "number" ? pageReference : await pdf.getPageIndex(pageReference);

    return {
      kind: "page",
      page: pageIndex + 1
    };
  } catch {
    return undefined;
  }
}
