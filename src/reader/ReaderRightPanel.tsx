import { FileText, Star } from 'lucide-react';
import type { ReaderAnnotation } from '../annotations/annotationModels';
import type { ViewerSearchState } from '../viewer/viewerTypes';
import type { DocumentSession } from '../documents/documentModels';
import type { Tag } from '../tags/tagModels';
import { AnnotationDetail } from './annotations/AnnotationDetail';
import { SearchInspector } from './search/SearchInspector';

type ReaderRightPanelProps = {
  activeSession: DocumentSession | null;
  selectedAnnotation: ReaderAnnotation | null;
  tags: Tag[];
  searchText: string;
  searchState: ViewerSearchState;
  lastSearchCommand: string;
  isFavorite: boolean;
  onSearchTextChange(value: string): void;
  onOpenSearch(): void;
  onSearch(): void;
  onClearSearch(): void;
  onSearchNext(): void;
  onSearchPrevious(): void;
  onJumpToMatch(index: number): void;
  onJumpToPage(page: number): void;
  onFitWidth(): void;
  onFitPage(): void;
  onToggleFavorite(): void | Promise<void>;
  onDeleteAnnotation(annotationId: number): void;
  onSaveAnnotationNote(annotation: ReaderAnnotation, text: string): void | Promise<void>;
  onToggleAnnotationTag(
    annotation: ReaderAnnotation,
    tag: Tag,
    selected: boolean,
  ): void | Promise<void>;
};

function sourceLabel(session: DocumentSession): string {
  return session.source.kind === 'desktop-path' ? '本地文件' : '浏览器临时文件';
}

export function ReaderRightPanel({
  activeSession,
  selectedAnnotation,
  tags,
  searchText,
  searchState,
  lastSearchCommand,
  isFavorite,
  onSearchTextChange,
  onOpenSearch,
  onSearch,
  onClearSearch,
  onSearchNext,
  onSearchPrevious,
  onJumpToMatch,
  onJumpToPage,
  onFitWidth,
  onFitPage,
  onToggleFavorite,
  onDeleteAnnotation,
  onSaveAnnotationNote,
  onToggleAnnotationTag,
}: ReaderRightPanelProps) {
  return (
    <aside className="reader-right-panel" aria-label="阅读检查器">
      <section className="panel-section">
        <div className="panel-title">
          <FileText size={16} />
          <h2>文档信息</h2>
        </div>
        {activeSession ? (
          <dl className="document-facts">
            <div>
              <dt>文件名</dt>
              <dd title={activeSession.title}>{activeSession.title}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{sourceLabel(activeSession)}</dd>
            </div>
            <div>
              <dt>页码</dt>
              <dd>
                {activeSession.page}
                {activeSession.totalPages ? ` / ${activeSession.totalPages}` : ''}
              </dd>
            </div>
            <div>
              <dt>缩放</dt>
              <dd>{Math.round(activeSession.zoom * 100)}%</dd>
            </div>
            <div>
              <dt>进度</dt>
              <dd>{Math.round(activeSession.progress * 100)}%</dd>
            </div>
          </dl>
        ) : (
          <p className="muted-copy">没有活动文档</p>
        )}
        <button
          type="button"
          className={isFavorite ? 'favorite-toggle active reader-full-width-button' : 'favorite-toggle reader-full-width-button'}
          onClick={() => void onToggleFavorite()}
          disabled={!activeSession}
          aria-pressed={isFavorite}
        >
          <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
          {isFavorite ? '取消收藏' : '收藏文档'}
        </button>
      </section>

      <SearchInspector
        query={searchText}
        lastSearchCommand={lastSearchCommand}
        searchState={searchState}
        onQueryChange={onSearchTextChange}
        onOpenSearch={onOpenSearch}
        onSearch={onSearch}
        onPrevious={onSearchPrevious}
        onNext={onSearchNext}
        onJumpToMatch={onJumpToMatch}
        onJumpToPage={() => onJumpToPage(activeSession?.page ?? 1)}
        onFitWidth={onFitWidth}
        onFitPage={onFitPage}
        onClearSearch={onClearSearch}
      />

      <AnnotationDetail
        annotation={selectedAnnotation}
        tags={tags}
        onJumpToPage={onJumpToPage}
        onDeleteAnnotation={onDeleteAnnotation}
        onSaveNote={onSaveAnnotationNote}
        onToggleTag={onToggleAnnotationTag}
      />
    </aside>
  );
}
