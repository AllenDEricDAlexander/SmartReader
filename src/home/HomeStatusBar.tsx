import { CheckCircle2, ChevronDown, Info, ZoomIn } from 'lucide-react';
import type { HomeTaskStatus } from './homeTypes';

type HomeStatusBarProps = {
  viewScale?: string;
  taskStatus?: HomeTaskStatus;
  onOpenViewControls?(): void;
};

const taskStatusLabels: Record<HomeTaskStatus, string> = {
  idle: '无任务运行中',
  opening: '正在打开文件',
  importing: '正在导入文献',
  caching: '正在更新缓存',
  error: '任务异常',
};

export function HomeStatusBar({
  viewScale = '125%',
  taskStatus = 'idle',
  onOpenViewControls,
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
        <button
          type="button"
          className="home-view-scale"
          aria-label={`打开首页视图控制，当前缩放 ${viewScale}`}
          onClick={onOpenViewControls}
        >
          <span>{viewScale}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="home-status-icon-button"
          aria-label="打开首页视图控制"
          onClick={onOpenViewControls}
        >
          <ZoomIn size={15} />
        </button>
        <span className={taskStatus === 'error' ? 'home-task-status error' : 'home-task-status'}>
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>{taskStatusLabels[taskStatus]}</span>
        </span>
      </div>
    </footer>
  );
}

export type { HomeStatusBarProps };
