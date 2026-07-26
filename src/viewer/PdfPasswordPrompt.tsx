import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';

export type PdfPasswordStatus = 'required' | 'wrong';

type PdfPasswordPromptProps = {
  status: PdfPasswordStatus;
  onSubmit(password: string): void;
};

/**
 * Shown in place of the page surface while a document waits for its password.
 * Without this the reader had no way to answer the request and simply sat on a
 * blank surface until the load watchdog declared the document broken.
 */
export function PdfPasswordPrompt({ status, onSubmit }: PdfPasswordPromptProps) {
  const [password, setPassword] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!password) {
      return;
    }

    onSubmit(password);
  };

  return (
    <section className="viewer-password-prompt" aria-label="文档密码">
      <form className="viewer-password-card" onSubmit={handleSubmit}>
        <div className="viewer-password-title">
          <KeyRound size={18} />
          <h2>此文档已加密</h2>
        </div>
        <p className="muted-copy">请输入打开密码。密码只用于本次解密，不会被保存。</p>
        <label className="viewer-password-field">
          <span>密码</span>
          <input
            aria-label="PDF 密码"
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {status === 'wrong' ? (
          <p className="viewer-password-error" role="alert">
            密码不正确，请重试。
          </p>
        ) : null}
        <button type="submit" disabled={!password}>
          解锁文档
        </button>
      </form>
    </section>
  );
}
