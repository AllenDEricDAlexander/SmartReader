import { BookOpen, FileSearch, Send, Settings, ShieldCheck, Sparkles, Square } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { errorMessage, type LibraryService } from '../library/libraryService';
import type { AiAnswer, AiService, AiSource } from './aiService';
import './aiWorkspace.css';

type AiAssistantProps = {
  library: LibraryService;
  ai: AiService;
  onOpenPaper(id: string, page?: number): void | Promise<void>;
  onOpenSettings?(): void;
  initialPaperId?: string;
};

export function AiAssistant({ library, ai, onOpenPaper, onOpenSettings, initialPaperId }: AiAssistantProps) {
  const libraryView = useSyncExternalStore(library.subscribe, library.getView);
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const [selectedPaperId, setSelectedPaperId] = useState(initialPaperId ?? '');
  const [question, setQuestion] = useState({ text: '', epoch: activity.answerEpoch });
  const [answer, setAnswer] = useState<{ value: AiAnswer; epoch: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const ownsRequest = useRef(false);
  const mounted = useRef(true);
  const provider = libraryView.snapshot.ai.providers.find((item) => item.id === libraryView.snapshot.ai.activeProviderId);
  const configured = Boolean(provider && activity.keyProviderIds.includes(provider.id));
  const busy = pending || activity.asking;
  const visibleAnswer = answer?.epoch === activity.answerEpoch ? answer.value : null;
  const visibleQuestion = question.epoch === activity.answerEpoch ? question.text : '';

  useEffect(() => {
    mounted.current = true;
    void library.initialize().catch((failure: unknown) => {
      if (mounted.current) setError(errorMessage(failure));
    });
    const stopLocked = library.onLocked((ids) => {
      requestGeneration.current += 1;
      ownsRequest.current = false;
      setAnswer(null);
      setQuestion({ text: '', epoch: ai.getView().answerEpoch });
      setSelectedPaperId((id) => ids.includes(id) ? '' : id);
      setPending(false);
      setError(null);
      setNotice('文献访问状态已变化，问题和回答已清除。');
    });
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      if (ownsRequest.current) ai.cancelAnswer();
      ownsRequest.current = false;
      stopLocked();
    };
  }, [library, ai]);

  useEffect(() => {
    setSelectedPaperId(initialPaperId && library.getPaper(initialPaperId) ? initialPaperId : '');
  }, [initialPaperId, library, libraryView.loaded]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !configured || !visibleQuestion.trim()) return;
    const generation = ++requestGeneration.current;
    const epoch = ai.getView().answerEpoch;
    ownsRequest.current = true;
    setPending(true);
    setAnswer(null);
    setError(null);
    setNotice(null);
    try {
      const result = await ai.ask(visibleQuestion, selectedPaperId ? [selectedPaperId] : undefined);
      if (mounted.current && generation === requestGeneration.current && epoch === ai.getView().answerEpoch) {
        setAnswer({ value: result, epoch });
      }
    } catch (failure) {
      if (mounted.current && generation === requestGeneration.current && epoch === ai.getView().answerEpoch) {
        setError(errorMessage(failure));
      }
    } finally {
      if (mounted.current && generation === requestGeneration.current) {
        ownsRequest.current = false;
        setPending(false);
      }
    }
  }

  function cancel() {
    requestGeneration.current += 1;
    ownsRequest.current = false;
    ai.cancelAnswer();
    setPending(false);
    setError(null);
    setNotice('回答已取消。');
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
        <div>
          <span className="ai-eyebrow"><Sparkles size={15} />文献研究助手</span>
          <h1 id="ai-assistant-title">让答案回到文献</h1>
          <p>检索本地论文，用有来源的回答辅助阅读。</p>
        </div>
        {onOpenSettings ? (
          <button type="button" onClick={onOpenSettings}><Settings size={16} />AI 设置</button>
        ) : null}
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
          <form onSubmit={(event) => void submit(event)}>
            <label className="ai-scope-field">
              <span>问答范围</span>
              <select
                aria-label="问答范围"
                value={selectedPaperId}
                disabled={busy}
                onChange={(event) => setSelectedPaperId(event.target.value)}
              >
                <option value="">全库可访问文献（{libraryView.papers.length}）</option>
                {libraryView.papers.map((paper) => (
                  <option key={paper.id} value={paper.id}>{paper.metadata.title || paper.fileName}</option>
                ))}
              </select>
            </label>
            <label className="ai-question-field">
              <span>科研问题</span>
              <textarea
                aria-label="科研问题"
                value={visibleQuestion}
                maxLength={4000}
                rows={5}
                placeholder="例如：这些研究对工作记忆的主要结论是什么？"
                disabled={busy}
                onChange={(event) => setQuestion({ text: event.target.value, epoch: ai.getView().answerEpoch })}
              />
            </label>
            <div className="ai-question-footer">
              <small>{visibleQuestion.length} / 4000</small>
              <div>
                {busy ? <button type="button" onClick={cancel}><Square size={14} />取消回答</button> : null}
                <button
                  type="submit"
                  className="primary-action"
                  disabled={!configured || busy || !visibleQuestion.trim() || !libraryView.papers.length}
                >
                  <Send size={15} />检索并提问
                </button>
              </div>
            </div>
          </form>
          <p className="ai-assistant-privacy">
            <ShieldCheck size={15} />相关摘录和问题会发送给所选厂商。锁定的文献不参与检索。
          </p>
          {busy ? (
            <p className="ai-working-message" role="status">
              {pending ? '正在检索文献并生成回答…' : '正在等待请求结束…'}
            </p>
          ) : null}
          {error || libraryView.error ? (
            <p className="settings-error" role="alert">{error ?? libraryView.error}</p>
          ) : null}
          {notice ? <p className="ai-muted" role="status">{notice}</p> : null}
        </div>
        {visibleAnswer ? (
          <div className="ai-answer-layout">
            <section className="ai-answer-panel" aria-label="AI 回答">
              <div className="ai-section-heading"><h2>回答</h2><small>{visibleAnswer.providerName}</small></div>
              <div className="ai-answer-text">{visibleAnswer.text}</div>
              <p className="ai-field-help">可点击来源核对原文和上下文。</p>
            </section>
            <aside className="ai-sources-panel" aria-label="回答来源">
              <h2><BookOpen size={17} />来源 <span>{visibleAnswer.sources.length}</span></h2>
              {visibleAnswer.sources.map((source) => (
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
          </div>
        ) : !busy ? (
          <div className="ai-answer-empty">
            <BookOpen size={30} />
            <h2>从一个问题开始</h2>
            <p>比较观点、查找依据或梳理结论，回答会附上可返回原文的来源。</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
