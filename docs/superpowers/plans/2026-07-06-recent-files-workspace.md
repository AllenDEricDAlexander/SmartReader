# Recent Files Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the concrete `最近文件` home workspace with full recent-document browsing, search, filters, sorting, and list/card display modes.

**Architecture:** Add a focused `HomeRecentFilesWorkspace` component that receives existing recent-document props from `HomeDashboard`, owns only UI state, and derives visible rows locally without changing persistence. Keep the existing dashboard summary `HomeRecentFiles` unchanged except for routing into the new workspace through the existing `onOpenRecentFiles` path.

**Tech Stack:** React 18, TypeScript, Vitest, React Testing Library, lucide-react, existing SmartReader home CSS in `src/app/styles.css`.

---

## Scope Source

Implement the approved design in `docs/superpowers/specs/2026-07-06-recent-files-workspace-design.md`.

Do not start the project automatically. Do not open a browser or use computer-control tools. Use narrow test/typecheck commands only.

## File Structure

- Create `src/home/HomeRecentFilesWorkspace.tsx`
  - Owns recent-files workspace layout, toolbar state, derived filtering/sorting, list view, card view, menu focus behavior, empty states, and action callbacks.
  - Exports `HomeRecentFilesWorkspace` only.
- Create `src/home/HomeRecentFilesWorkspace.test.tsx`
  - Covers the component in isolation with realistic `PersistedDocument` fixtures.
  - Tests all sorting, filtering, display-mode, and action wiring requirements.
- Modify `src/home/HomeDashboard.tsx`
  - Imports `HomeRecentFilesWorkspace`.
  - Renders it when `activeSidebarPage === 'recentFiles'`.
  - Keeps other blank pages routed through `HomeBlankPage`.
  - Passes current notice fallbacks for locate/remove actions.
- Modify `src/home/HomeBlankPage.tsx`
  - Removes `recentFiles` from blank-page labels so it is no longer treated as placeholder content.
- Modify `src/home/HomeDashboard.test.tsx`
  - Updates expectations that previously treated `recentFiles` as a blank page.
  - Adds/keeps coverage that `查看全部（N）` triggers `onOpenRecentFiles`.
- Modify `src/app/styles.css`
  - Adds workspace toolbar, filter, list, card, and responsive styles using existing home naming/style conventions.

## Task 1: Component Data Derivation and Rendering

**Files:**
- Create: `src/home/HomeRecentFilesWorkspace.tsx`
- Create: `src/home/HomeRecentFilesWorkspace.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing tests for baseline rendering and derived results**

Create `src/home/HomeRecentFilesWorkspace.test.tsx` with this content:

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { renderApp } from '../test/renderApp';
import { HomeRecentFilesWorkspace } from './HomeRecentFilesWorkspace';

const documents: PersistedDocument[] = [
  {
    documentKey: 'desktop:/Users/mario/Papers/Beta Research.pdf',
    path: '/Users/mario/Papers/Beta Research.pdf',
    displayName: 'Beta Research.pdf',
    fileSize: 1024,
    modifiedAt: '2026-07-03T09:30:00+08:00',
    pageCount: 100,
    lastPage: 15,
    progress: 0.15,
    missing: false,
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/Alpha Notes.pdf',
    path: '/Users/mario/Archive/Alpha Notes.pdf',
    displayName: 'Alpha Notes.pdf',
    fileSize: 2048,
    modifiedAt: '2026-07-05T11:00:00+08:00',
    pageCount: 20,
    lastPage: 20,
    progress: 1,
    missing: false,
  },
  {
    documentKey: 'desktop:/Users/mario/Drafts/Gamma Draft.pdf',
    path: '/Users/mario/Drafts/Gamma Draft.pdf',
    displayName: 'Gamma Draft.pdf',
    fileSize: 4096,
    modifiedAt: '2026-07-01T08:00:00+08:00',
    pageCount: 50,
    lastPage: 0,
    progress: 0,
    missing: false,
  },
  {
    documentKey: 'browser:untitled-local',
    path: null,
    displayName: 'Local Browser Upload.pdf',
    fileSize: null,
    modifiedAt: null,
    pageCount: null,
    lastPage: 0,
    progress: 0,
    missing: false,
  },
];

function renderWorkspace(
  overrides: Partial<ComponentProps<typeof HomeRecentFilesWorkspace>> = {},
) {
  const props: ComponentProps<typeof HomeRecentFilesWorkspace> = {
    documents,
    favoriteDocumentKeys: new Set(['desktop:/Users/mario/Archive/Alpha Notes.pdf']),
    onOpenPdf: vi.fn(),
    onReopenDocument: vi.fn(),
    onToggleFavorite: vi.fn(),
    onLocateFile: vi.fn(),
    onRemoveRecent: vi.fn(),
    ...overrides,
  };

  renderApp(<HomeRecentFilesWorkspace {...props} />);

  return props;
}

function listedNames() {
  return screen
    .getAllByTestId('recent-workspace-document')
    .map((element) => within(element).getByTestId('recent-workspace-document-name').textContent);
}

describe('HomeRecentFilesWorkspace', () => {
  it('renders the recent files workspace with all documents in recent-open order', () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: '最近文件' })).toBeInTheDocument();
    expect(screen.getByText('共 4 个最近文件，当前显示 4 个')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索最近文件' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '排序方式' })).toHaveValue('recent');
    expect(screen.getByRole('combobox', { name: '阅读进度筛选' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: '收藏状态筛选' })).toHaveValue('all');
    expect(screen.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'false');
    expect(listedNames()).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
      'Gamma Draft.pdf',
      'Local Browser Upload.pdf',
    ]);
  });

  it('searches by file name and path and can clear filters without changing view mode', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '卡片视图' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索最近文件' }), {
      target: { value: 'drafts' },
    });

    expect(screen.getByText('共 4 个最近文件，当前显示 1 个')).toBeInTheDocument();
    expect(listedNames()).toEqual(['Gamma Draft.pdf']);

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));

    expect(screen.getByRole('searchbox', { name: '搜索最近文件' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('共 4 个最近文件，当前显示 4 个')).toBeInTheDocument();
  });

  it('shows a no-result state for unmatched filters', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索最近文件' }), {
      target: { value: 'does-not-exist' },
    });

    expect(screen.getByText('没有匹配的最近文件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeEnabled();
  });

  it('shows the no-record empty state and opens a PDF from the empty action', () => {
    const props = renderWorkspace({ documents: [] });

    expect(screen.getByText('暂无最近文件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));

    expect(props.onOpenPdf).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
npm test -- HomeRecentFilesWorkspace
```

Expected: FAIL because `src/home/HomeRecentFilesWorkspace.tsx` does not exist or does not export `HomeRecentFilesWorkspace`.

- [ ] **Step 3: Implement the initial workspace component**

Create `src/home/HomeRecentFilesWorkspace.tsx` with this content:

```tsx
import { FileText, Grid2X2, List, Search, Star } from 'lucide-react';
import { useMemo, useState, type ChangeEvent } from 'react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { formatDateTime, formatProgressPercent, getDirectoryPath } from './homeDisplayUtils';

type SortMode = 'recent' | 'name' | 'progressDesc' | 'progressAsc';
type ProgressFilter = 'all' | 'notStarted' | 'reading' | 'completed';
type FavoriteFilter = 'all' | 'favorite' | 'notFavorite';
type ViewMode = 'list' | 'cards';

type HomeRecentFilesWorkspaceProps = {
  documents: PersistedDocument[];
  favoriteDocumentKeys: Set<string>;
  onOpenPdf(): void | Promise<unknown>;
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onLocateFile(document: PersistedDocument): void;
  onRemoveRecent(document: PersistedDocument): void;
};

function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase();
}

function getDocumentSearchText(document: PersistedDocument) {
  return [document.displayName, document.path, document.documentKey]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function matchesProgressFilter(document: PersistedDocument, filter: ProgressFilter) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'notStarted') {
    return document.progress <= 0;
  }

  if (filter === 'reading') {
    return document.progress > 0 && document.progress < 1;
  }

  return document.progress >= 1;
}

function getModifiedTime(document: PersistedDocument) {
  if (!document.modifiedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const time = new Date(document.modifiedAt).getTime();

  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function compareByName(left: PersistedDocument, right: PersistedDocument) {
  return left.displayName.localeCompare(right.displayName, 'zh-Hans-CN');
}

function sortDocuments(documents: PersistedDocument[], sortMode: SortMode) {
  return [...documents].sort((left, right) => {
    if (sortMode === 'name') {
      return compareByName(left, right);
    }

    if (sortMode === 'progressDesc') {
      return right.progress - left.progress || compareByName(left, right);
    }

    if (sortMode === 'progressAsc') {
      return left.progress - right.progress || compareByName(left, right);
    }

    return getModifiedTime(right) - getModifiedTime(left) || compareByName(left, right);
  });
}

export function HomeRecentFilesWorkspace({
  documents,
  favoriteDocumentKeys,
  onOpenPdf,
  onReopenDocument,
  onToggleFavorite,
  onLocateFile: _onLocateFile,
  onRemoveRecent: _onRemoveRecent,
}: HomeRecentFilesWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('all');
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const normalizedQuery = normalizeSearchValue(query);
  const filtering = normalizedQuery !== '' || progressFilter !== 'all' || favoriteFilter !== 'all';

  const visibleDocuments = useMemo(() => {
    const filteredDocuments = documents.filter((document) => {
      if (normalizedQuery && !getDocumentSearchText(document).includes(normalizedQuery)) {
        return false;
      }

      if (!matchesProgressFilter(document, progressFilter)) {
        return false;
      }

      const favorite = favoriteDocumentKeys.has(document.documentKey);

      if (favoriteFilter === 'favorite') {
        return favorite;
      }

      if (favoriteFilter === 'notFavorite') {
        return !favorite;
      }

      return true;
    });

    return sortDocuments(filteredDocuments, sortMode);
  }, [documents, favoriteDocumentKeys, favoriteFilter, normalizedQuery, progressFilter, sortMode]);

  const clearFilters = () => {
    setQuery('');
    setSortMode('recent');
    setProgressFilter('all');
    setFavoriteFilter('all');
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const renderDocument = (document: PersistedDocument) => {
    const favorite = favoriteDocumentKeys.has(document.documentKey);
    const progressPercent = formatProgressPercent(document.progress);

    return (
      <article
        key={document.documentKey}
        className={viewMode === 'cards' ? 'recent-workspace-card' : 'recent-workspace-row'}
        data-testid="recent-workspace-document"
      >
        <div className="recent-workspace-file-main">
          <span className="pdf-file-icon" aria-hidden="true">
            <FileText size={16} />
          </span>
          <div>
            <strong data-testid="recent-workspace-document-name" title={document.displayName}>
              {document.displayName}
            </strong>
            <span title={document.path ?? '本地浏览器文件'}>{getDirectoryPath(document.path)}</span>
          </div>
        </div>
        <div className="recent-workspace-meta">
          <span>{formatDateTime(document.modifiedAt)}</span>
          <span>
            {document.pageCount ? `${document.lastPage} / ${document.pageCount} 页` : '页数未知'}
          </span>
        </div>
        <div className="progress-cell">
          <span>{progressPercent}%</span>
          <span
            className="recent-progress"
            role="progressbar"
            aria-label={`阅读进度 ${document.displayName}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </span>
        </div>
        <div className="recent-workspace-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void onReopenDocument(document)}
          >
            继续阅读
          </button>
          <button
            type="button"
            className={favorite ? 'icon-button active' : 'icon-button'}
            aria-label={`${favorite ? '取消收藏' : '收藏'} ${document.displayName}`}
            onClick={() => void onToggleFavorite(document.documentKey, !favorite)}
          >
            <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
      </article>
    );
  };

  return (
    <section className="home-panel recent-workspace" aria-labelledby="recent-workspace-title">
      <div className="section-heading horizontal recent-workspace-heading">
        <div>
          <p>文档管理</p>
          <h2 id="recent-workspace-title">最近文件</h2>
          <span>查看、筛选并继续阅读最近打开过的本地 PDF。</span>
        </div>
        <span className="recent-workspace-count">
          共 {documents.length} 个最近文件，当前显示 {visibleDocuments.length} 个
        </span>
      </div>

      {documents.length > 0 ? (
        <>
          <div className="recent-workspace-toolbar">
            <label className="recent-workspace-search">
              <span>搜索最近文件</span>
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={query}
                aria-label="搜索最近文件"
                placeholder="搜索文件名或路径..."
                onChange={handleQueryChange}
              />
            </label>
            <label>
              <span>排序方式</span>
              <select
                value={sortMode}
                aria-label="排序方式"
                onChange={(event) => setSortMode(event.target.value as SortMode)}
              >
                <option value="recent">最近打开优先</option>
                <option value="name">文件名 A-Z</option>
                <option value="progressDesc">阅读进度高到低</option>
                <option value="progressAsc">阅读进度低到高</option>
              </select>
            </label>
            <label>
              <span>阅读进度筛选</span>
              <select
                value={progressFilter}
                aria-label="阅读进度筛选"
                onChange={(event) => setProgressFilter(event.target.value as ProgressFilter)}
              >
                <option value="all">全部进度</option>
                <option value="notStarted">未开始</option>
                <option value="reading">阅读中</option>
                <option value="completed">已读完</option>
              </select>
            </label>
            <label>
              <span>收藏状态筛选</span>
              <select
                value={favoriteFilter}
                aria-label="收藏状态筛选"
                onChange={(event) => setFavoriteFilter(event.target.value as FavoriteFilter)}
              >
                <option value="all">全部文件</option>
                <option value="favorite">已收藏</option>
                <option value="notFavorite">未收藏</option>
              </select>
            </label>
            <div className="recent-workspace-view-toggle" aria-label="显示方式">
              <button
                type="button"
                className="icon-text-button"
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
              >
                <List size={16} />
                列表视图
              </button>
              <button
                type="button"
                className="icon-text-button"
                aria-pressed={viewMode === 'cards'}
                onClick={() => setViewMode('cards')}
              >
                <Grid2X2 size={16} />
                卡片视图
              </button>
            </div>
            <button type="button" className="text-link-button" disabled={!filtering} onClick={clearFilters}>
              清除筛选
            </button>
          </div>

          {visibleDocuments.length > 0 ? (
            <div className={viewMode === 'cards' ? 'recent-workspace-grid' : 'recent-workspace-list'}>
              {visibleDocuments.map(renderDocument)}
            </div>
          ) : (
            <div className="empty-block">
              <strong>没有匹配的最近文件</strong>
              <span>调整关键词或筛选条件后再试。</span>
            </div>
          )}
        </>
      ) : (
        <div className="empty-block recent-workspace-empty">
          <strong>暂无最近文件</strong>
          <span>打开 PDF 后会显示在这里。</span>
          <button type="button" className="primary-button" onClick={() => void onOpenPdf()}>
            打开文件
          </button>
        </div>
      )}
    </section>
  );
}
```

Append this CSS to the home section of `src/app/styles.css`, near existing `.home-recent-files` styles:

```css
.recent-workspace {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.recent-workspace-heading > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recent-workspace-heading span {
  color: #64748b;
  font-size: 13px;
}

.recent-workspace-count {
  border: 1px solid #dbe4f0;
  border-radius: 999px;
  color: #475569;
  font-size: 13px;
  padding: 6px 12px;
  white-space: nowrap;
}

.recent-workspace-toolbar {
  align-items: end;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(220px, 1.5fr) repeat(3, minmax(140px, 0.7fr)) auto auto;
}

.recent-workspace-toolbar label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-workspace-toolbar label > span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.recent-workspace-toolbar input,
.recent-workspace-toolbar select {
  background: #ffffff;
  border: 1px solid #dbe4f0;
  border-radius: 8px;
  color: #0f172a;
  min-height: 38px;
  padding: 0 12px;
}

.recent-workspace-search {
  position: relative;
}

.recent-workspace-search svg {
  bottom: 11px;
  color: #64748b;
  left: 12px;
  position: absolute;
}

.recent-workspace-search input {
  padding-left: 36px;
}

.recent-workspace-view-toggle {
  border: 1px solid #dbe4f0;
  border-radius: 10px;
  display: inline-flex;
  min-height: 38px;
  overflow: hidden;
}

.icon-text-button {
  align-items: center;
  background: #ffffff;
  border: 0;
  color: #475569;
  cursor: pointer;
  display: inline-flex;
  gap: 6px;
  padding: 0 12px;
}

.icon-text-button[aria-pressed='true'] {
  background: #eff6ff;
  color: #2563eb;
}

.recent-workspace-list,
.recent-workspace-grid {
  display: grid;
  gap: 12px;
}

.recent-workspace-row,
.recent-workspace-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  display: grid;
  gap: 14px;
  padding: 14px;
}

.recent-workspace-row {
  align-items: center;
  grid-template-columns: minmax(240px, 1.8fr) minmax(160px, 0.8fr) minmax(150px, 0.8fr) auto;
}

.recent-workspace-grid {
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}

.recent-workspace-card {
  align-content: start;
  min-height: 190px;
}

.recent-workspace-file-main {
  align-items: center;
  display: flex;
  gap: 10px;
  min-width: 0;
}

.recent-workspace-file-main > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.recent-workspace-file-main strong,
.recent-workspace-file-main span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-workspace-file-main span:last-child,
.recent-workspace-meta {
  color: #64748b;
  font-size: 12px;
}

.recent-workspace-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recent-workspace-actions {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.icon-button.active {
  color: #f59e0b;
}

.recent-workspace-empty {
  min-height: 220px;
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run:

```bash
npm test -- HomeRecentFilesWorkspace
```

Expected: PASS for all tests in `HomeRecentFilesWorkspace.test.tsx`.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/home/HomeRecentFilesWorkspace.tsx src/home/HomeRecentFilesWorkspace.test.tsx src/app/styles.css
git commit -m "feat: add recent files workspace shell"
```

Expected: commit succeeds with only those three files staged.

## Task 2: Filters, Sorting, Card View, and Actions

**Files:**
- Modify: `src/home/HomeRecentFilesWorkspace.tsx`
- Modify: `src/home/HomeRecentFilesWorkspace.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing tests for filter/sort/action coverage**

Append these tests inside the existing `describe('HomeRecentFilesWorkspace', () => { ... })` block in `src/home/HomeRecentFilesWorkspace.test.tsx`:

```tsx
  it('filters by progress buckets', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('combobox', { name: '阅读进度筛选' }), {
      target: { value: 'notStarted' },
    });
    expect(listedNames()).toEqual(['Gamma Draft.pdf', 'Local Browser Upload.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '阅读进度筛选' }), {
      target: { value: 'reading' },
    });
    expect(listedNames()).toEqual(['Beta Research.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '阅读进度筛选' }), {
      target: { value: 'completed' },
    });
    expect(listedNames()).toEqual(['Alpha Notes.pdf']);
  });

  it('filters by favorite state', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('combobox', { name: '收藏状态筛选' }), {
      target: { value: 'favorite' },
    });
    expect(listedNames()).toEqual(['Alpha Notes.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '收藏状态筛选' }), {
      target: { value: 'notFavorite' },
    });
    expect(listedNames()).toEqual([
      'Beta Research.pdf',
      'Gamma Draft.pdf',
      'Local Browser Upload.pdf',
    ]);
  });

  it('sorts by name and reading progress', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('combobox', { name: '排序方式' }), {
      target: { value: 'name' },
    });
    expect(listedNames()).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
      'Gamma Draft.pdf',
      'Local Browser Upload.pdf',
    ]);

    fireEvent.change(screen.getByRole('combobox', { name: '排序方式' }), {
      target: { value: 'progressDesc' },
    });
    expect(listedNames()).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
      'Gamma Draft.pdf',
      'Local Browser Upload.pdf',
    ]);

    fireEvent.change(screen.getByRole('combobox', { name: '排序方式' }), {
      target: { value: 'progressAsc' },
    });
    expect(listedNames()).toEqual([
      'Gamma Draft.pdf',
      'Local Browser Upload.pdf',
      'Beta Research.pdf',
      'Alpha Notes.pdf',
    ]);
  });

  it('switches to card view while keeping visible documents', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '卡片视图' }));

    expect(screen.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('recent-workspace-results')).toHaveClass('recent-workspace-grid');
    expect(listedNames()).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
      'Gamma Draft.pdf',
      'Local Browser Upload.pdf',
    ]);
  });

  it('wires continue reading and favorite toggles', () => {
    const props = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '继续阅读 Beta Research.pdf' }));
    expect(props.onReopenDocument).toHaveBeenCalledWith(documents[0]);

    fireEvent.click(screen.getByRole('button', { name: '收藏 Beta Research.pdf' }));
    expect(props.onToggleFavorite).toHaveBeenCalledWith(
      'desktop:/Users/mario/Papers/Beta Research.pdf',
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消收藏 Alpha Notes.pdf' }));
    expect(props.onToggleFavorite).toHaveBeenCalledWith(
      'desktop:/Users/mario/Archive/Alpha Notes.pdf',
      false,
    );
  });
```

- [ ] **Step 2: Run tests to verify failures**

Run:

```bash
npm test -- HomeRecentFilesWorkspace
```

Expected: FAIL because `recent-workspace-results` test id is missing and continue-reading buttons are not uniquely labelled with document names.

- [ ] **Step 3: Update component for accessible action labels and results test id**

In `src/home/HomeRecentFilesWorkspace.tsx`, change the results wrapper and continue button inside `renderDocument`.

Replace:

```tsx
<button
  type="button"
  className="secondary-button"
  onClick={() => void onReopenDocument(document)}
>
  继续阅读
</button>
```

With:

```tsx
<button
  type="button"
  className="secondary-button"
  aria-label={`继续阅读 ${document.displayName}`}
  onClick={() => void onReopenDocument(document)}
>
  继续阅读
</button>
```

Replace:

```tsx
<div className={viewMode === 'cards' ? 'recent-workspace-grid' : 'recent-workspace-list'}>
  {visibleDocuments.map(renderDocument)}
</div>
```

With:

```tsx
<div
  className={viewMode === 'cards' ? 'recent-workspace-grid' : 'recent-workspace-list'}
  data-testid="recent-workspace-results"
>
  {visibleDocuments.map(renderDocument)}
</div>
```

- [ ] **Step 4: Run component tests to verify pass**

Run:

```bash
npm test -- HomeRecentFilesWorkspace
```

Expected: PASS for all `HomeRecentFilesWorkspace` tests.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/home/HomeRecentFilesWorkspace.tsx src/home/HomeRecentFilesWorkspace.test.tsx src/app/styles.css
git commit -m "feat: support recent file filters and views"
```

Expected: commit succeeds with only those files staged.

## Task 3: Dashboard Routing and Blank-Page Removal

**Files:**
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeBlankPage.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`

- [ ] **Step 1: Add failing dashboard routing tests**

In `src/home/HomeDashboard.test.tsx`, replace the test that expects `recentFiles` to render a blank page with this test:

```tsx
  it('renders the recent files workspace for the recent files sidebar page', () => {
    renderDashboard({ activeSidebarPage: 'recentFiles', recentDocuments: recentTableDocuments });

    expect(screen.getByRole('heading', { name: '最近文件' })).toBeInTheDocument();
    expect(screen.getByText('共 6 个最近文件，当前显示 6 个')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索最近文件' })).toBeInTheDocument();
    expect(screen.queryByText('SmartReader')).not.toBeInTheDocument();
  });
```

If the old test name differs, locate it with:

```bash
rg -n "recentFiles|最近文件|blank page" src/home/HomeDashboard.test.tsx
```

and replace only the `recentFiles` blank-page expectation, not tests for other blank pages.

- [ ] **Step 2: Run dashboard test to verify failure**

Run:

```bash
npm test -- HomeDashboard
```

Expected: FAIL because `activeSidebarPage === 'recentFiles'` still routes to `HomeBlankPage`.

- [ ] **Step 3: Route `recentFiles` to `HomeRecentFilesWorkspace`**

In `src/home/HomeDashboard.tsx`, add this import near the existing home imports:

```tsx
import { HomeRecentFilesWorkspace } from './HomeRecentFilesWorkspace';
```

Replace the current `mainContent` declaration:

```tsx
const mainContent = isHomeBlankPageId(activeSidebarPage) ? (
  <div className="home-content home-blank-content">
    <HomeBlankPage page={activeSidebarPage} />
  </div>
) : (
  homeContent
);
```

With:

```tsx
const recentFilesContent = (
  <div className="home-content home-blank-content">
    <HomeRecentFilesWorkspace
      documents={recentDocuments}
      favoriteDocumentKeys={favoriteDocumentKeys}
      onOpenPdf={handleOpenPdf}
      onReopenDocument={onReopenRecentDocument}
      onToggleFavorite={onToggleFavorite}
      onLocateFile={() =>
        showNotice('定位文件功能待补充', '定位文件将在最近文件管理功能中补充。')
      }
      onRemoveRecent={() =>
        showNotice('移除最近记录功能待补充', '从最近记录移除将在最近文件管理功能中补充。')
      }
    />
  </div>
);

const mainContent =
  activeSidebarPage === 'recentFiles' ? (
    recentFilesContent
  ) : isHomeBlankPageId(activeSidebarPage) ? (
    <div className="home-content home-blank-content">
      <HomeBlankPage page={activeSidebarPage} />
    </div>
  ) : (
    homeContent
  );
```

- [ ] **Step 4: Remove `recentFiles` from blank-page labels**

In `src/home/HomeBlankPage.tsx`, replace:

```tsx
const blankPageLabels = {
  recentFiles: '最近文件',
  favoriteFiles: '收藏文件',
  sessionRestore: '会话恢复',
  myDocuments: '我的文献',
  folders: '文件夹',
  notes: '笔记管理',
} satisfies Partial<Record<HomeSidebarPage, string>>;
```

With:

```tsx
const blankPageLabels = {
  favoriteFiles: '收藏文件',
  sessionRestore: '会话恢复',
  myDocuments: '我的文献',
  folders: '文件夹',
  notes: '笔记管理',
} satisfies Partial<Record<HomeSidebarPage, string>>;
```

- [ ] **Step 5: Run dashboard tests to verify pass**

Run:

```bash
npm test -- HomeDashboard
```

Expected: PASS for `HomeDashboard` tests. If the assertion `queryByText('SmartReader')` is too broad because another visible surface contains that text, narrow the test by asserting the blank-page section is absent with `screen.queryByRole('heading', { name: 'SmartReader' })` only if that exact role exists; do not delete the workspace assertions.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/home/HomeDashboard.tsx src/home/HomeBlankPage.tsx src/home/HomeDashboard.test.tsx
git commit -m "feat: route recent files workspace"
```

Expected: commit succeeds with only those files staged.

## Task 4: More Menu Parity for Locate and Remove Fallbacks

**Files:**
- Modify: `src/home/HomeRecentFilesWorkspace.tsx`
- Modify: `src/home/HomeRecentFilesWorkspace.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing menu tests**

Append this test inside `describe('HomeRecentFilesWorkspace', () => { ... })` in `src/home/HomeRecentFilesWorkspace.test.tsx`:

```tsx
  it('opens the row menu and wires locate and remove fallback actions', () => {
    const props = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '更多操作 Beta Research.pdf' }));

    const menu = screen.getByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '定位文件' }));
    expect(props.onLocateFile).toHaveBeenCalledWith(documents[0]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多操作 Beta Research.pdf' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '从最近记录移除' }));
    expect(props.onRemoveRecent).toHaveBeenCalledWith(documents[0]);
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- HomeRecentFilesWorkspace
```

Expected: FAIL because the workspace does not expose a more menu.

- [ ] **Step 3: Add menu state, refs, and keyboard handling**

In `src/home/HomeRecentFilesWorkspace.tsx`, update imports:

Replace:

```tsx
import { useMemo, useState, type ChangeEvent } from 'react';
```

With:

```tsx
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
```

Update lucide import:

Replace:

```tsx
import { FileText, Grid2X2, List, Search, Star } from 'lucide-react';
```

With:

```tsx
import { FileText, Grid2X2, List, MoreVertical, Search, Star } from 'lucide-react';
```

Inside `HomeRecentFilesWorkspace`, replace the destructured unused callbacks:

```tsx
onLocateFile: _onLocateFile,
onRemoveRecent: _onRemoveRecent,
```

With:

```tsx
onLocateFile,
onRemoveRecent,
```

Add these declarations after `const [viewMode, setViewMode] = useState<ViewMode>('list');`:

```tsx
const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
const menuItemRefs = useRef(new Map<string, Array<HTMLButtonElement | null>>());
```

Add these helpers before `const renderDocument = ...`:

```tsx
useEffect(() => {
  if (!openMenuKey) {
    return;
  }

  menuItemRefs.current.get(openMenuKey)?.[0]?.focus();
}, [openMenuKey]);

const closeMenu = () => {
  setOpenMenuKey(null);
};

const closeMenuAndFocusTrigger = (documentKey: string) => {
  closeMenu();
  triggerRefs.current.get(documentKey)?.focus();
};

const handleMenuAction = (action: () => void | Promise<void>) => {
  closeMenu();
  void action();
};

const setTriggerRef = (documentKey: string, element: HTMLButtonElement | null) => {
  if (element) {
    triggerRefs.current.set(documentKey, element);
    return;
  }

  triggerRefs.current.delete(documentKey);
};

const setMenuItemRef = (
  documentKey: string,
  index: number,
  element: HTMLButtonElement | null,
) => {
  const items = menuItemRefs.current.get(documentKey) ?? [];

  if (element) {
    items[index] = element;
    menuItemRefs.current.set(documentKey, items);
    return;
  }

  items[index] = null;
  if (items.some(Boolean)) {
    menuItemRefs.current.set(documentKey, items);
    return;
  }

  menuItemRefs.current.delete(documentKey);
};

const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>, documentKey: string) => {
  const menuItems = menuItemRefs.current.get(documentKey)?.filter(Boolean) ?? [];

  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenuAndFocusTrigger(documentKey);
    return;
  }

  if (menuItems.length === 0) {
    return;
  }

  const currentIndex = Math.max(
    menuItems.findIndex((item) => item === document.activeElement),
    0,
  );

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    menuItems[(currentIndex + 1) % menuItems.length]?.focus();
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    menuItems[(currentIndex - 1 + menuItems.length) % menuItems.length]?.focus();
    return;
  }

  if (event.key === 'Home') {
    event.preventDefault();
    menuItems[0]?.focus();
    return;
  }

  if (event.key === 'End') {
    event.preventDefault();
    menuItems[menuItems.length - 1]?.focus();
  }
};
```

- [ ] **Step 4: Add menu UI inside document actions**

Inside `renderDocument`, after `const progressPercent = formatProgressPercent(document.progress);`, add:

```tsx
const menuOpen = openMenuKey === document.documentKey;
```

Inside `<div className="recent-workspace-actions">`, after the favorite button, add:

```tsx
<div className="recent-workspace-menu-wrap">
  <button
    type="button"
    ref={(element) => setTriggerRef(document.documentKey, element)}
    className="icon-button"
    aria-label={`更多操作 ${document.displayName}`}
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    onClick={() => setOpenMenuKey(menuOpen ? null : document.documentKey)}
  >
    <MoreVertical size={16} />
  </button>
  {menuOpen ? (
    <div
      className="recent-file-menu"
      role="menu"
      onKeyDown={(event) => handleMenuKeyDown(event, document.documentKey)}
    >
      <button
        type="button"
        ref={(element) => setMenuItemRef(document.documentKey, 0, element)}
        role="menuitem"
        onClick={() => handleMenuAction(() => onReopenDocument(document))}
      >
        打开
      </button>
      <button
        type="button"
        ref={(element) => setMenuItemRef(document.documentKey, 1, element)}
        role="menuitem"
        onClick={() =>
          handleMenuAction(() => onToggleFavorite(document.documentKey, !favorite))
        }
      >
        {favorite ? '取消收藏' : '收藏'}
      </button>
      <button
        type="button"
        ref={(element) => setMenuItemRef(document.documentKey, 2, element)}
        role="menuitem"
        onClick={() => handleMenuAction(() => onLocateFile(document))}
      >
        定位文件
      </button>
      <button
        type="button"
        ref={(element) => setMenuItemRef(document.documentKey, 3, element)}
        role="menuitem"
        onClick={() => handleMenuAction(() => onRemoveRecent(document))}
      >
        从最近记录移除
      </button>
    </div>
  ) : null}
</div>
```

Append this CSS near the other recent workspace styles:

```css
.recent-workspace-menu-wrap {
  position: relative;
}

.recent-workspace-menu-wrap .recent-file-menu {
  right: 0;
  top: calc(100% + 6px);
}
```

- [ ] **Step 5: Run component tests to verify pass**

Run:

```bash
npm test -- HomeRecentFilesWorkspace
```

Expected: PASS for all workspace tests.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/home/HomeRecentFilesWorkspace.tsx src/home/HomeRecentFilesWorkspace.test.tsx src/app/styles.css
git commit -m "feat: add recent file workspace menu actions"
```

Expected: commit succeeds with only those files staged.

## Task 5: Responsive Polish and Final Validation

**Files:**
- Modify: `src/app/styles.css`
- Modify: `src/home/HomeRecentFilesWorkspace.test.tsx` if needed for final accessibility assertions

- [ ] **Step 1: Add responsive CSS for workspace toolbar and rows**

Append this CSS near existing media queries in `src/app/styles.css`. If the file already has matching `@media` sections for home content, add the selectors inside those sections instead of creating duplicates:

```css
@media (max-width: 1180px) {
  .recent-workspace-toolbar {
    grid-template-columns: repeat(2, minmax(180px, 1fr));
  }

  .recent-workspace-view-toggle,
  .recent-workspace-toolbar .text-link-button {
    justify-self: start;
  }

  .recent-workspace-row {
    grid-template-columns: minmax(220px, 1fr) minmax(160px, 0.6fr);
  }

  .recent-workspace-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .recent-workspace-toolbar {
    grid-template-columns: 1fr;
  }

  .recent-workspace-heading.horizontal {
    align-items: flex-start;
    flex-direction: column;
  }

  .recent-workspace-row {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .recent-workspace-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Run focused component and dashboard tests**

Run:

```bash
npm test -- HomeRecentFilesWorkspace HomeDashboard
```

Expected: PASS for both test targets. If Vitest treats the arguments as separate filters and runs only one file, run the two focused commands separately:

```bash
npm test -- HomeRecentFilesWorkspace
npm test -- HomeDashboard
```

Expected: both PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run full test suite if focused validation passes**

Run:

```bash
npm test
```

Expected: PASS. If unrelated existing tests fail, capture the failing test names and error output in the final implementation report; do not modify unrelated files.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add src/app/styles.css src/home/HomeRecentFilesWorkspace.test.tsx
git commit -m "style: polish recent files workspace responsiveness"
```

Expected: commit succeeds only if Task 5 changed files. If no file changed in Task 5 after validation, skip this commit and state that no final polish commit was needed.

## Final Review Checklist

- [ ] `activeSidebarPage === 'recentFiles'` renders `HomeRecentFilesWorkspace`, not `HomeBlankPage`.
- [ ] Home `查看全部（N）` still calls `onOpenRecentFiles`.
- [ ] Workspace displays all provided recent documents.
- [ ] Search checks file name, path, and document key fallback.
- [ ] Sorting supports recent-open, name, progress descending, and progress ascending.
- [ ] Filtering supports all/not started/reading/completed progress states.
- [ ] Filtering supports all/favorite/not-favorite favorite states.
- [ ] List and card view toggles preserve visible results.
- [ ] Continue reading calls `onReopenDocument`.
- [ ] Favorite toggle calls `onToggleFavorite` with the next state.
- [ ] Locate and remove menu actions call the existing fallback callbacks.
- [ ] Empty states exist for no records and no matching results.
- [ ] No persistence API, schema, Tauri command, or dependency changes were introduced.
- [ ] Focused tests and typecheck were run and reported.
