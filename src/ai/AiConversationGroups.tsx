import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '../library/libraryService';
import type { AiService } from './aiService';

export function AiConversationGroups({ ai, disabled, selectedId, onSelect, historyListId }: {
  ai: AiService; disabled: boolean; selectedId: string | null | undefined; onSelect(id: string | null | undefined): void; historyListId: string;
}) {
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const groups = activity.conversationGroups ?? [];
  const conversations = activity.conversations ?? [];
  const selected = groups.find((group) => group.id === selectedId);
  const [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string; order: string[]; targetId?: string; pointerId: number; startX: number; startY: number; active: boolean;
  } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const orderPanel = useRef<HTMLDetailsElement>(null);
  const groupList = useRef<HTMLUListElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const target = groups.find((group) => group.id === pendingDelete);
  const count = (id: string | null) => conversations.filter((entry) => (entry.groupId ?? null) === id).length;

  useEffect(() => {
    if (selectedId && !selected) onSelect(undefined);
  }, [selectedId, selected, onSelect]);

  useEffect(() => {
    if (disabled || groups.length < 2) setDrag(null);
  }, [disabled, groups.length]);

  useEffect(() => {
    if (!disabled && focusId) {
      if (orderPanel.current?.open) handles.current.get(focusId)?.focus();
      setFocusId(null);
    }
  }, [disabled, focusId, groups]);

  function groupTargetAtPoint(x: number, y: number): string | undefined {
    const row = document.elementFromPoint(x, y)?.closest<HTMLLIElement>('li[data-ai-group-id]');
    return row && groupList.current?.contains(row) ? row.dataset.aiGroupId : undefined;
  }

  useEffect(() => {
    if (!drag?.active) return;
    let frame: number;
    const scroll = () => {
      const list = groupList.current;
      if (list) {
        const rect = list.getBoundingClientRect();
        const { x, y } = pointer.current;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          const before = list.scrollTop;
          list.scrollTop += y < rect.top + 32 ? -10 : y > rect.bottom - 32 ? 10 : 0;
          if (list.scrollTop !== before) {
            const targetId = groupTargetAtPoint(x, y);
            setDrag((current) => current && current.targetId !== targetId ? { ...current, targetId } : current);
          }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [drag?.active]);

  function choose(id: string | null | undefined) {
    onSelect(id);
    setEditing(null); setPendingDelete(null); setError(null); setNotice(null); setDrag(null);
  }

  async function moveGroup(id: string, targetId: string, order = groups.map((group) => group.id)) {
    if (disabled || id === targetId) return;
    setError(null); setNotice(null);
    if (order.length !== groups.length || order.some((item, index) => item !== groups[index].id)) {
      setError('会话分组列表已变化，请重新拖拽排序。');
      return;
    }
    const from = order.indexOf(id);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    next.splice(from, 1); next.splice(to, 0, id);
    try { await ai.reorderConversationGroups(next); setNotice('分组顺序已保存。'); }
    catch (failure) { setError(errorMessage(failure)); }
    setFocusId(id);
  }

  async function save() {
    if (disabled || !editing) return;
    setError(null); setNotice(null);
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
    setError(null); setNotice(null);
    try {
      await ai.deleteConversationGroup(id);
      if (selectedId === id) onSelect(undefined);
      setPendingDelete(null);
    } catch (failure) { setError(errorMessage(failure)); }
  }

  async function setCollapsed(id: string, collapsed: boolean) {
    if (disabled) return;
    setError(null); setNotice(null);
    try {
      await ai.setConversationGroupCollapsed(id, collapsed);
      setNotice(collapsed ? '分组已折叠。' : '分组已展开。');
    } catch (failure) { setError(errorMessage(failure)); }
  }

  return <section className="ai-history-groups" aria-label="会话分组管理">
    <label><span>会话分组</span><select aria-label="筛选会话分组" disabled={!activity.sessionLoaded || activity.conversationBusy}
      value={selectedId === undefined ? 'all' : selectedId ?? ''} onChange={(event) => {
        choose(event.target.value === 'all' ? undefined : event.target.value || null);
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
    {groups.length ? <ul className="ai-group-collapse-list" aria-label="分组展开状态">
      {groups.map((group) => <li key={group.id}>
        <button type="button" disabled={disabled} className={selectedId === group.id ? 'is-active' : ''}
          aria-label={`${group.collapsed ? '展开' : '折叠'}分组 ${group.name}`} aria-expanded={!group.collapsed}
          aria-controls={historyListId} title={group.name} onClick={() => void setCollapsed(group.id, !group.collapsed)}>
          {group.collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          <span>{group.name}</span><small>{count(group.id)}</small>
        </button>
      </li>)}
    </ul> : null}
    {groups.length > 1 ? <details className="ai-group-order" ref={orderPanel}
      onToggle={(event) => { if (!event.currentTarget.open) setDrag(null); }}>
      <summary>调整分组顺序</summary>
      <p className="ai-muted">拖动左侧手柄排序，也可聚焦手柄用 ↑ / ↓ 调整。</p>
      <ul className="ai-history-list ai-group-order-list" aria-label="分组排序" ref={groupList}>
        {groups.map((group) => <li key={group.id} data-ai-group-id={group.id} className={[
          selectedId === group.id && 'is-active', drag?.active && drag.id === group.id && 'is-dragging',
          drag && drag.targetId === group.id && (drag.order.indexOf(drag.id) < drag.order.indexOf(group.id) ? 'drop-after' : 'drop-before'),
        ].filter(Boolean).join(' ')}>
          <button type="button" className="ai-history-drag-handle" disabled={disabled} draggable={false}
            aria-label={`拖动排序分组 ${group.name}`} title="拖动排序，也可用上下方向键移动"
            ref={(node) => { if (node) handles.current.set(group.id, node); else handles.current.delete(group.id); }}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0 || event.isPrimary === false) return;
              event.preventDefault(); event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.focus();
              pointer.current = { x: event.clientX, y: event.clientY };
              setError(null); setNotice(null);
              setDrag({ id: group.id, order: groups.map((item) => item.id), pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false });
            }}
            onPointerMove={(event) => {
              if (!drag || event.pointerId !== drag.pointerId || disabled) return;
              event.preventDefault(); event.stopPropagation();
              pointer.current = { x: event.clientX, y: event.clientY };
              if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
              const targetId = groupTargetAtPoint(event.clientX, event.clientY);
              if (!drag.active || drag.targetId !== targetId) setDrag({ ...drag, active: true, targetId });
            }}
            onPointerUp={(event) => {
              if (!drag || event.pointerId !== drag.pointerId) return;
              event.preventDefault(); event.stopPropagation();
              const moving = drag;
              setDrag(null);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              const targetId = moving.active ? groupTargetAtPoint(event.clientX, event.clientY) : undefined;
              if (targetId) void moveGroup(moving.id, targetId, moving.order);
            }} onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); setDrag(null); return; }
              if (disabled || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault(); event.stopPropagation();
              const target = groups[groups.findIndex((item) => item.id === group.id) + (event.key === 'ArrowUp' ? -1 : 1)];
              if (target) void moveGroup(group.id, target.id);
            }}><GripVertical size={14} aria-hidden="true" /></button>
          <button type="button" className="ai-group-order-select" aria-label={`查看分组 ${group.name}`}
            aria-current={selectedId === group.id ? 'true' : undefined} disabled={!activity.sessionLoaded || activity.conversationBusy}
            title={group.name} onClick={() => choose(group.id)}><span>{group.name}</span><small>{count(group.id)}</small></button>
        </li>)}
      </ul>
    </details> : null}
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
    {notice ? <p className="ai-muted" role="status">{notice}</p> : null}
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
