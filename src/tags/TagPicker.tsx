import type { Tag } from './tagModels';

type TagPickerProps = {
  tags: Tag[];
  selectedTagIds: number[];
  disabled?: boolean;
  onToggleTag(tag: Tag, selected: boolean): void | Promise<void>;
};

export function TagPicker({ tags, selectedTagIds, disabled, onToggleTag }: TagPickerProps) {
  if (tags.length === 0) {
    return <p className="muted-copy">暂无可用标签。</p>;
  }

  return (
    <div className="tag-picker" aria-label="Annotation tags">
      {tags.map((tag) => {
        const selected = selectedTagIds.includes(tag.id);

        return (
          <button
            key={tag.id}
            type="button"
            className={selected ? 'tag-chip selected' : 'tag-chip'}
            aria-label={`添加标签 ${tag.name}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => void onToggleTag(tag, selected)}
          >
            <span className="tag-dot" style={{ backgroundColor: tag.color }} aria-hidden="true" />
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
