import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PdfRenderer } from '../viewer/PdfViewerBridge';
import { App } from './App';

const testViewerRenderer: PdfRenderer = ({ fileUrl }) => <div>PDF {fileUrl}</div>;

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a PDF from the native dialog and displays a tab', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    render(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
    });
  });

  it('does not create a duplicate tab for the same path', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openNativePdf = vi.fn().mockResolvedValue({
      source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileSize: 5,
      modifiedAt: '2026-06-15T00:00:00Z',
    });

    render(
      <App
        bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: 'book.pdf' })).toHaveLength(1);
    });
  });

  it('opens a dropped browser PDF file', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:drop');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = new File(['%PDF-1.7'], 'drop.pdf', { type: 'application/pdf' });

    render(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.drop(screen.getByLabelText('Reader workspace'), {
      dataTransfer: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'drop.pdf' })).toBeInTheDocument();
    });
  });

  it('runs viewer zoom shortcuts', () => {
    const viewerController = {
      jumpToPage: vi.fn(),
      searchNext: vi.fn(),
      searchPrevious: vi.fn(),
      zoomIn: vi.fn().mockReturnValue(true),
      zoomOut: vi.fn().mockReturnValue(true),
      fitWidth: vi.fn(),
      fitPage: vi.fn(),
    };

    render(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        viewerController={viewerController}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: '=', metaKey: true });
    fireEvent.keyDown(window, { key: '-', metaKey: true });

    expect(viewerController.zoomIn).toHaveBeenCalledTimes(1);
    expect(viewerController.zoomOut).toHaveBeenCalledTimes(1);
  });
});
