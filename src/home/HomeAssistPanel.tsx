import { HomeDesktopIntegrationCard } from './HomeDesktopIntegrationCard';
import { HomeQuickTipsCard } from './HomeQuickTipsCard';
import { HomeVersionCard } from './HomeVersionCard';
import type { HomeAppVersion } from './homeTypes';

type HomeAssistPanelProps = {
  appVersion: HomeAppVersion;
  onOpenGlobalSearch(): void;
  onOpenBookmarks(): void;
  onOpenAnnotations(): void;
  onOpenShortcutSettings(): void;
  onOpenCacheManagement(): void;
  onSetupFileAssociation(): void;
  onCheckUpdates(): void;
};

export function HomeAssistPanel({
  appVersion,
  onOpenGlobalSearch,
  onOpenBookmarks,
  onOpenAnnotations,
  onOpenShortcutSettings,
  onOpenCacheManagement,
  onSetupFileAssociation,
  onCheckUpdates,
}: HomeAssistPanelProps) {
  return (
    <aside className="home-assist" aria-label="辅助信息">
      <HomeQuickTipsCard
        onOpenGlobalSearch={onOpenGlobalSearch}
        onOpenBookmarks={onOpenBookmarks}
        onOpenAnnotations={onOpenAnnotations}
        onOpenShortcutSettings={onOpenShortcutSettings}
      />
      <HomeDesktopIntegrationCard
        onSetupFileAssociation={onSetupFileAssociation}
        onOpenCacheManagement={onOpenCacheManagement}
      />
      <HomeVersionCard appVersion={appVersion} onCheckUpdates={onCheckUpdates} />
    </aside>
  );
}

export type { HomeAssistPanelProps };
