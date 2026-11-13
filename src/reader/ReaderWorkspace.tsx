import type { ReactNode } from 'react';

type ReaderWorkspaceProps = {
  toolbar: ReactNode;
  outlineDrawer: ReactNode;
  leftPanel: ReactNode;
  viewer: ReactNode;
  rightPanel: ReactNode;
  documentInfoDrawer: ReactNode;
  statusBar: ReactNode;
};

export function ReaderWorkspace({
  toolbar,
  outlineDrawer,
  leftPanel,
  viewer,
  rightPanel,
  documentInfoDrawer,
  statusBar,
}: ReaderWorkspaceProps) {
  return (
    <section className="reader-workspace" aria-label="阅读工作区">
      {toolbar}
      <div className="reader-body">
        {outlineDrawer}
        {leftPanel}
        <section className="viewer-pane">{viewer}</section>
        {rightPanel}
        {documentInfoDrawer}
      </div>
      {statusBar}
    </section>
  );
}
