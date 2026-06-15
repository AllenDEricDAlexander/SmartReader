export type ViewerSource = {
  sessionId: string;
  url: string;
};

export type ViewerProgress = {
  sessionId: string;
  page: number;
  totalPages: number | null;
  zoom: number;
};
