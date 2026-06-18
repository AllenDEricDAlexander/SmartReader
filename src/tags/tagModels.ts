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
