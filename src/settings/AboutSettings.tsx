import { Info } from 'lucide-react';
import type { HomeAppVersion } from '../home/homeTypes';
import { CheckUpdatesButton } from './CheckUpdatesButton';

type AboutSettingsProps = {
  appVersion: HomeAppVersion;
};

export function AboutSettings({ appVersion }: AboutSettingsProps) {
  return (
    <section className="settings-card" aria-labelledby="about-title">
      <div className="panel-title">
        <Info size={16} />
        <h2 id="about-title">版本信息</h2>
      </div>
      <strong>SmartReader</strong>
      <p>版本 {appVersion.version}{appVersion.build ? ` (Build ${appVersion.build})` : ''}</p>
      <p className="muted-copy">本地优先 · 隐私安全 · 高效阅读</p>
      <CheckUpdatesButton />
    </section>
  );
}
