import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Edit3, FileText, Pin, PinOff, Star, X } from 'lucide-react';
import { formatFileSize } from '../home/homeDisplayUtils';
import type { MetadataField, Paper } from './libraryModels';
import { paperMetadataFields } from './paperMetadataFields';
import './paperPreview.css';

export type PaperPreviewProps = {
  paper: Paper;
  fieldUsage?: Partial<Record<MetadataField, number>>;
  mode?: 'hover' | 'pinned';
  onModeChange?(mode: 'hover' | 'pinned' | 'off'): void | Promise<void>;
  onEdit?(): void;
  onOpenPage?(page: number): void | Promise<void>;
  onToggleFavorite?(): void | Promise<void>;
  onFieldView?(field: MetadataField): void | Promise<void>;
  busy?: boolean;
};

export function PaperPreview(props: PaperPreviewProps) {
  return <PreviewContent key={props.paper.id} {...props} />;
}

function PreviewContent({ paper, fieldUsage = {}, mode = 'hover', onModeChange, onEdit, onOpenPage, onToggleFavorite, onFieldView, busy = false }: PaperPreviewProps) {
  const [expanded, setExpanded] = useState<Set<MetadataField>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const fields = useMemo(() => [...paperMetadataFields].sort((left, right) =>
    (fieldUsage[right.field] ?? 0) - (fieldUsage[left.field] ?? 0)), [fieldUsage]);
  const estimatedMinutes = useMemo(() => {
    const characters = paper.pages.reduce((count, page) => count + page.text.replace(/\s/g, '').length, 0);
    return characters ? Math.max(1, Math.ceil(characters / 600)) : null;
  }, [paper.pages]);

  const perform = async (operation: (() => void | Promise<void>) | undefined) => {
    if (!operation || pendingRef.current || busy) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try { await operation(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '操作失败，请重试。'); }
    finally {
      pendingRef.current = false;
      if (alive.current) setPending(false);
    }
  };

  const toggleField = (field: MetadataField) => {
    const opening = !expanded.has(field);
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(field); else next.delete(field);
      return next;
    });
    if (opening && onFieldView) {
      void Promise.resolve().then(() => onFieldView(field)).catch((failure: unknown) => {
        if (alive.current) setError(failure instanceof Error ? failure.message : '阅读偏好保存失败。');
      });
    }
  };

  return (
    <aside className="paper-preview" aria-label="文献预览">
      <header className="paper-preview-header">
        <span><FileText size={16} aria-hidden="true" />文献信息</span>
        <div>
          {onModeChange ? <>
            <button type="button" aria-label={mode === 'pinned' ? '取消固定预览' : '固定预览'} title={mode === 'pinned' ? '取消固定预览' : '固定预览'} disabled={pending || busy} aria-pressed={mode === 'pinned'} onClick={() => void perform(() => onModeChange(mode === 'pinned' ? 'hover' : 'pinned'))}>{mode === 'pinned' ? <PinOff size={15} /> : <Pin size={15} />}</button>
            <button type="button" aria-label="关闭预览" title="关闭预览" disabled={pending || busy} onClick={() => void perform(() => onModeChange('off'))}><X size={15} /></button>
          </> : null}
        </div>
      </header>
      <div className="paper-preview-body">
        <h2>{paper.metadata.title || paper.fileName}</h2>
        <p className="paper-preview-file" title={paper.fileName}>{paper.fileName}</p>
        <div className="paper-preview-actions">
          {onEdit ? <button type="button" disabled={pending || busy} onClick={onEdit}><Edit3 size={14} />编辑信息</button> : null}
          {onToggleFavorite ? <button type="button" aria-label={paper.favorite ? '取消收藏文献' : '收藏文献'} disabled={pending || busy} aria-pressed={paper.favorite} onClick={() => void perform(onToggleFavorite)}><Star size={14} fill={paper.favorite ? 'currentColor' : 'none'} />{paper.favorite ? '已收藏' : '收藏'}</button> : <span>{paper.favorite ? '已收藏' : '未收藏'}</span>}
        </div>
        {error ? <p className="library-error" role="alert">{error}</p> : null}
        <dl className="paper-preview-stats">
          <div><dt>文件大小</dt><dd>{formatFileSize(paper.fileSize)}</dd></div>
          <div><dt>页数</dt><dd>{paper.pageCount || '未知'}</dd></div>
          <div><dt>实际阅读</dt><dd>{formatReadingTime(paper.readingSeconds)}</dd></div>
          <div><dt>预计阅读</dt><dd>{estimatedMinutes === null ? '暂无可提取文本' : `约 ${estimatedMinutes} 分钟`}</dd></div>
        </dl>
        <p className="paper-preview-hint">预计时长按文本长度粗略估算；实际阅读时间会随阅读自动累计。</p>
        <div className="paper-preview-fields" aria-label="论文信息项">
          {fields.map(({ field, label }) => {
            const value = paper.metadata[field];
            const text = Array.isArray(value) ? value.join('、') : value;
            return <button type="button" className={`paper-preview-field${expanded.has(field) ? ' expanded' : ''}`} aria-expanded={expanded.has(field)} key={field} onClick={() => toggleField(field)}>
              <span className="paper-preview-field-label">{label}<ChevronDown size={13} aria-hidden="true" /></span>
              <span className="paper-preview-field-value">{text || '未填写'}</span>
            </button>;
          })}
        </div>
        <section className="paper-preview-annotations" aria-label="个人批注记录">
          <h3>个人批注 <span>{paper.annotations.length}</span></h3>
          {paper.annotations.length ? paper.annotations.map((annotation, index) => (
            <button key={annotation.id ?? index} type="button" disabled={!onOpenPage || pending || busy} aria-label={`打开批注 第 ${annotation.page} 页 ${annotation.text || annotation.quote || '批注'}`} onClick={() => void perform(() => onOpenPage?.(annotation.page))}>
              <small>第 {annotation.page} 页 · {annotation.type === 'note' ? '笔记' : annotation.type === 'highlight' ? '高亮' : '下划线'}</small>
              {annotation.quote ? <blockquote>{annotation.quote}</blockquote> : null}
              <span>{annotation.text || (annotation.quote ? '' : '未添加文字')}</span>
            </button>
          )) : <p>暂无批注，可在阅读器中记录想法。</p>}
        </section>
        {paper.bookmarks.length ? <section className="paper-preview-annotations" aria-label="文献书签">
          <h3>书签 <span>{paper.bookmarks.length}</span></h3>
          {paper.bookmarks.map((bookmark, index) => <button key={bookmark.id ?? index} type="button" disabled={!onOpenPage || pending || busy} onClick={() => void perform(() => onOpenPage?.(bookmark.page))}><small>第 {bookmark.page} 页</small><span>{bookmark.title}</span></button>)}
        </section> : null}
      </div>
    </aside>
  );
}

function formatReadingTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (!total) return '尚未阅读';
  if (total < 60) return `${total} 秒`;
  if (total < 3600) return `${Math.floor(total / 60)} 分 ${total % 60} 秒`;
  return `${Math.floor(total / 3600)} 小时 ${Math.floor(total % 3600 / 60)} 分`;
}
