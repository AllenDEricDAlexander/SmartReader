import { FileText, Lightbulb, Pencil, X } from 'lucide-react';
import type { TagDashboardDetail, TagDashboardRecommendation } from './tagModels';

type TagDetailsPanelProps = {
  detail: TagDashboardDetail | null;
  recommendations: TagDashboardRecommendation[];
  onClose(): void;
  onEdit(): void;
  onOpenDocument(documentKey: string, path: string | null, missing: boolean): void;
};

export function TagDetailsPanel({
  detail,
  recommendations,
  onClose,
  onEdit,
  onOpenDocument,
}: TagDetailsPanelProps) {
  return (
    <aside className="tag-dashboard-detail-panel" aria-label="标签详情">
      <header>
        <h2>标签详情</h2>
        <button type="button" aria-label="关闭标签详情" onClick={onClose}><X size={15} /></button>
      </header>
      {detail ? (
        <>
          <section className="tag-detail-summary">
            <div>
              <i style={{ backgroundColor: detail.tag.color }} />
              <strong>{detail.tag.name}</strong>
            </div>
            <button type="button" onClick={onEdit}><Pencil size={14} />编辑</button>
            <dl>
              <div><dt>使用次数</dt><dd>{detail.tag.usageCount}</dd></div>
              <div><dt>关联文献数</dt><dd>{detail.tag.documentCount}</dd></div>
              <div><dt>最近使用</dt><dd>{detail.tag.recentUsedAt ?? '暂无'}</dd></div>
              <div><dt>创建时间</dt><dd>{detail.tag.createdAt}</dd></div>
            </dl>
            <p>{detail.tag.description}</p>
          </section>
          <section className="tag-detail-card">
            <div className="tag-detail-card-heading"><h3>代表性文献</h3><span>{detail.documents.length}</span></div>
            {detail.documents.length > 0 ? detail.documents.map((document) => (
              <button key={document.documentKey} type="button" onClick={() => onOpenDocument(document.documentKey, document.path, document.missing)}>
                <FileText size={16} />
                <span><strong>{document.displayName}</strong><small>{document.relationCount} 个关联</small></span>
              </button>
            )) : <p className="tag-dashboard-empty">暂无关联文献</p>}
          </section>
          <section className="tag-detail-card">
            <div className="tag-detail-card-heading"><h3>文件夹分布</h3></div>
            {detail.folderDistribution.length > 0 ? detail.folderDistribution.map((item) => (
              <div key={item.folder} className="tag-folder-row">
                <i style={{ backgroundColor: item.color }} />
                <span>{item.folder}</span>
                <strong>{item.count} ({item.percent}%)</strong>
              </div>
            )) : <p className="tag-dashboard-empty">暂无分布数据</p>}
          </section>
          <section className="tag-detail-card">
            <div className="tag-detail-card-heading"><h3>最近活动</h3></div>
            {detail.activities.length > 0 ? detail.activities.map((activity) => (
              <div key={activity.id} className="tag-activity-row">
                <span>{activity.createdAt}</span>
                <strong>{activity.targetLabel ?? activity.action}</strong>
              </div>
            )) : <p className="tag-dashboard-empty">暂无活动记录</p>}
          </section>
          <section className="tag-detail-card tag-recommendation-card">
            <div className="tag-detail-card-heading"><h3>批量整理建议</h3></div>
            {recommendations.length > 0 ? recommendations.slice(0, 2).map((recommendation) => (
              <div key={recommendation.id}>
                <Lightbulb size={15} />
                <span><strong>{recommendation.title}</strong><small>{recommendation.description}</small></span>
              </div>
            )) : <p className="tag-dashboard-empty">暂无整理建议</p>}
          </section>
        </>
      ) : <p className="tag-dashboard-empty">暂无标签详情</p>}
    </aside>
  );
}
