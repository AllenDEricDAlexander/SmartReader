import {
  BookmarkManagementContent,
  type BookmarkManagementContentProps,
} from '../home/BookmarkManagementContent';

type BookmarkManagerWorkspaceProps = BookmarkManagementContentProps & {
  onClose(): void;
};

export function BookmarkManagerWorkspace({
  onClose,
  ...props
}: BookmarkManagerWorkspaceProps) {
  return (
    <section
      className="tool-workspace bookmark-management-standalone"
      aria-label="书签管理工作区"
    >
      <BookmarkManagementContent {...props} onClose={onClose} />
    </section>
  );
}
