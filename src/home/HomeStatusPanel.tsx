import { Bot, CheckCircle2, HelpCircle, ShieldCheck } from 'lucide-react';

export function HomeStatusPanel() {
  return (
    <aside className="home-status" aria-label="状态和帮助">
      <section className="home-panel status-card">
        <div className="section-heading">
          <p>本地优先</p>
          <h2>工作台状态</h2>
        </div>
        <div className="status-list">
          <div className="status-item">
            <ShieldCheck size={16} />
            <span>PDF 读取和进度保存优先使用本地数据。</span>
          </div>
          <div className="status-item">
            <CheckCircle2 size={16} />
            <span>快捷键、最近文件、书签和批注保持可用。</span>
          </div>
          <div className="status-item disabled">
            <Bot size={16} />
            <span aria-disabled="true">AI 助手</span>
          </div>
        </div>
      </section>
      <section className="home-panel help-card">
        <div className="section-heading">
          <p>提示</p>
          <h2>阅读流程</h2>
        </div>
        <div className="tip-list">
          <div>
            <HelpCircle size={16} />
            <span>使用 Cmd/Ctrl + O 打开文件。</span>
          </div>
          <div>
            <HelpCircle size={16} />
            <span>打开文档后可用 Cmd/Ctrl + F 搜索 PDF。</span>
          </div>
        </div>
      </section>
    </aside>
  );
}
