import type { ReaderLocation, SearchResult } from "../types/reader";

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

export interface SearchWorkerDocument {
  id: string;
  label: string;
  text: string;
  location: ReaderLocation;
}

export type SearchWorkerRequest =
  | { id: number; type: "init"; documents: SearchWorkerDocument[] }
  | { id: number; type: "search"; query: string }
  | { id: number; type: "dispose" };

type SearchWorkerRequestBody =
  | { type: "init"; documents: SearchWorkerDocument[] }
  | { type: "search"; query: string }
  | { type: "dispose" };

export type SearchWorkerResponse =
  | { id: number; type: "ready" }
  | { id: number; type: "results"; results: SearchResult[] }
  | { id: number; type: "error"; error: string };

interface SearchWorkerLike {
  onmessage: ((event: MessageEvent<SearchWorkerResponse>) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  onerror?: ((event: ErrorEvent) => void) | null;
  postMessage: (message: SearchWorkerRequest) => void;
  terminate: () => void;
}

interface SearchWorkerConstructor {
  new (scriptURL: string | URL, options?: WorkerOptions): SearchWorkerLike;
}

export interface CreateWasmSearchAdapterInput {
  loadRuntime?: () => Promise<WasmSearchRuntime>;
  fallback: SearchAdapter;
}

export interface CreateSearchWorkerRuntimeInput {
  WorkerCtor?: SearchWorkerConstructor;
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

export async function createSearchWorkerRuntime(
  documents: SearchWorkerDocument[],
  input: CreateSearchWorkerRuntimeInput = {}
): Promise<WasmSearchRuntime> {
  if (!input.WorkerCtor && typeof Worker === "undefined") {
    throw new Error("Search worker is not available in this runtime.");
  }

  const worker = input.WorkerCtor
    ? new input.WorkerCtor(new URL("../workers/searchRuntime.worker.ts", import.meta.url), {
        type: "module"
      })
    : new Worker(new URL("../workers/searchRuntime.worker.ts", import.meta.url), {
        type: "module"
      });
  let requestId = 0;
  const pending = new Map<number, {
    resolve: (response: SearchWorkerResponse) => void;
    reject: (error: Error) => void;
  }>();
  let workerError: Error | undefined;

  worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);

    if (!request) {
      return;
    }

    pending.delete(response.id);

    if (response.type === "error") {
      request.reject(new Error(response.error));
      return;
    }

    request.resolve(response);
  };
  worker.onerror = (event) => {
    handleWorkerFailure(errorFromWorkerEvent(event, "Search worker failed."));
  };
  worker.onmessageerror = (event) => {
    handleWorkerFailure(errorFromWorkerEvent(event, "Search worker message failed."));
  };

  const handleWorkerFailure = (error: Error) => {
    workerError = error;
    pending.forEach((request) => request.reject(error));
    pending.clear();
    worker.terminate();
  };

  const send = (message: SearchWorkerRequestBody) => {
    if (workerError) {
      return Promise.reject(workerError);
    }

    const id = ++requestId;
    const response = new Promise<SearchWorkerResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    worker.postMessage({ ...message, id } as SearchWorkerRequest);
    return response;
  };

  await send({ type: "init", documents });

  return {
    search: async (query) => {
      const response = await send({ type: "search", query });

      return response.type === "results" ? response.results : [];
    },
    dispose: () => {
      pending.forEach((request) => request.reject(new Error("Search worker disposed.")));
      pending.clear();
      worker.postMessage({ id: ++requestId, type: "dispose" });
      worker.terminate();
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

function errorFromWorkerEvent(event: ErrorEvent | MessageEvent, fallbackMessage: string): Error {
  if ("message" in event && event.message) {
    return new Error(event.message);
  }

  if ("data" in event && typeof event.data === "string" && event.data) {
    return new Error(event.data);
  }

  return new Error(fallbackMessage);
}
