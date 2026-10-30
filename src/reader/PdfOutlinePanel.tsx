import { ChevronDown, ChevronRight, ListTree } from 'lucide-react';
import { useState } from 'react';
import type { ViewerOutlineItem } from '../viewer/viewerTypes';

type PdfOutlinePanelProps = {
  items?: ViewerOutlineItem[];
  error?: string;
  currentPage: number;
  onJumpToPage(page: number): void;
};

export function PdfOutlinePanel({ items, error, currentPage, onJumpToPage }: PdfOutlinePanelProps) {
  return (
    <section className="panel-section pdf-outline-panel" aria-label="PDF 目录">
      <div className="panel-title"><ListTree size={16} /><h3>目录</h3></div>
      {error ? <p role="alert">{error}</p>
        : !items ? <p role="status">正在读取目录…</p>
        : items.length === 0 ? <p className="muted-copy">此 PDF 没有内置目录。</p>
        : <nav aria-label="章节导航"><ul className="pdf-outline-list">
          {items.map((item) => <OutlineItem key={item.id} item={item} currentPage={currentPage} onJumpToPage={onJumpToPage} depth={0} />)}
        </ul></nav>}
    </section>
  );
}

function OutlineItem({ item, currentPage, onJumpToPage, depth }: {
  item: ViewerOutlineItem;
  currentPage: number;
  onJumpToPage(page: number): void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = item.children.length > 0;
  return <li>
    <div className="pdf-outline-row">
      {hasChildren ? <button type="button" className="pdf-outline-toggle"
        aria-label={`${expanded ? '收起' : '展开'} ${item.title}`} aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button> : <span className="pdf-outline-spacer" />}
      <button type="button" className="pdf-outline-target" disabled={item.page === null}
        aria-label={item.page === null ? item.title : `${item.title}，第 ${item.page} 页`}
        aria-current={item.page === currentPage ? 'page' : undefined}
        title={item.page === null ? '此目录项没有文档内目标页' : `${item.title} · 第 ${item.page} 页`}
        onClick={() => { if (item.page !== null) onJumpToPage(item.page); }}>
        <span>{item.title}</span>{item.page !== null ? <small>{item.page}</small> : null}
      </button>
    </div>
    {hasChildren && expanded ? <ul className="pdf-outline-list pdf-outline-children">
      {item.children.map((child) => <OutlineItem key={child.id} item={child} currentPage={currentPage} onJumpToPage={onJumpToPage} depth={depth + 1} />)}
    </ul> : null}
  </li>;
}
