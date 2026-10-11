import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, FileText, Folder, FolderPlus, LockKeyhole, PanelLeft, Pin, RefreshCw, Search, Settings2, Sparkles, Star, Trash2, Upload, X } from 'lucide-react';
import type { AiService } from '../ai/aiService';
import { formatFileSize } from '../home/homeDisplayUtils';
import { LibraryActionDialog, type LibraryAction } from './LibraryActionDialog';
import { LibraryFolderTree } from './LibraryFolderTree';
import { PaperMetadataEditor } from './PaperMetadataEditor';
import { PaperPreview } from './PaperPreview';
import { descendantFolderIds, folderVaultId } from './libraryFolders';
import { folderOptions } from './libraryFolderUi';
import type { LibraryService } from './libraryService';
import './libraryWorkspace.css';

export type LibraryWorkspaceProps = {
  library: LibraryService;
  ai: AiService;
  onOpenPaper(id: string, page?: number): void | Promise<void>;
  onImport(folderId?: string): void | Promise<void>;
  onOpenAiSettings?(): void;
  importing?: boolean;
  importProgress?: string;
  initialFolderView?: boolean;
};

export function LibraryWorkspace({ library, ai, onOpenPaper, onImport, onOpenAiSettings, importing = false, importProgress, initialFolderView = true }: LibraryWorkspaceProps) {
  const view = useSyncExternalStore(library.subscribe, library.getView, library.getView);
  const activity = useSyncExternalStore(ai.subscribe, ai.getView, ai.getView);
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(initialFolderView);
  const [sort, setSort] = useState<'recent' | 'title' | 'year'>('recent');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [action, setAction] = useState<LibraryAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [aiBatchRunning, setAiBatchRunning] = useState(false);
  const aiBatchRef = useRef(false);
  const aiBatchCancelled = useRef(false);
  const alive = useRef(true);
  const { snapshot } = view;
  const mode = snapshot.preferences.previewMode;
  const selectedFolder = snapshot.folders.find((folder) => folder.id === folderId) ?? null;
  const activeVaultId = selectedFolder ? folderVaultId(snapshot, selectedFolder.id) : null;
  const activeVault = snapshot.vaults.find((vault) => vault.id === activeVaultId);
  const vaultUnlocked = activeVaultId !== null && view.unlockedVaultIds.includes(activeVaultId);
  const options = useMemo(() => folderOptions(snapshot.folders), [snapshot.folders]);

  useEffect(() => {
    alive.current = true;
    void library.initialize().catch((failure: unknown) => {
      if (alive.current) setError(failure instanceof Error ? failure.message : '本地文献库加载失败。');
    });
    const dispose = library.onLocked(() => {
      aiBatchCancelled.current = true;
      setPreviewId(null);
      setEditingId(null);
      setSelected(new Set());
      setAction(null);
      setQuery('');
      setError(null);
      setNotice(null);
    });
    return () => { alive.current = false; dispose(); };
  }, [library]);

  useEffect(() => {
    const accessible = new Set(view.papers.map((paper) => paper.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => accessible.has(id)));
      return next.size === current.size ? current : next;
    });
    if (editingId && !accessible.has(editingId)) setEditingId(null);
    if (previewId && !accessible.has(previewId)) setPreviewId(null);
    if (folderId && !snapshot.folders.some((folder) => folder.id === folderId)) setFolderId(null);
  }, [view.papers, snapshot.folders, editingId, previewId, folderId]);

  const perform = useCallback(async (operation: () => unknown | Promise<unknown>, message?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      if (alive.current && message) setNotice(message);
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : '操作失败，请重试。');
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const runEnrichment = async (ids: string[]) => {
    if (aiBatchRef.current) return;
    aiBatchRef.current = true;
    aiBatchCancelled.current = false;
    setAiBatchRunning(true);
    setError(null);
    setNotice(null);
    try {
      for (const id of ids) {
        if (aiBatchCancelled.current) break;
        if (library.getPaper(id)) await ai.enrich(id);
      }
      if (alive.current) setNotice(aiBatchCancelled.current ? 'AI 处理已取消。' : 'AI 信息补全与分类已完成。');
    } catch (failure) {
      if (alive.current) {
        if (aiBatchCancelled.current) setNotice('AI 处理已取消。');
        else setError(failure instanceof Error ? failure.message : 'AI 处理失败，请重试。');
      }
    } finally {
      aiBatchRef.current = false;
      if (alive.current) setAiBatchRunning(false);
    }
  };

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const byId = new Map(snapshot.folders.map((folder) => [folder.id, folder]));
    for (const record of snapshot.papers) {
      const counted = new Set<string>();
      for (const membership of snapshot.memberships[record.id] ?? []) {
        let id: string | null = membership;
        while (id && !counted.has(id)) {
          counted.add(id);
          id = byId.get(id)?.parentId ?? null;
        }
      }
      for (const id of counted) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [snapshot]);
  const protectedFolderIds = useMemo(() => new Set(snapshot.folders.filter((folder) => folderVaultId(snapshot, folder.id)).map((folder) => folder.id)), [snapshot]);
  const scopedPapers = useMemo(() => {
    const included = selectedFolder ? new Set([selectedFolder.id, ...descendantFolderIds(snapshot, selectedFolder.id)]) : null;
    return view.papers.filter((paper) => (!included || (snapshot.memberships[paper.id] ?? []).some((id) => included.has(id))) && (!favoriteOnly || paper.favorite));
  }, [view.papers, snapshot, selectedFolder, favoriteOnly]);
  const hits = useMemo(() => query.trim() ? library.search(query, { limit: 500, paperIds: scopedPapers.map((paper) => paper.id) }) : [], [library, query, scopedPapers]);
  const bestHits = useMemo(() => {
    const grouped = new Map<string, typeof hits[number]>();
    for (const hit of hits) if (!grouped.has(hit.paperId)) grouped.set(hit.paperId, hit);
    return grouped;
  }, [hits]);
  const papers = useMemo(() => scopedPapers.filter((paper) => !query.trim() || bestHits.has(paper.id)).sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (query.trim()) return (bestHits.get(right.id)?.score ?? 0) - (bestHits.get(left.id)?.score ?? 0);
    if (sort === 'title') return left.metadata.title.localeCompare(right.metadata.title, 'zh-CN');
    if (sort === 'year') return right.metadata.year.localeCompare(left.metadata.year);
    return right.addedAt.localeCompare(left.addedAt);
  }), [scopedPapers, query, bestHits, sort]);
  const selectedPapers = view.papers.filter((paper) => selected.has(paper.id));
  const selectedIds = selectedPapers.map((paper) => paper.id);
  const previewPaper = (previewId ? view.papers.find((paper) => paper.id === previewId) : undefined) ?? papers[0];
  const editingPaper = view.papers.find((paper) => paper.id === editingId);
  const allSelected = papers.length > 0 && papers.every((paper) => selected.has(paper.id));
  const allFavorites = selectedPapers.length > 0 && selectedPapers.every((paper) => paper.favorite);
  const allPinned = selectedPapers.length > 0 && selectedPapers.every((paper) => paper.pinned);
  const disabled = busy || action !== null || editingPaper !== undefined;
  const displayedError = error ?? view.error;

  const selectFolder = (id: string | null) => {
    setFolderId(id);
    setSelected(new Set());
    if (mode === 'hover') setPreviewId(null);
  };
  const folderAction = (value: string) => {
    if (!selectedFolder) return;
    if (value === 'createChild') setAction({ kind: 'createFolder', parentId: selectedFolder.id });
    else if (value === 'decryptVault' && activeVaultId) setAction({ kind: 'decryptVault', vaultId: activeVaultId });
    else if (['renameFolder', 'moveFolder', 'mergeFolder', 'deleteFolder', 'encryptFolder'].includes(value)) {
      setAction({ kind: value as 'renameFolder' | 'moveFolder' | 'mergeFolder' | 'deleteFolder' | 'encryptFolder', folderId: selectedFolder.id });
    }
  };

  return (
    <section className="library-workspace" aria-label="科研文献库">
      <header className="library-workspace-header">
        <div><h1><BookOpen size={21} aria-hidden="true" />文献库</h1><p>本地保存 · 自动索引 · 一篇文献，多种归档</p></div>
        <div className="library-header-actions">
          <button className="library-tree-toggle" type="button" aria-label="切换分类目录" aria-pressed={foldersOpen} onClick={() => setFoldersOpen((current) => !current)}><PanelLeft size={16} />目录</button>
          {onOpenAiSettings ? <button type="button" disabled={disabled} onClick={onOpenAiSettings}><Settings2 size={15} />AI 设置</button> : null}
          <button type="button" className="library-primary" disabled={disabled || importing} onClick={() => void perform(() => onImport(selectedFolder?.id))}><Upload size={15} />{importing ? '导入中…' : '导入 PDF'}</button>
        </div>
      </header>
      {importing || importProgress ? <p className="library-progress" role="status">{importProgress || '正在导入文献并建立索引…'}</p> : null}
      {displayedError ? <div className="library-notice library-error" role="alert"><span>{displayedError}</span><button type="button" disabled={busy} onClick={() => void perform(() => library.reload())}>重新载入</button><button type="button" aria-label="关闭错误提示" onClick={() => setError(null)}><X size={14} /></button></div> : null}
      {notice ? <div className="library-notice" role="status"><span>{notice}</span><button type="button" aria-label="关闭操作提示" onClick={() => setNotice(null)}><X size={14} /></button></div> : null}
      <div className="library-toolbar">
        <label className="library-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索文献" value={query} placeholder="搜索标题、作者、关键词或全文" onChange={(event) => {
          setQuery(event.target.value); setSelected(new Set()); if (mode === 'hover') setPreviewId(null);
        }} /></label>
        <label className="library-compact-folder"><span>分类</span><select aria-label="文献分类筛选" value={selectedFolder?.id ?? ''} onChange={(event) => selectFolder(event.target.value || null)}><option value="">全部文献</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <select aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">最近导入</option><option value="title">按标题</option><option value="year">按发表年份</option></select>
        <button type="button" aria-pressed={favoriteOnly} onClick={() => { setFavoriteOnly((value) => !value); setSelected(new Set()); if (mode === 'hover') setPreviewId(null); }}><Star size={14} />仅收藏</button>
        {mode === 'off' ? <button type="button" disabled={busy} onClick={() => void perform(() => library.savePreferences({ previewMode: 'hover' }))}>显示预览</button> : null}
      </div>
      <div className="library-location-bar">
        <strong><Folder size={15} />{selectedFolder?.name ?? '全部文献'}<span>{papers.length} 篇可访问</span></strong>
        <div>
          <button type="button" disabled={disabled} aria-label="新建分类" onClick={() => setAction({ kind: 'createFolder', parentId: null })}><FolderPlus size={14} />新建分类</button>
          {selectedFolder ? <select aria-label="当前分类操作" value="" disabled={disabled} onChange={(event) => folderAction(event.target.value)}>
            <option value="" disabled>分类操作</option><option value="createChild">新建子分类</option><option value="renameFolder">重命名</option><option value="moveFolder" disabled={activeVaultId !== null}>移动分类</option><option value="mergeFolder" disabled={activeVaultId !== null}>合并分类</option><option value="deleteFolder" disabled={activeVaultId !== null}>删除分类</option>
            {activeVaultId ? <option value="decryptVault" disabled={!vaultUnlocked}>解除加密</option> : <option value="encryptFolder">加密文件夹</option>}
          </select> : null}
          {activeVaultId ? <button type="button" disabled={disabled} onClick={() => vaultUnlocked ? void perform(() => library.lockVault(activeVaultId), '文件夹已锁定。') : setAction({ kind: 'unlockVault', vaultId: activeVaultId })}><LockKeyhole size={14} />{vaultUnlocked ? '锁定文件夹' : '解锁文件夹'}</button> : null}
        </div>
      </div>
      {activeVault ? <p className="library-vault-scope">加密范围：{snapshot.folders.find((folder) => folder.id === activeVault.folderId)?.name}及其子分类。同一论文的各分类入口共用加密状态。</p> : null}
      {selectedIds.length ? <div className="library-batch-toolbar" aria-label="批量文献操作">
        <strong>已选 {selectedIds.length} 篇</strong>
        <button type="button" disabled={disabled} onClick={() => setAction({ kind: 'categorize', paperIds: selectedIds, mode: 'move' })}>移动分类</button>
        <button type="button" disabled={disabled} onClick={() => setAction({ kind: 'categorize', paperIds: selectedIds, mode: 'add' })}>追加分类</button>
        <button type="button" aria-label={allPinned ? '批量取消置顶' : '批量置顶'} disabled={disabled} onClick={() => void perform(() => library.batchUpdate(selectedIds, { pinned: !allPinned }))}><Pin size={14} />{allPinned ? '取消置顶' : '置顶'}</button>
        <button type="button" aria-label={allFavorites ? '批量取消收藏' : '批量收藏'} disabled={disabled} onClick={() => void perform(() => library.batchUpdate(selectedIds, { favorite: !allFavorites }))}><Star size={14} />{allFavorites ? '取消收藏' : '收藏'}</button>
        <button type="button" disabled={disabled || aiBatchRunning} onClick={() => void runEnrichment(selectedIds)}><Sparkles size={14} />AI 补全</button>
        <button type="button" aria-label="批量删除" className="library-danger" disabled={disabled} onClick={() => setAction({ kind: 'deletePapers', paperIds: selectedIds })}><Trash2 size={14} />删除</button>
        <button type="button" onClick={() => setSelected(new Set())}>取消选择</button>
      </div> : null}
      {activity.enrichingPaperIds.length || aiBatchRunning ? <div className="library-ai-progress" role="status"><span>正在补全 {activity.enrichingPaperIds.length || 1} 篇文献</span><button type="button" onClick={() => { aiBatchCancelled.current = true; activity.enrichingPaperIds.forEach((id) => ai.cancelEnrichment(id)); }}>取消 AI 处理</button></div> : null}
      <div className={`library-layout${foldersOpen ? '' : ' folders-hidden'}${mode === 'off' ? ' preview-hidden' : ''}`}>
        {foldersOpen ? <nav className="library-folders" aria-label="文献分类目录">
          <div className="library-folder-heading"><span>分类目录</span><small>含子分类</small></div>
          <button className={`library-all-folders${selectedFolder ? '' : ' active'}`} type="button" onClick={() => selectFolder(null)}><BookOpen size={14} />全部文献<span>{snapshot.papers.length}</span></button>
          {snapshot.folders.length ? <LibraryFolderTree folders={snapshot.folders} selectedId={selectedFolder?.id ?? null} counts={folderCounts} protectedIds={protectedFolderIds} onSelect={selectFolder} disabled={disabled} /> : <p className="library-folder-empty">创建课题分类，或使用 AI 根据研究领域等五个维度自动归档。</p>}
          <p className="library-folder-tip">同一篇论文可归入多个分类，文件只保存一份。</p>
        </nav> : null}
        <div className="library-list-panel">
          <div className="library-list-heading"><label><input type="checkbox" aria-label="选择当前结果中的全部文献" checked={allSelected} disabled={!papers.length || disabled} onChange={(event) => setSelected(event.target.checked ? new Set(papers.map((paper) => paper.id)) : new Set())} />{query.trim() ? `检索结果 ${papers.length} 篇` : '文献列表'}</label><span>{snapshot.ai.autoEnrich ? '导入后自动 AI 分类' : '导入后自动建立索引'}</span></div>
          <div className="library-list-scroll">
            {view.lockedPaperIds.length ? <div className="library-locked-message"><LockKeyhole size={18} /><div><p>{view.lockedPaperIds.length} 篇文献已锁定，解锁后可查看和检索。</p><div>{snapshot.vaults.filter((vault) => !view.unlockedVaultIds.includes(vault.id)).map((vault) => <button key={vault.id} type="button" disabled={disabled} onClick={() => setAction({ kind: 'unlockVault', vaultId: vault.id })}>解锁 {snapshot.folders.find((folder) => folder.id === vault.folderId)?.name ?? '文件夹'}</button>)}</div></div></div> : null}
            {!view.loaded ? <p className="library-empty" role="status">正在载入本地文献库…</p> : papers.length ? <ul className="library-paper-list" aria-label="文献列表">
              {papers.map((paper) => {
                const title = paper.metadata.title || paper.fileName;
                const hit = bestHits.get(paper.id);
                const enriching = activity.enrichingPaperIds.includes(paper.id);
                return <li key={paper.id} aria-label={`文献 ${title}`} className={previewPaper?.id === paper.id && mode !== 'off' ? 'previewed' : undefined} onMouseEnter={() => { if (mode === 'hover') setPreviewId(paper.id); }} onFocus={() => { if (mode === 'hover') setPreviewId(paper.id); }}>
                  <div className="library-paper-main">
                    <input type="checkbox" aria-label={`选择 ${title}`} checked={selected.has(paper.id)} disabled={disabled} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(paper.id); else next.delete(paper.id); return next; })} />
                    <span className="library-paper-icon"><FileText size={22} aria-hidden="true" /></span>
                    <div className="library-paper-summary">
                      <h2><button type="button" disabled={disabled} aria-label={`阅读 ${title}`} onClick={() => void perform(() => onOpenPaper(paper.id))}>{title}</button></h2>
                      <p className="library-paper-byline" title={paper.metadata.authors.join('、')}>{paper.metadata.authors.join('、') || '作者待补充'}{paper.metadata.year ? ` · ${paper.metadata.year}` : ''}{paper.metadata.journal ? ` · ${paper.metadata.journal}` : ''}</p>
                      <div className="library-paper-meta"><span>{paper.pageCount ? `${paper.pageCount} 页` : '页数待识别'}</span><span>{formatFileSize(paper.fileSize)}</span><span className={`library-index-status ${paper.indexStatus}`}>{paper.indexStatus === 'ready' ? '已索引' : paper.indexStatus === 'pending' ? '索引中' : paper.indexStatus === 'empty' ? '无文本' : '索引失败'}</span>{paper.aiStatus === 'ready' ? <span className="library-ai-ready">AI 已补全</span> : null}{paper.pinned ? <span><Pin size={11} />已置顶</span> : null}</div>
                    </div>
                    <button type="button" className="library-paper-favorite" disabled={disabled} aria-label={`${paper.favorite ? '取消收藏' : '收藏'} ${title}`} aria-pressed={paper.favorite} onClick={() => void perform(() => library.batchUpdate([paper.id], { favorite: !paper.favorite }))}><Star size={16} fill={paper.favorite ? 'currentColor' : 'none'} /></button>
                  </div>
                  {hit ? <button type="button" className="library-search-hit" aria-label={`打开匹配 第 ${hit.page} 页 ${title}`} disabled={disabled} onClick={() => void perform(() => onOpenPaper(paper.id, hit.page))}><span>第 {hit.page} 页</span><p>{hit.snippet}</p></button> : null}
                  {paper.indexError ? <p className="library-paper-warning">{paper.indexError}</p> : null}
                  {paper.aiError ? <p className="library-paper-warning">AI：{paper.aiError}</p> : null}
                  <div className="library-paper-actions">
                    <button type="button" disabled={disabled} onClick={() => { setPreviewId(paper.id); if (mode === 'off') void perform(() => library.savePreferences({ previewMode: 'hover' })); }}>查看信息</button>
                    <button type="button" disabled={disabled} onClick={() => setAction({ kind: 'categorize', paperIds: [paper.id], mode: 'add' })}>归类</button>
                    {enriching ? <button type="button" aria-label={`取消 AI ${title}`} onClick={() => { aiBatchCancelled.current = true; ai.cancelEnrichment(paper.id); }}>取消 AI</button> : <button type="button" disabled={disabled || aiBatchRunning || paper.indexStatus === 'pending'} aria-label={`AI 补全 ${title}`} onClick={() => void runEnrichment([paper.id])}><Sparkles size={12} />{paper.aiStatus === 'error' ? '重试 AI' : 'AI 补全'}</button>}
                    <button type="button" disabled={disabled || paper.indexStatus === 'pending'} aria-label={`重新索引 ${title}`} onClick={() => setAction({ kind: 'reindex', paperIds: [paper.id] })}><RefreshCw size={12} />{paper.indexStatus === 'error' || paper.indexStatus === 'empty' ? '重试索引' : '重建索引'}</button>
                  </div>
                </li>;
              })}
            </ul> : <div className="library-empty"><FileText size={34} aria-hidden="true" /><h2>{query.trim() ? '未找到匹配文献' : '这里还没有可访问的文献'}</h2><p>{query.trim() ? '试试标题、作者、关键词，或更简短的全文检索词。' : '导入 PDF 后自动提取信息并建立索引，也可以将现有文献归入此分类。'}</p>{!query.trim() ? <button type="button" className="library-primary" disabled={disabled || importing} onClick={() => void perform(() => onImport(selectedFolder?.id))}>导入文献</button> : null}</div>}
          </div>
        </div>
        {mode !== 'off' ? previewPaper ? <PaperPreview paper={previewPaper} mode={mode} fieldUsage={snapshot.preferences.fieldUsage} busy={busy} onModeChange={(previewMode) => { if (previewMode === 'pinned') setPreviewId(previewPaper.id); return library.savePreferences({ previewMode }); }} onEdit={() => setEditingId(previewPaper.id)} onOpenPage={(page) => onOpenPaper(previewPaper.id, page)} onToggleFavorite={() => library.batchUpdate([previewPaper.id], { favorite: !previewPaper.favorite })} onFieldView={(field) => library.recordFieldView(field)} /> : <aside className="library-preview-empty"><FileText size={26} /><p>在文献列表中悬停或选择一篇论文，查看完整信息。</p><button type="button" onClick={() => void perform(() => library.savePreferences({ previewMode: 'off' }))}>关闭预览</button></aside> : null}
      </div>
      {action ? <LibraryActionDialog key={JSON.stringify(action)} action={action} library={library} view={view} onClose={() => setAction(null)} onComplete={(message) => { setNotice(message); setAction(null); }} /> : null}
      {editingPaper ? <PaperMetadataEditor key={editingPaper.id} paper={editingPaper} onSave={(changes) => library.editMetadata(editingPaper.id, changes)} onClose={() => setEditingId(null)} /> : null}
    </section>
  );
}
