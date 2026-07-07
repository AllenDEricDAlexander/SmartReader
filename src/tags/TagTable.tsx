import { ChevronLeft, ChevronRight, GitMerge, Pencil, Trash2 } from 'lucide-react';
import type { TagDashboardTagRow } from './tagModels';

type TagTableProps = {
  rows: TagDashboardTagRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  selectedTagId: number | null;
  onPageChange(page: number): void;
  onSelectTag(tagId: number): void;
  onEdit(tag: TagDashboardTagRow): void;
  onMerge(tag: TagDashboardTagRow): void;
  onDelete(tag: TagDashboardTagRow): void;
};

export function TagTable({
  rows,
  totalCount,
  page,
  totalPages,
  selectedTagId,
  onPageChange,
  onSelectTag,
  onEdit,
  onMerge,
  onDelete,
}: TagTableProps) {
  return (
    <section className="tag-dashboard-card tag-table-card" aria-label="全部标签">
      <h2>全部标签（{totalCount}）</h2>
      <div className="tag-table">
        <div className="tag-table-head">
          <span>标签名称</span>
          <span>使用次数</span>
          <span>关联文献数</span>
          <span>最近使用时间</span>
          <span>描述</span>
          <span>操作</span>
        </div>
        {rows.map((tag) => (
          <div key={tag.id} className={tag.id === selectedTagId ? 'tag-table-row active' : 'tag-table-row'}>
            <button type="button" className="tag-table-name" onClick={() => onSelectTag(tag.id)}>
              <i style={{ backgroundColor: tag.color }} />
              <strong>{tag.name}</strong>
            </button>
            <span>{tag.usageCount}</span>
            <span>{tag.documentCount}</span>
            <span>{tag.recentUsedAt ?? '暂无'}</span>
            <span>{tag.description}</span>
            <div className="tag-table-actions">
              <button type="button" aria-label={`编辑 ${tag.name}`} onClick={() => onEdit(tag)}><Pencil size={15} /></button>
              <button type="button" aria-label={`合并 ${tag.name}`} onClick={() => onMerge(tag)}><GitMerge size={15} /></button>
              <button type="button" aria-label={`删除 ${tag.name}`} onClick={() => onDelete(tag)}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
      <footer className="tag-dashboard-pagination">
        <span>共 {totalCount} 条记录</span>
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={15} /></button>
        <strong>{page}</strong>
        <span>/</span>
        <strong>{totalPages}</strong>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight size={15} /></button>
        <span>10 条/页</span>
      </footer>
    </section>
  );
}
