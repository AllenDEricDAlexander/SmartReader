import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeActionNotice } from './HomeActionNotice';

describe('HomeActionNotice', () => {
  it('renders a dismissible fallback notice', () => {
    const onClose = vi.fn();

    renderApp(
      <HomeActionNotice
        title="定位文件功能待补充"
        message="定位文件将在最近文件管理功能中补充。"
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: '定位文件功能待补充' })).toBeInTheDocument();
    expect(screen.getByText('定位文件将在最近文件管理功能中补充。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports a confirmation action', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    renderApp(
      <HomeActionNotice
        title="清除记录"
        message="当前版本不会直接清空记录。确认后将展示功能待补充说明。"
        confirmLabel="确认"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses the confirm action when the notice opens', () => {
    renderApp(
      <HomeActionNotice
        title="清除记录"
        message="当前版本不会直接清空记录。确认后将展示功能待补充说明。"
        confirmLabel="确认"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '确认' })).toHaveFocus();
  });

  it('focuses the close action when there is no confirm action', () => {
    renderApp(
      <HomeActionNotice
        title="定位文件功能待补充"
        message="定位文件将在最近文件管理功能中补充。"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
  });

  it('closes the notice with Escape', () => {
    const onClose = vi.fn();

    renderApp(
      <HomeActionNotice
        title="定位文件功能待补充"
        message="定位文件将在最近文件管理功能中补充。"
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog', { name: '定位文件功能待补充' }), {
      key: 'Escape',
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab within close and confirm actions', () => {
    renderApp(
      <HomeActionNotice
        title="清除记录"
        message="当前版本不会直接清空记录。确认后将展示功能待补充说明。"
        confirmLabel="确认"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '清除记录' });
    const closeButton = screen.getByRole('button', { name: '关闭' });
    const confirmButton = screen.getByRole('button', { name: '确认' });

    confirmButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(confirmButton).toHaveFocus();
  });

  it('keeps focus trapped on close action when it is the only action', () => {
    renderApp(
      <HomeActionNotice
        title="定位文件功能待补充"
        message="定位文件将在最近文件管理功能中补充。"
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '定位文件功能待补充' });
    const closeButton = screen.getByRole('button', { name: '关闭' });

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });

  it('restores previous focus on unmount', () => {
    const previousButton = document.createElement('button');
    previousButton.textContent = '上一个焦点';
    document.body.appendChild(previousButton);
    previousButton.focus();

    const { unmount } = renderApp(
      <HomeActionNotice
        title="定位文件功能待补充"
        message="定位文件将在最近文件管理功能中补充。"
        onClose={vi.fn()}
      />,
    );

    unmount();

    expect(previousButton).toHaveFocus();
    previousButton.remove();
  });
});
