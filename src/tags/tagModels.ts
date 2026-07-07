export type Tag = {
  id: number;
  name: string;
  color: string;
  documentCount: number;
  annotationCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateTagInput = {
  name: string;
  color: string;
};

export type MergeTagsInput = {
  sourceTagId: number;
  targetTagId: number;
};

export type TagDashboard = {
  overview: TagDashboardOverview;
  tags: TagDashboardTagRow[];
  details: TagDashboardDetail[];
  recommendations: TagDashboardRecommendation[];
};

export type TagDashboardOverview = {
  totalTags: number;
  activeTags: number;
  totalUsage: number;
  orphanTags: number;
};

export type TagDashboardTagRow = {
  id: number;
  name: string;
  color: string;
  usageCount: number;
  documentCount: number;
  annotationCount: number;
  recentUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  description: string;
};

export type TagDashboardDetail = {
  tag: TagDashboardTagRow;
  documents: TagDashboardDocument[];
  folderDistribution: TagFolderDistribution[];
  activities: TagActivityRecord[];
};

export type TagDashboardDocument = {
  documentKey: string;
  displayName: string;
  path: string | null;
  missing: boolean;
  pageCount: number | null;
  lastOpenedAt: string | null;
  relationCount: number;
};

export type TagFolderDistribution = {
  folder: string;
  count: number;
  percent: number;
  color: string;
};

export type TagActivityRecord = {
  id: number;
  tagId: number | null;
  tagName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  createdAt: string;
};

export type TagDashboardRecommendation = {
  id: string;
  title: string;
  description: string;
  tagIds: number[];
  severity: 'info' | 'warning' | 'danger';
};
