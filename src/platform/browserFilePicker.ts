import type { BrowserFileSource } from './fileSource';

export function isBrowserPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function fileToBrowserSource(file: File): BrowserFileSource {
  return {
    kind: 'browser-file',
    file,
    name: file.name,
  };
}
