import { useState } from 'react';
import type { DocumentSession } from '../documents/documentModels';
import type { PersistedDocument } from '../persistence/persistenceApi';

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
      {sessions.length ? <div className="workspace-list">{sessions.map((session) => (
        <button key={session.id} type="button" className="workspace-list-row" onClick={() => onSelectSession(session.id)}>
          <strong>{session.title}</strong><span>第 {session.page} 页 · {session.status === 'error' ? '需要重新打开' : '继续阅读'}</span>
        </button>
      ))}</div> : <p className="muted-copy">当前没有打开的标签页。</p>}
      <h2>继续阅读最近文献</h2>
      <div className="workspace-list">{documents.map((document) => (
        <button key={document.documentKey} type="button" className="workspace-list-row" disabled={document.missing}
          onClick={() => void onOpenDocument(document)}>
          <strong>{document.displayName}</strong><span>第 {document.lastPage} 页 · {document.missing ? '原文件不可用' : '打开文献'}</span>
        </button>
      ))}</div>
      {!documents.length ? <p className="muted-copy">导入并阅读 PDF 后，这里会保留阅读进度。</p> : null}
    </section>
  );
}
