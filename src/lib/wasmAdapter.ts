import type { SearchResult } from "../types/reader";

export type WasmAdapterStatus = "idle" | "loading" | "ready" | "unavailable" | "fallback" | "error";

export interface WasmFeatureDetection {
  supported: boolean;
  streamingSupported: boolean;
}

export interface WasmAdapterState {
  status: WasmAdapterStatus;
  ready: boolean;
  error?: Error;
}

export interface SearchAdapter {
  readonly state: WasmAdapterState;
  init: () => Promise<void>;
  search: (query: string) => Promise<SearchResult[]>;
  dispose: () => void;
}

export interface WasmSearchRuntime {
  search: (query: string) => Promise<SearchResult[]> | SearchResult[];
  dispose?: () => void;
}

export interface CreateWasmSearchAdapterInput {
  loadRuntime?: () => Promise<WasmSearchRuntime>;
  fallback: SearchAdapter;
}

export function detectWasmFeatures(): WasmFeatureDetection {
  const supported = typeof WebAssembly === "object";

  return {
    supported,
    streamingSupported: supported && typeof WebAssembly.instantiateStreaming === "function"
  };
}

export function createFallbackSearchAdapter(
  searchFallback: (query: string) => Promise<SearchResult[]> | SearchResult[]
): SearchAdapter {
  const state: WasmAdapterState = { status: "fallback", ready: false };

  return {
    state,
    init: async () => undefined,
    search: async (query) => searchFallback(query),
    dispose: () => undefined
  };
}

export function createWasmSearchAdapter(input: CreateWasmSearchAdapterInput): SearchAdapter {
  const state: WasmAdapterState = { status: "idle", ready: false };
  let runtime: WasmSearchRuntime | undefined;

  return {
    state,
    init: async () => {
      if (!detectWasmFeatures().supported) {
        state.status = "unavailable";
        state.ready = false;
        state.error = new Error("WebAssembly is not supported in this runtime.");
        await input.fallback.init();
        return;
      }

      if (!input.loadRuntime) {
        state.status = "unavailable";
        state.ready = false;
        state.error = new Error("No WebAssembly runtime is wired.");
        await input.fallback.init();
        return;
      }

      state.status = "loading";
      state.ready = false;

      try {
        runtime = await input.loadRuntime();
        state.status = "ready";
        state.ready = true;
        state.error = undefined;
      } catch (error) {
        state.status = "fallback";
        state.ready = false;
        state.error = toError(error);
        await input.fallback.init();
      }
    },
    search: async (query) => {
      if (state.status !== "ready" || !runtime) {
        return input.fallback.search(query);
      }

      try {
        return await runtime.search(query);
      } catch (error) {
        state.status = "fallback";
        state.ready = false;
        state.error = toError(error);
        return input.fallback.search(query);
      }
    },
    dispose: () => {
      runtime?.dispose?.();
      input.fallback.dispose();
    }
  };
}

export async function searchAllAdapterResults(
  adapter: Pick<SearchAdapter, "search">,
  query: string
): Promise<SearchResult[]> {
  return adapter.search(query);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
