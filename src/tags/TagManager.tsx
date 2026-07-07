import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import type { PersistenceApi } from '../persistence/persistenceApi';
import type { Tag, TagDashboard, TagDashboardTagRow } from './tagModels';
import { TagCreateEditDialog } from './TagCreateEditDialog';
import { TagCloudPanel } from './TagCloudPanel';
import { TagDashboardToolbar } from './TagDashboardToolbar';
import { TagDetailsPanel } from './TagDetailsPanel';
import {
  filterTagRows,
  getDefaultTagId,
  paginateTagRows,
  sortTagRows,
  type TagSortKey,
} from './tagDashboardUtils';
import { TagOverviewCards } from './TagOverviewCards';
import { TagTable } from './TagTable';

type TagManagerProps = {
  persistence: Pick<
    PersistenceApi,
    'loadTagDashboard' | 'createTag' | 'renameTag' | 'deleteTag' | 'mergeTags'
  >;
  onTagsChange: Dispatch<SetStateAction<Tag[]>>;
  onClose(): void;
  onOpenDocument(
    documentKey: string,
    documentPath: string | null,
    page: number,
    missing: boolean,
  ): void;
};

export function TagManager({ persistence, onTagsChange, onClose, onOpenDocument }: TagManagerProps) {
  const [dashboard, setDashboard] = useState<TagDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState('all');
  const [sortKey, setSortKey] = useState<TagSortKey>('usage');
  const [page, setPage] = useState(1);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | 'merge' | null>(null);
  const [dialogTag, setDialogTag] = useState<TagDashboardTagRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const pageSize = 10;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextDashboard = await persistence.loadTagDashboard();
      setDashboard(nextDashboard);
      setSelectedTagId((current) => current ?? getDefaultTagId(nextDashboard.tags));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '标签看板加载失败');
    } finally {
      setLoading(false);
    }
  }, [persistence]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const visibleRows = useMemo(() => {
    if (!dashboard) {
      return [];
    }

    return sortTagRows(filterTagRows(dashboard.tags, query, color), sortKey);
  }, [color, dashboard, query, sortKey]);

  const pageRows = paginateTagRows(visibleRows, page, pageSize);
  const selectedDetail =
    dashboard?.details.find((detail) => detail.tag.id === selectedTagId) ??
    dashboard?.details[0] ??
    null;

  async function runMutation(action: () => Promise<void>) {
    setSaving(true);
    setMutationError(null);
    try {
      await action();
      setDialogMode(null);
      setDialogTag(null);
      await loadDashboard();
    } catch (mutationError) {
      setMutationError(mutationError instanceof Error ? mutationError.message : '标签操作失败');
    } finally {
      setSaving(false);
    }
  }

  function openDialog(mode: 'create' | 'edit' | 'merge', tag: TagDashboardTagRow | null = null) {
    setDialogMode(mode);
    setDialogTag(tag);
    setMutationError(null);
  }

  return (
    <section className="tag-dashboard-workspace" aria-label="标签管理工作区">
      <main className="tag-dashboard-main">
        <header className="tag-dashboard-heading">
          <h1>标签管理</h1>
        </header>
        {loading ? (
          <div className="tag-dashboard-state" role="status">
            <Loader2 size={18} />
            <span>正在加载标签看板...</span>
          </div>
        ) : error ? (
          <div className="tag-dashboard-state error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button type="button" onClick={() => void loadDashboard()}>
              <RotateCcw size={14} />
              重试
            </button>
          </div>
        ) : dashboard ? (
          <div className="tag-dashboard-content">
            <TagDashboardToolbar
              tags={dashboard.tags}
              query={query}
              color={color}
              sortKey={sortKey}
              onQueryChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
              onColorChange={(value) => {
                setColor(value);
                setPage(1);
              }}
              onSortChange={(value) => {
                setSortKey(value);
                setPage(1);
              }}
              onClear={() => {
                setQuery('');
                setColor('all');
                setSortKey('usage');
                setPage(1);
              }}
              onCreate={() => openDialog('create')}
            />
            <div className="tag-dashboard-top-grid">
              <TagOverviewCards overview={dashboard.overview} />
              <TagCloudPanel
                tags={dashboard.tags}
                selectedTagId={selectedTagId}
                onSelectTag={setSelectedTagId}
              />
            </div>
            <TagTable
              rows={pageRows.items}
              totalCount={visibleRows.length}
              page={pageRows.page}
              totalPages={pageRows.totalPages}
              selectedTagId={selectedTagId}
              onPageChange={setPage}
              onSelectTag={setSelectedTagId}
              onEdit={(tag) => openDialog('edit', tag)}
              onMerge={(tag) => openDialog('merge', tag)}
              onDelete={(tag) => void runMutation(async () => {
                if (!window.confirm(`删除标签“${tag.name}”？`)) {
                  return;
                }
                await persistence.deleteTag(tag.id);
                onTagsChange((current) => current.filter((item) => item.id !== tag.id));
                setSelectedTagId(null);
              })}
            />
          </div>
        ) : null}
      </main>
      <TagDetailsPanel
        detail={selectedDetail}
        recommendations={dashboard?.recommendations ?? []}
        onClose={onClose}
        onEdit={() => openDialog('edit', selectedDetail?.tag ?? null)}
        onOpenDocument={(documentKey, path, missing) => onOpenDocument(documentKey, path, 1, missing)}
      />
      <TagCreateEditDialog
        mode={dialogMode}
        tag={dialogTag}
        tags={dashboard?.tags ?? []}
        saving={saving}
        error={mutationError}
        onClose={() => {
          setDialogMode(null);
          setDialogTag(null);
          setMutationError(null);
        }}
        onCreate={(name, color) => void runMutation(async () => {
          const createdTag = await persistence.createTag({ name, color });
          onTagsChange((current) => [
            ...current.filter((item) => item.id !== createdTag.id),
            createdTag,
          ]);
          setSelectedTagId(createdTag.id);
        })}
        onRename={(tag, name) => void runMutation(async () => {
          const renamedTag = await persistence.renameTag(tag.id, name);
          onTagsChange((current) => [
            ...current.filter((item) => item.id !== renamedTag.id),
            renamedTag,
          ]);
          setSelectedTagId(renamedTag.id);
        })}
        onMerge={(source, targetId) => void runMutation(async () => {
          const mergedTag = await persistence.mergeTags({
            sourceTagId: source.id,
            targetTagId: targetId,
          });
          onTagsChange((current) => [
            ...current.filter((item) => item.id !== source.id && item.id !== mergedTag.id),
            mergedTag,
          ]);
          setSelectedTagId(mergedTag.id);
        })}
      />
    </section>
  );
}
