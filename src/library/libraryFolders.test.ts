import { describe, expect, it } from 'vitest';
import { emptyLibrary, emptyMetadata, type LibrarySnapshot, type Paper } from './libraryModels';
import {
  classifyPaper,
  createFolder,
  deleteFolder,
  descendantFolderIds,
  folderVaultId,
  mergeFolders,
  moveFolder,
  renameFolder,
} from './libraryFolders';

function paper(id = 'paper-1'): Paper {
  return {
    id, fileName: 'paper.pdf', fileSize: 100, addedAt: '2026-10-11', updatedAt: '2026-10-11',
    metadata: emptyMetadata('论文'), manualFields: [], pages: [], pageCount: 1,
    indexStatus: 'ready', indexError: null, aiStatus: 'idle', aiError: null,
    favorite: false, pinned: false, readingSeconds: 0, lastReadAt: null, lastPage: 1,
    zoom: 1, recentHidden: false, annotations: [], bookmarks: [], tagIds: [],
  };
}

function vault(snapshot: LibrarySnapshot, folderId: string) {
  snapshot.vaults.push({ id: 'vault-1', folderId, salt: 'salt', verifier: { iv: 'iv', data: 'data' } });
}

describe('library folders', () => {
  it('creates nested folders with trimmed names and rejects ambiguous or invalid names', () => {
    const snapshot = emptyLibrary();
    const root = createFolder(snapshot, '  项目  ');
    const child = createFolder(snapshot, '实验', root.id);
    expect(root.name).toBe('项目');
    expect(root.parentId).toBeNull();
    expect(child.parentId).toBe(root.id);
    expect(descendantFolderIds(snapshot, root.id)).toEqual([child.id]);
    expect(() => createFolder(snapshot, '项目')).toThrow(/同名/);
    expect(() => createFolder(snapshot, '')).toThrow(/名称/);
    expect(() => createFolder(snapshot, 'a'.repeat(101))).toThrow(/名称/);
    expect(() => createFolder(snapshot, '实验', 'missing')).toThrow(/不存在/);
    expect(() => renameFolder(snapshot, child.id, '  ')).toThrow(/名称/);
    expect(() => renameFolder(snapshot, 'missing', '实验')).toThrow(/不存在/);
    expect(() => createFolder(snapshot, '项目', root.id)).not.toThrow();
  });

  it('prevents self/descendant cycles, duplicate destinations and depth greater than eight', () => {
    const snapshot = emptyLibrary();
    const root = createFolder(snapshot, 'root');
    const child = createFolder(snapshot, 'child', root.id);
    expect(() => moveFolder(snapshot, root.id, child.id)).toThrow(/循环/);
    expect(() => moveFolder(snapshot, root.id, root.id)).toThrow(/循环/);
    const other = createFolder(snapshot, 'other');
    createFolder(snapshot, 'child', other.id);
    expect(() => moveFolder(snapshot, child.id, other.id)).toThrow(/同名/);
    expect(() => renameFolder(snapshot, other.id, 'root')).toThrow(/同名/);
    let current = other;
    for (let depth = 2; depth <= 8; depth += 1) current = createFolder(snapshot, `level-${depth}`, current.id);
    expect(() => createFolder(snapshot, 'too-deep', current.id)).toThrow(/8/);
    expect(() => moveFolder(snapshot, child.id, current.id)).toThrow(/8/);
    expect(child.parentId).toBe(root.id);
    moveFolder(snapshot, child.id, null);
    expect(child.parentId).toBeNull();
  });

  it('recursively merges matching subfolders and deduplicates relationships without deleting papers', () => {
    const snapshot = emptyLibrary();
    const source = createFolder(snapshot, '课题 A');
    const target = createFolder(snapshot, '课题 B');
    const sourceChild = createFolder(snapshot, '文献综述', source.id);
    const targetChild = createFolder(snapshot, '文献综述', target.id);
    const grandchild = createFolder(snapshot, '背景', sourceChild.id);
    const uniqueChild = createFolder(snapshot, '实验', source.id);
    const storedPaper = { kind: 'plain' as const, id: 'paper-1', paper: paper() };
    snapshot.papers.push(storedPaper);
    snapshot.memberships['paper-1'] = [source.id, target.id, sourceChild.id, targetChild.id, uniqueChild.id];
    mergeFolders(snapshot, source.id, target.id);
    expect(snapshot.folders.some((folder) => folder.id === source.id || folder.id === sourceChild.id)).toBe(false);
    expect(grandchild.parentId).toBe(targetChild.id);
    expect(uniqueChild.parentId).toBe(target.id);
    expect(snapshot.memberships['paper-1']).toEqual([target.id, targetChild.id, uniqueChild.id]);
    expect(snapshot.papers).toEqual([storedPaper]);
    deleteFolder(snapshot, target.id);
    expect(snapshot.folders).toEqual([]);
    expect(snapshot.memberships['paper-1']).toEqual([]);
    expect(snapshot.papers).toEqual([storedPaper]);
  });

  it('rejects merging an ancestor or exceeding the resulting hierarchy depth before mutation', () => {
    const snapshot = emptyLibrary();
    const source = createFolder(snapshot, 'source');
    const child = createFolder(snapshot, 'child', source.id);
    expect(() => mergeFolders(snapshot, source.id, child.id)).toThrow(/循环/);
    expect(() => mergeFolders(snapshot, child.id, source.id)).toThrow(/循环/);
    let target = createFolder(snapshot, 'target');
    for (let depth = 2; depth <= 8; depth += 1) target = createFolder(snapshot, `depth-${depth}`, target.id);
    const before = structuredClone(snapshot);
    expect(() => mergeFolders(snapshot, source.id, target.id)).toThrow(/8/);
    expect(snapshot).toEqual(before);
  });

  it('finds inherited vaults and protects encrypted folders, descendants and ancestors', () => {
    const snapshot = emptyLibrary();
    const ancestor = createFolder(snapshot, 'project');
    const protectedRoot = createFolder(snapshot, 'private', ancestor.id);
    const child = createFolder(snapshot, 'subfolder', protectedRoot.id);
    const unrelated = createFolder(snapshot, 'public');
    vault(snapshot, protectedRoot.id);
    expect(folderVaultId(snapshot, ancestor.id)).toBeNull();
    expect(folderVaultId(snapshot, protectedRoot.id)).toBe('vault-1');
    expect(folderVaultId(snapshot, child.id)).toBe('vault-1');
    for (const folder of [ancestor, protectedRoot, child]) {
      expect(() => deleteFolder(snapshot, folder.id)).toThrow(/加密/);
      expect(() => mergeFolders(snapshot, folder.id, unrelated.id)).toThrow(/加密/);
      expect(() => mergeFolders(snapshot, unrelated.id, folder.id)).toThrow(/加密/);
      expect(() => moveFolder(snapshot, folder.id, unrelated.id)).toThrow(/加密/);
      expect(() => moveFolder(snapshot, unrelated.id, folder.id)).toThrow(/加密/);
    }
    expect(snapshot.folders).toHaveLength(4);
  });

  it('classifies only supplied metadata along all five dimensions with stable multi-folder links', () => {
    const snapshot = emptyLibrary();
    const document = paper();
    document.metadata = {
      ...document.metadata,
      researchFields: ['认知神经', '认知神经'], disciplines: ['神经科学'], year: '2025',
      journalType: '期刊论文', researchTopics: ['工作记忆', '注意力'],
    };
    snapshot.papers.push({ id: document.id, kind: 'plain', paper: document });
    classifyPaper(snapshot, document);
    expect(snapshot.folders.filter((folder) => !folder.parentId).map((folder) => folder.name)).toEqual([
      '研究领域', '学科方向', '发表年份', '期刊类型', '论文主题',
    ]);
    expect(snapshot.memberships[document.id]).toHaveLength(6);
    const before = structuredClone(snapshot);
    classifyPaper(snapshot, document);
    expect(snapshot).toEqual(before);
  });

  it('replaces only automatic assignments and preserves manual classification and renamed folders', () => {
    const snapshot = emptyLibrary();
    const document = paper();
    document.metadata.year = '2025';
    const manual = createFolder(snapshot, '毕业论文');
    snapshot.memberships[document.id] = [manual.id];
    classifyPaper(snapshot, document);
    const yearFolder = snapshot.folders.find((folder) => folder.name === '2025')!;
    document.metadata.year = '2026';
    classifyPaper(snapshot, document);
    expect(snapshot.memberships[document.id]).toContain(manual.id);
    expect(snapshot.memberships[document.id]).not.toContain(yearFolder.id);
    const renamed = snapshot.folders.find((folder) => folder.name === '2026')!;
    renameFolder(snapshot, renamed.id, '已选论文');
    expect(renamed.automatic).toBe(false);
    document.metadata.year = '';
    classifyPaper(snapshot, document);
    expect(snapshot.memberships[document.id]).toEqual([manual.id, renamed.id]);
  });

  it('does not manufacture values or expose private metadata through automatic folder names', () => {
    const snapshot = emptyLibrary();
    const document = paper();
    document.metadata.researchFields = ['未知', '', '未识别'];
    document.metadata.year = 'unknown';
    classifyPaper(snapshot, document);
    expect(snapshot.folders).toEqual([]);
    document.metadata.researchFields = ['保密课题'];
    snapshot.papers.push({ id: document.id, kind: 'encrypted', vaultId: 'vault-1', encrypted: { iv: '', data: '' } });
    classifyPaper(snapshot, document);
    expect(snapshot.folders).toEqual([]);
  });

  it('keeps explicit manual assignments to automatic folders when metadata changes', () => {
    const snapshot = emptyLibrary();
    const document = paper();
    document.metadata.year = '2025';
    classifyPaper(snapshot, document);
    const automaticFolder = snapshot.folders.find((folder) => folder.name === '2025')!;
    // Manual assignment transfers ownership of this relation to the user.
    snapshot.automaticMemberships[document.id] = [];
    document.metadata.year = '2026';
    classifyPaper(snapshot, document);
    expect(snapshot.memberships[document.id]).toContain(automaticFolder.id);
    expect(snapshot.automaticMemberships[document.id]).not.toContain(automaticFolder.id);
    const automaticRoot = snapshot.folders.find((folder) => folder.name === '发表年份')!;
    renameFolder(snapshot, automaticRoot.id, '我的年度整理');
    document.metadata.year = '';
    classifyPaper(snapshot, document);
    expect(snapshot.memberships[document.id]).toHaveLength(2);
    expect(snapshot.automaticMemberships[document.id]).toEqual([]);
    expect(snapshot.folders.every((folder) => !folder.automatic)).toBe(true);
  });

  it('reuses existing user folders without collisions and skips encrypted classification destinations', () => {
    const snapshot = emptyLibrary();
    const document = paper();
    document.metadata.year = '2025';
    document.metadata.researchTopics = ['保密实验'];
    const manualRoot = createFolder(snapshot, '发表年份');
    const manualLeaf = createFolder(snapshot, '2025', manualRoot.id);
    const encryptedRoot = createFolder(snapshot, '论文主题');
    vault(snapshot, encryptedRoot.id);
    classifyPaper(snapshot, document);
    expect(snapshot.folders).toHaveLength(3);
    expect(snapshot.memberships[document.id]).toEqual([manualLeaf.id]);
    expect(manualRoot.automatic).toBe(false);
    expect(manualLeaf.automatic).toBe(false);
  });
});
