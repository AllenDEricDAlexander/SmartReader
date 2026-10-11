import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, LockKeyhole } from 'lucide-react';
import type { LibraryFolder } from './libraryModels';

type LibraryFolderTreeProps = {
  folders: LibraryFolder[];
  selectedId: string | null;
  counts: Map<string, number>;
  protectedIds: Set<string>;
  disabled?: boolean;
  onSelect(id: string): void;
};

export function LibraryFolderTree({ folders, selectedId, counts, protectedIds, disabled, onSelect }: LibraryFolderTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const children = useMemo(() => {
    const groups = new Map<string | null, LibraryFolder[]>();
    for (const folder of folders) groups.set(folder.parentId, [...(groups.get(folder.parentId) ?? []), folder]);
    for (const group of groups.values()) group.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    return groups;
  }, [folders]);
  const branch = (parentId: string | null) => (
    <ul>
      {(children.get(parentId) ?? []).map((folder) => {
        const hasChildren = (children.get(folder.id)?.length ?? 0) > 0;
        return <li key={folder.id}>
          <div className={`library-folder-row${selectedId === folder.id ? ' active' : ''}`}>
            {hasChildren ? <button className="library-folder-toggle" type="button" aria-label={`${collapsed.has(folder.id) ? '展开' : '折叠'}分类 ${folder.name}`} aria-expanded={!collapsed.has(folder.id)} onClick={() => setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
              return next;
            })}>{collapsed.has(folder.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button> : <span className="library-folder-spacer" />}
            <button className="library-folder-select" type="button" title={folder.name} disabled={disabled} aria-current={selectedId === folder.id ? 'page' : undefined} onClick={() => onSelect(folder.id)}>
              {protectedIds.has(folder.id) ? <LockKeyhole size={13} /> : <Folder size={13} />}
              <span>{folder.name}</span><small>{counts.get(folder.id) ?? 0}</small>
            </button>
          </div>
          {hasChildren && !collapsed.has(folder.id) ? branch(folder.id) : null}
        </li>;
      })}
    </ul>
  );
  return branch(null);
}
