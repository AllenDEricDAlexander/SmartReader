import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryWorkspace } from './LibraryWorkspace';
import { libraryUiFixture, paperFixture } from './libraryUiTestUtils';
import type { AiService } from '../ai/aiService';

const services: AiService[] = [];
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { services.splice(0).forEach((ai) => ai.dispose()); });

async function setup(papers = [paperFixture(), { ...paperFixture('paper-2', '教育研究'), pages: [{ page: 1, text: 'Classroom education results.' }], pageCount: 1 }]) {
  const fixture = await libraryUiFixture(papers);
  services.push(fixture.ai);
  const onOpenPaper = vi.fn();
  const onImport = vi.fn();
  return { ...fixture, onOpenPaper, onImport };
}

describe('library workspace', () => {
  it('searches indexed pages and opens the matching page directly', async () => {
    const props = await setup();
    render(<LibraryWorkspace {...props} />);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索文献' }), { target: { value: 'synapse' } });
    const list = screen.getByRole('list', { name: '文献列表' });
    expect(within(list).queryByText('教育研究')).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: '打开匹配 第 2 页 认知研究' }));
    await waitFor(() => expect(props.onOpenPaper).toHaveBeenCalledWith('paper-1', 2));
  });

  it('creates nested folders and renames them through accessible forms', async () => {
    const props = await setup();
    render(<LibraryWorkspace {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '新建分类' }));
    let dialog = screen.getByRole('dialog', { name: '新建分类' });
    fireEvent.change(within(dialog).getByLabelText('分类名称'), { target: { value: '毕业论文' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建分类' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const parent = props.library.getView().snapshot.folders.find((folder) => folder.name === '毕业论文')!;
    fireEvent.change(screen.getByLabelText('文献分类筛选'), { target: { value: parent.id } });
    fireEvent.change(screen.getByLabelText('当前分类操作'), { target: { value: 'createChild' } });
    dialog = screen.getByRole('dialog', { name: '新建分类' });
    expect(within(dialog).getByLabelText('上级分类')).toHaveValue(parent.id);
    fireEvent.change(within(dialog).getByLabelText('分类名称'), { target: { value: '文献综述' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建分类' }));
    await waitFor(() => expect(props.library.getView().snapshot.folders.some((folder) => folder.name === '文献综述' && folder.parentId === parent.id)).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('当前分类操作'), { target: { value: 'renameFolder' } });
    dialog = screen.getByRole('dialog', { name: '重命名分类' });
    fireEvent.change(within(dialog).getByLabelText('分类名称'), { target: { value: '课题资料' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存名称' }));
    await waitFor(() => expect(props.library.getView().snapshot.folders.find((folder) => folder.id === parent.id)?.name).toBe('课题资料'));
  });

  it('favorites a selection and adds each paper to multiple folders without duplicating its file', async () => {
    const props = await setup();
    const first = await props.library.createFolder('课题一');
    const second = await props.library.createFolder('课题二');
    render(<LibraryWorkspace {...props} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 认知研究' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 教育研究' }));
    fireEvent.click(screen.getByRole('button', { name: '批量收藏' }));
    await waitFor(() => expect(props.library.getView().papers.every((paper) => paper.favorite)).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '追加分类' }));
    const dialog = screen.getByRole('dialog', { name: '批量归类' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '课题一' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '课题二' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认归类' }));
    await waitFor(() => expect(props.library.getView().snapshot.memberships['paper-1']).toEqual([first.id, second.id]));
    expect(props.library.getView().snapshot.memberships['paper-2']).toEqual([first.id, second.id]);
    expect(props.files.size).toBe(2);
  });

  it('confirms library-copy deletion and preserves papers when deleting a folder', async () => {
    const props = await setup();
    const folder = await props.library.createFolder('临时分类');
    await props.library.categorize(['paper-1'], [folder.id], 'add');
    render(<LibraryWorkspace {...props} />);
    fireEvent.change(screen.getByLabelText('文献分类筛选'), { target: { value: folder.id } });
    fireEvent.change(screen.getByLabelText('当前分类操作'), { target: { value: 'deleteFolder' } });
    let dialog = screen.getByRole('dialog', { name: '删除分类' });
    expect(within(dialog).getByText(/保留所有论文/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除分类' }));
    await waitFor(() => expect(props.library.getView().snapshot.folders).toHaveLength(0));
    expect(props.library.getView().papers).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 认知研究' }));
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }));
    dialog = screen.getByRole('dialog', { name: '删除文献' });
    expect(within(dialog).getByText(/不会删除磁盘上的原始 PDF/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除文献' }));
    await waitFor(() => expect(props.library.getPaper('paper-1')).toBeUndefined());
    expect(props.library.getPaper('paper-2')).toBeDefined();
  });

  it('keeps a fixed preview stable on hover, then closes and reopens it', async () => {
    const props = await setup();
    render(<LibraryWorkspace {...props} />);
    expect(within(screen.getByLabelText('文献预览')).getByRole('heading', { name: '认知研究' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '固定预览' }));
    await waitFor(() => expect(props.library.getView().snapshot.preferences.previewMode).toBe('pinned'));
    await act(async () => props.library.editMetadata('paper-2', { year: '2026' }));
    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'year' } });
    fireEvent.mouseEnter(screen.getByRole('listitem', { name: '文献 教育研究' }));
    expect(within(screen.getByLabelText('文献预览')).getByRole('heading', { name: '认知研究' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    await waitFor(() => expect(screen.queryByLabelText('文献预览')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '显示预览' }));
    await waitFor(() => expect(screen.getByLabelText('文献预览')).toBeInTheDocument());
  });

  it('removes locked paper details, edit drafts and search text immediately from the workspace', async () => {
    const props = await setup([paperFixture('secret', '私密研究标题')]);
    const folder = await props.library.createFolder('私密项目');
    await props.library.categorize(['secret'], [folder.id], 'move');
    const vault = await props.library.encryptFolder(folder.id, 'vault password');
    render(<LibraryWorkspace {...props} />);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索文献' }), { target: { value: '私密研究' } });
    fireEvent.click(screen.getByRole('button', { name: '编辑信息' }));
    expect(screen.getByRole('dialog', { name: '编辑文献信息' })).toBeInTheDocument();
    await act(async () => props.library.lockVault(vault.id));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('私密研究标题')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索文献' })).toHaveValue('');
    expect(screen.getByText(/1 篇文献已锁定/)).toBeInTheDocument();
  });

  it('shows actionable failures instead of silently ignoring unavailable AI configuration', async () => {
    const props = await setup();
    render(<LibraryWorkspace {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 补全 认知研究' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/AI 设置/));
    expect(props.library.getPaper('paper-1')?.indexStatus).toBe('ready');
  });

  it('moves a folder subtree and merges classifications while preserving both papers', async () => {
    const props = await setup();
    const first = await props.library.createFolder('项目甲');
    const second = await props.library.createFolder('项目乙');
    const child = await props.library.createFolder('综述', first.id);
    await props.library.categorize(['paper-1'], [child.id], 'add');
    await props.library.categorize(['paper-2'], [first.id], 'add');
    render(<LibraryWorkspace {...props} />);
    fireEvent.change(screen.getByLabelText('文献分类筛选'), { target: { value: child.id } });
    fireEvent.change(screen.getByLabelText('当前分类操作'), { target: { value: 'moveFolder' } });
    let dialog = screen.getByRole('dialog', { name: '移动分类' });
    fireEvent.change(within(dialog).getByLabelText('上级分类'), { target: { value: second.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认移动' }));
    await waitFor(() => expect(props.library.getView().snapshot.folders.find((folder) => folder.id === child.id)?.parentId).toBe(second.id));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('文献分类筛选'), { target: { value: first.id } });
    fireEvent.change(screen.getByLabelText('当前分类操作'), { target: { value: 'mergeFolder' } });
    dialog = screen.getByRole('dialog', { name: '合并分类' });
    expect(within(dialog).getByText(/保留所有论文/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('目标分类'), { target: { value: second.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认合并' }));
    await waitFor(() => expect(props.library.getView().snapshot.memberships['paper-2']).toEqual([second.id]));
    expect(props.library.getView().papers).toHaveLength(2);
    expect(props.library.getView().snapshot.memberships['paper-1']).toEqual([child.id]);
  });

  it('encrypts, locks, unlocks and decrypts a complete folder with visible password errors', async () => {
    const props = await setup([paperFixture()]);
    const folder = await props.library.createFolder('私密课题');
    await props.library.categorize(['paper-1'], [folder.id], 'add');
    render(<LibraryWorkspace {...props} />);
    fireEvent.change(screen.getByLabelText('文献分类筛选'), { target: { value: folder.id } });
    fireEvent.change(screen.getByLabelText('当前分类操作'), { target: { value: 'encryptFolder' } });
    let dialog = screen.getByRole('dialog', { name: '加密文件夹' });
    const password = within(dialog).getByLabelText('文件夹密码');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('minlength', '8');
    expect(within(dialog).getByText(/所有分类入口都会一起锁定/)).toBeInTheDocument();
    fireEvent.change(password, { target: { value: 'vault password' } });
    fireEvent.change(within(dialog).getByLabelText('再次输入密码'), { target: { value: 'other password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '加密保存' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('两次密码不一致'));
    fireEvent.change(within(dialog).getByLabelText('再次输入密码'), { target: { value: 'vault password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '加密保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(props.library.getView().snapshot.papers[0].kind).toBe('encrypted');
    fireEvent.click(screen.getByRole('button', { name: '锁定文件夹' }));
    await waitFor(() => expect(props.library.getPaper('paper-1')).toBeUndefined());
    fireEvent.click(screen.getByRole('button', { name: '解锁文件夹' }));
    dialog = screen.getByRole('dialog', { name: '解锁文件夹' });
    fireEvent.change(within(dialog).getByLabelText('文件夹密码'), { target: { value: 'wrong password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '解锁' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeInTheDocument());
    expect(props.library.getPaper('paper-1')).toBeUndefined();
    fireEvent.change(within(dialog).getByLabelText('文件夹密码'), { target: { value: 'vault password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '解锁' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('当前分类操作'), { target: { value: 'decryptVault' } });
    dialog = screen.getByRole('dialog', { name: '解除文件夹加密' });
    expect(within(dialog).getByText(/以明文保存/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认解除加密' }));
    await waitFor(() => expect(props.library.getView().snapshot.vaults).toHaveLength(0));
    expect(props.library.getView().snapshot.papers[0].kind).toBe('plain');
  });

  it('keeps failed index retries open and accepts a short original PDF password without saving it', async () => {
    const props = await setup([paperFixture()]);
    const retry = vi.spyOn(props.library, 'retryIndex').mockResolvedValue({ ...paperFixture(), indexStatus: 'error', indexError: 'PDF 密码错误' });
    render(<LibraryWorkspace {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '重新索引 认知研究' }));
    const dialog = screen.getByRole('dialog', { name: '重新建立索引' });
    const input = within(dialog).getByLabelText('PDF 打开密码（可选）');
    expect(input).not.toHaveAttribute('minlength');
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '开始索引' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('PDF 密码错误'));
    expect(retry).toHaveBeenCalledWith('paper-1', '123');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps reading available while AI enrichment is pending', async () => {
    const props = await setup();
    let complete: () => void = () => undefined;
    vi.spyOn(props.ai, 'enrich').mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    render(<LibraryWorkspace {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 补全 认知研究' }));
    expect(screen.getByRole('button', { name: '阅读 教育研究' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '阅读 教育研究' }));
    await waitFor(() => expect(props.onOpenPaper).toHaveBeenCalledWith('paper-2'));
    await act(async () => complete());
  });
});
