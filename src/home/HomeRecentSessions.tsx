import { FileText } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { formatDateTime, formatPageProgress, getDirectoryPath } from './homeDisplayUtils';

type HomeRecentSessionsProps = {
  documents: PersistedDocument[];
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
  onClearRecords(): void;
};

export function HomeRecentSessions({
  documents,
  onReopenDocument,
  onClearRecords,
}: HomeRecentSessionsProps) {
  const restorableDocuments = documents.slice(0, 3);

  const reopenDocument = (document: PersistedDocument) => {
    void onReopenDocument(document);
  };

  const stopRowClickPropagation = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <section className="home-panel home-session-restore" aria-labelledby="home-recent-title">
      <div className="section-heading horizontal">
        <div>
          <p>继续您上次阅读的内容</p>
          <h2 id="home-recent-title">恢复上次会话</h2>
        </div>
        <button type="button" className="text-link-button" onClick={onClearRecords}>
          清除记录
        </button>
      </div>
      {restorableDocuments.length > 0 ? (
        <div className="session-list">
          {restorableDocuments.map((document) => (
            <div
              key={document.documentKey}
              className={document.missing ? 'session-row missing' : 'session-row'}
              title={document.path ?? ''}
              onClick={() => reopenDocument(document)}
            >
              <button
                type="button"
                className="session-row-main-button"
                aria-label={`恢复会话 ${document.displayName}`}
                onClick={(event) => {
                  stopRowClickPropagation(event);
                  reopenDocument(document);
                }}
              >
                <span className="pdf-file-icon" aria-hidden="true">
                  <FileText size={18} />
                </span>
                <span className="session-main">
                  <strong>{document.displayName}</strong>
                  <span>{getDirectoryPath(document.path)}</span>
                </span>
                <span className="session-meta">
                  <span className="session-progress">{formatPageProgress(document)}</span>
                  <span className="session-time">{formatDateTime(document.modifiedAt)}</span>
                </span>
              </button>
              <button
                type="button"
                className="session-continue-button"
                aria-label={`继续阅读 ${document.displayName}`}
                onClick={(event) => {
                  stopRowClickPropagation(event);
                  reopenDocument(document);
                }}
              >
                继续阅读
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-block">
          <strong>暂无可恢复会话</strong>
          <span>打开 PDF 后，SmartReader 会在这里保留阅读进度。</span>
        </div>
      )}
    </section>
  );
}
