# Favorite Files Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SmartReader 收藏文件 workspace so the sidebar entry renders a real searchable, filterable, data-backed favorite-files page instead of the current blank placeholder.

**Architecture:** Keep the feature isolated in a new `HomeFavoriteFilesWorkspace` component and small favorite-workspace pure helpers. Extend the existing favorite document query/model to include the metadata needed by the page, then wire `HomeDashboard` to render the new workspace for `favoriteFiles`. Do not abstract or refactor `HomeRecentFilesWorkspace`; reuse its interaction style, not its implementation.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, Tauri v2 invoke API, Rust `rusqlite`, existing SmartReader CSS in `src/app/styles.css`.

---

## File Structure

Create or modify these files only:

- Create `src/home/HomeFavoriteFilesWorkspace.tsx`: page component, local UI state, render card/list views, right-side insights, menus, and callback wiring.
- Create `src/home/HomeFavoriteFilesWorkspace.test.tsx`: component tests for search, filters, sorting, actions, right rail, and empty states.
- Create `src/home/favoriteWorkspaceUtils.ts`: pure helpers for filtering, sorting, directory derivation, tag usage, overview stats, recent activity, and recommendation reasons.
- Create `src/home/favoriteWorkspaceUtils.test.ts`: focused tests for helper behavior that is awkward to assert through DOM only.
- Modify `src/favorites/favoriteModels.ts`: extend `FavoriteDocument` with `pageCount`, `missing`, `lastOpenedAt`, and `tagIds`.
- Modify `src-tauri/src/db.rs`: extend Rust `FavoriteDocument`, update `list_favorite_documents_tx`, and add Rust tests for new fields/tag IDs/order.
- Modify `src/home/HomeDashboard.tsx`: render `HomeFavoriteFilesWorkspace` when `activeSidebarPage === 'favoriteFiles'` and pass callbacks/data.
- Modify `src/home/HomeDashboard.test.tsx`: assert `favoriteFiles` renders the new workspace instead of `HomeBlankPage`.
- Modify `src/search/globalSearch.test.ts` if fixtures fail after the model extension; update favorite fixture objects with new required fields.
- Modify any existing tests that construct `FavoriteDocument` objects so they include the new required fields.
- Modify `src/app/styles.css`: add favorite workspace styles by extending/reusing recent workspace selectors where safe, plus right-rail and chip styles.

Do not modify existing database migration SQL files. This plan does not require a new migration.

---

### Task 1: Extend Favorite Data Model

**Files:**
- Modify: `src/favorites/favoriteModels.ts`
- Modify: `src-tauri/src/db.rs`
- Test: `src-tauri/src/db.rs`
- Potential fixture updates: files found by `rg -n "FavoriteDocument|favoriteDocuments" src -g '*test*'`

- [ ] **Step 1: Write the Rust failing test for favorite metadata and tag IDs**

In `src-tauri/src/db.rs`, inside the existing `#[cfg(test)] mod tests`, update the existing `marks_and_lists_favorite_documents` test so it creates two documents, tags one favorite document, and expects the expanded fields. Replace the current body of `marks_and_lists_favorite_documents` with this body:

```rust
    #[test]
    fn marks_and_lists_favorite_documents() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        let first_document = PersistedDocument {
            document_key: "desktop:/tmp/book.pdf".to_string(),
            path: Some("/tmp/book.pdf".to_string()),
            display_name: "book.pdf".to_string(),
            file_size: Some(100),
            modified_at: Some("2026-06-16T00:00:00Z".to_string()),
            page_count: Some(20),
            last_page: 7,
            progress: 0.35,
            missing: false,
        };
        let second_document = PersistedDocument {
            document_key: "desktop:/tmp/newer.pdf".to_string(),
            path: Some("/tmp/newer.pdf".to_string()),
            display_name: "newer.pdf".to_string(),
            file_size: Some(200),
            modified_at: Some("2026-06-17T00:00:00Z".to_string()),
            page_count: Some(50),
            last_page: 50,
            progress: 1.0,
            missing: false,
        };

        upsert_document(&connection, &first_document).expect("first document");
        upsert_document(&connection, &second_document).expect("second document");
        set_document_favorite_tx(&connection, &first_document.document_key, true).expect("favorite first");
        set_document_favorite_tx(&connection, &second_document.document_key, true).expect("favorite second");
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "机器学习".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("create tag");
        attach_document_tag_tx(&connection, &first_document.document_key, tag.id)
            .expect("attach tag");

        let favorites = list_favorite_documents_tx(&connection).expect("favorites");

        assert_eq!(favorites.len(), 2);
        assert_eq!(favorites[0].document_key, second_document.document_key);
        assert_eq!(favorites[0].tag_ids, Vec::<i64>::new());
        assert_eq!(favorites[0].page_count, second_document.page_count);
        assert!(!favorites[0].missing);
        assert!(favorites[0].last_opened_at.is_some());
        assert_eq!(favorites[1].document_key, first_document.document_key);
        assert_eq!(favorites[1].tag_ids, vec![tag.id]);
        assert_eq!(favorites[1].page_count, first_document.page_count);
        assert_eq!(favorites[1].last_page, first_document.last_page);
        assert_eq!(favorites[1].progress, first_document.progress);
    }
```

- [ ] **Step 2: Run Rust test to verify it fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml marks_and_lists_favorite_documents
```

Expected: FAIL because `FavoriteDocument` does not have `page_count`, `missing`, `last_opened_at`, or `tag_ids` fields yet.

- [ ] **Step 3: Extend TypeScript favorite model**

Replace `src/favorites/favoriteModels.ts` with:

```ts
export type FavoriteDocument = {
  documentKey: string;
  displayName: string;
  path: string | null;
  lastPage: number;
  progress: number;
  pageCount: number | null;
  missing: boolean;
  lastOpenedAt: string | null;
  tagIds: number[];
};
```

- [ ] **Step 4: Extend Rust favorite struct**

In `src-tauri/src/db.rs`, update the `FavoriteDocument` struct to:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteDocument {
    pub document_key: String,
    pub display_name: String,
    pub path: Option<String>,
    pub last_page: i64,
    pub progress: f64,
    pub page_count: Option<i64>,
    pub missing: bool,
    pub last_opened_at: Option<String>,
    pub tag_ids: Vec<i64>,
}
```

- [ ] **Step 5: Update favorite query implementation**

In `src-tauri/src/db.rs`, replace `list_favorite_documents_tx` with:

```rust
pub fn list_favorite_documents_tx(
    connection: &Connection,
) -> Result<Vec<FavoriteDocument>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT document_key, display_name, path, last_page, progress,
               page_count, missing, last_opened_at
        FROM documents
        WHERE favorite = 1
        ORDER BY last_opened_at DESC
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        let document_key: String = row.get(0)?;
        let tag_ids = list_document_tag_ids_tx(connection, &document_key)?;
        Ok(FavoriteDocument {
            document_key,
            display_name: row.get(1)?,
            path: row.get(2)?,
            last_page: row.get(3)?,
            progress: row.get(4)?,
            page_count: row.get(5)?,
            missing: row.get::<_, i64>(6)? == 1,
            last_opened_at: row.get(7)?,
            tag_ids,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}
```

Add this helper near the existing annotation tag helper functions, before `replace_annotation_tag_ids_tx`:

```rust
fn list_document_tag_ids_tx(
    connection: &Connection,
    document_key: &str,
) -> Result<Vec<i64>, rusqlite::Error> {
    let mut statement = connection.prepare(
        "SELECT tag_id FROM document_tags WHERE document_key = ?1 ORDER BY tag_id ASC",
    )?;
    let rows = statement.query_map([document_key], |row| row.get(0))?;

    rows.collect::<Result<Vec<_>, _>>()
}
```

- [ ] **Step 6: Update TypeScript test fixtures that fail compilation**

Run:

```bash
rg -n "FavoriteDocument|favoriteDocuments" src -g '*test*'
```

For each test object typed as `FavoriteDocument`, add the required fields. Use this shape:

```ts
{
  documentKey: 'desktop:/Users/mario/Papers/Attention.pdf',
  displayName: 'Attention.pdf',
  path: '/Users/mario/Papers/Attention.pdf',
  lastPage: 8,
  progress: 0.4,
  pageCount: 20,
  missing: false,
  lastOpenedAt: '2026-07-06T09:30:00+08:00',
  tagIds: [1],
}
```

For browser-upload or pathless fixtures, use:

```ts
pageCount: null,
missing: false,
lastOpenedAt: null,
tagIds: [],
```

- [ ] **Step 7: Run focused Rust and TypeScript checks**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml marks_and_lists_favorite_documents
npm run typecheck
```

Expected: both PASS. If `npm run typecheck` reports additional `FavoriteDocument` fixture errors, update only those fixture objects with the fields from Step 6.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add src/favorites/favoriteModels.ts src-tauri/src/db.rs src
git commit -m "feat: extend favorite document metadata"
```

Expected: commit succeeds. Ensure `git status --short` does not show unrelated files staged.

---

### Task 2: Add Favorite Workspace Pure Helpers

**Files:**
- Create: `src/home/favoriteWorkspaceUtils.ts`
- Create: `src/home/favoriteWorkspaceUtils.test.ts`

- [ ] **Step 1: Create failing helper tests**

Create `src/home/favoriteWorkspaceUtils.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { Tag } from '../tags/tagModels';
import {
  buildFavoriteDirectoryOptions,
  buildFavoriteRecommendations,
  buildFavoriteTagOptions,
  deriveFavoriteOverview,
  filterFavoriteDocuments,
  getFavoriteDirectoryLabel,
  getRecentFavoriteActivity,
  sortFavoriteDocuments,
} from './favoriteWorkspaceUtils';

const tags: Tag[] = [
  {
    id: 1,
    name: 'Transformer',
    color: '#2563eb',
    documentCount: 2,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
  {
    id: 2,
    name: '图神经网络',
    color: '#16a34a',
    documentCount: 1,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
  {
    id: 3,
    name: '未使用标签',
    color: '#64748b',
    documentCount: 0,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
];

const documents: FavoriteDocument[] = [
  {
    documentKey: 'desktop:/Users/mario/Papers/Beta Research.pdf',
    path: '/Users/mario/Papers/Beta Research.pdf',
    displayName: 'Beta Research.pdf',
    pageCount: 100,
    lastPage: 15,
    progress: 0.15,
    missing: false,
    lastOpenedAt: '2026-07-03T09:30:00+08:00',
    tagIds: [1],
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/Alpha Notes.pdf',
    path: '/Users/mario/Archive/Alpha Notes.pdf',
    displayName: 'Alpha Notes.pdf',
    pageCount: 20,
    lastPage: 20,
    progress: 1,
    missing: false,
    lastOpenedAt: '2026-07-05T11:00:00+08:00',
    tagIds: [1, 2],
  },
  {
    documentKey: 'browser:local-upload',
    path: null,
    displayName: 'Local Upload.pdf',
    pageCount: null,
    lastPage: 0,
    progress: 0,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
];

describe('favoriteWorkspaceUtils', () => {
  it('derives directory labels from paths and pathless documents', () => {
    expect(getFavoriteDirectoryLabel(documents[0])).toBe('/Users/mario/Papers');
    expect(getFavoriteDirectoryLabel(documents[2])).toBe('本地浏览器文件');
  });

  it('filters favorites by query, progress, tag, and directory', () => {
    expect(
      filterFavoriteDocuments(documents, {
        query: 'archive',
        progressFilter: 'all',
        tagFilter: 'all',
        directoryFilter: 'all',
      }).map((document) => document.displayName),
    ).toEqual(['Alpha Notes.pdf']);

    expect(
      filterFavoriteDocuments(documents, {
        query: '',
        progressFilter: 'completed',
        tagFilter: 'all',
        directoryFilter: 'all',
      }).map((document) => document.displayName),
    ).toEqual(['Alpha Notes.pdf']);

    expect(
      filterFavoriteDocuments(documents, {
        query: '',
        progressFilter: 'all',
        tagFilter: '2',
        directoryFilter: 'all',
      }).map((document) => document.displayName),
    ).toEqual(['Alpha Notes.pdf']);

    expect(
      filterFavoriteDocuments(documents, {
        query: '',
        progressFilter: 'all',
        tagFilter: 'all',
        directoryFilter: '/Users/mario/Papers',
      }).map((document) => document.displayName),
    ).toEqual(['Beta Research.pdf']);
  });

  it('sorts favorites by recent, name, and progress', () => {
    expect(sortFavoriteDocuments(documents, 'recent').map((document) => document.displayName)).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
      'Local Upload.pdf',
    ]);
    expect(sortFavoriteDocuments(documents, 'name').map((document) => document.displayName)).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
      'Local Upload.pdf',
    ]);
    expect(
      sortFavoriteDocuments(documents, 'progressAsc').map((document) => document.displayName),
    ).toEqual(['Local Upload.pdf', 'Beta Research.pdf', 'Alpha Notes.pdf']);
    expect(
      sortFavoriteDocuments(documents, 'progressDesc').map((document) => document.displayName),
    ).toEqual(['Alpha Notes.pdf', 'Beta Research.pdf', 'Local Upload.pdf']);
  });

  it('builds tag and directory options from real favorite usage', () => {
    expect(buildFavoriteTagOptions(documents, tags)).toEqual([
      { tag: tags[0], count: 2 },
      { tag: tags[1], count: 1 },
    ]);
    expect(buildFavoriteDirectoryOptions(documents)).toEqual([
      { label: '/Users/mario/Archive', count: 1 },
      { label: '/Users/mario/Papers', count: 1 },
      { label: '本地浏览器文件', count: 1 },
    ]);
  });

  it('derives overview, recent activity, and recommendation reasons', () => {
    expect(deriveFavoriteOverview(documents)).toEqual({
      totalCount: 3,
      taggedCount: 2,
      directoryCount: 3,
      averageProgress: 0.38,
      completedRatio: 0.33,
    });
    expect(getRecentFavoriteActivity(documents).map((document) => document.displayName)).toEqual([
      'Alpha Notes.pdf',
      'Beta Research.pdf',
    ]);
    expect(buildFavoriteRecommendations(documents, tags)).toContainEqual({
      documentKey: 'desktop:/Users/mario/Archive/Alpha Notes.pdf',
      title: 'Alpha Notes.pdf',
      reason: '阅读进度已完成，适合作为重点收藏保留。',
    });
  });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
npm test -- favoriteWorkspaceUtils
```

Expected: FAIL because `src/home/favoriteWorkspaceUtils.ts` does not exist.

- [ ] **Step 3: Implement helper module**

Create `src/home/favoriteWorkspaceUtils.ts` with:

```ts
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { Tag } from '../tags/tagModels';

export type FavoriteSortMode = 'recent' | 'name' | 'progressDesc' | 'progressAsc';
export type FavoriteProgressFilter = 'all' | 'notStarted' | 'reading' | 'completed';
export type FavoriteTagFilter = 'all' | `${number}`;
export type FavoriteDirectoryFilter = 'all' | string;

export type FavoriteDocumentFilters = {
  query: string;
  progressFilter: FavoriteProgressFilter;
  tagFilter: FavoriteTagFilter;
  directoryFilter: FavoriteDirectoryFilter;
};

export type FavoriteTagOption = {
  tag: Tag;
  count: number;
};

export type FavoriteDirectoryOption = {
  label: string;
  count: number;
};

export type FavoriteOverview = {
  totalCount: number;
  taggedCount: number;
  directoryCount: number;
  averageProgress: number;
  completedRatio: number;
};

export type FavoriteRecommendation = {
  documentKey: string;
  title: string;
  reason: string;
};

export const localBrowserDirectoryLabel = '本地浏览器文件';

export function getFavoriteDirectoryLabel(document: FavoriteDocument): string {
  if (!document.path) {
    return localBrowserDirectoryLabel;
  }

  const normalizedPath = document.path.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');

  if (lastSlashIndex <= 0) {
    return localBrowserDirectoryLabel;
  }

  return normalizedPath.slice(0, lastSlashIndex);
}

export function filterFavoriteDocuments(
  documents: FavoriteDocument[],
  filters: FavoriteDocumentFilters,
): FavoriteDocument[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return documents.filter((document) => {
    const directory = getFavoriteDirectoryLabel(document);
    const matchesQuery =
      normalizedQuery.length === 0 ||
      document.displayName.toLowerCase().includes(normalizedQuery) ||
      (document.path ?? '').toLowerCase().includes(normalizedQuery) ||
      directory.toLowerCase().includes(normalizedQuery);

    if (!matchesQuery) {
      return false;
    }

    if (filters.progressFilter === 'notStarted' && document.progress > 0) {
      return false;
    }

    if (
      filters.progressFilter === 'reading' &&
      (document.progress <= 0 || document.progress >= 1)
    ) {
      return false;
    }

    if (filters.progressFilter === 'completed' && document.progress < 1) {
      return false;
    }

    if (filters.tagFilter !== 'all' && !document.tagIds.includes(Number(filters.tagFilter))) {
      return false;
    }

    if (filters.directoryFilter !== 'all' && directory !== filters.directoryFilter) {
      return false;
    }

    return true;
  });
}

export function sortFavoriteDocuments(
  documents: FavoriteDocument[],
  sortMode: FavoriteSortMode,
): FavoriteDocument[] {
  return [...documents].sort((first, second) => {
    if (sortMode === 'name') {
      return first.displayName.localeCompare(second.displayName, 'zh-Hans-CN');
    }

    if (sortMode === 'progressDesc') {
      return second.progress - first.progress;
    }

    if (sortMode === 'progressAsc') {
      return first.progress - second.progress;
    }

    const firstTime = first.lastOpenedAt ? Date.parse(first.lastOpenedAt) : 0;
    const secondTime = second.lastOpenedAt ? Date.parse(second.lastOpenedAt) : 0;
    return secondTime - firstTime;
  });
}

export function buildFavoriteTagOptions(
  documents: FavoriteDocument[],
  tags: Tag[],
): FavoriteTagOption[] {
  const counts = new Map<number, number>();

  for (const document of documents) {
    for (const tagId of document.tagIds) {
      counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    }
  }

  return tags
    .map((tag) => ({ tag, count: counts.get(tag.id) ?? 0 }))
    .filter((option) => option.count > 0)
    .sort((first, second) => second.count - first.count || first.tag.name.localeCompare(second.tag.name));
}

export function buildFavoriteDirectoryOptions(
  documents: FavoriteDocument[],
): FavoriteDirectoryOption[] {
  const counts = new Map<string, number>();

  for (const document of documents) {
    const directory = getFavoriteDirectoryLabel(document);
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((first, second) => first.label.localeCompare(second.label, 'zh-Hans-CN'));
}

export function deriveFavoriteOverview(documents: FavoriteDocument[]): FavoriteOverview {
  const totalCount = documents.length;
  const taggedCount = documents.filter((document) => document.tagIds.length > 0).length;
  const directoryCount = buildFavoriteDirectoryOptions(documents).length;
  const averageProgress =
    totalCount === 0
      ? 0
      : roundRatio(documents.reduce((sum, document) => sum + document.progress, 0) / totalCount);
  const completedRatio =
    totalCount === 0
      ? 0
      : roundRatio(documents.filter((document) => document.progress >= 1).length / totalCount);

  return {
    totalCount,
    taggedCount,
    directoryCount,
    averageProgress,
    completedRatio,
  };
}

export function getRecentFavoriteActivity(documents: FavoriteDocument[]): FavoriteDocument[] {
  return sortFavoriteDocuments(
    documents.filter((document) => document.lastOpenedAt),
    'recent',
  ).slice(0, 3);
}

export function buildFavoriteRecommendations(
  documents: FavoriteDocument[],
  tags: Tag[],
): FavoriteRecommendation[] {
  const tagOptions = buildFavoriteTagOptions(documents, tags);
  const popularTagIds = new Set(
    tagOptions.filter((option) => option.count >= 2).map((option) => option.tag.id),
  );
  const recommendations: FavoriteRecommendation[] = [];

  for (const document of documents) {
    if (recommendations.length >= 3) {
      break;
    }

    if (document.progress >= 1) {
      recommendations.push({
        documentKey: document.documentKey,
        title: document.displayName,
        reason: '阅读进度已完成，适合作为重点收藏保留。',
      });
      continue;
    }

    if (document.tagIds.some((tagId) => popularTagIds.has(tagId))) {
      recommendations.push({
        documentKey: document.documentKey,
        title: document.displayName,
        reason: '与多个同标签收藏相关，适合后续集中阅读。',
      });
    }
  }

  return recommendations;
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}
```

- [ ] **Step 4: Run helper tests to verify pass**

Run:

```bash
npm test -- favoriteWorkspaceUtils
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/home/favoriteWorkspaceUtils.ts src/home/favoriteWorkspaceUtils.test.ts
git commit -m "feat: add favorite workspace helpers"
```

Expected: commit succeeds.

---

### Task 3: Build Favorite Workspace Component

**Files:**
- Create: `src/home/HomeFavoriteFilesWorkspace.tsx`
- Create: `src/home/HomeFavoriteFilesWorkspace.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Create failing component tests**

Create `src/home/HomeFavoriteFilesWorkspace.test.tsx` with:

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { Tag } from '../tags/tagModels';
import { renderApp } from '../test/renderApp';
import { HomeFavoriteFilesWorkspace } from './HomeFavoriteFilesWorkspace';

const tags: Tag[] = [
  {
    id: 1,
    name: 'Transformer',
    color: '#2563eb',
    documentCount: 2,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
  {
    id: 2,
    name: '图神经网络',
    color: '#16a34a',
    documentCount: 1,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00+08:00',
    updatedAt: '2026-07-01T00:00:00+08:00',
  },
];

const documents: FavoriteDocument[] = [
  {
    documentKey: 'desktop:/Users/mario/Papers/Beta Research.pdf',
    path: '/Users/mario/Papers/Beta Research.pdf',
    displayName: 'Beta Research.pdf',
    pageCount: 100,
    lastPage: 15,
    progress: 0.15,
    missing: false,
    lastOpenedAt: '2026-07-03T09:30:00+08:00',
    tagIds: [1],
  },
  {
    documentKey: 'desktop:/Users/mario/Archive/Alpha Notes.pdf',
    path: '/Users/mario/Archive/Alpha Notes.pdf',
    displayName: 'Alpha Notes.pdf',
    pageCount: 20,
    lastPage: 20,
    progress: 1,
    missing: false,
    lastOpenedAt: '2026-07-05T11:00:00+08:00',
    tagIds: [1, 2],
  },
  {
    documentKey: 'browser:local-upload',
    path: null,
    displayName: 'Local Upload.pdf',
    pageCount: null,
    lastPage: 0,
    progress: 0,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
];

function renderWorkspace(overrides: Partial<ComponentProps<typeof HomeFavoriteFilesWorkspace>> = {}) {
  const props: ComponentProps<typeof HomeFavoriteFilesWorkspace> = {
    documents,
    tags,
    onOpenPdf: vi.fn(),
    onOpenDocument: vi.fn(),
    onToggleFavorite: vi.fn(),
    onLocateFile: vi.fn(),
    onOpenTags: vi.fn(),
    ...overrides,
  };

  renderApp(<HomeFavoriteFilesWorkspace {...props} />);

  return props;
}

function listedNames() {
  return screen
    .getAllByTestId('favorite-workspace-document')
    .map((element) => within(element).getByTestId('favorite-workspace-document-name').textContent);
}

describe('HomeFavoriteFilesWorkspace', () => {
  it('renders favorites in card view with overview and real tag stats', () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: '收藏文件' })).toBeInTheDocument();
    expect(screen.getByText('共 3 个收藏，当前显示 3 个')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索收藏文件' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '排序方式' })).toHaveValue('recent');
    expect(screen.getByRole('combobox', { name: '阅读进度筛选' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: '标签筛选' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: '目录筛选' })).toHaveValue('all');
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(listedNames()).toEqual(['Alpha Notes.pdf', 'Beta Research.pdf', 'Local Upload.pdf']);
    expect(screen.getByText('收藏概览')).toBeInTheDocument();
    expect(screen.getByText('常用标签')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '按标签筛选 Transformer' })).toBeInTheDocument();
  });

  it('searches and clears filters without changing view mode', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏文件' }), {
      target: { value: 'archive' },
    });

    expect(screen.getByText('共 3 个收藏，当前显示 1 个')).toBeInTheDocument();
    expect(listedNames()).toEqual(['Alpha Notes.pdf']);

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));

    expect(screen.getByRole('searchbox', { name: '搜索收藏文件' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('共 3 个收藏，当前显示 3 个')).toBeInTheDocument();
  });

  it('filters by progress, tag, and directory', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('combobox', { name: '阅读进度筛选' }), {
      target: { value: 'completed' },
    });
    expect(listedNames()).toEqual(['Alpha Notes.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '阅读进度筛选' }), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '标签筛选' }), {
      target: { value: '2' },
    });
    expect(listedNames()).toEqual(['Alpha Notes.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '标签筛选' }), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '目录筛选' }), {
      target: { value: '/Users/mario/Papers' },
    });
    expect(listedNames()).toEqual(['Beta Research.pdf']);
  });

  it('sorts by name and progress', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('combobox', { name: '排序方式' }), {
      target: { value: 'progressAsc' },
    });
    expect(listedNames()).toEqual(['Local Upload.pdf', 'Beta Research.pdf', 'Alpha Notes.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '排序方式' }), {
      target: { value: 'name' },
    });
    expect(listedNames()).toEqual(['Alpha Notes.pdf', 'Beta Research.pdf', 'Local Upload.pdf']);
  });

  it('wires continue reading, favorite toggle, tag click, and locate menu actions', () => {
    const props = renderWorkspace();

    fireEvent.click(within(screen.getAllByTestId('favorite-workspace-document')[0]).getByRole('button', { name: '继续阅读 Alpha Notes.pdf' }));
    expect(props.onOpenDocument).toHaveBeenCalledWith(documents[1]);

    fireEvent.click(within(screen.getAllByTestId('favorite-workspace-document')[0]).getByRole('button', { name: '取消收藏 Alpha Notes.pdf' }));
    expect(props.onToggleFavorite).toHaveBeenCalledWith('desktop:/Users/mario/Archive/Alpha Notes.pdf', false);

    fireEvent.click(screen.getByRole('button', { name: '按标签筛选 Transformer' }));
    expect(screen.getByRole('combobox', { name: '标签筛选' })).toHaveValue('1');

    fireEvent.click(within(screen.getAllByTestId('favorite-workspace-document')[0]).getByRole('button', { name: '更多操作 Alpha Notes.pdf' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '定位文件' }));
    expect(props.onLocateFile).toHaveBeenCalledWith(documents[1]);
  });

  it('shows empty, no-result, and recommendation empty states', () => {
    const props = renderWorkspace({ documents: [] });

    expect(screen.getByText('暂无收藏文件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    expect(props.onOpenPdf).toHaveBeenCalledTimes(1);

    renderWorkspace({ documents: [documents[2]], tags: [] });
    expect(screen.getByText('暂无可用推荐理由')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏文件' }), {
      target: { value: 'does-not-exist' },
    });
    expect(screen.getByText('没有匹配的收藏文件')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run component tests to verify they fail**

Run:

```bash
npm test -- HomeFavoriteFilesWorkspace
```

Expected: FAIL because `HomeFavoriteFilesWorkspace` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/home/HomeFavoriteFilesWorkspace.tsx` with this implementation. If TypeScript reports an icon name mismatch for `Grid2X2`, mirror the exact import used by `HomeRecentFilesWorkspace.tsx` in this checkout.

```tsx
import { FileText, Grid2X2, List, MoreVertical, Search, Star, Tags } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import type { Tag } from '../tags/tagModels';
import { formatDateTime, formatProgressPercent } from './homeDisplayUtils';
import {
  buildFavoriteDirectoryOptions,
  buildFavoriteRecommendations,
  buildFavoriteTagOptions,
  deriveFavoriteOverview,
  filterFavoriteDocuments,
  getFavoriteDirectoryLabel,
  getRecentFavoriteActivity,
  sortFavoriteDocuments,
  type FavoriteDirectoryFilter,
  type FavoriteProgressFilter,
  type FavoriteSortMode,
  type FavoriteTagFilter,
} from './favoriteWorkspaceUtils';

type ViewMode = 'cards' | 'list';

type HomeFavoriteFilesWorkspaceProps = {
  documents: FavoriteDocument[];
  tags: Tag[];
  onOpenPdf(): void | Promise<unknown>;
  onOpenDocument(document: FavoriteDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onLocateFile(document: FavoriteDocument): void | Promise<void>;
  onOpenTags(): void;
};

export function HomeFavoriteFilesWorkspace({
  documents,
  tags,
  onOpenPdf,
  onOpenDocument,
  onToggleFavorite,
  onLocateFile,
  onOpenTags,
}: HomeFavoriteFilesWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<FavoriteSortMode>('recent');
  const [progressFilter, setProgressFilter] = useState<FavoriteProgressFilter>('all');
  const [tagFilter, setTagFilter] = useState<FavoriteTagFilter>('all');
  const [directoryFilter, setDirectoryFilter] = useState<FavoriteDirectoryFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuItemRefs = useRef(new Map<string, Array<HTMLButtonElement | null>>());

  const tagOptions = useMemo(() => buildFavoriteTagOptions(documents, tags), [documents, tags]);
  const directoryOptions = useMemo(() => buildFavoriteDirectoryOptions(documents), [documents]);
  const visibleDocuments = useMemo(() => {
    const filteredDocuments = filterFavoriteDocuments(documents, {
      query,
      progressFilter,
      tagFilter,
      directoryFilter,
    });

    return sortFavoriteDocuments(filteredDocuments, sortMode);
  }, [directoryFilter, documents, progressFilter, query, sortMode, tagFilter]);
  const overview = useMemo(() => deriveFavoriteOverview(documents), [documents]);
  const recentActivity = useMemo(() => getRecentFavoriteActivity(documents), [documents]);
  const recommendations = useMemo(
    () => buildFavoriteRecommendations(documents, tags),
    [documents, tags],
  );
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const clearFilters = () => {
    setQuery('');
    setSortMode('recent');
    setProgressFilter('all');
    setTagFilter('all');
    setDirectoryFilter('all');
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  useEffect(() => {
    if (!openMenuKey) {
      return;
    }

    menuItemRefs.current.get(openMenuKey)?.[0]?.focus();
  }, [openMenuKey]);

  const closeMenu = () => setOpenMenuKey(null);

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

  const renderDocument = (document: FavoriteDocument) => {
    const progressPercent = formatProgressPercent(document.progress);
    const directory = getFavoriteDirectoryLabel(document);
    const menuOpen = openMenuKey === document.documentKey;

    return (
      <article
        key={document.documentKey}
        className={viewMode === 'cards' ? 'favorite-workspace-card' : 'favorite-workspace-row'}
        data-testid="favorite-workspace-document"
      >
        <div className="favorite-workspace-file-main">
          <span className="pdf-file-icon" aria-hidden="true">
            <FileText size={16} />
          </span>
          <div>
            <strong data-testid="favorite-workspace-document-name" title={document.displayName}>
              {document.displayName}
            </strong>
            <span title={document.path ?? directory}>{directory}</span>
          </div>
        </div>
        <div className="favorite-workspace-meta">
          <span>{document.lastOpenedAt ? formatDateTime(document.lastOpenedAt) : '最近打开时间未知'}</span>
          <span>
            {document.pageCount ? `${document.lastPage} / ${document.pageCount} 页` : `第 ${document.lastPage} 页`}
          </span>
        </div>
        <div className="favorite-workspace-progress">
          <span>阅读进度</span>
          <div className="recent-progress" aria-label={`阅读进度 ${progressPercent}`}>
            <span style={{ width: progressPercent }} />
          </div>
          <strong>{progressPercent}</strong>
        </div>
        <div className="favorite-workspace-tags" aria-label={`${document.displayName} 标签`}>
          {document.tagIds.length > 0 ? (
            document.tagIds.map((tagId) => {
              const tag = tagsById.get(tagId);
              return tag ? (
                <button
                  type="button"
                  key={tag.id}
                  className="favorite-tag-chip"
                  style={{ borderColor: tag.color, color: tag.color }}
                  onClick={() => setTagFilter(`${tag.id}`)}
                >
                  {tag.name}
                </button>
              ) : null;
            })
          ) : (
            <span>暂无标签</span>
          )}
        </div>
        <div className="favorite-workspace-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void onOpenDocument(document)}
          >
            继续阅读 {document.displayName}
          </button>
          <button
            type="button"
            className="icon-button active"
            aria-label={`取消收藏 ${document.displayName}`}
            aria-pressed="true"
            onClick={() => void onToggleFavorite(document.documentKey, false)}
          >
            <Star size={16} fill="currentColor" />
          </button>
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
                  onClick={() => handleMenuAction(() => onOpenDocument(document))}
                >
                  打开
                </button>
                <button
                  type="button"
                  ref={(element) => setMenuItemRef(document.documentKey, 1, element)}
                  role="menuitem"
                  onClick={() =>
                    handleMenuAction(() => onToggleFavorite(document.documentKey, false))
                  }
                >
                  取消收藏
                </button>
                <button
                  type="button"
                  ref={(element) => setMenuItemRef(document.documentKey, 2, element)}
                  role="menuitem"
                  onClick={() => handleMenuAction(() => onLocateFile(document))}
                >
                  定位文件
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="favorite-workspace-layout">
      <section className="home-panel favorite-workspace" aria-labelledby="favorite-workspace-title">
        <div className="section-heading horizontal recent-workspace-heading">
          <div>
            <p>文档管理</p>
            <h2 id="favorite-workspace-title">收藏文件</h2>
            <span>集中管理已收藏的本地 PDF。</span>
          </div>
          <span className="recent-workspace-count">
            共 {documents.length} 个收藏，当前显示 {visibleDocuments.length} 个
          </span>
        </div>

        {documents.length > 0 ? (
          <>
            <div className="favorite-workspace-toolbar">
              <label className="recent-workspace-search">
                <span>搜索收藏文件</span>
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  aria-label="搜索收藏文件"
                  placeholder="搜索文件名、路径或目录..."
                  onChange={handleQueryChange}
                />
              </label>
              <label>
                <span>排序方式</span>
                <select
                  value={sortMode}
                  aria-label="排序方式"
                  onChange={(event) => setSortMode(event.target.value as FavoriteSortMode)}
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
                  onChange={(event) =>
                    setProgressFilter(event.target.value as FavoriteProgressFilter)
                  }
                >
                  <option value="all">全部进度</option>
                  <option value="notStarted">未开始</option>
                  <option value="reading">阅读中</option>
                  <option value="completed">已读完</option>
                </select>
              </label>
              <label>
                <span>标签筛选</span>
                <select
                  value={tagFilter}
                  aria-label="标签筛选"
                  onChange={(event) => setTagFilter(event.target.value as FavoriteTagFilter)}
                >
                  <option value="all">全部标签</option>
                  {tagOptions.map((option) => (
                    <option key={option.tag.id} value={`${option.tag.id}`}>
                      {option.tag.name}（{option.count}）
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>目录筛选</span>
                <select
                  value={directoryFilter}
                  aria-label="目录筛选"
                  onChange={(event) =>
                    setDirectoryFilter(event.target.value as FavoriteDirectoryFilter)
                  }
                >
                  <option value="all">全部目录</option>
                  {directoryOptions.map((option) => (
                    <option key={option.label} value={option.label}>
                      {option.label}（{option.count}）
                    </option>
                  ))}
                </select>
              </label>
              <div className="recent-workspace-view-toggle" aria-label="显示方式">
                <button
                  type="button"
                  className="icon-text-button"
                  aria-pressed={viewMode === 'cards'}
                  onClick={() => setViewMode('cards')}
                >
                  <Grid2X2 size={16} />
                  卡片视图
                </button>
                <button
                  type="button"
                  className="icon-text-button"
                  aria-pressed={viewMode === 'list'}
                  onClick={() => setViewMode('list')}
                >
                  <List size={16} />
                  列表视图
                </button>
              </div>
              <button type="button" className="text-link-button" onClick={clearFilters}>
                清除筛选
              </button>
            </div>

            {visibleDocuments.length > 0 ? (
              <div
                className={viewMode === 'cards' ? 'favorite-workspace-grid' : 'favorite-workspace-list'}
                data-testid="favorite-workspace-results"
              >
                {visibleDocuments.map(renderDocument)}
              </div>
            ) : (
              <div className="empty-block recent-workspace-empty">
                <strong>没有匹配的收藏文件</strong>
                <span>调整搜索、标签、目录或阅读状态筛选后再试。</span>
                <button type="button" className="secondary-button" onClick={clearFilters}>
                  清除筛选
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="empty-block recent-workspace-empty">
            <strong>暂无收藏文件</strong>
            <span>收藏 PDF 后会显示在这里。</span>
            <button type="button" className="primary-button" onClick={() => void onOpenPdf()}>
              打开文件
            </button>
          </div>
        )}
      </section>

      <aside className="favorite-workspace-aside" aria-label="收藏文件辅助信息">
        <section className="favorite-insight-card">
          <h3>收藏概览</h3>
          <div className="favorite-overview-grid">
            <span><strong>{overview.totalCount}</strong>收藏文件</span>
            <span><strong>{overview.taggedCount}</strong>有标签</span>
            <span><strong>{overview.directoryCount}</strong>目录</span>
            <span><strong>{Math.round(overview.completedRatio * 100)}%</strong>已读完</span>
          </div>
          <p>平均阅读进度 {Math.round(overview.averageProgress * 100)}%</p>
        </section>

        <section className="favorite-insight-card">
          <div className="favorite-insight-heading">
            <h3>常用标签</h3>
            <button type="button" className="text-link-button" onClick={onOpenTags}>
              管理标签
            </button>
          </div>
          {tagOptions.length > 0 ? (
            <div className="favorite-tag-list">
              {tagOptions.map((option) => (
                <button
                  key={option.tag.id}
                  type="button"
                  aria-label={`按标签筛选 ${option.tag.name}`}
                  onClick={() => setTagFilter(`${option.tag.id}`)}
                >
                  <span style={{ color: option.tag.color }}>{option.tag.name}</span>
                  <strong>{option.count}</strong>
                </button>
              ))}
            </div>
          ) : (
            <p>暂无标签，前往标签管理后可用于筛选收藏文件。</p>
          )}
        </section>

        <section className="favorite-insight-card">
          <h3>最近打开的收藏</h3>
          {recentActivity.length > 0 ? (
            <ol className="favorite-activity-list">
              {recentActivity.map((document) => (
                <li key={document.documentKey}>
                  <strong>{document.displayName}</strong>
                  <span>{document.lastOpenedAt ? formatDateTime(document.lastOpenedAt) : '时间未知'}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>暂无最近打开记录。</p>
          )}
        </section>

        <section className="favorite-insight-card">
          <h3>智能推荐收藏理由</h3>
          {recommendations.length > 0 ? (
            <ul className="favorite-recommendation-list">
              {recommendations.map((recommendation) => (
                <li key={recommendation.documentKey}>
                  <Tags size={14} aria-hidden="true" />
                  <span>{recommendation.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>暂无可用推荐理由</p>
          )}
        </section>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Add component styles**

Append these styles near the existing recent workspace CSS in `src/app/styles.css`:

```css
.favorite-workspace-layout {
  align-items: start;
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 300px);
  width: 100%;
}

.favorite-workspace,
.favorite-workspace-aside {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.favorite-workspace-toolbar {
  align-items: end;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(220px, 1.4fr) repeat(4, minmax(130px, 0.7fr)) auto auto;
}

.favorite-workspace-toolbar label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.favorite-workspace-toolbar label > span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.favorite-workspace-toolbar input,
.favorite-workspace-toolbar select {
  background: #ffffff;
  border: 1px solid #dbe4f0;
  border-radius: 8px;
  color: #0f172a;
  min-height: 38px;
  padding: 0 12px;
}

.favorite-workspace-grid,
.favorite-workspace-list {
  display: grid;
  gap: 12px;
}

.favorite-workspace-grid {
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

.favorite-workspace-card,
.favorite-workspace-row {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  display: grid;
  gap: 14px;
  padding: 14px;
}

.favorite-workspace-row {
  align-items: center;
  grid-template-columns: minmax(220px, 1.6fr) minmax(150px, 0.8fr) minmax(150px, 0.8fr) minmax(120px, 0.7fr) auto;
}

.favorite-workspace-file-main {
  align-items: center;
  display: flex;
  gap: 10px;
  min-width: 0;
}

.favorite-workspace-file-main > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.favorite-workspace-file-main strong,
.favorite-workspace-file-main span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-workspace-file-main span:last-child,
.favorite-workspace-meta,
.favorite-workspace-tags span {
  color: #64748b;
  font-size: 12px;
}

.favorite-workspace-meta,
.favorite-workspace-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.favorite-workspace-progress > span,
.favorite-workspace-progress strong {
  color: #64748b;
  font-size: 12px;
}

.favorite-workspace-tags {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.favorite-tag-chip {
  background: #ffffff;
  border: 1px solid currentColor;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
  padding: 3px 8px;
}

.favorite-workspace-actions {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.favorite-insight-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.favorite-insight-card h3 {
  font-size: 14px;
  margin: 0;
}

.favorite-insight-card p {
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
}

.favorite-insight-heading {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.favorite-overview-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.favorite-overview-grid span {
  color: #64748b;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  gap: 2px;
}

.favorite-overview-grid strong {
  color: #2563eb;
  font-size: 20px;
}

.favorite-tag-list,
.favorite-activity-list,
.favorite-recommendation-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.favorite-tag-list button {
  align-items: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  min-height: 34px;
  padding: 0 10px;
}

.favorite-activity-list li {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.favorite-activity-list strong,
.favorite-recommendation-list span {
  color: #334155;
  font-size: 12px;
}

.favorite-activity-list span {
  color: #64748b;
  font-size: 12px;
}

.favorite-recommendation-list li {
  align-items: flex-start;
  color: #16a34a;
  display: flex;
  gap: 6px;
}

@media (max-width: 1180px) {
  .favorite-workspace-layout {
    grid-template-columns: 1fr;
  }

  .favorite-workspace-toolbar {
    grid-template-columns: repeat(2, minmax(180px, 1fr));
  }

  .favorite-workspace-row {
    grid-template-columns: minmax(220px, 1fr) minmax(160px, 0.6fr);
  }

  .favorite-workspace-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .favorite-workspace-toolbar {
    grid-template-columns: 1fr;
  }

  .favorite-workspace-row {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .favorite-workspace-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run component tests**

Run:

```bash
npm test -- HomeFavoriteFilesWorkspace
```

Expected: PASS. If the test fails because `getByRole('button', { name: '继续阅读 Alpha Notes.pdf' })` cannot find the button, change the button to include `aria-label={`继续阅读 ${document.displayName}`}` while keeping visible text `继续阅读`.

- [ ] **Step 6: Run helper tests again**

Run:

```bash
npm test -- favoriteWorkspaceUtils HomeFavoriteFilesWorkspace
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/home/HomeFavoriteFilesWorkspace.tsx src/home/HomeFavoriteFilesWorkspace.test.tsx src/app/styles.css
git commit -m "feat: build favorite files workspace"
```

Expected: commit succeeds.

---

### Task 4: Wire Favorite Workspace Into Dashboard

**Files:**
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`

- [ ] **Step 1: Add failing dashboard test**

In `src/home/HomeDashboard.test.tsx`, find the existing helper `renderDashboard`. Add or update a test in the main `HomeDashboard` describe block:

```tsx
  it('renders the favorite files workspace from the sidebar page', () => {
    renderDashboard({
      activeSidebarPage: 'favoriteFiles',
      favoriteDocuments: [
        {
          documentKey: 'desktop:/Users/mario/Papers/Favorite.pdf',
          displayName: 'Favorite.pdf',
          path: '/Users/mario/Papers/Favorite.pdf',
          lastPage: 4,
          progress: 0.4,
          pageCount: 10,
          missing: false,
          lastOpenedAt: '2026-07-06T10:00:00+08:00',
          tagIds: [],
        },
      ],
    });

    expect(screen.getByRole('heading', { name: '收藏文件' })).toBeInTheDocument();
    expect(screen.getByText('共 1 个收藏，当前显示 1 个')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '收藏文件' })).not.toBeInTheDocument();
    expect(screen.getByTestId('favorite-workspace-document-name')).toHaveTextContent('Favorite.pdf');
  });
```

If `renderDashboard` does not accept `activeSidebarPage` or `favoriteDocuments` overrides exactly this way, adapt only the helper call shape to the existing helper signature. Keep the assertions unchanged.

- [ ] **Step 2: Run dashboard test to verify it fails**

Run:

```bash
npm test -- HomeDashboard --runInBand
```

Expected: FAIL because `favoriteFiles` still renders `HomeBlankPage` instead of `HomeFavoriteFilesWorkspace`.

- [ ] **Step 3: Wire component in HomeDashboard**

In `src/home/HomeDashboard.tsx`:

Add import:

```ts
import { HomeFavoriteFilesWorkspace } from './HomeFavoriteFilesWorkspace';
```

Add a `favoriteFilesContent` constant after `recentFilesContent`:

```tsx
  const favoriteFilesContent = (
    <div className="home-content home-blank-content">
      <HomeFavoriteFilesWorkspace
        documents={favoriteDocuments}
        tags={[]}
        onOpenPdf={handleOpenPdf}
        onOpenDocument={handleOpenFavoriteDocument}
        onToggleFavorite={onToggleFavorite}
        onLocateFile={() =>
          showNotice('定位文件功能待补充', '定位文件将在最近文件管理功能中补充。')
        }
        onOpenTags={onOpenTags}
      />
    </div>
  );
```

Then change `mainContent` to:

```tsx
  const mainContent =
    activeSidebarPage === 'recentFiles' ? (
      recentFilesContent
    ) : activeSidebarPage === 'favoriteFiles' ? (
      favoriteFilesContent
    ) : isHomeBlankPageId(activeSidebarPage) ? (
      <div className="home-content home-blank-content">
        <HomeBlankPage page={activeSidebarPage} />
      </div>
    ) : (
      homeContent
    );
```

This temporary `tags={[]}` will be replaced in Task 5 by a real prop from `ReaderWorkspaceSwitch`/`ReaderApp`. Keep it temporary only within this task so the page route can be tested independently.

- [ ] **Step 4: Run dashboard test**

Run:

```bash
npm test -- HomeDashboard
```

Expected: PASS for the new test and existing dashboard tests. If the new assertion using `queryByRole('region', { name: '收藏文件' })` is brittle because the new workspace section is a region, replace that assertion with:

```ts
expect(screen.queryByText('SmartReader')).not.toBeInTheDocument();
```

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx
git commit -m "feat: route favorite files workspace"
```

Expected: commit succeeds.

---

### Task 5: Pass Real Tags Into Favorite Workspace

**Files:**
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/app/ReaderWorkspaceSwitch.tsx`
- Modify: `src/app/ReaderApp.tsx` if required by prop plumbing
- Modify: `src/app/ReaderWorkspaceSwitch.test.tsx` if existing props require updates

- [ ] **Step 1: Update props types for tags**

In `src/home/HomeDashboard.tsx`, import `Tag`:

```ts
import type { Tag } from '../tags/tagModels';
```

Add to `HomeDashboardProps`:

```ts
  availableTags?: Tag[];
```

In the function parameter list, default it:

```ts
  availableTags = [],
```

Replace `tags={[]}` in `favoriteFilesContent` with:

```tsx
        tags={availableTags}
```

- [ ] **Step 2: Pass tags from ReaderWorkspaceSwitch**

In `src/app/ReaderWorkspaceSwitch.tsx`, locate the `<HomeDashboard ... />` props. Add:

```tsx
          availableTags={availableTags}
```

`ReaderWorkspaceSwitch` already receives `availableTags` for `TagManager`, so no new top-level app state should be needed.

- [ ] **Step 3: Add or update test coverage**

If `src/app/ReaderWorkspaceSwitch.test.tsx` has a default props factory, ensure it includes `availableTags: []`. Add this test if there is already a render helper for `ReaderWorkspaceSwitch` home state:

```tsx
it('passes available tags to the favorite files workspace', () => {
  renderWorkspaceSwitch({
    activeWorkspace: 'home',
    activeSidebarPage: 'favoriteFiles',
    favoriteDocuments: [
      {
        documentKey: 'desktop:/Users/mario/Papers/Favorite.pdf',
        displayName: 'Favorite.pdf',
        path: '/Users/mario/Papers/Favorite.pdf',
        lastPage: 4,
        progress: 0.4,
        pageCount: 10,
        missing: false,
        lastOpenedAt: '2026-07-06T10:00:00+08:00',
        tagIds: [1],
      },
    ],
    availableTags: [
      {
        id: 1,
        name: 'Transformer',
        color: '#2563eb',
        documentCount: 1,
        annotationCount: 0,
        createdAt: '2026-07-01T00:00:00+08:00',
        updatedAt: '2026-07-01T00:00:00+08:00',
      },
    ],
  });

  expect(screen.getByRole('button', { name: '按标签筛选 Transformer' })).toBeInTheDocument();
});
```

If the existing `ReaderWorkspaceSwitch` test helper uses a different name than `renderWorkspaceSwitch`, adapt only that helper name and prop names to the existing file. Do not create a large new harness.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- HomeDashboard ReaderWorkspaceSwitch HomeFavoriteFilesWorkspace
```

Expected: PASS. If `ReaderWorkspaceSwitch` tests are too coupled and the new test is expensive to fit, keep the `HomeDashboard` test for tag rendering instead by rendering `HomeDashboard` with `availableTags` and asserting `按标签筛选 Transformer`.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add src/home/HomeDashboard.tsx src/app/ReaderWorkspaceSwitch.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/home/HomeDashboard.test.tsx
git commit -m "feat: pass tags to favorite workspace"
```

Expected: commit succeeds. If a listed test file was not changed, omit it from `git add`.

---

### Task 6: Final Verification And Cleanup

**Files:**
- Modify only files with failing tests caused by this feature.
- Do not change implementation behavior beyond fixing verified failures.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
npm test -- favoriteWorkspaceUtils HomeFavoriteFilesWorkspace HomeDashboard persistenceApi globalSearch
```

Expected: PASS.

- [ ] **Step 2: Run focused Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml marks_and_lists_favorite_documents
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If it fails only because additional `FavoriteDocument` test fixtures lack new fields, update those fixtures with:

```ts
pageCount: null,
missing: false,
lastOpenedAt: null,
tagIds: [],
```

- [ ] **Step 4: Run full frontend test suite**

Run:

```bash
npm test
```

Expected: PASS. Do not fix unrelated failures; if a failure is unrelated, document the exact failing test and error in the final response.

- [ ] **Step 5: Run full Rust test suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. Do not fix unrelated failures; if a failure is unrelated, document the exact failing test and error in the final response.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
git diff -- src/home/HomeFavoriteFilesWorkspace.tsx src/home/favoriteWorkspaceUtils.ts src/home/HomeDashboard.tsx src/favorites/favoriteModels.ts src-tauri/src/db.rs | sed -n '1,260p'
```

Expected: only feature-related files changed; no existing migration files changed.

- [ ] **Step 7: Commit final fixes if needed**

If Step 1-6 required additional fixes after Task 5, commit them:

```bash
git add src src-tauri/src/db.rs
git commit -m "test: verify favorite files workspace"
```

If there were no additional changes, do not create an empty commit.

---

## Self-Review Notes

Spec coverage mapping:

- Blank `favoriteFiles` page replacement: Task 4.
- Extended favorite model and real tag IDs: Task 1.
- Main list, card/list views, filters, sorting, menus, empty states: Task 3.
- Pure filtering/statistics/recommendation logic: Task 2.
- Real tags in right rail and tag filter: Task 5.
- No fake activity/recommendation data: Task 2 and Task 3.
- No migration changes: Task 1 explicitly uses existing schema.
- Testing and verification: Tasks 1-6.

No placeholders are intentionally left in this plan. If implementation discovers an exact helper/test harness name differs from the examples, adapt only the local helper call shape and keep the specified behavior/assertions.
