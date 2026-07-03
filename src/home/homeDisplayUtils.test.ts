import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatPageProgress,
  formatProgressPercent,
  formatShortDate,
  getDirectoryPath,
} from './homeDisplayUtils';

describe('homeDisplayUtils', () => {
  const localDateTime = '2026-07-03T09:05:00+08:00';

  it('formats directory paths from local and browser-backed documents', () => {
    expect(getDirectoryPath('/Users/mario/Documents/book.pdf')).toBe('/Users/mario/Documents/');
    expect(getDirectoryPath('C:\\Users\\mario\\Documents\\book.pdf')).toBe(
      'C:/Users/mario/Documents/',
    );
    expect(getDirectoryPath('book.pdf')).toBe('book.pdf');
    expect(getDirectoryPath(null)).toBe('本地浏览器文件');
  });

  it('formats full date-time labels using the local timezone', () => {
    expect(formatDateTime(localDateTime)).toBe(expectedLocalDateTime(localDateTime));
    expect(formatDateTime(null)).toBe('时间未知');
    expect(formatDateTime('not-a-date')).toBe('时间未知');
  });

  it('formats short date labels using the local timezone', () => {
    expect(formatShortDate(localDateTime)).toBe(expectedLocalShortDate(localDateTime));
    expect(formatShortDate(null)).toBe('日期未知');
    expect(formatShortDate('not-a-date')).toBe('日期未知');
  });

  it('formats page progress with and without total page count', () => {
    expect(formatPageProgress({ lastPage: 12, pageCount: 80 })).toBe(
      '上次阅读到 第 12 / 80 页',
    );
    expect(formatPageProgress({ lastPage: 12, pageCount: null })).toBe('上次阅读到 第 12 页');
    expect(formatPageProgress({ lastPage: 12, pageCount: 0 })).toBe('上次阅读到 第 12 页');
  });

  it('formats progress percentages inside display bounds', () => {
    expect(formatProgressPercent(0.426)).toBe(43);
    expect(formatProgressPercent(-0.2)).toBe(0);
    expect(formatProgressPercent(1.6)).toBe(100);
    expect(formatProgressPercent(Number.NaN)).toBe(0);
  });
});

function expectedLocalDateTime(value: string) {
  const date = new Date(value);

  return `${date.getFullYear()}/${padDatePart(date.getMonth() + 1)}/${padDatePart(
    date.getDate(),
  )} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function expectedLocalShortDate(value: string) {
  const date = new Date(value);

  return `${date.getFullYear()}/${padDatePart(date.getMonth() + 1)}/${padDatePart(
    date.getDate(),
  )}`;
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}
