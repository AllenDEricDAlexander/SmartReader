import { GripVertical, History, LockKeyhole, MessageSquarePlus, PencilLine, Pin, PinOff, Search, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MAX_PINNED_AI_CONVERSATIONS, type AiConversationSummary } from '../library/libraryModels';
import { errorMessage } from '../library/libraryService';
import type { AiService } from './aiService';

export function AiConversationHistory({ ai, disabled }: { ai: AiService; disabled: boolean }) {
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const conversations = activity.conversations;
  const pinnedCount = conversations?.filter((entry) => entry.pinned).length ?? 0;
  const pinnedOrder = conversations?.filter((entry) => entry.pinned).map((entry) => entry.id) ?? [];
  const pinLimitReached = pinnedCount >= MAX_PINNED_AI_CONVERSATIONS;
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{
    source: AiConversationSummary[]; query: string; entries: AiConversationSummary[]; error?: string;
  } | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string; order: string[]; targetId?: string; pointerId: number; startX: number; startY: number; active: boolean;
  } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const historyList = useRef<HTMLUListElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const currentSearch = searchResult?.source === conversations && searchResult?.query === query ? searchResult : null;
  const entries = currentSearch?.entries ?? (query.trim() ? [] : conversations ?? []);
  const target = entries.find((entry) => entry.id === pendingDelete) ?? conversations?.find((entry) => entry.id === pendingDelete);
  const renameTarget = conversations?.find((entry) => entry.id === pendingRename?.id);

  useEffect(() => {
    setSearchResult(null);
    if (!activity.sessionLoaded || !conversations) return;
    const controller = new AbortController();
    void ai.searchConversations(query, controller.signal).then((found) => {
      if (!controller.signal.aborted) setSearchResult({ source: conversations, query, entries: found });
    }).catch((failure) => {
      if (!controller.signal.aborted) setSearchResult({ source: conversations, query, entries: query.trim() ? [] : conversations, error: errorMessage(failure) });
    });
    return () => controller.abort();
  }, [ai, activity.sessionLoaded, conversations, query, searchRetry]);

  useEffect(() => {
    if (!renameTarget || renameTarget.locked) setPendingRename(null);
  }, [renameTarget]);

  useEffect(() => {
    if (disabled) setDrag(null);
  }, [disabled]);

  useEffect(() => {
    const handle = focusId ? handles.current.get(focusId) : undefined;
    if (!disabled && handle) { handle.focus(); setFocusId(null); }
  }, [disabled, focusId, entries]);

  function pinnedTargetAtPoint(x: number, y: number): string | undefined {
    const row = document.elementFromPoint(x, y)?.closest<HTMLLIElement>('li[data-ai-conversation-id][data-ai-pinned="true"]');
    return row && historyList.current?.contains(row) ? row.dataset.aiConversationId : undefined;
  }

  useEffect(() => {
    if (!drag?.active) return;
    let frame: number;
    const scroll = () => {
      const panel = historyList.current?.parentElement;
      if (panel) {
        const rect = panel.getBoundingClientRect();
        const { x, y } = pointer.current;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          const before = panel.scrollTop;
          panel.scrollTop += y < rect.top + 32 ? -10 : y > rect.bottom - 32 ? 10 : 0;
          if (panel.scrollTop !== before) {
            const targetId = pinnedTargetAtPoint(x, y);
            setDrag((current) => current && current.targetId !== targetId ? { ...current, targetId } : current);
          }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [drag?.active]);

  async function perform(action: () => Promise<void>) {
    if (disabled) return false;
    setError(null);
    setNotice(null);
    try { await action(); setPendingDelete(null); setPendingRename(null); return true; }
    catch (failure) { setError(errorMessage(failure)); return false; }
  }

  async function movePinned(id: string, targetId: string, order = pinnedOrder) {
    if (disabled || id === targetId) return;
    if (order.length !== pinnedOrder.length || order.some((item, index) => item !== pinnedOrder[index])) {
      setError('置顶会话列表已变化，请重新拖拽排序。');
      return;
    }
    const from = order.indexOf(id);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    if (await perform(() => ai.reorderPinnedConversations(next))) setNotice('置顶顺序已保存。');
    setFocusId(id);
  }

  return <aside className="ai-history-panel" aria-label="历史会话">
    <div className="ai-history-heading"><History size={17} /><h2>历史会话</h2>
      <span className="ai-history-pin-count">已置顶 {pinnedCount}/{MAX_PINNED_AI_CONVERSATIONS}</span>
    </div>
    <button type="button" className="ai-new-conversation" disabled={disabled}
      onClick={() => void perform(async () => { await ai.createConversation(); setQuery(''); })}><MessageSquarePlus size={16} />新建对话</button>
    <p className="ai-muted">每个会话独立保存聊天、草稿和文献范围。</p>
    {pinnedCount > 1 ? <p className="ai-muted">拖动置顶会话左侧手柄排序，也可聚焦手柄用 ↑ / ↓ 调整。</p> : null}
    {pinLimitReached ? <p className="ai-muted" role="status">置顶已达上限，请先取消其他会话的置顶。</p> : null}
    <label className="ai-history-search"><Search size={15} aria-hidden="true" />
      <input type="search" aria-label="搜索历史会话" placeholder="搜索标题或聊天内容" value={query} disabled={!activity.sessionLoaded}
        onChange={(event) => setQuery(event.target.value)} />
      {query ? <button type="button" aria-label="清空会话搜索" onClick={() => setQuery('')}><X size={14} /></button> : null}
    </label>
    {query.trim() && !currentSearch ? <p className="ai-muted" role="status">正在搜索会话…</p> : null}
    {query.trim() && currentSearch && !currentSearch.error ? <p className="ai-muted" role="status">
      {entries.length ? `找到 ${entries.length} 个会话` : '没有匹配的会话。'}
    </p> : null}
    {conversations?.some((entry) => entry.locked) ? <p className="ai-muted">加密会话需解锁相关文件夹后才能重命名和搜索。</p> : null}
    {currentSearch?.error ? <div className="settings-error" role="alert">搜索会话失败：{currentSearch.error}
      <button type="button" onClick={() => { setSearchResult(null); setSearchRetry((value) => value + 1); }}>重试搜索</button>
    </div> : null}
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
    {notice ? <p className="ai-muted" role="status">{notice}</p> : null}
    {pendingRename && renameTarget && !renameTarget.locked ? <form className="ai-history-confirm ai-history-rename" aria-label="重命名历史会话"
      onSubmit={(event) => { event.preventDefault(); void perform(() => ai.renameConversation(pendingRename.id, pendingRename.name)); }}>
      <label><span>会话名称</span><input aria-label="会话名称" autoFocus required maxLength={100} disabled={disabled}
        value={pendingRename.name} onChange={(event) => setPendingRename({ ...pendingRename, name: event.target.value })}
        onKeyDown={(event) => { if (event.key === 'Escape' && !disabled) setPendingRename(null); }} /></label>
      <p className="ai-muted">最多 100 个字符，聊天记录和上下文继续保留。</p>
      <div className="ai-form-actions">
        <button type="submit" disabled={disabled || !pendingRename.name.trim()}>保存名称</button>
        <button type="button" disabled={disabled} onClick={() => setPendingRename(null)}>取消</button>
      </div>
    </form> : null}
    {target ? <div className="ai-history-confirm" role="group" aria-label="确认删除历史会话">
      <p>删除“{target.title}”？该会话的聊天记录和上下文将从本机移除。</p>
      <div className="ai-form-actions">
        <button type="button" disabled={disabled} onClick={() => void perform(() => ai.deleteConversation(target.id))}>确认删除会话</button>
        <button type="button" disabled={disabled} onClick={() => setPendingDelete(null)}>取消</button>
      </div>
    </div> : null}
    <ul className="ai-history-list" ref={historyList}>
      {entries.map((entry) => <li key={entry.id} className={[
        entry.id === activity.activeConversationId && 'is-active', drag?.active && drag.id === entry.id && 'is-dragging',
        drag && drag.targetId === entry.id && (drag.order.indexOf(drag.id) < drag.order.indexOf(entry.id) ? 'drop-after' : 'drop-before'),
      ].filter(Boolean).join(' ')} data-ai-conversation-id={entry.id} data-ai-pinned={Boolean(entry.pinned)}>
        {entry.pinned ? <button type="button" className="ai-history-drag-handle" disabled={disabled || pinnedCount < 2}
          ref={(node) => { if (node) handles.current.set(entry.id, node); else handles.current.delete(entry.id); }}
          draggable={false} aria-label={`拖动排序置顶会话 ${entry.title}`} title="拖动排序，也可用上下方向键移动"
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (disabled || pinnedCount < 2 || event.button !== 0 || event.isPrimary === false) return;
            event.preventDefault(); event.stopPropagation();
            // Pointer capture keeps sorting compatible with Tauri's native file drops.
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus();
            pointer.current = { x: event.clientX, y: event.clientY };
            setError(null); setNotice(null);
            setDrag({ id: entry.id, order: [...pinnedOrder], pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false });
          }}
          onPointerMove={(event) => {
            if (!drag || event.pointerId !== drag.pointerId || disabled) return;
            event.preventDefault(); event.stopPropagation();
            pointer.current = { x: event.clientX, y: event.clientY };
            if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
            const targetId = pinnedTargetAtPoint(event.clientX, event.clientY);
            if (!drag.active || drag.targetId !== targetId) setDrag({ ...drag, active: true, targetId });
          }}
          onPointerUp={(event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            event.preventDefault(); event.stopPropagation();
            const moving = drag;
            setDrag(null);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            const targetId = moving.active ? pinnedTargetAtPoint(event.clientX, event.clientY) : undefined;
            if (targetId) void movePinned(moving.id, targetId, moving.order);
          }}
          onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); setDrag(null); return; }
            if (disabled || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const targetId = pinnedOrder[pinnedOrder.indexOf(entry.id) + (event.key === 'ArrowUp' ? -1 : 1)];
            if (targetId) void movePinned(entry.id, targetId);
          }}><GripVertical size={14} aria-hidden="true" /></button> : null}
        <button type="button" className="ai-history-select" disabled={disabled}
          title={entry.title} aria-label={`打开会话 ${entry.title}`} aria-current={entry.id === activity.activeConversationId ? 'true' : undefined}
          onClick={() => void perform(() => ai.selectConversation(entry.id))}>
          <strong>{`${entry.title} · ${entry.locked ? '待解锁' : entry.messageCount === null ? '已加密' : `${Math.floor(entry.messageCount / 2)} 轮`}`}</strong>
          <span>{entry.pinned ? <span className="ai-history-pinned"><Pin size={12} aria-hidden="true" />置顶</span> : null}
            {entry.locked ? <LockKeyhole size={12} /> : null}<time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString()}</time>
          </span>
        </button>
        <div className="ai-history-actions">
          <button type="button" className="ai-history-pin" disabled={disabled || (!entry.pinned && pinLimitReached)}
            aria-label={`${entry.pinned ? '取消置顶' : '置顶'}会话 ${entry.title}`} aria-pressed={Boolean(entry.pinned)}
            title={!entry.pinned && pinLimitReached ? `最多置顶 ${MAX_PINNED_AI_CONVERSATIONS} 个会话，请先取消其他会话的置顶。` : entry.pinned ? '取消置顶' : '置顶到历史列表顶部'}
            onClick={() => void perform(() => ai.setConversationPinned(entry.id, !entry.pinned))}>
            {entry.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button type="button" disabled={disabled || entry.locked} aria-label={`重命名会话 ${entry.title}`}
            onClick={() => { setError(null); setPendingDelete(null); setPendingRename({ id: entry.id, name: entry.title }); }}><PencilLine size={14} /></button>
          <button type="button" className="ai-history-delete" disabled={disabled} aria-label={`删除会话 ${entry.title}`}
            onClick={() => { setError(null); setPendingRename(null); setPendingDelete(entry.id); }}><Trash2 size={14} /></button>
        </div>
      </li>)}
    </ul>
  </aside>;
}
