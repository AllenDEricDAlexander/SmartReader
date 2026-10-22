import { ArrowDown, BookOpen, FileSearch, MessageSquarePlus, Plus, Send, Settings, ShieldCheck, Sparkles, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { errorMessage, type LibraryService } from '../library/libraryService';
import type { Paper } from '../library/libraryModels';
import type { AiChatMessage, AiChatTurn, AiRetrieval, AiService, AiSource } from './aiService';
import './aiWorkspace.css';

type AiAssistantProps = {
  library: LibraryService;
  ai: AiService;
  onOpenPaper(id: string, page?: number): void | Promise<void>;
  onOpenSettings?(): void;
  onAddPdfs?(): Promise<string[]>;
  initialPaperId?: string;
};

const retrievalLabels: Record<AiRetrieval, string> = {
  'milvus-vector': 'Milvus 向量检索',
  'local-vector': '本地向量检索',
  fulltext: '本地全文检索',
  none: '未检索文献',
};

export function AiAssistant({ library, ai, onOpenPaper, onOpenSettings, onAddPdfs, initialPaperId }: AiAssistantProps) {
  const libraryView = useSyncExternalStore(library.subscribe, library.getView);
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const session = ai.getAssistantSession();
  const newPaperScope = Boolean(initialPaperId && initialPaperId !== session?.initialPaperId);
  const [scope, setScope] = useState<'all' | 'selected'>(newPaperScope ? 'selected' : session?.scope ?? 'all');
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>(newPaperScope && initialPaperId ? [initialPaperId] : session?.selectedPaperIds ?? []);
  const [fileQuery, setFileQuery] = useState(session?.fileQuery ?? '');
  const [addingFiles, setAddingFiles] = useState(false);
  const [changingKnowledge, setChangingKnowledge] = useState(false);
  const [buildingIndex, setBuildingIndex] = useState(false);
  const ownsBuild = useRef<string[] | null>(null);
  const initialSelection = useRef({ library, id: initialPaperId ?? session?.initialPaperId });
  const [draft, setDraft] = useState({ text: session?.draft ?? '', epoch: activity.answerEpoch });
  const [chat, setChat] = useState<{ messages: AiChatMessage[]; epoch: number }>({ messages: session?.messages ?? [], epoch: activity.answerEpoch });
  const [mode, setMode] = useState<'library' | 'direct' | null>(newPaperScope ? 'library' : session?.mode ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const nextMessageId = useRef((session?.messages.at(-1)?.id ?? 0) + 1);
  const requestGeneration = useRef(0);
  const ownsRequest = useRef(false);
  const mounted = useRef(true);
  const transcriptViewport = useRef<HTMLElement | null>(null);
  const assistantHeader = useRef<HTMLElement | null>(null);
  const questionInput = useRef<HTMLTextAreaElement | null>(null);
  const followingTranscript = useRef(true);
  const provider = libraryView.snapshot.ai.providers.find((item) => item.id === libraryView.snapshot.ai.activeProviderId);
  const configured = Boolean(provider && activity.keyProviderIds.includes(provider.id));
  const busy = pending || activity.asking || addingFiles || buildingIndex || changingKnowledge;
  const cloudKnowledge = libraryView.snapshot.ai.knowledge?.backend === 'milvus';
  const encryptedIds = new Set(libraryView.snapshot.papers.filter((paper) => paper.kind === 'encrypted').map((paper) => paper.id));
  const knowledgePapers = libraryView.papers.filter((paper) => !paper.knowledgeExcluded);
  const removedPapers = libraryView.papers.filter((paper) => paper.knowledgeExcluded);
  const usablePapers = knowledgePapers.filter((paper) => hasKnowledgeText(paper) && (!cloudKnowledge || !encryptedIds.has(paper.id)));
  const vectorConfigured = Boolean(provider?.embeddingModel && configured);
  const selectedIds = selectedPaperIds.filter((id) => usablePapers.some((paper) => paper.id === id));
  const scopedCount = scope === 'all' ? usablePapers.length : selectedIds.length;
  // Without a usable knowledge base the assistant still answers, as a plain
  // model conversation, so a configured provider is never unusable.
  const grounding = mode ?? (usablePapers.length ? 'library' : 'direct');
  const contextKey = grounding === 'direct' ? 'direct' : JSON.stringify(
    (scope === 'all' ? usablePapers.map((paper) => paper.id) : selectedIds).sort(),
  );
  const questionReady = configured
    && (grounding === 'direct' || (scopedCount > 0 && (!cloudKnowledge || (vectorConfigured && activity.milvusReady))));
  const matchingPapers = knowledgePapers.filter((paper) =>
    `${paper.metadata.title} ${paper.fileName}`.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase()));
  const messages = useMemo(
    () => (chat.epoch === activity.answerEpoch ? chat.messages : []),
    [chat, activity.answerEpoch],
  );
  const visibleDraft = draft.epoch === activity.answerEpoch ? draft.text : '';

  useEffect(() => {
    ai.saveAssistantSession({
      epoch: activity.answerEpoch, draft: visibleDraft, scope, selectedPaperIds, fileQuery, mode,
      initialPaperId: initialSelection.current.id,
      // Leaving the panel cancels its request. Keep only finished turns so the
      // restored transcript cannot contain a stranded partial response.
      messages: messages.filter((message, index) => !message.streaming && !messages[index + 1]?.streaming),
    });
  }, [ai, activity.answerEpoch, visibleDraft, scope, selectedPaperIds, fileQuery, mode, messages, initialPaperId]);

  useEffect(() => {
    mounted.current = true;
    void library.initialize().catch((failure: unknown) => {
      if (mounted.current) setError(errorMessage(failure));
    });
    const stopLocked = library.onLocked((ids) => {
      requestGeneration.current += 1;
      ownsRequest.current = false;
      setChat({ messages: [], epoch: ai.getView().answerEpoch });
      setDraft({ text: '', epoch: ai.getView().answerEpoch });
      setSelectedPaperIds((selected) => selected.filter((id) => !ids.includes(id)));
      setPending(false);
      setBuildingIndex(false);
      ownsBuild.current = null;
      setError(null);
      setNotice('文献访问状态已变化，对话和回答已清除。');
    });
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      if (ownsRequest.current) ai.cancelAnswer();
      if (ownsBuild.current) ai.cancelKnowledge(ownsBuild.current);
      ownsRequest.current = false;
      stopLocked();
    };
  }, [library, ai]);

  useEffect(() => {
    if (!libraryView.loaded || !initialPaperId || (initialSelection.current?.library === library && initialSelection.current.id === initialPaperId)) return;
    initialSelection.current = { library, id: initialPaperId };
    setSelectedPaperIds(initialPaperId && library.getPaper(initialPaperId) ? [initialPaperId] : []);
    setScope(initialPaperId ? 'selected' : 'all');
    setMode('library');
  }, [initialPaperId, library, libraryView.loaded]);

  useEffect(() => {
    // Keep the reader's position when they scroll up during a streaming answer.
    if (messages.length && followingTranscript.current) scrollToLatest();
  }, [messages]);

  function scrollToLatest() {
    followingTranscript.current = true;
    setShowLatest(false);
    const viewport = transcriptViewport.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }

  function continueQuestion() {
    followingTranscript.current = false;
    setShowLatest(true);
    // Measure after the header's actions update, including any wrapped row.
    requestAnimationFrame(() => {
      const viewport = transcriptViewport.current;
      const input = questionInput.current;
      const header = assistantHeader.current;
      if (!viewport || !input || !header || input.disabled) return;
      viewport.scrollTop += input.getBoundingClientRect().top - viewport.getBoundingClientRect().top - header.offsetHeight - 32;
      input.focus({ preventScroll: true });
    });
  }

  function updateMessage(generation: number, epoch: number, id: number, change: (message: AiChatMessage) => AiChatMessage) {
    if (!mounted.current || generation !== requestGeneration.current || epoch !== ai.getView().answerEpoch) return;
    setChat((current) => current.epoch !== epoch
      ? current
      : { ...current, messages: current.messages.map((message) => message.id === id ? change(message) : message) });
  }

  async function addPdfs() {
    if (!onAddPdfs || busy) return;
    setAddingFiles(true);
    setError(null);
    setNotice(null);
    try {
      const ids = await onAddPdfs();
      if (!mounted.current) return;
      const accessible = [...new Set(ids)].filter((id) => library.getPaper(id));
      if (accessible.length) {
        const removedIds = accessible.filter((id) => library.getPaper(id)?.knowledgeExcluded);
        if (removedIds.length) await library.batchUpdate(removedIds, { knowledgeExcluded: false });
        if (!mounted.current) return;
        setScope('selected');
        setSelectedPaperIds((selected) => [...new Set([...selected, ...accessible])]);
        setMode('library');
        setNotice(`已添加 ${accessible.length} 份知识库文件。相同 PDF 只保存一份。`);
      } else setNotice('未添加文件，请选择本地 PDF。');
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setAddingFiles(false);
    }
  }

  async function changeKnowledge(paper: Paper, included: boolean) {
    if (busy) return;
    setChangingKnowledge(true);
    setError(null);
    setNotice(null);
    try {
      await library.batchUpdate([paper.id], { knowledgeExcluded: !included });
      if (!mounted.current) return;
      if (included) {
        setScope('selected');
        setSelectedPaperIds((ids) => [...new Set([...ids, paper.id])]);
        setMode('library');
      } else {
        setSelectedPaperIds((ids) => ids.filter((id) => id !== paper.id));
        if (!usablePapers.some((item) => item.id !== paper.id)) setMode(null);
      }
      setNotice(included ? '文件已重新加入知识库。' : '文件已从 AI 知识库移除，文献库中的文献和原始 PDF 均保留。');
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setChangingKnowledge(false);
    }
  }

  async function buildIndex() {
    if (busy || !vectorConfigured || !scopedCount) return;
    const generation = ++requestGeneration.current;
    const ids = scope === 'selected' ? selectedIds : usablePapers.map((paper) => paper.id);
    ownsBuild.current = ids;
    setBuildingIndex(true);
    setError(null);
    setNotice(null);
    try {
      await ai.buildKnowledge(ids);
      if (mounted.current && generation === requestGeneration.current) setNotice('知识库向量索引已建立。');
    } catch (failure) {
      if (mounted.current && generation === requestGeneration.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current && generation === requestGeneration.current) { ownsBuild.current = null; setBuildingIndex(false); }
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const question = visibleDraft.trim();
    if (busy || !questionReady || !question) return;
    const generation = ++requestGeneration.current;
    const epoch = ai.getView().answerEpoch;
    const history: AiChatTurn[] = [];
    for (let index = 0; index < messages.length - 1; index += 2) {
      const previousQuestion = messages[index];
      const answer = messages[index + 1];
      if (previousQuestion.contextKey !== contextKey || answer.error || answer.streaming || !answer.content.trim()) continue;
      history.push({ role: 'user', content: previousQuestion.content }, { role: 'assistant', content: answer.content });
    }
    const answerId = nextMessageId.current + 1;
    nextMessageId.current += 2;
    ownsRequest.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    followingTranscript.current = true;
    setShowLatest(false);
    setDraft({ text: '', epoch });
    setChat((current) => ({
      epoch,
      messages: [
        ...(current.epoch === epoch ? current.messages : []),
        { id: answerId - 1, contextKey, role: 'user', content: question },
        { id: answerId, contextKey, role: 'assistant', content: '', streaming: true },
      ],
    }));
    try {
      const result = await ai.ask(question, {
        history,
        grounding,
        paperIds: grounding === 'library' && scope === 'selected' ? selectedIds : undefined,
        onDelta: (text) => updateMessage(generation, epoch, answerId, (message) => ({ ...message, content: message.content + text })),
        onReasoning: (text) => updateMessage(generation, epoch, answerId, (message) => ({ ...message, reasoning: (message.reasoning ?? '') + text })),
      });
      updateMessage(generation, epoch, answerId, (message) => ({
        ...message, streaming: false, content: result.text,
        sources: result.sources, retrieval: result.retrieval, providerName: result.providerName,
      }));
    } catch (failure) {
      // The failure belongs to this turn, so it is reported on that turn rather
      // than in the panel; a discarded turn takes its error with it.
      updateMessage(generation, epoch, answerId, (current) => ({ ...current, streaming: false, error: errorMessage(failure) }));
    } finally {
      if (mounted.current && generation === requestGeneration.current) {
        ownsRequest.current = false;
        setPending(false);
      }
    }
  }

  function cancel() {
    const epoch = ai.getView().answerEpoch;
    ai.cancelAnswer();
    requestGeneration.current += 1;
    ownsRequest.current = false;
    setPending(false);
    setError(null);
    // A cancelled turn leaves no partial answer in the transcript, so a later
    // follow-up never builds on text the provider never finished. A turn that
    // already completed is kept: there is nothing in flight to withdraw.
    setChat((current) => {
      if (current.epoch !== epoch) return current;
      const streaming = current.messages.find((message) => message.streaming);
      if (!streaming) return current;
      const asked = lastUserId(current.messages);
      return { ...current, messages: current.messages.filter((message) => message.id !== streaming.id && message.id !== asked) };
    });
    setNotice('回答已取消。');
  }

  function cancelIndex() {
    requestGeneration.current += 1;
    ai.cancelKnowledge(ownsBuild.current ?? []);
    ownsBuild.current = null;
    setBuildingIndex(false);
    setNotice('向量构建已取消。');
  }

  function resetChat() {
    if (busy) return;
    requestGeneration.current += 1;
    setChat({ messages: [], epoch: ai.getView().answerEpoch });
    setDraft({ text: '', epoch: ai.getView().answerEpoch });
    setError(null);
    setNotice('已开始新的对话。');
  }

  async function openSource(source: AiSource) {
    const epoch = ai.getView().answerEpoch;
    if (!library.getPaper(source.paperId)) return;
    try {
      await onOpenPaper(source.paperId, source.page);
    } catch (failure) {
      if (mounted.current && epoch === ai.getView().answerEpoch) setError(errorMessage(failure));
    }
  }

  return (
    <section className="ai-assistant" aria-labelledby="ai-assistant-title" ref={transcriptViewport}
      onScroll={(event) => {
        const viewport = event.currentTarget;
        const nearBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48;
        followingTranscript.current = nearBottom;
        setShowLatest(!nearBottom);
      }}>
      <header className="ai-assistant-header" ref={assistantHeader}>
        <div>
          <span className="ai-eyebrow"><Sparkles size={15} />文献研究助手</span>
          <h1 id="ai-assistant-title">让答案回到文献</h1>
          <p>检索本地论文，用有来源的回答辅助阅读；也可以直接和模型对话。</p>
        </div>
        <div className="ai-header-actions">
          {showLatest && messages.length ? <button type="button" onClick={scrollToLatest}><ArrowDown size={16} />回到最新回答</button> : null}
          {!busy && messages.some((message) => message.role === 'assistant' && !message.streaming) ? (
            <button type="button" onClick={continueQuestion}><Send size={15} />继续提问</button>
          ) : null}
          {pending || activity.asking ? <button type="button" onClick={cancel}><Square size={14} />取消回答</button> : null}
          <button type="button" onClick={resetChat} disabled={busy || !messages.length}>
            <MessageSquarePlus size={16} />新建对话
          </button>
          {onOpenSettings ? (
            <button type="button" onClick={onOpenSettings}><Settings size={16} />AI 设置</button>
          ) : null}
        </div>
      </header>
      <div className="ai-assistant-body">
        <div className="ai-question-panel">
          <div className="ai-section-heading">
            <h2><FileSearch size={17} />检索问答</h2>
            <span className="ai-status-badge">{provider?.name ?? '尚未配置'}</span>
          </div>
          {!configured ? (
            <div className="ai-setup-notice">
              <p>请先配置 AI 厂商，并输入或解锁 API Key。</p>
              {onOpenSettings ? <button type="button" onClick={onOpenSettings}>打开 AI 设置</button> : null}
            </div>
          ) : null}
          {configured && grounding === 'library' && cloudKnowledge && !activity.milvusReady ? (
            <p className="settings-error" role="alert">云端检索需要在 AI 设置中输入 Milvus 地址和访问令牌。</p>
          ) : null}
          {configured && grounding === 'library' && cloudKnowledge && !provider?.embeddingModel ? (
            <p className="settings-error" role="alert">云端检索需要在 AI 设置中配置 Embedding 模型；也可以切换为直接与模型对话。</p>
          ) : null}
          <form onSubmit={(event) => void submit(event)}>
            <div className="ai-knowledge-scope" role="group" aria-label="回答方式">
              <label>
                <input type="radio" name="ai-grounding" checked={grounding === 'library'}
                  disabled={busy || !usablePapers.length} onChange={() => setMode('library')} />
                检索本地文献并附来源
              </label>
              <label>
                <input type="radio" name="ai-grounding" checked={grounding === 'direct'}
                  disabled={busy} onChange={() => setMode('direct')} />
                直接与模型对话
              </label>
            </div>
            {grounding === 'direct' ? (
              <p className="ai-muted">{usablePapers.length
                ? '当前回答不检索本地文献，也不会附带来源。'
                : '知识库还没有可检索的文件，当前为纯模型对话。导入 PDF 后可切换为文献检索。'}</p>
            ) : null}
            <fieldset className="ai-knowledge-files" disabled={busy || !libraryView.loaded}>
              <legend>知识库文件</legend>
              <div className="ai-knowledge-actions">
                {onAddPdfs ? <button type="button" onClick={() => void addPdfs()}><Plus size={14} />{addingFiles ? '添加并索引中…' : '添加本地 PDF'}</button> : null}
                <button type="button" disabled={grounding === 'direct' || !vectorConfigured || !scopedCount} onClick={() => void buildIndex()}>重建向量索引</button>
                <span className="ai-muted">{usablePapers.length} 份可检索 · 已选范围 {scopedCount} 份</span>
              </div>
              <p className="ai-muted">{provider?.embeddingModel
                ? `${cloudKnowledge ? '云端 Milvus' : '本地 SQLite 持久化向量'} · ${provider.embeddingModel}`
                : cloudKnowledge ? '云端 Milvus · 尚未配置 Embedding 模型，暂不可检索。'
                  : '当前使用本地全文检索；配置 embedding 模型后启用语义向量检索。'}</p>
              {cloudKnowledge ? <p className="ai-muted">加密文献不加入云端检索；需要时请切换本地模式。</p> : null}
              <p className="ai-muted">移除文件只影响 AI 知识库，文献库中的文献仍会保留，可随时重新加入。</p>
              {!knowledgePapers.length ? <p className="ai-muted">知识库还没有文件。添加 PDF 后会保存到本地文献库并建立索引；仅打开阅读的文件不会自动加入。</p> : <>
                <div className="ai-knowledge-scope" role="group" aria-label="问答范围">
                  <label><input type="radio" name="knowledge-scope" checked={scope === 'all'} disabled={grounding === 'direct'} onChange={() => setScope('all')} />全部可检索文献</label>
                  <label><input type="radio" name="knowledge-scope" checked={scope === 'selected'} disabled={grounding === 'direct'} onChange={() => setScope('selected')} />指定文件（可多选）</label>
                </div>
                <input type="search" aria-label="搜索知识库文件" placeholder="按论文标题或文件名查找" disabled={grounding === 'direct'} value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} />
                <div className="ai-knowledge-list">
                  {matchingPapers.map((paper) => <div className="ai-knowledge-file" key={paper.id}>
                    <label>
                      <input type="checkbox" aria-label={`选择知识库文件 ${paper.metadata.title || paper.fileName}`}
                        checked={scope === 'all' ? usablePapers.some((item) => item.id === paper.id) : selectedIds.includes(paper.id)}
                        disabled={grounding === 'direct' || !hasKnowledgeText(paper) || (cloudKnowledge && encryptedIds.has(paper.id))} onChange={(event) => {
                          const checked = event.target.checked;
                          setSelectedPaperIds((ids) => {
                            const previous = scope === 'all' ? usablePapers.map((item) => item.id) : ids;
                            return checked ? [...new Set([...previous, paper.id])] : previous.filter((id) => id !== paper.id);
                          });
                          setScope('selected');
                        }} />
                      <span><strong>{paper.metadata.title || paper.fileName}</strong><small>{paper.fileName} · {paper.pageCount} 页 · {hasKnowledgeText(paper) ? '文本可检索' : paper.indexStatus === 'pending' ? '正在建立索引' : '没有可检索文本，请重新索引或补充摘要'}</small>
                        {activity.indexingPaperIds?.includes(paper.id) ? <small>正在生成向量…</small> : activity.indexedPaperIds?.includes(paper.id) ? <small>向量已建立</small> : null}
                        {activity.knowledgeErrors?.[paper.id] ? <small className="settings-error">{activity.knowledgeErrors[paper.id]}</small> : null}
                      </span>
                    </label>
                    <button type="button" aria-label={`移除知识库文件 ${paper.metadata.title || paper.fileName}`}
                      title="仅从 AI 知识库移除，保留文献库中的文献" onClick={() => void changeKnowledge(paper, false)}><Trash2 size={14} aria-hidden="true" />移除</button>
                  </div>)}
                  {!matchingPapers.length ? <p className="ai-muted">没有匹配的知识库文件。</p> : null}
                </div>
              </>}
              {removedPapers.length ? <details className="ai-knowledge-removed">
                <summary>已移除文件（{removedPapers.length}）</summary>
                <div className="ai-knowledge-list">
                  {removedPapers.map((paper) => <div className="ai-knowledge-file" key={paper.id}>
                    <span><strong>{paper.metadata.title || paper.fileName}</strong><small>{paper.fileName} · 仍保存在文献库中</small></span>
                    <button type="button" aria-label={`重新加入知识库文件 ${paper.metadata.title || paper.fileName}`}
                      onClick={() => void changeKnowledge(paper, true)}><Plus size={14} aria-hidden="true" />重新加入</button>
                  </div>)}
                </div>
              </details> : null}
              {grounding === 'library' && scope === 'selected' && !scopedCount && knowledgePapers.length ? <p className="ai-muted">请选择至少一份有可检索文本的文件。</p> : null}
            </fieldset>
            <label className="ai-question-field">
              <span>科研问题</span>
              <textarea
                aria-label="科研问题"
                ref={questionInput}
                value={visibleDraft}
                maxLength={4000}
                rows={4}
                placeholder="例如：这些研究对工作记忆的主要结论是什么？可以继续追问。"
                disabled={busy}
                onChange={(event) => setDraft({ text: event.target.value, epoch: ai.getView().answerEpoch })}
              />
            </label>
            <div className="ai-question-footer">
              <small>{visibleDraft.length} / 4000{messages.length ? ` · 已有 ${messages.filter((message) => message.role === 'user').length} 轮提问` : ''}</small>
              <div>
                <button
                  type="submit"
                  className="primary-action"
                  disabled={!questionReady || busy || !visibleDraft.trim()}
                >
                  <Send size={15} />{grounding === 'direct' ? '发送问题' : '检索并提问'}
                </button>
              </div>
            </div>
          </form>
          {buildingIndex ? <div className="ai-knowledge-actions"><span role="status">正在构建知识库向量…</span><button type="button" onClick={cancelIndex}>取消向量构建</button></div> : null}
          <p className="ai-assistant-privacy">
            <ShieldCheck size={15} />相关摘录、对话历史和问题会发送给所选厂商。锁定的文献不参与检索。
          </p>
          {buildingIndex || addingFiles ? (
            <p className="ai-working-message" role="status">{addingFiles ? '正在添加并索引文件…' : '正在构建向量索引…'}</p>
          ) : null}
          {error || libraryView.error ? (
            <p className="settings-error" role="alert">{error ?? libraryView.error}</p>
          ) : null}
          {activity.knowledgeCleanupError ? (
            <p className="settings-error" role="alert">{activity.knowledgeCleanupError}</p>
          ) : null}
          {notice ? <p className="ai-muted" role="status">{notice}</p> : null}
        </div>
        {messages.length ? (
          <div className="ai-chat-transcript" aria-label="AI 对话记录" aria-live="polite">
            {messages.map((message) => message.role === 'user' ? (
              <article className="ai-chat-turn ai-chat-user" key={message.id}>
                <h2>你的问题</h2>
                <div className="ai-answer-text">{message.content}</div>
              </article>
            ) : (
              <article className="ai-chat-turn ai-chat-assistant" key={message.id}>
                <div className="ai-chat-answer-main">
                  <div className="ai-section-heading">
                    <h2>回答</h2>
                    <small>{[message.providerName, message.retrieval ? retrievalLabels[message.retrieval] : null].filter(Boolean).join(' · ')}</small>
                  </div>
                  {message.reasoning ? (
                    <details className="ai-chat-reasoning">
                      <summary>模型思考过程</summary>
                      <div className="ai-answer-text">{message.reasoning}</div>
                    </details>
                  ) : null}
                  {message.error ? <p className="settings-error" role="alert">{message.error}</p> : null}
                  {message.content ? <div className="ai-answer-text">{message.content}</div> : null}
                  {message.streaming && !message.content ? <p className="ai-working-message" role="status">{grounding === 'direct' ? '正在生成回答…' : '正在检索文献并生成回答…'}</p> : null}
                </div>
                {message.sources?.length ? (
                  <aside className="ai-sources-panel" aria-label="回答来源">
                    <h2><BookOpen size={17} />来源 <span>{message.sources.length}</span></h2>
                    {message.sources.map((source) => (
                      <button
                        key={source.label}
                        type="button"
                        className="ai-source-card"
                        aria-label={`${source.label} ${source.title} 第 ${source.page} 页`}
                        onClick={() => void openSource(source)}
                      >
                        <span className="ai-source-heading"><strong>{source.label}</strong><span>第 {source.page} 页</span></span>
                        <span className="ai-source-title">{source.title}</span>
                        <span className="ai-source-excerpt">{source.excerpt}</span>
                      </button>
                    ))}
                  </aside>
                ) : null}
              </article>
            ))}
          </div>
        ) : !busy ? (
          <div className="ai-answer-empty">
            <BookOpen size={30} />
            <h2>从一个问题开始</h2>
            <p>{grounding === 'direct' ? '直接向所选模型提问，支持继续追问；当前模式不检索文献或附带来源。' : '比较观点、查找依据或梳理结论，回答会附上可返回原文的来源，并支持继续追问。'}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function lastUserId(messages: AiChatMessage[]): number | undefined {
  return messages.filter((message) => message.role === 'user').at(-1)?.id;
}

function hasKnowledgeText(paper: Paper): boolean {
  return paper.indexStatus !== 'pending' && (paper.pages.some((page) => page.text.trim()) || Boolean(paper.metadata.abstract.trim()));
}
