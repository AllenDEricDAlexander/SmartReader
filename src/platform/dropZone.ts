export function getPdfFilesFromDrop(files: Iterable<File>): File[] {
  return [...files].filter(isPdfFile);
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}
