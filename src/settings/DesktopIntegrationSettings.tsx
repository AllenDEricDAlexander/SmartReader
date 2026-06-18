import { FileCog, FolderOpen } from 'lucide-react';

export function DesktopIntegrationSettings() {
  return (
    <section className="settings-card" aria-labelledby="desktop-settings-title">
      <div className="panel-title">
        <FileCog size={16} />
        <h2 id="desktop-settings-title">桌面集成</h2>
      </div>
      <div className="settings-fact-grid">
        <div>
          <span>Open With</span>
          <strong>已监听桌面打开事件</strong>
          <small>系统传入 PDF 路径后会复用阅读工作区打开。</small>
        </div>
        <div>
          <span>PDF 文件关联</span>
          <strong>需要安装包配置</strong>
          <small>当前前端只能显示状态，不能直接修改系统关联。</small>
        </div>
      </div>
      <div className="settings-action-row">
        <button type="button" disabled aria-disabled="true">
          <FolderOpen size={14} />
          设为默认 PDF 应用
        </button>
        <button type="button" disabled aria-disabled="true">
          <FileCog size={14} />
          管理文件关联
        </button>
      </div>
    </section>
  );
}
