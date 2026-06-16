export type DebouncedFlush<T> = {
  schedule(value: T): void;
  flushNow(): Promise<void>;
  cancel(): void;
};

export function createDebouncedFlush<T>(
  write: (value: T) => Promise<void>,
  delayMs: number,
): DebouncedFlush<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(value) {
      pending = value;
      cancel();
      timer = setTimeout(() => {
        void this.flushNow();
      }, delayMs);
    },
    async flushNow() {
      cancel();

      if (pending === null) {
        return;
      }

      const value = pending;
      pending = null;
      await write(value);
    },
    cancel,
  };
}
