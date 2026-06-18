import { FileText } from 'lucide-react';
import type { DocumentSession } from '../documents/documentModels';

type ReaderTabsProps = {
  sessions: DocumentSession[];
  activeSessionId: string | null;
  onSelectSession(sessionId: string): void;
};

export function ReaderTabs({ sessions, activeSessionId, onSelectSession }: ReaderTabsProps) {
  return (
    <header className="reader-tabs" aria-label="Open documents">
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          role="tab"
          aria-selected={session.id === activeSessionId}
          className={session.id === activeSessionId ? 'tab active' : 'tab'}
          onClick={() => onSelectSession(session.id)}
        >
          <FileText size={14} />
          {session.title}
        </button>
      ))}
    </header>
  );
}
