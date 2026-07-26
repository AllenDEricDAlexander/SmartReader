import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PdfPasswordPrompt } from './PdfPasswordPrompt';

describe('PdfPasswordPrompt', () => {
  it('submits the typed password', () => {
    const onSubmit = vi.fn();
    render(<PdfPasswordPrompt status="required" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('PDF 密码'), { target: { value: 'letmein' } });
    fireEvent.click(screen.getByRole('button', { name: '解锁文档' }));

    expect(onSubmit).toHaveBeenCalledWith('letmein');
  });

  it('will not submit an empty password', () => {
    const onSubmit = vi.fn();
    render(<PdfPasswordPrompt status="required" onSubmit={onSubmit} />);

    expect(screen.getByRole('button', { name: '解锁文档' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reports a rejected password and allows another attempt', () => {
    const onSubmit = vi.fn();
    render(<PdfPasswordPrompt status="wrong" onSubmit={onSubmit} />);

    expect(screen.getByRole('alert')).toHaveTextContent('密码不正确');

    fireEvent.change(screen.getByLabelText('PDF 密码'), { target: { value: 'second-try' } });
    fireEvent.click(screen.getByRole('button', { name: '解锁文档' }));

    expect(onSubmit).toHaveBeenCalledWith('second-try');
  });

  it('does not show an error before the first attempt', () => {
    render(<PdfPasswordPrompt status="required" onSubmit={vi.fn()} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
