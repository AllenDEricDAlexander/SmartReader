import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, FileText, MoreVertical } from 'lucide-react';
import { formatDateTime } from './homeDisplayUtils';
import {
  bookmarkRecordKey,
  formatBookmarkPageProgress,
  type BookmarkDensity,
  type BookmarkManagementRecord,
  type BookmarkPageGroup,
} from './bookmarkManagementUtils';

type BookmarkGroupListProps = {
  groups: BookmarkPageGroup[];
  density: BookmarkDensity;
  expandedDocumentKeys: Set<string>;
  selectedBookmarkId: number | null;
  batchMode: boolean;
  selectedBatchIds: Set<number>;
  allVisibleSelected: boolean;
  pendingFocusId: number | null;
  onToggleDocument(documentKey: string): void;
  onSelectBookmark(bookmark: BookmarkManagementRecord): void;
  onToggleBatchSelection(id: number, selected: boolean): void;
  onToggleVisibleBatchSelection(selected: boolean): void;
  onPendingFocusHandled(): void;
  canOpenBookmark(bookmark: BookmarkManagementRecord): boolean;
  onOpenBookmark(bookmark: BookmarkManagementRecord): void;
  onEditBookmark(bookmark: BookmarkManagementRecord): void;
  onCopyBookmark(bookmark: BookmarkManagementRecord): void;
  onDeleteBookmark(bookmark: BookmarkManagementRecord): void;
};

export function BookmarkGroupList({
  groups,
  density,
  expandedDocumentKeys,
  selectedBookmarkId,
  batchMode,
  selectedBatchIds,
  allVisibleSelected,
  pendingFocusId,
  onToggleDocument,
  onSelectBookmark,
  onToggleBatchSelection,
  onToggleVisibleBatchSelection,
  onPendingFocusHandled,
  canOpenBookmark,
  onOpenBookmark,
  onEditBookmark,
  onCopyBookmark,
  onDeleteBookmark,
}: BookmarkGroupListProps) {
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

  useEffect(() => {
    if (pendingFocusId == null) {
      return;
    }

    const row = rowRefs.current.get(pendingFocusId);
    if (row) {
      row.focus();
      onPendingFocusHandled();
    }
  }, [onPendingFocusHandled, pendingFocusId]);

  return (
    <div
      className="bookmark-management-groups"
      data-testid="bookmark-management-list"
      data-density={density}
    >
      {batchMode ? (
        <div className="bookmark-management-batch-toolbar">
          <input
            type="checkbox"
            aria-label="选择当前页书签"
            checked={allVisibleSelected}
            ref={(element) => {
              if (element) {
                const selectedOnPage = groups
                  .flatMap((group) => group.bookmarks)
                  .filter(
                    (bookmark) =>
                      bookmark.id != null && selectedBatchIds.has(bookmark.id),
                  ).length;
                element.indeterminate = selectedOnPage > 0 && !allVisibleSelected;
              }
            }}
            onChange={(event) =>
              onToggleVisibleBatchSelection(event.currentTarget.checked)
            }
          />
        </div>
      ) : null}
      {groups.map((group) => {
        const expanded = expandedDocumentKeys.has(group.document.documentKey);
        const encodedKey = encodeURIComponent(group.document.documentKey);
        const headingId = `bookmark-group-${encodedKey}`;
        const contentId = `bookmark-group-content-${encodedKey}`;

        return (
          <section
            className="bookmark-management-group"
            key={group.document.documentKey}
            aria-labelledby={headingId}
          >
            <BookmarkGroupHeader
              group={group}
              headingId={headingId}
              contentId={contentId}
              expanded={expanded}
              onToggle={() => onToggleDocument(group.document.documentKey)}
            />
            {expanded ? (
              <div id={contentId} className="bookmark-management-table-wrap">
                <table className="bookmark-management-table">
                  <thead>
                    <tr>
                      {batchMode ? (
                        <th
                          scope="col"
                          aria-label="选择"
                        />
                      ) : null}
                      <th scope="col">书签名称</th>
                      <th scope="col">页码</th>
                      <th scope="col">创建时间</th>
                      <th scope="col">备注</th>
                      <th scope="col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.bookmarks.map((bookmark) => (
                      <BookmarkListItem
                        key={bookmarkRecordKey(bookmark)}
                        bookmark={bookmark}
                        selected={bookmark.id != null && bookmark.id === selectedBookmarkId}
                        batchMode={batchMode}
                        batchSelected={
                          bookmark.id != null && selectedBatchIds.has(bookmark.id)
                        }
                        setRowRef={(row) => {
                          if (bookmark.id == null) {
                            return;
                          }
                          if (row) {
                            rowRefs.current.set(bookmark.id, row);
                          } else {
                            rowRefs.current.delete(bookmark.id);
                          }
                        }}
                        onSelect={() => onSelectBookmark(bookmark)}
                        onToggleBatchSelection={onToggleBatchSelection}
                        canOpen={canOpenBookmark(bookmark)}
                        onOpen={() => onOpenBookmark(bookmark)}
                        onEdit={() => onEditBookmark(bookmark)}
                        onCopy={() => onCopyBookmark(bookmark)}
                        onDelete={() => onDeleteBookmark(bookmark)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function BookmarkGroupHeader({
  group,
  headingId,
  contentId,
  expanded,
  onToggle,
}: {
  group: BookmarkPageGroup;
  headingId: string;
  contentId: string;
  expanded: boolean;
  onToggle(): void;
}) {
  return (
    <header>
      <button
        className="bookmark-management-group-heading"
        id={headingId}
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={`${expanded ? '收起' : '展开'} ${group.document.displayName}`}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown size={16} aria-hidden="true" />
        ) : (
          <ChevronRight size={16} aria-hidden="true" />
        )}
        <FileText size={16} aria-hidden="true" />
        <strong>{group.document.displayName}</strong>
        <small>{group.bookmarkCount} 个书签</small>
        {group.document.missing ? (
          <span className="bookmark-management-missing">源文件不可用</span>
        ) : null}
      </button>
    </header>
  );
}

function BookmarkListItem({
  bookmark,
  selected,
  batchMode,
  batchSelected,
  setRowRef,
  onSelect,
  onToggleBatchSelection,
  canOpen,
  onOpen,
  onEdit,
  onCopy,
  onDelete,
}: {
  bookmark: BookmarkManagementRecord;
  selected: boolean;
  batchMode: boolean;
  batchSelected: boolean;
  setRowRef(row: HTMLTableRowElement | null): void;
  onSelect(): void;
  onToggleBatchSelection(id: number, selected: boolean): void;
  canOpen: boolean;
  onOpen(): void;
  onEdit(): void;
  onCopy(): void;
  onDelete(): void;
}) {
  const progress = formatBookmarkPageProgress(bookmark);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleKeyboardSelection = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };
  const menuItems = [
    {
      label: `跳转到书签 ${bookmark.title}`,
      disabled: !canOpen,
      action: onOpen,
    },
    {
      label: `编辑书签 ${bookmark.title}`,
      disabled: false,
      action: onEdit,
    },
    {
      label: `复制引用 ${bookmark.title}`,
      disabled: false,
      action: onCopy,
    },
    {
      label: `删除书签 ${bookmark.title}`,
      disabled: false,
      action: onDelete,
    },
  ];

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    menuItemRefs.current.find((item) => item && !item.disabled)?.focus();
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const restoreTriggerFocus = () => triggerRef.current?.focus();

  return (
    <tr
      ref={setRowRef}
      className="bookmark-management-row"
      tabIndex={0}
      aria-selected={selected}
      data-testid={
        bookmark.id == null
          ? 'bookmark-management-row'
          : `bookmark-management-row-${bookmark.id}`
      }
      onClick={onSelect}
      onKeyDown={handleKeyboardSelection}
    >
      {batchMode ? (
        <td>
          {bookmark.id != null ? (
            <input
              type="checkbox"
              aria-label={`选择书签 ${bookmark.title}`}
              checked={batchSelected}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                onToggleBatchSelection(bookmark.id!, event.currentTarget.checked)
              }
            />
          ) : null}
        </td>
      ) : null}
      <td className="bookmark-management-row-main" title={bookmark.title}>
        {bookmark.title}
      </td>
      <td className="bookmark-management-page-progress">
        <span>{progress.pageLabel}</span>
        {progress.percent != null ? <small>{progress.percent}%</small> : null}
      </td>
      <td>{formatDateTime(bookmark.createdAt)}</td>
      <td className="bookmark-management-note" title={bookmark.note ?? undefined}>
        {bookmark.note || '—'}
      </td>
      <td
        className="bookmark-management-row-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label={`打开书签操作 ${bookmark.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          <MoreVertical size={16} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div
            className="bookmark-management-menu"
            role="menu"
            aria-label={`书签操作 ${bookmark.title}`}
            onKeyDown={(event) =>
              moveMenuFocus(
                event,
                menuItemRefs.current.filter(
                  (item): item is HTMLButtonElement => item != null,
                ),
                closeMenu,
                restoreTriggerFocus,
              )
            }
          >
            {menuItems.map((item, index) => (
              <button
                key={item.label}
                ref={(element) => {
                  menuItemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                aria-label={item.label}
                disabled={item.disabled}
                onClick={() => {
                  closeMenu();
                  item.action();
                }}
              >
                {item.label.replace(` ${bookmark.title}`, '')}
              </button>
            ))}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function moveMenuFocus(
  event: KeyboardEvent<HTMLElement>,
  items: HTMLButtonElement[],
  close: () => void,
  restore: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    restore();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return;
  }

  event.preventDefault();
  const enabledItems = items.filter((item) => !item.disabled);
  if (enabledItems.length === 0) {
    return;
  }
  const current = Math.max(
    0,
    enabledItems.indexOf(document.activeElement as HTMLButtonElement),
  );
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? enabledItems.length - 1
        : event.key === 'ArrowDown'
          ? (current + 1) % enabledItems.length
          : (current - 1 + enabledItems.length) % enabledItems.length;
  enabledItems[index]?.focus();
}
