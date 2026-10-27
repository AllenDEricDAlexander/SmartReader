import { HomeDesktopIntegrationCard } from './HomeDesktopIntegrationCard';
import { HomeQuickTipsCard } from './HomeQuickTipsCard';

type HomeAssistPanelProps = {
  quickTipsEnabled?: boolean;
  desktopIntegrationEnabled?: boolean;
  disabled?: boolean;
  onCloseQuickTips(): void;
  onCloseDesktopIntegration(): void;
  onOpenGlobalSearch(): void;
  onOpenBookmarks(): void;
  onOpenAnnotations(): void;
  onOpenShortcutSettings(): void;
  onSetupFileAssociation(): void;
};

export function HomeAssistPanel({
  quickTipsEnabled = true,
  desktopIntegrationEnabled = true,
  disabled,
  onCloseQuickTips,
  onCloseDesktopIntegration,
  onOpenGlobalSearch,
  onOpenBookmarks,
  onOpenAnnotations,
  onOpenShortcutSettings,
  onSetupFileAssociation,
}: HomeAssistPanelProps) {
  if (!quickTipsEnabled && !desktopIntegrationEnabled) return null;

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
        />
      ) : null}
    </aside>
  );
}

export type { HomeAssistPanelProps };
