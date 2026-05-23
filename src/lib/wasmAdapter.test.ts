import { describe, expect, it, vi } from "vitest";
import {
  createFallbackSearchAdapter,
  createWasmSearchAdapter,
  detectWasmFeatures,
  searchAllAdapterResults
} from "./wasmAdapter";
import type { SearchResult } from "../types/reader";

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
});
