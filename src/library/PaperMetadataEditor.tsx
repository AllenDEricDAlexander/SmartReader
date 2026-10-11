import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MetadataField, Paper, PaperMetadata } from './libraryModels';
import { LibraryDialog } from './LibraryDialog';
import { paperMetadataFields } from './paperMetadataFields';

export type PaperMetadataEditorProps = {
  paper: Paper;
  onSave(changes: Partial<PaperMetadata>): Promise<void>;
  onClose(): void;
};

export function PaperMetadataEditor(props: PaperMetadataEditorProps) {
  return <MetadataEditorForm key={props.paper.id} {...props} />;
}

function MetadataEditorForm({ paper, onSave, onClose }: PaperMetadataEditorProps) {
  const [initial] = useState(() => structuredClone(paper.metadata));
  const [draft, setDraft] = useState(() => Object.fromEntries(paperMetadataFields.map(({ field }) => [
    field, Array.isArray(initial[field]) ? initial[field].join('；') : initial[field],
  ])) as Record<MetadataField, string>);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    if (!draft.title.trim()) {
      setError('论文标题不能为空。');
      return;
    }
    const changes: Partial<PaperMetadata> = {};
    for (const { field, list } of paperMetadataFields) {
      const value = list ? [...new Set(draft[field].split(/[;；、\n]/).map((item) => item.trim()).filter(Boolean))] : draft[field].trim();
      if (JSON.stringify(value) !== JSON.stringify(initial[field])) Object.assign(changes, { [field]: value });
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(changes);
      if (alive.current) onClose();
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : '文献信息保存失败，请重试。');
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return (
    <LibraryDialog title="编辑文献信息" busy={saving} wide onClose={onClose}>
      <form onSubmit={(event) => void save(event)}>
        <p className="library-dialog-description">仅保存修改过的信息。人工填写的字段会长期保留，自动识别和 AI 补全不会覆盖。</p>
        <div className="paper-metadata-form">
          {paperMetadataFields.map(({ field, label, list, multiline }) => (
            <label key={field} className={multiline || field === 'title' ? 'paper-metadata-wide-field' : undefined}>
              <span>{label}{paper.manualFields.includes(field) ? <small>已人工编辑</small> : null}</span>
              {multiline ? (
                <textarea aria-label={label} value={draft[field]} rows={5} maxLength={30_000} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
              ) : (
                <input aria-label={label} data-autofocus={field === 'title' ? true : undefined} value={draft[field]} maxLength={30_000} disabled={saving} required={field === 'title'} inputMode={field === 'year' ? 'numeric' : undefined} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
              )}
              {list ? <small>多项请用分号分隔</small> : field === 'indexingStatus' ? <small>请按实际检索结果填写，自动识别不会推断收录状态</small> : null}
            </label>
          ))}
        </div>
        {error ? <p className="library-error" role="alert">{error}</p> : null}
        <footer className="library-dialog-actions">
          <button type="button" disabled={saving} onClick={onClose}>取消</button>
          <button type="submit" className="library-primary" disabled={saving}>{saving ? '保存中…' : '保存信息'}</button>
        </footer>
      </form>
    </LibraryDialog>
  );
}
