import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdfViewerBridge, type PdfRenderer } from './PdfViewerBridge';

describe('PdfViewerBridge', () => {
  it('shows an empty message without a source', () => {
    render(<PdfViewerBridge source={null} onProgressChange={vi.fn()} />);

    expect(screen.getByText('No PDF selected')).toBeInTheDocument();
  });

  it('passes source and callbacks to the renderer', () => {
    const renderer: PdfRenderer = ({ fileUrl, onPageChange, onZoomChange }) => (
      <button
        type="button"
        onClick={() => {
          onPageChange(4, 10);
          onZoomChange(1.25);
        }}
      >
        Render {fileUrl}
      </button>
    );
    const onProgressChange = vi.fn();

    render(
      <PdfViewerBridge
        source={{ sessionId: 'session-a', url: 'blob:book' }}
        renderer={renderer}
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
  });
});
