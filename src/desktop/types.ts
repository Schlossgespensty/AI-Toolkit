export type RecordData = Record<string, unknown>;
import type { DocumentResult as NativeDocumentResult } from './generated/DocumentResult';
export type { InterfaceSettings as LanguageSettings } from './generated/InterfaceSettings';
/** Only decoded source bytes are frontend-owned, not part of native JSON. */
export type DocumentResult = NativeDocumentResult & { sourceBytes?: Uint8Array };
export type SaveRequest = {
  path?: string;
  content: string | RecordData;
  kind?: string;
  defaultPath?: string;
  sourcePath?: string | null;
  sourceBytes?: Uint8Array | null;
  unchanged?: boolean;
};
export type Listener = (payload?: unknown) => void;
declare global {
  interface Window {
    electronAPI: Record<string, unknown>;
    toolkitI18n: {
      ready: Promise<unknown>;
      t: (key: string, args?: RecordData) => string;
      languages: { id?: string; code?: string; name: string }[];
      locale: string;
    };
    ToolkitTheme: {
      list(): { id: string; name: string }[];
      select(id: string): Promise<unknown>;
      refresh?(): Promise<void>;
    };
    appWorkspace: { setStatus(message: string): void };
    castleShortcuts: { accelerator(key: string): string | undefined };
    unsavedChanges: { confirmAll(action: string): Promise<boolean> };
    castleFormat: {
      classicIssues(document: RecordData, constants: RecordData): string[];
      stringify(document: RecordData): string;
    };
  }
}
