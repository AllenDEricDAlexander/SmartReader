import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdfViewerBridge, type PdfRenderer } from './PdfViewerBridge';
import { ViewerController } from './viewerController';

describe('PdfViewerBridge', () => {
  it('shows an empty message without a source', () => {
    render(<PdfViewerBridge source={null} onProgressChange={vi.fn()} />);

    expect(screen.getByText('No PDF selected')).toBeInTheDocument();
  });

  it('passes source and callbacks to the renderer', () => {
    const renderer: PdfRenderer = ({
      annotations,
      fileUrl,
      onHighlightSelection,
      onPageChange,
      onZoomChange,
    }) => (
      <button
        type="button"
        onClick={() => {
          onPageChange(4, 10);
          onZoomChange(1.25);
          onHighlightSelection?.({
            selectedText: annotations[0]?.quote ?? '',
            page: 4,
            areas: [{ pageIndex: 3, top: 1, left: 2, height: 3, width: 4 }],
          });
        }}
      >
        Render {fileUrl}
      </button>
    );
    const onProgressChange = vi.fn();
    const onHighlightSelection = vi.fn();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        annotations={[
          {
            id: 1,
            documentKey: 'desktop:/tmp/book.pdf',
            page: 4,
            type: 'highlight',
            color: '#facc15',
            text: null,
            quote: 'Selected text',
            areas: [{ pageIndex: 3, top: 1, left: 2, height: 3, width: 4 }],
            createdAt: '2026-06-16T00:00:00Z',
            updatedAt: '2026-06-16T00:00:00Z',
          },
        ]}
        renderer={renderer}
        onHighlightSelection={onHighlightSelection}
        onProgressChange={onProgressChange}
      />,
    );

    screen.getByText('Render blob:book').click();

    expect(onProgressChange).toHaveBeenCalledWith({
      sessionId: 'session-a',
      page: 4,
      totalPages: 10,
      zoom: 1.25,
    });
    expect(onHighlightSelection).toHaveBeenCalledWith({
      selectedText: 'Selected text',
      page: 4,
      areas: [{ pageIndex: 3, top: 1, left: 2, height: 3, width: 4 }],
    });
  });

  it('binds and clears a provided viewer controller', () => {
    const renderer: PdfRenderer = () => <div>Rendered PDF</div>;
    const controller = new ViewerController();
    const { unmount } = render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
        controller={controller}
        onProgressChange={vi.fn()}
      />,
    );

    expect(controller.fitPage()).toBe(true);

    unmount();

    expect(controller.fitPage()).toBe(false);
  });
});
