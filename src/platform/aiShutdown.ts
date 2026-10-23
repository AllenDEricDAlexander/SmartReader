import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AiService } from '../ai/aiService';

type ShutdownKind = 'close' | 'exit';
type ShutdownDependencies = {
  listen(handler: (kind: ShutdownKind) => Promise<void>): Promise<() => void>;
  enable(): Promise<void>;
  complete(kind: ShutdownKind): Promise<void>;
};

export async function installAiShutdownHandler(
  ai: Pick<AiService, 'flushAssistantSession' | 'reportShutdownFailure'>,
  dependencies: ShutdownDependencies = {
    listen: (handler) => listen<ShutdownKind>('smartreader://shutdown-requested', (event) => { void handler(event.payload); }),
    enable: () => invoke('enable_shutdown_handler'),
    complete: (kind) => invoke('complete_shutdown', { exit: kind === 'exit' }),
  },
): Promise<() => void> {
  let closing = false;
  const stop = await dependencies.listen(async (kind) => {
    if (closing) return;
    closing = true;
    try {
      await ai.flushAssistantSession();
      await dependencies.complete(kind);
    } catch (error) {
      ai.reportShutdownFailure(error);
      closing = false;
    }
  });
  try { await dependencies.enable(); }
  catch (error) { stop(); throw error; }
  return stop;
}
