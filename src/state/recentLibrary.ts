export interface RecentLibraryCategory {
  id: string;
  name: string;
  parentId?: string;
}

export interface RecentLibraryTag {
  id: string;
  name: string;
  color: string;
  group: string;
  builtIn?: boolean;
}

export interface RecentDocumentMetadata {
  categoryIds: string[];
  tagIds: string[];
  pinned: boolean;
  favorite: boolean;
}

export interface RecentLibraryEncryptedFolder {
  categoryId: string;
  categoryIds?: string[];
  tagIds?: string[];
  pathHashes: string[];
  salt: string;
  verifierIv: string;
  verifierData: string;
  payloadIv: string;
  payloadData: string;
  lockedAt: number;
}

export interface RecentLibraryMetadata {
  categories: RecentLibraryCategory[];
  tags: RecentLibraryTag[];
  documents: Record<string, RecentDocumentMetadata>;
  encryptedFolders?: Record<string, RecentLibraryEncryptedFolder>;
}

const recentLibraryKey = "smartreader.recentLibrary.v1";
export const lockedCategoryName = "Locked category";

export const defaultAcademicTags: RecentLibraryTag[] = [
  { id: "tag-high-value", name: "高价值文献", color: "#9e432e", group: "Academic", builtIn: true },
  { id: "tag-to-read", name: "待精读", color: "#7a5a1f", group: "Academic", builtIn: true },
  { id: "tag-read", name: "已读完", color: "#48692e", group: "Academic", builtIn: true },
  { id: "tag-citable", name: "可引用", color: "#326a8f", group: "Academic", builtIn: true },
  { id: "tag-conflict", name: "观点冲突", color: "#7d4f93", group: "Academic", builtIn: true },
  { id: "tag-innovative", name: "创新点突出", color: "#6b5a2c", group: "Academic", builtIn: true }
];

export function createRecentLibraryMetadata(): RecentLibraryMetadata {
  return {
    categories: [],
    tags: defaultAcademicTags,
    documents: {},
    encryptedFolders: {}
  };
}

export function loadRecentLibraryMetadata(): RecentLibraryMetadata {
  try {
    const raw = localStorage.getItem(recentLibraryKey);

    if (!raw) {
      return createRecentLibraryMetadata();
    }

    return normalizeRecentLibraryMetadata(JSON.parse(raw));
  } catch {
    return createRecentLibraryMetadata();
  }
}

export function saveRecentLibraryMetadata(metadata: RecentLibraryMetadata): void {
  localStorage.setItem(recentLibraryKey, JSON.stringify(redactEncryptedMetadata(metadata)));
}

export function ensureRecentDocumentMetadata(metadata?: Partial<RecentDocumentMetadata>): RecentDocumentMetadata {
  return {
    categoryIds: Array.isArray(metadata?.categoryIds) ? metadata.categoryIds.filter(isString) : [],
    tagIds: Array.isArray(metadata?.tagIds) ? metadata.tagIds.filter(isString) : [],
    pinned: metadata?.pinned === true,
    favorite: metadata?.favorite === true
  };
}

export function toggleDocumentValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function recentLibraryCategoryId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return `category-${slug || Date.now()}`;
}

export function recentLibraryTagId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return `tag-private-${slug || Date.now()}`;
}

function normalizeRecentLibraryMetadata(value: unknown): RecentLibraryMetadata {
  if (!value || typeof value !== "object") {
    return createRecentLibraryMetadata();
  }

  const input = value as Partial<RecentLibraryMetadata>;
  const categories = Array.isArray(input.categories)
    ? input.categories.filter(isRecentLibraryCategory)
    : [];
  const privateTags = Array.isArray(input.tags)
    ? input.tags.filter(isRecentLibraryTag).filter((tag) => !defaultAcademicTags.some((item) => item.id === tag.id))
    : [];
  const documents = input.documents && typeof input.documents === "object"
    ? Object.fromEntries(
      Object.entries(input.documents).map(([path, metadata]) => [
        path,
        ensureRecentDocumentMetadata(metadata as Partial<RecentDocumentMetadata>)
      ])
    )
    : {};

  return redactEncryptedMetadata({
    categories,
    tags: [...defaultAcademicTags, ...privateTags],
    documents,
    encryptedFolders: normalizeEncryptedFolders(input.encryptedFolders)
  });
}

function normalizeEncryptedFolders(value: unknown): Record<string, RecentLibraryEncryptedFolder> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, RecentLibraryEncryptedFolder] => {
        const folder = entry[1] as RecentLibraryEncryptedFolder;
        return entry[0] === folder.categoryId &&
          typeof folder.categoryId === "string" &&
          Array.isArray(folder.pathHashes) &&
          folder.pathHashes.every(isString) &&
          typeof folder.salt === "string" &&
          typeof folder.verifierIv === "string" &&
          typeof folder.verifierData === "string" &&
          typeof folder.payloadIv === "string" &&
          typeof folder.payloadData === "string" &&
          typeof folder.lockedAt === "number" &&
          (folder.categoryIds === undefined || (Array.isArray(folder.categoryIds) && folder.categoryIds.every(isString))) &&
          (folder.tagIds === undefined || (Array.isArray(folder.tagIds) && folder.tagIds.every(isString)));
      })
  );
}

export function redactEncryptedMetadata(metadata: RecentLibraryMetadata): RecentLibraryMetadata {
  const encryptedFolders = Object.values(metadata.encryptedFolders ?? {});

  if (encryptedFolders.length === 0) {
    return metadata;
  }

  const encryptedDescendantIds = new Set<string>();
  const encryptedTagIds = new Set<string>();
  const lockedCategories = new Map<string, RecentLibraryCategory>();
  encryptedFolders.forEach((folder) => {
    const categoryIds = folder.categoryIds?.length
      ? folder.categoryIds
      : categoryDescendantIds(metadata.categories, folder.categoryId);

    categoryIds.forEach((id) => encryptedDescendantIds.add(id));
    folder.tagIds?.forEach((id) => encryptedTagIds.add(id));
    lockedCategories.set(folder.categoryId, {
      id: folder.categoryId,
      name: lockedCategoryName
    });
  });

  return {
    ...metadata,
    categories: [
      ...metadata.categories.filter((category) => !encryptedDescendantIds.has(category.id)),
      ...Array.from(lockedCategories.values()).filter((category) =>
        !metadata.categories.some((item) => item.id === category.id && !encryptedDescendantIds.has(item.id))
      )
    ],
    tags: metadata.tags.filter((tag) => tag.builtIn || !encryptedTagIds.has(tag.id)),
    documents: Object.fromEntries(
      Object.entries(metadata.documents).filter(([, documentMetadata]) =>
        !documentMetadata.categoryIds.some((categoryId) => encryptedDescendantIds.has(categoryId))
      )
    ),
    encryptedFolders: Object.fromEntries(
      encryptedFolders.map((folder) => {
        const { categoryIds: _categoryIds, tagIds: _tagIds, ...persistedFolder } = folder;

        return [persistedFolder.categoryId, persistedFolder];
      })
    )
  };
}

function categoryDescendantIds(categories: RecentLibraryCategory[], rootId: string): string[] {
  const ids = [rootId];
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

function isRecentLibraryCategory(value: unknown): value is RecentLibraryCategory {
  if (!value || typeof value !== "object") {
    return false;
  }

  const category = value as RecentLibraryCategory;
  return typeof category.id === "string" &&
    typeof category.name === "string" &&
    (category.parentId === undefined || typeof category.parentId === "string");
}

function isRecentLibraryTag(value: unknown): value is RecentLibraryTag {
  if (!value || typeof value !== "object") {
    return false;
  }

  const tag = value as RecentLibraryTag;
  return typeof tag.id === "string" &&
    typeof tag.name === "string" &&
    typeof tag.color === "string" &&
    typeof tag.group === "string";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
