import { Copy, LocateFixed, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReaderAnnotation } from '../../annotations/annotationModels';
import { TagPicker } from '../../tags/TagPicker';
import type { Tag } from '../../tags/tagModels';

type AnnotationDetailProps = {
  annotation: ReaderAnnotation | null;
  tags: Tag[];
  onJumpToPage(page: number): void;
  onDeleteAnnotation(annotationId: number): void;
  onSaveNote(annotation: ReaderAnnotation, text: string): void | Promise<void>;
  onToggleTag(annotation: ReaderAnnotation, tag: Tag, selected: boolean): void | Promise<void>;
};

const typeLabels: Record<ReaderAnnotation['type'], string> = {
  note: '笔记',
  highlight: '高亮',
  underline: '下划线',
};

function getAnnotationText(annotation: ReaderAnnotation): string {
  return annotation.text ?? annotation.quote ?? '';
}

export function AnnotationDetail({
  annotation,
  tags,
  onJumpToPage,
  onDeleteAnnotation,
  onSaveNote,
  onToggleTag,
}: AnnotationDetailProps) {
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    setNoteText(annotation?.text ?? '');
  }, [annotation?.id, annotation?.text]);

  if (!annotation) {
    return (
      <section className="panel-section">
        <div className="panel-title">
          <h3>批注详情</h3>
        </div>
        <p className="muted-copy">在左侧选择一条批注，可在此查看原文、编辑笔记和标签。</p>
      </section>
    );
  }

  const annotationText = getAnnotationText(annotation);
  const persisted = annotation.id !== null;
  const noteEditable = persisted && annotation.type === 'note';
  const noteChanged = noteText !== (annotation.text ?? '');

  return (
    <section className="panel-section">
      <div className="panel-title">
        <h3>批注详情</h3>
      </div>
      <dl className="document-facts">
        <div>
          <dt>类型</dt>
          <dd>{typeLabels[annotation.type]}</dd>
        </div>
        <div>
          <dt>位置</dt>
          <dd>第 {annotation.page} 页</dd>
        </div>
        <div>
          <dt>颜色</dt>
          <dd>
            <span className="color-dot inline" style={{ backgroundColor: annotation.color }} />
            {annotation.color}
          </dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{new Date(annotation.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>
      {annotation.quote ? (
        <blockquote className="annotation-quote">{annotation.quote}</blockquote>
      ) : null}
      <label className="annotation-note-field">
        笔记内容
        <input
          aria-label="Annotation note"
          value={noteText}
          disabled={!noteEditable}
          placeholder={noteEditable ? '输入笔记…' : '仅页面笔记可编辑'}
          onChange={(event) => setNoteText(event.target.value)}
        />
      </label>
      <TagPicker
        tags={tags}
        selectedTagIds={annotation.tagIds ?? []}
        disabled={!persisted}
        onToggleTag={(tag, selected) => onToggleTag(annotation, tag, selected)}
      />
      <div className="control-grid two">
        <button type="button" onClick={() => onJumpToPage(annotation.page)}>
          <LocateFixed size={14} />
          跳转
        </button>
        <button
          type="button"
          onClick={() => void onSaveNote(annotation, noteText)}
          disabled={!noteEditable || !noteChanged}
        >
          保存笔记
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(annotationText)}
          disabled={!annotationText}
        >
          <Copy size={14} />
          复制文本
        </button>
        {persisted ? (
          <button
            type="button"
            className="danger-action"
            onClick={() => onDeleteAnnotation(annotation.id!)}
          >
            <Trash2 size={14} />
            删除
          </button>
        ) : null}
      </div>
    </section>
  );
}
