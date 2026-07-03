type HomeTaskStatus = 'idle' | 'opening' | 'importing' | 'caching' | 'error';

type HomeAppVersion = {
  version: string;
  build?: string | null;
};

export type { HomeAppVersion, HomeTaskStatus };
