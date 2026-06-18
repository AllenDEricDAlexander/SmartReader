import { Star } from 'lucide-react';
import type { FavoriteDocument } from '../favorites/favoriteModels';

type HomeFavoritesProps = {
  documents: FavoriteDocument[];
};

export function HomeFavorites({ documents }: HomeFavoritesProps) {
  return (
    <section className="home-panel" aria-labelledby="home-favorites-title">
      <div className="section-heading horizontal">
        <div>
          <p>收藏</p>
          <h2 id="home-favorites-title">重点文档</h2>
        </div>
        <Star size={16} />
      </div>
      {documents.length > 0 ? (
        <div className="favorite-grid">
          {documents.map((document) => (
            <article key={document.documentKey} className="favorite-card">
              <strong>{document.displayName}</strong>
              <span>{document.path ?? '本地浏览器文件'}</span>
              <span>Page {document.lastPage} · {Math.round(document.progress * 100)}%</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-block compact">
          <strong>暂无收藏</strong>
          <span>后续任务会接入收藏与标签管理。</span>
        </div>
      )}
    </section>
  );
}
