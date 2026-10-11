import { webcrypto } from 'node:crypto';
import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryUiFixture, paperFixture } from '../library/libraryUiTestUtils';
import { ViewerController } from '../viewer/viewerController';
import type { PdfRenderer, PdfRendererProps } from '../viewer/PdfViewerBridge';
import { LibraryCompareWorkspace } from './LibraryCompareWorkspace';

function MockPdf({ fileUrl, annotations, onPageChange, onZoomChange, onLoadError, onHighlightSelection }: PdfRendererProps) {
  useEffect(() => { onPageChange(1, 10); }, [fileUrl, onPageChange]);
  return <div data-testid="rendered-pdf" data-url={fileUrl}>
    <span>{onHighlightSelection ? '可新增批注' : '只读批注'}</span>
    <span>批注数量 {annotations.length}</span>
    <button type="button" onClick={() => onPageChange(4, 10)}>阅读到第 4 页</button>
    <button type="button" onClick={() => onZoomChange(1.5)}>缩放到 150%</button>
    <button type="button" onClick={() => onLoadError?.({ status: 'error', message: 'PDF 内容损坏' })}>模拟渲染错误</button>
  </div>;
}
const renderer: PdfRenderer = (props) => <MockPdf {...props} />;
const side = (name: string) => within(screen.getByRole('region', { name: `${name}文献对比` }));

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  let sequence = 0;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:compare-${++sequence}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('library PDF comparison', () => {
  it('opens distinct default papers and keeps both page and zoom state independent', async () => {
    const { library } = await libraryUiFixture();
    const jump = vi.spyOn(ViewerController.prototype, 'jumpToPage');
    const fit = vi.spyOn(ViewerController.prototype, 'fitPage');
    render(<LibraryCompareWorkspace library={library} onClose={vi.fn()} renderer={renderer} />);
    await waitFor(() => expect(screen.getAllByTestId('rendered-pdf')).toHaveLength(2));
    expect(screen.getByRole('combobox', { name: '左侧文献' })).toHaveValue('paper-1');
    expect(screen.getByRole('combobox', { name: '右侧文献' })).toHaveValue('paper-2');
    fireEvent.click(side('左侧').getByRole('button', { name: '阅读到第 4 页' }));
    expect(screen.getByRole('spinbutton', { name: '左侧页码' })).toHaveValue(4);
    expect(screen.getByRole('spinbutton', { name: '右侧页码' })).toHaveValue(1);
    fireEvent.click(side('右侧').getByRole('button', { name: '缩放到 150%' }));
    expect(screen.getByLabelText('左侧缩放比例')).toHaveTextContent('100%');
    expect(screen.getByLabelText('右侧缩放比例')).toHaveTextContent('150%');
    fireEvent.change(screen.getByLabelText('左侧页码'), { target: { value: '8' } });
    fireEvent.click(side('左侧').getByRole('button', { name: '跳转' }));
    fireEvent.change(screen.getByLabelText('右侧页码'), { target: { value: '3' } });
    fireEvent.click(side('右侧').getByRole('button', { name: '跳转' }));
    expect(jump.mock.calls).toEqual([[8], [3]]);
    expect(jump.mock.contexts[0]).not.toBe(jump.mock.contexts[1]);
    fireEvent.click(side('左侧').getByRole('button', { name: '适合页面' }));
    expect(fit.mock.contexts[0]).toBe(jump.mock.contexts[0]);
    expect(screen.getAllByText('只读批注')).toHaveLength(2);
  });

  it('releases replaced and unmounted blob URLs and does not reload PDFs for reading updates', async () => {
    const { library } = await libraryUiFixture();
    const read = vi.spyOn(library, 'readPdf');
    const view = render(<LibraryCompareWorkspace library={library} onClose={vi.fn()} renderer={renderer} />);
    await waitFor(() => expect(screen.getAllByTestId('rendered-pdf')).toHaveLength(2));
    const firstUrl = side('左侧').getByTestId('rendered-pdf').getAttribute('data-url');
    await act(() => library.recordReading('paper-1', 15, 2, 1.3));
    expect(read).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByRole('combobox', { name: '左侧文献' }), { target: { value: 'paper-2' } });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(side('左侧').getByTestId('rendered-pdf')).not.toHaveAttribute('data-url', firstUrl));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it('renders current annotations as read-only without reading or writing another copy of the PDF', async () => {
    const paper = paperFixture();
    paper.annotations = [{ id: -1, documentKey: `paper:${paper.id}`, page: 2, type: 'note', color: '#fff',
      text: 'Private research note', quote: 'Source evidence', areas: [], createdAt: paper.addedAt, updatedAt: paper.updatedAt }];
    const { library } = await libraryUiFixture([paper, paperFixture('paper-2')]);
    const read = vi.spyOn(library, 'readPdf');
    render(<LibraryCompareWorkspace library={library} onClose={vi.fn()} renderer={renderer} />);
    await waitFor(() => expect(screen.getAllByTestId('rendered-pdf')).toHaveLength(2));
    expect(side('左侧').getByText('批注数量 1')).toBeInTheDocument();
    expect(side('左侧').getByText('Private research note')).toBeInTheDocument();
    expect(screen.queryByText('可新增批注')).not.toBeInTheDocument();
    await act(() => library.updatePaper(paper.id, { annotations: [] }));
    expect(side('左侧').getByText('批注数量 0')).toBeInTheDocument();
    expect(screen.queryByText('Private research note')).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reports read and rendering errors, supports retry, and leaves the other pane usable', async () => {
    const { library } = await libraryUiFixture();
    vi.spyOn(library, 'readPdf').mockRejectedValueOnce(new Error('PDF 文件读取失败'));
    render(<LibraryCompareWorkspace library={library} onClose={vi.fn()} renderer={renderer} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF 文件读取失败');
    expect(side('右侧').getByTestId('rendered-pdf')).toBeInTheDocument();
    fireEvent.click(side('左侧').getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(screen.getAllByTestId('rendered-pdf')).toHaveLength(2));
    fireEvent.click(side('左侧').getByRole('button', { name: '模拟渲染错误' }));
    expect(side('左侧').getByRole('alert')).toHaveTextContent('PDF 内容损坏');
    expect(side('右侧').getByTestId('rendered-pdf')).toBeInTheDocument();
    fireEvent.click(side('左侧').getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(screen.getAllByTestId('rendered-pdf')).toHaveLength(2));
  });

  it('revokes both affected pane URLs and removes PDF content and annotations immediately on lock', async () => {
    const paper = paperFixture();
    paper.annotations = [{ id: -1, documentKey: `paper:${paper.id}`, page: 1, type: 'note', color: '#fff',
      text: 'Private research note', quote: null, areas: [], createdAt: paper.addedAt, updatedAt: paper.updatedAt }];
    const { library } = await libraryUiFixture([paper, paperFixture('paper-2')]);
    const folder = await library.createFolder('Private');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'strong password');
    render(<LibraryCompareWorkspace library={library} onClose={vi.fn()} renderer={renderer} />);
    await waitFor(() => expect(screen.getAllByTestId('rendered-pdf')).toHaveLength(2));
    fireEvent.change(screen.getByRole('combobox', { name: '右侧文献' }), { target: { value: paper.id } });
    await waitFor(() => expect(screen.getAllByText('Private research note')).toHaveLength(2));
    const urls = screen.getAllByTestId('rendered-pdf').map((node) => node.getAttribute('data-url'));
    await act(() => library.lockVault(vault.id));
    expect(screen.queryByTestId('rendered-pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('Private research note')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '左侧文献' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '右侧文献' })).toHaveValue('');
    for (const url of urls) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    await act(() => library.unlockVault(vault.id, 'strong password'));
    expect(screen.queryByTestId('rendered-pdf')).not.toBeInTheDocument();
  });

  it('discards a late read result after lock and unlock without recreating a URL or selecting the paper', async () => {
    const { library } = await libraryUiFixture();
    const folder = await library.createFolder('Private');
    await library.categorize(['paper-1'], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'strong password');
    let resolveRead: (bytes: Uint8Array) => void = () => undefined;
    vi.spyOn(library, 'readPdf').mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
    render(<LibraryCompareWorkspace library={library} onClose={vi.fn()} renderer={renderer} />);
    await waitFor(() => expect(side('右侧').getByTestId('rendered-pdf')).toBeInTheDocument());
    await act(() => library.lockVault(vault.id));
    await act(() => library.unlockVault(vault.id, 'strong password'));
    await act(async () => { resolveRead(new TextEncoder().encode('%PDF-1.7 late content')); });
    expect(screen.getAllByTestId('rendered-pdf')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: '左侧文献' })).toHaveValue('');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('discards stale selection results and late reads after unmount', async () => {
    const { library } = await libraryUiFixture();
    let resolveRead: (bytes: Uint8Array) => void = () => undefined;
    vi.spyOn(library, 'readPdf').mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
    const view = render(<LibraryCompareWorkspace library={library} onClose={vi.fn()} renderer={renderer} />);
    await waitFor(() => expect(side('右侧').getByTestId('rendered-pdf')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: '左侧文献' }), { target: { value: 'paper-2' } });
    await waitFor(() => expect(screen.getAllByTestId('rendered-pdf')).toHaveLength(2));
    view.unmount();
    await act(async () => { resolveRead(new TextEncoder().encode('%PDF-1.7 late content')); });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('guides an empty library back to import and leaves a single-paper second pane unselected', async () => {
    const empty = await libraryUiFixture([]);
    const onClose = vi.fn();
    const view = render(<LibraryCompareWorkspace library={empty.library} onClose={onClose} renderer={renderer} />);
    expect(screen.getByText('暂无可用于对比的文献')).toBeInTheDocument();
    expect(screen.getByText(/请先在文献库导入 PDF/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '返回首页' })[1]);
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    const single = await libraryUiFixture([paperFixture()]);
    render(<LibraryCompareWorkspace library={single.library} onClose={onClose} renderer={renderer} />);
    await waitFor(() => expect(screen.getAllByTestId('rendered-pdf')).toHaveLength(1));
    expect(screen.getByRole('combobox', { name: '右侧文献' })).toHaveValue('');
    expect(screen.getByRole('spinbutton', { name: '右侧页码' })).toBeDisabled();
  });
});
