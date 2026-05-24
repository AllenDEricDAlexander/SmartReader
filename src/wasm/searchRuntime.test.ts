import { describe, expect, it } from "vitest";
import {
  findAllDocumentMatches,
  loadSearchWasmRuntime
} from "./searchRuntime";
import type { SearchWorkerDocument } from "../lib/wasmAdapter";

const wasmFixtureBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x13, 0x01, 0x0f, 0x72, 0x75, 0x6e, 0x74,
  0x69, 0x6d, 0x65, 0x5f, 0x76, 0x65, 0x72, 0x73,
  0x69, 0x6f, 0x6e, 0x00, 0x00,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x01, 0x0b
]);

describe("search wasm runtime", () => {
  it("reaches ready only after a wasm module instantiates", async () => {
    const runtime = await loadSearchWasmRuntime({ wasmBytes: wasmFixtureBytes });

    expect(runtime.version).toBe(1);
    expect(runtime.countMatches("alpha beta alpha", "alpha")).toBe(2);
  });

  it("rejects readiness when wasm init fails", async () => {
    await expect(loadSearchWasmRuntime({ wasmBytes: new Uint8Array([0, 1, 2, 3]) })).rejects.toThrow();
  });

  it("returns every same-document match without applying a result limit", async () => {
    const runtime = await loadSearchWasmRuntime({ wasmBytes: wasmFixtureBytes });
    const document: SearchWorkerDocument = {
      id: "chapter-1",
      label: "Chapter One",
      text: "needle one needle two needle three",
      location: { kind: "epub", chapterHref: "chapter-1.xhtml", chapterLabel: "Chapter One", progress: 0 }
    };

    const matches = findAllDocumentMatches(document, "needle", runtime);

    expect(matches.map((match) => match.id)).toEqual([
      "wasm-chapter-1-0",
      "wasm-chapter-1-11",
      "wasm-chapter-1-22"
    ]);
  });
});
