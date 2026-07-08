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

const colorLabels = new Map<string, string>([
  ['#2563eb', '蓝色'],
  ['#f97316', '橙色'],
  ['#22c55e', '绿色'],
  ['#8b5cf6', '紫色'],
  ['#ec4899', '粉色'],
  ['#14b8a6', '青色'],
  ['#facc15', '黄色'],
  ['#94a3b8', '灰色'],
]);

function formatColorLabel(color: string) {
  return `${colorLabels.get(color.toLowerCase()) ?? '自定义颜色'} ${color}`;
}

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
      <label className="tag-dashboard-select tag-color-filter">
        <span
          className="tag-color-filter-dot"
          style={{ backgroundColor: color === 'all' ? '#94a3b8' : color }}
          aria-hidden="true"
        />
        <select
          aria-label="颜色筛选"
          value={color}
          onChange={(event) => onColorChange(event.target.value)}
        >
          <option value="all">全部颜色</option>
          {colors.map((tagColor) => (
            <option key={tagColor} value={tagColor}>
              {formatColorLabel(tagColor)}
            </option>
          ))}
        </select>
      </label>
      <label className="tag-dashboard-select">
        <select
          aria-label="排序方式"
          value={sortKey}
          onChange={(event) => onSortChange(event.target.value as TagSortKey)}
        >
          <option value="usage">使用次数</option>
          <option value="documents">关联文献</option>
          <option value="recent">最近使用</option>
        </select>
      </label>
      <button type="button" className="tag-dashboard-ghost" onClick={onClear}>清除筛选</button>
      <button type="button" className="tag-dashboard-primary" onClick={onCreate}>
        <Plus size={15} />
        创建标签
      </button>
    </div>
  );
}
