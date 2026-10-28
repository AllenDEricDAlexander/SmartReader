import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { BookOpen, ChevronDown, Download, FileText, Folder, FolderPlus, LockKeyhole, PanelLeft, Pin, Search, Settings2, Sparkles, Star, Trash2, Upload, X } from 'lucide-react';
import type { AiService } from '../ai/aiService';
import type { PersistenceApi } from '../persistence/persistenceApi';
import { BookList } from '../components/book-list/BookList';
import { BookListMenu } from '../components/book-list/BookListMenu';
import { paperBookItem } from '../components/book-list/bookListAdapters';
import { useBookListPagination } from '../components/book-list/useBookListPagination';
import type { Tag } from '../tags/tagModels';
import { formatFileSize } from '../home/homeDisplayUtils';
import { LibraryActionDialog, type LibraryAction } from './LibraryActionDialog';
import { LibraryFolderTree } from './LibraryFolderTree';
import { PaperMetadataEditor } from './PaperMetadataEditor';
import { PaperPreview } from './PaperPreview';
import { exportPaperNotesPdf } from './exportPaperNotes';
import { descendantFolderIds, folderVaultId } from './libraryFolders';
import { folderOptions } from './libraryFolderUi';
import type { LibraryService } from './libraryService';
import './libraryWorkspace.css';

export type LibraryWorkspaceProps = {
  library: LibraryService;
  ai: AiService;
  persistence?: PersistenceApi;
  tags?: readonly Tag[];
  onOpenPaper(id: string, page?: number): void | Promise<void>;
  onImport(folderId?: string): void | Promise<void>;
  onOpenAiSettings?(): void;
  onExportError?(failure: unknown): void;
  importing?: boolean;
  importProgress?: string;
  initialFolderView?: boolean;
};

export function LibraryWorkspace({ library, ai, persistence, tags = [], onOpenPaper, onImport, onOpenAiSettings, onExportError, importing = false, importProgress, initialFolderView = true }: LibraryWorkspaceProps) {
  const view = useSyncExternalStore(library.subscribe, library.getView, library.getView);
  const activity = useSyncExternalStore(ai.subscribe, ai.getView, ai.getView);
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(initialFolderView);
  const [sort, setSort] = useState<'recent' | 'title' | 'year'>('recent');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [action, setAction] = useState<LibraryAction | null>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const folderMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const folderMenuInitialFocus = useRef<'first' | 'last'>('first');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
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
  const vaultLocking = activeVaultId !== null && library.isVaultLocking(activeVaultId);
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
      setFolderMenuOpen(false);
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

  useEffect(() => {
    if (tagFilter !== 'all' && !tags.some((tag) => String(tag.id) === tagFilter)) {
      setTagFilter('all');
      setSelected(new Set());
      if (mode === 'hover') setPreviewId(null);
    }
  }, [tags, tagFilter, mode]);

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

  const exportNotes = (ids: string[]) => void perform(async () => {
    setExporting(true);
    try {
      const saved = persistence ? await exportPaperNotesPdf(library, ids, undefined, persistence) : await exportPaperNotesPdf(library, ids);
      if (saved && alive.current) setNotice('笔记 PDF 已导出。导出文件未加密，请妥善保存。');
    } catch (failure) {
      onExportError?.(failure);
      throw failure;
    } finally {
      if (alive.current) setExporting(false);
    }
  });

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
    return view.papers.filter((paper) => (!included || (snapshot.memberships[paper.id] ?? []).some((id) => included.has(id)))
      && (!favoriteOnly || paper.favorite) && (tagFilter === 'all' || paper.tagIds.includes(Number(tagFilter))));
  }, [view.papers, snapshot, selectedFolder, favoriteOnly, tagFilter]);
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
  const page = useBookListPagination(papers, JSON.stringify([query, folderId, sort, favoriteOnly, tagFilter]));
  const selectedPapers = view.papers.filter((paper) => selected.has(paper.id));
  const selectedIds = selectedPapers.map((paper) => paper.id);
  const pageIds = new Set(page.items.map((paper) => paper.id));
  const selectedOutsidePage = selectedIds.filter((id) => !pageIds.has(id)).length;
  const previewPaper = (previewId ? view.papers.find((paper) => paper.id === previewId) : undefined) ?? papers[0];
  const editingPaper = view.papers.find((paper) => paper.id === editingId);
  const allSelected = papers.length > 0 && papers.every((paper) => selected.has(paper.id));
  const allFavorites = selectedPapers.length > 0 && selectedPapers.every((paper) => paper.favorite);
  const allPinned = selectedPapers.length > 0 && selectedPapers.every((paper) => paper.pinned);
  const disabled = busy || action !== null || editingPaper !== undefined;
  const displayedError = error ?? view.error;

  useEffect(() => {
    if (disabled || !selectedFolder) setFolderMenuOpen(false);
  }, [disabled, selectedFolder]);

  useEffect(() => {
    if (!folderMenuOpen) return;
    const items = folderMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    (folderMenuInitialFocus.current === 'last' ? items?.[items.length - 1] : items?.[0])?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !folderMenuRef.current?.contains(event.target)) {
        setFolderMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', closeOutside);
    return () => { window.removeEventListener('pointerdown', closeOutside); };
  }, [folderMenuOpen]);

  const selectFolder = (id: string | null) => {
    setFolderId(id);
    setFolderMenuOpen(false);
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
  const closeFolderMenu = () => {
    setFolderMenuOpen(false);
    folderMenuTriggerRef.current?.focus();
  };
  const activateFolderAction = (value: string) => {
    // The dialog restores this persistent trigger instead of a removed menu item.
    closeFolderMenu();
    folderAction(value);
  };
  const handleFolderMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(folderMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeFolderMenu();
      return;
    }
    if (!items.length) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Home') items[0].focus();
      else if (event.key === 'End') items[items.length - 1].focus();
      else if (event.key === 'ArrowDown') items[(index + 1) % items.length].focus();
      else if (event.key === 'ArrowUp') items[(Math.max(index, 0) - 1 + items.length) % items.length].focus();
      else if (index >= 0) items[index].click();
    }
  };

  return (
    <section className="library-workspace" aria-label="科研文献库">
      <header className="library-workspace-header">
        <div><h1><BookOpen size={21} aria-hidden="true" />文献库</h1><p>本地保存 · 自动索引 · 一篇文献，多种归档</p><p>笔记 PDF 未加密，导出时需选择新文件名。</p></div>
        <div className="library-header-actions">
          <button className="library-tree-toggle" type="button" aria-label="切换分类目录" aria-pressed={foldersOpen} onClick={() => setFoldersOpen((current) => !current)}><PanelLeft size={16} />目录</button>
          {onOpenAiSettings ? <button type="button" disabled={disabled} onClick={onOpenAiSettings}><Settings2 size={15} />AI 设置</button> : null}
          <button type="button" className="library-primary" disabled={disabled || importing} onClick={() => void perform(() => onImport(selectedFolder?.id))}><Upload size={15} />{importing ? '导入中…' : '导入 PDF'}</button>
        </div>
      </header>
      {importing || importProgress ? <p className="library-progress" role="status">{importProgress || '正在导入文献并建立索引…'}</p> : null}
      {exporting ? <p className="library-progress" role="status">正在导出笔记 PDF…</p> : null}
      {displayedError ? <div className="library-notice library-error" role="alert"><span>{displayedError}</span><button type="button" disabled={busy} onClick={() => void perform(() => library.reload())}>重新载入</button><button type="button" aria-label="关闭错误提示" onClick={() => setError(null)}><X size={14} /></button></div> : null}
      {notice ? <div className="library-notice" role="status"><span>{notice}</span><button type="button" aria-label="关闭操作提示" onClick={() => setNotice(null)}><X size={14} /></button></div> : null}
      <div className="library-toolbar">
        <label className="library-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索文献" value={query} placeholder="搜索标题、作者、关键词或全文" onChange={(event) => {
          setQuery(event.target.value); setSelected(new Set()); if (mode === 'hover') setPreviewId(null);
        }} /></label>
        <label className="library-compact-folder"><span>分类</span><select aria-label="文献分类筛选" value={selectedFolder?.id ?? ''} onChange={(event) => selectFolder(event.target.value || null)}><option value="">全部文献</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <select aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">最近导入</option><option value="title">按标题</option><option value="year">按发表年份</option></select>
        <select aria-label="标签筛选" value={tagFilter} onChange={(event) => { setTagFilter(event.target.value); setSelected(new Set()); if (mode === 'hover') setPreviewId(null); }}>
          <option value="all">全部标签</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
        <button type="button" aria-pressed={favoriteOnly} onClick={() => { setFavoriteOnly((value) => !value); setSelected(new Set()); if (mode === 'hover') setPreviewId(null); }}><Star size={14} />仅收藏</button>
        {mode === 'off' ? <button type="button" disabled={busy} onClick={() => void perform(() => library.savePreferences({ previewMode: 'hover' }))}>显示预览</button> : null}
      </div>
      <div className="library-location-bar">
        <strong><Folder size={15} />{selectedFolder?.name ?? '全部文献'}<span>{papers.length} 篇可访问</span></strong>
        <div>
          <button type="button" disabled={disabled} aria-label="新建分类" onClick={() => setAction({ kind: 'createFolder', parentId: null })}><FolderPlus size={14} />新建分类</button>
          {selectedFolder ? (
            <div className="library-folder-menu-wrap" ref={folderMenuRef}>
              <button
                ref={folderMenuTriggerRef} type="button" aria-label="当前分类操作"
                aria-haspopup="menu" aria-expanded={folderMenuOpen} disabled={disabled}
                onClick={() => { folderMenuInitialFocus.current = 'first'; setFolderMenuOpen((open) => !open); }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  event.stopPropagation();
                  folderMenuInitialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
                  setFolderMenuOpen(true);
                }}
              >
                分类操作<ChevronDown size={13} aria-hidden="true" />
              </button>
              {folderMenuOpen && !disabled ? (
                <div className="library-folder-menu" role="menu" aria-label="当前分类操作菜单" onKeyDown={handleFolderMenuKeyDown}>
                  <button type="button" role="menuitem" onClick={() => activateFolderAction('createChild')}>新建子分类</button>
                  <button type="button" role="menuitem" onClick={() => activateFolderAction('renameFolder')}>重命名</button>
                  <button type="button" role="menuitem" disabled={activeVaultId !== null} onClick={() => activateFolderAction('moveFolder')}>移动分类</button>
                  <button type="button" role="menuitem" disabled={activeVaultId !== null} onClick={() => activateFolderAction('mergeFolder')}>合并分类</button>
                  <button type="button" role="menuitem" disabled={activeVaultId !== null} onClick={() => activateFolderAction('deleteFolder')}>删除分类</button>
                  {activeVaultId ? (
                    <button type="button" role="menuitem" disabled={!vaultUnlocked} onClick={() => activateFolderAction('decryptVault')}>解除加密</button>
                  ) : (
                    <button type="button" role="menuitem" onClick={() => activateFolderAction('encryptFolder')}>加密文件夹</button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          {activeVaultId ? <button type="button" disabled={disabled || vaultLocking} onClick={() => vaultUnlocked ? void perform(() => library.lockVault(activeVaultId), '文件夹已锁定。') : setAction({ kind: 'unlockVault', vaultId: activeVaultId })}><LockKeyhole size={14} />{vaultLocking ? '正在锁定…' : vaultUnlocked ? '锁定文件夹' : '解锁文件夹'}</button> : null}
        </div>
      </div>
      {activeVault ? <p className="library-vault-scope">加密范围：{snapshot.folders.find((folder) => folder.id === activeVault.folderId)?.name}及其子分类。同一论文的各分类入口共用加密状态。</p> : null}
      {selectedIds.length ? <div className="library-batch-toolbar" aria-label="批量文献操作">
        <strong>已选 {selectedIds.length} 篇</strong>
        {selectedOutsidePage ? <span>其中 {selectedOutsidePage} 篇不在当前显示范围</span> : null}
        <button type="button" disabled={disabled} onClick={() => setAction({ kind: 'categorize', paperIds: selectedIds, mode: 'move' })}>移动分类</button>
        <button type="button" disabled={disabled} onClick={() => setAction({ kind: 'categorize', paperIds: selectedIds, mode: 'add' })}>追加分类</button>
        <button type="button" aria-label={allPinned ? '批量取消置顶' : '批量置顶'} disabled={disabled} onClick={() => void perform(() => library.batchUpdate(selectedIds, { pinned: !allPinned }))}><Pin size={14} />{allPinned ? '取消置顶' : '置顶'}</button>
        <button type="button" aria-label={allFavorites ? '批量取消收藏' : '批量收藏'} disabled={disabled} onClick={() => void perform(() => library.batchUpdate(selectedIds, { favorite: !allFavorites }))}><Star size={14} />{allFavorites ? '取消收藏' : '收藏'}</button>
        <button type="button" disabled={disabled} onClick={() => exportNotes(selectedIds)}><Download size={14} />导出笔记 PDF</button>
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
          <div className="library-list-heading"><strong>{query.trim() ? `检索结果 ${papers.length} 篇` : '文献列表'}</strong>
            {papers.length > page.items.length ? <button type="button" disabled={disabled} onClick={() => setSelected((current) => {
              const next = new Set(current);
              for (const paper of papers) allSelected ? next.delete(paper.id) : next.add(paper.id);
              return next;
            })}>
              {allSelected ? '取消选择全部筛选结果' : `选择全部 ${papers.length} 条筛选结果`}
            </button> : null}
            <span>{snapshot.ai.autoEnrich ? '导入后自动 AI 分类' : '导入后自动建立索引'}</span></div>
          <div className="library-list-scroll">
            {view.lockedPaperIds.length ? <div className="library-locked-message"><LockKeyhole size={18} /><div><p>{view.lockedPaperIds.length} 篇文献已锁定或正在锁定，解锁后可查看和检索。</p><div>{snapshot.vaults.filter((vault) => !view.unlockedVaultIds.includes(vault.id)).map((vault) => <button key={vault.id} type="button" disabled={disabled || library.isVaultLocking(vault.id)} onClick={() => setAction({ kind: 'unlockVault', vaultId: vault.id })}>解锁 {snapshot.folders.find((folder) => folder.id === vault.folderId)?.name ?? '文件夹'}</button>)}</div></div></div> : null}
            {!view.loaded ? <p className="library-empty" role="status">正在载入本地文献库…</p> : papers.length ? <BookList
              label="文献列表" items={page.items.map(paperBookItem)}
              columns={['selection', 'name', 'authors', 'journal', 'path', 'opened', 'progress', 'page', 'tags', 'actions']}
              selection={{ selectedKeys: new Set([...selected].map((id) => `paper:${id}`)),
                selectPageLabel: '选择当前页全部文献', isDisabled: () => disabled,
                onChange: (item, checked) => setSelected((current) => {
                  const next = new Set(current); if (checked) next.add(item.source.id); else next.delete(item.source.id); return next;
                }),
                onSelectPage: (checked) => setSelected((current) => {
                  const next = new Set(current); for (const paper of page.items) checked ? next.add(paper.id) : next.delete(paper.id); return next;
                }) }}
              onOpen={(item) => void perform(() => onOpenPaper(item.source.id))}
              openLabel={(item) => `阅读 ${item.name}`} openDisabled={() => disabled}
              onRowMouseEnter={(item) => { if (mode === 'hover') setPreviewId(item.source.id); }}
              onRowFocus={(item) => { if (mode === 'hover') setPreviewId(item.source.id); }}
              rowClassName={(item) => previewPaper?.id === item.source.id && mode !== 'off' ? 'previewed' : undefined}
              renderNameDetails={({ source: paper }) => <span className="library-paper-meta">
                {paper.metadata.year ? <span>{paper.metadata.year}</span> : null}
                <span>{paper.pageCount ? `${paper.pageCount} 页` : '页数待识别'}</span><span>{formatFileSize(paper.fileSize)}</span>
                <span className={`library-index-status ${paper.indexStatus}`}>{paper.indexStatus === 'ready' ? '已索引' : paper.indexStatus === 'pending' ? '索引中' : paper.indexStatus === 'empty' ? '无文本' : '索引失败'}</span>
                {paper.aiStatus === 'ready' ? <span className="library-ai-ready">AI 已补全</span> : null}
              </span>}
              renderTags={({ source: paper }) => {
                const paperTags = tags.filter((tag) => paper.tagIds.includes(tag.id));
                return paperTags.length ? <div className="book-list-tags">{paperTags.map((tag) =>
                  <button key={tag.id} type="button" className="book-list-tag" style={{ color: tag.color, borderColor: tag.color }}
                    onClick={() => { setTagFilter(String(tag.id)); setSelected(new Set()); if (mode === 'hover') setPreviewId(null); }}>{tag.name}</button>)}</div> : '—';
              }}
              renderActions={({ source: paper, name: title }) => {
                const enriching = activity.enrichingPaperIds.includes(paper.id);
                return <div className="book-list-actions">
                  <button type="button" className="secondary-button" disabled={disabled} aria-label={`继续阅读 ${title}`} onClick={() => void perform(() => onOpenPaper(paper.id))}>继续阅读</button>
                  <button type="button" className="library-paper-favorite" disabled={disabled} aria-label={`${paper.favorite ? '取消收藏' : '收藏'} ${title}`}
                    aria-pressed={paper.favorite} onClick={() => void perform(() => library.batchUpdate([paper.id], { favorite: !paper.favorite }))}><Star size={16} fill={paper.favorite ? 'currentColor' : 'none'} /></button>
                  <BookListMenu name={title} disabled={disabled} actions={[
                    { label: '查看信息', onSelect: () => { setPreviewId(paper.id); if (mode === 'off') void perform(() => library.savePreferences({ previewMode: 'hover' })); } },
                    { label: '归类', onSelect: () => setAction({ kind: 'categorize', paperIds: [paper.id], mode: 'add' }) },
                    { label: '导出笔记', ariaLabel: `导出 ${title} 的笔记 PDF`, onSelect: () => exportNotes([paper.id]) },
                    enriching
                      ? { label: '取消 AI', ariaLabel: `取消 AI ${title}`, onSelect: () => { aiBatchCancelled.current = true; ai.cancelEnrichment(paper.id); } }
                      : { label: paper.aiStatus === 'error' ? '重试 AI' : 'AI 补全', ariaLabel: `AI 补全 ${title}`, disabled: aiBatchRunning || paper.indexStatus === 'pending', onSelect: () => runEnrichment([paper.id]) },
                    { label: paper.indexStatus === 'error' || paper.indexStatus === 'empty' ? '重试索引' : '重建索引', ariaLabel: `重新索引 ${title}`,
                      disabled: paper.indexStatus === 'pending', onSelect: () => setAction({ kind: 'reindex', paperIds: [paper.id] }) },
                  ]} />
                </div>;
              }}
              renderDetails={({ source: paper, name: title }) => {
                const hit = bestHits.get(paper.id);
                return hit || paper.indexError || paper.aiError ? <>
                  {hit ? <button type="button" className="library-search-hit" aria-label={`打开匹配 第 ${hit.page} 页 ${title}`} disabled={disabled} onClick={() => void perform(() => onOpenPaper(paper.id, hit.page))}><span>第 {hit.page} 页</span><p>{hit.snippet}</p></button> : null}
                  {paper.indexError ? <p className="library-paper-warning">{paper.indexError}</p> : null}
                  {paper.aiError ? <p className="library-paper-warning">AI：{paper.aiError}</p> : null}
                </> : null;
              }} pagination={page.pagination} /> : <div className="library-empty"><FileText size={34} aria-hidden="true" /><h2>{query.trim() || tagFilter !== 'all' ? '未找到匹配文献' : '这里还没有可访问的文献'}</h2><p>{query.trim() || tagFilter !== 'all' ? '试试标题、作者、关键词、标签，或更简短的全文检索词。' : '导入 PDF 后自动提取信息并建立索引，也可以将现有文献归入此分类。'}</p>{!query.trim() && tagFilter === 'all' ? <button type="button" className="library-primary" disabled={disabled || importing} onClick={() => void perform(() => onImport(selectedFolder?.id))}>导入文献</button> : null}</div>}
          </div>
        </div>
        {mode !== 'off' ? previewPaper ? <PaperPreview paper={previewPaper} mode={mode} fieldUsage={snapshot.preferences.fieldUsage} busy={busy} onModeChange={(previewMode) => { if (previewMode === 'pinned') setPreviewId(previewPaper.id); return library.savePreferences({ previewMode }); }} onEdit={() => setEditingId(previewPaper.id)} onOpenPage={(page) => onOpenPaper(previewPaper.id, page)} onToggleFavorite={() => library.batchUpdate([previewPaper.id], { favorite: !previewPaper.favorite })} onFieldView={(field) => library.recordFieldView(field)} /> : <aside className="library-preview-empty"><FileText size={26} /><p>在文献列表中悬停或选择一篇论文，查看完整信息。</p><button type="button" onClick={() => void perform(() => library.savePreferences({ previewMode: 'off' }))}>关闭预览</button></aside> : null}
      </div>
      {action ? <LibraryActionDialog key={JSON.stringify(action)} action={action} library={library} view={view} onClose={() => setAction(null)} onComplete={(message) => { setNotice(message); setAction(null); }} /> : null}
      {editingPaper ? <PaperMetadataEditor key={editingPaper.id} paper={editingPaper} onSave={(changes) => library.editMetadata(editingPaper.id, changes)} onClose={() => setEditingId(null)} /> : null}
    </section>
  );
}
