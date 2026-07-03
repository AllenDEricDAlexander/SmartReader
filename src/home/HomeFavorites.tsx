import { FileText, Star } from 'lucide-react';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import { getDirectoryPath } from './homeDisplayUtils';

type HomeFavoritesProps = {
  documents: FavoriteDocument[];
  onOpenAll(): void;
  onOpenDocument(document: FavoriteDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
};

export function HomeFavorites({
  documents,
  onOpenAll,
  onOpenDocument,
  onToggleFavorite,
}: HomeFavoritesProps) {
  const favoriteDocuments = documents.slice(0, 3);

  return (
    <section
      className="home-panel home-favorites-panel"
      aria-labelledby="home-favorites-title"
    >
      <div className="section-heading horizontal">
        <div>
          <p>收藏的 PDF 文件</p>
          <h2 id="home-favorites-title">收藏文件</h2>
        </div>
        <button type="button" className="text-link-button" onClick={onOpenAll}>
          查看全部（{documents.length}）
        </button>
      </div>
      {favoriteDocuments.length > 0 ? (
        <div className="favorite-grid">
          {favoriteDocuments.map((document) => (
            <article key={document.documentKey} className="favorite-card">
              <div className="favorite-card-main">
                <button
                  type="button"
                  className="favorite-card-open"
                  aria-label={`打开收藏文件 ${document.displayName}`}
                  onClick={() => void onOpenDocument(document)}
                >
                  <span className="pdf-file-icon" aria-hidden="true">
                    <FileText size={18} />
                  </span>
                  <span className="favorite-card-copy">
                    <strong title={document.displayName}>{document.displayName}</strong>
                    <span title={document.path ?? '本地浏览器文件'}>
                      {getDirectoryPath(document.path)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="favorite-toggle active"
                  aria-label={`取消收藏 ${document.displayName}`}
                  aria-pressed="true"
                  onClick={() => void onToggleFavorite(document.documentKey, false)}
                >
                  <Star size={15} fill="currentColor" />
                </button>
              </div>
              <div className="favorite-card-footer">
                <span>第 {document.lastPage} 页</span>
                <span>日期未知</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-block compact">
          <strong>暂无收藏文件</strong>
          <span>收藏文件后会显示在这里。</span>
        </div>
      )}
    </section>
  );
}
