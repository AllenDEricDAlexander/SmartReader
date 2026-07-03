import type { PersistedDocument } from '../persistence/persistenceApi';

export function getDirectoryPath(path: string | null): string {
  if (!path) {
    return '本地浏览器文件';
  }

  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');

  if (index <= 0) {
    return normalized;
  }

  return `${normalized.slice(0, index)}/`;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return '时间未知';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }

  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());

  return `${year}/${month}/${day} ${hour}:${minute}`;
}

export function formatShortDate(value: string | null): string {
  if (!value) {
    return '日期未知';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '日期未知';
  }

  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());

  return `${year}/${month}/${day}`;
}

export function formatPageProgress(document: Pick<PersistedDocument, 'lastPage' | 'pageCount'>) {
  if (document.pageCount && document.pageCount > 0) {
    return `上次阅读到 第 ${document.lastPage} / ${document.pageCount} 页`;
  }

  return `上次阅读到 第 ${document.lastPage} 页`;
}

export function formatProgressPercent(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(progress * 100), 0), 100);
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}
