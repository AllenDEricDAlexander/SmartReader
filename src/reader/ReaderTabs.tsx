import { FileText } from 'lucide-react';
import type { DocumentSession } from '../documents/documentModels';

type ReaderTabsProps = {
  sessions: DocumentSession[];
  activeSessionId: string | null;
  onSelectSession(sessionId: string): void;
};

export function ReaderTabs({ sessions, activeSessionId, onSelectSession }: ReaderTabsProps) {
  return (
    <header className="reader-tabs" aria-label="已打开文档" role="tablist">
      {sessions.map((session) => {
        const active = session.id === activeSessionId;
        const pageHint = session.totalPages
          ? `${session.page}/${session.totalPages}`
          : `p.${session.page}`;

        return (
          <button
            key={session.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'tab active' : 'tab'}
            title={`${session.title} · ${pageHint}`}
            onClick={() => onSelectSession(session.id)}
          >
            <FileText size={14} />
            <span className="tab-title">{session.title}</span>
            <span className="tab-page-hint" aria-hidden="true">
              {pageHint}
            </span>
          </button>
        );
      })}
    </header>
  );
}
