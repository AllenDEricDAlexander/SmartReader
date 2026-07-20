import {
  BookmarkManagementContent,
  type BookmarkManagementContentProps,
} from './BookmarkManagementContent';

export type HomeBookmarksWorkspaceProps = BookmarkManagementContentProps;

export function HomeBookmarksWorkspace(props: HomeBookmarksWorkspaceProps) {
  return <BookmarkManagementContent {...props} />;
}
