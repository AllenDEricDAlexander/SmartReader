import { History, LockKeyhole, MessageSquarePlus, PencilLine, Search, Trash2, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AiConversationSummary } from '../library/libraryModels';
import { errorMessage } from '../library/libraryService';
import type { AiService } from './aiService';

export function AiConversationHistory({ ai, disabled }: { ai: AiService; disabled: boolean }) {
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const conversations = activity.conversations;
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{
    source: AiConversationSummary[]; query: string; entries: AiConversationSummary[]; error?: string;
  } | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  async function perform(action: () => Promise<void>) {
    if (disabled) return;
    setError(null);
    try { await action(); setPendingDelete(null); setPendingRename(null); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  return <aside className="ai-history-panel" aria-label="历史会话">
    <div className="ai-history-heading"><History size={17} /><h2>历史会话</h2></div>
    <button type="button" className="ai-new-conversation" disabled={disabled}
      onClick={() => void perform(async () => { await ai.createConversation(); setQuery(''); })}><MessageSquarePlus size={16} />新建对话</button>
    <p className="ai-muted">每个会话独立保存聊天、草稿和文献范围。</p>
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
    <ul className="ai-history-list">
      {entries.map((entry) => <li key={entry.id} className={entry.id === activity.activeConversationId ? 'is-active' : ''}>
        <button type="button" className="ai-history-select" disabled={disabled}
          title={entry.title} aria-label={`打开会话 ${entry.title}`} aria-current={entry.id === activity.activeConversationId ? 'true' : undefined}
          onClick={() => void perform(() => ai.selectConversation(entry.id))}>
          <strong>{`${entry.title} · ${entry.locked ? '待解锁' : entry.messageCount === null ? '已加密' : `${Math.floor(entry.messageCount / 2)} 轮`}`}</strong>
          <span>{entry.locked ? <LockKeyhole size={12} /> : null}<time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString()}</time></span>
        </button>
        <div className="ai-history-actions">
          <button type="button" disabled={disabled || entry.locked} aria-label={`重命名会话 ${entry.title}`}
            onClick={() => { setError(null); setPendingDelete(null); setPendingRename({ id: entry.id, name: entry.title }); }}><PencilLine size={14} /></button>
          <button type="button" className="ai-history-delete" disabled={disabled} aria-label={`删除会话 ${entry.title}`}
            onClick={() => { setError(null); setPendingRename(null); setPendingDelete(entry.id); }}><Trash2 size={14} /></button>
        </div>
      </li>)}
    </ul>
  </aside>;
}
