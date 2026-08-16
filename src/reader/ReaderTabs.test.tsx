import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChangeEventHandler, ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentSession } from '../documents/documentModels';
import { ReaderTabs } from './ReaderTabs';

type ReaderTabsTestProps = {
  sessions: DocumentSession[];
  activeSessionId: string | null;
  homeActive: boolean;
  canOpenNativePdf(): boolean;
  onOpenHome(): void;
  onOpenPdf(): boolean | void | Promise<boolean | void>;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onSelectSession(sessionId: string): void;
  onCloseSession(sessionId: string): void;
};

const ReaderTabsUnderTest = ReaderTabs as unknown as ComponentType<ReaderTabsTestProps>;

function createSession(id: string, title: string): DocumentSession {
  return {
    id,
    documentKey: `desktop:/tmp/${title}`,
    title,
    source: { kind: 'desktop-path', path: `/tmp/${title}`, name: title },
    page: 3,
    totalPages: 20,
    progress: 0.15,
    zoom: 1,
    history: { currentPage: 3, backStack: [], forwardStack: [] },
    status: 'ready',
    errorMessage: null,
    restored: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

const sessionA = createSession('session-a', 'A.pdf');
const sessionB = createSession('session-b', 'B.pdf');

function createProps(overrides: Partial<ReaderTabsTestProps> = {}): ReaderTabsTestProps {
  return {
    sessions: [sessionA, sessionB],
    activeSessionId: sessionA.id,
    homeActive: false,
    canOpenNativePdf: () => true,
    onOpenHome: vi.fn(),
    onOpenPdf: vi.fn().mockResolvedValue(true),
    onBrowserFileChange: vi.fn(),
    onSelectSession: vi.fn(),
    onCloseSession: vi.fn(),
    ...overrides,
  };
}

function renderTabs(overrides: Partial<ReaderTabsTestProps> = {}) {
  const props = createProps(overrides);
  return {
    ...render(<ReaderTabsUnderTest {...props} />),
    props,
  };
}

describe('ReaderTabs shared document navigation', () => {
  it('renders home, tabs, close siblings, and the new-file action', () => {
    renderTabs({ homeActive: true });

    expect(screen.getByLabelText('文档导航栏')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '首页' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('tablist', { name: '已打开文档' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /A\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /B\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭文档 A.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭文档 B.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开新文件' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: '已打开文档' }).querySelector('button button')).toBeNull();
  });

  it('dispatches home, tab selection, and close actions independently', () => {
    const onOpenHome = vi.fn();
    const onSelectSession = vi.fn();
    const onCloseSession = vi.fn();
    renderTabs({ onOpenHome, onSelectSession, onCloseSession });

    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    fireEvent.click(screen.getByRole('tab', { name: /B\.pdf/ }));
    fireEvent.click(screen.getByRole('button', { name: '关闭文档 A.pdf' }));

    expect(onOpenHome).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith(sessionB.id);
    expect(onSelectSession).not.toHaveBeenCalledWith(sessionA.id);
    expect(onCloseSession).toHaveBeenCalledWith(sessionA.id);
  });

  it('uses native open when supported and only falls back for rejection', async () => {
    const onOpenPdf = vi.fn().mockResolvedValue(true);
    renderTabs({ onOpenPdf });
    fireEvent.click(screen.getByRole('button', { name: '打开新文件' }));
    expect(onOpenPdf).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('从文档导航栏选择 PDF 文件')).not.toBeNull();

    const input = screen.getByLabelText('从文档导航栏选择 PDF 文件') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    expect(click).not.toHaveBeenCalled();

    const cancelled = vi.fn().mockResolvedValue(false);
    const cancelledView = renderTabs({ onOpenPdf: cancelled });
    fireEvent.click(screen.getAllByRole('button', { name: '打开新文件' })[1]);
    await waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
    expect(screen.getAllByLabelText('从文档导航栏选择 PDF 文件')[1]).toBeInTheDocument();
    cancelledView.unmount();
  });

  it('opens the browser picker when native capability is unavailable or rejects', async () => {
    const unsupportedView = renderTabs({ canOpenNativePdf: () => false });
    const unsupportedInput = screen.getByLabelText('从文档导航栏选择 PDF 文件') as HTMLInputElement;
    const unsupportedClick = vi.spyOn(unsupportedInput, 'click');
    fireEvent.click(screen.getByRole('button', { name: '打开新文件' }));
    expect(unsupportedClick).toHaveBeenCalledTimes(1);
    expect(unsupportedView.props.onOpenPdf).not.toHaveBeenCalled();
    unsupportedView.unmount();

    const onOpenPdf = vi.fn().mockRejectedValue(new Error('native unavailable'));
    renderTabs({ onOpenPdf });
    const rejectedInput = screen.getByLabelText('从文档导航栏选择 PDF 文件') as HTMLInputElement;
    const rejectedClick = vi.spyOn(rejectedInput, 'click');
    fireEvent.click(screen.getByRole('button', { name: '打开新文件' }));
    await waitFor(() => expect(rejectedClick).toHaveBeenCalledTimes(1));
  });

  it('focuses the next active tab or home after closing and scrolls active tabs into view', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const view = renderTabs({ activeSessionId: sessionB.id });
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '关闭文档 B.pdf' }));
    view.rerender(
      <ReaderTabsUnderTest
        {...createProps({ sessions: [sessionA], activeSessionId: sessionA.id })}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /A\.pdf/ }));

    fireEvent.click(screen.getByRole('button', { name: '关闭文档 A.pdf' }));
    view.rerender(
      <ReaderTabsUnderTest
        {...createProps({ sessions: [], activeSessionId: null, homeActive: true })}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '首页' }));

    view.rerender(
      <ReaderTabsUnderTest
        {...createProps({ activeSessionId: sessionB.id })}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });
});
