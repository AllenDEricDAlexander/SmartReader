import { FileCheck2, FolderCog, HardDrive, type LucideIcon } from 'lucide-react';

type HomeDesktopIntegrationCardProps = {
  onSetupFileAssociation(): void;
  onOpenCacheManagement(): void;
};

type DesktopIntegrationItem = {
  title: string;
  description: string;
  Icon: LucideIcon;
  actionLabel?: string;
  onClick?: () => void;
};

export function HomeDesktopIntegrationCard({
  onSetupFileAssociation,
  onOpenCacheManagement,
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
    {
      title: '本地缓存',
      description: '智能缓存常用文件，加速打开与搜索体验。',
      Icon: HardDrive,
      actionLabel: '管理缓存',
      onClick: onOpenCacheManagement,
    },
  ];

  return (
    <section className="home-assist-card" aria-labelledby="desktop-integration-title">
      <div className="assist-card-heading">
        <h2 id="desktop-integration-title">桌面集成</h2>
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
