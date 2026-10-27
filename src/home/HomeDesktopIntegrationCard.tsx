import { FileCheck2, FolderCog, X, type LucideIcon } from 'lucide-react';

type HomeDesktopIntegrationCardProps = {
  disabled?: boolean;
  onClose(): void;
  onSetupFileAssociation(): void;
};

type DesktopIntegrationItem = {
  title: string;
  description: string;
  Icon: LucideIcon;
  actionLabel?: string;
  onClick?: () => void;
};

export function HomeDesktopIntegrationCard({
  disabled,
  onClose,
  onSetupFileAssociation,
}: HomeDesktopIntegrationCardProps) {
  const integrationItems: DesktopIntegrationItem[] = [
    {
      title: '支持 "Open With"',
      description: '在 Finder 中右键使用 SmartReader 打开 PDF。',
      Icon: FileCheck2,
    },
    {
      title: '文件关联',
      description: '将 PDF 文件默认关联到 SmartReader。',
      Icon: FolderCog,
      actionLabel: '设置关联',
      onClick: onSetupFileAssociation,
    },
  ];

  return (
    <section className="home-assist-card" aria-labelledby="desktop-integration-title">
      <div className="assist-card-heading">
        <h2 id="desktop-integration-title">桌面集成</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭桌面集成"
          title="关闭桌面集成，可在设置的外观中重新开启"
          disabled={disabled}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="desktop-integration-list">
        {integrationItems.map((item) => (
          <div key={item.title} className="desktop-integration-item">
            <span className="quick-tip-icon" aria-hidden="true">
              <item.Icon size={16} />
            </span>
            <span className="quick-tip-copy">
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </span>
            {item.actionLabel && item.onClick ? (
              <button type="button" className="assist-link-button" onClick={item.onClick}>
                {item.actionLabel}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
