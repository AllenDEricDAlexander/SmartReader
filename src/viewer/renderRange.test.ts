import { describe, expect, it } from 'vitest';
import { createRenderRange } from './renderRange';

describe('createRenderRange', () => {
  it('keeps ten pages behind and ahead of one visible page', () => {
    const renderRange = createRenderRange();

    expect(renderRange({ startPage: 20, endPage: 20, numPages: 100 })).toEqual({
      startPage: 10,
      endPage: 30,
    });
  });

  it('slides forward by the eighth page without a separate batch state', () => {
    const renderRange = createRenderRange();

    expect(renderRange({ startPage: 20, endPage: 20, numPages: 100 })).toEqual({
      startPage: 10,
      endPage: 30,
    });
    expect(renderRange({ startPage: 28, endPage: 28, numPages: 100 })).toEqual({
      startPage: 18,
      endPage: 38,
    });
  });

  it('extends both sides of a multi-page visible range', () => {
    const renderRange = createRenderRange();

    expect(renderRange({ startPage: 20, endPage: 21, numPages: 100 })).toEqual({
      startPage: 10,
      endPage: 31,
    });
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

    expect(renderRange({ startPage: 0, endPage: 0, numPages: 100 })).toEqual({
      startPage: -10,
      endPage: 10,
    });
    expect(renderRange({ startPage: 99, endPage: 99, numPages: 100 })).toEqual({
      startPage: 89,
      endPage: 109,
    });
  });
});
