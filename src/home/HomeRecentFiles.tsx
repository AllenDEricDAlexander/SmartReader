import { FileText, Grid2X2, List } from 'lucide-react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { BookList } from '../components/book-list/BookList';
import { BookListMenu } from '../components/book-list/BookListMenu';
import { documentBookItem } from '../components/book-list/bookListAdapters';
import type { Paper } from '../library/libraryModels';
import type { HomeRecentViewMode } from '../preferences/preferencesModels';
import type { Tag } from '../tags/tagModels';
import { formatDateTime, formatPageProgress, formatProgressPercent, getDirectoryPath } from './homeDisplayUtils';

type HomeRecentFilesProps = {
  documents: PersistedDocument[];
  papersByKey?: ReadonlyMap<string, Paper>;
  tags?: Tag[];
  viewMode: HomeRecentViewMode;
  viewModeDisabled?: boolean;
  onViewModeChange(viewMode: HomeRecentViewMode): void;
  favoriteDocumentKeys: Set<string>;
  onOpenAll(): void;
  onClearRecords(): void;
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onLocateFile(document: PersistedDocument): void;
  onRemoveRecent(document: PersistedDocument): void | Promise<void>;
};

export function HomeRecentFiles({
  documents,
  papersByKey,
  tags = [],
  viewMode,
  viewModeDisabled,
  onViewModeChange,
  favoriteDocumentKeys,
  onOpenAll,
  onClearRecords,
  onReopenDocument,
  onToggleFavorite,
  onLocateFile,
  onRemoveRecent,
}: HomeRecentFilesProps) {
  const recentDocuments = documents.slice(0, 5);

  const renderProgress = (document: PersistedDocument) => {
    const progressPercent = formatProgressPercent(document.progress);

    return (
      <div className="recent-reading-progress">
        <span className="recent-page-progress">{formatPageProgress(document)}</span>
        <span className="progress-cell">
          <span>{progressPercent}%</span>
          <span
            className="recent-progress"
            role="progressbar"
            aria-label={`阅读进度 ${document.displayName}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </span>
        </span>
      </div>
    );
  };

  const renderActions = (document: PersistedDocument) => {
    const favorite = favoriteDocumentKeys.has(document.documentKey);
    return <div className="recent-reading-actions"><BookListMenu name={document.displayName} actions={[
      { label: '打开', onSelect: () => onReopenDocument(document) },
      { label: favorite ? '取消收藏' : '收藏', onSelect: () => onToggleFavorite(document.documentKey, !favorite) },
      { label: '定位文件', onSelect: () => onLocateFile(document) },
      { label: '从最近记录移除', onSelect: () => onRemoveRecent(document) },
    ]} /></div>;
  };

  return (
    <section className="home-panel home-recent-files" aria-labelledby="home-recent-files-title">
      <div className="section-heading horizontal">
        <div>
          <p>继续您上次阅读的内容</p>
          <h2 id="home-recent-files-title">最近阅读</h2>
        </div>
        <div className="recent-reading-toolbar">
          <div className="segmented-control" role="group" aria-label="最近阅读显示方式">
            <button
              type="button"
              className={viewMode === 'list' ? 'active' : undefined}
              aria-pressed={viewMode === 'list'}
              disabled={viewModeDisabled}
              onClick={() => {
                if (viewMode !== 'list') onViewModeChange('list');
              }}
            >
              <List size={16} />
              列表视图
            </button>
            <button
              type="button"
              className={viewMode === 'cards' ? 'active' : undefined}
              aria-pressed={viewMode === 'cards'}
              disabled={viewModeDisabled}
              onClick={() => {
                if (viewMode !== 'cards') onViewModeChange('cards');
              }}
            >
              <Grid2X2 size={16} />
              卡片视图
            </button>
          </div>
          <button type="button" className="text-link-button" disabled={!documents.length} onClick={onClearRecords}>
            清除记录
          </button>
          <button type="button" className="text-link-button" onClick={onOpenAll}>
            查看全部（{documents.length}）
          </button>
        </div>
      </div>
      {recentDocuments.length > 0 ? (
        viewMode === 'cards' ? (
          <div className="recent-reading-grid">
            {recentDocuments.map((document) => (
              <article
                key={document.documentKey}
                className={document.missing ? 'recent-reading-card missing' : 'recent-reading-card'}
                aria-label={document.displayName}
              >
                <button
                  type="button"
                  className="recent-file-name recent-reading-open"
                  aria-label={`打开 ${document.displayName}`}
                  onClick={() => void onReopenDocument(document)}
                >
                  <span className="pdf-file-icon" aria-hidden="true"><FileText size={24} /></span>
                  <strong title={document.displayName}>{document.displayName}</strong>
                </button>
                <span className="path-cell" title={document.path ?? undefined}>
                  {getDirectoryPath(document.path, document.documentKey)}
                </span>
                <span className="recent-reading-time">上次打开：{formatDateTime(document.lastOpenedAt ?? document.modifiedAt)}</span>
                {document.missing ? <span className="recent-reading-missing">文件已移动或删除</span> : null}
                {renderProgress(document)}
                <div className="recent-reading-card-actions">{renderActions(document)}</div>
              </article>
            ))}
          </div>
        ) : (
          <BookList compact label="最近阅读列表"
            items={recentDocuments.map((document) => ({
              ...documentBookItem(document, papersByKey?.get(document.documentKey)),
              favorite: favoriteDocumentKeys.has(document.documentKey),
            }))}
            columns={['name', 'authors', 'journal', 'path', 'opened', 'progress', 'page', 'tags', 'actions']}
            onOpen={(item) => void onReopenDocument(item.source)}
            renderTags={(item) => {
              const documentTags = tags.filter((tag) => item.source.tagIds.includes(tag.id));
              return documentTags.length ? <div className="book-list-tags">{documentTags.map((tag) =>
                <span key={tag.id} className="book-list-tag" style={{ color: tag.color, borderColor: tag.color }}>{tag.name}</span>)}</div> : '—';
            }}
            renderActions={(item) => <div className="recent-menu-cell">{renderActions(item.source)}</div>} />
        )
      ) : (
        <div className="empty-block">
          <strong>暂无最近阅读记录</strong>
          <span>打开 PDF 后会在这里保留阅读进度。</span>
        </div>
      )}
    </section>
  );
}
