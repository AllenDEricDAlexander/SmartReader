export type DesktopPathFileSource = {
  kind: 'desktop-path';
  path: string;
  name: string;
};

export type BrowserFileSource = {
  kind: 'browser-file';
  file: File;
  name: string;
};

export type LibraryFileSource = { kind: 'library'; paperId: string; name: string };
export type FileSource = DesktopPathFileSource | BrowserFileSource | LibraryFileSource;

export function getFileSourceName(source: FileSource): string {
  return source.name.trim() || 'Untitled PDF';
}

export function getDocumentKey(source: FileSource): string {
  if (source.kind === 'library') return `paper:${source.paperId}`;
  if (source.kind === 'desktop-path') {
    return `desktop:${source.path}`;
  }

  return `browser:${source.name}:${source.file.size}:${source.file.lastModified}`;
}
