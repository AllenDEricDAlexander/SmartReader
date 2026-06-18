import type { ReactNode } from 'react';

type ReaderWorkspaceProps = {
  sidebarOpen: boolean;
  tabs: ReactNode;
  toolbar: ReactNode;
  leftPanel: ReactNode;
  viewer: ReactNode;
  rightPanel: ReactNode;
  statusBar: ReactNode;
};

export function ReaderWorkspace({
  sidebarOpen,
  tabs,
  toolbar,
  leftPanel,
  viewer,
  rightPanel,
  statusBar,
}: ReaderWorkspaceProps) {
  return (
    <section
      className={sidebarOpen ? 'reader-workspace' : 'reader-workspace sidebar-collapsed'}
      aria-label="阅读工作区"
    >
      {tabs}
      {toolbar}
      <div className="reader-body">
        {sidebarOpen ? leftPanel : null}
        <section className="viewer-pane">{viewer}</section>
        {rightPanel}
      </div>
      {statusBar}
    </section>
  );
}
