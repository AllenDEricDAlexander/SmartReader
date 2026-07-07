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
