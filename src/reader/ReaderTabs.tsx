import { FilePlus2, FileText, House, X } from 'lucide-react';
import { useCallback, useEffect, useRef, type ChangeEventHandler } from 'react';
import type { DocumentSession } from '../documents/documentModels';

export type ReaderTabsProps = {
  sessions: DocumentSession[];
  activeSessionId: string | null;
  homeActive: boolean;
  canOpenNativePdf(): boolean;
  onOpenHome(): void;
  onOpenPdf(): boolean | void | Promise<boolean | void>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onSelectSession(sessionId: string): void;
  onCloseSession(sessionId: string): void;
};

export function ReaderTabs({
  sessions,
  activeSessionId,
  homeActive,
  canOpenNativePdf,
  onOpenHome,
  onOpenPdf,
  onBrowserFileChange,
  onSelectSession,
  onCloseSession,
}: ReaderTabsProps) {
  const homeButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusSessionIdRef = useRef<string | null>(null);

  const openBrowserPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenPdf = useCallback(() => {
    if (!canOpenNativePdf()) {
      openBrowserPicker();
      return;
    }

    try {
      Promise.resolve(onOpenPdf()).then(
        (opened) => {
          if (opened === false) {
            return;
          }
        },
        () => {
          openBrowserPicker();
        },
      );
    } catch {
      openBrowserPicker();
    }
  }, [canOpenNativePdf, onOpenPdf, openBrowserPicker]);

  const handleCloseSession = useCallback(
    (sessionId: string) => {
      pendingFocusSessionIdRef.current = sessionId;
      onCloseSession(sessionId);
    },
    [onCloseSession],
  );

  useEffect(() => {
    const activeTab = activeSessionId ? tabRefs.current.get(activeSessionId) : null;
    activeTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });

    if (pendingFocusSessionIdRef.current === null) {
      return;
    }

    if (sessions.length === 0) {
      homeButtonRef.current?.focus();
    } else {
      const focusTarget =
        (activeSessionId ? tabRefs.current.get(activeSessionId) : null) ??
        tabRefs.current.get(sessions[0].id);
      focusTarget?.focus();
    }
    pendingFocusSessionIdRef.current = null;
  }, [activeSessionId, sessions]);

  return (
    <header className="reader-tabs" aria-label="文档导航栏">
      <button
        ref={homeButtonRef}
        type="button"
        className={homeActive ? 'reader-home-button active' : 'reader-home-button'}
        aria-current={homeActive ? 'page' : undefined}
        onClick={onOpenHome}
      >
        <House size={15} aria-hidden="true" />
        <span>首页</span>
      </button>

      <div className="reader-tab-list" role="tablist" aria-label="已打开文档">
        {sessions.map((session) => {
          const active = !homeActive && session.id === activeSessionId;
          const pageHint = session.totalPages
            ? `${session.page}/${session.totalPages}`
            : `p.${session.page}`;

          return (
            <div key={session.id} className="reader-tab-shell">
              <button
                ref={(element) => {
                  if (element) {
                    tabRefs.current.set(session.id, element);
                  } else {
                    tabRefs.current.delete(session.id);
                  }
                }}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? 'tab active' : 'tab'}
                title={`${session.title} · ${pageHint}`}
                onClick={() => onSelectSession(session.id)}
              >
                <FileText size={14} aria-hidden="true" />
                <span className="tab-title">{session.title}</span>
                <span className="tab-page-hint" aria-hidden="true">
                  {pageHint}
                </span>
              </button>
              <button
                type="button"
                className="reader-tab-close"
                aria-label={`关闭文档 ${session.title}`}
                title={`关闭文档 ${session.title}`}
                onClick={() => handleCloseSession(session.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="reader-tabs-actions">
        <button
          type="button"
          className="reader-new-file-button"
          aria-label="打开新文件"
          onClick={handleOpenPdf}
        >
          <FilePlus2 size={15} aria-hidden="true" />
          <span>打开</span>
        </button>
        <input
          ref={fileInputRef}
          aria-label="从文档导航栏选择 PDF 文件"
          className="reader-tabs-file-input"
          type="file"
          accept="application/pdf,.pdf"
          tabIndex={-1}
          onChange={onBrowserFileChange}
        />
      </div>
    </header>
  );
}
