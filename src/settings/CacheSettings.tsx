import { Database, HardDrive } from 'lucide-react';
import type { CacheStats } from '../persistence/persistenceApi';

type CacheSettingsProps = {
  openSessionCount: number;
  recentDocumentCount: number;
  cacheStats?: CacheStats;
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${Number.isInteger(value) ? String(value) : value.toFixed(2)} ${BYTE_UNITS[unitIndex]}`;
}

export function CacheSettings({
  openSessionCount,
  recentDocumentCount,
  cacheStats = { usedBytes: 0, totalBytes: 0, fileCount: 0 },
}: CacheSettingsProps) {
  const usage = cacheStats.totalBytes > 0 ? cacheStats.usedBytes / cacheStats.totalBytes * 100 : 0;
  const usagePercent = Number.isFinite(usage) ? Math.min(Math.max(Math.round(usage), 0), 100) : 0;

  return (
    <section className="settings-card" aria-labelledby="cache-settings-title">
      <div className="panel-title">
        <Database size={16} />
        <h2 id="cache-settings-title">缓存</h2>
      </div>
      <div className="settings-cache-summary" aria-label="本地缓存">
        <strong>{formatBytes(cacheStats.usedBytes)} / {formatBytes(cacheStats.totalBytes)}</strong>
        <div
          className="settings-cache-progress"
          role="progressbar"
          aria-label="本地缓存使用量"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usagePercent}
        >
          <span style={{ width: `${usagePercent}%` }} />
        </div>
        <span>已缓存 {cacheStats.fileCount} 个文件</span>
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
