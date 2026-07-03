import { CloudUpload, FolderOpen, FolderPlus } from 'lucide-react';
import { useState, type DragEventHandler } from 'react';
import { getPdfFilesFromDrop } from '../platform/dropZone';

type HomeQuickStartProps = {
  onOpenPdf(): void;
  onDropPdf: DragEventHandler<HTMLElement>;
  onRejectDrop?(message: string): void;
  onOpenFolder(): void;
};

export function HomeQuickStart({
  onOpenPdf,
  onDropPdf,
  onRejectDrop,
  onOpenFolder,
}: HomeQuickStartProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrop: DragEventHandler<HTMLButtonElement> = (event) => {
    setDragActive(false);
    event.preventDefault();
    event.stopPropagation();

    if (getPdfFilesFromDrop(event.dataTransfer.files).length === 0) {
      onRejectDrop?.('仅支持 PDF 文件');
      return;
    }

    onDropPdf(event);
  };

  return (
    <section className="home-panel home-quick-start" aria-labelledby="home-quick-start-title">
      <div className="section-heading">
        <h2 id="home-quick-start-title">快速开始</h2>
      </div>
      <div className="quick-start-card-grid">
        <button type="button" className="quick-start-card" onClick={onOpenPdf}>
          <span className="quick-start-icon" aria-hidden="true">
            <FolderOpen size={34} />
          </span>
          <span className="quick-start-copy">
            <strong>打开本地 PDF</strong>
            <span>浏览并打开本地 PDF 文件</span>
          </span>
        </button>
        <button
          type="button"
          className={
            dragActive ? 'quick-start-card drop-card drag-active' : 'quick-start-card drop-card'
          }
          onDragLeave={() => setDragActive(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDrop={handleDrop}
        >
          <span className="quick-start-icon" aria-hidden="true">
            <CloudUpload size={34} />
          </span>
          <span className="quick-start-copy">
            <strong>拖拽到这里</strong>
            <span>将 PDF 文件拖拽到此处打开</span>
          </span>
        </button>
        <button type="button" className="quick-start-card" onClick={onOpenFolder}>
          <span className="quick-start-icon" aria-hidden="true">
            <FolderPlus size={34} />
          </span>
          <span className="quick-start-copy">
            <strong>选择文件夹</strong>
            <span>打开文件夹并批量导入 PDF</span>
          </span>
        </button>
      </div>
    </section>
  );
}
