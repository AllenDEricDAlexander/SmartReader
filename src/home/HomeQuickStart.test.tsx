import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeQuickStart } from './HomeQuickStart';

describe('HomeQuickStart', () => {
  it('renders the prototype three-card quick start layout', () => {
    renderApp(
      <HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={vi.fn()} onOpenFolder={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: '快速开始' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开本地 PDF/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /拖拽到这里/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /选择文件夹/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('PDF 拖拽区域')).not.toBeInTheDocument();
  });

  it('opens a local PDF from the first card', () => {
    const onOpenPdf = vi.fn();
    renderApp(
      <HomeQuickStart onOpenPdf={onOpenPdf} onDropPdf={vi.fn()} onOpenFolder={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    expect(onOpenPdf).toHaveBeenCalledTimes(1);
  });

  it('marks the drop card active and forwards dropped files', () => {
    const onDropPdf = vi.fn((event) => event.preventDefault());
    renderApp(
      <HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={onDropPdf} onOpenFolder={vi.fn()} />,
    );

    const dropCard = screen.getByRole('button', { name: /拖拽到这里/ });
    fireEvent.dragOver(dropCard);
    expect(dropCard).toHaveClass('drag-active');

    fireEvent.drop(dropCard, {
      dataTransfer: {
        files: [new File(['pdf'], 'sample.pdf', { type: 'application/pdf' })],
      },
    });

    expect(onDropPdf).toHaveBeenCalledTimes(1);
    expect(dropCard).not.toHaveClass('drag-active');
  });

  it('rejects non-PDF drops without forwarding to the reader drop handler', () => {
    const onDropPdf = vi.fn();
    const onRejectDrop = vi.fn();
    renderApp(
      <HomeQuickStart
        onOpenPdf={vi.fn()}
        onDropPdf={onDropPdf}
        onRejectDrop={onRejectDrop}
        onOpenFolder={vi.fn()}
      />,
    );

    fireEvent.drop(screen.getByRole('button', { name: /拖拽到这里/ }), {
      dataTransfer: {
        files: [new File(['text'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    expect(onDropPdf).not.toHaveBeenCalled();
    expect(onRejectDrop).toHaveBeenCalledWith('仅支持 PDF 文件');
  });

  it('keeps card drops from bubbling to parent drop handlers', () => {
    let defaultPrevented = false;
    const onDropPdf = vi.fn((event) => {
      event.preventDefault();
      defaultPrevented = event.defaultPrevented;
    });
    const onParentDrop = vi.fn();
    renderApp(
      <div onDrop={onParentDrop}>
        <HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={onDropPdf} onOpenFolder={vi.fn()} />
      </div>,
    );

    fireEvent.drop(screen.getByRole('button', { name: /拖拽到这里/ }), {
      dataTransfer: {
        files: [new File(['pdf'], 'sample.pdf', { type: 'application/pdf' })],
      },
    });

    expect(onDropPdf).toHaveBeenCalledTimes(1);
    expect(defaultPrevented).toBe(true);
    expect(onParentDrop).not.toHaveBeenCalled();
  });

  it('routes folder selection through the provided callback', () => {
    const onOpenFolder = vi.fn();
    renderApp(
      <HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={vi.fn()} onOpenFolder={onOpenFolder} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /选择文件夹/ }));

    expect(onOpenFolder).toHaveBeenCalledTimes(1);
  });
});
