import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LibraryDialog } from './LibraryDialog';
import { descendantFolderIds } from './libraryFolders';
import { folderOptions } from './libraryFolderUi';
import type { LibraryService, LibraryView } from './libraryService';

export type LibraryAction =
  | { kind: 'createFolder'; parentId: string | null }
  | { kind: 'renameFolder' | 'moveFolder' | 'mergeFolder' | 'deleteFolder' | 'encryptFolder'; folderId: string }
  | { kind: 'unlockVault' | 'decryptVault'; vaultId: string }
  | { kind: 'categorize'; paperIds: string[]; mode: 'add' | 'move' | 'remove'; initialFolderId?: string }
  | { kind: 'deletePapers' | 'reindex'; paperIds: string[] };

type LibraryActionDialogProps = {
  action: LibraryAction;
  library: LibraryService;
  view: LibraryView;
  onClose(): void;
  onComplete(message: string): void;
};

const titles: Record<LibraryAction['kind'], string> = {
  createFolder: '新建分类', renameFolder: '重命名分类', moveFolder: '移动分类', mergeFolder: '合并分类',
  deleteFolder: '删除分类', encryptFolder: '加密文件夹', unlockVault: '解锁文件夹', decryptVault: '解除文件夹加密',
  categorize: '批量归类', deletePapers: '删除文献', reindex: '重新建立索引',
};
const confirmLabels: Record<LibraryAction['kind'], string> = {
  createFolder: '创建分类', renameFolder: '保存名称', moveFolder: '确认移动', mergeFolder: '确认合并',
  deleteFolder: '确认删除分类', encryptFolder: '加密保存', unlockVault: '解锁', decryptVault: '确认解除加密',
  categorize: '确认归类', deletePapers: '确认删除文献', reindex: '开始索引',
};

export function LibraryActionDialog({ action, library, view, onClose, onComplete }: LibraryActionDialogProps) {
  const folder = 'folderId' in action ? view.snapshot.folders.find((item) => item.id === action.folderId) : undefined;
  const vault = 'vaultId' in action ? view.snapshot.vaults.find((item) => item.id === action.vaultId) : undefined;
  const vaultFolder = vault ? view.snapshot.folders.find((item) => item.id === vault.folderId) : undefined;
  const [name, setName] = useState(action.kind === 'renameFolder' ? folder?.name ?? '' : '');
  const [targetId, setTargetId] = useState(action.kind === 'createFolder' ? action.parentId ?? '' : action.kind === 'moveFolder' ? folder?.parentId ?? '' : '');
  const [categoryIds, setCategoryIds] = useState<string[]>(action.kind === 'categorize' && action.initialFolderId ? [action.initialFolderId] : []);
  const [categoryMode, setCategoryMode] = useState<'add' | 'move' | 'remove'>(action.kind === 'categorize' ? action.mode : 'add');
  const [password, setPassword] = useState('');
  const [repeatedPassword, setRepeatedPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const options = folderOptions(view.snapshot.folders);
  const excluded = folder && (action.kind === 'moveFolder' || action.kind === 'mergeFolder')
    ? new Set([folder.id, ...descendantFolderIds(view.snapshot, folder.id)]) : new Set<string>();
  const targets = options.filter((option) => !excluded.has(option.id) &&
    !(action.kind === 'mergeFolder' && folder && descendantFolderIds(view.snapshot, option.id).includes(folder.id)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      let message = '操作已完成。';
      switch (action.kind) {
        case 'createFolder': await library.createFolder(name, targetId || null); message = '分类已创建。'; break;
        case 'renameFolder': await library.renameFolder(action.folderId, name); message = '分类名称已保存。'; break;
        case 'moveFolder': await library.moveFolder(action.folderId, targetId || null); message = '分类已移动。'; break;
        case 'mergeFolder':
          if (!targetId) throw new Error('请选择合并到的目标分类。');
          await library.mergeFolders(action.folderId, targetId); message = '分类已合并，所有论文均已保留。'; break;
        case 'deleteFolder': await library.deleteFolder(action.folderId); message = '分类已删除，所有论文均已保留。'; break;
        case 'encryptFolder':
          if (password.length < 8) throw new Error('加密密码至少需要 8 个字符。');
          if (password !== repeatedPassword) throw new Error('两次密码不一致。');
          await library.encryptFolder(action.folderId, password); message = '文件夹已加密，当前会话仍为解锁状态，可随时锁定。'; break;
        case 'unlockVault': await library.unlockVault(action.vaultId, password); message = '文件夹已解锁。'; break;
        case 'decryptVault': await library.decryptFolder(action.vaultId); message = '文件夹加密已解除。'; break;
        case 'categorize':
          if (!categoryIds.length) throw new Error('请至少选择一个目标分类。');
          await library.categorize(action.paperIds, categoryIds, categoryMode); message = '所选文献的分类已更新，未复制 PDF 文件。'; break;
        case 'deletePapers': await library.deletePapers(action.paperIds); message = '所选文献库副本已删除，原始 PDF 未改动。'; break;
        case 'reindex':
          for (const id of action.paperIds) {
            const paper = await library.retryIndex(id, password || undefined);
            if (paper.indexStatus === 'error') throw new Error(paper.indexError || '文献索引失败，请重试。');
          }
          message = '索引已更新；扫描 PDF 仍需 OCR 才能全文检索。'; break;
      }
      if (alive.current) onComplete(message);
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : '操作失败，请重试。');
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const passwordAction = action.kind === 'encryptFolder' || action.kind === 'unlockVault' || action.kind === 'reindex';

  return <LibraryDialog title={titles[action.kind]} busy={saving} onClose={onClose}>
    <form onSubmit={(event) => void submit(event)}>
      {action.kind === 'createFolder' || action.kind === 'renameFolder' ? <label><span>分类名称</span><input aria-label="分类名称" data-autofocus value={name} maxLength={100} required disabled={saving} onChange={(event) => setName(event.target.value)} /></label> : null}
      {action.kind === 'createFolder' || action.kind === 'moveFolder' || action.kind === 'mergeFolder' ? <label>
        <span>{action.kind === 'mergeFolder' ? '目标分类' : '上级分类'}</span>
        <select aria-label={action.kind === 'mergeFolder' ? '目标分类' : '上级分类'} disabled={saving} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
          <option value="">{action.kind === 'mergeFolder' ? '请选择目标分类' : '顶层分类'}</option>
          {targets.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label> : null}
      {action.kind === 'moveFolder' ? <p className="library-dialog-description">移动“{folder?.name}”及其子分类，保留所有论文归属，不移动磁盘原文件。</p> : null}
      {action.kind === 'mergeFolder' ? <p className="library-dialog-description">将“{folder?.name}”的论文和子分类合并到目标分类，同名子分类会合并。保留所有论文与唯一 PDF 副本。</p> : null}
      {action.kind === 'deleteFolder' ? <p className="library-dialog-description">删除“{folder?.name}”及全部子分类，仅移除分类关系。保留所有论文、批注与 PDF 文件。</p> : null}
      {action.kind === 'deletePapers' ? <p className="library-dialog-description">将删除选中的 {action.paperIds.length} 篇文献及库内 PDF 副本、索引、批注和书签，并从所有分类移除。不会删除磁盘上的原始 PDF。此操作无法撤销。</p> : null}
      {action.kind === 'encryptFolder' ? <p className="library-dialog-description">保护“{folder?.name}”及子分类中的库内 PDF、索引与批注。同一论文的所有分类入口都会一起锁定。磁盘原始 PDF 和手工分类名称保持不变；请妥善保管密码。</p> : null}
      {action.kind === 'unlockVault' ? <p className="library-dialog-description">解锁“{vaultFolder?.name}”及其子分类，本次会话可阅读其中的论文。</p> : null}
      {action.kind === 'decryptVault' ? <p className="library-dialog-description">解除“{vaultFolder?.name}”及其子分类的加密。库内 PDF、索引与批注将以明文保存，磁盘原始 PDF 不受影响。</p> : null}
      {action.kind === 'reindex' ? <p className="library-dialog-description">重新提取选中 {action.paperIds.length} 篇 PDF 的信息和全文。人工编辑的字段会保留；若原 PDF 有打开密码，请在下方填写，密码不会保存。</p> : null}
      {passwordAction ? <label>
        <span>{action.kind === 'reindex' ? 'PDF 打开密码（可选）' : '文件夹密码'}</span>
        <input type="password" aria-label={action.kind === 'reindex' ? 'PDF 打开密码（可选）' : '文件夹密码'} data-autofocus value={password} minLength={action.kind === 'reindex' ? undefined : 8} required={action.kind !== 'reindex'} autoComplete="off" disabled={saving} onChange={(event) => setPassword(event.target.value)} />
        {action.kind !== 'reindex' ? <small>至少 8 个字符</small> : null}
      </label> : null}
      {action.kind === 'encryptFolder' ? <label><span>再次输入密码</span><input type="password" aria-label="再次输入密码" value={repeatedPassword} minLength={8} required autoComplete="off" disabled={saving} onChange={(event) => setRepeatedPassword(event.target.value)} /></label> : null}
      {action.kind === 'categorize' ? <>
        <label><span>归类方式</span><select aria-label="归类方式" value={categoryMode} disabled={saving} onChange={(event) => setCategoryMode(event.target.value as typeof categoryMode)}><option value="add">追加分类，保留已有归属</option><option value="move">移动分类，替换已有归属</option><option value="remove">移出所选分类</option></select></label>
        <p className="library-dialog-description">已选 {action.paperIds.length} 篇文献，可同时选择多个分类。每篇论文只保留一份 PDF。</p>
        <fieldset className="library-category-options"><legend>目标分类（可多选）</legend>
          {options.length ? options.map((option) => <label key={option.id}><input type="checkbox" checked={categoryIds.includes(option.id)} disabled={saving} onChange={(event) => setCategoryIds((current) => event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))} /><span>{option.label}</span></label>) : <p>暂无分类，请先创建分类文件夹。</p>}
        </fieldset>
      </> : null}
      {error ? <p className="library-error" role="alert">{error}</p> : null}
      <footer className="library-dialog-actions">
        <button type="button" data-autofocus={action.kind === 'deleteFolder' || action.kind === 'deletePapers' || action.kind === 'decryptVault' ? true : undefined} disabled={saving} onClick={onClose}>取消</button>
        <button type="submit" className={action.kind === 'deleteFolder' || action.kind === 'deletePapers' ? 'library-danger' : 'library-primary'} disabled={saving || (action.kind === 'categorize' && options.length === 0)}>{saving ? '处理中…' : confirmLabels[action.kind]}</button>
      </footer>
    </form>
  </LibraryDialog>;
}
