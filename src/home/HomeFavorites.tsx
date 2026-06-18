import { Star } from 'lucide-react';
import type { FavoriteDocument } from '../favorites/favoriteModels';

type HomeFavoritesProps = {
  documents: FavoriteDocument[];
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
};

export function HomeFavorites({ documents, onToggleFavorite }: HomeFavoritesProps) {
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
              <div className="favorite-card-header">
                <strong>{document.displayName}</strong>
                <button
                  type="button"
                  className="favorite-toggle active"
                  aria-label={`取消收藏 ${document.displayName}`}
                  aria-pressed="true"
                  onClick={() => void onToggleFavorite(document.documentKey, false)}
                >
                  <Star size={14} fill="currentColor" />
                </button>
              </div>
              <span>{document.path ?? '本地浏览器文件'}</span>
              <span>
                Page {document.lastPage} · {Math.round(document.progress * 100)}%
              </span>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-block compact">
          <strong>暂无收藏</strong>
          <span>收藏文档后会显示在这里。</span>
        </div>
      )}
    </section>
  );
}
