import { describe, expect, it } from 'vitest';
import { createRenderRange } from './renderRange';

describe('createRenderRange', () => {
  it('biases the window ahead of the viewport', () => {
    const renderRange = createRenderRange();

    expect(renderRange({ startPage: 10, endPage: 11, numPages: 1000 })).toEqual({
      startPage: 9,
      endPage: 13,
    });
  });

  it('keeps fewer pages resident than the viewer default of three each side', () => {
    const renderRange = createRenderRange();
    const visible = { startPage: 10, endPage: 11, numPages: 1000 };
    const { startPage, endPage } = renderRange(visible);
    const libraryDefault = visible.endPage + 3 - (visible.startPage - 3) + 1;

    expect(endPage - startPage + 1).toBeLessThan(libraryDefault);
  });

  it('honours an explicit window', () => {
    const renderRange = createRenderRange({ pagesBehind: 0, pagesAhead: 5 });

    expect(renderRange({ startPage: 4, endPage: 4, numPages: 20 })).toEqual({
      startPage: 4,
      endPage: 9,
    });
  });

  it('may return out-of-range bounds for the viewer to clamp', () => {
    const renderRange = createRenderRange();

    expect(renderRange({ startPage: 0, endPage: 0, numPages: 3 })).toEqual({
      startPage: -1,
      endPage: 2,
    });
  });
});
