import type { DocumentSession } from '../documents/documentModels';

type ReaderStatusBarProps = {
  activeSession: DocumentSession | null;
};

export function ReaderStatusBar({ activeSession }: ReaderStatusBarProps) {
  const sourceLabel =
    activeSession?.source.kind === 'desktop-path' ? '本地文件' : activeSession ? '浏览器文件' : '无文档';
  const pageLabel = activeSession
    ? `第 ${activeSession.page}${activeSession.totalPages ? ` / ${activeSession.totalPages}` : ''} 页`
    : '—';
  const zoomLabel = `${Math.round((activeSession?.zoom ?? 1) * 100)}%`;
  const progressLabel = activeSession ? `进度 ${Math.round(activeSession.progress * 100)}%` : '—';

  return (
    <footer className="reader-status-bar" aria-label="阅读状态">
      <span className="status-pill">{sourceLabel}</span>
      <span>{progressLabel}</span>
      <span>{pageLabel}</span>
      <span>{zoomLabel}</span>
      {activeSession?.source.kind === 'desktop-path' ? (
        <span className="status-ok">阅读进度已自动保存</span>
      ) : activeSession ? (
        <span>浏览器打开不跨重启恢复</span>
      ) : null}
      <span className="shortcut-hint">⌘/Ctrl+F 搜索 · ⌘/Ctrl+D 书签 · 选中文本可添加高亮</span>
    </footer>
  );
}
