import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlobUrlCache } from './blobUrlCache';

describe('BlobUrlCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores Blob URLs by session id', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const cache = new BlobUrlCache();
    const url = cache.createForSession('session-a', new Uint8Array([1, 2, 3]));

    expect(url).toBe('blob:one');
    expect(cache.getForSession('session-a')).toBe('blob:one');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes only the replaced session URL', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const cache = new BlobUrlCache();
    cache.createForSession('session-a', new Uint8Array([1]));
    cache.createForSession('session-a', new Uint8Array([2]));

    expect(cache.getForSession('session-a')).toBe('blob:two');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one');
  });

  it('revokes all URLs when cleared', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const cache = new BlobUrlCache();
    cache.createForSession('session-a', new Uint8Array([1]));
    cache.createForSession('session-b', new Uint8Array([2]));
    cache.clear();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:two');
    expect(cache.getForSession('session-a')).toBeNull();
  });
});
