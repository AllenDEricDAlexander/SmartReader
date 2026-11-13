import { fireEvent, screen, within } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument();
  });

  it('zooms immediately and opens presets only from the percentage control', () => {
    const onScaleChange = vi.fn();
    renderApp(
      <HomeStatusBar scale={1} taskStatus="importing" onScaleChange={onScaleChange} />,
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('正在导入文献')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onScaleChange).toHaveBeenLastCalledWith(1.1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onScaleChange).toHaveBeenLastCalledWith(0.9);
    const percentage = screen.getByRole('button', { name: '打开首页视图控制，当前缩放 100%' });
    fireEvent.click(percentage);
    const presets = within(screen.getByRole('dialog', { name: '首页视图控制' }));
    expect(presets.getAllByRole('button', { name: /^\d+%$/ }).map((button) => button.textContent))
      .toEqual(['25%', '50%', '75%', '100%', '125%', '150%', '200%', '300%']);
    expect(presets.getByRole('button', { name: '100%' })).toHaveAttribute('aria-pressed', 'true');
    expect(presets.queryByRole('button', { name: '检查更新' })).not.toBeInTheDocument();
    fireEvent.click(presets.getByRole('button', { name: '300%' }));
    expect(onScaleChange).toHaveBeenLastCalledWith(3);
    expect(percentage).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(screen.getByRole('status')).toHaveTextContent('当前版本暂未接入自动检查更新。');
    fireEvent.click(percentage);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开首页视图控制，当前缩放 100%' })).toHaveFocus();
  });

  it('prevents zoom changes outside supported bounds or during a save', () => {
    const onScaleChange = vi.fn();
    const { rerender } = renderApp(<HomeStatusBar scale={3} onScaleChange={onScaleChange} />);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    rerender(<HomeStatusBar scale={0.25} onScaleChange={onScaleChange} />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    rerender(<HomeStatusBar scale={1} disabled onScaleChange={onScaleChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onScaleChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '打开首页视图控制，当前缩放 100%' }));
    expect(screen.getByRole('button', { name: '100%' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled();
  });
});
