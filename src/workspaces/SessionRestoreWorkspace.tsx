import { useState } from 'react';
import type { DocumentSession } from '../documents/documentModels';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { BookList } from '../components/book-list/BookList';
import { documentBookItem } from '../components/book-list/bookListAdapters';

type SessionRestoreWorkspaceProps = {
  sessions: DocumentSession[];
  documents: PersistedDocument[];
  onSelectSession(id: string): void;
  onOpenDocument(document: PersistedDocument): void | Promise<unknown>;
  onRestore(): Promise<void>;
};

export function SessionRestoreWorkspace({ sessions, documents, onSelectSession, onOpenDocument, onRestore }: SessionRestoreWorkspaceProps) {
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState('');
  const restore = async () => {
    setRestoring(true);
    setMessage('');
    try { await onRestore(); setMessage('会话已恢复，可选择标签页继续阅读。加密文献需先解锁。'); }
    catch { setMessage('会话恢复失败，请检查文献是否仍可访问。'); }
    finally { setRestoring(false); }
  };
  return (
    <section className="home-panel research-session-workspace" aria-label="会话恢复工作区">
      <header className="workspace-header">
        <div><p>Reading sessions</p><h1>会话恢复</h1></div>
        <button type="button" className="primary-action" disabled={restoring} onClick={() => void restore()}>
          {restoring ? '正在恢复…' : '恢复上次会话'}
        </button>
      </header>
      {message ? <p role="status">{message}</p> : null}
      <h2>当前标签页</h2>
      {sessions.length ? <BookList compact showHeader={false} label="当前标签页列表"
        items={sessions.map((session) => ({ key: `session:${session.id}`, name: session.title, source: session,
          subtitle: session.status === 'error' ? '需要重新打开' : '继续阅读', progress: session.progress,
          lastPage: session.page, pageCount: session.totalPages }))}
        columns={['name', 'progress', 'page']} rowOpens onOpen={(item) => onSelectSession(item.source.id)} />
        : <p className="muted-copy">当前没有打开的标签页。</p>}
      <h2>继续阅读最近文献</h2>
      {documents.length ? <BookList compact showHeader={false} label="继续阅读最近文献列表"
        items={documents.map((document) => documentBookItem(document))} columns={['name', 'progress', 'page']}
        rowOpens onOpen={(item) => void onOpenDocument(item.source)} openDisabled={(item) => item.source.missing} /> : null}
      {!documents.length ? <p className="muted-copy">导入并阅读 PDF 后，这里会保留阅读进度。</p> : null}
    </section>
  );
}
