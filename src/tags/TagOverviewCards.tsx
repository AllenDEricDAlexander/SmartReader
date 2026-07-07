import { Hash, Link2, RotateCcw, Tags } from 'lucide-react';
import type { TagDashboardOverview } from './tagModels';

type TagOverviewCardsProps = {
  overview: TagDashboardOverview;
};

export function TagOverviewCards({ overview }: TagOverviewCardsProps) {
  const cards = [
    { label: '全部标签', value: overview.totalTags, icon: Tags },
    { label: '使用中的标签', value: overview.activeTags, icon: Link2 },
    { label: '总使用次数', value: overview.totalUsage, icon: RotateCcw },
    { label: '孤立标签', value: overview.orphanTags, icon: Hash },
  ];

  return (
    <section className="tag-dashboard-card tag-overview-card" aria-label="标签概览">
      <h2>标签概览</h2>
      <div className="tag-overview-grid">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label}>
            <span><Icon size={15} />{label}</span>
            <strong>{value.toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
