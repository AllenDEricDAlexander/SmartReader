import { Columns2, X } from 'lucide-react';
import type { PersistedDocument } from '../persistence/persistenceApi';

type CompareWorkspaceProps = {
  recentDocuments: PersistedDocument[];
  onClose(): void;
  onOpenDocument(document: PersistedDocument): void | Promise<void>;
};

export function CompareWorkspace({
  recentDocuments,
  onClose,
  onOpenDocument,
}: CompareWorkspaceProps) {
  return (
    <section className="tool-workspace" aria-label="对比阅读工作区">
      <header className="workspace-header">
        <div>
          <p>Compare</p>
          <h1>对比阅读</h1>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tool-workspace-content two-column">
        <section className="tool-panel">
          <div className="panel-title">
            <Columns2 size={18} />
            <h2>选择第一份文档</h2>
          </div>
          <DocumentPickList documents={recentDocuments} onOpenDocument={onOpenDocument} />
        </section>
        <section className="tool-panel">
          <div className="panel-title">
            <Columns2 size={18} />
            <h2>选择第二份文档</h2>
          </div>
          <DocumentPickList documents={recentDocuments} onOpenDocument={onOpenDocument} />
        </section>
      </div>
    </section>
  );
}

function DocumentPickList({
  documents,
  onOpenDocument,
}: {
  documents: PersistedDocument[];
  onOpenDocument(document: PersistedDocument): void | Promise<void>;
}) {
  if (documents.length === 0) {
    return <p className="muted-copy">暂无最近文件。先打开 PDF 后可从这里选择。</p>;
  }

  return (
    <div className="workspace-list">
      {documents.slice(0, 8).map((document) => (
        <button
          key={document.documentKey}
          type="button"
          className="workspace-list-row"
          disabled={document.missing || !document.path}
          onClick={() => void onOpenDocument(document)}
        >
          <strong>{document.displayName}</strong>
          <span>{document.path ?? '浏览器选择的本地文件'}</span>
        </button>
      ))}
    </div>
  );
}
