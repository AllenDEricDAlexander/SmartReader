# Tag Management UI Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the existing tag management dashboard inside the SmartReader home frame and fix the detail-panel close behavior.

**Architecture:** Keep `ReaderApp` as the top-level state owner, keep `HomeDashboard` as the shell for sidebar pages, and keep `TagManager` as the tag dashboard owner. The implementation changes routing and composition rather than rebuilding tag persistence or dashboard data.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing CSS in `src/app/styles.css`, existing tag dashboard persistence API.

---

## File Structure

- Modify `src/home/HomeDashboard.tsx`
  - Add `TagManager` as the `activeSidebarPage === 'tags'` content branch.
  - Accept tag dashboard persistence, tag list update, and tagged-document open callbacks from `ReaderWorkspaceSwitch`.

- Modify `src/home/HomeDashboard.test.tsx`
  - Add default tag dashboard props to the test helper.
  - Replace the old fallback assertion for the `tags` sidebar page with a frame-preserving tag page assertion.
  - Add style assertions for the home-framed tag page.

- Modify `src/app/ReaderWorkspaceSwitch.tsx`
  - Pass tag manager props into `HomeDashboard`.
  - Route `onOpenTags` through `openHomeSidebarPage('tags')`.
  - Keep the old `activeWorkspace === 'tags'` branch only as compatibility until a later cleanup.

- Modify `src/app/ReaderWorkspaceSwitch.test.tsx`
  - Verify that the `tags` sidebar page renders inside the home frame.

- Modify `src/app/App.test.tsx`
  - Strengthen the existing tag manager integration test so it proves the home frame stays visible.

- Modify `src/tags/TagManager.tsx`
  - Change detail close semantics from workspace close to selected-detail clear.
  - Stop falling back to the first detail when `selectedTagId` is intentionally `null`.

- Modify `src/tags/TagManager.test.tsx`
  - Verify that closing tag details keeps the tag manager page mounted and allows selecting a tag again.

- Modify `src/tags/TagDashboardToolbar.tsx`
  - Wrap the color filter in a visible swatch control while preserving the native select.

- Modify `src/app/styles.css`
  - Add `.home-tags-content`.
  - Adjust tag dashboard height, overflow, toolbar select wrappers, color swatch, and responsive behavior.

---

### Task 1: Render TagManager Inside HomeDashboard

**Files:**
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write the failing HomeDashboard test**

In `src/home/HomeDashboard.test.tsx`, add this import near the existing type imports:

```ts
import type { TagDashboard } from '../tags/tagModels';
```

Add this fixture after `favoriteCardDocuments`:

```ts
const tagDashboard: TagDashboard = {
  overview: { totalTags: 1, activeTags: 1, totalUsage: 4, orphanTags: 0 },
  tags: [
    {
      id: 1,
      name: '深度学习',
      color: '#2563eb',
      usageCount: 4,
      documentCount: 2,
      annotationCount: 2,
      recentUsedAt: '2026-07-07T09:42:00Z',
      createdAt: '2026-07-01T08:00:00Z',
      updatedAt: '2026-07-07T09:42:00Z',
      description: '深度学习 相关文献与批注',
    },
  ],
  details: [
    {
      tag: {
        id: 1,
        name: '深度学习',
        color: '#2563eb',
        usageCount: 4,
        documentCount: 2,
        annotationCount: 2,
        recentUsedAt: '2026-07-07T09:42:00Z',
        createdAt: '2026-07-01T08:00:00Z',
        updatedAt: '2026-07-07T09:42:00Z',
        description: '深度学习 相关文献与批注',
      },
      documents: [],
      folderDistribution: [],
      activities: [],
    },
  ],
  recommendations: [],
};

function createTagPersistence() {
  return {
    loadTagDashboard: vi.fn().mockResolvedValue(tagDashboard),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
  };
}
```

In `createDashboardProps`, add these default props before `...overrides`:

```ts
    tagPersistence: createTagPersistence(),
    onTagsChange: vi.fn(),
    onOpenTagDocument: vi.fn(),
```

Replace the existing test named `falls back to normal home content instead of a blank page for workspace-only sidebar pages` with:

```ts
  it('renders tag management inside the home dashboard frame', async () => {
    renderDashboard({ activeSidebarPage: 'tags' });

    expect(screen.queryByText('快速开始')).not.toBeInTheDocument();
    expect(screen.getByLabelText('SmartReader 顶部栏')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '首页状态栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByLabelText('标签管理工作区')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '标签管理' })).toBeInTheDocument();
    expect(screen.getByText('标签概览')).toBeInTheDocument();
  });
```

Add this style test near the existing style tests:

```ts
  it('keeps tag management as a single framed home content page', () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/\.home-content\.home-tags-content\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
    expect(styles).toMatch(/\.home-content\.home-tags-content\s*{[^}]*padding:\s*0;/s);
    expect(styles).toMatch(/\.home-content\.home-tags-content\s*{[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.tag-dashboard-workspace\s*{[^}]*height:\s*100%;/s);
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: FAIL. The error should show that `tagPersistence`, `onTagsChange`, and `onOpenTagDocument` are not valid `HomeDashboard` props yet, or that the tag page still renders the old home content.

- [ ] **Step 3: Add TagManager as a HomeDashboard content page**

In `src/home/HomeDashboard.tsx`, change the React import to include `SetStateAction`:

```ts
import {
  useCallback,
  useRef,
  useState,
  type ChangeEventHandler,
  type DragEventHandler,
  type SetStateAction,
} from 'react';
```

Add this import with the tag imports:

```ts
import { TagManager } from '../tags/TagManager';
```

Add these props to `HomeDashboardProps`:

```ts
  tagPersistence: Parameters<typeof TagManager>[0]['persistence'];
  onTagsChange(update: SetStateAction<Tag[]>): void;
  onOpenTagDocument(
    documentKey: string,
    documentPath: string | null,
    page: number,
    documentMissing: boolean,
  ): void | Promise<void>;
```

Destructure the new props in `HomeDashboard` after `taskStatus`:

```ts
  tagPersistence,
  onTagsChange,
  onOpenTagDocument,
```

Add this content block after `bookmarksContent`:

```tsx
  const tagsContent = (
    <div className="home-content home-tags-content">
      <TagManager
        persistence={tagPersistence}
        onTagsChange={onTagsChange}
        onOpenDocument={onOpenTagDocument}
      />
    </div>
  );
```

Update `mainContent` so the tags branch renders before `isHomeBlankPageId(activeSidebarPage)`:

```tsx
  const mainContent =
    activeSidebarPage === 'recentFiles' ? (
      recentFilesContent
    ) : activeSidebarPage === 'favoriteFiles' ? (
      favoriteFilesContent
    ) : activeSidebarPage === 'bookmarks' ? (
      bookmarksContent
    ) : activeSidebarPage === 'tags' ? (
      tagsContent
    ) : isHomeBlankPageId(activeSidebarPage) ? (
      <div className="home-content home-blank-content">
        <HomeBlankPage page={activeSidebarPage} />
      </div>
    ) : (
      homeContent
    );
```

- [ ] **Step 4: Add the framed tag page CSS**

In `src/app/styles.css`, add this block near `.home-blank-content` or before `.tag-dashboard-workspace`:

```css
.home-content.home-tags-content {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 0;
  overflow: hidden;
}
```

In `.tag-dashboard-workspace`, add `height: 100%;` and adjust the right column:

```css
.tag-dashboard-workspace {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
  background: #f8fafc;
  color: var(--sr-text);
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/app/styles.css
git commit -m "fix: render tag manager in home frame"
```

---

### Task 2: Route Sidebar Tag Navigation Through HomeDashboard

**Files:**
- Modify: `src/app/ReaderWorkspaceSwitch.test.tsx`
- Modify: `src/app/ReaderWorkspaceSwitch.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write the failing ReaderWorkspaceSwitch test**

In `src/app/ReaderWorkspaceSwitch.test.tsx`, add this fixture after imports:

```ts
const emptyTagDashboard = {
  overview: { totalTags: 0, activeTags: 0, totalUsage: 0, orphanTags: 0 },
  tags: [],
  details: [],
  recommendations: [],
};

function createTagPersistence() {
  return {
    loadTagDashboard: vi.fn().mockResolvedValue(emptyTagDashboard),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
  } as unknown as Parameters<typeof ReaderWorkspaceSwitch>[0]['persistence'];
}
```

Change the default `persistence` prop inside `renderSwitch` to:

```ts
    persistence: createTagPersistence(),
```

Add this test after `renders the home dashboard branch`:

```ts
  it('renders tag management as a home sidebar page', async () => {
    renderSwitch({
      activeWorkspace: 'home',
      activeSidebarPage: 'tags',
      persistence: createTagPersistence(),
    });

    expect(screen.getByLabelText('SmartReader 顶部栏')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '首页状态栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByLabelText('标签管理工作区')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Strengthen the App integration test**

In `src/app/App.test.tsx`, update the existing test named `opens tag manager and creates a tag`.

After the click on `标签管理`, insert these assertions:

```ts
    expect(screen.getByLabelText('SmartReader 顶部栏')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '首页状态栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
```

The start of the test should read:

```ts
    fireEvent.click(screen.getByRole('button', { name: '标签管理' }));
    expect(screen.getByLabelText('SmartReader 顶部栏')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '首页状态栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await screen.findByRole('button', { name: '创建标签' });
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
bunx vitest run src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx
```

Expected: FAIL. The failure should show that clicking `标签管理` still enters the old standalone `tags` workspace, or that `HomeDashboard` is missing the new tag props.

- [ ] **Step 4: Pass tag props into HomeDashboard**

In `src/app/ReaderWorkspaceSwitch.tsx`, add these props to the `HomeDashboard` component call:

```tsx
          tagPersistence={persistence}
          onTagsChange={onTagsChange}
          onOpenTagDocument={(documentKey, documentPath, page, documentMissing) =>
            void openRecordPage(documentKey, documentPath, page, documentMissing)
          }
```

Place them with the other data props, after `taskStatus` is not present and before `onOpenPdf` is fine. The relevant part should include:

```tsx
        <HomeDashboard
          recentDocuments={recentDocuments}
          favoriteDocuments={favoriteDocuments}
          bookmarks={globalSearchBookmarks}
          bookmarkError={globalSearchBookmarkError}
          availableTags={availableTags}
          activeSidebarPage={activeSidebarPage}
          appVersion={appVersion}
          counts={{
            recentFiles: recentDocuments.length,
            favoriteFiles: favoriteDocuments.length,
            restorableSessions: sessionRestoreCount,
          }}
          cacheStats={cacheStats}
          tagPersistence={persistence}
          onTagsChange={onTagsChange}
          onOpenTagDocument={(documentKey, documentPath, page, documentMissing) =>
            void openRecordPage(documentKey, documentPath, page, documentMissing)
          }
          onOpenPdf={openPdf}
```

- [ ] **Step 5: Route onOpenTags through the home sidebar state**

In the same `HomeDashboard` call, replace:

```tsx
          onOpenTags={() => setWorkspaceOverride('tags')}
```

with:

```tsx
          onOpenTags={() => openHomeSidebarPage('tags')}
```

Leave the existing standalone `activeWorkspace === 'tags'` branch untouched in this task. It is no longer the primary path, but leaving it avoids an unrelated cleanup.

- [ ] **Step 6: Run the focused tests and verify they pass**

Run:

```bash
bunx vitest run src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/app/ReaderWorkspaceSwitch.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx
git commit -m "fix: route tags through home sidebar"
```

---

### Task 3: Make Detail Close Clear Only The Current Detail

**Files:**
- Modify: `src/tags/TagManager.test.tsx`
- Modify: `src/tags/TagManager.tsx`
- Modify: `src/app/ReaderWorkspaceSwitch.tsx`

- [ ] **Step 1: Write the failing TagManager detail-close test**

In `src/tags/TagManager.test.tsx`, change `renderTagManager` so it accepts an optional `onCloseDetail` spy:

```ts
function renderTagManager({ onCloseDetail = vi.fn() } = {}) {
  const persistence = {
    loadTagDashboard: vi.fn().mockResolvedValue(dashboard),
    createTag: vi.fn().mockResolvedValue({
      id: 2,
      name: '计算机视觉',
      color: '#2563eb',
      documentCount: 0,
      annotationCount: 0,
      createdAt: '2026-07-07T10:00:00Z',
      updatedAt: '2026-07-07T10:00:00Z',
    }),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
  } as unknown as Parameters<typeof TagManager>[0]['persistence'];

  render(
    <TagManager
      persistence={persistence}
      onTagsChange={vi.fn()}
      onCloseDetail={onCloseDetail}
      onOpenDocument={vi.fn()}
    />,
  );

  return { persistence, onCloseDetail };
}
```

Add this test after `renders the dashboard shell from backend data`:

```ts
  it('closes only the selected detail panel content', async () => {
    const { onCloseDetail } = renderTagManager();

    await screen.findByRole('heading', { name: '标签管理' });
    expect(screen.getByText('深度学习 相关文献与批注')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭标签详情' }));

    expect(onCloseDetail).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: '标签管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建标签' })).toBeInTheDocument();
    expect(screen.getByText('暂无标签详情')).toBeInTheDocument();

    const table = screen.getByRole('region', { name: '全部标签' });
    fireEvent.click(within(table).getByRole('button', { name: '深度学习' }));

    expect(screen.getByText('深度学习 相关文献与批注')).toBeInTheDocument();
  });
```

If the existing tests still destructure `renderTagManager()` as a persistence object, update those lines:

```ts
    const { persistence } = renderTagManager();
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bunx vitest run src/tags/TagManager.test.tsx
```

Expected: FAIL. The failure should show that `onCloseDetail` is not a supported prop yet or that closing details still falls back to the first tag detail.

- [ ] **Step 3: Update TagManager props and selected-detail logic**

In `src/tags/TagManager.tsx`, change the prop type from:

```ts
  onClose(): void;
```

to:

```ts
  onCloseDetail?(): void;
```

Change the function signature from:

```ts
export function TagManager({ persistence, onTagsChange, onClose, onOpenDocument }: TagManagerProps) {
```

to:

```ts
export function TagManager({
  persistence,
  onTagsChange,
  onCloseDetail,
  onOpenDocument,
}: TagManagerProps) {
```

Replace the current `selectedDetail` expression:

```ts
  const selectedDetail =
    dashboard?.details.find((detail) => detail.tag.id === selectedTagId) ??
    dashboard?.details[0] ??
    null;
```

with:

```ts
  const selectedDetail =
    selectedTagId === null
      ? null
      : dashboard?.details.find((detail) => detail.tag.id === selectedTagId) ?? null;
```

Add this callback before `return`:

```ts
  const closeDetail = useCallback(() => {
    setSelectedTagId(null);
    onCloseDetail?.();
  }, [onCloseDetail]);
```

Change the `TagDetailsPanel` prop from:

```tsx
        onClose={onClose}
```

to:

```tsx
        onClose={closeDetail}
```

- [ ] **Step 4: Update the standalone compatibility branch**

In `src/app/ReaderWorkspaceSwitch.tsx`, remove the old `onClose` prop from the standalone `TagManager` branch.

Replace:

```tsx
          onClose={() => setWorkspaceOverride(null)}
```

with:

```tsx
          onCloseDetail={() => undefined}
```

This keeps the old branch type-safe without giving the detail close button page-close behavior.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
bunx vitest run src/tags/TagManager.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/home/HomeDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/tags/TagManager.tsx src/tags/TagManager.test.tsx src/app/ReaderWorkspaceSwitch.tsx
git commit -m "fix: keep tag detail close local"
```

---

### Task 4: Polish The Framed Tag Dashboard UI

**Files:**
- Modify: `src/tags/TagDashboardToolbar.tsx`
- Modify: `src/app/styles.css`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/tags/TagManager.test.tsx`

- [ ] **Step 1: Write CSS and toolbar assertions**

In `src/home/HomeDashboard.test.tsx`, extend the `keeps tag management as a single framed home content page` style test with:

```ts
    expect(styles).toMatch(/\.tag-dashboard-select\s*{[^}]*position:\s*relative;/s);
    expect(styles).toMatch(/\.tag-color-filter-dot\s*{[^}]*border-radius:\s*999px;/s);
    expect(styles).toMatch(/@media \(max-width: 1180px\)\s*{[^@]*\.tag-dashboard-workspace\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
```

Add this toolbar behavior test to `src/tags/TagManager.test.tsx`:

```ts
  it('shows the current color filter with a visible swatch', async () => {
    renderTagManager();

    await screen.findByRole('heading', { name: '标签管理' });
    const colorFilter = screen.getByLabelText('颜色筛选');

    expect(colorFilter.closest('.tag-dashboard-select')).toBeInTheDocument();
    expect(document.querySelector('.tag-color-filter-dot')).toBeInTheDocument();

    fireEvent.change(colorFilter, { target: { value: '#2563eb' } });

    expect(screen.getByRole('option', { name: '蓝色 #2563eb' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx src/tags/TagManager.test.tsx
```

Expected: FAIL. The failure should show missing `.tag-dashboard-select`, `.tag-color-filter-dot`, or the formatted color option label.

- [ ] **Step 3: Add a color swatch wrapper to the toolbar**

In `src/tags/TagDashboardToolbar.tsx`, add this constant after the prop type:

```ts
const colorLabels = new Map<string, string>([
  ['#2563eb', '蓝色'],
  ['#f97316', '橙色'],
  ['#22c55e', '绿色'],
  ['#8b5cf6', '紫色'],
  ['#ec4899', '粉色'],
  ['#14b8a6', '青色'],
  ['#facc15', '黄色'],
  ['#94a3b8', '灰色'],
]);

function formatColorLabel(color: string) {
  return `${colorLabels.get(color.toLowerCase()) ?? '自定义颜色'} ${color}`;
}
```

Replace the color `select` block:

```tsx
      <select aria-label="颜色筛选" value={color} onChange={(event) => onColorChange(event.target.value)}>
        <option value="all">全部颜色</option>
        {colors.map((tagColor) => (
          <option key={tagColor} value={tagColor}>{tagColor}</option>
        ))}
      </select>
```

with:

```tsx
      <label className="tag-dashboard-select tag-color-filter">
        <span
          className="tag-color-filter-dot"
          style={{ backgroundColor: color === 'all' ? '#94a3b8' : color }}
          aria-hidden="true"
        />
        <select
          aria-label="颜色筛选"
          value={color}
          onChange={(event) => onColorChange(event.target.value)}
        >
          <option value="all">全部颜色</option>
          {colors.map((tagColor) => (
            <option key={tagColor} value={tagColor}>
              {formatColorLabel(tagColor)}
            </option>
          ))}
        </select>
      </label>
```

Wrap the sorting select in the same stable control without a swatch:

```tsx
      <label className="tag-dashboard-select">
        <select
          aria-label="排序方式"
          value={sortKey}
          onChange={(event) => onSortChange(event.target.value as TagSortKey)}
        >
          <option value="usage">使用次数</option>
          <option value="documents">关联文献</option>
          <option value="recent">最近使用</option>
        </select>
      </label>
```

- [ ] **Step 4: Update tag dashboard CSS**

In `src/app/styles.css`, replace the toolbar control selector:

```css
.tag-dashboard-search,
.tag-dashboard-toolbar select,
.tag-dashboard-toolbar > button {
```

with:

```css
.tag-dashboard-search,
.tag-dashboard-select,
.tag-dashboard-toolbar > button {
```

Replace the select and button padding block:

```css
.tag-dashboard-toolbar select,
.tag-dashboard-toolbar > button {
  padding: 0 12px;
}
```

with:

```css
.tag-dashboard-select {
  position: relative;
  display: grid;
  align-items: center;
}

.tag-dashboard-select select {
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 0 12px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #334155;
}

.tag-color-filter select {
  padding-left: 32px;
}

.tag-color-filter-dot {
  position: absolute;
  left: 12px;
  z-index: 1;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  box-shadow: 0 0 0 2px #fff;
  pointer-events: none;
}

.tag-dashboard-toolbar > button {
  padding: 0 12px;
}
```

Change the tag dashboard card radius to match the app's restrained card style:

```css
.tag-dashboard-card,
.tag-dashboard-detail-panel {
  border: 1px solid #e2e8f0;
  border-radius: var(--sr-radius);
  background: #ffffff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
}
```

Add responsive tag dashboard rules before the existing `@media (max-width: 960px)` block:

```css
@media (max-width: 1180px) {
  .tag-dashboard-workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .tag-dashboard-detail-panel {
    border-left: 0;
    border-top: 1px solid #e2e8f0;
  }

  .tag-dashboard-top-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .tag-dashboard-toolbar {
    grid-template-columns: minmax(220px, 1fr) minmax(130px, 150px) minmax(130px, 150px);
  }

  .tag-dashboard-toolbar > button {
    min-width: 120px;
  }
}
```

If this duplicates an existing `@media (max-width: 1180px)` block, merge these selectors into the existing block instead of creating a second adjacent block.

- [ ] **Step 5: Run focused tests and verify they pass**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx src/tags/TagManager.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/tags/TagDashboardToolbar.tsx src/tags/TagManager.test.tsx src/home/HomeDashboard.test.tsx src/app/styles.css
git commit -m "style: polish framed tag dashboard"
```

---

### Task 5: Final Verification

**Files:**
- Inspect: `src/home/HomeDashboard.tsx`
- Inspect: `src/app/ReaderWorkspaceSwitch.tsx`
- Inspect: `src/tags/TagManager.tsx`
- Inspect: `src/tags/TagDashboardToolbar.tsx`
- Inspect: `src/app/styles.css`
- Inspect: `src/home/HomeDashboard.test.tsx`
- Inspect: `src/app/ReaderWorkspaceSwitch.test.tsx`
- Inspect: `src/app/App.test.tsx`
- Inspect: `src/tags/TagManager.test.tsx`

- [ ] **Step 1: Run the full target test set**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/tags/TagManager.test.tsx src/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect the diff for scope**

Run:

```bash
git diff -- src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/app/ReaderWorkspaceSwitch.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx src/tags/TagManager.tsx src/tags/TagManager.test.tsx src/tags/TagDashboardToolbar.tsx src/app/styles.css
```

Expected: the diff only changes tag manager home-frame routing, tag detail close behavior, tag toolbar swatch rendering, tests, and tag-dashboard CSS.

- [ ] **Step 4: Check for whitespace errors**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Confirm no database migration was added**

Run:

```bash
git status --short src-tauri/src/migrations
```

Expected: no output.

- [ ] **Step 6: Record final validation**

If every command above passed and no code changed after the Task 4 commit, do not create an empty commit. Report the exact commands and PASS status in the final implementation summary.
