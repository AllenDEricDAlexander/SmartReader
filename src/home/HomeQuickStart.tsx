import { CloudUpload, FolderOpen, FolderPlus } from 'lucide-react';
import { useRef, useState, type DragEventHandler } from 'react';
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
  const dragDepthRef = useRef(0);

  const handleDrop: DragEventHandler<HTMLDivElement> = (event) => {
    dragDepthRef.current = 0;
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
      <div
        className={dragActive ? 'quick-start-dropzone drag-active' : 'quick-start-dropzone'}
        role="group"
        aria-label="PDF 拖拽区域"
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dragDepthRef.current += 1;
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.stopPropagation();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) {
            setDragActive(false);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(true);
        }}
        onDrop={handleDrop}
      >
        <span className="quick-start-icon" aria-hidden="true">
          <CloudUpload size={26} />
        </span>
        <div className="quick-start-copy">
          <strong>拖拽到这里</strong>
          <span>拖入 PDF 直接阅读，或选择文件夹批量导入</span>
        </div>
        <div className="quick-start-actions">
          <button type="button" className="primary-action" aria-label="打开本地 PDF" onClick={onOpenPdf}>
            <FolderOpen size={16} aria-hidden="true" />
            选择 PDF
          </button>
          <button type="button" className="secondary-action" onClick={onOpenFolder}>
            <FolderPlus size={16} aria-hidden="true" />
            选择文件夹
          </button>
        </div>
      </div>
    </section>
  );
}
