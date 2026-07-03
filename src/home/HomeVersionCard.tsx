import { BookOpenCheck } from 'lucide-react';
import type { HomeAppVersion } from './homeTypes';

type HomeVersionCardProps = {
  appVersion: HomeAppVersion;
  onCheckUpdates(): void;
};

function formatVersion(appVersion: HomeAppVersion) {
  return appVersion.build
    ? `版本 ${appVersion.version} (Build ${appVersion.build})`
    : `版本 ${appVersion.version}`;
}

export function HomeVersionCard({ appVersion, onCheckUpdates }: HomeVersionCardProps) {
  return (
    <section className="home-assist-card home-version-card" aria-label="版本信息">
      <span className="home-version-icon" aria-hidden="true">
        <BookOpenCheck size={20} />
      </span>
      <div className="home-version-heading">
        <strong>SmartReader</strong>
        <span>{formatVersion(appVersion)}</span>
      </div>
      <p>本地优先 · 隐私安全 · 高效阅读</p>
      <button type="button" onClick={onCheckUpdates}>
        检查更新
      </button>
    </section>
  );
}
