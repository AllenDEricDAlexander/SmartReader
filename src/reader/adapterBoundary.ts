import type { DocumentSession, RendererAdapter, SearchResult } from "../types/reader";

/**
 * Renderer integrations must satisfy this contract so the shell can swap
 * PDF.js, epub.js, or a future PDFKit bridge without changing app state.
 */
export type { RendererAdapter };

export type RendererRuntime = "web" | "tauri-native" | "react-native" | "wasm";

export interface ReaderFileBytesProvider {
  runtime: "browser-file" | "tauri-path" | "react-native-uri" | "wasm-memory";
  read: (session: DocumentSession) => Promise<ArrayBuffer>;
}

export interface RendererAdapterFactory {
  runtime: RendererRuntime;
  supports: (session: DocumentSession) => boolean;
  create: (session: DocumentSession, bytesProvider: ReaderFileBytesProvider) => RendererAdapter;
}

export interface FutureSearchIndexAdapter {
  runtime: Extract<RendererRuntime, "wasm" | "react-native">;
  indexDocument: (session: DocumentSession, data: ArrayBuffer) => Promise<void>;
  search: (query: string) => Promise<SearchResult[]>;
  dispose: () => void;
}
