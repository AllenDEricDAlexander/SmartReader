import type { LibraryFolder } from './libraryModels';

export function folderOptions(folders: LibraryFolder[]): Array<{ id: string; label: string }> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  return folders.map((folder) => {
    const names = [folder.name];
    const visited = new Set([folder.id]);
    let parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      names.unshift(parent.name);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return { id: folder.id, label: names.join(' / ') };
  }).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}
