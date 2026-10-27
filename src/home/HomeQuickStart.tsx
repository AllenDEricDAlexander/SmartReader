import { CloudUpload, FolderOpen, FolderPlus } from 'lucide-react';
import { useEffect, useRef, useState, type DragEventHandler } from 'react';
import { getPdfFilesFromDrop, hasDroppedDirectory } from '../platform/dropZone';
import { listenForNativeFileDrop } from '../platform/nativeFileDrop';

type HomeQuickStartProps = {
  onOpenPdf(): void;
  onDropPdf: DragEventHandler<HTMLElement>;
  onDropPaths?(paths: string[]): void | Promise<void>;
  onRejectDrop?(message: string): void;
  onOpenFolder(): void;
};

export function HomeQuickStart({
  onOpenPdf,
  onDropPdf,
  onDropPaths,
  onRejectDrop,
  onOpenFolder,
}: HomeQuickStartProps) {
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const nativeDropReadyRef = useRef(false);
  const callbacksRef = useRef({ onDropPaths, onRejectDrop });
  callbacksRef.current = { onDropPaths, onRejectDrop };
  const nativeDropEnabled = Boolean(onDropPaths);

  useEffect(() => {
    if (!nativeDropEnabled || !dropzoneRef.current) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenForNativeFileDrop(dropzoneRef.current, (paths) => {
      if (!disposed) void Promise.resolve().then(() => callbacksRef.current.onDropPaths?.(paths))
        .catch(() => callbacksRef.current.onRejectDrop?.('无法读取拖入的文件或文件夹，请重试。'));
    }, (active) => { if (!disposed) setDragActive(active); }).then((dispose) => {
      if (disposed) dispose?.();
      else { unlisten = dispose; nativeDropReadyRef.current = Boolean(dispose); }
    }).catch(() => {
      if (!disposed) callbacksRef.current.onRejectDrop?.('桌面拖拽暂不可用，请使用选择按钮导入。');
    });
    return () => {
      disposed = true;
      nativeDropReadyRef.current = false;
      unlisten?.();
    };
  }, [nativeDropEnabled]);

  const handleDrop: DragEventHandler<HTMLDivElement> = (event) => {
    dragDepthRef.current = 0;
    setDragActive(false);
    event.preventDefault();
    event.stopPropagation();

    if (nativeDropReadyRef.current) return;
    if (!hasDroppedDirectory(event.dataTransfer) && getPdfFilesFromDrop(event.dataTransfer.files).length === 0) {
      onRejectDrop?.('仅支持 PDF 文件或文件夹');
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
        ref={dropzoneRef}
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
          <span>拖入单个 PDF 直接阅读，拖入文件夹批量导入其中的 PDF</span>
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
