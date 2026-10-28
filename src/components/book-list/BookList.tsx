import { FileText, Pin, Star } from 'lucide-react';
import { Fragment, useId, type ReactNode } from 'react';
import { formatDateTime, formatProgressPercent } from '../../home/homeDisplayUtils';
import './bookList.css';

export type BookListColumn = 'selection' | 'name' | 'authors' | 'journal' | 'path' | 'opened' | 'progress' | 'page' | 'tags' | 'actions';

export type BookListItem<T> = {
  key: string;
  name: string;
  source: T;
  subtitle?: string | null;
  authors?: readonly string[];
  journal?: string | null;
  path?: string | null;
  pathLabel?: string;
  lastOpenedAt?: string | null;
  modifiedAt?: string | null;
  modifiedLabel?: string;
  progress?: number | null;
  lastPage?: number | null;
  pageCount?: number | null;
  favorite?: boolean;
  pinned?: boolean;
  missing?: boolean;
};

type BookListSelection<T> = {
  selectedKeys: ReadonlySet<string>;
  onChange(item: BookListItem<T>, selected: boolean): void;
  onSelectPage?(selected: boolean): void;
  selectPageLabel?: string;
  itemLabel?(item: BookListItem<T>): string;
  nameSelects?: boolean;
  isDisabled?(item: BookListItem<T>): boolean;
};

export type BookListPagination = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange(page: number): void;
  onPageSizeChange(pageSize: number): void;
};

type BookListProps<T> = {
  items: readonly BookListItem<T>[];
  columns: readonly BookListColumn[];
  label: string;
  compact?: boolean;
  showHeader?: boolean;
  selection?: BookListSelection<T>;
  pagination?: BookListPagination;
  onOpen?(item: BookListItem<T>): void;
  rowOpens?: boolean;
  openLabel?(item: BookListItem<T>): string;
  openDisabled?(item: BookListItem<T>): boolean;
  renderTags?(item: BookListItem<T>): ReactNode;
  renderNameDetails?(item: BookListItem<T>): ReactNode;
  renderActions?(item: BookListItem<T>): ReactNode;
  renderDetails?(item: BookListItem<T>): ReactNode;
  onRowMouseEnter?(item: BookListItem<T>): void;
  onRowFocus?(item: BookListItem<T>): void;
  rowClassName?(item: BookListItem<T>): string | undefined;
  rowTestId?: string;
  nameTestId?: string;
};

const columnLabels: Record<BookListColumn, string> = {
  selection: '选择', name: '文件名', authors: '作者', journal: '来源期刊／会议', path: '本地路径',
  opened: '最近打开', progress: '阅读进度', page: '上次页码', tags: '标签', actions: '操作',
};

export function BookList<T>({
  items, columns, label, compact = false, showHeader = true, selection, pagination,
  onOpen, rowOpens, openLabel, openDisabled, renderTags, renderNameDetails, renderActions, renderDetails,
  onRowMouseEnter, onRowFocus, rowClassName, rowTestId, nameTestId,
}: BookListProps<T>) {
  const instanceId = useId();
  const selectable = items.filter((item) => !selection?.isDisabled?.(item));
  const selectedOnPage = selectable.filter((item) => selection?.selectedKeys.has(item.key)).length;
  const allSelected = selectable.length > 0 && selectedOnPage === selectable.length;

  return (
    <div className={`book-list${compact ? ' book-list--compact' : ''}`}>
      <div className="book-list-table-wrap">
        <table className="book-list-table" aria-label={label}>
          {showHeader ? <thead><tr>{columns.map((column) => <th key={column} className={`book-list-cell--${column}`} scope="col">
            {column === 'selection' && selection?.onSelectPage ? <input type="checkbox"
              aria-label={selection.selectPageLabel ?? '选择当前页全部文件'}
              disabled={!selectable.length} checked={allSelected}
              ref={(element) => { if (element) element.indeterminate = selectedOnPage > 0 && !allSelected; }}
              onChange={(event) => selection.onSelectPage?.(event.target.checked)} /> : column === 'selection' ? null : columnLabels[column]}
          </th>)}</tr></thead> : null}
          <tbody>{items.map((item, index) => {
            const details = renderDetails?.(item);
            const checkboxId = `${instanceId}-${index}`;
            const nameExtras = <>
              {item.subtitle ? <small title={item.subtitle}>{item.subtitle}</small> : null}
              {item.missing ? <small className="book-list-missing">文件已移动或删除</small> : null}
              {renderNameDetails?.(item)}
            </>;
            return <Fragment key={item.key}>
              <tr data-testid={rowTestId} className={rowClassName?.(item)}
                onMouseEnter={() => onRowMouseEnter?.(item)} onFocus={() => onRowFocus?.(item)}
                onClick={(event) => {
                  if (!rowOpens || !onOpen || openDisabled?.(item)) return;
                  if (event.target instanceof Element && event.target.closest('button, input, select, a, label')) return;
                  onOpen(item);
                }}>
                {columns.map((column) => <td key={column} className={`book-list-cell--${column}`} data-label={columnLabels[column]}>
                  {column === 'selection' && selection ? <input type="checkbox" id={selection.nameSelects ? checkboxId : undefined} aria-label={selection.itemLabel?.(item) ?? `选择 ${item.name}`}
                    checked={selection.selectedKeys.has(item.key)} disabled={selection.isDisabled?.(item)}
                    onChange={(event) => selection.onChange(item, event.target.checked)} /> : null}
                  {column === 'name' ? <div className="book-list-name">
                    <span className="book-list-pdf" aria-hidden="true"><FileText size={17} /></span>
                    {onOpen ? <span className="book-list-name-content"><button type="button" className="book-list-open" title={item.name}
                        aria-label={openLabel?.(item) ?? `打开 ${item.name}`} disabled={openDisabled?.(item)}
                        onClick={() => onOpen(item)}><strong data-testid={nameTestId}>{item.name}</strong></button>
                      {nameExtras}</span> : selection?.nameSelects ? <label className="book-list-name-content" htmlFor={checkboxId}>
                      <strong data-testid={nameTestId} title={item.name}>{item.name}</strong>{nameExtras}</label>
                      : <span className="book-list-name-content"><strong data-testid={nameTestId} title={item.name}>{item.name}</strong>{nameExtras}</span>}
                    {item.pinned ? <Pin className="book-list-pin" size={14} aria-label="已置顶" /> : null}
                    {item.favorite ? <Star className="book-list-star" size={14} fill="currentColor" aria-label="已收藏" /> : null}
                  </div> : null}
                  {column === 'authors' ? <span title={item.authors?.join('、')}>{item.authors?.join('、') || '—'}</span> : null}
                  {column === 'journal' ? <span title={item.journal || undefined}>{item.journal || '—'}</span> : null}
                  {column === 'path' ? <span className="book-list-path" title={item.path ?? item.pathLabel}>{item.pathLabel || item.path || '—'}</span> : null}
                  {column === 'opened' ? <span>{formatDateTime(item.lastOpenedAt ?? item.modifiedAt ?? null)}
                    {!item.lastOpenedAt && item.modifiedAt ? <small className="book-list-time-source">{item.modifiedLabel ?? '文件修改'}</small> : null}
                  </span> : null}
                  {column === 'progress' ? item.progress == null ? <span>—</span> : <div className="book-list-progress">
                    <span>{formatProgressPercent(item.progress)}%</span>
                    <span className="book-list-progress-track" role="progressbar" aria-label={`阅读进度 ${item.name}`}
                      aria-valuemin={0} aria-valuemax={100} aria-valuenow={formatProgressPercent(item.progress)}>
                      <span className={item.progress >= 1 ? 'complete' : undefined} style={{ width: `${formatProgressPercent(item.progress)}%` }} />
                    </span>
                  </div> : null}
                  {column === 'page' ? <span>{item.lastPage ? item.pageCount ? `${item.lastPage} / ${item.pageCount}` : `第 ${item.lastPage} 页（总页数未知）` : '—'}</span> : null}
                  {column === 'tags' ? renderTags?.(item) ?? '—' : null}
                  {column === 'actions' ? renderActions?.(item) : null}
                </td>)}
              </tr>
              {details ? <tr className="book-list-details" onMouseEnter={() => onRowMouseEnter?.(item)}
                onFocus={() => onRowFocus?.(item)}><td colSpan={columns.length}>{details}</td></tr> : null}
            </Fragment>;
          })}</tbody>
        </table>
      </div>
      {pagination ? <BookListPager {...pagination} /> : null}
    </div>
  );
}

function BookListPager({ page, pageSize, total, onPageChange, onPageSizeChange }: BookListPagination) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstPage = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pages = Array.from({ length: Math.min(pageCount, 5) }, (_, index) => firstPage + index);
  return <div className="book-list-pager" aria-label="列表分页">
    <span>共 {total} 条记录</span>
    <div className="book-list-page-buttons">
      <button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹</button>
      {pages.map((number) => <button key={number} type="button" aria-label={`第 ${number} 页`}
        aria-current={number === page ? 'page' : undefined} onClick={() => onPageChange(number)}>{number}</button>)}
      <button type="button" aria-label="下一页" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>›</button>
    </div>
    <label><span className="book-list-sr-only">每页条数</span><select aria-label="每页条数" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
      {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条/页</option>)}
    </select></label>
  </div>;
}
