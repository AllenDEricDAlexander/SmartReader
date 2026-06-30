import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeQuickStart } from './HomeQuickStart';

describe('HomeQuickStart', () => {
  it('opens the browser PDF picker from the visible chooser button', () => {
    renderApp(<HomeQuickStart onOpenPdf={vi.fn()} onBrowserFileChange={vi.fn()} />);

    const input = screen.getByLabelText('选择 PDF 文件');
    const clickInput = vi.spyOn(input, 'click').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: '选择 PDF 文件' }));

    expect(clickInput).toHaveBeenCalledTimes(1);
  });

  it('falls back to the browser PDF picker when native PDF opening fails', async () => {
    const onOpenPdf = vi.fn().mockRejectedValue(new Error('native dialog unavailable'));
    renderApp(<HomeQuickStart onOpenPdf={onOpenPdf} onBrowserFileChange={vi.fn()} />);

    const input = screen.getByLabelText('选择 PDF 文件');
    const clickInput = vi.spyOn(input, 'click').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    await waitFor(() => {
      expect(clickInput).toHaveBeenCalledTimes(1);
    });
  });
});
