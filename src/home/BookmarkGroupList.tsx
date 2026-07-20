import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
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
      {groups.map((group, groupIndex) => {
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
              <div id={contentId} className="bookmark-management-group-content">
                <table>
                  <thead>
                    <tr>
                      {batchMode ? (
                        <th scope="col" className="bookmark-management-checkbox-cell">
                          {groupIndex === 0 ? (
                            <input
                              type="checkbox"
                              aria-label="选择当前页全部书签"
                              checked={allVisibleSelected}
                              onChange={(event) =>
                                onToggleVisibleBatchSelection(event.currentTarget.checked)
                              }
                            />
                          ) : null}
                        </th>
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
    <header className="bookmark-management-group-header">
      <button
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
        <span>{group.bookmarkCount} 个书签</span>
        {group.document.missing ? <span>源文件不可用</span> : null}
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
}: {
  bookmark: BookmarkManagementRecord;
  selected: boolean;
  batchMode: boolean;
  batchSelected: boolean;
  setRowRef(row: HTMLTableRowElement | null): void;
  onSelect(): void;
  onToggleBatchSelection(id: number, selected: boolean): void;
}) {
  const progress = formatBookmarkPageProgress(bookmark);
  const handleKeyboardSelection = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <tr
      ref={setRowRef}
      tabIndex={0}
      aria-selected={selected}
      data-testid="bookmark-management-row"
      onClick={onSelect}
      onKeyDown={handleKeyboardSelection}
    >
      {batchMode ? (
        <td className="bookmark-management-checkbox-cell">
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
      <td className="bookmark-management-title" title={bookmark.title}>
        {bookmark.title}
      </td>
      <td>
        <span>{progress.pageLabel}</span>
        {progress.ratioLabel ? <small>{progress.ratioLabel}</small> : null}
      </td>
      <td>{formatDateTime(bookmark.createdAt)}</td>
      <td className="bookmark-management-note" title={bookmark.note ?? undefined}>
        {bookmark.note || '—'}
      </td>
      <td
        className="bookmark-management-row-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </tr>
  );
}
