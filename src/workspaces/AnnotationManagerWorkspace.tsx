import { Highlighter, X } from 'lucide-react';
import type { PersistedAnnotationRecord } from '../persistence/persistenceApi';

type AnnotationManagerWorkspaceProps = {
  annotations: PersistedAnnotationRecord[];
  canOpenAnnotation(annotation: PersistedAnnotationRecord): boolean;
  onClose(): void;
  onOpenAnnotation(annotation: PersistedAnnotationRecord): void;
};

export function AnnotationManagerWorkspace({
  annotations,
  canOpenAnnotation,
  onClose,
  onOpenAnnotation,
}: AnnotationManagerWorkspaceProps) {
  return (
    <section className="tool-workspace" aria-label="批注管理工作区">
      <header className="workspace-header">
        <div>
          <p>Annotations</p>
          <h1>批注管理</h1>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tool-workspace-content">
        <section className="tool-panel">
          <div className="panel-title">
            <Highlighter size={18} />
            <h2>全部批注</h2>
          </div>
          {annotations.length > 0 ? (
            <div className="workspace-list">
              {annotations.map((annotation) => {
                const canOpen = canOpenAnnotation(annotation);

                return (
                  <button
                    key={annotation.id ?? `${annotation.documentKey}:${annotation.page}`}
                    type="button"
                    className="workspace-list-row"
                    disabled={!canOpen}
                    onClick={() => onOpenAnnotation(annotation)}
                  >
                    <strong>{annotation.text || annotation.quote || '未命名批注'}</strong>
                    <span>
                      {annotation.documentDisplayName ?? annotation.documentKey} · 第{' '}
                      {annotation.page} 页
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted-copy">暂无批注。阅读 PDF 时新增批注后会显示在这里。</p>
          )}
        </section>
      </div>
    </section>
  );
}
