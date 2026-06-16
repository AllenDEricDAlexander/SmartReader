import { cleanup, render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

export function renderApp(ui: ReactElement, options?: RenderOptions) {
  return render(ui, options);
}
