import { Database, HardDrive } from 'lucide-react';

type CacheSettingsProps = {
  openSessionCount: number;
  recentDocumentCount: number;
};

export function CacheSettings({ openSessionCount, recentDocumentCount }: CacheSettingsProps) {
  return (
    <section className="settings-card" aria-labelledby="cache-settings-title">
      <div className="panel-title">
        <Database size={16} />
        <h2 id="cache-settings-title">缓存</h2>
      </div>
      <div className="settings-fact-grid">
        <div>
          <span>Blob URL 内存缓存</span>
          <strong>{openSessionCount} 个活动阅读会话</strong>
          <small>关闭标签页或退出工作台时释放。</small>
        </div>
        <div>
          <span>PDF 字节缓存</span>
          <strong>内存 LRU · 128 MB 上限</strong>
          <small>仅用于重新打开当前运行期内读取过的桌面文件。</small>
        </div>
        <div>
          <span>最近文档索引</span>
          <strong>{recentDocumentCount} 条记录</strong>
          <small>由本地持久层维护。</small>
        </div>
      </div>
      <button type="button" disabled aria-disabled="true">
        <HardDrive size={14} />
        清理磁盘缓存
      </button>
    </section>
  );
}
