# SmartReader Home Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining SmartReader home prototype gaps by replacing the temporary right rail, adding a fixed bottom status bar, tightening route behavior, and finalizing responsive desktop layout.

**Architecture:** Keep `ReaderApp` as the owner of app state, workspace routing, document opening, and settings destinations. Add small presentational components under `src/home` for the assist rail and status bar, and let `HomeDashboard` remain the composition boundary with local notice fallbacks for unavailable desktop capabilities.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, lucide-react, existing SmartReader CSS in `src/app/styles.css`, existing Tauri/persistence APIs without schema changes.

---

## Scope Source

Implement the approved spec:

- `docs/superpowers/specs/2026-07-03-smartreader-home-completion-design.md`

This plan covers `SR-HOME-DIFF-057` through `SR-HOME-DIFF-113`. Do not add dependencies, database migrations, Tauri commands, browser automation, or computer-control verification.

Existing historical plans remain background only:

- `docs/superpowers/plans/2026-07-01-smartreader-home-topbar.md`
- `docs/superpowers/plans/2026-07-02-smartreader-home-sidebar.md`
- `docs/superpowers/plans/2026-07-03-smartreader-home-main-content.md`

## File Structure

Create:

- `src/home/homeTypes.ts`
  - Shared home-only display types: `HomeTaskStatus` and `HomeAppVersion`.
- `src/home/HomeQuickTipsCard.tsx`
  - Presentational right-rail `快速上手` card with four shortcut rows.
- `src/home/HomeDesktopIntegrationCard.tsx`
  - Presentational `桌面集成` card with Open With, file association, and cache entries.
- `src/home/HomeVersionCard.tsx`
  - Presentational SmartReader version card.
- `src/home/HomeAssistPanel.tsx`
  - Composes the three right-rail cards and forwards callbacks.
- `src/home/HomeAssistPanel.test.tsx`
  - Focused right-rail rendering and callback tests.
- `src/home/HomeStatusBar.tsx`
  - Presentational bottom status bar.
- `src/home/HomeStatusBar.test.tsx`
  - Focused status bar rendering and callback tests.

Modify:

- `src/home/HomeDashboard.tsx`
  - Replace `HomeStatusPanel`, add right-rail callbacks, add bottom status bar, route new notices, wire favorite open.
- `src/home/HomeQuickStart.tsx`
  - Reject non-PDF drops through a callback before calling the reader drop handler.
- `src/home/HomeFavorites.tsx`
  - Add card-body open behavior while preserving favorite toggle.
- `src/home/HomeRecentFiles.tsx`
  - Add responsive `data-label` attributes so narrow CSS can render table rows as cards.
- `src/app/ReaderApp.tsx`
  - Pass app metadata, shortcut settings route, desktop/cache/update callbacks, and favorite open resolver.
- `src/home/HomeDashboard.test.tsx`
  - Add coverage for right rail integration, bottom status bar, notices, favorite open, and responsive CSS contracts.
- `src/home/HomeQuickStart.test.tsx`
  - Add non-PDF drop rejection coverage.
- `src/app/styles.css`
  - Add assist rail, status bar, responsive table-card behavior, and revise the wide-layout breakpoint.
- `src/home/HomeTopBar.test.tsx`
  - Update the shell CSS assertion from two rows to three rows after the status bar is added.

Do not modify:

- `src-tauri/src/migrations/*`
- `src-tauri/src/db.rs`
- `src-tauri/src/lib.rs`
- reader PDF viewer files

## Pre-Flight

- [ ] **Step 1: Confirm worktree state**

Run:

```bash
git status --short
```

Expected: no output. If output appears, inspect it and preserve unrelated user changes.

- [ ] **Step 2: Read the approved completion spec**

Run:

```bash
sed -n '1,820p' docs/superpowers/specs/2026-07-03-smartreader-home-completion-design.md
```

Expected: spec covers `SR-HOME-DIFF-057` through `SR-HOME-DIFF-113`, states that no Tauri/schema work is needed, and defines the right rail, bottom status bar, interaction, responsive, and validation rules.

- [ ] **Step 3: Inspect current home boundaries**

Run:

```bash
sed -n '1,240p' src/home/HomeDashboard.tsx
sed -n '1,220p' src/home/HomeStatusPanel.tsx
sed -n '1,220p' src/home/HomeQuickStart.tsx
sed -n '1,220p' src/home/HomeFavorites.tsx
sed -n '1,220p' src/home/HomeRecentFiles.tsx
sed -n '1,760p' src/home/HomeDashboard.test.tsx
```

Expected:

- `HomeDashboard` still imports and renders `HomeStatusPanel`.
- `HomeStatusPanel` contains `工作台状态` and `阅读流程`.
- `HomeQuickStart` forwards every drop to `onDropPdf`.
- `HomeFavorites` only supports cancel favorite, not open.
- `HomeRecentFiles` is table-only.

---

### Task 1: Right Assist Rail Presentational Components

**Files:**
- Create: `src/home/homeTypes.ts`
- Create: `src/home/HomeQuickTipsCard.tsx`
- Create: `src/home/HomeDesktopIntegrationCard.tsx`
- Create: `src/home/HomeVersionCard.tsx`
- Create: `src/home/HomeAssistPanel.tsx`
- Create: `src/home/HomeAssistPanel.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write the failing right-rail component test**

Create `src/home/HomeAssistPanel.test.tsx`:

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeAssistPanel } from './HomeAssistPanel';

function renderAssistPanel() {
  const props = {
    appVersion: {
      version: '0.1.0',
      build: null,
    },
    onOpenGlobalSearch: vi.fn(),
    onOpenBookmarks: vi.fn(),
    onOpenAnnotations: vi.fn(),
    onOpenShortcutSettings: vi.fn(),
    onOpenCacheManagement: vi.fn(),
    onSetupFileAssociation: vi.fn(),
    onCheckUpdates: vi.fn(),
  };

  renderApp(<HomeAssistPanel {...props} />);
  return props;
}

describe('HomeAssistPanel', () => {
  it('renders quick tips, desktop integration, and version cards', () => {
    renderAssistPanel();

    const assist = screen.getByRole('complementary', { name: '辅助信息' });
    expect(within(assist).getByRole('heading', { name: '快速上手' })).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: '更多技巧' })).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: /搜索文件与内容/ })).toHaveTextContent('⌘K');
    expect(within(assist).getByRole('button', { name: /书签管理/ })).toHaveTextContent('⌘D');
    expect(within(assist).getByRole('button', { name: /批注与高亮/ })).toHaveTextContent('⌘E');
    expect(within(assist).getByRole('button', { name: /快捷键总览/ })).toHaveTextContent('⌘/');

    expect(within(assist).getByRole('heading', { name: '桌面集成' })).toBeInTheDocument();
    expect(within(assist).getByText('支持 "Open With"')).toBeInTheDocument();
    expect(within(assist).getByText('在 Finder 中右键使用 SmartReader 打开 PDF。')).toBeInTheDocument();
    expect(within(assist).getByText('文件关联')).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: '设置关联' })).toBeInTheDocument();
    expect(within(assist).getByText('本地缓存')).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: '管理缓存' })).toBeInTheDocument();

    expect(within(assist).getByText('SmartReader')).toBeInTheDocument();
    expect(within(assist).getByText('版本 0.1.0')).toBeInTheDocument();
    expect(within(assist).getByText('本地优先 · 隐私安全 · 高效阅读')).toBeInTheDocument();
    expect(within(assist).getByRole('button', { name: '检查更新' })).toBeInTheDocument();
  });

  it('formats build metadata when available', () => {
    const props = {
      appVersion: {
        version: '1.7',
        build: '86',
      },
      onOpenGlobalSearch: vi.fn(),
      onOpenBookmarks: vi.fn(),
      onOpenAnnotations: vi.fn(),
      onOpenShortcutSettings: vi.fn(),
      onOpenCacheManagement: vi.fn(),
      onSetupFileAssociation: vi.fn(),
      onCheckUpdates: vi.fn(),
    };

    renderApp(<HomeAssistPanel {...props} />);

    expect(screen.getByText('版本 1.7 (Build 86)')).toBeInTheDocument();
  });

  it('forwards every assist action callback', () => {
    const props = renderAssistPanel();

    fireEvent.click(screen.getByRole('button', { name: '更多技巧' }));
    fireEvent.click(screen.getByRole('button', { name: /搜索文件与内容/ }));
    fireEvent.click(screen.getByRole('button', { name: /书签管理/ }));
    fireEvent.click(screen.getByRole('button', { name: /批注与高亮/ }));
    fireEvent.click(screen.getByRole('button', { name: /快捷键总览/ }));
    fireEvent.click(screen.getByRole('button', { name: '设置关联' }));
    fireEvent.click(screen.getByRole('button', { name: '管理缓存' }));
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    expect(props.onOpenShortcutSettings).toHaveBeenCalledTimes(2);
    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
    expect(props.onOpenBookmarks).toHaveBeenCalledTimes(1);
    expect(props.onOpenAnnotations).toHaveBeenCalledTimes(1);
    expect(props.onSetupFileAssociation).toHaveBeenCalledTimes(1);
    expect(props.onOpenCacheManagement).toHaveBeenCalledTimes(1);
    expect(props.onCheckUpdates).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the right-rail test to verify it fails**

Run:

```bash
bunx vitest run src/home/HomeAssistPanel.test.tsx
```

Expected: FAIL with an import/module error because `HomeAssistPanel` does not exist.

- [ ] **Step 3: Create shared home types**

Create `src/home/homeTypes.ts`:

```ts
type HomeTaskStatus = 'idle' | 'opening' | 'importing' | 'caching' | 'error';

type HomeAppVersion = {
  version: string;
  build?: string | null;
};

export type { HomeAppVersion, HomeTaskStatus };
```

- [ ] **Step 4: Create the quick tips card**

Create `src/home/HomeQuickTipsCard.tsx`:

```tsx
import {
  Bookmark,
  ChevronRight,
  Highlighter,
  Keyboard,
  Search,
  type LucideIcon,
} from 'lucide-react';

type QuickTip = {
  title: string;
  description: string;
  shortcut: string;
  Icon: LucideIcon;
  onClick(): void;
};

type HomeQuickTipsCardProps = {
  onOpenGlobalSearch(): void;
  onOpenBookmarks(): void;
  onOpenAnnotations(): void;
  onOpenShortcutSettings(): void;
};

function QuickTipRow({ tip }: { tip: QuickTip }) {
  return (
    <button
      type="button"
      className="quick-tip-row"
      aria-label={`${tip.title} ${tip.shortcut}`}
      onClick={tip.onClick}
    >
      <span className="quick-tip-icon" aria-hidden="true">
        <tip.Icon size={21} />
      </span>
      <span className="quick-tip-copy">
        <strong>{tip.title}</strong>
        <span>{tip.description}</span>
        <kbd aria-hidden="true">{tip.shortcut}</kbd>
      </span>
    </button>
  );
}

export function HomeQuickTipsCard({
  onOpenGlobalSearch,
  onOpenBookmarks,
  onOpenAnnotations,
  onOpenShortcutSettings,
}: HomeQuickTipsCardProps) {
  const tips: QuickTip[] = [
    {
      title: '搜索文件与内容',
      description: '使用顶部搜索框快速查找文件、书签、批注与全文内容。',
      shortcut: '⌘K',
      Icon: Search,
      onClick: onOpenGlobalSearch,
    },
    {
      title: '书签管理',
      description: '使用书签标记重要页面，支持层级与标签分类。',
      shortcut: '⌘D',
      Icon: Bookmark,
      onClick: onOpenBookmarks,
    },
    {
      title: '批注与高亮',
      description: '在阅读中添加批注、高亮与划线，支持导出。',
      shortcut: '⌘E',
      Icon: Highlighter,
      onClick: onOpenAnnotations,
    },
    {
      title: '快捷键总览',
      description: '查看所有快捷键，提升阅读与管理效率。',
      shortcut: '⌘/',
      Icon: Keyboard,
      onClick: onOpenShortcutSettings,
    },
  ];

  return (
    <section className="home-panel home-assist-card home-quick-tips-card">
      <div className="assist-card-heading">
        <h2>快速上手</h2>
        <button type="button" className="assist-link-button" onClick={onOpenShortcutSettings}>
          <span>更多技巧</span>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="quick-tip-list">
        {tips.map((tip) => (
          <QuickTipRow key={tip.title} tip={tip} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create the desktop integration card**

Create `src/home/HomeDesktopIntegrationCard.tsx`:

```tsx
import { FileCheck2, FolderCog, HardDrive } from 'lucide-react';

type HomeDesktopIntegrationCardProps = {
  onSetupFileAssociation(): void;
  onOpenCacheManagement(): void;
};

export function HomeDesktopIntegrationCard({
  onSetupFileAssociation,
  onOpenCacheManagement,
}: HomeDesktopIntegrationCardProps) {
  return (
    <section className="home-panel home-assist-card home-desktop-integration-card">
      <h2>桌面集成</h2>
      <div className="desktop-integration-list">
        <div className="desktop-integration-item">
          <FileCheck2 size={19} aria-hidden="true" />
          <div>
            <strong>支持 "Open With"</strong>
            <span>在 Finder 中右键使用 SmartReader 打开 PDF。</span>
          </div>
        </div>
        <div className="desktop-integration-item with-action">
          <FolderCog size={19} aria-hidden="true" />
          <div>
            <strong>文件关联</strong>
            <span>将 PDF 文件默认关联到 SmartReader。</span>
            <button type="button" onClick={onSetupFileAssociation}>
              设置关联
            </button>
          </div>
        </div>
        <div className="desktop-integration-item with-action">
          <HardDrive size={19} aria-hidden="true" />
          <div>
            <strong>本地缓存</strong>
            <span>智能缓存常用文件，加速打开与搜索体验。</span>
            <button type="button" onClick={onOpenCacheManagement}>
              管理缓存
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Create the version card**

Create `src/home/HomeVersionCard.tsx`:

```tsx
import { BookOpenCheck } from 'lucide-react';
import type { HomeAppVersion } from './homeTypes';

type HomeVersionCardProps = {
  appVersion: HomeAppVersion;
  onCheckUpdates(): void;
};

function formatVersion(appVersion: HomeAppVersion) {
  if (appVersion.build) {
    return `版本 ${appVersion.version} (Build ${appVersion.build})`;
  }

  return `版本 ${appVersion.version}`;
}

export function HomeVersionCard({ appVersion, onCheckUpdates }: HomeVersionCardProps) {
  return (
    <section className="home-panel home-assist-card home-version-card">
      <div className="home-version-heading">
        <span className="home-version-icon" aria-hidden="true">
          <BookOpenCheck size={21} />
        </span>
        <div>
          <strong>SmartReader</strong>
          <span>{formatVersion(appVersion)}</span>
        </div>
      </div>
      <p>本地优先 · 隐私安全 · 高效阅读</p>
      <button type="button" className="text-link-button" onClick={onCheckUpdates}>
        检查更新
      </button>
    </section>
  );
}
```

- [ ] **Step 7: Create the assist panel composition**

Create `src/home/HomeAssistPanel.tsx`:

```tsx
import { HomeDesktopIntegrationCard } from './HomeDesktopIntegrationCard';
import { HomeQuickTipsCard } from './HomeQuickTipsCard';
import { HomeVersionCard } from './HomeVersionCard';
import type { HomeAppVersion } from './homeTypes';

type HomeAssistPanelProps = {
  appVersion: HomeAppVersion;
  onOpenGlobalSearch(): void;
  onOpenBookmarks(): void;
  onOpenAnnotations(): void;
  onOpenShortcutSettings(): void;
  onOpenCacheManagement(): void;
  onSetupFileAssociation(): void;
  onCheckUpdates(): void;
};

export function HomeAssistPanel({
  appVersion,
  onOpenGlobalSearch,
  onOpenBookmarks,
  onOpenAnnotations,
  onOpenShortcutSettings,
  onOpenCacheManagement,
  onSetupFileAssociation,
  onCheckUpdates,
}: HomeAssistPanelProps) {
  return (
    <aside className="home-assist" aria-label="辅助信息">
      <HomeQuickTipsCard
        onOpenGlobalSearch={onOpenGlobalSearch}
        onOpenBookmarks={onOpenBookmarks}
        onOpenAnnotations={onOpenAnnotations}
        onOpenShortcutSettings={onOpenShortcutSettings}
      />
      <HomeDesktopIntegrationCard
        onSetupFileAssociation={onSetupFileAssociation}
        onOpenCacheManagement={onOpenCacheManagement}
      />
      <HomeVersionCard appVersion={appVersion} onCheckUpdates={onCheckUpdates} />
    </aside>
  );
}

export type { HomeAssistPanelProps };
```

- [ ] **Step 8: Add minimal assist styles**

Append these styles near the current `.home-panel` and right-rail styles in `src/app/styles.css`:

```css
.home-assist {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 16px;
}

.home-assist-card {
  display: grid;
  gap: 14px;
}

.assist-card-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.assist-card-heading h2,
.home-assist-card h2 {
  margin: 0;
  font-size: 16px;
  line-height: 1.25;
}

.assist-link-button {
  min-height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--sr-text-muted);
  font-size: 12px;
}

.assist-link-button:hover:not(:disabled) {
  border-color: transparent;
  background: transparent;
  color: var(--sr-primary);
}

.quick-tip-list,
.desktop-integration-list {
  min-width: 0;
  display: grid;
  gap: 14px;
}

.quick-tip-row {
  min-width: 0;
  min-height: 74px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  justify-content: stretch;
  gap: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
}

.quick-tip-row:hover:not(:disabled) {
  border-color: transparent;
  background: transparent;
}

.quick-tip-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #eff6ff;
  color: var(--sr-primary);
}

.quick-tip-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.quick-tip-copy strong,
.desktop-integration-item strong {
  color: var(--sr-text);
  font-size: 14px;
  line-height: 1.25;
}

.quick-tip-copy span,
.desktop-integration-item span,
.home-version-card p,
.home-version-heading span {
  color: var(--sr-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.quick-tip-copy kbd {
  width: fit-content;
  min-width: 34px;
  padding: 2px 7px;
  border: 1px solid var(--sr-border);
  border-radius: 5px;
  background: var(--sr-surface-muted);
  color: var(--sr-text-muted);
  font-size: 12px;
}

.desktop-integration-item {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 11px;
}

.desktop-integration-item > svg {
  margin-top: 2px;
  color: var(--sr-text);
}

.desktop-integration-item div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.desktop-integration-item button {
  width: 100%;
  min-height: 32px;
  margin-top: 6px;
}

.home-version-card {
  gap: 10px;
}

.home-version-card p {
  margin: 0;
}

.home-version-card .text-link-button {
  justify-self: start;
}

.home-version-heading {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.home-version-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid var(--sr-border);
  border-radius: 8px;
  color: var(--sr-text);
}

.home-version-heading div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.home-version-heading strong,
.home-version-heading span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 9: Run the right-rail test to verify it passes**

Run:

```bash
bunx vitest run src/home/HomeAssistPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit Task 1**

Run:

```bash
git add src/home/homeTypes.ts src/home/HomeQuickTipsCard.tsx src/home/HomeDesktopIntegrationCard.tsx src/home/HomeVersionCard.tsx src/home/HomeAssistPanel.tsx src/home/HomeAssistPanel.test.tsx src/app/styles.css
git commit -m "feat: add home assist panel"
```

Expected: commit succeeds.

---

### Task 2: Wire Assist Rail Into Home Dashboard

**Files:**
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`

- [ ] **Step 1: Add failing dashboard tests for assist rail integration and fallback notices**

Append these tests inside `describe('HomeDashboard', () => { ... })` in `src/home/HomeDashboard.test.tsx`:

```tsx
it('renders the home assist rail and removes the temporary status cards', () => {
  renderDashboard({ activeSidebarPage: 'home' });

  const assist = screen.getByRole('complementary', { name: '辅助信息' });

  expect(within(assist).getByRole('heading', { name: '快速上手' })).toBeInTheDocument();
  expect(within(assist).getByRole('heading', { name: '桌面集成' })).toBeInTheDocument();
  expect(within(assist).getByText('版本 0.1.0')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '工作台状态' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '阅读流程' })).not.toBeInTheDocument();
});

it('does not render the home assist rail for blank sidebar pages', () => {
  renderDashboard({ activeSidebarPage: 'recentFiles' });

  expect(screen.queryByRole('complementary', { name: '辅助信息' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '最近文件' })).toBeInTheDocument();
});

it('forwards assist rail navigation callbacks', () => {
  const onOpenGlobalSearch = vi.fn();
  const onOpenBookmarks = vi.fn();
  const onOpenAnnotations = vi.fn();
  const onOpenCacheManagement = vi.fn();
  const onOpenSettings = vi.fn();
  renderDashboard({
    onOpenGlobalSearch,
    onOpenBookmarks,
    onOpenAnnotations,
    onOpenCacheManagement,
    onOpenSettings,
  });

  fireEvent.click(screen.getByRole('button', { name: /搜索文件与内容/ }));
  fireEvent.click(screen.getByRole('button', { name: /书签管理/ }));
  fireEvent.click(screen.getByRole('button', { name: /批注与高亮/ }));
  fireEvent.click(screen.getByRole('button', { name: /快捷键总览/ }));
  fireEvent.click(screen.getByRole('button', { name: '更多技巧' }));
  fireEvent.click(screen.getByRole('button', { name: '管理缓存' }));

  expect(onOpenGlobalSearch).toHaveBeenCalledTimes(1);
  expect(onOpenBookmarks).toHaveBeenCalledTimes(1);
  expect(onOpenAnnotations).toHaveBeenCalledTimes(1);
  expect(onOpenSettings).toHaveBeenCalledTimes(2);
  expect(onOpenCacheManagement).toHaveBeenCalledTimes(1);
});

it('shows fallback notices for unavailable desktop association and update checks', () => {
  renderDashboard();

  fireEvent.click(screen.getByRole('button', { name: '设置关联' }));
  expect(screen.getByRole('dialog', { name: '文件关联不可用' })).toBeInTheDocument();
  expect(
    screen.getByText('当前环境不支持自动设置文件关联，请在系统设置中关联 PDF。'),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
  expect(screen.getByRole('dialog', { name: '检查更新能力待接入' })).toBeInTheDocument();
  expect(screen.getByText('当前版本暂未接入自动检查更新。')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run dashboard tests to verify failure**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: FAIL because the assist rail is not wired into `HomeDashboard`.

- [ ] **Step 3: Modify `HomeDashboard` props and imports**

In `src/home/HomeDashboard.tsx`, replace the `HomeStatusPanel` import with:

```tsx
import { HomeAssistPanel } from './HomeAssistPanel';
import type { HomeAppVersion, HomeTaskStatus } from './homeTypes';
```

Add these optional props to `HomeDashboardProps`:

```tsx
  appVersion?: HomeAppVersion;
  taskStatus?: HomeTaskStatus;
  onOpenShortcutSettings?(): void;
  onSetupFileAssociation?(): void | Promise<void>;
  onCheckUpdates?(): void | Promise<void>;
```

Add these defaults in the destructured parameter list:

```tsx
  appVersion = { version: '0.1.0', build: null },
  taskStatus = 'idle',
  onOpenShortcutSettings = onOpenSettings,
  onSetupFileAssociation,
  onCheckUpdates,
```

- [ ] **Step 4: Add assist fallback handlers in `HomeDashboard`**

Add these callbacks inside `HomeDashboard` after `showNotice`:

```tsx
  const handleSetupFileAssociation = useCallback(() => {
    if (onSetupFileAssociation) {
      void onSetupFileAssociation();
      return;
    }

    showNotice(
      '文件关联不可用',
      '当前环境不支持自动设置文件关联，请在系统设置中关联 PDF。',
    );
  }, [onSetupFileAssociation, showNotice]);

  const handleCheckUpdates = useCallback(() => {
    if (onCheckUpdates) {
      void onCheckUpdates();
      return;
    }

    showNotice('检查更新能力待接入', '当前版本暂未接入自动检查更新。');
  }, [onCheckUpdates, showNotice]);
```

- [ ] **Step 5: Replace the right rail in `homeContent`**

In `src/home/HomeDashboard.tsx`, replace:

```tsx
      <HomeStatusPanel />
```

with:

```tsx
      <HomeAssistPanel
        appVersion={appVersion}
        onOpenGlobalSearch={onOpenGlobalSearch}
        onOpenBookmarks={onOpenBookmarks}
        onOpenAnnotations={onOpenAnnotations}
        onOpenShortcutSettings={onOpenShortcutSettings}
        onOpenCacheManagement={onOpenCacheManagement}
        onSetupFileAssociation={handleSetupFileAssociation}
        onCheckUpdates={handleCheckUpdates}
      />
```

Keep `mainContent` as-is so blank pages continue to use `.home-blank-content` and do not render the assist rail.

- [ ] **Step 6: Pass shortcut settings and app metadata from `ReaderApp`**

In `src/app/ReaderApp.tsx`, add this constant near `defaultCacheStats`:

```tsx
const appVersion = {
  version: '0.1.0',
  build: null,
};
```

In the `HomeDashboard` JSX props, add:

```tsx
          appVersion={appVersion}
          onOpenShortcutSettings={() => openSettingsWorkspace('shortcuts')}
```

Do not add native update or file association commands.

- [ ] **Step 7: Run focused tests**

Run:

```bash
bunx vitest run src/home/HomeAssistPanel.test.tsx src/home/HomeDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add src/home/HomeDashboard.tsx src/app/ReaderApp.tsx src/home/HomeDashboard.test.tsx
git commit -m "feat: wire home assist rail"
```

Expected: commit succeeds.

---

### Task 3: Bottom Status Bar And Shell Rows

**Files:**
- Create: `src/home/HomeStatusBar.tsx`
- Create: `src/home/HomeStatusBar.test.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/home/HomeTopBar.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write the failing status bar component test**

Create `src/home/HomeStatusBar.test.tsx`:

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeStatusBar } from './HomeStatusBar';

describe('HomeStatusBar', () => {
  it('renders local mode, view scale, and idle task status', () => {
    renderApp(<HomeStatusBar />);

    expect(screen.getByRole('contentinfo', { name: '首页状态栏' })).toBeInTheDocument();
    expect(screen.getByText('本地模式')).toBeInTheDocument();
    expect(screen.getByText('所有数据保存在本地')).toBeInTheDocument();
    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(screen.getByText('无任务运行中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开首页视图控制' })).toBeInTheDocument();
  });

  it('renders supplied task state and forwards view-control action', () => {
    const onOpenViewControls = vi.fn();
    renderApp(
      <HomeStatusBar viewScale="100%" taskStatus="importing" onOpenViewControls={onOpenViewControls} />,
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('正在导入文献')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开首页视图控制' }));

    expect(onOpenViewControls).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Add failing dashboard/status CSS expectations**

In `src/home/HomeDashboard.test.tsx`, add this test:

```tsx
it('renders the fixed home status bar on the home page', () => {
  renderDashboard({ activeSidebarPage: 'home' });

  const statusBar = screen.getByRole('contentinfo', { name: '首页状态栏' });

  expect(within(statusBar).getByText('本地模式')).toBeInTheDocument();
  expect(within(statusBar).getByText('所有数据保存在本地')).toBeInTheDocument();
  expect(within(statusBar).getByText('125%')).toBeInTheDocument();
  expect(within(statusBar).getByText('无任务运行中')).toBeInTheDocument();
});
```

In `src/home/HomeTopBar.test.tsx`, update the first CSS assertion from:

```tsx
expect(styles).toMatch(/\.home-dashboard-shell\s*{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/s);
```

to:

```tsx
expect(styles).toMatch(/\.home-dashboard-shell\s*{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
```

- [ ] **Step 3: Run failing status/dashboard tests**

Run:

```bash
bunx vitest run src/home/HomeStatusBar.test.tsx src/home/HomeDashboard.test.tsx src/home/HomeTopBar.test.tsx
```

Expected: FAIL because `HomeStatusBar` does not exist and the shell still has two rows.

- [ ] **Step 4: Create `HomeStatusBar`**

Create `src/home/HomeStatusBar.tsx`:

```tsx
import { CheckCircle2, ChevronDown, Info, ZoomIn } from 'lucide-react';
import type { HomeTaskStatus } from './homeTypes';

type HomeStatusBarProps = {
  viewScale?: string;
  taskStatus?: HomeTaskStatus;
  onOpenViewControls?(): void;
};

const taskStatusLabels: Record<HomeTaskStatus, string> = {
  idle: '无任务运行中',
  opening: '正在打开文件',
  importing: '正在导入文献',
  caching: '正在更新缓存',
  error: '任务异常',
};

export function HomeStatusBar({
  viewScale = '125%',
  taskStatus = 'idle',
  onOpenViewControls,
}: HomeStatusBarProps) {
  return (
    <footer className="home-status-bar" aria-label="首页状态栏">
      <div className="home-status-left">
        <span className="local-mode-dot" aria-hidden="true" />
        <span>本地模式</span>
        <span aria-hidden="true">·</span>
        <span>所有数据保存在本地</span>
        <Info size={14} aria-hidden="true" />
      </div>
      <div className="home-status-right">
        <button type="button" className="home-view-scale" onClick={onOpenViewControls}>
          <span>{viewScale}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="home-status-icon-button"
          aria-label="打开首页视图控制"
          onClick={onOpenViewControls}
        >
          <ZoomIn size={15} />
        </button>
        <span className={taskStatus === 'error' ? 'home-task-status error' : 'home-task-status'}>
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>{taskStatusLabels[taskStatus]}</span>
        </span>
      </div>
    </footer>
  );
}

export type { HomeStatusBarProps };
```

- [ ] **Step 5: Wire `HomeStatusBar` into `HomeDashboard`**

In `src/home/HomeDashboard.tsx`, add:

```tsx
import { HomeStatusBar } from './HomeStatusBar';
```

Render the status bar after the `</section>` for `.home-dashboard` and before the notice:

```tsx
      <HomeStatusBar taskStatus={taskStatus} />
      {notice ? (
```

- [ ] **Step 6: Update shell and status bar CSS**

In `src/app/styles.css`, change `.home-dashboard-shell` to:

```css
.home-dashboard-shell {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--sr-bg);
}
```

Append these styles near the home shell styles:

```css
.home-status-bar {
  min-width: 0;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 16px;
  border-top: 1px solid var(--sr-border);
  background: rgba(255, 255, 255, 0.96);
  color: var(--sr-text-muted);
  font-size: 12px;
}

.home-status-left,
.home-status-right,
.home-task-status,
.home-view-scale {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.home-status-left {
  flex: 1 1 auto;
  overflow: hidden;
}

.home-status-left span,
.home-task-status span {
  white-space: nowrap;
}

.local-mode-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #22c55e;
}

.home-status-right {
  flex: 0 0 auto;
}

.home-view-scale,
.home-status-icon-button {
  min-height: 28px;
  border-color: transparent;
  background: transparent;
  color: var(--sr-text-muted);
}

.home-view-scale {
  padding: 0 4px;
}

.home-status-icon-button {
  width: 28px;
  min-width: 28px;
  padding: 0;
}

.home-view-scale:hover:not(:disabled),
.home-status-icon-button:hover:not(:disabled) {
  border-color: rgba(37, 99, 235, 0.16);
  background: #f8fbff;
  color: var(--sr-primary);
}

.home-task-status svg {
  color: var(--sr-text-muted);
}

.home-task-status.error,
.home-task-status.error svg {
  color: var(--sr-danger);
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
bunx vitest run src/home/HomeStatusBar.test.tsx src/home/HomeDashboard.test.tsx src/home/HomeTopBar.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/home/HomeStatusBar.tsx src/home/HomeStatusBar.test.tsx src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/home/HomeTopBar.test.tsx src/app/styles.css
git commit -m "feat: add home status bar"
```

Expected: commit succeeds.

---

### Task 4: Home Interaction Completion

**Files:**
- Modify: `src/home/HomeQuickStart.tsx`
- Modify: `src/home/HomeQuickStart.test.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/home/HomeFavorites.tsx`
- Modify: `src/home/HomeRecentFiles.tsx`
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing quick-start rejection test**

In `src/home/HomeQuickStart.test.tsx`, add:

```tsx
it('rejects non-PDF drops without forwarding to the reader drop handler', () => {
  const onDropPdf = vi.fn();
  const onRejectDrop = vi.fn();
  renderApp(
    <HomeQuickStart
      onOpenPdf={vi.fn()}
      onDropPdf={onDropPdf}
      onRejectDrop={onRejectDrop}
      onOpenFolder={vi.fn()}
    />,
  );

  fireEvent.drop(screen.getByRole('button', { name: /拖拽到这里/ }), {
    dataTransfer: {
      files: [new File(['text'], 'notes.txt', { type: 'text/plain' })],
    },
  });

  expect(onDropPdf).not.toHaveBeenCalled();
  expect(onRejectDrop).toHaveBeenCalledWith('仅支持 PDF 文件');
});
```

- [ ] **Step 2: Add failing dashboard and favorites interaction tests**

In `src/home/HomeDashboard.test.tsx`, add:

```tsx
it('shows a notice when a non-PDF file is dropped on the quick-start drop card', () => {
  const onDropPdf = vi.fn();
  renderDashboard({ onDropPdf });

  fireEvent.drop(screen.getByRole('button', { name: /拖拽到这里/ }), {
    dataTransfer: {
      files: [new File(['text'], 'notes.txt', { type: 'text/plain' })],
    },
  });

  expect(onDropPdf).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: '无法打开文件' })).toBeInTheDocument();
  expect(screen.getByText('仅支持 PDF 文件')).toBeInTheDocument();
});

it('opens a favorite file from its card body', () => {
  const onOpenFavoriteDocument = vi.fn();
  renderDashboard({ favoriteDocuments: favoriteCardDocuments, onOpenFavoriteDocument });

  fireEvent.click(
    within(screen.getByRole('region', { name: '收藏文件' })).getByRole('button', {
      name: '打开收藏文件 Design Notes.pdf',
    }),
  );

  expect(onOpenFavoriteDocument).toHaveBeenCalledTimes(1);
  expect(onOpenFavoriteDocument).toHaveBeenCalledWith(favoriteCardDocuments[0]);
});

it('shows a favorite-open fallback notice when no favorite open callback is provided', () => {
  renderDashboard({ favoriteDocuments: favoriteCardDocuments });

  fireEvent.click(
    within(screen.getByRole('region', { name: '收藏文件' })).getByRole('button', {
      name: '打开收藏文件 Design Notes.pdf',
    }),
  );

  expect(screen.getByRole('dialog', { name: '无法打开收藏文件' })).toBeInTheDocument();
  expect(screen.getByText('该收藏文件暂无可打开的本地路径。')).toBeInTheDocument();
});

it('adds responsive labels to recent file table cells', () => {
  renderDashboard({ recentDocuments: recentTableDocuments });

  const recentFilesRegion = screen.getByRole('region', { name: '最近文件' });
  const firstNameCell = within(recentFilesRegion).getByText('Design Notes.pdf').closest('td');
  const firstPathCell = within(recentFilesRegion).getByText('/Users/mario/Documents/').closest('td');

  expect(firstNameCell).toHaveAttribute('data-label', '文件名');
  expect(firstPathCell).toHaveAttribute('data-label', '路径');
});
```

- [ ] **Step 3: Run failing interaction tests**

Run:

```bash
bunx vitest run src/home/HomeQuickStart.test.tsx src/home/HomeDashboard.test.tsx
```

Expected: FAIL because `onRejectDrop`, `onOpenFavoriteDocument`, and recent file `data-label` cells are not implemented.

- [ ] **Step 4: Update `HomeQuickStart` drop rejection**

In `src/home/HomeQuickStart.tsx`, add the helper import:

```tsx
import { getPdfFilesFromDrop } from '../platform/dropZone';
```

Change the props type to:

```tsx
type HomeQuickStartProps = {
  onOpenPdf(): void;
  onDropPdf: DragEventHandler<HTMLElement>;
  onRejectDrop?(message: string): void;
  onOpenFolder(): void;
};
```

Change the function signature:

```tsx
export function HomeQuickStart({
  onOpenPdf,
  onDropPdf,
  onRejectDrop,
  onOpenFolder,
}: HomeQuickStartProps) {
```

Replace `handleDrop` with:

```tsx
  const handleDrop: DragEventHandler<HTMLButtonElement> = (event) => {
    setDragActive(false);
    event.preventDefault();
    event.stopPropagation();

    if (getPdfFilesFromDrop(event.dataTransfer.files).length === 0) {
      onRejectDrop?.('仅支持 PDF 文件');
      return;
    }

    onDropPdf(event);
  };
```

- [ ] **Step 5: Update dashboard prop types and handlers**

In `src/home/HomeDashboard.tsx`, add the import:

```tsx
import type { FavoriteDocument } from '../favorites/favoriteModels';
```

The file already imports `FavoriteDocument`; keep one import only.

Add this prop to `HomeDashboardProps`:

```tsx
  onOpenFavoriteDocument?(document: FavoriteDocument): void | Promise<void>;
```

Add it to the destructured props:

```tsx
  onOpenFavoriteDocument,
```

Add this handler after `showNotice`:

```tsx
  const handleOpenFavoriteDocument = useCallback(
    (document: FavoriteDocument) => {
      if (!onOpenFavoriteDocument) {
        showNotice('无法打开收藏文件', '该收藏文件暂无可打开的本地路径。');
        return;
      }

      void onOpenFavoriteDocument(document);
    },
    [onOpenFavoriteDocument, showNotice],
  );
```

In the `HomeQuickStart` JSX, add:

```tsx
          onRejectDrop={(message) => showNotice('无法打开文件', message)}
```

In the `HomeFavorites` JSX, add:

```tsx
          onOpenDocument={handleOpenFavoriteDocument}
```

- [ ] **Step 6: Update favorite cards to open from the body**

In `src/home/HomeFavorites.tsx`, change the props type to:

```tsx
type HomeFavoritesProps = {
  documents: FavoriteDocument[];
  onOpenAll(): void;
  onOpenDocument(document: FavoriteDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
};
```

Change the function signature:

```tsx
export function HomeFavorites({
  documents,
  onOpenAll,
  onOpenDocument,
  onToggleFavorite,
}: HomeFavoritesProps) {
```

Replace the `.favorite-card-main` block with:

```tsx
              <div className="favorite-card-main">
                <button
                  type="button"
                  className="favorite-card-open"
                  aria-label={`打开收藏文件 ${document.displayName}`}
                  onClick={() => void onOpenDocument(document)}
                >
                  <span className="pdf-file-icon" aria-hidden="true">
                    <FileText size={18} />
                  </span>
                  <span className="favorite-card-copy">
                    <strong title={document.displayName}>{document.displayName}</strong>
                    <span title={document.path ?? '本地浏览器文件'}>
                      {getDirectoryPath(document.path)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="favorite-toggle active"
                  aria-label={`取消收藏 ${document.displayName}`}
                  aria-pressed="true"
                  onClick={() => void onToggleFavorite(document.documentKey, false)}
                >
                  <Star size={15} fill="currentColor" />
                </button>
              </div>
```

- [ ] **Step 7: Add recent table responsive labels**

In `src/home/HomeRecentFiles.tsx`, add `data-label` attributes to each table cell in the row map:

```tsx
                    <td data-label="文件名">
```

```tsx
                    <td data-label="路径" className="path-cell" title={document.path ?? '本地浏览器文件'}>
```

```tsx
                    <td data-label="上次打开">{formatDateTime(document.modifiedAt)}</td>
```

```tsx
                    <td data-label="阅读进度">
```

```tsx
                    <td data-label="操作" className="recent-menu-cell">
```

- [ ] **Step 8: Resolve favorite open in `ReaderApp`**

In `src/app/ReaderApp.tsx`, add this callback near other home/open callbacks:

```tsx
  const openFavoriteDocument = useCallback(
    async (document: FavoriteDocument) => {
      const recentDocument =
        recentDocuments.find(
          (candidate) =>
            candidate.documentKey === document.documentKey ||
            (Boolean(document.path) && candidate.path === document.path),
        ) ?? null;

      if (!recentDocument) {
        return;
      }

      const opened = await reopenRecentDocument(recentDocument);

      if (opened) {
        setWorkspaceOverride(null);
      }
    },
    [recentDocuments, reopenRecentDocument],
  );
```

In the `HomeDashboard` JSX props, add:

```tsx
          onOpenFavoriteDocument={(document) => void openFavoriteDocument(document)}
```

- [ ] **Step 9: Add favorite open styles**

Append near existing favorite styles in `src/app/styles.css`:

```css
.favorite-card-open {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  justify-content: stretch;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
}

.favorite-card-open:hover:not(:disabled) {
  border-color: transparent;
  background: transparent;
}
```

- [ ] **Step 10: Run focused interaction tests**

Run:

```bash
bunx vitest run src/home/HomeQuickStart.test.tsx src/home/HomeDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit Task 4**

Run:

```bash
git add src/home/HomeQuickStart.tsx src/home/HomeQuickStart.test.tsx src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/home/HomeFavorites.tsx src/home/HomeRecentFiles.tsx src/app/ReaderApp.tsx src/app/styles.css
git commit -m "feat: complete home entry interactions"
```

Expected: commit succeeds.

---

### Task 5: Responsive Layout And Visual Completion

**Files:**
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing CSS contract tests for final responsive layout**

At the top of `src/home/HomeDashboard.test.tsx`, add Node imports beside existing imports:

```tsx
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
```

Add this helper near `renderDashboard`:

```tsx
function readAppStyles() {
  return readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
}
```

Add this test inside `describe('HomeDashboard', () => { ... })`:

```tsx
it('keeps the wide home layout three-area and degrades recent files on narrow screens', () => {
  const styles = readAppStyles();

  expect(styles).toMatch(/\.home-content\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 320px;/s);
  expect(styles).toMatch(/\.home-assist\s*{[^}]*display:\s*grid;/s);
  expect(styles).toMatch(/@media \(max-width: 1180px\)\s*{[^@]*\.home-content\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  expect(styles).toMatch(/@media \(max-width: 720px\)\s*{[^@]*\.recent-files-table\s*{[^}]*min-width:\s*0;/s);
  expect(styles).toMatch(/@media \(max-width: 720px\)\s*{[^@]*\.recent-files-table td::before\s*{[^}]*content:\s*attr\(data-label\);/s);
  expect(styles).not.toMatch(/@media \(max-width: 1280px\)\s*{[^@]*\.home-content\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
});
```

- [ ] **Step 2: Run the CSS contract test to verify failure**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx -t "keeps the wide home layout"
```

Expected: FAIL because current CSS collapses `.home-content` at `1280px` and has no narrow table-card styles.

- [ ] **Step 3: Update wide and medium layout CSS**

In `src/app/styles.css`, ensure `.home-content` is:

```css
.home-content {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  padding: 16px;
  overflow: auto;
}
```

Remove the existing `@media (max-width: 1280px)` block that collapses `.home-content` to one column. Replace it with:

```css
@media (max-width: 1180px) {
  .home-content {
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
  }

  .home-assist {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .home-version-card {
    grid-column: 1 / -1;
  }

  .quick-start-card-grid,
  .favorite-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .quick-start-card-grid {
    gap: 16px;
  }
}
```

Delete any `.home-status` responsive rules from that old block because the new right rail class is `.home-assist`.

- [ ] **Step 4: Add narrow recent table-card CSS**

Inside the existing `@media (max-width: 720px)` block in `src/app/styles.css`, add:

```css
  .recent-files-table {
    min-width: 0;
  }

  .recent-files-table thead {
    display: none;
  }

  .recent-files-table,
  .recent-files-table tbody,
  .recent-files-table tr,
  .recent-files-table td {
    display: block;
    width: 100%;
  }

  .recent-files-table tbody {
    display: grid;
    gap: 10px;
    padding: 10px;
  }

  .recent-files-table tr {
    border: 1px solid var(--sr-border);
    border-radius: var(--sr-radius);
    background: var(--sr-surface);
  }

  .recent-files-table td {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 10px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--sr-border);
    text-align: left;
  }

  .recent-files-table td:last-child {
    border-bottom: 0;
  }

  .recent-files-table td::before {
    content: attr(data-label);
    color: var(--sr-text-muted);
    font-size: 12px;
    font-weight: 700;
  }

  .recent-menu-cell {
    justify-items: stretch;
  }

  .recent-menu-cell .icon-button {
    justify-self: start;
  }
```

- [ ] **Step 5: Add compact status bar behavior for small screens**

Inside the existing `@media (max-width: 720px)` block in `src/app/styles.css`, add:

```css
  .home-status-bar {
    min-height: 36px;
    gap: 8px;
    padding: 0 10px;
  }

  .home-status-left {
    gap: 6px;
  }

  .home-status-left span:nth-of-type(3),
  .home-status-left svg {
    display: none;
  }

  .home-status-right {
    gap: 4px;
  }
```

- [ ] **Step 6: Run focused CSS contract test**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx -t "keeps the wide home layout"
```

Expected: PASS.

- [ ] **Step 7: Run all home-focused tests**

Run:

```bash
bunx vitest run src/home/HomeAssistPanel.test.tsx src/home/HomeStatusBar.test.tsx src/home/HomeDashboard.test.tsx src/home/HomeQuickStart.test.tsx src/home/HomeTopBar.test.tsx src/home/HomeSidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/home/HomeDashboard.test.tsx src/app/styles.css
git commit -m "style: finalize home responsive layout"
```

Expected: commit succeeds.

---

### Task 6: Full Verification And Completion Audit

**Files:**
- Modify: no source files expected after Task 5.

- [ ] **Step 1: Run TypeScript typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 4: Confirm no native files or migrations changed**

Run:

```bash
git diff --name-only HEAD~5..HEAD
```

Expected: output includes only frontend source, tests, styles, and no `src-tauri/src/migrations/*`. If the exact number of task commits differs because a task was split during execution, compare against the branch base instead:

```bash
git diff --name-only main...HEAD
```

Expected: no migration files.

- [ ] **Step 5: Audit spec coverage**

Run:

```bash
rg -n "SR-HOME-DIFF-057|SR-HOME-DIFF-064|SR-HOME-DIFF-070|SR-HOME-DIFF-077|SR-HOME-DIFF-082|SR-HOME-DIFF-088|SR-HOME-DIFF-095|SR-HOME-DIFF-103|SR-HOME-DIFF-110" docs/superpowers/specs/2026-07-03-smartreader-home-completion-design.md
```

Expected: each requirement group appears in the spec. Use the tests and commits from Tasks 1-5 to map implementation coverage:

- 057-076: `HomeAssistPanel` tests and dashboard integration tests.
- 077-081: `HomeStatusBar` tests and dashboard status bar test.
- 082-087: layout CSS contract test.
- 088-094: style changes, empty favorite state regression, recent file data labels.
- 095-102: existing count/cache tests plus version card tests.
- 103-109: dashboard open/favorite/assist callback tests.
- 110-113: responsive CSS contract test.

- [ ] **Step 6: Capture final status**

Run:

```bash
git status --short
```

Expected: no output.

If generated output appears, inspect it. Do not delete unrelated user files.

## Self-Review Checklist

- [ ] Every requirement from `SR-HOME-DIFF-057` through `SR-HOME-DIFF-113` is covered by at least one task.
- [ ] No task modifies `src-tauri/src/migrations/*`.
- [ ] No task adds a dependency.
- [ ] No task starts the app automatically.
- [ ] Every task has a focused failing test before implementation.
- [ ] Every task has a focused verification command.
- [ ] Every implementation task ends with a commit.
- [ ] Final verification includes `bun run typecheck`, `bun run test`, and `bun run build`.
