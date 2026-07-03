import {
  Bookmark,
  ChevronRight,
  Highlighter,
  Keyboard,
  Search,
  type LucideIcon,
} from 'lucide-react';

type HomeQuickTipsCardProps = {
  onOpenGlobalSearch(): void;
  onOpenBookmarks(): void;
  onOpenAnnotations(): void;
  onOpenShortcutSettings(): void;
};

type QuickTip = {
  title: string;
  description: string;
  shortcut: string;
  Icon: LucideIcon;
  onClick: () => void;
};

export function HomeQuickTipsCard({
  onOpenGlobalSearch,
  onOpenBookmarks,
  onOpenAnnotations,
  onOpenShortcutSettings,
}: HomeQuickTipsCardProps) {
  const quickTips: QuickTip[] = [
    {
      title: '搜索文件与内容',
      description: '使用顶部搜索框快速查找文件、书签、批注与全文内容。',
      shortcut: '⌘K',
      Icon: Search,
      onClick: onOpenGlobalSearch,
    },
    {
      title: '书签管理',
      description: '使用书签标记重要页面，支持层级与标签分类。',
      shortcut: '⌘D',
      Icon: Bookmark,
      onClick: onOpenBookmarks,
    },
    {
      title: '批注与高亮',
      description: '在阅读中添加批注、高亮与划线，支持导出。',
      shortcut: '⌘E',
      Icon: Highlighter,
      onClick: onOpenAnnotations,
    },
    {
      title: '快捷键总览',
      description: '查看所有快捷键，提升阅读与管理效率。',
      shortcut: '⌘/',
      Icon: Keyboard,
      onClick: onOpenShortcutSettings,
    },
  ];

  return (
    <section className="home-assist-card" aria-labelledby="home-quick-tips-title">
      <div className="assist-card-heading">
        <h2 id="home-quick-tips-title">快速上手</h2>
        <button type="button" className="assist-link-button" onClick={onOpenShortcutSettings}>
          <span>更多技巧</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="quick-tip-list">
        {quickTips.map((tip) => (
          <button key={tip.title} type="button" className="quick-tip-row" onClick={tip.onClick}>
            <span className="quick-tip-icon" aria-hidden="true">
              <tip.Icon size={16} />
            </span>
            <span className="quick-tip-copy">
              <strong>{tip.title}</strong>
              <span>{tip.description}</span>
            </span>
            <kbd>{tip.shortcut}</kbd>
          </button>
        ))}
      </div>
    </section>
  );
}
