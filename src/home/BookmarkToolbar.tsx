import { List, Rows3, Search, X } from 'lucide-react';
import {
  BOOKMARK_PAGE_SIZES,
  type BookmarkDateFilter,
  type BookmarkDensity,
  type BookmarkPageSize,
  type BookmarkSortMode,
} from './bookmarkManagementUtils';

type BookmarkToolbarProps = {
  query: string;
  documentKey: string;
  dateFilter: BookmarkDateFilter;
  sortMode: BookmarkSortMode;
  pageSize: BookmarkPageSize;
  density: BookmarkDensity;
  documentOptions: Array<[string, string]>;
  filtering: boolean;
  batchMode: boolean;
  onQueryChange(value: string): void;
  onDocumentChange(value: string): void;
  onDateFilterChange(value: BookmarkDateFilter): void;
  onSortModeChange(value: BookmarkSortMode): void;
  onPageSizeChange(value: BookmarkPageSize): void;
  onDensityChange(value: BookmarkDensity): void;
  onClearFilters(): void;
  onStartBatch(): void;
  onCancelBatch(): void;
};

export function BookmarkToolbar({
  query,
  documentKey,
  dateFilter,
  sortMode,
  pageSize,
  density,
  documentOptions,
  filtering,
  batchMode,
  onQueryChange,
  onDocumentChange,
  onDateFilterChange,
  onSortModeChange,
  onPageSizeChange,
  onDensityChange,
  onClearFilters,
  onStartBatch,
  onCancelBatch,
}: BookmarkToolbarProps) {
  return (
    <div className="bookmark-management-toolbar">
      <div className="bookmark-management-search">
        <label htmlFor="bookmark-management-query">搜索书签</label>
        <div className="bookmark-management-search-control">
          <Search size={16} aria-hidden="true" />
          <input
            id="bookmark-management-query"
            type="search"
            aria-label="搜索书签"
            placeholder="搜索书签名称、备注或文档..."
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
          {query ? (
            <button
              type="button"
              className="bookmark-management-search-clear"
              aria-label="清空搜索关键词"
              onClick={() => onQueryChange('')}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <label className="bookmark-management-select">
        <span>文档筛选</span>
        <select
          aria-label="文档筛选"
          value={documentKey}
          onChange={(event) => onDocumentChange(event.currentTarget.value)}
        >
          <option value="all">全部文档</option>
          {documentOptions.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="bookmark-management-select">
        <span>日期筛选</span>
        <select
          aria-label="日期筛选"
          value={dateFilter}
          onChange={(event) =>
            onDateFilterChange(event.currentTarget.value as BookmarkDateFilter)
          }
        >
          <option value="all">全部日期</option>
          <option value="today">今天</option>
          <option value="7days">最近 7 天</option>
          <option value="30days">最近 30 天</option>
        </select>
      </label>
      <label className="bookmark-management-select">
        <span>书签排序</span>
        <select
          aria-label="书签排序"
          value={sortMode}
          onChange={(event) =>
            onSortModeChange(event.currentTarget.value as BookmarkSortMode)
          }
        >
          <option value="createdDesc">创建时间（最新）</option>
          <option value="createdAsc">创建时间（最早）</option>
          <option value="pageAsc">页码（升序）</option>
          <option value="pageDesc">页码（降序）</option>
        </select>
      </label>
      <label className="bookmark-management-select">
        <span>每页书签数</span>
        <select
          aria-label="每页书签数"
          value={pageSize}
          onChange={(event) =>
            onPageSizeChange(Number(event.currentTarget.value) as BookmarkPageSize)
          }
        >
          {BOOKMARK_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} 条
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-label="重置筛选条件"
        disabled={!filtering}
        onClick={onClearFilters}
      >
        清除筛选
      </button>

      <div className="bookmark-management-density" aria-label="列表密度">
        <button
          type="button"
          aria-label="标准密度"
          aria-pressed={density === 'standard'}
          onClick={() => onDensityChange('standard')}
        >
          <List size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="紧凑密度"
          aria-pressed={density === 'compact'}
          onClick={() => onDensityChange('compact')}
        >
          <Rows3 size={16} aria-hidden="true" />
        </button>
      </div>
      {batchMode ? (
        <button type="button" onClick={onCancelBatch}>
          <X size={16} aria-hidden="true" />
          取消批量操作
        </button>
      ) : (
        <button type="button" onClick={onStartBatch}>
          批量操作
        </button>
      )}
    </div>
  );
}
