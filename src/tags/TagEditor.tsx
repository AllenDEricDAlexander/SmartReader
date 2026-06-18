import { GitMerge, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Tag } from './tagModels';

type TagEditorProps = {
  tags: Tag[];
  activeTag: Tag | null;
  creating?: boolean;
  saving?: boolean;
  onCreate(name: string, color: string): void | Promise<void>;
  onRename(tag: Tag, name: string): void | Promise<void>;
  onDelete(tag: Tag): void | Promise<void>;
  onMerge(sourceTag: Tag, targetTag: Tag): void | Promise<void>;
};

const defaultColor = '#2563eb';
const tagColors = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'];

export function TagEditor({
  tags,
  activeTag,
  creating,
  saving,
  onCreate,
  onRename,
  onDelete,
  onMerge,
}: TagEditorProps) {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(defaultColor);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState(activeTag?.name ?? '');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const mergeTargets = useMemo(
    () => tags.filter((tag) => activeTag && tag.id !== activeTag.id),
    [activeTag, tags],
  );

  useEffect(() => {
    setRenameValue(activeTag?.name ?? '');
    setMergeTargetId('');
  }, [activeTag]);

  return (
    <section className="tag-editor" aria-label="标签编辑器">
      <form
        className="settings-card"
        onSubmit={async (event) => {
          event.preventDefault();
          const name = newName.trim();

          if (!name) {
            return;
          }

          setCreateError(null);

          try {
            await onCreate(name, newColor);
            setNewName('');
            setNewColor(defaultColor);
          } catch {
            setCreateError('标签创建失败，请重试。');
          }
        }}
      >
        <div className="panel-title">
          <Plus size={16} />
          <h2>新建标签</h2>
        </div>
        <label className="settings-field">
          <span>标签名称</span>
          <input
            aria-label="标签名称"
            value={newName}
            placeholder="例如：论文"
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
        {createError ? (
          <p className="settings-error" role="status">
            {createError}
          </p>
        ) : null}
        <div className="settings-field">
          <span>颜色</span>
          <div className="color-swatch-row" role="radiogroup" aria-label="标签颜色">
            {tagColors.map((color) => (
              <button
                key={color}
                type="button"
                className={color === newColor ? 'color-swatch active' : 'color-swatch'}
                style={{ backgroundColor: color }}
                aria-label={`选择颜色 ${color}`}
                aria-pressed={color === newColor}
                onClick={() => setNewColor(color)}
              />
            ))}
          </div>
        </div>
        <button type="submit" className="primary-action" disabled={creating || !newName.trim()}>
          <Plus size={14} />
          创建标签
        </button>
      </form>

      <section className="settings-card" aria-labelledby="active-tag-title">
        <div className="panel-title">
          <Save size={16} />
          <h2 id="active-tag-title">标签详情</h2>
        </div>
        {activeTag ? (
          <>
            <div className="tag-detail-heading">
              <span
                className="tag-detail-dot"
                style={{ backgroundColor: activeTag.color }}
                aria-hidden="true"
              />
              <div>
                <strong>{activeTag.name}</strong>
                <small>
                  {activeTag.documentCount} 个文档 · {activeTag.annotationCount} 条批注
                </small>
              </div>
            </div>
            <label className="settings-field">
              <span>重命名</span>
              <input
                aria-label="重命名标签"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={saving || !renameValue.trim() || renameValue.trim() === activeTag.name}
              onClick={() => void onRename(activeTag, renameValue.trim())}
            >
              <Save size={14} />
              保存名称
            </button>
            <div className="settings-field">
              <span>合并到</span>
              <select
                aria-label="合并目标标签"
                value={mergeTargetId}
                disabled={mergeTargets.length === 0}
                onChange={(event) => setMergeTargetId(event.target.value)}
              >
                <option value="">选择目标标签</option>
                {mergeTargets.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-action-row">
              <button
                type="button"
                disabled={saving || !mergeTargetId}
                onClick={() => {
                  const targetTag = tags.find((tag) => String(tag.id) === mergeTargetId);

                  if (!targetTag) {
                    return;
                  }

                  if (window.confirm(`将“${activeTag.name}”合并到“${targetTag.name}”？`)) {
                    void onMerge(activeTag, targetTag);
                  }
                }}
              >
                <GitMerge size={14} />
                合并标签
              </button>
              <button
                type="button"
                className="danger-action"
                disabled={saving}
                onClick={() => {
                  if (window.confirm(`删除标签“${activeTag.name}”？`)) {
                    void onDelete(activeTag);
                  }
                }}
              >
                <Trash2 size={14} />
                删除标签
              </button>
            </div>
          </>
        ) : (
          <div className="empty-block compact">
            <strong>选择一个标签</strong>
            <span>可查看关系计数、重命名、合并或删除。</span>
          </div>
        )}
      </section>
    </section>
  );
}
