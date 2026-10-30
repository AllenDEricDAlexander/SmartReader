import { describe, expect, it, vi } from 'vitest';
import { loadPdfOutline } from './pdfOutline';

describe('PDF outline mapping', () => {
  it('preserves chapter levels and resolves zero-based pages, named destinations and page references', async () => {
    const getDestination = vi.fn().mockResolvedValue([{ num: 12, gen: 0 }, { name: 'XYZ' }, 0, 100, null]);
    const getPageIndex = vi.fn().mockResolvedValue(6);
    const outline = await loadPdfOutline({
      numPages: 20, getDestination, getPageIndex,
      getOutline: async () => [{ title: '第一章', dest: [0, { name: 'Fit' }], items: [
        { title: '介绍', dest: 'intro' },
        { title: '同一目标', dest: 'intro' },
        { title: '页面引用', dest: [{ num: 12, gen: 0 }] },
      ] }],
    });
    expect(outline).toEqual([{ id: '0', title: '第一章', page: 1, children: [
      { id: '0.0', title: '介绍', page: 7, children: [] },
      { id: '0.1', title: '同一目标', page: 7, children: [] },
      { id: '0.2', title: '页面引用', page: 7, children: [] },
    ] }]);
    expect(getDestination).toHaveBeenCalledExactlyOnceWith('intro');
    expect(getPageIndex).toHaveBeenCalledExactlyOnceWith({ num: 12, gen: 0 });
  });

  it('keeps groups and valid children when individual destinations are broken or external', async () => {
    const outline = await loadPdfOutline({
      numPages: 5,
      getDestination: vi.fn().mockRejectedValue(new Error('bad destination')),
      getOutline: async () => [
        { title: '分组', items: [{ title: '子章节', dest: [4] }] },
        { title: '坏链接', dest: 'missing' },
        { title: '越界', dest: [5] },
        { title: '负页码', dest: [-1] },
        { title: '非整数', dest: [0.5] },
        { title: '外部链接', dest: null },
      ],
    });
    expect(outline[0].children[0].page).toBe(5);
    expect(outline.map((item) => item.page)).toEqual([null, null, null, null, null, null]);
  });

  it('handles PDFs without an outline and reports document-level outline failures', async () => {
    expect(await loadPdfOutline({ numPages: 2, getOutline: async () => null })).toEqual([]);
    expect(await loadPdfOutline({ numPages: 2 })).toEqual([]);
    await expect(loadPdfOutline({ numPages: 2, getOutline: async () => { throw new Error('cannot read outline'); } }))
      .rejects.toThrow('cannot read outline');
  });
});
