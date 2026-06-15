export class BlobUrlCache {
  private readonly urlsBySession = new Map<string, string>();

  createForSession(sessionId: string, bytes: Uint8Array): string {
    this.revokeForSession(sessionId);
    const blob = new Blob([copyToArrayBuffer(bytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    this.urlsBySession.set(sessionId, url);
    return url;
  }

  getForSession(sessionId: string): string | null {
    return this.urlsBySession.get(sessionId) ?? null;
  }

  revokeForSession(sessionId: string): void {
    const existing = this.urlsBySession.get(sessionId);

    if (!existing) {
      return;
    }

    URL.revokeObjectURL(existing);
    this.urlsBySession.delete(sessionId);
  }

  clear(): void {
    for (const url of this.urlsBySession.values()) {
      URL.revokeObjectURL(url);
    }

    this.urlsBySession.clear();
  }
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
