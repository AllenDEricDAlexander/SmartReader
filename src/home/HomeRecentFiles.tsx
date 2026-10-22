import { FileText, Grid2X2, List, MoreVertical } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import type { HomeRecentViewMode } from '../preferences/preferencesModels';
import { formatDateTime, formatPageProgress, formatProgressPercent, getDirectoryPath } from './homeDisplayUtils';

type HomeRecentFilesProps = {
  documents: PersistedDocument[];
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
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuItemRefs = useRef(new Map<string, Array<HTMLButtonElement | null>>());
  const recentDocuments = documents.slice(0, 5);

  useEffect(() => {
    if (!openMenuKey) {
      return;
    }

    menuItemRefs.current.get(openMenuKey)?.[0]?.focus();
  }, [openMenuKey]);

  const closeMenu = () => {
    setOpenMenuKey(null);
  };

  const closeMenuAndFocusTrigger = (documentKey: string) => {
    closeMenu();
    triggerRefs.current.get(documentKey)?.focus();
  };

  const handleMenuAction = (action: () => void | Promise<void>) => {
    closeMenu();
    void action();
  };

  const setTriggerRef = (documentKey: string, element: HTMLButtonElement | null) => {
    if (element) {
      triggerRefs.current.set(documentKey, element);
      return;
    }

    triggerRefs.current.delete(documentKey);
  };

  const setMenuItemRef = (
    documentKey: string,
    index: number,
    element: HTMLButtonElement | null,
  ) => {
    const items = menuItemRefs.current.get(documentKey) ?? [];

    if (element) {
      items[index] = element;
      menuItemRefs.current.set(documentKey, items);
      return;
    }

    items[index] = null;
    if (items.some(Boolean)) {
      menuItemRefs.current.set(documentKey, items);
      return;
    }

    menuItemRefs.current.delete(documentKey);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>, documentKey: string) => {
    const menuItems = menuItemRefs.current.get(documentKey)?.filter(Boolean) ?? [];

    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenuAndFocusTrigger(documentKey);
      return;
    }

    if (menuItems.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      menuItems.findIndex((item) => item === document.activeElement),
      0,
    );

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      menuItems[(currentIndex + 1) % menuItems.length]?.focus();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      menuItems[(currentIndex - 1 + menuItems.length) % menuItems.length]?.focus();
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      menuItems[0]?.focus();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      menuItems[menuItems.length - 1]?.focus();
    }
  };

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
    const menuOpen = openMenuKey === document.documentKey;

    return (
      <>
        <div className="recent-reading-actions">
          <button
            type="button"
            className="session-continue-button"
            aria-label={`继续阅读 ${document.displayName}`}
            onClick={() => void onReopenDocument(document)}
          >
            继续阅读
          </button>
          <button
            type="button"
            ref={(element) => setTriggerRef(document.documentKey, element)}
            className="icon-button"
            aria-label={`更多操作 ${document.displayName}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setOpenMenuKey(menuOpen ? null : document.documentKey)}
          >
            <MoreVertical size={16} />
          </button>
        </div>
        {menuOpen ? (
          <div
            className="recent-file-menu"
            role="menu"
            onKeyDown={(event) => handleMenuKeyDown(event, document.documentKey)}
          >
            <button
              type="button"
              ref={(element) => setMenuItemRef(document.documentKey, 0, element)}
              role="menuitem"
              onClick={() => handleMenuAction(() => onReopenDocument(document))}
            >
              打开
            </button>
            <button
              type="button"
              ref={(element) => setMenuItemRef(document.documentKey, 1, element)}
              role="menuitem"
              onClick={() => handleMenuAction(() => onToggleFavorite(document.documentKey, !favorite))}
            >
              {favorite ? '取消收藏' : '收藏'}
            </button>
            <button
              type="button"
              ref={(element) => setMenuItemRef(document.documentKey, 2, element)}
              role="menuitem"
              onClick={() => handleMenuAction(() => onLocateFile(document))}
            >
              定位文件
            </button>
            <button
              type="button"
              ref={(element) => setMenuItemRef(document.documentKey, 3, element)}
              role="menuitem"
              onClick={() => handleMenuAction(() => onRemoveRecent(document))}
            >
              从最近记录移除
            </button>
          </div>
        ) : null}
      </>
    );
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
                closeMenu();
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
                closeMenu();
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
          <div className="recent-files-table-wrap">
            <table className="recent-files-table">
              <thead>
                <tr>
                  <th scope="col">文件名</th>
                  <th scope="col">路径</th>
                  <th scope="col">上次打开</th>
                  <th scope="col">阅读进度</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {recentDocuments.map((document) => (
                  <tr key={document.documentKey}>
                    <td data-label="文件名">
                      <button
                        type="button"
                        className="recent-file-name recent-reading-open"
                        aria-label={`打开 ${document.displayName}`}
                        onClick={() => void onReopenDocument(document)}
                      >
                        <span className="pdf-file-icon" aria-hidden="true"><FileText size={16} /></span>
                        <strong title={document.displayName}>{document.displayName}</strong>
                      </button>
                      {document.missing ? <span className="recent-reading-missing">文件已移动或删除</span> : null}
                    </td>
                    <td
                      className="path-cell"
                      data-label="路径"
                      title={document.path ?? (document.documentKey.startsWith('paper:') ? '本地文献库' : '本地浏览器文件')}
                    >
                      {getDirectoryPath(document.path, document.documentKey)}
                    </td>
                    <td data-label="上次打开">{formatDateTime(document.lastOpenedAt ?? document.modifiedAt)}</td>
                    <td data-label="阅读进度">{renderProgress(document)}</td>
                    <td className="recent-menu-cell" data-label="操作">{renderActions(document)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
