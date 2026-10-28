import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PersistedDocument } from '../persistence/persistenceApi';
import { SessionRestoreWorkspace } from './SessionRestoreWorkspace';

describe('session restore document list', () => {
  it('opens a row once from either its name or progress, and keeps missing files disabled', () => {
    const document: PersistedDocument = { documentKey: 'desktop:/book.pdf', displayName: 'book.pdf', path: '/book.pdf',
      fileSize: 1, modifiedAt: null, lastOpenedAt: null, pageCount: 10, lastPage: 4, progress: 0.4, missing: false, tagIds: [] };
    const missing = { ...document, documentKey: 'desktop:/missing.pdf', displayName: 'missing.pdf', missing: true };
    const onOpenDocument = vi.fn();
    render(<SessionRestoreWorkspace sessions={[]} documents={[document, missing]} onSelectSession={vi.fn()}
      onOpenDocument={onOpenDocument} onRestore={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('button', { name: '打开 book.pdf' }).closest('tr')!).getByText('40%'));
    expect(onOpenDocument).toHaveBeenCalledExactlyOnceWith(document);
    fireEvent.click(screen.getByRole('button', { name: '打开 book.pdf' }));
    expect(onOpenDocument).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '打开 missing.pdf' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '打开 missing.pdf' }).closest('tr')!);
    expect(onOpenDocument).toHaveBeenCalledTimes(2);
  });
});
