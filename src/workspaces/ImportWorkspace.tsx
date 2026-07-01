import { FileInput, FolderOpen, Upload, X } from 'lucide-react';
import { useCallback, useRef, type ChangeEventHandler } from 'react';

type ImportWorkspaceProps = {
  onOpenPdf(): void | Promise<void>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  canOpenNativePdf(): boolean;
  onClose(): void;
};

export function ImportWorkspace({
  onOpenPdf,
  onBrowserFileChange,
  canOpenNativePdf,
  onClose,
}: ImportWorkspaceProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openBrowserFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenPdf = useCallback(() => {
    if (!canOpenNativePdf()) {
      openBrowserFilePicker();
      return;
    }

    try {
      void Promise.resolve(onOpenPdf()).catch(() => undefined);
    } catch {
      return;
    }
  }, [canOpenNativePdf, onOpenPdf, openBrowserFilePicker]);

  return (
    <section className="tool-workspace" aria-label="文献导入工作区">
      <header className="workspace-header">
        <div>
          <p>Import</p>
          <h1>导入文献</h1>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tool-workspace-content">
        <section className="tool-panel">
          <div className="panel-title">
            <FileInput size={18} />
            <h2>本地 PDF 导入</h2>
          </div>
          <p className="muted-copy">当前版本使用本地 PDF 打开流程导入阅读记录。</p>
          <div className="quick-actions">
            <button
              type="button"
              className="primary-action"
              onClick={handleOpenPdf}
            >
              <FolderOpen size={18} />
              打开本地 PDF
            </button>
            <button type="button" className="secondary-action" onClick={openBrowserFilePicker}>
              <Upload size={18} />
              选择 PDF 文件
            </button>
            <input
              ref={fileInputRef}
              className="file-picker-input"
              aria-label="导入 PDF 文件"
              type="file"
              accept="application/pdf,.pdf"
              tabIndex={-1}
              onChange={onBrowserFileChange}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
