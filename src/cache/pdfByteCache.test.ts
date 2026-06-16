import { describe, expect, it } from 'vitest';
import { PdfByteCache } from './pdfByteCache';

describe('PdfByteCache', () => {
  it('stores copied bytes by document key', () => {
    const cache = new PdfByteCache();
    const source = new Uint8Array([1, 2, 3]);

    cache.set('desktop:/tmp/book.pdf', source);
    source[0] = 9;

    expect(cache.get('desktop:/tmp/book.pdf')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('evicts the least recently used entry when over limit', () => {
    const cache = new PdfByteCache(5);

    cache.set('a', new Uint8Array([1, 2, 3]));
    cache.set('b', new Uint8Array([4, 5, 6]));

    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toEqual(new Uint8Array([4, 5, 6]));
  });
});
