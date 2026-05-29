import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import {
  enableCategoryEncryption,
  isLockedRecentFile,
  removeRecentLibraryEntriesForDeletedFiles,
  resealCategoryEncryption,
  restoreProtectedPlaintextStorageSnapshot,
  sanitizeProtectedPlaintextStorage,
  snapshotProtectedPlaintextStorage,
  unlockCategoryEncryption
} from "../state/recentLibraryEncryption";
import type { ProtectedPlaintextStorageSnapshot } from "../state/recentLibraryEncryption";
import { readingProgressForRecentFile } from "../state/recentFiles";
import {
  ensureRecentDocumentMetadata,
  loadRecentLibraryMetadata,
  lockedCategoryName,
  recentLibraryCategoryId,
  recentLibraryTagId,
  saveRecentLibraryMetadata,
  toggleDocumentValue
} from "../state/recentLibrary";
import type {
  RecentDocumentMetadata,
  RecentLibraryCategory,
  RecentLibraryMetadata,
  RecentLibraryTag
} from "../state/recentLibrary";
import type { RecentFile } from "../types/reader";

type RecentFilter =
  | { kind: "all" }
  | { kind: "format"; format: RecentFile["format"] }
  | { kind: "category"; categoryId: string }
  | { kind: "tag"; tagId: string }
  | { kind: "pinned" }
  | { kind: "favorite" };

interface HoverPreview {
  file: RecentFile;
  x: number;
  y: number;
}

const RECENT_DETAIL_MIN_WIDTH = 120;
const RECENT_DETAIL_MAX_WIDTH = 280;
const RECENT_DETAIL_DEFAULT_WIDTH = 160;
const RECENT_DETAIL_RESIZE_STEP = 10;

export function RecentLibraryPanel(props: {
  recentFiles: RecentFile[];
  onOpenRecent: (recent: RecentFile) => void;
  onRecentFilesChange: (recentFiles: RecentFile[]) => void;
  onProtectedPathsLocked: (paths: string[]) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecent: () => void;
}) {
  const [library, setLibrary] = useState<RecentLibraryMetadata>(() => loadRecentLibraryMetadata());
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [filter, setFilter] = useState<RecentFilter>({ kind: "all" });
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryParentId, setNewCategoryParentId] = useState("");
  const [categoryEditId, setCategoryEditId] = useState("");
  const [categoryEditName, setCategoryEditName] = useState("");
  const [categoryMergeTargetId, setCategoryMergeTargetId] = useState("");
  const [batchCategoryId, setBatchCategoryId] = useState("");
  const [batchTagId, setBatchTagId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#326a8f");
  const [newTagGroup, setNewTagGroup] = useState("Private");
  const [tagEditId, setTagEditId] = useState("");
  const [tagEditName, setTagEditName] = useState("");
  const [tagEditColor, setTagEditColor] = useState("#326a8f");
  const [tagEditGroup, setTagEditGroup] = useState("Private");
  const [encryptionCategoryId, setEncryptionCategoryId] = useState("");
  const [encryptionPassword, setEncryptionPassword] = useState("");
  const [encryptionConfirmPassword, setEncryptionConfirmPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [encryptionMessage, setEncryptionMessage] = useState("");
  const [hoverPreview, setHoverPreview] = useState<HoverPreview>();
  const [detailPanelWidth, setDetailPanelWidth] = useState(RECENT_DETAIL_DEFAULT_WIDTH);
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const hoverFileRef = useRef<RecentFile | undefined>(undefined);
  const hoverPointRef = useRef({ x: 0, y: 0 });
  const detailPanelResizeRef = useRef<{ x: number; width: number } | undefined>(undefined);
  const unlockedFolderPasswordsRef = useRef<Record<string, string>>({});
  const libraryRef = useRef(library);

  const setClampedDetailPanelWidth = useCallback((nextWidth: number) => {
    setDetailPanelWidth((current) => {
      if (current === nextWidth) {
        return current;
      }
      return Math.max(
        RECENT_DETAIL_MIN_WIDTH,
        Math.min(RECENT_DETAIL_MAX_WIDTH, Math.round(nextWidth))
      );
    });
  }, []);

  const selectedFile = props.recentFiles.find((file) => file.path === selectedPath);
  const selectedMetadata = selectedFile && !isLockedRecentFile(selectedFile) ? metadataFor(library, selectedFile.path) : undefined;
  const selectableTagOptions = library.tags;
  const privateTagOptions = library.tags.filter((tag) => !tag.builtIn);

  const categoryById = useMemo(() => {
    return new Map(library.categories.map((category) => [category.id, category]));
  }, [library.categories]);

  const tagById = useMemo(() => {
    return new Map(library.tags.map((tag) => [tag.id, tag]));
  }, [library.tags]);
  const lockedCategoryIds = useMemo(() => {
    return lockedLibraryCategoryIds(library, unlockedFolderPasswordsRef.current);
  }, [library]);
  const editableCategories = useMemo(() => {
    return library.categories.filter((category) => !lockedCategoryIds.has(category.id));
  }, [library.categories, lockedCategoryIds]);
  const categoryMergeTargetOptions = useMemo(() => {
    return editableCategories.filter((category) =>
      isCategoryMergeTarget(library.categories, categoryEditId, category.id)
    );
  }, [categoryEditId, editableCategories, library.categories]);
  const canMergeSelectedCategory = categoryMergeTargetOptions.some((category) => category.id === categoryMergeTargetId);
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = detailPanelResizeRef.current;
      if (!drag) {
        return;
      }
      setClampedDetailPanelWidth(drag.width + event.clientX - drag.x);
    };
    const onPointerUp = () => {
      detailPanelResizeRef.current = undefined;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [setClampedDetailPanelWidth]);

  const filteredFiles = useMemo(() => {
    return [...props.recentFiles]
      .filter((file) => matchesFilter(file, metadataFor(library, file.path), filter))
      .sort((left: RecentFile, right: RecentFile) => {
        const leftMetadata = metadataFor(library, left.path);
        const rightMetadata = metadataFor(library, right.path);

        if (leftMetadata.pinned !== rightMetadata.pinned) {
          return leftMetadata.pinned ? -1 : 1;
        }

        return right.lastOpenedAt - left.lastOpenedAt;
      });
  }, [filter, library, props.recentFiles]);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  const persistLibrary = useCallback(async (
    updater: (current: RecentLibraryMetadata) => RecentLibraryMetadata,
    recentFilesOverride?: RecentFile[]
  ) => {
    const current = libraryRef.current;
    const next = updater(current);
    const currentRecentFiles = recentFilesOverride ?? props.recentFiles;
    const unlockedFolders = Object.entries(unlockedFolderPasswordsRef.current)
      .filter(([categoryId]) => Boolean(next.encryptedFolders?.[categoryId]));

    if (unlockedFolders.length === 0) {
      saveRecentLibraryMetadata(next);
      if (recentFilesOverride) {
        props.onRecentFilesChange(recentFilesOverride);
      }
      libraryRef.current = next;
      setLibrary(next);
      setEncryptionMessage("");
      return true;
    }

    const pendingProtectedPaths = protectedDocumentPathsForUnlockedFolders(next, unlockedFolders.map(([categoryId]) => categoryId));
    let storageSnapshot: ProtectedPlaintextStorageSnapshot | undefined;

    try {
      let resealedLibrary = next;
      let resealedRecentFiles = currentRecentFiles;
      const protectedPaths = new Set<string>();

      if (pendingProtectedPaths.length > 0) {
        storageSnapshot = snapshotProtectedPlaintextStorage();
        sanitizeProtectedPlaintextStorage({
          protectedPaths: pendingProtectedPaths,
          recentFiles: currentRecentFiles
        });
      }

      for (const [categoryId, password] of unlockedFolders) {
        const resealed = await resealCategoryEncryption({
          library: resealedLibrary,
          categoryId,
          password,
          recentFiles: resealedRecentFiles
        });

        resealedLibrary = resealed.library;
        resealedRecentFiles = resealed.recentFiles;
        resealed.protectedPaths.forEach((path) => protectedPaths.add(path));
      }

      saveRecentLibraryMetadata(resealedLibrary);
      props.onRecentFilesChange(resealedRecentFiles);
      props.onProtectedPathsLocked(Array.from(protectedPaths));
      libraryRef.current = resealedLibrary;
      setLibrary(resealedLibrary);
      setEncryptionMessage("");
      return true;
    } catch (error) {
      if (storageSnapshot) {
        restoreProtectedPlaintextStorageSnapshot({
          snapshot: storageSnapshot,
          protectedPaths: pendingProtectedPaths
        });
      }
      setEncryptionMessage(error instanceof Error ? error.message : "Folder reseal failed.");
      return false;
    }
  }, [props.onProtectedPathsLocked, props.onRecentFilesChange, props.recentFiles]);

  useEffect(() => {
    const recentPaths = new Set(props.recentFiles.map((file) => file.path));
    setSelectedPaths((current) => current.filter((path) => recentPaths.has(path)));
    setSelectedPath((current) => (current && recentPaths.has(current) ? current : ""));
  }, [props.recentFiles]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const startHoverPreview = useCallback((file: RecentFile, event: ReactMouseEvent<HTMLElement>) => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
    }

    hoverFileRef.current = file;
    hoverPointRef.current = { x: event.clientX, y: event.clientY };
    hoverTimerRef.current = window.setTimeout(() => {
      const activeFile = hoverFileRef.current;

      if (activeFile?.path === file.path) {
        setHoverPreview({
          file,
          x: hoverPointRef.current.x + 14,
          y: hoverPointRef.current.y + 14
        });
      }
    }, 1000);
  }, []);

  const moveHoverPreview = useCallback((file: RecentFile, event: ReactMouseEvent<HTMLElement>) => {
    hoverPointRef.current = { x: event.clientX, y: event.clientY };
    setHoverPreview((current) => current?.file.path === file.path
      ? { ...current, x: event.clientX + 14, y: event.clientY + 14 }
      : current);
  }, []);

  const stopHoverPreview = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = undefined;
    }

    hoverFileRef.current = undefined;
    setHoverPreview(undefined);
  }, []);

  const updateDocumentMetadata = useCallback((
    paths: string[],
    updater: (metadata: RecentDocumentMetadata) => RecentDocumentMetadata
  ) => {
    return persistLibrary((current) => {
      const documents = { ...current.documents };

      paths.forEach((path) => {
        documents[path] = updater(metadataFor(current, path));
      });

      return { ...current, documents };
    });
  }, [persistLibrary]);

  const createCategory = useCallback(async () => {
    const name = newCategoryName.trim();

    if (!name) {
      return;
    }

    const id = uniqueCategoryId(library.categories, recentLibraryCategoryId(name));
    const saved = await persistLibrary((current) => ({
      ...current,
      categories: [
        ...current.categories,
        { id, name, parentId: newCategoryParentId || undefined }
      ]
    }));

    if (saved) {
      setNewCategoryName("");
    }
  }, [library.categories, newCategoryName, newCategoryParentId, persistLibrary]);

  const renameCategory = useCallback(async () => {
    const name = categoryEditName.trim();

    if (!categoryEditId || !name) {
      return;
    }

    await persistLibrary((current) => ({
      ...current,
      categories: current.categories.map((category) => category.id === categoryEditId
        ? { ...category, name }
        : category)
    }));
  }, [categoryEditId, categoryEditName, persistLibrary]);

  const mergeCategory = useCallback(async () => {
    if (!categoryEditId || !categoryMergeTargetId || !isCategoryMergeTarget(library.categories, categoryEditId, categoryMergeTargetId)) {
      return;
    }

    const saved = await persistLibrary((current) => mergeRecentLibraryCategory(current, categoryEditId, categoryMergeTargetId));

    if (saved) {
      setCategoryEditId("");
      setCategoryEditName("");
      setCategoryMergeTargetId("");
    }
  }, [categoryEditId, categoryMergeTargetId, library.categories, persistLibrary]);

  const deleteCategory = useCallback(async () => {
    if (!categoryEditId) {
      return;
    }

    const ids = categoryDescendantIds(library.categories, categoryEditId);
    const saved = await persistLibrary((current) => ({
      ...current,
      categories: current.categories.filter((category) => !ids.includes(category.id)),
      documents: mapDocumentMetadata(current.documents, (metadata) => ({
        ...metadata,
        categoryIds: metadata.categoryIds.filter((id) => !ids.includes(id))
      }))
    }));

    if (saved) {
      setCategoryEditId("");
      setCategoryEditName("");
      setCategoryMergeTargetId("");
    }
  }, [categoryEditId, library.categories, persistLibrary]);

  const createTag = useCallback(async () => {
    const name = newTagName.trim();

    if (!name) {
      return;
    }

    const id = uniqueTagId(library.tags, recentLibraryTagId(name));
    const saved = await persistLibrary((current) => ({
      ...current,
      tags: [
        ...current.tags,
        { id, name, color: newTagColor, group: newTagGroup.trim() || "Private" }
      ]
    }));

    if (saved) {
      setNewTagName("");
    }
  }, [library.tags, newTagColor, newTagGroup, newTagName, persistLibrary]);

  const loadTagEditor = useCallback((tagId: string) => {
    const tag = library.tags.find((item) => item.id === tagId);

    setTagEditId(tagId);
    setTagEditName(tag?.name ?? "");
    setTagEditColor(tag?.color ?? "#326a8f");
    setTagEditGroup(tag?.group ?? "Private");
  }, [library.tags]);

  const saveTag = useCallback(async () => {
    const name = tagEditName.trim();

    if (!tagEditId || !name) {
      return;
    }

    await persistLibrary((current) => ({
      ...current,
      tags: current.tags.map((tag) => tag.id === tagEditId && !tag.builtIn
        ? { ...tag, name, color: tagEditColor, group: tagEditGroup.trim() || "Private" }
        : tag)
    }));
  }, [persistLibrary, tagEditColor, tagEditGroup, tagEditId, tagEditName]);

  const deleteTag = useCallback(async () => {
    if (!tagEditId) {
      return;
    }

    const saved = await persistLibrary((current) => ({
      ...current,
      tags: current.tags.filter((tag) => tag.id !== tagEditId || tag.builtIn),
      documents: mapDocumentMetadata(current.documents, (metadata) => ({
        ...metadata,
        tagIds: metadata.tagIds.filter((id) => id !== tagEditId)
      }))
    }));

    if (saved) {
      setTagEditId("");
      setTagEditName("");
    }
  }, [persistLibrary, tagEditId]);

  const clearRecentLibraryEntries = useCallback((removedRecentFiles: RecentFile[], remainingRecentFiles: RecentFile[]) => {
    const nextLibrary = removeRecentLibraryEntriesForDeletedFiles({
      library: libraryRef.current,
      removedRecentFiles,
      remainingRecentFiles
    });

    saveRecentLibraryMetadata(nextLibrary);
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
  }, []);

  const selectedFiles = selectedPaths.filter((path) =>
    props.recentFiles.some((file) => file.path === path)
  );
  const selectedBatchFiles = selectedPaths.filter((path) =>
    props.recentFiles.some((file) => file.path === path && !isLockedRecentFile(file))
  );
  const selectedEncryptedCategoryIds = selectedMetadata
    ? selectedMetadata.categoryIds.filter((categoryId) => library.categories.some((category) => category.id === categoryId))
    : [];
  const selectedLockedCategoryId = selectedFile && isLockedRecentFile(selectedFile)
    ? lockedRecentCategoryId(selectedFile)
    : "";
  const recentLibraryStyle = useMemo(() => ({
    ["--recent-detail-width" as string]: `${detailPanelWidth}px`
  }) as CSSProperties, [detailPanelWidth]);
  const adjustDetailPanelWidth = useCallback((delta: number) => {
    setClampedDetailPanelWidth(detailPanelWidth + delta);
  }, [detailPanelWidth, setClampedDetailPanelWidth]);

  return (
    <div className="recent-panel">
      <div className="recent-header">
        <h2>Recent</h2>
        <button
          type="button"
          onClick={() => {
            clearRecentLibraryEntries(props.recentFiles, []);
            setSelectedPath("");
            setSelectedPaths([]);
            props.onClearRecent();
          }}
          disabled={props.recentFiles.length === 0}
        >
          Clear
        </button>
      </div>
      {props.recentFiles.length === 0 ? (
        <p className="empty-note">Recent files appear after you open a document.</p>
      ) : (
        <div className="recent-library" style={recentLibraryStyle}>
          <aside className="recent-library-sidebar" aria-label="Recent filters">
            <button type="button" className={filter.kind === "all" ? "active" : ""} onClick={() => setFilter({ kind: "all" })}>
              All papers
            </button>
            <button type="button" className={filter.kind === "format" && filter.format === "pdf" ? "active" : ""} onClick={() => setFilter({ kind: "format", format: "pdf" })}>
              PDF
            </button>
            <button type="button" className={filter.kind === "format" && filter.format === "epub" ? "active" : ""} onClick={() => setFilter({ kind: "format", format: "epub" })}>
              EPUB
            </button>
            <button type="button" className={filter.kind === "pinned" ? "active" : ""} onClick={() => setFilter({ kind: "pinned" })}>
              Pinned
            </button>
            <button type="button" className={filter.kind === "favorite" ? "active" : ""} onClick={() => setFilter({ kind: "favorite" })}>
              Favorites
            </button>
            <div className="recent-section-title">Categories</div>
            {library.categories.length === 0 ? (
              <p className="recent-muted">No custom categories.</p>
            ) : (
              <CategoryTree
                categories={library.categories}
                lockedCategoryIds={lockedCategoryIds}
                activeCategoryId={filter.kind === "category" ? filter.categoryId : ""}
                onSelect={(categoryId) => setFilter({ kind: "category", categoryId })}
              />
            )}
            <div className="recent-section-title">Tags</div>
            {library.tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={filter.kind === "tag" && filter.tagId === tag.id ? "active" : ""}
                onClick={() => setFilter({ kind: "tag", tagId: tag.id })}
              >
                {tag.name}
              </button>
            ))}
          </aside>

            <section className="recent-library-main">
            <BatchToolbar
              count={selectedFiles.length}
              writableCount={selectedBatchFiles.length}
              categories={editableCategories}
              tags={selectableTagOptions}
              batchCategoryId={batchCategoryId}
              batchTagId={batchTagId}
              onCategoryChange={setBatchCategoryId}
              onTagChange={setBatchTagId}
              onReplaceCategory={() => {
                if (batchCategoryId) {
                  updateDocumentMetadata(selectedBatchFiles, (metadata) => ({
                    ...metadata,
                    categoryIds: [batchCategoryId]
                  }));
                }
              }}
              onAddCategory={() => {
                if (batchCategoryId) {
                  updateDocumentMetadata(selectedBatchFiles, (metadata) => ({
                    ...metadata,
                    categoryIds: metadata.categoryIds.includes(batchCategoryId)
                      ? metadata.categoryIds
                      : [...metadata.categoryIds, batchCategoryId]
                  }));
                }
              }}
              onAddTag={() => {
                if (batchTagId) {
                  updateDocumentMetadata(selectedBatchFiles, (metadata) => ({
                    ...metadata,
                    tagIds: metadata.tagIds.includes(batchTagId)
                      ? metadata.tagIds
                      : [...metadata.tagIds, batchTagId]
                  }));
                }
              }}
              onRemoveTag={() => {
                if (batchTagId) {
                  updateDocumentMetadata(selectedBatchFiles, (metadata) => ({
                    ...metadata,
                    tagIds: metadata.tagIds.filter((tagId) => tagId !== batchTagId)
                  }));
                }
              }}
              onPin={() => updateDocumentMetadata(selectedBatchFiles, (metadata) => ({ ...metadata, pinned: true }))}
              onFavorite={() => updateDocumentMetadata(selectedBatchFiles, (metadata) => ({ ...metadata, favorite: true }))}
              onDelete={async () => {
                const selectedFileSet = new Set(selectedFiles);
                const removedRecentFiles = props.recentFiles.filter((file) => selectedFileSet.has(file.path));
                const remainingRecentFiles = props.recentFiles.filter((file) => !selectedFileSet.has(file.path));

                const saved = await persistLibrary((current) => removeRecentLibraryEntriesForDeletedFiles({
                  library: current,
                  removedRecentFiles,
                  remainingRecentFiles
                }), remainingRecentFiles);

                if (saved) {
                  setSelectedPath((current) => selectedFileSet.has(current) ? "" : current);
                  setSelectedPaths([]);
                }
              }}
            />

            <div className="recent-grid" aria-label="Recent file grid">
              {filteredFiles.map((file) => {
                const metadata = metadataFor(library, file.path);
                const categoryNames = metadata.categoryIds
                  .map((id) => categoryById.get(id))
                  .filter(Boolean)
                  .map((category) => categoryNameFor(category as RecentLibraryCategory, lockedCategoryIds));
                const tagValues = metadata.tagIds.map((id) => tagById.get(id)).filter(Boolean) as RecentLibraryTag[];
                const locked = isLockedRecentFile(file);
                const readingProgress = readingProgressForRecentFile(file);

                return (
                  <article key={file.id} className={`recent-card ${selectedPath === file.path ? "active" : ""} ${locked ? "locked" : ""}`}>
                    <label className="recent-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${file.title}`}
                        checked={selectedPaths.includes(file.path)}
                        onChange={() => {
                          setSelectedPaths((current) => toggleDocumentValue(current, file.path));
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      aria-label={`${file.title} details`}
                      onClick={() => setSelectedPath(file.path)}
                      onMouseEnter={(event) => locked ? undefined : startHoverPreview(file, event)}
                      onMouseMove={(event) => locked ? undefined : moveHoverPreview(file, event)}
                      onMouseLeave={stopHoverPreview}
                      onFocus={stopHoverPreview}
                    >
                      <span className={`recent-format ${file.format}`}>{file.format.toUpperCase()}</span>
                      <span className="recent-title">{file.title}</span>
                      <span className="recent-meta">{readingProgress.progressLabel}</span>
                      <span className="recent-meta">{readingProgress.positionLabel}</span>
                      <span className="recent-meta">{readingProgress.contentLabel}</span>
                      <span className="recent-chip-row">
                        {locked ? <span className="recent-chip">Locked</span> : null}
                        {!locked && metadata.pinned ? <span className="recent-chip">Pinned</span> : null}
                        {metadata.favorite ? <span className="recent-chip">Favorite</span> : null}
                        {!locked && categoryNames.slice(0, 2).map((name) => (
                          <span key={name} className="recent-chip">{name}</span>
                        ))}
                        {!locked && tagValues.slice(0, 2).map((tag) => (
                          <span key={tag.id} className="recent-chip" style={{ borderColor: tag.color }}>{tag.name}</span>
                        ))}
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
            </section>
            <div
              className="recent-library-resize"
              role="separator"
              aria-label="Resize recent paper preview"
              aria-orientation="vertical"
              aria-valuemin={RECENT_DETAIL_MIN_WIDTH}
              aria-valuemax={RECENT_DETAIL_MAX_WIDTH}
              aria-valuenow={detailPanelWidth}
              tabIndex={0}
              onPointerDown={(event) => {
                detailPanelResizeRef.current = { x: event.clientX, width: detailPanelWidth };
              }}
              onDoubleClick={() => setClampedDetailPanelWidth(RECENT_DETAIL_DEFAULT_WIDTH)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  adjustDetailPanelWidth(-RECENT_DETAIL_RESIZE_STEP);
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  adjustDetailPanelWidth(RECENT_DETAIL_RESIZE_STEP);
                }
              }}
            />

            <aside className="recent-detail-panel" aria-label="Recent paper details">
            {selectedFile && isLockedRecentFile(selectedFile) ? (
              <FolderUnlockPanel
                categoryName={lockedCategoryName}
                password={unlockPassword}
                message={encryptionMessage}
                onPasswordChange={setUnlockPassword}
                onUnlock={async () => {
                  try {
                    const unlocked = await unlockCategoryEncryption({
                      library,
                      categoryId: selectedLockedCategoryId,
                      password: unlockPassword,
                      recentFiles: props.recentFiles
                    });
                    libraryRef.current = unlocked.library;
                    setLibrary(unlocked.library);
                    props.onRecentFilesChange(unlocked.recentFiles);
                    unlockedFolderPasswordsRef.current = {
                      ...unlockedFolderPasswordsRef.current,
                      [selectedLockedCategoryId]: unlockPassword
                    };
                    setUnlockPassword("");
                    setEncryptionMessage("Folder unlocked for this app session.");
                  } catch (error) {
                    setEncryptionMessage(error instanceof Error ? error.message : "Folder unlock failed.");
                  }
                }}
              />
            ) : selectedFile && selectedMetadata ? (
              <>
                <h3>Paper information</h3>
                <div className="recent-detail-title">{selectedFile.title}</div>
                <dl className="recent-detail-list">
                  <div>
                    <dt>Type</dt>
                    <dd>{selectedFile.format.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>Progress</dt>
                    <dd>{readingProgressForRecentFile(selectedFile).progressLabel}</dd>
                  </div>
                  <div>
                    <dt>Position</dt>
                    <dd>{readingProgressForRecentFile(selectedFile).positionLabel}</dd>
                  </div>
                  <div>
                    <dt>Content</dt>
                    <dd>{readingProgressForRecentFile(selectedFile).contentLabel}</dd>
                  </div>
                  <div>
                    <dt>Last opened</dt>
                    <dd>{formatRecentDate(selectedFile.lastOpenedAt)}</dd>
                  </div>
                </dl>
                <div className="recent-detail-actions">
                  <button type="button" className="primary-button" onClick={() => props.onOpenRecent(selectedFile)}>
                    Open document
                  </button>
                  <button
                    type="button"
                    aria-pressed={selectedMetadata.pinned}
                    onClick={() => updateDocumentMetadata([selectedFile.path], (metadata) => ({ ...metadata, pinned: !metadata.pinned }))}
                  >
                    {selectedMetadata.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={selectedMetadata.favorite}
                    onClick={() => updateDocumentMetadata([selectedFile.path], (metadata) => ({ ...metadata, favorite: !metadata.favorite }))}
                  >
                    {selectedMetadata.favorite ? "Unfavorite" : "Favorite"}
                  </button>
                </div>
                <fieldset className="recent-check-group">
                  <legend>Categories</legend>
                  {editableCategories.length === 0 ? (
                    <p className="recent-muted">Create a category before binding this paper.</p>
                  ) : (
                    editableCategories.map((category) => (
                      <label key={category.id} style={{ paddingLeft: `${categoryDepth(library.categories, category) * 12}px` }}>
                        <input
                          type="checkbox"
                          checked={selectedMetadata.categoryIds.includes(category.id)}
                          onChange={() => updateDocumentMetadata([selectedFile.path], (metadata) => ({
                            ...metadata,
                            categoryIds: toggleDocumentValue(metadata.categoryIds, category.id)
                          }))}
                        />
                        {categoryNameFor(category, lockedCategoryIds)}
                      </label>
                    ))
                  )}
                </fieldset>
                <fieldset className="recent-check-group">
                  <legend>Tags</legend>
                  {library.tags.map((tag) => (
                    <label key={tag.id}>
                      <input
                        type="checkbox"
                        checked={selectedMetadata.tagIds.includes(tag.id)}
                        onChange={() => updateDocumentMetadata([selectedFile.path], (metadata) => ({
                          ...metadata,
                          tagIds: toggleDocumentValue(metadata.tagIds, tag.id)
                        }))}
                      />
                      <span className="tag-dot" style={{ background: tag.color }} />
                      {tag.name}
                    </label>
                  ))}
                </fieldset>
                <div className="folder-encryption">
                  <strong>Folder encryption</strong>
                  <p>Encrypts SmartReader-managed recent metadata, session recovery, annotations, cache indexes, and category metadata for the selected category. External source files stay controlled by the browser or operating system.</p>
                  <label>
                    Category
                    <select value={encryptionCategoryId} onChange={(event) => setEncryptionCategoryId(event.currentTarget.value)}>
                      <option value="">Choose category</option>
                      {selectedEncryptedCategoryIds.map((categoryId) => (
                        <option key={categoryId} value={categoryId}>
                          {categoryById.get(categoryId)
                            ? categoryNameFor(categoryById.get(categoryId) as RecentLibraryCategory, lockedCategoryIds)
                            : categoryId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={encryptionPassword}
                      onChange={(event) => setEncryptionPassword(event.currentTarget.value)}
                    />
                  </label>
                  <label>
                    Confirm password
                    <input
                      type="password"
                      value={encryptionConfirmPassword}
                      onChange={(event) => setEncryptionConfirmPassword(event.currentTarget.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!encryptionCategoryId || !encryptionPassword || encryptionPassword !== encryptionConfirmPassword}
                    onClick={async () => {
                      try {
                        const encrypted = await enableCategoryEncryption({
                          library,
                          categoryId: encryptionCategoryId,
                          password: encryptionPassword,
                          recentFiles: props.recentFiles
                        });
                        libraryRef.current = encrypted.library;
                        setLibrary(encrypted.library);
                        saveRecentLibraryMetadata(encrypted.library);
                        props.onRecentFilesChange(encrypted.recentFiles);
                        props.onProtectedPathsLocked(encrypted.protectedPaths);
                        setSelectedPath("");
                        setSelectedPaths([]);
                        setEncryptionCategoryId("");
                        setEncryptionPassword("");
                        setEncryptionConfirmPassword("");
                        setEncryptionMessage("Folder encrypted.");
                      } catch (error) {
                        setEncryptionMessage(error instanceof Error ? error.message : "Folder encryption failed.");
                      }
                    }}
                  >
                    Encrypt folder
                  </button>
                  {encryptionMessage ? <span className="recent-muted" role="status">{encryptionMessage}</span> : null}
                </div>
              </>
            ) : (
              <p className="empty-note">Select a recent file to review paper information, categories, and tags.</p>
            )}
          </aside>

          <section className="recent-management-panel" aria-label="Recent library management">
            <div className="recent-manager-block">
              <h3>Category management</h3>
              <label>
                New category name
                <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.currentTarget.value)} />
              </label>
              <label>
                Parent category
                <select value={newCategoryParentId} onChange={(event) => setNewCategoryParentId(event.currentTarget.value)}>
                  <option value="">Top level</option>
                  {editableCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={createCategory}>Create category</button>
              <label>
                Manage category
                <select
                  value={categoryEditId}
                  onChange={(event) => {
                    const category = library.categories.find((item) => item.id === event.currentTarget.value);
                    setCategoryEditId(event.currentTarget.value);
                    setCategoryEditName(category?.name ?? "");
                    setCategoryMergeTargetId("");
                  }}
                >
                  <option value="">Choose category</option>
                  {editableCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Rename category
                <input value={categoryEditName} onChange={(event) => setCategoryEditName(event.currentTarget.value)} />
              </label>
              <div className="recent-inline-actions">
                <button type="button" onClick={renameCategory} disabled={!categoryEditId}>Rename</button>
                <button type="button" onClick={deleteCategory} disabled={!categoryEditId}>Delete</button>
              </div>
              <label>
                Merge into
                <select value={categoryMergeTargetId} onChange={(event) => setCategoryMergeTargetId(event.currentTarget.value)}>
                  <option value="">Choose target</option>
                  {categoryMergeTargetOptions.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={mergeCategory} disabled={!categoryEditId || !canMergeSelectedCategory}>
                Merge category
              </button>
            </div>
            <div className="recent-manager-block">
              <h3>Tag management</h3>
              <label>
                New private tag
                <input value={newTagName} onChange={(event) => setNewTagName(event.currentTarget.value)} />
              </label>
              <label>
                Tag color
                <input type="color" value={newTagColor} onChange={(event) => setNewTagColor(event.currentTarget.value)} />
              </label>
              <label>
                Tag category
                <input value={newTagGroup} onChange={(event) => setNewTagGroup(event.currentTarget.value)} />
              </label>
              <button type="button" onClick={createTag}>Create tag</button>
              <div className="default-tag-list">
                {selectableTagOptions.map((tag) => (
                  <span key={tag.id} style={{ borderColor: tag.color }}>{tag.name}</span>
                ))}
              </div>
              <label>
                Edit private tag
                <select value={tagEditId} onChange={(event) => loadTagEditor(event.currentTarget.value)}>
                  <option value="">Choose private tag</option>
                  {privateTagOptions.map((tag) => (
                    <option key={tag.id} value={tag.id}>{tag.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Private tag name
                <input value={tagEditName} onChange={(event) => setTagEditName(event.currentTarget.value)} />
              </label>
              <label>
                Private tag color
                <input type="color" value={tagEditColor} onChange={(event) => setTagEditColor(event.currentTarget.value)} />
              </label>
              <label>
                Private tag category
                <input value={tagEditGroup} onChange={(event) => setTagEditGroup(event.currentTarget.value)} />
              </label>
              <div className="recent-inline-actions">
                <button type="button" onClick={saveTag} disabled={!tagEditId}>Save tag</button>
                <button type="button" onClick={deleteTag} disabled={!tagEditId}>Delete tag</button>
              </div>
            </div>
          </section>
        </div>
      )}
      {hoverPreview ? <RecentHoverPreview preview={hoverPreview} /> : null}
    </div>
  );
}

function BatchToolbar(props: {
  count: number;
  writableCount: number;
  categories: RecentLibraryCategory[];
  tags: RecentLibraryTag[];
  batchCategoryId: string;
  batchTagId: string;
  onCategoryChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onReplaceCategory: () => void;
  onAddCategory: () => void;
  onAddTag: () => void;
  onRemoveTag: () => void;
  onPin: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="batch-toolbar" aria-label="Batch operations">
      <span>{props.count} selected</span>
      <select aria-label="Batch category" value={props.batchCategoryId} onChange={(event) => props.onCategoryChange(event.currentTarget.value)}>
        <option value="">Category</option>
        {props.categories.map((category) => (
          <option key={category.id} value={category.id}>{category.name}</option>
        ))}
      </select>
      <button type="button" onClick={props.onReplaceCategory} disabled={props.writableCount === 0 || !props.batchCategoryId}>Move</button>
      <button type="button" onClick={props.onAddCategory} disabled={props.writableCount === 0 || !props.batchCategoryId}>Classify</button>
      <select aria-label="Batch tag" value={props.batchTagId} onChange={(event) => props.onTagChange(event.currentTarget.value)}>
        <option value="">Tag</option>
        {props.tags.map((tag) => (
          <option key={tag.id} value={tag.id}>{tag.name}</option>
        ))}
      </select>
      <button type="button" onClick={props.onAddTag} disabled={props.writableCount === 0 || !props.batchTagId}>Tag</button>
      <button type="button" onClick={props.onRemoveTag} disabled={props.writableCount === 0 || !props.batchTagId}>Untag</button>
      <button type="button" onClick={props.onPin} disabled={props.writableCount === 0}>Pin</button>
      <button type="button" onClick={props.onFavorite} disabled={props.writableCount === 0}>Favorite</button>
      <button type="button" onClick={props.onDelete} disabled={props.count === 0}>Delete</button>
    </div>
  );
}

function CategoryTree(props: {
  categories: RecentLibraryCategory[];
  lockedCategoryIds: Set<string>;
  activeCategoryId: string;
  onSelect: (categoryId: string) => void;
}) {
  return (
    <div className="category-tree">
      {props.categories.filter((category) => !category.parentId).map((category) => (
        <CategoryNode key={category.id} {...props} category={category} depth={0} />
      ))}
    </div>
  );
}

function CategoryNode(props: {
  categories: RecentLibraryCategory[];
  lockedCategoryIds: Set<string>;
  category: RecentLibraryCategory;
  activeCategoryId: string;
  depth: number;
  onSelect: (categoryId: string) => void;
}) {
  const children = props.categories.filter((category) => category.parentId === props.category.id);

  return (
    <div>
      <button
        type="button"
        className={props.activeCategoryId === props.category.id ? "active" : ""}
        style={{ paddingLeft: `${8 + props.depth * 12}px` }}
        onClick={() => props.onSelect(props.category.id)}
      >
        {categoryNameFor(props.category, props.lockedCategoryIds)}
      </button>
      {children.map((category) => (
        <CategoryNode
          key={category.id}
          categories={props.categories}
          lockedCategoryIds={props.lockedCategoryIds}
          category={category}
          activeCategoryId={props.activeCategoryId}
          depth={props.depth + 1}
          onSelect={props.onSelect}
        />
      ))}
    </div>
  );
}

function RecentHoverPreview(props: { preview: HoverPreview }) {
  const { file, x, y } = props.preview;
  const readingProgress = readingProgressForRecentFile(file);

  return (
    <div className="recent-hover-card" style={{ left: x, top: y }}>
      <strong>{file.title}</strong>
      <span>{file.format.toUpperCase()} / {readingProgress.progressLabel} / {readingProgress.positionLabel}</span>
      <span>{readingProgress.contentLabel}</span>
      <code>{file.path}</code>
    </div>
  );
}

function FolderUnlockPanel(props: {
  categoryName: string;
  password: string;
  message: string;
  onPasswordChange: (value: string) => void;
  onUnlock: () => void;
}) {
  return (
    <div className="folder-unlock-panel">
      <h3>{props.categoryName}</h3>
      <p className="recent-muted">This folder is encrypted. Unlock it to view, open, search, preview, or batch-manage its SmartReader records.</p>
      <label>
        Folder password
        <input
          type="password"
          value={props.password}
          onChange={(event) => props.onPasswordChange(event.currentTarget.value)}
        />
      </label>
      <button type="button" className="primary-button" disabled={!props.password} onClick={props.onUnlock}>
        Unlock folder
      </button>
      {props.message ? <span className="recent-muted" role="status">{props.message}</span> : null}
    </div>
  );
}

function lockedLibraryCategoryIds(
  library: RecentLibraryMetadata,
  unlockedPasswords: Record<string, string>
): Set<string> {
  const lockedIds = new Set<string>();

  Object.values(library.encryptedFolders ?? {}).forEach((folder) => {
    if (unlockedPasswords[folder.categoryId]) {
      return;
    }

    const categoryIds = folder.categoryIds?.length
      ? folder.categoryIds
      : categoryDescendantIds(library.categories, folder.categoryId);

    categoryIds.forEach((categoryId) => lockedIds.add(categoryId));
  });

  return lockedIds;
}

function categoryNameFor(category: RecentLibraryCategory, lockedCategoryIds: Set<string>): string {
  return lockedCategoryIds.has(category.id) ? lockedCategoryName : category.name;
}

function metadataFor(library: RecentLibraryMetadata, path: string): RecentDocumentMetadata {
  return ensureRecentDocumentMetadata(library.documents[path]);
}

function matchesFilter(file: RecentFile, metadata: RecentDocumentMetadata, filter: RecentFilter): boolean {
  if (isLockedRecentFile(file)) {
    return filter.kind === "all" ||
      (filter.kind === "category" && lockedRecentCategoryId(file) === filter.categoryId);
  }

  if (filter.kind === "format") {
    return file.format === filter.format;
  }

  if (filter.kind === "category") {
    return metadata.categoryIds.includes(filter.categoryId);
  }

  if (filter.kind === "tag") {
    return metadata.tagIds.includes(filter.tagId);
  }

  if (filter.kind === "pinned") {
    return metadata.pinned;
  }

  if (filter.kind === "favorite") {
    return metadata.favorite;
  }

  return true;
}

function formatRecentDate(value: number): string {
  if (!Number.isFinite(value)) {
    return "Unknown";
  }

  return new Date(value).toLocaleDateString();
}

function lockedRecentCategoryId(file: RecentFile): string {
  if (!isLockedRecentFile(file)) {
    return "";
  }

  const withoutScheme = file.path.replace("smartreader-locked://", "");
  return withoutScheme.slice(0, withoutScheme.indexOf("/"));
}

function uniqueCategoryId(categories: RecentLibraryCategory[], baseId: string): string {
  return uniqueId(categories.map((category) => category.id), baseId);
}

function uniqueTagId(tags: RecentLibraryTag[], baseId: string): string {
  return uniqueId(tags.map((tag) => tag.id), baseId);
}

function uniqueId(ids: string[], baseId: string): string {
  if (!ids.includes(baseId)) {
    return baseId;
  }

  let index = 2;
  let nextId = `${baseId}-${index}`;

  while (ids.includes(nextId)) {
    index += 1;
    nextId = `${baseId}-${index}`;
  }

  return nextId;
}

function mergeValues(values: string[], fromId: string, toId: string): string[] {
  const next = values.map((value) => value === fromId ? toId : value);

  return Array.from(new Set(next));
}

function mapDocumentMetadata(
  documents: RecentLibraryMetadata["documents"],
  mapper: (metadata: RecentDocumentMetadata) => RecentDocumentMetadata
): RecentLibraryMetadata["documents"] {
  return Object.fromEntries(
    Object.entries(documents).map(([path, metadata]) => [path, mapper(ensureRecentDocumentMetadata(metadata))])
  );
}

function protectedDocumentPathsForUnlockedFolders(
  library: RecentLibraryMetadata,
  folderIds: string[]
): string[] {
  const protectedCategoryIds = new Set<string>();

  folderIds.forEach((folderId) => {
    const folder = library.encryptedFolders?.[folderId];

    if (!folder) {
      return;
    }

    expandedProtectedCategoryIds(library.categories, folder.categoryIds ?? [folder.categoryId])
      .forEach((categoryId) => protectedCategoryIds.add(categoryId));
  });

  return Object.entries(library.documents)
    .filter(([, metadata]) => metadata.categoryIds.some((categoryId) => protectedCategoryIds.has(categoryId)))
    .map(([path]) => path);
}

function expandedProtectedCategoryIds(categories: RecentLibraryCategory[], categoryIds: string[]): string[] {
  const ids = [...categoryIds];

  for (let index = 0; index < ids.length; index += 1) {
    categories
      .filter((category) => category.parentId === ids[index])
      .forEach((category) => {
        if (!ids.includes(category.id)) {
          ids.push(category.id);
        }
      });
  }

  return ids;
}

export function mergeRecentLibraryCategory(
  current: RecentLibraryMetadata,
  sourceCategoryId: string,
  targetCategoryId: string
): RecentLibraryMetadata {
  if (!isCategoryMergeTarget(current.categories, sourceCategoryId, targetCategoryId)) {
    return current;
  }

  return {
    ...current,
    categories: current.categories
      .filter((category) => category.id !== sourceCategoryId)
      .map((category) => category.parentId === sourceCategoryId
        ? { ...category, parentId: targetCategoryId }
        : category),
    documents: mapDocumentMetadata(current.documents, (metadata) => ({
      ...metadata,
      categoryIds: mergeValues(metadata.categoryIds, sourceCategoryId, targetCategoryId)
    }))
  };
}

function isCategoryMergeTarget(
  categories: RecentLibraryCategory[],
  sourceCategoryId: string,
  targetCategoryId: string
): boolean {
  if (!sourceCategoryId || !targetCategoryId || sourceCategoryId === targetCategoryId) {
    return false;
  }

  if (!categories.some((category) => category.id === sourceCategoryId) || !categories.some((category) => category.id === targetCategoryId)) {
    return false;
  }

  return !categoryDescendantIds(categories, sourceCategoryId).includes(targetCategoryId);
}

function categoryDescendantIds(categories: RecentLibraryCategory[], categoryId: string): string[] {
  const ids = [categoryId];

  for (let index = 0; index < ids.length; index += 1) {
    categories
      .filter((category) => category.parentId === ids[index])
      .forEach((category) => {
        if (!ids.includes(category.id)) {
          ids.push(category.id);
        }
      });
  }

  return ids;
}

function categoryDepth(categories: RecentLibraryCategory[], category: RecentLibraryCategory): number {
  const seen = new Set([category.id]);
  let current = category;
  let depth = 0;

  while (current.parentId) {
    if (seen.has(current.parentId)) {
      return depth;
    }

    const parent = categories.find((item) => item.id === current.parentId);

    if (!parent) {
      return depth;
    }

    seen.add(parent.id);
    current = parent;
    depth += 1;
  }

  return depth;
}
