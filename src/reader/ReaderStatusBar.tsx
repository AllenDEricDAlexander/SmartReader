import type { DocumentSession } from '../documents/documentModels';
import type { ViewerActions } from '../viewer/viewerController';
import { ViewControls } from '../viewer/ViewControls';

type ReaderStatusBarProps = {
  activeSession: DocumentSession | null;
  controller: ViewerActions;
};

export function ReaderStatusBar({ activeSession, controller }: ReaderStatusBarProps) {
  const sourceLabel =
    activeSession?.source.kind === 'library' ? '本地文献库' : activeSession?.source.kind === 'desktop-path' ? '本地文件' : activeSession ? '浏览器文件' : '无文档';
  const pageLabel = activeSession
    ? `第 ${activeSession.page}${activeSession.totalPages ? ` / ${activeSession.totalPages}` : ''} 页`
    : '—';
  const progressLabel = activeSession ? `进度 ${Math.round(activeSession.progress * 100)}%` : '—';

  return (
    <footer className="reader-status-bar" aria-label="阅读状态">
      <div className="reader-status-details">
        <span className="status-pill">{sourceLabel}</span>
        <span>{progressLabel}</span>
        <span>{pageLabel}</span>
        {activeSession?.source.kind === 'desktop-path' || activeSession?.source.kind === 'library' ? (
          <span className="status-ok">阅读进度已自动保存</span>
        ) : activeSession ? (
          <span>浏览器打开不跨重启恢复</span>
        ) : null}
        <span className="shortcut-hint">⌘/Ctrl+F 搜索 · ⌘/Ctrl+D 书签 · 选中文本可添加高亮</span>
      </div>
      <ViewControls
        key={activeSession?.id}
        label="阅读"
        scale={activeSession?.zoom ?? 1}
        disabled={!activeSession || activeSession.status !== 'ready'}
        canZoomIn={(activeSession?.zoom ?? 1) < 3}
        canZoomOut={(activeSession?.zoom ?? 1) > 0.3}
        onZoomIn={() => controller.zoomIn()}
        onZoomOut={() => controller.zoomOut()}
        onFitWidth={() => controller.fitWidth()}
        onFitPage={() => controller.fitPage()}
      />
    </footer>
  );
}
