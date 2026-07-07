import type { CSSProperties } from 'react';
import type { TagDashboardTagRow } from './tagModels';

type TagCloudPanelProps = {
  tags: TagDashboardTagRow[];
  selectedTagId: number | null;
  onSelectTag(tagId: number): void;
};

export function TagCloudPanel({ tags, selectedTagId, onSelectTag }: TagCloudPanelProps) {
  return (
    <section className="tag-dashboard-card tag-cloud-card" aria-label="标签云">
      <h2>标签云</h2>
      <div className="tag-cloud-list">
        {tags.length > 0 ? tags.slice(0, 12).map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={tag.id === selectedTagId ? 'active' : undefined}
            style={{ '--tag-color': tag.color } as CSSProperties}
            onClick={() => onSelectTag(tag.id)}
          >
            {tag.name}
            <span>{tag.usageCount}</span>
          </button>
        )) : <p className="tag-dashboard-empty">暂无标签</p>}
      </div>
    </section>
  );
}
