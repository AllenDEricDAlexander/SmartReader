# SmartReader Home Main Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the SmartReader home main content to match the approved prototype-first design while preserving existing PDF open, recent reopen, favorite toggle, and blank-page routing flows.

**Architecture:** Keep `ReaderApp` as the owner of data and real navigation. Split the home main content into focused presentational components under `src/home`, use callback props for existing behaviors, and keep unsupported command actions behind a small local modal instead of adding persistence or Tauri commands.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, lucide-react, existing CSS in `src/app/styles.css`.

---

## Scope Source

Implement the approved spec:

- `docs/superpowers/specs/2026-07-03-smartreader-home-main-content-design.md`

This plan is style-first. Do not add dependencies, database migrations, Tauri commands, or new persistence APIs.

## File Structure

- Create: `src/home/homeDisplayUtils.ts`
  - Shared formatting helpers for path, date, page, and progress labels used by the home modules.
- Create: `src/home/HomeWelcomeBanner.tsx`
  - Static welcome banner with book icon, copy, and CSS-built illustration.
- Create: `src/home/HomeActionNotice.tsx`
  - Small local modal for unsupported command feedback and confirmation.
- Create: `src/home/HomeActionNotice.test.tsx`
  - Direct modal rendering and confirm/close callback coverage.
- Create: `src/home/HomeRecentFiles.tsx`
  - Recent-files table and row action menu.
- Modify: `src/home/HomeQuickStart.tsx`
  - Replace button stack and standalone drop area with three equal cards.
- Modify: `src/home/HomeRecentSessions.tsx`
  - Rename to restore-last-session content and render up to three clickable session rows.
- Modify: `src/home/HomeFavorites.tsx`
  - Rename to favorite-files content and render up to three horizontal cards.
- Modify: `src/home/HomeDashboard.tsx`
  - Compose the new home modules, remove the dashboard title header from the home main area, own fallback modal state, and pass callbacks.
- Modify: `src/app/ReaderApp.tsx`
  - Pass the existing `handleDrop` function into `HomeDashboard`.
- Modify: `src/home/HomeDashboard.test.tsx`
  - Cover welcome banner, module composition, fallback modal, and routing callbacks.
- Modify: `src/home/HomeQuickStart.test.tsx`
  - Cover the new three-card quick-start behavior.
- Modify: `src/app/styles.css`
  - Add prototype-aligned home-main-content styles and responsive constraints.

## Task 1: Home Display Helpers And Welcome Banner

**Files:**
- Create: `src/home/homeDisplayUtils.ts`
- Create: `src/home/HomeWelcomeBanner.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing dashboard tests for the welcome banner and removed dashboard header**

Append these tests inside `describe('HomeDashboard', () => { ... })` in `src/home/HomeDashboard.test.tsx`:

```tsx
it('renders the prototype welcome banner at the top of the home content', () => {
  renderDashboard({ activeSidebarPage: 'home' });

  expect(screen.getByRole('region', { name: '欢迎使用 SmartReader' })).toBeInTheDocument();
  expect(screen.getByText('欢迎使用 SmartReader')).toBeInTheDocument();
  expect(screen.getByText('本地优先 · 隐私安全 · 高效阅读')).toBeInTheDocument();
  expect(
    screen.getByText('所有文件和数据仅存储在您的设备上，完全掌控您的知识。'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('本地安全阅读插画')).toBeInTheDocument();
});

it('does not show the old dashboard title header on the home page', () => {
  renderDashboard({ activeSidebarPage: 'home' });

  expect(screen.queryByRole('heading', { name: '阅读仪表盘' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the failing dashboard tests**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: FAIL because the welcome banner does not exist and the old `阅读仪表盘` heading still renders.

- [ ] **Step 3: Create the shared display helpers**

Create `src/home/homeDisplayUtils.ts`:

```ts
import type { PersistedDocument } from '../persistence/persistenceApi';

export function getDirectoryPath(path: string | null): string {
  if (!path) {
    return '本地浏览器文件';
  }

  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');

  if (index <= 0) {
    return normalized;
  }

  return `${normalized.slice(0, index)}/`;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return '时间未知';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }

  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());

  return `${year}/${month}/${day} ${hour}:${minute}`;
}

export function formatShortDate(value: string | null): string {
  if (!value) {
    return '日期未知';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '日期未知';
  }

  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());

  return `${year}/${month}/${day}`;
}

export function formatPageProgress(document: Pick<PersistedDocument, 'lastPage' | 'pageCount'>) {
  if (document.pageCount && document.pageCount > 0) {
    return `上次阅读到 第 ${document.lastPage} / ${document.pageCount} 页`;
  }

  return `上次阅读到 第 ${document.lastPage} 页`;
}

export function formatProgressPercent(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(progress * 100), 0), 100);
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}
```

- [ ] **Step 4: Create the welcome banner component**

Create `src/home/HomeWelcomeBanner.tsx`:

```tsx
import { BookOpenCheck, FileText, ShieldCheck, Sparkles } from 'lucide-react';

export function HomeWelcomeBanner() {
  return (
    <section className="home-welcome-banner" aria-label="欢迎使用 SmartReader">
      <div className="welcome-brand-icon" aria-hidden="true">
        <BookOpenCheck size={44} strokeWidth={1.8} />
      </div>
      <div className="welcome-copy">
        <h2>欢迎使用 SmartReader</h2>
        <p className="welcome-subtitle">本地优先 · 隐私安全 · 高效阅读</p>
        <p className="welcome-description">
          所有文件和数据仅存储在您的设备上，完全掌控您的知识。
        </p>
      </div>
      <div className="welcome-illustration" aria-label="本地安全阅读插画">
        <div className="welcome-document-card">
          <FileText size={34} />
          <span className="document-line strong" />
          <span className="document-line short" />
          <span className="document-line accent" />
          <span className="document-line" />
        </div>
        <div className="welcome-shield">
          <ShieldCheck size={28} />
        </div>
        <Sparkles className="welcome-sparkle one" size={16} />
        <Sparkles className="welcome-sparkle two" size={14} />
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Compose the banner and remove the old home header**

In `src/home/HomeDashboard.tsx`, add the import:

```tsx
import { HomeWelcomeBanner } from './HomeWelcomeBanner';
```

Then replace the `homeContent` constant with:

```tsx
const homeContent = (
  <div className="home-content">
    <div className="home-primary">
      <HomeWelcomeBanner />
      <HomeQuickStart onOpenPdf={handleOpenPdf} onPickBrowserFile={openBrowserFilePicker} />
      <HomeRecentSessions documents={recentDocuments} onReopenDocument={onReopenRecentDocument} />
      <HomeFavorites documents={favoriteDocuments} onToggleFavorite={onToggleFavorite} />
    </div>
    <HomeStatusPanel />
  </div>
);
```

Replace the `<div className="home-main">...</div>` body so it no longer renders `<header className="home-header">`:

```tsx
<div className="home-main">{mainContent}</div>
```

- [ ] **Step 6: Add initial banner styles**

Append this CSS block near the existing home panel styles in `src/app/styles.css`:

```css
.home-welcome-banner {
  min-width: 0;
  min-height: 132px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(220px, 320px);
  align-items: center;
  gap: 28px;
  padding: 26px 32px;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
}

.welcome-brand-icon {
  width: 78px;
  height: 78px;
  display: grid;
  place-items: center;
  border-radius: 20px;
  background: #eaf3ff;
  color: var(--sr-text);
}

.welcome-copy {
  min-width: 0;
}

.welcome-copy h2 {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
}

.welcome-subtitle,
.welcome-description {
  margin: 8px 0 0;
  color: var(--sr-text-muted);
}

.welcome-subtitle {
  font-size: 16px;
}

.welcome-description {
  font-size: 13px;
}

.welcome-illustration {
  position: relative;
  min-height: 104px;
  display: grid;
  place-items: center;
}

.welcome-document-card {
  width: 150px;
  min-height: 104px;
  display: grid;
  gap: 8px;
  padding: 18px 18px 14px;
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: var(--sr-radius);
  background: #f8fbff;
  color: #93b4e8;
  box-shadow: 20px 12px 0 rgba(37, 99, 235, 0.08);
}

.document-line {
  height: 5px;
  border-radius: 999px;
  background: #cbd5e1;
}

.document-line.strong {
  background: #8ab4f8;
}

.document-line.short {
  width: 76%;
}

.document-line.accent {
  width: 44%;
  background: #f5c044;
}

.welcome-shield {
  position: absolute;
  right: 34px;
  bottom: 8px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--sr-primary);
  color: #fff;
}

.welcome-sparkle {
  position: absolute;
  color: #9cc3ff;
}

.welcome-sparkle.one {
  left: 38px;
  bottom: 22px;
}

.welcome-sparkle.two {
  right: 4px;
  top: 18px;
}
```

- [ ] **Step 7: Run tests for Task 1**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: PASS for the new welcome banner tests and existing dashboard tests.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/home/homeDisplayUtils.ts src/home/HomeWelcomeBanner.tsx src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/app/styles.css
git commit -m "feat: add home welcome banner"
```

## Task 2: Three-Card Quick Start

**Files:**
- Modify: `src/home/HomeQuickStart.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/home/HomeQuickStart.test.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Replace quick-start tests with the new card behavior**

Replace the contents of `src/home/HomeQuickStart.test.tsx` with:

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeQuickStart } from './HomeQuickStart';

describe('HomeQuickStart', () => {
  it('renders the prototype three-card quick start layout', () => {
    renderApp(
      <HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={vi.fn()} onOpenFolder={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: '快速开始' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开本地 PDF/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /拖拽到这里/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /选择文件夹/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('PDF 拖拽区域')).not.toBeInTheDocument();
  });

  it('opens a local PDF from the first card', () => {
    const onOpenPdf = vi.fn();
    renderApp(
      <HomeQuickStart onOpenPdf={onOpenPdf} onDropPdf={vi.fn()} onOpenFolder={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    expect(onOpenPdf).toHaveBeenCalledTimes(1);
  });

  it('marks the drop card active and forwards dropped files', () => {
    const onDropPdf = vi.fn((event) => event.preventDefault());
    renderApp(
      <HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={onDropPdf} onOpenFolder={vi.fn()} />,
    );

    const dropCard = screen.getByRole('button', { name: /拖拽到这里/ });
    fireEvent.dragOver(dropCard);
    expect(dropCard).toHaveClass('drag-active');

    fireEvent.drop(dropCard, {
      dataTransfer: {
        files: [new File(['pdf'], 'sample.pdf', { type: 'application/pdf' })],
      },
    });

    expect(onDropPdf).toHaveBeenCalledTimes(1);
    expect(dropCard).not.toHaveClass('drag-active');
  });

  it('routes folder selection through the provided callback', () => {
    const onOpenFolder = vi.fn();
    renderApp(
      <HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={vi.fn()} onOpenFolder={onOpenFolder} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /选择文件夹/ }));

    expect(onOpenFolder).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Add failing dashboard wiring tests**

In `src/home/HomeDashboard.test.tsx`, add `onDropPdf: vi.fn(),` to the default `props` object in `renderDashboard`.

Delete the old test named `opens the shared PDF input directly from the quick-start chooser`. The prototype quick-start layout no longer has a `选择 PDF 文件` button; fallback file input behavior remains covered by the `打开文件` and `打开本地 PDF` tests.

In the existing fallback tests in `src/home/HomeDashboard.test.tsx`, replace exact quick-start button queries like:

```tsx
screen.getByRole('button', { name: '打开本地 PDF' })
```

with this regex query, because the new card's accessible name also includes its description:

```tsx
screen.getByRole('button', { name: /打开本地 PDF/ })
```

Append these tests inside the existing `describe` block:

```tsx
it('forwards quick-start folder selection to the folders blank page callback', () => {
  const onOpenFolders = vi.fn();
  renderDashboard({ onOpenFolders });

  fireEvent.click(screen.getByRole('button', { name: /选择文件夹/ }));

  expect(onOpenFolders).toHaveBeenCalledTimes(1);
});

it('forwards quick-start PDF drops to the reader drop handler', () => {
  const onDropPdf = vi.fn((event) => event.preventDefault());
  renderDashboard({ onDropPdf });

  fireEvent.drop(screen.getByRole('button', { name: /拖拽到这里/ }), {
    dataTransfer: {
      files: [new File(['pdf'], 'drop.pdf', { type: 'application/pdf' })],
    },
  });

  expect(onDropPdf).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run the failing quick-start tests**

Run:

```bash
bunx vitest run src/home/HomeQuickStart.test.tsx src/home/HomeDashboard.test.tsx
```

Expected: FAIL because `HomeQuickStart` still expects `onPickBrowserFile`, `HomeDashboard` does not accept `onDropPdf`, and the old standalone drop target still exists.

- [ ] **Step 4: Replace `HomeQuickStart` with the three-card implementation**

Replace `src/home/HomeQuickStart.tsx` with:

```tsx
import { CloudUpload, FolderOpen, FolderPlus } from 'lucide-react';
import { useState, type DragEventHandler } from 'react';

type HomeQuickStartProps = {
  onOpenPdf(): void;
  onDropPdf: DragEventHandler<HTMLElement>;
  onOpenFolder(): void;
};

export function HomeQuickStart({ onOpenPdf, onDropPdf, onOpenFolder }: HomeQuickStartProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrop: DragEventHandler<HTMLButtonElement> = (event) => {
    setDragActive(false);
    onDropPdf(event);
  };

  return (
    <section className="home-panel home-quick-start" aria-labelledby="home-quick-start-title">
      <div className="section-heading">
        <h2 id="home-quick-start-title">快速开始</h2>
      </div>
      <div className="quick-start-card-grid">
        <button type="button" className="quick-start-card" onClick={onOpenPdf}>
          <span className="quick-start-icon" aria-hidden="true">
            <FolderOpen size={34} />
          </span>
          <span className="quick-start-copy">
            <strong>打开本地 PDF</strong>
            <span>浏览并打开本地 PDF 文件</span>
          </span>
        </button>
        <button
          type="button"
          className={dragActive ? 'quick-start-card drop-card drag-active' : 'quick-start-card drop-card'}
          onDragLeave={() => setDragActive(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDrop={handleDrop}
        >
          <span className="quick-start-icon" aria-hidden="true">
            <CloudUpload size={34} />
          </span>
          <span className="quick-start-copy">
            <strong>拖拽到这里</strong>
            <span>将 PDF 文件拖拽到此处打开</span>
          </span>
        </button>
        <button type="button" className="quick-start-card" onClick={onOpenFolder}>
          <span className="quick-start-icon" aria-hidden="true">
            <FolderPlus size={34} />
          </span>
          <span className="quick-start-copy">
            <strong>选择文件夹</strong>
            <span>打开文件夹并批量导入 PDF</span>
          </span>
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Wire `onDropPdf` through `HomeDashboard` and `ReaderApp`**

In `src/home/HomeDashboard.tsx`, add `type DragEventHandler` to the React import:

```tsx
import { useCallback, useRef, type ChangeEventHandler, type DragEventHandler } from 'react';
```

Add this prop to `HomeDashboardProps`:

```tsx
onDropPdf: DragEventHandler<HTMLElement>;
```

Destructure it in `HomeDashboard`:

```tsx
onDropPdf,
```

Replace the `HomeQuickStart` usage with:

```tsx
<HomeQuickStart
  onOpenPdf={handleOpenPdf}
  onDropPdf={onDropPdf}
  onOpenFolder={onOpenFolders}
/>
```

In `src/app/ReaderApp.tsx`, pass the existing drop handler to `HomeDashboard`:

```tsx
onDropPdf={handleDrop}
```

- [ ] **Step 6: Replace quick-start styles**

Append this CSS block after the existing `.section-heading.horizontal` styles in `src/app/styles.css`:

```css
.home-quick-start {
  display: grid;
  gap: 16px;
}

.quick-start-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 32px;
}

.quick-start-card {
  min-width: 0;
  min-height: 92px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  justify-content: stretch;
  gap: 16px;
  padding: 18px 22px;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
  text-align: left;
}

.quick-start-card:hover,
.quick-start-card.drag-active {
  border-color: rgba(37, 99, 235, 0.38);
  background: #f8fbff;
}

.quick-start-card.drop-card {
  border-style: dashed;
}

.quick-start-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  color: var(--sr-primary);
}

.quick-start-copy {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.quick-start-copy strong,
.quick-start-copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-start-copy strong {
  color: var(--sr-text);
  font-size: 16px;
}

.quick-start-copy span {
  color: var(--sr-text-muted);
  font-size: 13px;
}
```

- [ ] **Step 7: Run tests for Task 2**

Run:

```bash
bunx vitest run src/home/HomeQuickStart.test.tsx src/home/HomeDashboard.test.tsx
```

Expected: PASS for quick-start card rendering, opening, drop forwarding, and folder routing.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/home/HomeQuickStart.tsx src/home/HomeQuickStart.test.tsx src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/app/ReaderApp.tsx src/app/styles.css
git commit -m "feat: redesign home quick start"
```

## Task 3: Local Action Notice Modal

**Files:**
- Create: `src/home/HomeActionNotice.tsx`
- Create: `src/home/HomeActionNotice.test.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing component tests for the fallback notice**

Create `src/home/HomeActionNotice.test.tsx`:

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeActionNotice } from './HomeActionNotice';

describe('HomeActionNotice', () => {
  it('renders a dismissible fallback notice', () => {
    const onClose = vi.fn();

    renderApp(
      <HomeActionNotice
        title="定位文件功能待补充"
        message="定位文件将在最近文件管理功能中补充。"
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: '定位文件功能待补充' })).toBeInTheDocument();
    expect(screen.getByText('定位文件将在最近文件管理功能中补充。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports a confirmation action', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    renderApp(
      <HomeActionNotice
        title="清除记录"
        message="当前版本不会直接清空记录。确认后将展示功能待补充说明。"
        confirmLabel="确认"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the failing notice component test**

Run:

```bash
bunx vitest run src/home/HomeActionNotice.test.tsx
```

Expected: FAIL because `HomeActionNotice` does not exist yet.

- [ ] **Step 3: Create the action notice component**

Create `src/home/HomeActionNotice.tsx`:

```tsx
type HomeActionNoticeProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?(): void;
  onClose(): void;
};

export function HomeActionNotice({
  title,
  message,
  confirmLabel,
  cancelLabel = '关闭',
  onConfirm,
  onClose,
}: HomeActionNoticeProps) {
  return (
    <div className="home-notice-backdrop" role="presentation">
      <section className="home-action-notice" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="home-notice-actions">
          <button type="button" onClick={onClose}>
            {cancelLabel}
          </button>
          {onConfirm && confirmLabel ? (
            <button type="button" className="primary-action" onClick={onConfirm}>
              {confirmLabel}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add modal state to `HomeDashboard`**

In `src/home/HomeDashboard.tsx`, add the import:

```tsx
import { HomeActionNotice } from './HomeActionNotice';
```

Change the React import to include `useState`:

```tsx
import {
  useCallback,
  useRef,
  useState,
  type ChangeEventHandler,
  type DragEventHandler,
} from 'react';
```

Inside `HomeDashboard`, after `const fileInputRef = useRef<HTMLInputElement>(null);`, add:

```tsx
const [notice, setNotice] = useState<{
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm?: () => void;
} | null>(null);

const showNotice = useCallback((title: string, message: string) => {
  setNotice({ title, message });
}, []);
```

In the returned JSX, immediately before `</div>` of `.home-dashboard-shell`, render:

```tsx
{notice ? (
  <HomeActionNotice
    title={notice.title}
    message={notice.message}
    confirmLabel={notice.confirmLabel}
    onConfirm={notice.onConfirm}
    onClose={() => setNotice(null)}
  />
) : null}
```

When wiring `HomeRecentSessions` in Task 4, use this callback:

```tsx
onClearRecords={() =>
  setNotice({
    title: '清除记录',
    message: '当前版本不会直接清空记录。确认后将展示功能待补充说明。',
    confirmLabel: '确认',
    onConfirm: () => {
      setNotice({
        title: '清除记录功能待补充',
        message: '清除记录将在会话恢复管理功能中补充。',
      });
    },
  })
}
```

- [ ] **Step 5: Add modal styles**

Append this CSS block to `src/app/styles.css`:

```css
.home-notice-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.28);
}

.home-action-notice {
  width: min(420px, 100%);
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
  box-shadow: 0 18px 60px rgba(15, 23, 42, 0.22);
}

.home-action-notice h2,
.home-action-notice p {
  margin: 0;
}

.home-action-notice h2 {
  font-size: 18px;
}

.home-action-notice p {
  color: var(--sr-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.home-notice-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.home-notice-actions button {
  padding: 0 12px;
}
```

- [ ] **Step 6: Run the notice component test**

Run:

```bash
bunx vitest run src/home/HomeActionNotice.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/home/HomeActionNotice.tsx src/home/HomeActionNotice.test.tsx src/home/HomeDashboard.tsx src/app/styles.css
git commit -m "feat: add home action notice"
```

## Task 4: Restore Last Session Module

**Files:**
- Modify: `src/home/HomeRecentSessions.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing tests for restore-session rows**

Append these tests to `src/home/HomeDashboard.test.tsx`:

```tsx
const recentDocumentsFixture = [
  {
    documentKey: 'desktop:/Users/mario/Documents/AI/a.pdf',
    path: '/Users/mario/Documents/AI/a.pdf',
    displayName: '人工智能：原理与实践.pdf',
    fileSize: 1024,
    modifiedAt: '2024-05-01T10:32:00+08:00',
    pageCount: 86,
    lastPage: 12,
    progress: 0.62,
    missing: false,
  },
  {
    documentKey: 'desktop:/Users/mario/Documents/ML/b.pdf',
    path: '/Users/mario/Documents/ML/b.pdf',
    displayName: '深度学习导论（第2版）.pdf',
    fileSize: 2048,
    modifiedAt: '2024-04-30T18:47:00+08:00',
    pageCount: 320,
    lastPage: 45,
    progress: 0.38,
    missing: false,
  },
  {
    documentKey: 'desktop:/Users/mario/Documents/Data/c.pdf',
    path: '/Users/mario/Documents/Data/c.pdf',
    displayName: '数据科学实践手册.pdf',
    fileSize: 4096,
    modifiedAt: '2024-04-29T09:15:00+08:00',
    pageCount: 156,
    lastPage: 23,
    progress: 0.71,
    missing: false,
  },
  {
    documentKey: 'desktop:/Users/mario/Documents/Extra/d.pdf',
    path: '/Users/mario/Documents/Extra/d.pdf',
    displayName: '第四条不应出现在会话恢复.pdf',
    fileSize: 8192,
    modifiedAt: '2024-04-28T09:15:00+08:00',
    pageCount: 200,
    lastPage: 10,
    progress: 0.12,
    missing: false,
  },
];

it('renders restore-last-session rows from recent documents and limits them to three', () => {
  renderDashboard({ recentDocuments: recentDocumentsFixture });

  expect(screen.getByRole('heading', { name: '恢复上次会话' })).toBeInTheDocument();
  expect(screen.getByText('继续您上次阅读的内容')).toBeInTheDocument();
  expect(screen.getByText('人工智能：原理与实践.pdf')).toBeInTheDocument();
  expect(screen.getByText('/Users/mario/Documents/AI/')).toBeInTheDocument();
  expect(screen.getByText('上次阅读到 第 12 / 86 页')).toBeInTheDocument();
  expect(screen.getByText('2024/05/01 10:32')).toBeInTheDocument();
  expect(screen.queryByText('第四条不应出现在会话恢复.pdf')).not.toBeInTheDocument();
});

it('reopens a session row and does not double-call when the continue button is clicked', () => {
  const onReopenRecentDocument = vi.fn();
  renderDashboard({
    recentDocuments: recentDocumentsFixture.slice(0, 1),
    onReopenRecentDocument,
  });

  fireEvent.click(screen.getByText('人工智能：原理与实践.pdf'));
  expect(onReopenRecentDocument).toHaveBeenCalledTimes(1);
  expect(onReopenRecentDocument).toHaveBeenLastCalledWith(recentDocumentsFixture[0]);

  fireEvent.click(screen.getByRole('button', { name: '继续阅读 人工智能：原理与实践.pdf' }));

  expect(onReopenRecentDocument).toHaveBeenCalledTimes(2);
  expect(onReopenRecentDocument).toHaveBeenLastCalledWith(recentDocumentsFixture[0]);
});

it('confirms clear-records before showing the deferred action notice', () => {
  renderDashboard({
    recentDocuments: recentDocumentsFixture.slice(0, 1),
  });

  fireEvent.click(screen.getByRole('button', { name: '清除记录' }));
  expect(screen.getByRole('dialog', { name: '清除记录' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '确认' }));

  expect(screen.getByRole('dialog', { name: '清除记录功能待补充' })).toBeInTheDocument();
  expect(screen.getByText('清除记录将在会话恢复管理功能中补充。')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the failing dashboard tests**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: FAIL because `HomeRecentSessions` still renders `最近阅读 / 继续上次会话` and does not expose `清除记录` or `继续阅读` buttons.

- [ ] **Step 3: Replace `HomeRecentSessions`**

Replace `src/home/HomeRecentSessions.tsx` with:

```tsx
import { FileText } from 'lucide-react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { formatDateTime, formatPageProgress, getDirectoryPath } from './homeDisplayUtils';

type HomeRecentSessionsProps = {
  documents: PersistedDocument[];
  onClearRecords(): void;
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
};

export function HomeRecentSessions({
  documents,
  onClearRecords,
  onReopenDocument,
}: HomeRecentSessionsProps) {
  const sessionDocuments = documents.slice(0, 3);

  return (
    <section className="home-panel home-session-restore" aria-labelledby="home-recent-title">
      <div className="section-heading horizontal">
        <div>
          <h2 id="home-recent-title">恢复上次会话</h2>
          <p>继续您上次阅读的内容</p>
        </div>
        <button type="button" className="text-link-button" onClick={onClearRecords}>
          清除记录
        </button>
      </div>
      {sessionDocuments.length > 0 ? (
        <div className="session-list">
          {sessionDocuments.map((document) => (
            <SessionRow
              key={document.documentKey}
              document={document}
              onReopenDocument={onReopenDocument}
            />
          ))}
        </div>
      ) : (
        <div className="empty-block compact">
          <strong>暂无可恢复会话</strong>
          <span>打开 PDF 后，SmartReader 会在这里保留阅读进度。</span>
        </div>
      )}
    </section>
  );
}

function SessionRow({
  document,
  onReopenDocument,
}: {
  document: PersistedDocument;
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
}) {
  const reopen = () => {
    void onReopenDocument(document);
  };

  return (
    <div
      className={document.missing ? 'session-row missing' : 'session-row'}
      title={document.path ?? ''}
      onClick={reopen}
    >
      <span className="pdf-file-icon" aria-hidden="true">
        <FileText size={16} />
      </span>
      <span className="session-main">
        <strong>{document.displayName}</strong>
        <span>{getDirectoryPath(document.path)}</span>
      </span>
      <span className="session-progress">{formatPageProgress(document)}</span>
      <span className="session-time">{formatDateTime(document.modifiedAt)}</span>
      <button
        type="button"
        className="session-continue-button"
        aria-label={`继续阅读 ${document.displayName}`}
        onClick={(event) => {
          event.stopPropagation();
          reopen();
        }}
      >
        继续阅读
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Wire `onClearRecords` in `HomeDashboard`**

Replace the `HomeRecentSessions` usage in `src/home/HomeDashboard.tsx` with:

```tsx
<HomeRecentSessions
  documents={recentDocuments}
  onReopenDocument={onReopenRecentDocument}
  onClearRecords={() =>
    setNotice({
      title: '清除记录',
      message: '当前版本不会直接清空记录。确认后将展示功能待补充说明。',
      confirmLabel: '确认',
      onConfirm: () => {
        setNotice({
          title: '清除记录功能待补充',
          message: '清除记录将在会话恢复管理功能中补充。',
        });
      },
    })
  }
/>
```

- [ ] **Step 5: Replace session-row styles**

Append this CSS block after the quick-start styles in `src/app/styles.css`:

```css
.text-link-button {
  min-height: auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--sr-primary);
  font-size: 12px;
}

.text-link-button:hover:not(:disabled) {
  background: transparent;
  color: #1d4ed8;
}

.home-session-restore {
  display: grid;
  gap: 14px;
}

.session-list {
  display: grid;
  gap: 0;
  margin-top: 0;
  overflow: hidden;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
}

.session-row {
  min-width: 0;
  min-height: 52px;
  display: grid;
  grid-template-columns: auto minmax(220px, 1fr) minmax(180px, auto) minmax(98px, auto) auto;
  align-items: center;
  gap: 14px;
  padding: 9px 12px;
  border: 0;
  border-bottom: 1px solid var(--sr-border);
  border-radius: 0;
  background: var(--sr-surface);
  cursor: pointer;
}

.session-row:last-child {
  border-bottom: 0;
}

.session-row:hover {
  background: #f8fbff;
}

.pdf-file-icon {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  color: #ef4444;
}

.session-progress,
.session-time {
  min-width: 0;
  color: var(--sr-text-muted);
  font-size: 13px;
  white-space: nowrap;
}

.session-time {
  justify-self: end;
}

.session-continue-button {
  min-height: 30px;
  padding: 0 12px;
  white-space: nowrap;
}
```

- [ ] **Step 6: Run tests for Task 4**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: PASS for the restore-session tests and the Task 3 clear-records modal test.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/home/HomeRecentSessions.tsx src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/app/styles.css
git commit -m "feat: redesign home session restore"
```

## Task 5: Recent Files Table

**Files:**
- Create: `src/home/HomeRecentFiles.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing tests for the recent-files table and menu**

Append these tests to `src/home/HomeDashboard.test.tsx`:

```tsx
it('renders a recent-files table limited to five rows', () => {
  const documents = Array.from({ length: 6 }, (_, index) => ({
    documentKey: `desktop:/Users/mario/Documents/file-${index + 1}.pdf`,
    path: `/Users/mario/Documents/file-${index + 1}.pdf`,
    displayName: `file-${index + 1}.pdf`,
    fileSize: 1024,
    modifiedAt: '2024-05-01T10:32:00+08:00',
    pageCount: 100,
    lastPage: 62,
    progress: 0.62,
    missing: false,
  }));

  renderDashboard({ recentDocuments: documents });

  expect(screen.getByRole('heading', { name: '最近文件' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看全部（6）' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '文件名' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '路径' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '上次打开' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '阅读进度' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '操作' })).toBeInTheDocument();
  expect(screen.getByText('file-1.pdf')).toBeInTheDocument();
  expect(screen.queryByText('file-6.pdf')).not.toBeInTheDocument();
  expect(screen.getAllByRole('progressbar', { name: /阅读进度/ })).toHaveLength(5);
});

it('routes recent files view-all to the existing recent-files page', () => {
  const onOpenRecentFiles = vi.fn();
  renderDashboard({
    recentDocuments: recentDocumentsFixture.slice(0, 1),
    onOpenRecentFiles,
  });

  fireEvent.click(screen.getByRole('button', { name: '查看全部（1）' }));

  expect(onOpenRecentFiles).toHaveBeenCalledTimes(1);
});

it('opens recent-file menu actions and shows fallback notices for deferred actions', () => {
  const onReopenRecentDocument = vi.fn();
  const onToggleFavorite = vi.fn();
  renderDashboard({
    recentDocuments: recentDocumentsFixture.slice(0, 1),
    favoriteDocuments: [],
    onReopenRecentDocument,
    onToggleFavorite,
  });

  fireEvent.click(screen.getByRole('button', { name: '更多操作 人工智能：原理与实践.pdf' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '打开' }));
  expect(onReopenRecentDocument).toHaveBeenCalledWith(recentDocumentsFixture[0]);

  fireEvent.click(screen.getByRole('button', { name: '更多操作 人工智能：原理与实践.pdf' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '收藏' }));
  expect(onToggleFavorite).toHaveBeenCalledWith(recentDocumentsFixture[0].documentKey, true);

  fireEvent.click(screen.getByRole('button', { name: '更多操作 人工智能：原理与实践.pdf' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '定位文件' }));
  expect(screen.getByRole('dialog', { name: '定位文件功能待补充' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the failing dashboard tests**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: FAIL because `HomeRecentFiles` is not created or rendered.

- [ ] **Step 3: Create `HomeRecentFiles`**

Create `src/home/HomeRecentFiles.tsx`:

```tsx
import { FileText, MoreVertical } from 'lucide-react';
import { useState } from 'react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { formatDateTime, formatProgressPercent, getDirectoryPath } from './homeDisplayUtils';

type HomeRecentFilesProps = {
  documents: PersistedDocument[];
  favoriteDocumentKeys: Set<string>;
  onOpenAll(): void;
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onLocateFile(document: PersistedDocument): void;
  onRemoveRecent(document: PersistedDocument): void;
};

export function HomeRecentFiles({
  documents,
  favoriteDocumentKeys,
  onOpenAll,
  onReopenDocument,
  onToggleFavorite,
  onLocateFile,
  onRemoveRecent,
}: HomeRecentFilesProps) {
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const visibleDocuments = documents.slice(0, 5);

  return (
    <section className="home-panel home-recent-files" aria-labelledby="home-recent-files-title">
      <div className="section-heading horizontal">
        <h2 id="home-recent-files-title">最近文件</h2>
        <button type="button" className="text-link-button" onClick={onOpenAll}>
          查看全部（{documents.length}）
        </button>
      </div>
      {visibleDocuments.length > 0 ? (
        <div className="recent-files-table-wrap">
          <table className="recent-files-table">
            <thead>
              <tr>
                <th scope="col">文件名</th>
                <th scope="col">路径</th>
                <th scope="col">上次打开</th>
                <th scope="col">阅读进度</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocuments.map((document) => {
                const progressPercent = formatProgressPercent(document.progress);
                const favorite = favoriteDocumentKeys.has(document.documentKey);

                return (
                  <tr key={document.documentKey}>
                    <td>
                      <span className="recent-file-name">
                        <span className="pdf-file-icon" aria-hidden="true">
                          <FileText size={14} />
                        </span>
                        <span title={document.displayName}>{document.displayName}</span>
                      </span>
                    </td>
                    <td>
                      <span className="path-cell" title={document.path ?? '本地浏览器文件'}>
                        {getDirectoryPath(document.path)}
                      </span>
                    </td>
                    <td>{formatDateTime(document.modifiedAt)}</td>
                    <td>
                      <span className="progress-cell">
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
                      </span>
                    </td>
                    <td className="recent-menu-cell">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`更多操作 ${document.displayName}`}
                        onClick={() =>
                          setOpenMenuKey((current) =>
                            current === document.documentKey ? null : document.documentKey,
                          )
                        }
                      >
                        <MoreVertical size={16} />
                      </button>
                      {openMenuKey === document.documentKey ? (
                        <div className="recent-file-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuKey(null);
                              void onReopenDocument(document);
                            }}
                          >
                            打开
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuKey(null);
                              void onToggleFavorite(document.documentKey, !favorite);
                            }}
                          >
                            {favorite ? '取消收藏' : '收藏'}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuKey(null);
                              onLocateFile(document);
                            }}
                          >
                            定位文件
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuKey(null);
                              onRemoveRecent(document);
                            }}
                          >
                            从最近记录移除
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-block compact">
          <strong>暂无最近文件</strong>
          <span>打开 PDF 后会显示在这里。</span>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Render `HomeRecentFiles` from `HomeDashboard`**

In `src/home/HomeDashboard.tsx`, add the import:

```tsx
import { HomeRecentFiles } from './HomeRecentFiles';
```

Add this derived set before `homeContent`:

```tsx
const favoriteDocumentKeys = new Set(favoriteDocuments.map((document) => document.documentKey));
```

Render `HomeRecentFiles` between `HomeRecentSessions` and `HomeFavorites`:

```tsx
<HomeRecentFiles
  documents={recentDocuments}
  favoriteDocumentKeys={favoriteDocumentKeys}
  onOpenAll={onOpenRecentFiles}
  onReopenDocument={onReopenRecentDocument}
  onToggleFavorite={onToggleFavorite}
  onLocateFile={() =>
    showNotice('定位文件功能待补充', '定位文件将在最近文件管理功能中补充。')
  }
  onRemoveRecent={() =>
    showNotice('移除最近记录功能待补充', '从最近记录移除将在最近文件管理功能中补充。')
  }
/>
```

- [ ] **Step 5: Add recent-files table styles**

Append this CSS block to `src/app/styles.css`:

```css
.home-recent-files {
  display: grid;
  gap: 12px;
}

.recent-files-table-wrap {
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
}

.recent-files-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.recent-files-table th,
.recent-files-table td {
  min-width: 0;
  padding: 7px 10px;
  border-bottom: 1px solid var(--sr-border);
  color: var(--sr-text-muted);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}

.recent-files-table th {
  color: var(--sr-text-muted);
  font-weight: 500;
}

.recent-files-table tbody tr:last-child td {
  border-bottom: 0;
}

.recent-file-name,
.progress-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.recent-file-name span:last-child,
.path-cell {
  display: block;
  min-width: 0;
  max-width: 240px;
  overflow: hidden;
  color: var(--sr-text);
  text-overflow: ellipsis;
}

.path-cell {
  max-width: 280px;
  color: var(--sr-text-muted);
}

.recent-progress {
  width: 86px;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.1);
}

.recent-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--sr-primary);
}

.recent-menu-cell {
  position: relative;
  width: 56px;
}

.icon-button {
  width: 30px;
  min-height: 30px;
  padding: 0;
  border-color: transparent;
  background: transparent;
}

.recent-file-menu {
  position: absolute;
  right: 8px;
  top: 34px;
  z-index: 20;
  width: 148px;
  display: grid;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
  box-shadow: 0 10px 36px rgba(15, 23, 42, 0.16);
}

.recent-file-menu button {
  min-height: 30px;
  justify-content: flex-start;
  padding: 0 8px;
  border: 0;
  background: transparent;
}
```

- [ ] **Step 6: Run tests for Task 5**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: PASS for recent-files rendering, view-all routing, menu actions, and fallback notice.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/home/HomeRecentFiles.tsx src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/app/styles.css
git commit -m "feat: add home recent files table"
```

## Task 6: Favorite Files Cards

**Files:**
- Modify: `src/home/HomeFavorites.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing tests for favorite-file cards**

Append these tests to `src/home/HomeDashboard.test.tsx`:

```tsx
it('renders favorite files as three prototype cards', () => {
  renderDashboard({
    favoriteDocuments: [
      {
        documentKey: 'desktop:/Books/AI/a.pdf',
        displayName: '深度强化学习.pdf',
        path: '/Books/AI/a.pdf',
        lastPage: 88,
        progress: 0.52,
      },
      {
        documentKey: 'desktop:/Books/ML/b.pdf',
        displayName: '机器学习实战.pdf',
        path: '/Books/ML/b.pdf',
        lastPage: 156,
        progress: 0.78,
      },
      {
        documentKey: 'desktop:/Books/DL/c.pdf',
        displayName: '动手学深度学习.pdf',
        path: '/Books/DL/c.pdf',
        lastPage: 32,
        progress: 0.18,
      },
      {
        documentKey: 'desktop:/Books/Extra/d.pdf',
        displayName: '第四个收藏不显示.pdf',
        path: '/Books/Extra/d.pdf',
        lastPage: 1,
        progress: 0.01,
      },
    ],
  });

  expect(screen.getByRole('heading', { name: '收藏文件' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看全部（4）' })).toBeInTheDocument();
  expect(screen.getByText('深度强化学习.pdf')).toBeInTheDocument();
  expect(screen.getByText('/Books/AI/')).toBeInTheDocument();
  expect(screen.getByText('第 88 页')).toBeInTheDocument();
  expect(screen.queryByText('第四个收藏不显示.pdf')).not.toBeInTheDocument();
});

it('routes favorite view-all and star toggle actions', () => {
  const onOpenFavoriteFiles = vi.fn();
  const onToggleFavorite = vi.fn();
  renderDashboard({
    favoriteDocuments: [
      {
        documentKey: 'desktop:/Books/AI/a.pdf',
        displayName: '深度强化学习.pdf',
        path: '/Books/AI/a.pdf',
        lastPage: 88,
        progress: 0.52,
      },
    ],
    onOpenFavoriteFiles,
    onToggleFavorite,
  });

  fireEvent.click(screen.getByRole('button', { name: '查看全部（1）' }));
  expect(onOpenFavoriteFiles).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: '取消收藏 深度强化学习.pdf' }));
  expect(onToggleFavorite).toHaveBeenCalledWith('desktop:/Books/AI/a.pdf', false);
});

it('keeps the favorite empty state under the new title', () => {
  renderDashboard({ favoriteDocuments: [] });

  expect(screen.getByRole('heading', { name: '收藏文件' })).toBeInTheDocument();
  expect(screen.getByText('暂无收藏文件')).toBeInTheDocument();
  expect(screen.queryByText('重点文档')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the failing dashboard tests**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: FAIL because `HomeFavorites` still renders `重点文档`, has no view-all action, and does not limit to three prototype cards.

- [ ] **Step 3: Replace `HomeFavorites`**

Replace `src/home/HomeFavorites.tsx` with:

```tsx
import { FileText, Star } from 'lucide-react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import { getDirectoryPath } from './homeDisplayUtils';

type HomeFavoritesProps = {
  documents: FavoriteDocument[];
  onOpenAll(): void;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
};

export function HomeFavorites({ documents, onOpenAll, onToggleFavorite }: HomeFavoritesProps) {
  const visibleDocuments = documents.slice(0, 3);

  return (
    <section className="home-panel home-favorites-panel" aria-labelledby="home-favorites-title">
      <div className="section-heading horizontal">
        <h2 id="home-favorites-title">收藏文件</h2>
        <button type="button" className="text-link-button" onClick={onOpenAll}>
          查看全部（{documents.length}）
        </button>
      </div>
      {visibleDocuments.length > 0 ? (
        <div className="favorite-grid">
          {visibleDocuments.map((document) => (
            <article key={document.documentKey} className="favorite-card">
              <div className="favorite-card-main">
                <span className="pdf-file-icon" aria-hidden="true">
                  <FileText size={16} />
                </span>
                <div className="favorite-card-copy">
                  <strong title={document.displayName}>{document.displayName}</strong>
                  <span title={document.path ?? '本地浏览器文件'}>
                    {getDirectoryPath(document.path)}
                  </span>
                </div>
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
              <div className="favorite-card-footer">
                <span>第 {document.lastPage} 页</span>
                <span>日期未知</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-block compact">
          <strong>暂无收藏文件</strong>
          <span>收藏文件后会显示在这里。</span>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Pass `onOpenFavoriteFiles` from `HomeDashboard`**

Replace the `HomeFavorites` usage in `src/home/HomeDashboard.tsx` with:

```tsx
<HomeFavorites
  documents={favoriteDocuments}
  onOpenAll={onOpenFavoriteFiles}
  onToggleFavorite={onToggleFavorite}
/>
```

- [ ] **Step 5: Add favorite card styles**

Append this CSS block to `src/app/styles.css`:

```css
.home-favorites-panel {
  display: grid;
  gap: 12px;
}

.favorite-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 0;
}

.favorite-card {
  min-width: 0;
  min-height: 70px;
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
}

.favorite-card-main {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
}

.favorite-card-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.favorite-card-copy strong,
.favorite-card-copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-card-copy span,
.favorite-card-footer {
  color: var(--sr-text-muted);
  font-size: 12px;
}

.favorite-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.favorite-toggle {
  width: 28px;
  min-height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--sr-text-muted);
}

.favorite-toggle.active {
  color: var(--sr-warning);
}
```

- [ ] **Step 6: Run tests for Task 6**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx
```

Expected: PASS for favorite cards, view-all routing, star toggle, and empty state.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/home/HomeFavorites.tsx src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/app/styles.css
git commit -m "feat: redesign home favorite files"
```

## Task 7: Layout Polish And Final Verification

**Files:**
- Modify: `src/app/styles.css`
- Modify: `src/home/HomeDashboard.test.tsx`

- [ ] **Step 1: Add a final regression test for home module order**

Append this test to `src/home/HomeDashboard.test.tsx`:

```tsx
it('orders home main modules as welcome, quick start, session restore, recent files, and favorites', () => {
  renderDashboard({
    recentDocuments: recentDocumentsFixture.slice(0, 1),
    favoriteDocuments: [
      {
        documentKey: 'desktop:/Books/AI/a.pdf',
        displayName: '深度强化学习.pdf',
        path: '/Books/AI/a.pdf',
        lastPage: 88,
        progress: 0.52,
      },
    ],
  });

  const headings = screen
    .getAllByRole('heading')
    .map((heading) => heading.textContent)
    .filter(Boolean);

  expect(headings).toEqual(
    expect.arrayContaining([
      '欢迎使用 SmartReader',
      '快速开始',
      '恢复上次会话',
      '最近文件',
      '收藏文件',
    ]),
  );
  expect(headings.indexOf('欢迎使用 SmartReader')).toBeLessThan(headings.indexOf('快速开始'));
  expect(headings.indexOf('快速开始')).toBeLessThan(headings.indexOf('恢复上次会话'));
  expect(headings.indexOf('恢复上次会话')).toBeLessThan(headings.indexOf('最近文件'));
  expect(headings.indexOf('最近文件')).toBeLessThan(headings.indexOf('收藏文件'));
});
```

- [ ] **Step 2: Run the final home tests**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx src/home/HomeQuickStart.test.tsx src/home/HomeSidebar.test.tsx src/home/HomeTopBar.test.tsx
```

Expected: PASS. If a role query returns multiple matches for `查看全部（N）`, scope the query with `within()` around the relevant section instead of weakening the assertion.

- [ ] **Step 3: Add responsive layout styles**

Append this CSS block to `src/app/styles.css`:

```css
.home-content {
  grid-template-columns: minmax(760px, 1fr) 320px;
  align-items: start;
}

.home-primary {
  gap: 12px;
}

.home-panel {
  box-shadow: none;
}

@media (max-width: 1280px) {
  .home-content {
    grid-template-columns: minmax(0, 1fr);
  }

  .home-status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .home-welcome-banner,
  .quick-start-card-grid,
  .favorite-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .welcome-illustration {
    display: none;
  }

  .session-row {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .session-progress,
  .session-time {
    grid-column: 2 / -1;
    justify-self: start;
  }

  .home-status {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx src/home/HomeQuickStart.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS with TypeScript build completing successfully.

- [ ] **Step 6: Run the full test suite**

Run:

```bash
bun run test
```

Expected: PASS. If unrelated tests fail, capture the failing test names and error output before deciding whether they are in scope.

- [ ] **Step 7: Run whitespace validation**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/app/styles.css src/home/HomeDashboard.test.tsx
git commit -m "test: cover home main content order"
```

## Final Acceptance Checklist

- [ ] Welcome banner appears at the top of the home main content and contains the required copy.
- [ ] Quick start uses three equal cards and no longer shows the standalone large dashed drop area.
- [ ] Existing PDF open fallback still uses the single hidden home file input.
- [ ] Drop-card events reach the existing `handleDrop` flow.
- [ ] Folder selection routes to the existing `folders` blank page.
- [ ] Restore-last-session module shows up to three rows, clear-records confirmation, red PDF icons, page labels, time labels, and one reopen call per click.
- [ ] Recent-files module shows up to five table rows, view-all routing, progress bars, and the required menu actions.
- [ ] Favorite-files module shows up to three cards, view-all routing, active star toggle, and prototype-consistent empty state.
- [ ] Unsupported command actions use the local fallback modal and do not mutate local data.
- [ ] No new dependency, migration, Tauri command, or persistence API was added.
- [ ] Validation commands passed or any failures were documented with command output.

## Self-Review Notes

- Spec coverage: Tasks 1 through 7 cover `SR-HOME-DIFF-019` through `SR-HOME-DIFF-056`.
- Scope check: The plan stays inside home React components, tests, `ReaderApp` wiring, and CSS. It does not add database, Tauri, or persistence work.
- Type consistency: `HomeDashboard` owns `notice`, `showNotice`, and `favoriteDocumentKeys`; `HomeQuickStart` accepts `onOpenPdf`, `onDropPdf`, and `onOpenFolder`; `HomeRecentFiles` accepts `favoriteDocumentKeys`, fallback callbacks, and existing open/favorite callbacks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-smartreader-home-main-content.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
