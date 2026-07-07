import { Plus, Search } from 'lucide-react';
import type { TagDashboardTagRow } from './tagModels';
import type { TagSortKey } from './tagDashboardUtils';

type TagDashboardToolbarProps = {
  tags: TagDashboardTagRow[];
  query: string;
  color: string;
  sortKey: TagSortKey;
  onQueryChange(value: string): void;
  onColorChange(value: string): void;
  onSortChange(value: TagSortKey): void;
  onClear(): void;
  onCreate(): void;
};

export function TagDashboardToolbar({
  tags,
  query,
  color,
  sortKey,
  onQueryChange,
  onColorChange,
  onSortChange,
  onClear,
  onCreate,
}: TagDashboardToolbarProps) {
  const colors = Array.from(new Set(tags.map((tag) => tag.color)));

  return (
    <div className="tag-dashboard-toolbar" aria-label="标签筛选工具栏">
      <label className="tag-dashboard-search">
        <Search size={16} />
        <input
          aria-label="搜索标签名称或描述"
          placeholder="搜索标签名称或描述..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <select aria-label="颜色筛选" value={color} onChange={(event) => onColorChange(event.target.value)}>
        <option value="all">全部颜色</option>
        {colors.map((tagColor) => (
          <option key={tagColor} value={tagColor}>{tagColor}</option>
        ))}
      </select>
      <select aria-label="排序方式" value={sortKey} onChange={(event) => onSortChange(event.target.value as TagSortKey)}>
        <option value="usage">使用次数</option>
        <option value="documents">关联文献</option>
        <option value="recent">最近使用</option>
      </select>
      <button type="button" className="tag-dashboard-ghost" onClick={onClear}>清除筛选</button>
      <button type="button" className="tag-dashboard-primary" onClick={onCreate}>
        <Plus size={15} />
        创建标签
      </button>
    </div>
  );
}
