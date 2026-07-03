import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { HomeStatusBar } from './HomeStatusBar';

describe('HomeStatusBar', () => {
  it('renders local mode, view scale, and idle task status', () => {
    renderApp(<HomeStatusBar />);

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

  it('renders supplied task state and forwards view-control action', () => {
    const onOpenViewControls = vi.fn();
    renderApp(
      <HomeStatusBar viewScale="100%" taskStatus="importing" onOpenViewControls={onOpenViewControls} />,
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('正在导入文献')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开首页视图控制，当前缩放 100%' }));
    fireEvent.click(screen.getByRole('button', { name: '打开首页视图控制' }));

    expect(onOpenViewControls).toHaveBeenCalledTimes(2);
  });
});
