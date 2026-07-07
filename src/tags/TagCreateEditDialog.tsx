import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { TagDashboardTagRow } from './tagModels';

type TagCreateEditDialogProps = {
  mode: 'create' | 'edit' | 'merge' | null;
  tag: TagDashboardTagRow | null;
  tags: TagDashboardTagRow[];
  saving: boolean;
  error: string | null;
  onClose(): void;
  onCreate(name: string, color: string): void;
  onRename(tag: TagDashboardTagRow, name: string): void;
  onMerge(source: TagDashboardTagRow, targetId: number): void;
};

const colors = ['#2563eb', '#f97316', '#22c55e', '#8b5cf6', '#ec4899', '#14b8a6', '#facc15', '#94a3b8'];

export function TagCreateEditDialog({ mode, tag, tags, saving, error, onClose, onCreate, onRename, onMerge }: TagCreateEditDialogProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(colors[0]);
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    setName(tag?.name ?? '');
    setColor(tag?.color ?? colors[0]);
    setTargetId('');
  }, [mode, tag]);

  if (!mode) {
    return null;
  }

  const title = mode === 'create' ? '创建标签' : mode === 'edit' ? '编辑标签' : '合并标签';

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'create') {
      onCreate(name.trim(), color);
    }
    if (mode === 'edit' && tag) {
      onRename(tag, name.trim());
    }
    if (mode === 'merge' && tag && targetId) {
      onMerge(tag, Number(targetId));
    }
  }

  return (
    <div className="tag-dialog-backdrop" role="presentation">
      <form className="tag-dialog" aria-label={title} onSubmit={handleSubmit}>
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="关闭弹窗" onClick={onClose}><X size={15} /></button>
        </header>
        {mode === 'merge' ? (
          <label>
            <span>合并到</span>
            <select aria-label="合并目标标签" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              <option value="">选择目标标签</option>
              {tags.filter((item) => item.id !== tag?.id).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              <span>标签名称</span>
              <input aria-label="标签名称" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="tag-dialog-colors" role="radiogroup" aria-label="标签颜色">
              {colors.map((item) => (
                <button key={item} type="button" aria-label={`选择颜色 ${item}`} aria-pressed={item === color} style={{ backgroundColor: item }} onClick={() => setColor(item)} />
              ))}
            </div>
          </>
        )}
        {error ? <p className="settings-error" role="alert">{error}</p> : null}
        <footer>
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className="tag-dashboard-primary" disabled={saving || (mode !== 'merge' && !name.trim()) || (mode === 'merge' && !targetId)}>{saving ? '保存中...' : '确认'}</button>
        </footer>
      </form>
    </div>
  );
}
