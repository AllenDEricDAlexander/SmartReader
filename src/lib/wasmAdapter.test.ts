import { describe, expect, it, vi } from "vitest";
import {
  createFallbackSearchAdapter,
  createSearchWorkerRuntime,
  createWasmSearchAdapter,
  detectWasmFeatures,
  searchAllAdapterResults
} from "./wasmAdapter";
import type { SearchResult } from "../types/reader";
import type { SearchWorkerDocument } from "./wasmAdapter";

const results: SearchResult[] = [
  {
    id: "1",
    label: "Page 1",
    snippet: "first match",
    location: { kind: "page", page: 1 }
  },
  {
    id: "2",
    label: "Page 2",
    snippet: "second match",
    location: { kind: "page", page: 2 }
  }
];

describe("wasm adapter", () => {
  it("detects wasm features without requiring a runtime module", () => {
    expect(detectWasmFeatures()).toMatchObject({
      supported: typeof WebAssembly === "object"
    });
  });

  it("falls back when async wasm init fails and isolates the init error", async () => {
    const fallback = createFallbackSearchAdapter(async () => results);
    const adapter = createWasmSearchAdapter({
      loadRuntime: async () => {
        throw new Error("missing wasm");
      },
      fallback
    });

    await adapter.init();

    expect(adapter.state.status).toBe("fallback");
    expect(adapter.state.error?.message).toBe("missing wasm");
    await expect(adapter.search("match")).resolves.toEqual(results);
  });

  it("stays unavailable instead of ready when no wasm runtime is wired", async () => {
    const fallback = createFallbackSearchAdapter(async () => results);
    const adapter = createWasmSearchAdapter({
      fallback
    });

    await adapter.init();

    expect(adapter.state.status).toBe("unavailable");
    expect(adapter.state.ready).toBe(false);
    await expect(adapter.search("match")).resolves.toEqual(results);
  });

  it("falls back when wasm search fails without dropping the query", async () => {
    const wasmSearch = vi.fn(async () => {
      throw new Error("wasm search failed");
    });
    const fallbackSearch = vi.fn(async () => results);
    const adapter = createWasmSearchAdapter({
      loadRuntime: async () => ({
        search: wasmSearch
      }),
      fallback: createFallbackSearchAdapter(fallbackSearch)
    });

    await adapter.init();
    const found = await adapter.search("chapter");

    expect(found).toEqual(results);
    expect(fallbackSearch).toHaveBeenCalledWith("chapter");
    expect(adapter.state.status).toBe("fallback");
    expect(adapter.state.ready).toBe(false);
    expect(adapter.state.error?.message).toBe("wasm search failed");
  });

  it("returns every adapter result without applying a UI limit", async () => {
    const adapter = createFallbackSearchAdapter(async () => results);

    await expect(searchAllAdapterResults(adapter, "match")).resolves.toHaveLength(2);
  });

  it("loads a module worker runtime and searches indexed payloads", async () => {
    const runtime = await createSearchWorkerRuntime(
      [
        {
          id: "chapter-1",
          label: "Chapter One",
          text: "A quiet opening chapter",
          location: { kind: "epub", chapterHref: "chapter-1.xhtml", chapterLabel: "Chapter One", progress: 0 }
        },
        {
          id: "chapter-2",
          label: "Chapter Two",
          text: "The indexed worker finds this hidden phrase",
          location: { kind: "epub", chapterHref: "chapter-2.xhtml", chapterLabel: "Chapter Two", progress: 1 }
        }
      ],
      { WorkerCtor: createFakeWorkerCtor() }
    );

    await expect(runtime.search("hidden phrase")).resolves.toEqual([
      {
        id: "wasm-chapter-2-30",
        label: "Chapter Two",
        snippet: "The indexed worker finds this hidden phrase",
        location: { kind: "epub", chapterHref: "chapter-2.xhtml", chapterLabel: "Chapter Two", progress: 1 }
      }
    ]);
  });

  it("falls back when module worker wasm init fails", async () => {
    const fallbackSearch = vi.fn(async () => results);
    const adapter = createWasmSearchAdapter({
      loadRuntime: () =>
        createSearchWorkerRuntime(
          [
            {
              id: "chapter-1",
              label: "Chapter One",
              text: "fallback query still reaches fallback",
              location: { kind: "page", page: 1 }
            }
          ],
          { WorkerCtor: createFakeWorkerCtor({ failInit: true }) }
        ),
      fallback: createFallbackSearchAdapter(fallbackSearch)
    });

    await adapter.init();
    await expect(adapter.search("fallback query")).resolves.toEqual(results);

    expect(adapter.state.status).toBe("fallback");
    expect(adapter.state.error?.message).toBe("wasm init failed");
    expect(fallbackSearch).toHaveBeenCalledWith("fallback query");
  });

  it("falls back when the worker module fails before a structured init response", async () => {
    const fallbackSearch = vi.fn(async () => results);
    const adapter = createWasmSearchAdapter({
      loadRuntime: () =>
        createSearchWorkerRuntime(
          [
            {
              id: "chapter-1",
              label: "Chapter One",
              text: "fallback query still reaches fallback",
              location: { kind: "page", page: 1 }
            }
          ],
          { WorkerCtor: createFakeWorkerCtor({ failWorkerLoad: true }) }
        ),
      fallback: createFallbackSearchAdapter(fallbackSearch)
    });

    await adapter.init();
    await expect(adapter.search("fallback query")).resolves.toEqual(results);

    expect(adapter.state.status).toBe("fallback");
    expect(adapter.state.error?.message).toBe("worker module failed");
    expect(fallbackSearch).toHaveBeenCalledWith("fallback query");
  });

  it("falls back when the worker cannot deserialize a response message", async () => {
    const fallbackSearch = vi.fn(async () => results);
    const adapter = createWasmSearchAdapter({
      loadRuntime: () =>
        createSearchWorkerRuntime(
          [
            {
              id: "chapter-1",
              label: "Chapter One",
              text: "fallback query still reaches fallback",
              location: { kind: "page", page: 1 }
            }
          ],
          { WorkerCtor: createFakeWorkerCtor({ failMessage: true }) }
        ),
      fallback: createFallbackSearchAdapter(fallbackSearch)
    });

    await adapter.init();
    await expect(adapter.search("fallback query")).resolves.toEqual(results);

    expect(adapter.state.status).toBe("fallback");
    expect(adapter.state.error?.message).toBe("worker message failed");
    expect(fallbackSearch).toHaveBeenCalledWith("fallback query");
  });

  it("surfaces module worker search failures to the wasm adapter fallback path", async () => {
    const fallbackSearch = vi.fn(async () => results);
    const adapter = createWasmSearchAdapter({
      loadRuntime: () =>
        createSearchWorkerRuntime(
          [
            {
              id: "chapter-1",
              label: "Chapter One",
              text: "fallback query still reaches fallback",
              location: { kind: "page", page: 1 }
            }
          ],
          { WorkerCtor: createFakeWorkerCtor({ failSearch: true }) }
        ),
      fallback: createFallbackSearchAdapter(fallbackSearch)
    });

    await adapter.init();
    await expect(adapter.search("fallback query")).resolves.toEqual(results);

    expect(fallbackSearch).toHaveBeenCalledWith("fallback query");
    expect(adapter.state.status).toBe("fallback");
    expect(adapter.state.error?.message).toBe("worker search failed");
  });
});

function createFakeWorkerCtor(options: {
  failInit?: boolean;
  failMessage?: boolean;
  failSearch?: boolean;
  failWorkerLoad?: boolean;
} = {}) {
  return class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    private documents: SearchWorkerDocument[] = [];

    postMessage(message: { id: number; type: string; documents?: SearchWorkerDocument[]; query?: string }) {
      queueMicrotask(() => {
        if (message.type === "init") {
          if (options.failWorkerLoad) {
            this.onerror?.({ message: "worker module failed" } as ErrorEvent);
            return;
          }

          if (options.failMessage) {
            this.onmessageerror?.({ data: "worker message failed" } as MessageEvent);
            return;
          }

          if (options.failInit) {
            this.onmessage?.({
              data: { id: message.id, type: "error", error: "wasm init failed" }
            } as MessageEvent);
            return;
          }

          this.documents = message.documents ?? [];
          this.onmessage?.({ data: { id: message.id, type: "ready" } } as MessageEvent);
          return;
        }

        if (message.type === "search" && options.failSearch) {
          this.onmessage?.({
            data: { id: message.id, type: "error", error: "worker search failed" }
          } as MessageEvent);
          return;
        }

        if (message.type === "search") {
          const query = (message.query ?? "").toLowerCase();
          const results = this.documents.flatMap((document) => {
            const found: SearchResult[] = [];
            const text = document.text.toLowerCase();
            let searchStart = 0;
            let index = text.indexOf(query, searchStart);

            while (index >= 0) {
              found.push({
                id: `wasm-${document.id}-${index}`,
                label: document.label,
                snippet: document.text,
                location: document.location
              });
              searchStart = index + query.length;
              index = text.indexOf(query, searchStart);
            }

            return found;
          });
          this.onmessage?.({ data: { id: message.id, type: "results", results } } as MessageEvent);
        }
      });
    }

    terminate() {
      this.terminated = true;
      this.documents = [];
    }
  };
}
