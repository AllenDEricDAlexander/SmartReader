import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LibraryDialog } from '../library/LibraryDialog';
import type { ViewerOutlineItem } from '../viewer/viewerTypes';

type PdfOutlineDrawerProps = {
  open: boolean;
  documentTitle: string;
  items?: ViewerOutlineItem[];
  error?: string;
  currentPage: number;
  onJumpToPage(page: number): void;
  onClose(): void;
};

function branchIds(items: ViewerOutlineItem[]): string[] {
  return items.flatMap((item) => item.children.length > 0 ? [item.id, ...branchIds(item.children)] : []);
}

export function PdfOutlineDrawer({ open, documentTitle, items, error, currentPage, onJumpToPage, onClose }: PdfOutlineDrawerProps) {
  const [expanded, setExpanded] = useState(() => new Set(items?.filter((item) => item.children.length > 0).map((item) => item.id)));
  useEffect(() => {
    setExpanded(new Set(items?.filter((item) => item.children.length > 0).map((item) => item.id)));
  }, [items]);
  const setBranches = (branches: ViewerOutlineItem[], expand: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      for (const id of branchIds(branches)) {
        if (expand) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  const toggleBranch = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  if (!open) return null;
  const hasBranches = Boolean(items?.some((item) => item.children.length > 0)) && !error;
  return <LibraryDialog title="PDF 目录" drawer onClose={onClose}>
    <p className="library-dialog-description">{documentTitle}</p>
    <section className="pdf-outline-panel" aria-label="目录内容">
      <div className="pdf-outline-actions" role="group" aria-label="目录展开控制">
        <button type="button" disabled={!hasBranches} onClick={() => setBranches(items ?? [], true)}><ChevronsDown size={14} />全部展开</button>
        <button type="button" disabled={!hasBranches} onClick={() => setBranches(items ?? [], false)}><ChevronsUp size={14} />全部折叠</button>
      </div>
      {error ? <p role="alert">{error}</p>
        : !items ? <p role="status">正在读取目录…</p>
        : items.length === 0 ? <p className="muted-copy">此 PDF 没有内置目录。</p>
        : <nav aria-label="章节导航"><ul className="pdf-outline-list">
          {items.map((item) => <OutlineItem key={item.id} item={item} currentPage={currentPage} onJumpToPage={onJumpToPage}
            expanded={expanded} onToggle={toggleBranch} onSetBranches={setBranches} />)}
        </ul></nav>}
    </section>
  </LibraryDialog>;
}

function OutlineItem({ item, currentPage, onJumpToPage, expanded, onToggle, onSetBranches }: {
  item: ViewerOutlineItem;
  currentPage: number;
  onJumpToPage(page: number): void;
  expanded: ReadonlySet<string>;
  onToggle(id: string): void;
  onSetBranches(items: ViewerOutlineItem[], expand: boolean): void;
}) {
  const isExpanded = expanded.has(item.id);
  const hasChildren = item.children.length > 0;
  return <li>
    <div className="pdf-outline-row">
      {hasChildren ? <button type="button" className="pdf-outline-toggle"
        aria-label={`${isExpanded ? '收起' : '展开'} ${item.title}`} aria-expanded={isExpanded}
        onClick={() => onToggle(item.id)}>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button> : <span className="pdf-outline-spacer" />}
      <button type="button" className="pdf-outline-target" disabled={item.page === null}
        aria-label={item.page === null ? item.title : `${item.title}，第 ${item.page} 页`}
        aria-current={item.page === currentPage ? 'page' : undefined}
        title={item.page === null ? '此目录项没有文档内目标页' : `${item.title} · 第 ${item.page} 页`}
        onClick={() => { if (item.page !== null) onJumpToPage(item.page); }}>
        <span>{item.title}</span>{item.page !== null ? <small>{item.page}</small> : null}
      </button>
      {hasChildren ? <span className="pdf-outline-branch-actions">
        <button type="button" aria-label={`全部展开 ${item.title} 的子目录`} title="展开全部子目录" onClick={() => onSetBranches([item], true)}><ChevronsDown size={13} /></button>
        <button type="button" aria-label={`全部折叠 ${item.title} 的子目录`} title="折叠全部子目录" onClick={() => onSetBranches([item], false)}><ChevronsUp size={13} /></button>
      </span> : null}
    </div>
    {hasChildren && isExpanded ? <ul className="pdf-outline-list pdf-outline-children">
      {item.children.map((child) => <OutlineItem key={child.id} item={child} currentPage={currentPage} onJumpToPage={onJumpToPage}
        expanded={expanded} onToggle={onToggle} onSetBranches={onSetBranches} />)}
    </ul> : null}
  </li>;
}
