import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isTauriRuntimeAvailable } from './tauriRuntime';

export async function listenForNativeFileDrop(
  element: HTMLElement,
  onDrop: (paths: string[]) => void,
  onHover: (active: boolean) => void,
): Promise<(() => void) | null> {
  if (!isTauriRuntimeAvailable()) return null;

  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'leave') {
      onHover(false);
      return;
    }
    // Native positions use physical pixels; DOM bounds already include the
    // independently configured home zoom and use CSS pixels.
    const scale = window.devicePixelRatio || 1;
    const x = payload.position.x / scale;
    const y = payload.position.y / scale;
    const bounds = element.getBoundingClientRect();
    const inside = x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
    onHover(payload.type !== 'drop' && inside);
    if (payload.type === 'drop' && inside) onDrop(payload.paths);
  });
}
