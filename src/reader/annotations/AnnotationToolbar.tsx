import { BookmarkPlus, Download, Filter, StickyNote, Upload } from 'lucide-react';
import type { ReaderAnnotation } from '../../annotations/annotationModels';
import { exportAnnotations } from '../../annotations/annotationStore';

type AnnotationToolbarProps = {
  annotations: ReaderAnnotation[];
  filter: string;
  onFilterChange(value: string): void;
  onAddBookmark(): void | Promise<void>;
  onAddNote(): void | Promise<void>;
  onImportAnnotations(json: string): void;
};

export function AnnotationToolbar({
  annotations,
  filter,
  onFilterChange,
  onAddBookmark,
  onAddNote,
  onImportAnnotations,
}: AnnotationToolbarProps) {
  return (
    <div className="annotation-toolbar">
      <div className="control-grid two">
        <button type="button" onClick={() => void onAddBookmark()}>
          <BookmarkPlus size={14} />
          添加书签
        </button>
        <button type="button" onClick={() => void onAddNote()}>
          <StickyNote size={14} />
          添加页面笔记
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(exportAnnotations(annotations))}
        >
          <Download size={14} />
          导出 JSON
        </button>
        <label className="file-action">
          <Upload size={14} />
          导入 JSON
          <textarea
            aria-label="Annotation import JSON"
            placeholder="粘贴批注 JSON，失焦后导入"
            onBlur={(event) => {
              if (event.target.value.trim()) {
                onImportAnnotations(event.target.value);
              }
            }}
          />
        </label>
      </div>
      <label className="filter-control">
        <Filter size={14} />
        <span>筛选</span>
        <select
          aria-label="Annotation filter"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        >
          <option value="all">全部</option>
          <option value="note">笔记</option>
          <option value="highlight">高亮</option>
          <option value="underline">下划线</option>
        </select>
      </label>
    </div>
  );
}
