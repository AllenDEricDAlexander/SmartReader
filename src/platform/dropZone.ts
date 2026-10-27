export function getPdfFilesFromDrop(files: Iterable<File>): File[] {
  return [...files].filter(isPdfFile);
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function hasDroppedDirectory(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.items ?? []).some((item) => item.webkitGetAsEntry?.()?.isDirectory);
}

export async function readDroppedPdfs(dataTransfer: DataTransfer): Promise<{ files: File[]; hasDirectories: boolean }> {
  // Capture entries while the drop event still owns the data store. Directory
  // readers return batches, so continue reading until an empty batch arrives.
  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
  const fallbackFiles = Array.from(dataTransfer.files);
  const files: File[] = [];
  const hasDirectories = entries.some(({ entry }) => entry?.isDirectory);
  const addFile = (file: File) => {
    if (!isPdfFile(file)) return;
    files.push(file);
    if (files.length > 2000) throw new Error('文件夹导入最多支持 2000 份 PDF 和 20 层子文件夹。');
  };
  const visit = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (entry.isDirectory) {
      if (depth > 20) throw new Error('文件夹导入最多支持 2000 份 PDF 和 20 层子文件夹。');
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!children.length) break;
        for (const child of children) await visit(child, depth + 1);
      }
    } else if (entry.isFile && entry.name.toLowerCase().endsWith('.pdf')) {
      addFile(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
    }
  };
  if (entries.length) {
    for (const { entry, file } of entries) {
      if (entry) await visit(entry, 0);
      else if (file) addFile(file);
    }
  } else {
    fallbackFiles.forEach(addFile);
  }
  return { files, hasDirectories };
}
