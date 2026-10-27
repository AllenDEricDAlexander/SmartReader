import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnnotationManagerWorkspace } from './AnnotationManagerWorkspace';

const sources = [
  { documentKey: 'paper:one', displayName: '库内文献', detail: 'one.pdf' },
  { documentKey: 'desktop:/old.pdf', displayName: '旧文献', detail: '/old.pdf' },
];
const base = { title: '笔记管理', annotations: [], error: null, canOpenAnnotation: () => true, onClose: vi.fn(), onOpenAnnotation: vi.fn() };

describe('notes management export', () => {
  it('exports the selected library and legacy documents together', async () => {
    const onExportNotes = vi.fn().mockResolvedValue(true);
    render(<AnnotationManagerWorkspace {...base} exportSources={sources} onExportNotes={onExportNotes} />);
    expect(screen.getByRole('button', { name: '导出笔记 PDF（0）' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择导出 库内文献' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择导出 旧文献' }));
    fireEvent.click(screen.getByRole('button', { name: '导出笔记 PDF（2）' }));
    await waitFor(() => expect(onExportNotes).toHaveBeenCalledWith(sources));
    expect(await screen.findByRole('status')).toHaveTextContent('笔记 PDF 已导出');
  });

  it('removes inaccessible selections and reports export failures', async () => {
    const onExportNotes = vi.fn().mockRejectedValue(new Error('保存失败'));
    const { rerender } = render(<AnnotationManagerWorkspace {...base} exportSources={sources} onExportNotes={onExportNotes} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择导出 库内文献' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择导出 旧文献' }));
    rerender(<AnnotationManagerWorkspace {...base} exportSources={[sources[1]]} onExportNotes={onExportNotes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '导出笔记 PDF（1）' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '导出笔记 PDF（1）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(onExportNotes).toHaveBeenCalledWith([sources[1]]);
  });
});
