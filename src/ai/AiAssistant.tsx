import { Bubble, Prompts, Sender, Welcome, XProvider } from '@ant-design/x';
import { Input, theme as antTheme, type GetProps, type GetRef, type ThemeConfig } from 'antd';
import { ArrowDown, BookOpen, Plus, Send, Settings, ShieldCheck, Sparkles, Square, Trash2, X } from 'lucide-react';
import { forwardRef, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { errorMessage, type LibraryService } from '../library/libraryService';
import { providerModels, type Paper } from '../library/libraryModels';
import { BookList } from '../components/book-list/BookList';
import { paperBookItem } from '../components/book-list/bookListAdapters';
import type { ReaderTheme } from '../preferences/preferencesModels';
import type { AiChatMessage, AiChatTurn, AiRetrieval, AiService, AiSource } from './aiService';
import { AiConversationHistory } from './AiConversationHistory';
import './aiWorkspace.css';

type AiAssistantProps = {
  library: LibraryService;
  ai: AiService;
  onOpenPaper(id: string, page?: number): void | Promise<void>;
  onOpenSettings?(): void;
  onAddPdfs?(): Promise<string[]>;
  initialPaperId?: string;
  theme?: ReaderTheme;
};

const QuestionInput = forwardRef<GetRef<typeof Input.TextArea>, GetProps<typeof Input.TextArea>>(
  (props, ref) => <Input.TextArea {...props} ref={ref} aria-label="科研问题" maxLength={4000} rows={2} />,
);
const senderComponents = { input: QuestionInput };

const questionPrompts = {
  library: ['总结所选文献的主要结论', '比较这些文献的研究方法'],
  direct: ['帮我梳理这个研究问题', '解释一个研究概念'],
};

function useAssistantTheme(theme: ReaderTheme | undefined): ThemeConfig {
  const [token, setToken] = useState<ThemeConfig['token']>();
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const color = (name: string) => styles.getPropertyValue(name).trim() || undefined;
    setToken({
      colorPrimary: color('--sr-primary-fill'),
      colorText: color('--sr-text'),
      colorTextSecondary: color('--sr-text-muted'),
      colorBgBase: color('--sr-bg'),
      colorBgContainer: color('--sr-surface'),
      colorBgElevated: color('--sr-surface'),
      colorBorder: color('--sr-border'),
      borderRadius: 8,
      fontFamily: 'inherit',
    });
  }, [theme]);
  return useMemo(() => ({
    algorithm: theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token,
  }), [theme, token]);
}

const retrievalLabels: Record<AiRetrieval, string> = {
  'milvus-vector': 'Milvus 向量检索',
  'local-vector': '本地向量检索',
  fulltext: '本地全文检索',
  none: '未检索文献',
};

export function AiAssistant(props: AiAssistantProps) {
  const { ai } = props;
  const theme = useAssistantTheme(props.theme);
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const [contentBusy, setContentBusy] = useState(false);
  const paperRequest = useRef<{ paperId?: string; conversationId?: string } | null>(null);
  useEffect(() => { void ai.loadAssistantSession().catch(() => undefined); }, [ai]);
  const disabled = contentBusy || Boolean(activity.asking || activity.conversationBusy || !activity.sessionLoaded);
  let content;
  if (!activity.sessionLoaded || activity.sessionLocked || activity.conversationSwitching) {
    content = <section className="ai-assistant" aria-label="恢复 AI 对话">
      <div className="ai-assistant-body">
        {activity.sessionError ? <>
          <p className="settings-error" role="alert">{activity.sessionError}</p>
          <button type="button" onClick={() => void ai.loadAssistantSession().catch(() => undefined)}>重试恢复对话</button>
        </> : <p role="status">{activity.conversationBusy ? '正在切换会话…' : activity.sessionLocked
          ? '已保存的对话涉及加密文献，请先在文献库解锁相关文件夹，聊天记录和上下文随后恢复。'
          : '正在恢复本地聊天记录…'}</p>}
      </div>
    </section>;
  } else {
    // A history selection restores its own file scope rather than repeating an earlier incoming paper request.
    if (!paperRequest.current || paperRequest.current.paperId !== props.initialPaperId) {
      paperRequest.current = { paperId: props.initialPaperId, conversationId: activity.activeConversationId };
    }
    content = <AiAssistantContent {...props} key={activity.activeConversationId} onBusyChange={setContentBusy}
      initialPaperId={paperRequest.current.conversationId === activity.activeConversationId ? props.initialPaperId : undefined} />;
  }
  return <XProvider theme={theme}>
    <div className="ai-conversation-workspace">
      <AiConversationHistory ai={ai} disabled={disabled} />
      {content}
    </div>
  </XProvider>;
}

function AiAssistantContent({ library, ai, onOpenPaper, onOpenSettings, onAddPdfs, initialPaperId, onBusyChange }: AiAssistantProps & { onBusyChange(busy: boolean): void }) {
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
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const nextMessageId = useRef((session?.messages.at(-1)?.id ?? 0) + 1);
  const requestGeneration = useRef(0);
  const ownsRequest = useRef(false);
  const mounted = useRef(true);
  const transcriptViewport = useRef<HTMLElement | null>(null);
  const questionInput = useRef<GetRef<typeof Sender>>(null);
  const knowledgeTrigger = useRef<HTMLElement>(null);
  const followingTranscript = useRef(true);
  const selection = activity.conversationSelection;
  const selectedProviderId = selection ? selection.providerId : libraryView.snapshot.ai.activeProviderId;
  const profile = libraryView.snapshot.ai.providers.find((item) => item.id === selectedProviderId);
  const selectedModel = selection?.model ?? profile?.model ?? '';
  const modelAvailable = Boolean(profile && providerModels(profile).includes(selectedModel));
  const provider = profile ? { ...profile, model: selectedModel } : undefined;
  const selectionUnavailable = Boolean(selectedProviderId && (!profile || !modelAvailable));
  const configured = Boolean(provider && modelAvailable && activity.keyProviderIds.includes(provider.id));
  const busy = pending || activity.asking || activity.conversationBusy || addingFiles || buildingIndex || switching || changingKnowledge;
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
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
    if (grounding === 'library' && scope === 'selected' && !scopedCount) setKnowledgeOpen(true);
  }, [grounding, scope, scopedCount]);

  useEffect(() => {
    ai.saveAssistantSession({
      epoch: activity.answerEpoch, draft: visibleDraft, scope, selectedPaperIds, fileQuery, mode,
      initialPaperId: initialSelection.current.id,
      // Keep completed turns when navigating away or restarting during a response.
      messages: messages.filter((message, index) => !message.streaming && !messages[index + 1]?.streaming),
    });
  }, [ai, activity.answerEpoch, visibleDraft, scope, selectedPaperIds, fileQuery, mode, messages, initialPaperId]);

  useEffect(() => {
    mounted.current = true;
    void library.initialize().catch((failure: unknown) => {
      if (mounted.current) setError(errorMessage(failure));
    });
    const stopLocked = library.onLocked((ids) => {
      if (ai.getAssistantSession()) return;
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
    questionInput.current?.focus({ preventScroll: true });
  }

  function closeKnowledge() {
    setKnowledgeOpen(false);
    knowledgeTrigger.current?.focus({ preventScroll: true });
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

  async function selectConfiguration(providerId: string, model?: string) {
    if (busy || !libraryView.loaded) return;
    setSwitching(true);
    setError(null);
    setNotice(null);
    try {
      await ai.selectProvider(providerId, model);
      if (mounted.current) setNotice('AI 厂商与模型已切换，可继续当前对话。');
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setSwitching(false);
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
        { id: answerId, contextKey, role: 'assistant', content: '', streaming: true, providerName: provider?.name, model: provider?.model },
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
        sources: result.sources, retrieval: result.retrieval, providerName: result.providerName, model: result.model ?? message.model,
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
    <section className="ai-assistant" aria-labelledby="ai-assistant-title">
      <header className="ai-assistant-header">
        <h1 id="ai-assistant-title"><Sparkles size={17} aria-hidden="true" />AI 研究助手</h1>
        <div className="ai-compact-config" role="group" aria-label="AI 厂商与模型选择">
          <label>
            <span>厂商</span>
            <select aria-label="AI 厂商" value={selectedProviderId ?? ''}
              disabled={busy || !libraryView.loaded || !libraryView.snapshot.ai.providers.length}
              onChange={(event) => void selectConfiguration(event.target.value)}>
              {!selectedProviderId ? <option value="" disabled>请选择厂商</option> : null}
              {selectedProviderId && !profile ? <option value={selectedProviderId} disabled>原厂商已删除，请重新选择</option> : null}
              {libraryView.snapshot.ai.providers.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>
          <label>
            <span>模型</span>
            <select aria-label="聊天模型" value={selectedModel} disabled={busy || !libraryView.loaded || !provider}
              onChange={(event) => { if (provider) void selectConfiguration(provider.id, event.target.value); }}>
              {!profile ? <option value={selectedModel}>请先配置厂商与模型</option> : <>
                {!modelAvailable ? <option value={selectedModel} disabled>{selectedModel || '原模型'} · 不可用</option> : null}
                {providerModels(profile).map((model) => <option key={model} value={model}>{model}</option>)}
              </>}
            </select>
          </label>
        </div>
        <div className="ai-header-actions">
          {onOpenSettings ? (
            <button type="button" onClick={onOpenSettings}><Settings size={16} aria-hidden="true" />AI 设置</button>
          ) : null}
        </div>
      </header>
      <div className="ai-workspace-feedback">
        {switching ? <p className="ai-muted" role="status">正在切换 AI 配置…</p> : null}
        {activity.sessionError ? <div className="ai-form-actions">
          <p className="settings-error" role="alert">{activity.sessionError}</p>
          <button type="button" disabled={activity.sessionSaving}
            onClick={() => void ai.flushAssistantSession().catch(() => undefined)}>重试保存对话</button>
        </div> : null}
        {selectionUnavailable ? <p className="settings-error" role="alert">{!profile
          ? '此会话使用的厂商配置已删除，请重新选择厂商和模型。聊天记录与原选择仍然保留。'
          : '此会话使用的模型已不在厂商配置中，请重新选择模型。聊天记录与原选择仍然保留。'}</p> : null}
        {!configured && !selectionUnavailable ? (
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
        {buildingIndex ? <div className="ai-knowledge-actions"><span role="status">正在构建知识库向量…</span><button type="button" onClick={cancelIndex}>取消向量构建</button></div> : null}
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
        {configured && grounding === 'direct' ? (
          <p className="ai-mode-note">{usablePapers.length
            ? '当前模式不检索文献或附带来源。'
            : '知识库还没有可检索的文件，当前为纯模型对话。导入 PDF 后可切换为文献检索。'}</p>
        ) : null}
      </div>
      <section className="ai-transcript-viewport" aria-label="对话正文" ref={transcriptViewport}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const nearBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48;
          followingTranscript.current = nearBottom;
          setShowLatest(!nearBottom);
        }}>
        <div className="ai-assistant-body">
          {messages.length ? (
            <div className="ai-chat-transcript" aria-label="AI 对话记录" aria-live="polite">
              {messages.map((message) => message.role === 'user' ? (
                <Bubble className="ai-chat-user" key={message.id} placement="end" shape="corner"
                  classNames={{ body: 'ai-bubble-user-body', content: 'ai-bubble-question' }}
                  content={<div className="ai-answer-text">{message.content}</div>} />
              ) : (
                <Bubble className="ai-chat-assistant" key={message.id} placement="start" variant="borderless"
                  classNames={{ body: 'ai-bubble-answer-body', content: 'ai-bubble-answer' }}
                  content={
                    <article className="ai-chat-answer-main">
                      <header className="ai-section-heading">
                        <h2>回答</h2>
                        <small>{[message.providerName, message.model, message.retrieval ? retrievalLabels[message.retrieval] : null].filter(Boolean).join(' · ')}</small>
                      </header>
                      {message.reasoning ? (
                        <details className="ai-chat-reasoning">
                          <summary>模型思考过程</summary>
                          <div className="ai-answer-text">{message.reasoning}</div>
                        </details>
                      ) : null}
                      {message.error ? <p className="settings-error" role="alert">{message.error}</p> : null}
                      {message.content ? <div className="ai-answer-text">{message.content}</div> : null}
                      {message.streaming && !message.content ? <p className="ai-working-message" role="status">{grounding === 'direct' ? '正在生成回答…' : '正在检索文献并生成回答…'}</p> : null}
                      {message.sources?.length ? (
                        <details className="ai-sources-panel">
                          <summary><BookOpen size={15} aria-hidden="true" /><span>{message.sources.length} 条来源</span></summary>
                          <div className="ai-source-list" aria-label="回答来源">
                            {message.sources.map((source) => (
                              <button key={source.label} type="button" className="ai-source-card"
                                aria-label={`${source.label} ${source.title} 第 ${source.page} 页`}
                                onClick={() => void openSource(source)}>
                                <span className="ai-source-heading"><strong>{source.label}</strong><span>第 {source.page} 页</span></span>
                                <span className="ai-source-title">{source.title}</span>
                                <span className="ai-source-excerpt">{source.excerpt}</span>
                              </button>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </article>
                  } />
              ))}
            </div>
          ) : !busy && configured ? (
            <div className="ai-answer-empty">
              <Welcome variant="borderless" icon={<BookOpen size={25} aria-hidden="true" />}
                title="从一个问题开始"
                description={grounding === 'library' ? '从文献中梳理结论、比较方法或查找原文。' : '向当前模型提问，或添加 PDF 开始文献问答。'} />
              {!visibleDraft ? <Prompts wrap items={questionPrompts[grounding].map((label) => ({ key: label, label }))}
                onItemClick={({ data }) => {
                  setDraft({ text: data.key, epoch: ai.getView().answerEpoch });
                  continueQuestion();
                }} /> : null}
            </div>
          ) : null}
        </div>
      </section>
      <footer className="ai-composer">
        <div className="ai-composer-inner">
          {showLatest && messages.length ? <button className="ai-jump-latest" type="button" onClick={scrollToLatest}><ArrowDown size={15} aria-hidden="true" />回到最新回答</button> : null}
          <div className="ai-composer-tools">
            <div className="ai-answer-mode" role="group" aria-label="回答方式">
              <label>
                <input type="radio" name="ai-grounding" aria-label="检索本地文献并附来源" checked={grounding === 'library'}
                  disabled={busy || !usablePapers.length} onChange={() => setMode('library')} />
                <span>文献问答</span>
              </label>
              <label>
                <input type="radio" name="ai-grounding" aria-label="直接与模型对话" checked={grounding === 'direct'}
                  disabled={busy} onChange={() => setMode('direct')} />
                <span>直接对话</span>
              </label>
            </div>
            {!busy && messages.some((message) => message.role === 'assistant' && !message.streaming) ? (
              <button className="ai-follow-up" type="button" onClick={continueQuestion}>继续提问</button>
            ) : null}
          </div>
          <form onSubmit={(event) => void submit(event)}>
            <Sender ref={questionInput} components={senderComponents} className="ai-sender" value={visibleDraft}
              disabled={busy} autoSize={false} onKeyDown={() => false}
              placeholder="输入你的研究问题…"
              onChange={(text) => setDraft({ text: text.slice(0, 4000), epoch: ai.getView().answerEpoch })}
              suffix={pending || activity.asking
                ? <button type="button" className="ai-stop-answer" onClick={cancel}><Square size={14} aria-hidden="true" />取消回答</button>
                : <button type="submit" className="primary-action" disabled={!questionReady || busy || !visibleDraft.trim()}>
                    <Send size={15} aria-hidden="true" />{grounding === 'direct' ? '发送问题' : '检索并提问'}
                  </button>}
              footer={<small className="ai-draft-count">{visibleDraft.length} / 4000</small>} />
          </form>
          <div className="ai-composer-context">
            <details className="ai-knowledge-disclosure" open={knowledgeOpen}
              onToggle={(event) => setKnowledgeOpen(event.currentTarget.open)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && knowledgeOpen) {
                  event.stopPropagation();
                  closeKnowledge();
                }
              }}>
              <summary ref={knowledgeTrigger}>
                <span><BookOpen size={15} aria-hidden="true" />知识库与检索范围</span>
                <small>{grounding === 'direct' ? '当前未使用' : `${scope === 'all' ? '全部' : '已选'} ${scopedCount} 份 · ${provider?.embeddingModel ? '向量检索' : '全文检索'}`}</small>
              </summary>
              <div className="ai-knowledge-popover">
                <div className="ai-knowledge-heading">
                  <h2>知识库文件</h2>
                  <button type="button" aria-label="关闭知识库" onClick={closeKnowledge}><X size={15} aria-hidden="true" /></button>
                </div>
                <fieldset aria-label="知识库文件" className="ai-knowledge-files" disabled={busy || !libraryView.loaded}>
                  <div className="ai-knowledge-actions">
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
                      {matchingPapers.length ? <BookList compact showHeader={false} label="知识库文献"
                        items={matchingPapers.map(paperBookItem)} columns={['selection', 'name', 'actions']}
                        selection={{
                          selectedKeys: new Set((scope === 'all' ? usablePapers.map((paper) => paper.id) : selectedIds).map((id) => `paper:${id}`)),
                          nameSelects: true,
                          itemLabel: (item) => `选择知识库文件 ${item.name}`,
                          isDisabled: ({ source: paper }) => grounding === 'direct' || !hasKnowledgeText(paper) || (cloudKnowledge && encryptedIds.has(paper.id)),
                          onChange: ({ source: paper }, checked) => {
                            setSelectedPaperIds((ids) => {
                              const previous = scope === 'all' ? usablePapers.map((item) => item.id) : ids;
                              return checked ? [...new Set([...previous, paper.id])] : previous.filter((id) => id !== paper.id);
                            });
                            setScope('selected');
                          },
                        }}
                        renderNameDetails={({ source: paper }) => <>
                          <small>{paper.pageCount} 页 · {hasKnowledgeText(paper) ? '文本可检索' : paper.indexStatus === 'pending' ? '正在建立索引' : '没有可检索文本，请重新索引或补充摘要'}</small>
                          {activity.indexingPaperIds?.includes(paper.id) ? <small>正在生成向量…</small> : activity.indexedPaperIds?.includes(paper.id) ? <small>向量已建立</small> : null}
                          {activity.knowledgeErrors?.[paper.id] ? <small className="settings-error">{activity.knowledgeErrors[paper.id]}</small> : null}
                        </>}
                        renderActions={({ source: paper, name }) => <button type="button" aria-label={`移除知识库文件 ${name}`}
                          title="仅从 AI 知识库移除，保留文献库中的文献" onClick={() => void changeKnowledge(paper, false)}><Trash2 size={14} aria-hidden="true" />移除</button>} /> : null}
                      {!matchingPapers.length ? <p className="ai-muted">没有匹配的知识库文件。</p> : null}
                    </div>
                  </>}
                  {removedPapers.length ? <details className="ai-knowledge-removed">
                    <summary>已移除文件（{removedPapers.length}）</summary>
                    <div className="ai-knowledge-list">
                      <BookList compact showHeader={false} label="已移除的知识库文献"
                        items={removedPapers.map(paperBookItem)} columns={['name', 'actions']}
                        renderNameDetails={() => <small>仍保存在文献库中</small>}
                        renderActions={({ source: paper, name }) => <button type="button" aria-label={`重新加入知识库文件 ${name}`}
                          onClick={() => void changeKnowledge(paper, true)}><Plus size={14} aria-hidden="true" />重新加入</button>} />
                    </div>
                  </details> : null}
                    {grounding === 'library' && scope === 'selected' && !scopedCount && knowledgePapers.length ? <p className="ai-muted">请选择至少一份有可检索文本的文件。</p> : null}
                </fieldset>
              </div>
            </details>
            {onAddPdfs ? <button className="ai-add-pdf" type="button" disabled={busy || !libraryView.loaded} onClick={() => {
              setKnowledgeOpen(true);
              void addPdfs();
            }}><Plus size={14} aria-hidden="true" />添加本地 PDF</button> : null}
          </div>
          <p className="ai-assistant-privacy">
            <ShieldCheck size={15} />相关摘录、对话历史和问题会发送给所选厂商。锁定的文献不参与检索。
          </p>
        </div>
      </footer>
    </section>
  );
}

function lastUserId(messages: AiChatMessage[]): number | undefined {
  return messages.filter((message) => message.role === 'user').at(-1)?.id;
}

function hasKnowledgeText(paper: Paper): boolean {
  return paper.indexStatus !== 'pending' && (paper.pages.some((page) => page.text.trim()) || Boolean(paper.metadata.abstract.trim()));
}
