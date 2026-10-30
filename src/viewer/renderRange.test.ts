import { describe, expect, it } from 'vitest';
import { createRenderRange } from './renderRange';

describe('createRenderRange', () => {
  it('keeps twenty pages behind and ahead of one visible page', () => {
    const renderRange = createRenderRange();

    expect(renderRange({ startPage: 20, endPage: 20, numPages: 100 })).toEqual({
      startPage: 0,
      endPage: 40,
    });
  });

  it('slides forward and backward with the latest visible page', () => {
    const renderRange = createRenderRange();

    expect(renderRange({ startPage: 20, endPage: 20, numPages: 100 })).toEqual({
      startPage: 0,
      endPage: 40,
    });
    expect(renderRange({ startPage: 28, endPage: 28, numPages: 100 })).toEqual({
      startPage: 8,
      endPage: 48,
    });
    expect(renderRange({ startPage: 27, endPage: 27, numPages: 100 })).toEqual({
      startPage: 7,
      endPage: 47,
    });
  });

  it('moves the window directly to a distant jump target', () => {
    const renderRange = createRenderRange();

    expect(renderRange({ startPage: 20, endPage: 20, numPages: 200 })).toEqual({
      startPage: 0,
      endPage: 40,
    });
    expect(renderRange({ startPage: 150, endPage: 150, numPages: 200 })).toEqual({
      startPage: 130,
      endPage: 170,
    });
  });

  it('extends both sides of a multi-page visible range', () => {
    const renderRange = createRenderRange();

    expect(renderRange({ startPage: 20, endPage: 21, numPages: 100 })).toEqual({
      startPage: 0,
      endPage: 41,
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
      startPage: -20,
      endPage: 20,
    });
    expect(renderRange({ startPage: 99, endPage: 99, numPages: 100 })).toEqual({
      startPage: 79,
      endPage: 119,
    });
  });
});
