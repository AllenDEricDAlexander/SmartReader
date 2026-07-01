type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: unknown;
    transformCallback?: unknown;
  };
};

export function isTauriRuntimeAvailable(): boolean {
  const internals = (window as TauriRuntimeWindow).__TAURI_INTERNALS__;

  return (
    typeof internals?.invoke === 'function' &&
    typeof internals.transformCallback === 'function'
  );
}
