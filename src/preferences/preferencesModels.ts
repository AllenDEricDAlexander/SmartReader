import type { CommandId } from '../commands/commandRegistry';

export type DefaultZoomMode = 'actual-size' | 'fit-width' | 'fit-page';

export type ReaderPreferences = {
  sessionRestoreEnabled: boolean;
  defaultZoomMode: DefaultZoomMode;
  shortcuts: Record<CommandId, string | null>;
};

export type PartialReaderPreferences = Partial<
  Omit<ReaderPreferences, 'shortcuts'> & {
    shortcuts: Partial<Record<CommandId, string | null>>;
  }
>;
