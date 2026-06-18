import { Tags, X } from 'lucide-react';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { PersistenceApi } from '../persistence/persistenceApi';
import { addOrReplaceTag, removeTag } from './tagStore';
import { TagEditor } from './TagEditor';
import { TagList } from './TagList';
import type { Tag } from './tagModels';

type TagManagerProps = {
  tags: Tag[];
  persistence: PersistenceApi;
  onTagsChange: Dispatch<SetStateAction<Tag[]>>;
  onClose(): void;
};

export function TagManager({ tags, persistence, onTagsChange, onClose }: TagManagerProps) {
  const [activeTagId, setActiveTagId] = useState<number | null>(tags[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const activeTag = useMemo(
    () => tags.find((tag) => tag.id === activeTagId) ?? tags[0] ?? null,
    [activeTagId, tags],
  );
  const totalRelations = tags.reduce(
    (sum, tag) => sum + tag.documentCount + tag.annotationCount,
    0,
  );

  useEffect(() => {
    if (!activeTag && tags.length > 0) {
      setActiveTagId(tags[0].id);
    }
  }, [activeTag, tags]);

  return (
    <section className="tag-manager-workspace" aria-label="标签管理工作区">
      <header className="workspace-header">
        <div>
          <p>Tags</p>
          <h1>标签管理</h1>
        </div>
        <div className="workspace-summary" aria-label="标签统计">
          <span>{tags.length} 个标签</span>
          <span>{totalRelations} 个关联</span>
        </div>
        <button type="button" aria-label="关闭标签管理" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tag-manager-body">
        <TagList
          tags={tags}
          activeTagId={activeTag?.id ?? null}
          onSelectTag={(tag) => setActiveTagId(tag.id)}
        />
        <TagEditor
          tags={tags}
          activeTag={activeTag}
          creating={saving}
          saving={saving}
          onCreate={async (name, color) => {
            setSaving(true);
            try {
              const tag = await persistence.createTag({ name, color });
              onTagsChange((current) => addOrReplaceTag(current, tag));
              setActiveTagId(tag.id);
            } finally {
              setSaving(false);
            }
          }}
          onRename={async (tag, name) => {
            setSaving(true);
            try {
              const renamedTag = await persistence.renameTag(tag.id, name);
              onTagsChange((current) => addOrReplaceTag(current, renamedTag));
              setActiveTagId(renamedTag.id);
            } finally {
              setSaving(false);
            }
          }}
          onDelete={async (tag) => {
            setSaving(true);
            try {
              await persistence.deleteTag(tag.id);
              onTagsChange((current) => removeTag(current, tag.id));
              setActiveTagId(null);
            } finally {
              setSaving(false);
            }
          }}
          onMerge={async (sourceTag, targetTag) => {
            setSaving(true);
            try {
              const mergedTag = await persistence.mergeTags({
                sourceTagId: sourceTag.id,
                targetTagId: targetTag.id,
              });
              onTagsChange((current) =>
                addOrReplaceTag(removeTag(current, sourceTag.id), mergedTag),
              );
              setActiveTagId(mergedTag.id);
            } finally {
              setSaving(false);
            }
          }}
        />
        {tags.length === 0 ? (
          <aside className="tag-manager-empty" aria-label="标签空状态">
            <Tags size={22} />
            <strong>还没有标签</strong>
            <span>先创建一个标签，再把它附加到文档或批注。</span>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
