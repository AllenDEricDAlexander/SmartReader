import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeQuickStart } from './HomeQuickStart';

describe('HomeQuickStart', () => {
  it('forwards the visible chooser button to the parent picker bridge', () => {
    const onPickBrowserFile = vi.fn();
    renderApp(<HomeQuickStart onOpenPdf={vi.fn()} onPickBrowserFile={onPickBrowserFile} />);

    fireEvent.click(screen.getByRole('button', { name: '选择 PDF 文件' }));

    expect(onPickBrowserFile).toHaveBeenCalledTimes(1);
  });

  it('forwards the native PDF button to the parent opener', () => {
    const onOpenPdf = vi.fn();
    renderApp(<HomeQuickStart onOpenPdf={onOpenPdf} onPickBrowserFile={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    expect(onOpenPdf).toHaveBeenCalledTimes(1);
  });
});
