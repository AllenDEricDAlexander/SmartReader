import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeQuickStart } from './HomeQuickStart';

const nativeDrop = vi.hoisted(() => vi.fn());
vi.mock('../platform/nativeFileDrop', () => ({ listenForNativeFileDrop: nativeDrop }));
beforeEach(() => nativeDrop.mockReset().mockResolvedValue(null));

describe('HomeQuickStart', () => {
  it.each(['light', 'dark', 'eye-care'])('keeps the import prompt above a transparent hover target in the %s theme', (theme) => {
    const previousTheme = document.documentElement.getAttribute('data-theme');
    const style = document.createElement('style');
    // jsdom has no pointer compositor. The attribute keeps :hover specificity
    // while exercising the real global and component stylesheet together.
    style.textContent = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8')
      .replaceAll(':hover', '[data-test-hover]');
    document.head.appendChild(style);
    document.documentElement.setAttribute('data-theme', theme);
    try {
      renderApp(<HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={vi.fn()} onOpenFolder={vi.fn()} />);
      const dropzone = screen.getByRole('group', { name: 'PDF 拖拽区域' });
      const trigger = within(dropzone).getByRole('button', { name: '打开本地 PDF' });
      dropzone.setAttribute('data-test-hover', '');
      trigger.setAttribute('data-test-hover', '');
      expect(getComputedStyle(trigger).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(trigger).zIndex).toBe('0');
      expect(getComputedStyle(dropzone.querySelector('.quick-start-copy')!).zIndex).toBe('1');
      expect(within(dropzone).getByText('点击选择 PDF / 拖拽文件到此处')).toBeVisible();
      expect(within(dropzone).getByRole('button', { name: '选择文件夹' })).toBeVisible();
    } finally {
      style.remove();
      if (previousTheme === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', previousTheme);
    }
  });

  it('combines PDF, folder selection and drag-and-drop in one import area', () => {
    renderApp(
      <HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={vi.fn()} onOpenFolder={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: '快速开始' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开本地 PDF/ })).toBeInTheDocument();
    const dropzone = screen.getByRole('group', { name: 'PDF 拖拽区域' });
    expect(within(dropzone).getByText('点击选择 PDF / 拖拽文件到此处')).toBeInTheDocument();
    expect(within(dropzone).getAllByRole('button')).toHaveLength(2);
    expect(within(dropzone).getByRole('button', { name: '打开本地 PDF' })).toHaveClass('quick-start-file-trigger');
    expect(screen.getByRole('button', { name: /选择文件夹/ })).toBeInTheDocument();
  });

  it('opens a local PDF from the import area', () => {
    const onOpenPdf = vi.fn();
    renderApp(
      <HomeQuickStart onOpenPdf={onOpenPdf} onDropPdf={vi.fn()} onOpenFolder={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开本地 PDF/ }));

    expect(onOpenPdf).toHaveBeenCalledTimes(1);
  });

  it('marks the whole import area active and forwards dropped files', () => {
    const onDropPdf = vi.fn((event) => event.preventDefault());
    renderApp(
      <HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={onDropPdf} onOpenFolder={vi.fn()} />,
    );

    const dropCard = screen.getByRole('group', { name: 'PDF 拖拽区域' });
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

    fireEvent.drop(screen.getByRole('group', { name: 'PDF 拖拽区域' }), {
      dataTransfer: {
        files: [new File(['text'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    expect(onDropPdf).not.toHaveBeenCalled();
    expect(onRejectDrop).toHaveBeenCalledWith('仅支持 PDF 文件或文件夹');
  });

  it('accepts a folder drop even when its file list has no PDF entries', () => {
    const onDropPdf = vi.fn();
    const onRejectDrop = vi.fn();
    renderApp(<HomeQuickStart onOpenPdf={vi.fn()} onOpenFolder={vi.fn()} onDropPdf={onDropPdf} onRejectDrop={onRejectDrop} />);
    fireEvent.drop(screen.getByRole('group', { name: 'PDF 拖拽区域' }), {
      dataTransfer: { files: [], items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }] },
    });
    expect(onDropPdf).toHaveBeenCalledOnce();
    expect(onRejectDrop).not.toHaveBeenCalled();
  });

  it('forwards a native path drop once and removes its listener when leaving home', async () => {
    let drop!: (paths: string[]) => void;
    const stop = vi.fn();
    nativeDrop.mockImplementation(async (_element, onDrop) => { drop = onDrop; return stop; });
    const onDropPaths = vi.fn();
    const onDropPdf = vi.fn();
    const mounted = renderApp(<HomeQuickStart onOpenPdf={vi.fn()} onOpenFolder={vi.fn()} onDropPdf={onDropPdf} onDropPaths={onDropPaths} />);
    await waitFor(() => expect(nativeDrop).toHaveBeenCalledOnce());
    await act(async () => { drop(['/tmp/papers']); });
    fireEvent.drop(screen.getByRole('group', { name: 'PDF 拖拽区域' }), {
      dataTransfer: { files: [new File(['%PDF-1.7'], 'paper.pdf')] },
    });
    expect(onDropPaths).toHaveBeenCalledExactlyOnceWith(['/tmp/papers']);
    expect(onDropPdf).not.toHaveBeenCalled();
    mounted.unmount();
    await act(async () => { drop(['/tmp/late.pdf']); });
    expect(stop).toHaveBeenCalledOnce();
    expect(onDropPaths).toHaveBeenCalledOnce();
  });

  it('handles a drop over an inner button once without clicking it or bubbling to the parent', () => {
    let defaultPrevented = false;
    const onDropPdf = vi.fn((event) => {
      event.preventDefault();
      defaultPrevented = event.defaultPrevented;
    });
    const onParentDrop = vi.fn();
    const onOpenPdf = vi.fn();
    renderApp(
      <div onDrop={onParentDrop}>
        <HomeQuickStart onOpenPdf={onOpenPdf} onDropPdf={onDropPdf} onOpenFolder={vi.fn()} />
      </div>,
    );

    fireEvent.drop(screen.getByRole('button', { name: '打开本地 PDF' }), {
      dataTransfer: {
        files: [new File(['pdf'], 'sample.pdf', { type: 'application/pdf' })],
      },
    });

    expect(onDropPdf).toHaveBeenCalledTimes(1);
    expect(defaultPrevented).toBe(true);
    expect(onParentDrop).not.toHaveBeenCalled();
    expect(onOpenPdf).not.toHaveBeenCalled();
  });

  it('keeps the drag highlight between children and clears it when leaving the import area', () => {
    renderApp(<HomeQuickStart onOpenPdf={vi.fn()} onDropPdf={vi.fn()} onOpenFolder={vi.fn()} />);
    const dropzone = screen.getByRole('group', { name: 'PDF 拖拽区域' });
    const pdfButton = within(dropzone).getByRole('button', { name: '打开本地 PDF' });
    const folderButton = within(dropzone).getByRole('button', { name: '选择文件夹' });
    fireEvent.dragEnter(pdfButton);
    fireEvent.dragOver(pdfButton);
    expect(dropzone).toHaveClass('drag-active');
    fireEvent.dragEnter(folderButton);
    fireEvent.dragLeave(pdfButton);
    expect(dropzone).toHaveClass('drag-active');
    fireEvent.dragLeave(folderButton);
    expect(dropzone).not.toHaveClass('drag-active');
  });

  it('routes folder selection through the provided callback', () => {
    const onOpenFolder = vi.fn();
    const onOpenPdf = vi.fn();
    renderApp(
      <HomeQuickStart onOpenPdf={onOpenPdf} onDropPdf={vi.fn()} onOpenFolder={onOpenFolder} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /选择文件夹/ }));

    expect(onOpenFolder).toHaveBeenCalledTimes(1);
    expect(onOpenPdf).not.toHaveBeenCalled();
  });
});
