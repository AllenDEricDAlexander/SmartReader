import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaperPreview } from './PaperPreview';
import { paperFixture } from './libraryUiTestUtils';

describe('paper preview', () => {
  it('shows complete academic information, actual reading time and navigable annotations', () => {
    const paper = paperFixture();
    paper.annotations = [{ id: -1, documentKey: 'paper:paper-1', page: 2, type: 'note', color: '#facc15', text: '个人研究批注', quote: '关键结论', areas: [], createdAt: paper.addedAt, updatedAt: paper.updatedAt }];
    const onOpenPage = vi.fn();
    render(<PaperPreview paper={paper} onOpenPage={onOpenPage} />);
    for (const label of ['论文标题', '作者', '发表期刊', '发表年份', 'DOI', '摘要', '关键词', '研究主题', '收录状态']) {
      expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('2 分 5 秒')).toBeInTheDocument();
    expect(screen.getByText(/预计阅读/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /打开批注.*第 2 页/ }));
    expect(onOpenPage).toHaveBeenCalledWith(2);
    expect(screen.getByText('个人研究批注')).toBeInTheDocument();
  });

  it('prioritizes frequently expanded fields and counts only an explicit expansion', async () => {
    const onFieldView = vi.fn();
    const paper = paperFixture();
    const { rerender } = render(<PaperPreview paper={paper} fieldUsage={{ doi: 10 }} onFieldView={onFieldView} />);
    const fields = screen.getByLabelText('论文信息项');
    expect(within(fields).getAllByRole('button')[0]).toHaveAccessibleName(/DOI/);
    expect(onFieldView).not.toHaveBeenCalled();
    const doi = within(fields).getByRole('button', { name: /DOI/ });
    fireEvent.click(doi);
    await waitFor(() => expect(onFieldView).toHaveBeenCalledWith('doi'));
    fireEvent.click(doi);
    expect(onFieldView).toHaveBeenCalledTimes(1);
    rerender(<PaperPreview paper={{ ...paper, favorite: true }} fieldUsage={{ doi: 11 }} onFieldView={onFieldView} />);
    expect(onFieldView).toHaveBeenCalledTimes(1);
  });

  it('provides fixed and closed preview controls and reports action errors', async () => {
    const onModeChange = vi.fn();
    render(<PaperPreview paper={paperFixture()} mode="hover" onModeChange={onModeChange} onToggleFavorite={async () => { throw new Error('收藏保存失败'); }} />);
    fireEvent.click(screen.getByRole('button', { name: '固定预览' }));
    expect(onModeChange).toHaveBeenCalledWith('pinned');
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭预览' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(onModeChange).toHaveBeenCalledWith('off');
    await waitFor(() => expect(screen.getByRole('button', { name: '收藏文献' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '收藏文献' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('收藏保存失败'));
  });
});
