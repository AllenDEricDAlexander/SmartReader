import { History, LockKeyhole, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { errorMessage } from '../library/libraryService';
import type { AiService } from './aiService';

export function AiConversationHistory({ ai, disabled }: { ai: AiService; disabled: boolean }) {
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = activity.conversations?.find((entry) => entry.id === pendingDelete);

  async function perform(action: () => Promise<void>) {
    if (disabled) return;
    setError(null);
    try { await action(); setPendingDelete(null); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  return <aside className="ai-history-panel" aria-label="历史会话">
    <div className="ai-history-heading"><History size={17} /><h2>历史会话</h2></div>
    <button type="button" className="ai-new-conversation" disabled={disabled}
      onClick={() => void perform(() => ai.createConversation())}><MessageSquarePlus size={16} />新建对话</button>
    <p className="ai-muted">每个会话独立保存聊天、草稿和文献范围。</p>
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
    {target ? <div className="ai-history-confirm" role="group" aria-label="确认删除历史会话">
      <p>删除“{target.title}”？该会话的聊天记录和上下文将从本机移除。</p>
      <div className="ai-form-actions">
        <button type="button" disabled={disabled} onClick={() => void perform(() => ai.deleteConversation(target.id))}>确认删除会话</button>
        <button type="button" disabled={disabled} onClick={() => setPendingDelete(null)}>取消</button>
      </div>
    </div> : null}
    <ul className="ai-history-list">
      {activity.conversations?.map((entry) => <li key={entry.id} className={entry.id === activity.activeConversationId ? 'is-active' : ''}>
        <button type="button" className="ai-history-select" disabled={disabled}
          aria-label={`打开会话 ${entry.title}`} aria-current={entry.id === activity.activeConversationId ? 'true' : undefined}
          onClick={() => void perform(() => ai.selectConversation(entry.id))}>
          <strong>{`${entry.title} · ${entry.locked ? '待解锁' : entry.messageCount === null ? '已加密' : `${Math.floor(entry.messageCount / 2)} 轮`}`}</strong>
          <span>{entry.locked ? <LockKeyhole size={12} /> : null}<time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString()}</time></span>
        </button>
        <button type="button" className="ai-history-delete" disabled={disabled} aria-label={`删除会话 ${entry.title}`}
          onClick={() => { setError(null); setPendingDelete(entry.id); }}><Trash2 size={14} /></button>
      </li>)}
    </ul>
  </aside>;
}
