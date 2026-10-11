import type { ClassificationDimension, LibraryFolder, LibrarySnapshot, Paper } from './libraryModels';

const maxDepth = 8;
const dimensions: Array<{ field: ClassificationDimension; name: string }> = [
  { field: 'researchFields', name: '研究领域' },
  { field: 'disciplines', name: '学科方向' },
  { field: 'year', name: '发表年份' },
  { field: 'journalType', name: '期刊类型' },
  { field: 'researchTopics', name: '论文主题' },
];

function requireFolder(snapshot: LibrarySnapshot, id: string): LibraryFolder {
  const folder = snapshot.folders.find((candidate) => candidate.id === id);
  if (!folder) throw new Error('分类文件夹不存在。');
  return folder;
}

function folderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new Error('文件夹名称须为 1–100 个字符。');
  return trimmed;
}

function assertUniqueName(snapshot: LibrarySnapshot, name: string, parentId: string | null, ignoredId?: string): void {
  if (snapshot.folders.some((folder) => folder.id !== ignoredId && folder.parentId === parentId && folder.name === name)) {
    throw new Error('同一分类下已存在同名文件夹。');
  }
}

function ancestors(snapshot: LibrarySnapshot, id: string): LibraryFolder[] {
  const result: LibraryFolder[] = [];
  let current: string | null = id;
  while (current !== null) {
    if (result.some((folder) => folder.id === current)) throw new Error('分类目录存在循环。');
    const folder = requireFolder(snapshot, current);
    result.push(folder);
    current = folder.parentId;
  }
  return result;
}

export function descendantFolderIds(snapshot: LibrarySnapshot, id: string): string[] {
  requireFolder(snapshot, id);
  const result: string[] = [];
  const seen = new Set([id]);
  const queue = [id];
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of snapshot.folders.filter((folder) => folder.parentId === queue[index])) {
      if (seen.has(child.id)) throw new Error('分类目录存在循环。');
      seen.add(child.id);
      result.push(child.id);
      queue.push(child.id);
    }
  }
  return result;
}

export function folderVaultId(snapshot: LibrarySnapshot, folderId: string): string | null {
  for (const folder of ancestors(snapshot, folderId)) {
    const vault = snapshot.vaults.find((candidate) => candidate.folderId === folder.id);
    if (vault) return vault.id;
  }
  return null;
}

function assertUnprotected(snapshot: LibrarySnapshot, id: string): void {
  const subtree = new Set([id, ...descendantFolderIds(snapshot, id)]);
  if (folderVaultId(snapshot, id) || snapshot.vaults.some((vault) => subtree.has(vault.folderId))) {
    throw new Error('加密文件夹及其相关层级不能移动、合并或删除，请先解除加密。');
  }
}

function subtreeHeight(snapshot: LibrarySnapshot, id: string): number {
  const baseDepth = ancestors(snapshot, id).length;
  return Math.max(1, ...descendantFolderIds(snapshot, id).map((child) => ancestors(snapshot, child).length - baseDepth + 1));
}

function makeManual(snapshot: LibrarySnapshot, ids: Set<string>): void {
  for (const folder of snapshot.folders) {
    if (ids.has(folder.id)) folder.automatic = false;
  }
  for (const [paperId, memberships] of Object.entries(snapshot.automaticMemberships)) {
    snapshot.automaticMemberships[paperId] = memberships.filter((id) => !ids.has(id));
  }
}

export function createFolder(snapshot: LibrarySnapshot, name: string, parentId: string | null = null): LibraryFolder {
  const normalized = folderName(name);
  if (parentId !== null && ancestors(snapshot, parentId).length >= maxDepth) {
    throw new Error('分类目录最多支持 8 层。');
  }
  assertUniqueName(snapshot, normalized, parentId);
  const folder: LibraryFolder = {
    id: crypto.randomUUID(), name: normalized, parentId, dimension: null,
    automatic: false, createdAt: new Date().toISOString(),
  };
  snapshot.folders.push(folder);
  return folder;
}

export function renameFolder(snapshot: LibrarySnapshot, id: string, name: string): void {
  const folder = requireFolder(snapshot, id);
  const normalized = folderName(name);
  assertUniqueName(snapshot, normalized, folder.parentId, id);
  if (folder.name === normalized) return;
  folder.name = normalized;
  // Explicitly reorganized classifications become user-owned. Reindexing must
  // preserve their existing paper assignments, including nested folders.
  makeManual(snapshot, new Set([id, ...descendantFolderIds(snapshot, id)]));
}

export function moveFolder(snapshot: LibrarySnapshot, id: string, parentId: string | null): void {
  const folder = requireFolder(snapshot, id);
  assertUnprotected(snapshot, id);
  if (parentId !== null) {
    requireFolder(snapshot, parentId);
    assertUnprotected(snapshot, parentId);
    if (parentId === id || descendantFolderIds(snapshot, id).includes(parentId)) {
      throw new Error('无法移动到自身或子分类，目录会形成循环。');
    }
  }
  assertUniqueName(snapshot, folder.name, parentId, id);
  const parentDepth = parentId === null ? 0 : ancestors(snapshot, parentId).length;
  if (parentDepth + subtreeHeight(snapshot, id) > maxDepth) throw new Error('分类目录最多支持 8 层。');
  if (folder.parentId === parentId) return;
  makeManual(snapshot, new Set([id, ...descendantFolderIds(snapshot, id)]));
  folder.parentId = parentId;
}

export function mergeFolders(snapshot: LibrarySnapshot, sourceId: string, targetId: string): void {
  requireFolder(snapshot, sourceId);
  requireFolder(snapshot, targetId);
  assertUnprotected(snapshot, sourceId);
  assertUnprotected(snapshot, targetId);
  if (sourceId === targetId || descendantFolderIds(snapshot, sourceId).includes(targetId) || descendantFolderIds(snapshot, targetId).includes(sourceId)) {
    throw new Error('不能合并自身或具有上下级关系的分类，目录会形成循环。');
  }
  if (ancestors(snapshot, targetId).length + subtreeHeight(snapshot, sourceId) - 1 > maxDepth) {
    throw new Error('合并后的分类目录超过 8 层。');
  }
  makeManual(snapshot, new Set([sourceId, targetId, ...descendantFolderIds(snapshot, sourceId), ...descendantFolderIds(snapshot, targetId)]));
  mergeSubtree(snapshot, sourceId, targetId);
}

function mergeSubtree(snapshot: LibrarySnapshot, sourceId: string, targetId: string): void {
  for (const child of snapshot.folders.filter((folder) => folder.parentId === sourceId)) {
    const matching = snapshot.folders.find((folder) => folder.parentId === targetId && folder.name === child.name);
    if (matching) mergeSubtree(snapshot, child.id, matching.id);
    else child.parentId = targetId;
  }
  for (const [paperId, ids] of Object.entries(snapshot.memberships)) {
    snapshot.memberships[paperId] = [...new Set(ids.map((id) => id === sourceId ? targetId : id))];
  }
  snapshot.folders = snapshot.folders.filter((folder) => folder.id !== sourceId);
}

export function deleteFolder(snapshot: LibrarySnapshot, id: string): void {
  assertUnprotected(snapshot, id);
  const removed = new Set([id, ...descendantFolderIds(snapshot, id)]);
  snapshot.folders = snapshot.folders.filter((folder) => !removed.has(folder.id));
  for (const [paperId, ids] of Object.entries(snapshot.memberships)) {
    snapshot.memberships[paperId] = ids.filter((folderId) => !removed.has(folderId));
  }
  for (const [paperId, ids] of Object.entries(snapshot.automaticMemberships)) {
    snapshot.automaticMemberships[paperId] = ids.filter((folderId) => !removed.has(folderId));
  }
}

function classificationValues(value: string | string[]): string[] {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => item.trim()).filter((item) =>
    item.length > 0 && item.length <= 100 && !/^(未知|未识别|未填写|暂无|无|unknown|n\/a|null|none)$/i.test(item),
  ))];
}

export function classifyPaper(snapshot: LibrarySnapshot, paper: Paper): void {
  // Folder names remain visible while vaults are locked; never derive them from
  // the decrypted content of an encrypted paper.
  if (snapshot.papers.some((stored) => stored.id === paper.id && stored.kind === 'encrypted')) return;
  const previousAutomatic = new Set(snapshot.automaticMemberships[paper.id] ?? []);
  const manual = (snapshot.memberships[paper.id] ?? []).filter((id) => !previousAutomatic.has(id));
  const classified: string[] = [];
  for (const { field, name } of dimensions) {
    const values = classificationValues(paper.metadata[field]);
    if (!values.length) continue;
    let root = snapshot.folders.find((folder) => folder.parentId === null && folder.name === name);
    if (root && folderVaultId(snapshot, root.id)) continue;
    if (!root) {
      root = createFolder(snapshot, name);
      root.dimension = field;
      root.automatic = true;
    }
    for (const value of values) {
      let child = snapshot.folders.find((folder) => folder.parentId === root.id && folder.name === value);
      if (child && folderVaultId(snapshot, child.id)) continue;
      if (!child) {
        child = createFolder(snapshot, value, root.id);
        child.dimension = field;
        child.automatic = true;
      }
      classified.push(child.id);
    }
  }
  snapshot.memberships[paper.id] = [...new Set([...manual, ...classified])];
  snapshot.automaticMemberships[paper.id] = [...new Set(classified.filter((id) => !manual.includes(id)))];
}
