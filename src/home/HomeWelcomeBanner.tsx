import { BookOpenCheck, FileText, ShieldCheck, Sparkles } from 'lucide-react';

export function HomeWelcomeBanner() {
  return (
    <section className="home-welcome-banner" aria-label="欢迎使用 SmartReader">
      <div className="welcome-brand-icon" aria-hidden="true">
        <BookOpenCheck size={44} strokeWidth={1.8} />
      </div>
      <div className="welcome-copy">
        <h1>欢迎使用 SmartReader</h1>
        <p className="welcome-subtitle">本地优先 · 隐私安全 · 高效阅读</p>
        <p className="welcome-description">
          所有文件和数据仅存储在您的设备上，完全掌控您的知识。
        </p>
      </div>
      <div className="welcome-illustration" aria-label="本地安全阅读插画">
        <div className="welcome-document-card">
          <FileText size={34} />
          <span className="document-line strong" />
          <span className="document-line short" />
          <span className="document-line accent" />
          <span className="document-line" />
        </div>
        <div className="welcome-shield">
          <ShieldCheck size={28} />
        </div>
        <Sparkles className="welcome-sparkle one" size={16} />
        <Sparkles className="welcome-sparkle two" size={14} />
      </div>
    </section>
  );
}
