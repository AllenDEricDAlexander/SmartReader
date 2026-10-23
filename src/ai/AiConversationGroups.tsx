import { useEffect, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '../library/libraryService';
import type { AiService } from './aiService';

export function AiConversationGroups({ ai, disabled, selectedId, onSelect }: {
  ai: AiService; disabled: boolean; selectedId: string | null | undefined; onSelect(id: string | null | undefined): void;
}) {
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const groups = activity.conversationGroups ?? [];
  const conversations = activity.conversations ?? [];
  const selected = groups.find((group) => group.id === selectedId);
  const [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = groups.find((group) => group.id === pendingDelete);
  const count = (id: string | null) => conversations.filter((entry) => (entry.groupId ?? null) === id).length;

  useEffect(() => {
    if (selectedId && !selected) onSelect(undefined);
  }, [selectedId, selected, onSelect]);

  async function save() {
    if (disabled || !editing) return;
    setError(null);
    try {
      if (editing.id === null) {
        const group = await ai.createConversationGroup(editing.name);
        onSelect(group.id);
      } else await ai.renameConversationGroup(editing.id, editing.name);
      setEditing(null);
    } catch (failure) { setError(errorMessage(failure)); }
  }

  async function remove(id: string) {
    if (disabled) return;
    setError(null);
    try {
      await ai.deleteConversationGroup(id);
      if (selectedId === id) onSelect(undefined);
      setPendingDelete(null);
    } catch (failure) { setError(errorMessage(failure)); }
  }

  return <section className="ai-history-groups" aria-label="会话分组管理">
    <label><span>会话分组</span><select aria-label="筛选会话分组" disabled={!activity.sessionLoaded || activity.conversationBusy}
      value={selectedId === undefined ? 'all' : selectedId ?? ''} onChange={(event) => {
        onSelect(event.target.value === 'all' ? undefined : event.target.value || null);
        setEditing(null); setPendingDelete(null); setError(null);
      }}>
      <option value="all">全部会话（{conversations.length}）</option>
      <option value="">未分组（{count(null)}）</option>
      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}（{count(group.id)}）</option>)}
    </select></label>
    <div className="ai-history-group-actions">
      <button type="button" disabled={disabled} onClick={() => { setError(null); setPendingDelete(null); setEditing({ id: null, name: '' }); }}>新建分组</button>
      <button type="button" disabled={disabled || !selected} onClick={() => {
        if (selected) { setError(null); setPendingDelete(null); setEditing({ id: selected.id, name: selected.name }); }
      }}>重命名分组</button>
      <button type="button" disabled={disabled || !selected} onClick={() => {
        if (selected) { setError(null); setEditing(null); setPendingDelete(selected.id); }
      }}>删除分组</button>
    </div>
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
    {editing ? <form className="ai-history-confirm ai-history-rename" aria-label={editing.id === null ? '新建会话分组' : '重命名会话分组'}
      onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label><span>分组名称</span><input aria-label="分组名称" autoFocus required maxLength={100} disabled={disabled}
        value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })}
        onKeyDown={(event) => { if (event.key === 'Escape' && !disabled) setEditing(null); }} /></label>
      <div className="ai-form-actions">
        <button type="submit" disabled={disabled || !editing.name.trim()}>保存分组</button>
        <button type="button" disabled={disabled} onClick={() => setEditing(null)}>取消</button>
      </div>
    </form> : null}
    {target ? <div className="ai-history-confirm" role="group" aria-label="确认删除会话分组">
      <p>删除分组“{target.name}”？其中的 {count(target.id)} 个会话将移到“未分组”，聊天记录和上下文继续保留。</p>
      <div className="ai-form-actions">
        <button type="button" disabled={disabled} onClick={() => void remove(target.id)}>确认删除分组</button>
        <button type="button" disabled={disabled} onClick={() => setPendingDelete(null)}>取消</button>
      </div>
    </div> : null}
  </section>;
}
