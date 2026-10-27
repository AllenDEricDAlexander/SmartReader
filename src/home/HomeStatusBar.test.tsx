import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeStatusBar } from './HomeStatusBar';

describe('HomeStatusBar', () => {
  it('renders local mode, view scale, and idle task status', () => {
    renderApp(<HomeStatusBar scale={1.25} onScaleChange={vi.fn()} />);

    expect(screen.getByRole('contentinfo', { name: '首页状态栏' })).toBeInTheDocument();
    expect(screen.getByText('本地模式')).toBeInTheDocument();
    expect(screen.getByText('所有数据保存在本地')).toBeInTheDocument();
    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(screen.getByText('无任务运行中')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '打开首页视图控制，当前缩放 125%' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开首页视图控制' })).toBeInTheDocument();
  });

  it('opens functional zoom controls with an update check and the supplied task state', () => {
    const onScaleChange = vi.fn();
    renderApp(
      <HomeStatusBar scale={1} taskStatus="importing" onScaleChange={onScaleChange} />,
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('正在导入文献')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开首页视图控制，当前缩放 100%' }));
    expect(screen.getByRole('dialog', { name: '首页视图控制' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onScaleChange).toHaveBeenLastCalledWith(1.1);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onScaleChange).toHaveBeenLastCalledWith(0.9);
    fireEvent.click(screen.getByRole('button', { name: '重置为 100%' }));
    expect(onScaleChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(screen.getByRole('status')).toHaveTextContent('当前版本暂未接入自动检查更新。');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开首页视图控制，当前缩放 100%' })).toHaveFocus();
  });

  it('prevents zoom changes outside supported bounds or during a save', () => {
    const onScaleChange = vi.fn();
    const { rerender } = renderApp(<HomeStatusBar scale={2} onScaleChange={onScaleChange} />);
    fireEvent.click(screen.getByRole('button', { name: '打开首页视图控制' }));
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    rerender(<HomeStatusBar scale={0.5} onScaleChange={onScaleChange} />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    rerender(<HomeStatusBar scale={1} disabled onScaleChange={onScaleChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onScaleChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重置为 100%' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled();
  });
});
