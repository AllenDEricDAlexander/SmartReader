import { Download, Highlighter, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NotesExportSource } from '../library/exportPaperNotes';
import { BookList } from '../components/book-list/BookList';
import type { PersistedAnnotationRecord } from '../persistence/persistenceApi';
import './noteExport.css';

type AnnotationManagerWorkspaceProps = {
  title?: string;
  annotations: PersistedAnnotationRecord[];
  error: string | null;
  canOpenAnnotation(annotation: PersistedAnnotationRecord): boolean;
  onClose(): void;
  onOpenAnnotation(annotation: PersistedAnnotationRecord): void;
  exportSources?: NotesExportSource[];
  exportSourcesError?: string | null;
  onExportNotes?(sources: NotesExportSource[]): Promise<boolean>;
};

export function AnnotationManagerWorkspace({
  title = '批注管理',
  annotations,
  error,
  canOpenAnnotation,
  onClose,
  onOpenAnnotation,
  exportSources,
  exportSourcesError,
  onExportNotes,
}: AnnotationManagerWorkspaceProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => {
    if (!exportSources) return;
    const available = new Set(exportSources.map((source) => source.documentKey));
    setSelected((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [exportSources]);

  const exportSelected = async () => {
    if (!onExportNotes || !exportSources || exporting) return;
    setExporting(true);
    setExportMessage(null);
    setExportError(null);
    try {
      if (await onExportNotes(exportSources.filter((source) => selected.has(source.documentKey)))) {
        setExportMessage('笔记 PDF 已导出。导出文件未加密，请妥善保存。');
      }
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : '导出失败，请重试。');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="tool-workspace" aria-label={`${title}工作区`}>
      <header className="workspace-header">
        <div>
          <p>Annotations</p>
          <h1>{title}</h1>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tool-workspace-content">
        {exportSources && onExportNotes ? (
          <section className="tool-panel notes-export-panel" aria-label="按文献导出笔记">
            <div className="panel-title"><Download size={18} /><h2>按文献导出笔记</h2></div>
            <p className="muted-copy">选择一篇或多篇文献，导出笔记、摘录和书签备注；PDF 不包含原文页面。加密文献需先解锁，导出文件不加密；请选择不存在的新文件名。</p>
            {exportSourcesError ? <p role="alert">{exportSourcesError}</p> : null}
            {exportSources.length ? <div className="notes-export-list"><BookList compact showHeader={false} label="选择导出文献"
              items={exportSources.map((source) => ({ key: source.documentKey, name: source.displayName, source,
                subtitle: source.detail !== source.displayName ? source.detail : null }))}
              columns={['selection', 'name']}
              selection={{ selectedKeys: selected, nameSelects: true, itemLabel: (item) => `选择导出 ${item.name}`, isDisabled: () => exporting,
                onChange: (item, checked) => setSelected((current) => {
                  const next = new Set(current); if (checked) next.add(item.key); else next.delete(item.key); return next;
                }) }} />
            </div> : <p className="muted-copy">暂无可导出的文献。</p>}
            <button type="button" disabled={!selected.size || exporting} onClick={() => void exportSelected()}><Download size={14} />{exporting ? '正在导出…' : `导出笔记 PDF（${selected.size}）`}</button>
            {exportMessage ? <p role="status">{exportMessage}</p> : null}
            {exportError ? <p role="alert">{exportError}</p> : null}
          </section>
        ) : null}
        <section className="tool-panel">
          <div className="panel-title">
            <Highlighter size={18} />
            <h2>{title === '笔记管理' ? '全部笔记' : '全部批注'}</h2>
          </div>
          {error ? (
            <p className="muted-copy" role="status">
              {error}
            </p>
          ) : annotations.length > 0 ? (
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
