import { HomeDesktopIntegrationCard } from './HomeDesktopIntegrationCard';
import { HomeQuickTipsCard } from './HomeQuickTipsCard';
import { HomeVersionCard } from './HomeVersionCard';
import type { HomeAppVersion } from './homeTypes';

type HomeAssistPanelProps = {
  appVersion: HomeAppVersion;
  quickTipsEnabled?: boolean;
  desktopIntegrationEnabled?: boolean;
  disabled?: boolean;
  onCloseQuickTips(): void;
  onCloseDesktopIntegration(): void;
  onOpenGlobalSearch(): void;
  onOpenBookmarks(): void;
  onOpenAnnotations(): void;
  onOpenShortcutSettings(): void;
  onOpenCacheManagement(): void;
  onSetupFileAssociation(): void;
};

export function HomeAssistPanel({
  appVersion,
  quickTipsEnabled = true,
  desktopIntegrationEnabled = true,
  disabled,
  onCloseQuickTips,
  onCloseDesktopIntegration,
  onOpenGlobalSearch,
  onOpenBookmarks,
  onOpenAnnotations,
  onOpenShortcutSettings,
  onOpenCacheManagement,
  onSetupFileAssociation,
}: HomeAssistPanelProps) {
  return (
    <aside className="home-assist" aria-label="辅助信息">
      {quickTipsEnabled ? (
        <HomeQuickTipsCard
          disabled={disabled}
          onClose={onCloseQuickTips}
          onOpenGlobalSearch={onOpenGlobalSearch}
          onOpenBookmarks={onOpenBookmarks}
          onOpenAnnotations={onOpenAnnotations}
          onOpenShortcutSettings={onOpenShortcutSettings}
        />
      ) : null}
      {desktopIntegrationEnabled ? (
        <HomeDesktopIntegrationCard
          disabled={disabled}
          onClose={onCloseDesktopIntegration}
          onSetupFileAssociation={onSetupFileAssociation}
          onOpenCacheManagement={onOpenCacheManagement}
        />
      ) : null}
      <HomeVersionCard appVersion={appVersion} />
    </aside>
  );
}

export type { HomeAssistPanelProps };
