import type { ReactNode } from 'react';

type ReaderWorkspaceProps = {
  toolbar: ReactNode;
  outlineDrawer: ReactNode;
  leftPanel: ReactNode;
  viewer: ReactNode;
  documentInfoDrawer: ReactNode;
  statusBar: ReactNode;
};

export function ReaderWorkspace({
  toolbar,
  outlineDrawer,
  leftPanel,
  viewer,
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
        {documentInfoDrawer}
      </div>
      {statusBar}
    </section>
  );
}
