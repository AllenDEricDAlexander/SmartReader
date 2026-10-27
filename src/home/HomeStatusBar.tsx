import { CheckCircle2, Info } from 'lucide-react';
import { CheckUpdatesButton } from '../settings/CheckUpdatesButton';
import { ViewControls } from '../viewer/ViewControls';
import type { HomeTaskStatus } from './homeTypes';

type HomeStatusBarProps = {
  scale: number;
  disabled?: boolean;
  taskStatus?: HomeTaskStatus;
  onScaleChange(scale: number): void;
  onCheckUpdates?(): void | Promise<void>;
};

const taskStatusLabels: Record<HomeTaskStatus, string> = {
  idle: '无任务运行中',
  opening: '正在打开文件',
  importing: '正在导入文献',
  caching: '正在更新缓存',
  error: '任务异常',
};

export function HomeStatusBar({
  scale,
  disabled,
  taskStatus = 'idle',
  onScaleChange,
  onCheckUpdates,
}: HomeStatusBarProps) {
  return (
    <footer className="home-status-bar" aria-label="首页状态栏">
      <div className="home-status-left">
        <span className="local-mode-dot" aria-hidden="true" />
        <span>本地模式</span>
        <span aria-hidden="true">·</span>
        <span>所有数据保存在本地</span>
        <Info size={14} aria-hidden="true" />
      </div>
      <div className="home-status-right">
        <span className={taskStatus === 'error' ? 'home-task-status error' : 'home-task-status'}>
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>{taskStatusLabels[taskStatus]}</span>
        </span>
        <ViewControls
          label="首页"
          scale={scale}
          disabled={disabled}
          canZoomIn={scale < 2}
          canZoomOut={scale > 0.5}
          onZoomIn={() => onScaleChange(Math.min(2, Math.round((scale + 0.1) * 100) / 100))}
          onZoomOut={() => onScaleChange(Math.max(0.5, Math.round((scale - 0.1) * 100) / 100))}
          onReset={() => onScaleChange(1)}
        >
          <CheckUpdatesButton onCheckUpdates={onCheckUpdates} />
        </ViewControls>
      </div>
    </footer>
  );
}

export type { HomeStatusBarProps };
