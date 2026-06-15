import type { FileSource } from '../platform/fileSource';

export function desktopPdfSource(path = '/Users/mario/Documents/sample.pdf'): FileSource {
  return {
    kind: 'desktop-path',
    path,
    name: path.split('/').at(-1) ?? 'sample.pdf',
  };
}
