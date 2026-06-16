import { describe, expect, it, vi } from 'vitest';
import { createDebouncedFlush } from './debounce';

describe('createDebouncedFlush', () => {
  it('runs only the latest scheduled write and supports immediate flush', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const flush = createDebouncedFlush<string>((value) => {
      writes.push(value);
      return Promise.resolve();
    }, 100);

    flush.schedule('first');
    flush.schedule('second');
    await flush.flushNow();

    expect(writes).toEqual(['second']);
    vi.useRealTimers();
  });
});
