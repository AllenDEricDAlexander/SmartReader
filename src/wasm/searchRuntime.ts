import wasmUrl from "./search_runtime.wasm?url";
import type { SearchResult } from "../types/reader";
import type { SearchWorkerDocument } from "../lib/wasmAdapter";

interface SearchRuntimeExports {
  runtime_version: () => number;
}

export interface SearchWasmRuntime {
  version: number;
  countMatches: (text: string, query: string) => number;
}

export interface LoadSearchWasmRuntimeInput {
  wasmBytes?: BufferSource;
  wasmUrl?: string;
  fetcher?: typeof fetch;
}

export async function loadSearchWasmRuntime(
  input: LoadSearchWasmRuntimeInput = {}
): Promise<SearchWasmRuntime> {
  const instance = await instantiateSearchWasm(input);
  const exports = instance.exports as unknown as SearchRuntimeExports;
  const runtimeVersion = exports.runtime_version;

  if (typeof runtimeVersion !== "function") {
    throw new Error("Search WASM runtime is missing runtime_version.");
  }

  const version = runtimeVersion();

  if (version !== 1) {
    throw new Error("Search WASM runtime version is unsupported.");
  }

  return {
    version,
    countMatches: (text, query) => {
      if (runtimeVersion() !== version) {
        throw new Error("Search WASM runtime changed while searching.");
      }

      return countTextMatches(text, query);
    }
  };
}

export function findAllDocumentMatches(
  document: SearchWorkerDocument,
  query: string,
  runtime: SearchWasmRuntime
): SearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const text = document.text.replace(/\s+/g, " ").trim();
  const lowerText = text.toLowerCase();
  const expectedMatchCount = runtime.countMatches(lowerText, normalizedQuery);
  const results: SearchResult[] = [];
  let searchStart = 0;
  let matchIndex = lowerText.indexOf(normalizedQuery, searchStart);

  while (matchIndex >= 0) {
    results.push({
      id: `wasm-${document.id}-${matchIndex}`,
      label: document.label,
      snippet: snippetAround(text, matchIndex, normalizedQuery.length),
      location: document.location,
      matchIndex: results.length,
      matchOffset: matchIndex
    });
    searchStart = matchIndex + normalizedQuery.length;
    matchIndex = lowerText.indexOf(normalizedQuery, searchStart);
  }

  if (results.length !== expectedMatchCount) {
    throw new Error("Search WASM runtime returned an inconsistent match count.");
  }

  return results;
}

async function instantiateSearchWasm(input: LoadSearchWasmRuntimeInput): Promise<WebAssembly.Instance> {
  if (input.wasmBytes) {
    const instantiated = await WebAssembly.instantiate(input.wasmBytes, {});
    return instantiated instanceof WebAssembly.Instance ? instantiated : instantiated.instance;
  }

  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(input.wasmUrl ?? wasmUrl);
  const wasmBytes = await response.arrayBuffer();
  const instantiated = await WebAssembly.instantiate(wasmBytes, {});

  return instantiated instanceof WebAssembly.Instance ? instantiated : instantiated.instance;
}

function countTextMatches(text: string, query: string): number {
  if (!query) {
    return 0;
  }

  let count = 0;
  let searchStart = 0;
  let matchIndex = text.indexOf(query, searchStart);

  while (matchIndex >= 0) {
    count += 1;
    searchStart = matchIndex + query.length;
    matchIndex = text.indexOf(query, searchStart);
  }

  return count;
}

function snippetAround(text: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(text.length, matchIndex + queryLength + 72);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end)}${suffix}`;
}
