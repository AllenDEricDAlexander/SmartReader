import { FileText, Layers3, Search, Tags } from 'lucide-react';
import type { DocumentSession } from '../documents/documentModels';

type ReaderRightPanelProps = {
  activeSession: DocumentSession | null;
  searchText: string;
  onSearchTextChange(value: string): void;
  onOpenSearch(): void;
  onSearch(): void;
};

export function ReaderRightPanel({
  activeSession,
  searchText,
  onSearchTextChange,
  onOpenSearch,
  onSearch,
}: ReaderRightPanelProps) {
  return (
    <aside className="reader-right-panel" aria-label="阅读检查器">
      <section className="panel-section">
        <div className="panel-title">
          <FileText size={16} />
          <h2>Document</h2>
        </div>
        {activeSession ? (
          <dl className="document-facts">
            <div>
              <dt>File</dt>
              <dd>{activeSession.title}</dd>
            </div>
            <div>
              <dt>Page</dt>
              <dd>
                {activeSession.page}
                {activeSession.totalPages ? ` / ${activeSession.totalPages}` : ''}
              </dd>
            </div>
            <div>
              <dt>Zoom</dt>
              <dd>{Math.round(activeSession.zoom * 100)}%</dd>
            </div>
          </dl>
        ) : (
          <p className="muted-copy">No active document</p>
        )}
      </section>
      <section className="panel-section">
        <div className="panel-title">
          <Search size={16} />
          <h3>Find</h3>
        </div>
        <input
          aria-label="Inspector search text"
          className="toolbar-input wide"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          onFocus={onOpenSearch}
        />
        <button type="button" onClick={onSearch}>
          Search document
        </button>
      </section>
      <section className="panel-section">
        <div className="panel-title">
          <Layers3 size={16} />
          <h3>Annotation detail</h3>
        </div>
        <button type="button" className="ghost-row" disabled aria-disabled="true">
          批注详情
        </button>
      </section>
      <section className="panel-section">
        <div className="panel-title">
          <Tags size={16} />
          <h3>Local actions</h3>
        </div>
        <button type="button" className="ghost-row" disabled aria-disabled="true">
          标签管理
        </button>
        <button type="button" className="ghost-row" disabled aria-disabled="true">
          文件位置
        </button>
      </section>
    </aside>
  );
}
