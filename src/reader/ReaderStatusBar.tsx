import type { DocumentSession } from '../documents/documentModels';

type ReaderStatusBarProps = {
  activeSession: DocumentSession | null;
};

export function ReaderStatusBar({ activeSession }: ReaderStatusBarProps) {
  return (
    <footer className="reader-status-bar" aria-label="阅读状态">
      <span>{activeSession?.source.kind === 'desktop-path' ? '本地文件' : '浏览器文件'}</span>
      <span>进度已保存</span>
      <span>
        Page {activeSession?.page ?? 0}
        {activeSession?.totalPages ? ` / ${activeSession.totalPages}` : ''}
      </span>
      <span>{Math.round((activeSession?.zoom ?? 1) * 100)}%</span>
      <span className="shortcut-hint">Cmd/Ctrl + F 搜索 · Cmd/Ctrl + D 书签</span>
    </footer>
  );
}
