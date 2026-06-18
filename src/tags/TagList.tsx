import { Search, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Tag } from './tagModels';

type TagListProps = {
  tags: Tag[];
  activeTagId: number | null;
  onSelectTag(tag: Tag): void;
};

export function TagList({ tags, activeTagId, onSelectTag }: TagListProps) {
  const [searchText, setSearchText] = useState('');
  const filteredTags = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase();

    if (!keyword) {
      return tags;
    }

    return tags.filter((tag) => tag.name.toLocaleLowerCase().includes(keyword));
  }, [searchText, tags]);

  return (
    <aside className="tag-list-panel" aria-label="标签列表">
      <label className="tag-search">
        <Search size={14} />
        <input
          aria-label="搜索标签"
          value={searchText}
          placeholder="搜索标签"
          onChange={(event) => setSearchText(event.target.value)}
        />
      </label>
      <div className="tag-list">
        {filteredTags.length === 0 ? (
          <div className="empty-block compact">
            <Tags size={18} />
            <strong>没有匹配标签</strong>
            <span>创建标签后可在这里按名称筛选。</span>
          </div>
        ) : (
          filteredTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={tag.id === activeTagId ? 'tag-list-item active' : 'tag-list-item'}
              onClick={() => onSelectTag(tag)}
            >
              <span className="tag-dot" style={{ backgroundColor: tag.color }} aria-hidden="true" />
              <span>
                <strong>{tag.name}</strong>
                <small>
                  {tag.documentCount} 文档 · {tag.annotationCount} 批注
                </small>
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
