import { FileText, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import type {
  PersistedAnnotationRecord,
  PersistedBookmarkRecord,
  PersistedDocument,
} from '../persistence/persistenceApi';
import type { FavoriteDocument } from '../favorites/favoriteModels';
import {
  buildGlobalSearchResults,
  type GlobalSearchActiveSession,
  type GlobalSearchResult,
  type GlobalSearchSource,
} from './globalSearch';

type GlobalSearchPanelProps = {
  open: boolean;
  query: string;
  recentDocuments: PersistedDocument[];
  favoriteDocuments: FavoriteDocument[];
  bookmarks: PersistedBookmarkRecord[];
  annotations: PersistedAnnotationRecord[];
  bookmarkError: string | null;
  annotationError: string | null;
  activeSession: GlobalSearchActiveSession | null;
  onQueryChange(query: string): void;
  onSelectResult(result: GlobalSearchResult): void;
  onClose(): void;
};

const sourceLabels: Record<GlobalSearchSource, string> = {
  file: '文件',
  bookmark: '书签',
  annotation: '批注',
  fullText: '全文',
};

export function GlobalSearchPanel({
  open,
  query,
  recentDocuments,
  favoriteDocuments,
  bookmarks,
  annotations,
  bookmarkError,
  annotationError,
  activeSession,
  onQueryChange,
  onSelectResult,
  onClose,
}: GlobalSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const results = useMemo(
    () =>
      buildGlobalSearchResults({
        query,
        recentDocuments,
        favoriteDocuments,
        bookmarks,
        annotations,
        activeSession,
      }),
    [activeSession, annotations, bookmarks, favoriteDocuments, query, recentDocuments],
  );
  const normalizedQuery = query.trim();
  const providerErrors = [bookmarkError, annotationError].filter(
    (error): error is string => Boolean(error),
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();

    return () => {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;

      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [open]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = getFocusableElements(event.currentTarget);

    if (focusableElements.length === 0) {
      return;
    }

    event.preventDefault();
    const activeIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
    const nextIndex = event.shiftKey
      ? (currentIndex - 1 + focusableElements.length) % focusableElements.length
      : (currentIndex + 1) % focusableElements.length;

    focusableElements[nextIndex].focus();
  };

  if (!open) {
    return null;
  }

  return (
    <div className="global-search-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="全局搜索"
        aria-modal="true"
        className="global-search-dialog"
        role="dialog"
        onKeyDown={handleDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="global-search-header">
          <div>
            <p>全局搜索</p>
            <h2>全局搜索</h2>
          </div>
          <button type="button" aria-label="关闭全局搜索" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <label className="global-search-input">
          <Search size={18} />
          <input
            ref={inputRef}
            aria-label="全局搜索关键词"
            placeholder="搜索文件、书签、批注..."
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>

        <div className="global-search-results">
          {providerErrors.length > 0 ? (
            <div className="global-search-provider-errors" role="status">
              {providerErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : null}
          {!normalizedQuery ? (
            <div className="global-search-empty">
              <FileText size={20} />
              <span>输入关键词搜索文件、书签、批注和当前文档全文。</span>
            </div>
          ) : results.length === 0 ? (
            <div className="global-search-empty">
              <FileText size={20} />
              <span>没有找到匹配结果。</span>
            </div>
          ) : (
            results.map((result) => (
              <button
                key={result.id}
                type="button"
                className="global-search-result"
                disabled={result.missing}
                onClick={() => onSelectResult(result)}
              >
                <span className={`global-search-source ${result.source}`}>
                  {sourceLabels[result.source]}
                </span>
                <span className="global-search-result-main">
                  <strong>{result.title}</strong>
                  <span>{result.subtitle}</span>
                </span>
                <span className="global-search-action">{result.actionLabel}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.getAttribute('aria-hidden'));
}
