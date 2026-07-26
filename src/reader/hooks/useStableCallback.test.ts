import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStableCallback } from './useStableCallback';

describe('useStableCallback', () => {
  it('keeps the same identity across re-renders', () => {
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: () => 'first' },
    });
    const first = result.current;

    rerender({ fn: () => 'second' });

    expect(result.current).toBe(first);
  });

  it('invokes the latest callback, not the one captured on first render', () => {
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: () => 'first' },
    });

    rerender({ fn: () => 'second' });

    expect(result.current()).toBe('second');
  });

  it('forwards arguments and returns the result', () => {
    const spy = vi.fn((a: number, b: number) => a + b);
    const { result } = renderHook(() => useStableCallback(spy));

    let sum = 0;
    act(() => {
      sum = result.current(2, 3);
    });

    expect(sum).toBe(5);
    expect(spy).toHaveBeenCalledWith(2, 3);
  });
});
