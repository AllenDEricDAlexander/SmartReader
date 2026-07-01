import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeDashboard } from './HomeDashboard';

function renderDashboard(overrides: Partial<ComponentProps<typeof HomeDashboard>> = {}) {
  const props = {
    recentDocuments: [],
    favoriteDocuments: [],
    onOpenPdf: vi.fn(),
    onBrowserFileChange: vi.fn(),
    onReopenRecentDocument: vi.fn(),
    onToggleFavorite: vi.fn(),
    canOpenNativePdf: () => true,
    onOpenSettings: vi.fn(),
    onOpenTags: vi.fn(),
    ...overrides,
  };

  renderApp(<HomeDashboard {...props} />);
  const input = screen.getByLabelText('选择 PDF 文件') as HTMLInputElement;
  const clickInput = vi.spyOn(input, 'click').mockImplementation(() => undefined);

  return { props, input, clickInput };
}

describe('HomeDashboard', () => {
  it('owns a single hidden PDF file input for home open actions', () => {
    const { input } = renderDashboard();

    expect(screen.getAllByLabelText('选择 PDF 文件')).toHaveLength(1);
    expect(input).toHaveClass('file-picker-input');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'application/pdf,.pdf');
    expect(input).toHaveAttribute('tabindex', '-1');
  });

  it('clicks the shared PDF input synchronously when native open is unavailable', () => {
    const onOpenPdf = vi.fn();
    const { clickInput } = renderDashboard({ onOpenPdf, canOpenNativePdf: () => false });

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));

    expect(clickInput).toHaveBeenCalledTimes(1);
    expect(onOpenPdf).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    expect(clickInput).toHaveBeenCalledTimes(2);
    expect(onOpenPdf).not.toHaveBeenCalled();
  });

  it('falls back to the shared PDF input when native open rejects asynchronously', async () => {
    const onOpenPdf = vi.fn().mockRejectedValue(new Error('native dialog failed'));
    const { clickInput } = renderDashboard({ onOpenPdf, canOpenNativePdf: () => true });

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

    expect(onOpenPdf).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(clickInput).toHaveBeenCalledTimes(2);
    });
  });

  it('falls back to the shared PDF input when native open throws synchronously', () => {
    const onOpenPdf = vi.fn(() => {
      throw new Error('native dialog failed');
    });
    const { clickInput } = renderDashboard({ onOpenPdf, canOpenNativePdf: () => true });

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));

    expect(onOpenPdf).toHaveBeenCalledTimes(1);
    expect(clickInput).toHaveBeenCalledTimes(1);
  });

  it('opens the shared PDF input directly from the quick-start chooser', () => {
    const onOpenPdf = vi.fn();
    const { clickInput } = renderDashboard({ onOpenPdf });

    fireEvent.click(screen.getByRole('button', { name: '选择 PDF 文件' }));

    expect(clickInput).toHaveBeenCalledTimes(1);
    expect(onOpenPdf).not.toHaveBeenCalled();
  });
});
