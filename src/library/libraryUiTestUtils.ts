import { AiService } from '../ai/aiService';
import { emptyLibrary, emptyMetadata, type LibrarySnapshot, type Paper } from './libraryModels';
import { LibraryService } from './libraryService';
import type { LibraryStorage } from './libraryStorage';

export function paperFixture(id = 'paper-1', title = '认知研究'): Paper {
  return {
    id, fileName: `${id}.pdf`, fileSize: 2048,
    addedAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z',
    metadata: { ...emptyMetadata(title), authors: ['研究者甲', '研究者乙'], journal: '认知期刊', year: '2025',
      doi: '10.1234/cognition', abstract: '研究注意力与学习的关系。', keywords: ['认知', '教育'], researchTopics: ['注意力'] },
    manualFields: [], pages: [{ page: 1, text: 'Introduction to cognition.' }, { page: 2, text: 'Unique synapse evidence.' }],
    pageCount: 2, indexStatus: 'ready', indexError: null, aiStatus: 'idle', aiError: null,
    favorite: false, pinned: false, readingSeconds: 125, lastReadAt: null, lastPage: 1, zoom: 1,
    recentHidden: false, annotations: [], bookmarks: [], tagIds: [],
  };
}

export async function libraryUiFixture(papers: Paper[] = [paperFixture(), paperFixture('paper-2', '教育研究')]) {
  let data: LibrarySnapshot = emptyLibrary();
  data.papers = papers.map((paper) => ({ id: paper.id, kind: 'plain', paper }));
  let revision = 0;
  const files = new Map(papers.map((paper) => [paper.id, new TextEncoder().encode('%PDF-1.7 fixture')]));
  const storage: LibraryStorage = {
    async load() { return { revision, data: structuredClone(data) }; },
    async commit(expected, next, blobs) {
      if (expected !== revision) throw new Error('文献库已变化');
      data = structuredClone(next);
      for (const blob of blobs) {
        if (blob.bytes) files.set(blob.id, blob.bytes.slice());
        else files.delete(blob.id);
      }
      return ++revision;
    },
    async readFile(id) {
      const bytes = files.get(id);
      if (!bytes) throw new Error('文件不存在');
      return bytes.slice();
    },
  };
  const library = new LibraryService(storage, async () => ({ metadata: emptyMetadata('重新索引'), pages: [{ page: 1, text: 'Reindexed evidence' }], pageCount: 1 }));
  await library.initialize();
  const ai = new AiService(library, async () => '{"researchFields":["认知神经"]}');
  return { library, ai, files };
}
