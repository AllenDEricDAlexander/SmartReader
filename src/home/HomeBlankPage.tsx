import type { HomeSidebarPage } from './HomeSidebar';

const blankPageLabels = {
  recentFiles: '最近文件',
  favoriteFiles: '收藏文件',
  sessionRestore: '会话恢复',
  myDocuments: '我的文献',
  folders: '文件夹',
  notes: '笔记管理',
} satisfies Partial<Record<HomeSidebarPage, string>>;

export type HomeBlankPageId = keyof typeof blankPageLabels;

export function isHomeBlankPageId(page: HomeSidebarPage): page is HomeBlankPageId {
  return page in blankPageLabels;
}

type HomeBlankPageProps = {
  page: HomeBlankPageId;
};

export function HomeBlankPage({ page }: HomeBlankPageProps) {
  const label = blankPageLabels[page];

  return (
    <section className="home-panel home-blank-page" aria-labelledby="home-blank-page-title">
      <div className="section-heading">
        <p>SmartReader</p>
        <h2 id="home-blank-page-title">{label}</h2>
      </div>
    </section>
  );
}
