import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaperMetadataEditor } from './PaperMetadataEditor';
import { paperFixture } from './libraryUiTestUtils';

describe('paper metadata editor', () => {
  it('submits only changed fields so automatic fields remain eligible for later enrichment', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<PaperMetadataEditor paper={paperFixture()} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('论文标题'), { target: { value: '人工校正标题' } });
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '认知；记忆；认知' } });
    fireEvent.click(screen.getByRole('button', { name: '保存信息' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: '人工校正标题', keywords: ['认知', '记忆'] }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('blocks duplicate saves and keeps failed edits available for correction', async () => {
    let fail: (error: Error) => void = () => undefined;
    const onSave = vi.fn().mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    render(<PaperMetadataEditor paper={paperFixture()} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('发表年份'), { target: { value: '2024' } });
    fireEvent.click(screen.getByRole('button', { name: '保存信息' }));
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    fail(new Error('保存失败，请重试'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保存失败，请重试'));
    expect(screen.getByLabelText('发表年份')).toHaveValue('2024');
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('focuses the title, traps keyboard navigation and allows Escape to close', () => {
    const onClose = vi.fn();
    render(<PaperMetadataEditor paper={paperFixture()} onSave={vi.fn()} onClose={onClose} />);
    expect(screen.getByLabelText('论文标题')).toHaveFocus();
    const last = screen.getByRole('button', { name: '保存信息' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '关闭编辑文献信息' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close a newer dialog after the editor is unmounted while saving', async () => {
    let complete: () => void = () => undefined;
    const onClose = vi.fn();
    const onSave = vi.fn().mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
    const { unmount } = render(<PaperMetadataEditor paper={paperFixture()} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('论文标题'), { target: { value: '待保存' } });
    fireEvent.click(screen.getByRole('button', { name: '保存信息' }));
    unmount();
    complete();
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not overwrite automatic updates to fields the user did not edit', async () => {
    const paper = paperFixture();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { rerender } = render(<PaperMetadataEditor paper={paper} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('论文标题'), { target: { value: '人工标题' } });
    rerender(<PaperMetadataEditor paper={{ ...paper, metadata: { ...paper.metadata, authors: ['新识别的作者'] } }} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '保存信息' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: '人工标题' }));
  });
});
