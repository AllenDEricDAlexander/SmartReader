import type { PersistenceApi } from '../persistence/persistenceApi';
import type { TauriBridge } from '../platform/tauriBridge';
import type { PdfRenderer } from '../viewer/PdfViewerBridge';
import type { ViewerActions } from '../viewer/viewerController';

export type AppWorkspace =
  | 'home'
  | 'reader'
  | 'settings'
  | 'tags'
  | 'import'
  | 'compare'
  | 'annotations'
  | 'bookmarks';

export type ReaderAppProps = {
  bridge?: TauriBridge;
  persistence?: PersistenceApi;
  viewerController?: ViewerActions;
  viewerRenderer?: PdfRenderer;
};
