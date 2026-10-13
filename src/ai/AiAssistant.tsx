import { BookOpen, FileSearch, Plus, Send, Settings, ShieldCheck, Sparkles, Square } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { errorMessage, type LibraryService } from '../library/libraryService';
import type { Paper } from '../library/libraryModels';
import type { AiAnswer, AiService, AiSource } from './aiService';
import './aiWorkspace.css';

type AiAssistantProps = {
  library: LibraryService;
  ai: AiService;
  onOpenPaper(id: string, page?: number): void | Promise<void>;
  onOpenSettings?(): void;
  onAddPdfs?(): Promise<string[]>;
  initialPaperId?: string;
};

export function AiAssistant({ library, ai, onOpenPaper, onOpenSettings, onAddPdfs, initialPaperId }: AiAssistantProps) {
  const libraryView = useSyncExternalStore(library.subscribe, library.getView);
  const activity = useSyncExternalStore(ai.subscribe, ai.getView);
  const [scope, setScope] = useState<'all' | 'selected'>(initialPaperId ? 'selected' : 'all');
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>(initialPaperId ? [initialPaperId] : []);
  const [fileQuery, setFileQuery] = useState('');
  const [addingFiles, setAddingFiles] = useState(false);
  const initialSelection = useRef<{ library: LibraryService; id?: string } | null>(null);
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
  const busy = pending || activity.asking || addingFiles;
  const usablePapers = libraryView.papers.filter(hasKnowledgeText);
  const selectedIds = selectedPaperIds.filter((id) => usablePapers.some((paper) => paper.id === id));
  const scopedCount = scope === 'all' ? usablePapers.length : selectedIds.length;
  const matchingPapers = libraryView.papers.filter((paper) =>
    `${paper.metadata.title} ${paper.fileName}`.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase()));
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
      setSelectedPaperIds((selected) => selected.filter((id) => !ids.includes(id)));
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
    if (!libraryView.loaded || (initialSelection.current?.library === library && initialSelection.current.id === initialPaperId)) return;
    initialSelection.current = { library, id: initialPaperId };
    setSelectedPaperIds(initialPaperId && library.getPaper(initialPaperId) ? [initialPaperId] : []);
    setScope(initialPaperId ? 'selected' : 'all');
  }, [initialPaperId, library, libraryView.loaded]);

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
        setScope('selected');
        setSelectedPaperIds((selected) => [...new Set([...selected, ...accessible])]);
        setAnswer(null);
        setNotice(`已添加 ${accessible.length} 份知识库文件。相同 PDF 只保存一份。`);
      } else setNotice('未添加文件，请选择本地 PDF。');
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setAddingFiles(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !configured || !visibleQuestion.trim() || !scopedCount) return;
    const generation = ++requestGeneration.current;
    const epoch = ai.getView().answerEpoch;
    ownsRequest.current = true;
    setPending(true);
    setAnswer(null);
    setError(null);
    setNotice(null);
    try {
      const result = await ai.ask(visibleQuestion, scope === 'selected' ? selectedIds : undefined);
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
            <fieldset className="ai-knowledge-files" disabled={busy || !libraryView.loaded}>
              <legend>知识库文件</legend>
              <div className="ai-knowledge-actions">
                {onAddPdfs ? <button type="button" onClick={() => void addPdfs()}><Plus size={14} />{addingFiles ? '添加并索引中…' : '添加本地 PDF'}</button> : null}
                <span className="ai-muted">{usablePapers.length} 份可检索 · 已选范围 {scopedCount} 份</span>
              </div>
              {!libraryView.papers.length ? <p className="ai-muted">知识库还没有文件。添加 PDF 后会保存到本地文献库并建立索引；仅打开阅读的文件不会自动加入。</p> : <>
                <div className="ai-knowledge-scope" role="group" aria-label="问答范围">
                  <label><input type="radio" name="knowledge-scope" checked={scope === 'all'} onChange={() => { setScope('all'); setAnswer(null); }} />全部可检索文献</label>
                  <label><input type="radio" name="knowledge-scope" checked={scope === 'selected'} onChange={() => { setScope('selected'); setAnswer(null); }} />指定文件（可多选）</label>
                </div>
                <input type="search" aria-label="搜索知识库文件" placeholder="按论文标题或文件名查找" value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} />
                <div className="ai-knowledge-list">
                  {matchingPapers.map((paper) => <label className="ai-knowledge-file" key={paper.id}>
                    <input type="checkbox" aria-label={`选择知识库文件 ${paper.metadata.title || paper.fileName}`}
                      checked={scope === 'all' ? hasKnowledgeText(paper) : selectedPaperIds.includes(paper.id)}
                      disabled={!hasKnowledgeText(paper)} onChange={(event) => {
                        const checked = event.target.checked;
                        setSelectedPaperIds((ids) => {
                          const previous = scope === 'all' ? usablePapers.map((item) => item.id) : ids;
                          return checked ? [...new Set([...previous, paper.id])] : previous.filter((id) => id !== paper.id);
                        });
                        setScope('selected');
                        setAnswer(null);
                      }} />
                    <span><strong>{paper.metadata.title || paper.fileName}</strong><small>{paper.fileName} · {paper.pageCount} 页 · {hasKnowledgeText(paper) ? '文本可检索' : paper.indexStatus === 'pending' ? '正在建立索引' : '没有可检索文本，请重新索引或补充摘要'}</small></span>
                  </label>)}
                  {!matchingPapers.length ? <p className="ai-muted">没有匹配的知识库文件。</p> : null}
                </div>
              </>}
              {scope === 'selected' && !scopedCount && libraryView.papers.length ? <p className="ai-muted">请选择至少一份有可检索文本的文件。</p> : null}
            </fieldset>
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
                {pending || activity.asking ? <button type="button" onClick={cancel}><Square size={14} />取消回答</button> : null}
                <button
                  type="submit"
                  className="primary-action"
                  disabled={!configured || busy || !visibleQuestion.trim() || !scopedCount}
                >
                  <Send size={15} />检索并提问
                </button>
              </div>
            </div>
          </form>
          <p className="ai-assistant-privacy">
            <ShieldCheck size={15} />相关摘录和问题会发送给所选厂商。锁定的文献不参与检索。
          </p>
          {pending || activity.asking ? (
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

function hasKnowledgeText(paper: Paper): boolean {
  return paper.indexStatus !== 'pending' && (paper.pages.some((page) => page.text.trim()) || Boolean(paper.metadata.abstract.trim()));
}
