import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Columns2, FileText, Minus, Plus, X } from 'lucide-react';
import type { Paper } from '../library/libraryModels';
import { errorMessage, type LibraryService } from '../library/libraryService';
import { PdfViewerBridge, type PdfRenderer } from '../viewer/PdfViewerBridge';
import { ViewerController } from '../viewer/viewerController';
import type { ViewerSource } from '../viewer/viewerTypes';
import './compareWorkspace.css';

type LibraryCompareWorkspaceProps = {
  library: LibraryService;
  onClose(): void;
  renderer?: PdfRenderer;
};

type PaneState = {
  paperId: string;
  source: ViewerSource | null;
  page: number;
  pageCount: number | null;
  zoom: number;
  loading: boolean;
  error: string | null;
};

const emptyPane = (): PaneState => ({
  paperId: '', source: null, page: 1, pageCount: null, zoom: 1, loading: false, error: null,
});

export function LibraryCompareWorkspace({ library, onClose, renderer }: LibraryCompareWorkspaceProps) {
  const view = useSyncExternalStore(library.subscribe, library.getView);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void library.initialize().catch((failure: unknown) => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  }, [library]);

  return (
    <section className="library-compare" aria-label="对比阅读工作区">
      <header className="library-compare-header">
        <div>
          <span><Columns2 size={16} aria-hidden="true" />Compare</span>
          <h1>对比阅读</h1>
          <p>左右独立定位与缩放，已有批注以只读方式展示。</p>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}><X size={16} /></button>
      </header>
      {error ? <p className="library-compare-message" role="alert">{error}</p>
        : !view.loaded ? <p className="library-compare-message" role="status">正在加载文献库…</p>
        : !view.papers.length ? <div className="library-compare-empty">
          <FileText size={36} aria-hidden="true" />
          <h2>暂无可用于对比的文献</h2>
          <p>请先在文献库导入 PDF，或解锁加密文件夹后再进行对比。</p>
          <button type="button" onClick={onClose}>返回首页</button>
        </div> : <div className="library-compare-panes">
          <ComparePane side="左侧" defaultIndex={0} library={library} papers={view.papers} renderer={renderer} />
          <ComparePane side="右侧" defaultIndex={1} library={library} papers={view.papers} renderer={renderer} />
        </div>}
    </section>
  );
}

function ComparePane({ side, defaultIndex, library, papers, renderer }: {
  side: string;
  defaultIndex: number;
  library: LibraryService;
  papers: Paper[];
  renderer?: PdfRenderer;
}) {
  const [selectedId, setSelectedId] = useState(() => papers[defaultIndex]?.id ?? '');
  const [state, setState] = useState<PaneState>(emptyPane);
  const [pageInput, setPageInput] = useState('1');
  const [retry, setRetry] = useState(0);
  const controller = useMemo(() => new ViewerController(), []);
  const generation = useRef(0);
  const paper = papers.find((item) => item.id === selectedId);
  const accessibleId = paper?.id ?? '';
  const source = state.paperId === accessibleId ? state.source : null;
  const controlsEnabled = Boolean(source && !state.error);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    let active = true;
    let url: string | null = null;
    const release = () => {
      active = false;
      controller.clear();
      if (url) { URL.revokeObjectURL(url); url = null; }
    };
    setState(emptyPane());
    if (!accessibleId) return release;
    const current = library.getPaper(accessibleId);
    if (!current) return release;
    const access = library.captureAccess();
    setState({ ...emptyPane(), paperId: accessibleId, page: current.lastPage,
      pageCount: current.pageCount || null, zoom: current.zoom, loading: true });
    const unsubscribe = library.onLocked((ids) => {
      if (!ids.includes(accessibleId)) return;
      release();
      setState(emptyPane());
      setSelectedId('');
    });
    void library.readPdf(accessibleId).then((bytes) => {
      if (!active || generation.current !== currentGeneration) return;
      if (!library.canAccess(accessibleId, access)) throw new Error('文献访问状态已变化，请重新选择或重试。');
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }));
      const source: ViewerSource = {
        sessionId: `compare:${side}:${accessibleId}:${currentGeneration}`, url,
        restore: { page: current.lastPage, zoom: current.zoom },
      };
      setState((previous) => ({ ...previous, source, loading: false }));
    }).catch((failure: unknown) => {
      if (active && generation.current === currentGeneration) {
        setState((previous) => ({ ...previous, loading: false, error: errorMessage(failure) }));
      }
    });
    return () => { unsubscribe(); release(); };
  }, [accessibleId, controller, library, retry, side]);

  useEffect(() => { setPageInput(String(state.page)); }, [state.page]);

  const jumpToPage = () => {
    const page = Number(pageInput);
    if (!Number.isFinite(page) || page < 1 || (state.pageCount && page > state.pageCount)) {
      setPageInput(String(state.page));
      return;
    }
    controller.jumpToPage(Math.floor(page));
  };

  return (
    <section className="library-compare-pane" aria-label={`${side}文献对比`}>
      <div className="library-compare-selector">
        <label>
          <span>{side}文献</span>
          <select aria-label={`${side}文献`} value={accessibleId} onChange={(event) => setSelectedId(event.target.value)}>
            <option value="">请选择文献</option>
            {papers.map((item) => <option key={item.id} value={item.id}>{item.metadata.title || item.fileName}</option>)}
          </select>
        </label>
        {paper ? <p title={paper.fileName}>{paper.fileName}</p> : <p>选择已导入并解锁的 PDF</p>}
      </div>
      <div className="library-compare-toolbar" aria-label={`${side}阅读工具`}>
        <form onSubmit={(event) => { event.preventDefault(); jumpToPage(); }}>
          <label htmlFor={`compare-page-${side}`}>页码</label>
          <input id={`compare-page-${side}`} aria-label={`${side}页码`} type="number" min={1} max={state.pageCount ?? undefined}
            value={pageInput} disabled={!controlsEnabled} onChange={(event) => setPageInput(event.target.value)} />
          <span>/ {source ? state.pageCount ?? '—' : '—'}</span>
          <button type="submit" disabled={!controlsEnabled}>跳转</button>
        </form>
        <div>
          <button type="button" aria-label={`${side}缩小`} disabled={!controlsEnabled} onClick={() => controller.zoomOut()}><Minus size={14} /></button>
          <output aria-label={`${side}缩放比例`}>{source ? `${Math.round(state.zoom * 100)}%` : '—'}</output>
          <button type="button" aria-label={`${side}放大`} disabled={!controlsEnabled} onClick={() => controller.zoomIn()}><Plus size={14} /></button>
        </div>
        <button type="button" disabled={!controlsEnabled} onClick={() => controller.fitWidth()}>适合宽度</button>
        <button type="button" disabled={!controlsEnabled} onClick={() => controller.fitPage()}>适合页面</button>
      </div>
      <div className="library-compare-viewer">
        {paper && state.error ? <div className="library-compare-error" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>重新加载</button>
        </div> : source && paper ? <PdfViewerBridge
          key={source.sessionId}
          source={source}
          annotations={paper.annotations}
          controller={controller}
          renderer={renderer}
          onProgressChange={(progress) => setState((current) => current.source?.sessionId === progress.sessionId ? {
            ...current, page: progress.page, pageCount: progress.totalPages ?? current.pageCount, zoom: progress.zoom,
          } : current)}
          onLoadError={(failure) => setState((current) => current.source?.sessionId === source.sessionId
            ? { ...current, error: failure.message } : current)}
        /> : <div className="library-compare-placeholder" role="status">
          <FileText size={28} aria-hidden="true" />
          <p>{paper && state.loading ? '正在读取 PDF…' : '选择文献后在此预览 PDF'}</p>
        </div>}
      </div>
      {paper && source && paper.annotations.length > 0 ? <details className="library-compare-notes">
        <summary>已有批注 · {paper.annotations.length}</summary>
        <ul>{paper.annotations.map((record, index) => <li key={record.id ?? index}>
          <button type="button" onClick={() => controller.jumpToPage(record.page)}>第 {record.page} 页</button>
          {record.quote ? <blockquote>{record.quote}</blockquote> : null}
          {record.text ? <p>{record.text}</p> : null}
        </li>)}</ul>
      </details> : null}
    </section>
  );
}
