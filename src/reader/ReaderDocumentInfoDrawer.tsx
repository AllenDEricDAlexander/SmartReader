import { FileText, Star } from 'lucide-react';
import { useState } from 'react';
import { useLibraryView, useResearch } from '../app/ResearchContext';
import type { DocumentSession } from '../documents/documentModels';
import { formatDateTime, formatFileSize } from '../home/homeDisplayUtils';
import { PaperMetadataEditor } from '../library/PaperMetadataEditor';
import { PaperPreview } from '../library/PaperPreview';
import type { PersistedDocument } from '../persistence/persistenceApi';
import type { ViewerDocumentInfo } from '../viewer/viewerTypes';
import { ReaderDrawer } from './ReaderDrawer';

type ReaderDocumentInfoDrawerProps = {
  activeSession: DocumentSession;
  documentInfo: ViewerDocumentInfo | null;
  documentRecord: PersistedDocument | null;
  isFavorite: boolean;
  onJumpToPage(page: number): void;
  onToggleFavorite(): void | Promise<void>;
  onClose(): void;
};

function sourceLabel(session: DocumentSession): string {
  return session.source.kind === 'library' ? '本地文献库' : session.source.kind === 'desktop-path' ? '本地文件' : '浏览器临时文件';
}

export function ReaderDocumentInfoDrawer({
  activeSession, documentInfo, documentRecord, isFavorite, onJumpToPage, onToggleFavorite, onClose,
}: ReaderDocumentInfoDrawerProps) {
  const research = useResearch();
  const libraryView = useLibraryView(research?.library);
  const [editingId, setEditingId] = useState<string | null>(null);
  const paperId = activeSession.source.kind === 'library' ? activeSession.source.paperId : null;
  const paper = libraryView.papers.find((item) => item.id === paperId);
  const filePath = activeSession.source.kind === 'desktop-path' ? activeSession.source.path : null;

  return (
    <ReaderDrawer id="reader-document-info" title="文献信息" icon={<FileText size={16} aria-hidden="true" />} onClose={onClose}>
      {paper && research ? <PaperPreview paper={paper} showHeader={false}
        fieldUsage={libraryView.snapshot.preferences.fieldUsage}
        onEdit={() => setEditingId(paper.id)} onOpenPage={onJumpToPage}
        onToggleFavorite={() => research.library.updatePaper(paper.id, { favorite: !paper.favorite })}
        onFieldView={(field) => research.library.recordFieldView(field)} /> : <section className="panel-section reader-document-facts">
        <dl className="document-facts">
          <div>
            <dt>文件名</dt>
            <dd title={activeSession.title}>{activeSession.title}</dd>
          </div>
          <div>
            <dt>文件大小</dt>
            <dd>{formatFileSize(documentRecord?.fileSize ?? null)}</dd>
          </div>
          <div>
            <dt>文件路径</dt>
            <dd title={filePath ?? undefined}>{filePath ?? sourceLabel(activeSession)}</dd>
          </div>
          <div>
            <dt>修改时间</dt>
            <dd>{formatDateTime(documentRecord?.modifiedAt ?? null)}</dd>
          </div>
          <div>
            <dt>PDF 版本</dt>
            <dd>{documentInfo?.pdfVersion ?? '未知'}</dd>
          </div>
          <div>
            <dt>页数</dt>
            <dd>
              {activeSession.page}
              {activeSession.totalPages ? ` / ${activeSession.totalPages}` : ''}
            </dd>
          </div>
          {/* Embedded metadata is optional, so each entry only appears when the
              document actually carries it rather than showing empty rows. */}
          {documentInfo?.author ? (
            <div>
              <dt>作者</dt>
              <dd title={documentInfo.author}>{documentInfo.author}</dd>
            </div>
          ) : null}
          {documentInfo?.subject ? (
            <div>
              <dt>主题</dt>
              <dd title={documentInfo.subject}>{documentInfo.subject}</dd>
            </div>
          ) : null}
          {documentInfo?.keywords ? (
            <div>
              <dt>关键词</dt>
              <dd title={documentInfo.keywords}>{documentInfo.keywords}</dd>
            </div>
          ) : null}
          <div>
            <dt>缩放</dt>
            <dd>{Math.round(activeSession.zoom * 100)}%</dd>
          </div>
          <div>
            <dt>进度</dt>
            <dd>{Math.round(activeSession.progress * 100)}%</dd>
          </div>
        </dl>
        <button
          type="button"
          className={isFavorite ? 'favorite-toggle active reader-full-width-button' : 'favorite-toggle reader-full-width-button'}
          onClick={() => void onToggleFavorite()}
          aria-pressed={isFavorite}
        >
          <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
          {isFavorite ? '取消收藏' : '收藏文档'}
        </button>
      </section>}
      {paper && research && editingId === paper.id ? <PaperMetadataEditor key={paper.id} paper={paper}
        onSave={(changes) => research.library.editMetadata(paper.id, changes)} onClose={() => setEditingId(null)} /> : null}
    </ReaderDrawer>
  );
}
