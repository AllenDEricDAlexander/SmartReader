import { AlertTriangle, Clock3 } from 'lucide-react';
import { mapDocumentsToRecentFiles } from '../library/recentFiles';
import type { PersistedDocument } from '../persistence/persistenceApi';

type HomeRecentSessionsProps = {
  documents: PersistedDocument[];
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
};

export function HomeRecentSessions({ documents, onReopenDocument }: HomeRecentSessionsProps) {
  const recentFiles = mapDocumentsToRecentFiles(documents);

  return (
    <section className="home-panel" aria-labelledby="home-recent-title">
      <div className="section-heading horizontal">
        <div>
          <p>最近阅读</p>
          <h2 id="home-recent-title">继续上次会话</h2>
        </div>
        <span>{recentFiles.length} 个文件</span>
      </div>
      {recentFiles.length > 0 ? (
        <div className="session-list">
          {recentFiles.map((file) => {
            const document = documents.find((candidate) => candidate.documentKey === file.documentKey);

            return (
              <button
                key={file.documentKey}
                type="button"
                className={file.missing ? 'session-row missing' : 'session-row'}
                aria-label={`Open recent ${file.title}`}
                title={file.path ?? ''}
                onClick={() => {
                  if (document) {
                    void onReopenDocument(document);
                  }
                }}
              >
                <span className="session-icon" aria-hidden="true">
                  {file.missing ? <AlertTriangle size={16} /> : <Clock3 size={16} />}
                </span>
                <span className="session-main">
                  <strong>{file.title}</strong>
                  <span>{file.path ?? '浏览器导入文件'}</span>
                </span>
                <span className="session-meta">
                  <span>{file.progressLabel}</span>
                  <span>{file.lastPageLabel}</span>
                  <span>{file.fileSizeLabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty-block">
          <strong>还没有最近会话</strong>
          <span>打开 PDF 后，SmartReader 会在这里保留阅读进度。</span>
        </div>
      )}
    </section>
  );
}
