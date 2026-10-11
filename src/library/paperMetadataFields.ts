import type { MetadataField } from './libraryModels';

export const paperMetadataFields: Array<{ field: MetadataField; label: string; list?: boolean; multiline?: boolean }> = [
  { field: 'title', label: '论文标题' },
  { field: 'authors', label: '作者', list: true },
  { field: 'journal', label: '发表期刊' },
  { field: 'year', label: '发表年份' },
  { field: 'doi', label: 'DOI' },
  { field: 'abstract', label: '摘要', multiline: true },
  { field: 'keywords', label: '关键词', list: true },
  { field: 'researchTopics', label: '研究主题', list: true },
  { field: 'indexingStatus', label: '收录状态' },
  { field: 'researchFields', label: '研究领域', list: true },
  { field: 'disciplines', label: '学科方向', list: true },
  { field: 'journalType', label: '期刊类型' },
];
