import { FileDown, FolderOpen, HardDriveUpload } from 'lucide-react';
import { useCallback, useRef, type ChangeEventHandler } from 'react';

type HomeQuickStartProps = {
  onOpenPdf(): void | Promise<void>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
};

export function HomeQuickStart({ onOpenPdf, onBrowserFileChange }: HomeQuickStartProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openBrowserFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenPdf = useCallback(() => {
    try {
      void Promise.resolve(onOpenPdf()).catch(openBrowserFilePicker);
    } catch {
      openBrowserFilePicker();
    }
  }, [onOpenPdf, openBrowserFilePicker]);

  return (
    <section className="home-panel home-quick-start" aria-labelledby="home-quick-start-title">
      <div className="section-heading">
        <p>快速开始</p>
        <h2 id="home-quick-start-title">打开或导入 PDF</h2>
      </div>
      <div className="quick-actions">
        <button type="button" className="primary-action" onClick={handleOpenPdf}>
          <FolderOpen size={18} />
          打开本地 PDF
        </button>
        <button
          type="button"
          className="secondary-action file-picker-button"
          onClick={openBrowserFilePicker}
        >
          <FileDown size={18} />
          选择 PDF 文件
        </button>
        <input
          ref={fileInputRef}
          className="file-picker-input"
          aria-label="选择 PDF 文件"
          type="file"
          accept="application/pdf,.pdf"
          onChange={onBrowserFileChange}
        />
        <button type="button" className="secondary-action" disabled aria-disabled="true">
          <HardDriveUpload size={18} />
          选择文件夹
        </button>
      </div>
      <div className="drop-target" aria-label="PDF 拖拽区域">
        <FileDown size={20} />
        <strong>拖拽到这里</strong>
        <span>支持从桌面拖入单个 PDF，本地文件不会离开你的设备。</span>
      </div>
    </section>
  );
}
