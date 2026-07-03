import { FileText, MoreVertical } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { formatDateTime, formatProgressPercent, getDirectoryPath } from './homeDisplayUtils';

type HomeRecentFilesProps = {
  documents: PersistedDocument[];
  favoriteDocumentKeys: Set<string>;
  onOpenAll(): void;
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onLocateFile(document: PersistedDocument): void;
  onRemoveRecent(document: PersistedDocument): void;
};

export function HomeRecentFiles({
  documents,
  favoriteDocumentKeys,
  onOpenAll,
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

  return (
    <section className="home-panel home-recent-files" aria-labelledby="home-recent-files-title">
      <div className="section-heading horizontal">
        <div>
          <p>最近阅读过的 PDF</p>
          <h2 id="home-recent-files-title">最近文件</h2>
        </div>
        <button type="button" className="text-link-button" onClick={onOpenAll}>
          查看全部（{documents.length}）
        </button>
      </div>
      {recentDocuments.length > 0 ? (
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
              {recentDocuments.map((document) => {
                const progressPercent = formatProgressPercent(document.progress);
                const favorite = favoriteDocumentKeys.has(document.documentKey);
                const menuOpen = openMenuKey === document.documentKey;

                return (
                  <tr key={document.documentKey}>
                    <td>
                      <span className="recent-file-name">
                        <span className="pdf-file-icon" aria-hidden="true">
                          <FileText size={16} />
                        </span>
                        <strong title={document.displayName}>{document.displayName}</strong>
                      </span>
                    </td>
                    <td className="path-cell" title={document.path ?? '本地浏览器文件'}>
                      {getDirectoryPath(document.path)}
                    </td>
                    <td>{formatDateTime(document.modifiedAt)}</td>
                    <td>
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
                    </td>
                    <td className="recent-menu-cell">
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
                            onClick={() =>
                              handleMenuAction(() =>
                                onToggleFavorite(document.documentKey, !favorite),
                              )
                            }
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-block">
          <strong>暂无最近文件</strong>
          <span>打开 PDF 后会显示在这里。</span>
        </div>
      )}
    </section>
  );
}
