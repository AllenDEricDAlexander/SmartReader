import { useEffect, useState } from 'react';

export function useBookListPagination<T>(items: readonly T[], resetKey: string) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);

  useEffect(() => { setPage(1); }, [resetKey]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  return {
    items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    pagination: {
      page: currentPage, pageSize, total: items.length,
      onPageChange: setPage,
      onPageSizeChange: (size: number) => { setPageSize(size); setPage(1); },
    },
  };
}
