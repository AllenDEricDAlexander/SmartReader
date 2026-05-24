import type { SearchWorkerDocument, SearchWorkerRequest, SearchWorkerResponse } from "../lib/wasmAdapter";
import {
  findAllDocumentMatches,
  loadSearchWasmRuntime
} from "../wasm/searchRuntime";
import type { SearchWasmRuntime } from "../wasm/searchRuntime";

let documents: SearchWorkerDocument[] = [];
let runtime: SearchWasmRuntime | undefined;

self.onmessage = (event: MessageEvent<SearchWorkerRequest>) => {
  const message = event.data;

  void handleMessage(message);
};

async function handleMessage(message: SearchWorkerRequest) {
  try {
    if (message.type === "init") {
      runtime = await loadSearchWasmRuntime();
      documents = message.documents;
      postResponse({ id: message.id, type: "ready" });
      return;
    }

    if (message.type === "search") {
      postResponse({
        id: message.id,
        type: "results",
        results: searchDocuments(message.query)
      });
      return;
    }

    documents = [];
    runtime = undefined;
  } catch (error) {
    postResponse({
      id: message.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function searchDocuments(query: string) {
  const searchRuntime = runtime;

  if (!searchRuntime) {
    throw new Error("Search WASM runtime is not ready.");
  }

  return documents.flatMap((document) => findAllDocumentMatches(document, query, searchRuntime));
}

function postResponse(response: SearchWorkerResponse) {
  self.postMessage(response);
}
