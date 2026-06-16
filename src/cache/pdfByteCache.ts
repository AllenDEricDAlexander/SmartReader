export class PdfByteCache {
  private readonly entries = new Map<string, Uint8Array>();
  private totalBytes = 0;

  constructor(private readonly maxBytes = 128 * 1024 * 1024) {}

  get(documentKey: string): Uint8Array | null {
    const bytes = this.entries.get(documentKey);

    if (!bytes) {
      return null;
    }

    this.entries.delete(documentKey);
    this.entries.set(documentKey, bytes);
    return copyBytes(bytes);
  }

  set(documentKey: string, bytes: Uint8Array): void {
    this.delete(documentKey);
    const copied = copyBytes(bytes);
    this.entries.set(documentKey, copied);
    this.totalBytes += copied.byteLength;
    this.prune();
  }

  delete(documentKey: string): void {
    const existing = this.entries.get(documentKey);

    if (!existing) {
      return;
    }

    this.totalBytes -= existing.byteLength;
    this.entries.delete(documentKey);
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private prune(): void {
    while (this.totalBytes > this.maxBytes) {
      const firstKey = this.entries.keys().next().value as string | undefined;

      if (!firstKey) {
        return;
      }

      this.delete(firstKey);
    }
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
