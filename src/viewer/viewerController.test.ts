import { describe, expect, it, vi } from 'vitest';
import { ViewerController } from './viewerController';

describe('ViewerController', () => {
  it('returns false when actions are not bound', () => {
    const controller = new ViewerController();

    expect(controller.jumpToPage(3)).toBe(false);
    expect(controller.searchNext()).toBe(false);
    expect(controller.zoomIn()).toBe(false);
  });

  it('delegates commands to bound viewer actions', () => {
    const actions = {
      jumpToPage: vi.fn(),
      searchNext: vi.fn(),
      searchPrevious: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitWidth: vi.fn(),
      fitPage: vi.fn(),
    };
    const controller = new ViewerController();

    controller.bind(actions);

    expect(controller.jumpToPage(5)).toBe(true);
    expect(controller.searchNext()).toBe(true);
    expect(controller.searchPrevious()).toBe(true);
    expect(controller.zoomIn()).toBe(true);
    expect(controller.zoomOut()).toBe(true);
    expect(controller.fitWidth()).toBe(true);
    expect(controller.fitPage()).toBe(true);
    expect(actions.jumpToPage).toHaveBeenCalledWith(5);
  });

  it('clears viewer actions when a document unmounts', () => {
    const controller = new ViewerController();
    controller.bind({
      jumpToPage: vi.fn(),
      searchNext: vi.fn(),
      searchPrevious: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitWidth: vi.fn(),
      fitPage: vi.fn(),
    });

    controller.clear();

    expect(controller.fitPage()).toBe(false);
  });
});
