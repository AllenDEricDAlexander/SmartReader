type ReaderErrorStateProps = {
  title: string;
  message: string | null;
  canRetry: boolean;
  onRetry(): void | Promise<void>;
};

export function ReaderErrorState({ title, message, canRetry, onRetry }: ReaderErrorStateProps) {
  return (
    <section className="reader-error" role="alert">
      <h2>{title}</h2>
      <p>{message ?? 'PDF failed to load.'}</p>
      {canRetry ? (
        <button type="button" onClick={() => void onRetry()}>
          Retry
        </button>
      ) : null}
    </section>
  );
}
