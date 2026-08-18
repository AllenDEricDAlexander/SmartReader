import type { ReactNode } from 'react';

type ReaderWorkspaceProps = {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  toolbar: ReactNode;
  leftPanel: ReactNode;
  viewer: ReactNode;
  rightPanel: ReactNode;
  statusBar: ReactNode;
};

export function ReaderWorkspace({
  sidebarOpen,
  rightPanelOpen,
  toolbar,
  leftPanel,
  viewer,
  rightPanel,
  statusBar,
}: ReaderWorkspaceProps) {
  return (
    <section
      className={[
        'reader-workspace',
        sidebarOpen ? '' : 'sidebar-collapsed',
        rightPanelOpen ? '' : 'inspector-collapsed',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="阅读工作区"
    >
      {toolbar}
      <div className="reader-body">
        {sidebarOpen ? leftPanel : null}
        <section className="viewer-pane">{viewer}</section>
        {rightPanelOpen ? rightPanel : null}
      </div>
      {statusBar}
    </section>
  );
}
