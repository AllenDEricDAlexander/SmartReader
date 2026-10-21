// Run after create-papers.py and mock-ai.mjs. Uses only synthetic QA data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import { LibraryService } from '../../src/library/libraryService';
import { extractPdf } from '../../src/library/pdfExtraction';
import type { LibrarySnapshot } from '../../src/library/libraryModels';
import type { LibraryStorage } from '../../src/library/libraryStorage';
import { AiService } from '../../src/ai/aiService';
import { requestCompletion } from '../../src/ai/openAiClient';
import type { AiTransport } from '../../src/ai/aiTransport';

GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/build/pdf.worker.js');
const fixtureDirectory = process.argv[2] ?? '/tmp/smartreader-qa-papers';
const baseUrl = `http://127.0.0.1:${process.env.SMARTREADER_QA_PORT || 17861}`;
let revision = 0;
let saved: LibrarySnapshot | null = null;
const files = new Map<string, Uint8Array>();
const storage: LibraryStorage = {
  async load() { return { revision, data: structuredClone(saved) }; },
  async commit(expected, data, blobs) {
    assert.equal(expected, revision);
    for (const blob of blobs) {
      if (blob.bytes) files.set(blob.id, blob.bytes.slice());
      else files.delete(blob.id);
    }
    saved = structuredClone(data);
    return ++revision;
  },
  async readFile(id) {
    const bytes = files.get(id);
    if (!bytes) throw new Error('QA file missing');
    return bytes.slice();
  },
};
const transport: AiTransport = async (request, signal) => {
  const response = await fetch(request.url, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.apiKey}` },
    body: JSON.stringify(request.body) });
  return { status: response.status, body: await response.text() };
};
const completion: typeof requestCompletion = (provider, key, messages, options) =>
  requestCompletion(provider, key, messages, { ...options, transport });
const library = new LibraryService(storage, extractPdf);
const ai = new AiService(library, completion);

try {
  const provider = await ai.saveProvider({ name: 'Local QA A', baseUrl: `${baseUrl}/v1`, model: 'qa-primary' }, 'qa-only-key', 'qa-key-password');
  await ai.testConnection();
  await ai.setAutoEnrich(true);
  const firstBytes = new Uint8Array(await readFile(resolve(fixtureDirectory, 'attention-study.pdf')));
  const first = await library.importPdf(firstBytes, 'attention-study.pdf');
  const duplicate = await library.importPdf(new Uint8Array(await readFile(resolve(fixtureDirectory, 'attention-copy.pdf'))), 'attention-copy.pdf');
  const second = await library.importPdf(new Uint8Array(await readFile(resolve(fixtureDirectory, 'education-study.pdf'))), 'education-study.pdf');
  await library.importPdf(new Uint8Array(await readFile(resolve(fixtureDirectory, 'preprint-study.pdf'))), 'preprint-study.pdf');
  const deadline = Date.now() + 10_000;
  while (ai.getView().enrichingPaperIds.length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
  assert.equal(ai.getView().enrichingPaperIds.length, 0);
  assert.equal(first.id, duplicate.id);
  assert.equal(files.size, 3);
  assert.equal(library.getPaper(first.id)?.metadata.doi, '10.5555/smartreader.qa.001');
  assert.equal(library.getPaper(first.id)?.metadata.journal, 'Journal of QA Neuroscience');
  assert.equal(library.getPaper(first.id)?.aiStatus, 'ready');
  assert.equal(library.getView().snapshot.memberships[first.id].length, 5);
  assert.equal(library.search('hippocampal consolidation')[0].page, 2);
  await library.editMetadata(first.id, { title: 'QA private curated title', year: '2024' });
  await ai.enrich(first.id);
  assert.equal(library.getPaper(first.id)?.metadata.year, '2024');
  const folder = await library.createFolder('QA project');
  const child = await library.createFolder('QA subcategory', folder.id);
  const review = await library.createFolder('QA review');
  await library.categorize([first.id, second.id], [child.id, review.id], 'move');
  await library.batchUpdate([first.id, second.id], { favorite: true, pinned: true });
  const now = new Date().toISOString();
  await library.saveAnnotation(first.id, { id: null, documentKey: '', page: 2, type: 'note', color: '#60a5fa', text: 'QA private annotation', quote: null, areas: [], createdAt: now, updatedAt: now });
  await library.saveBookmark(first.id, { id: null, documentKey: '', page: 2, title: 'QA private bookmark', note: null, createdAt: now, updatedAt: now });
  await library.recordReading(first.id, 30, 2, 1.25);
  const answer = await ai.ask('What supports hippocampal consolidation?', { paperIds: [first.id] });
  assert.equal(answer.sources[0].page, 2);
  assert.ok(answer.text.includes('[S1]'));
  const alternate = await ai.saveProvider({ name: 'Local QA B', baseUrl: `${baseUrl}/alt/v1`, model: 'qa-secondary' }, 'qa-only-key');
  await ai.selectProvider(alternate.id);
  await ai.testConnection();
  const vault = await library.encryptFolder(folder.id, 'qa-vault-password');
  assert.ok(!JSON.stringify(saved).includes('QA private curated title'));
  assert.ok(!JSON.stringify(saved).includes('QA private annotation'));
  assert.ok(!JSON.stringify(saved).includes('qa-only-key'));
  assert.notEqual(new TextDecoder().decode(files.get(first.id)?.subarray(0, 5)), '%PDF-');
  await library.lockVault(vault.id);
  assert.equal(library.getPaper(first.id), undefined);
  assert.equal(library.search('hippocampal consolidation').length, 0);
  await assert.rejects(library.readPdf(first.id));
  const reopened = new LibraryService(storage, extractPdf);
  await reopened.initialize();
  await assert.rejects(reopened.unlockVault(vault.id, 'wrong-password'));
  await reopened.unlockVault(vault.id, 'qa-vault-password');
  assert.equal(reopened.getPaper(first.id)?.metadata.title, 'QA private curated title');
  assert.equal(reopened.getPaper(first.id)?.readingSeconds, 30);
  assert.equal(reopened.getPaper(first.id)?.lastPage, 2);
  assert.deepEqual(Array.from(await reopened.readPdf(first.id)), Array.from(firstBytes));
  const reopenedAi = new AiService(reopened, completion);
  try {
    assert.equal(reopenedAi.hasApiKey(provider.id), false);
    await reopenedAi.unlockSavedKey(provider.id, 'qa-key-password');
    await reopenedAi.selectProvider(provider.id);
    await reopenedAi.testConnection();
  } finally { reopenedAi.dispose(); }
  console.log('PASS: real PDF import/deduplication, automatic AI classification, metadata edits, page search, cited answers, two compatible endpoints, collections, favorites, notes, encryption and restart recovery.');
  console.log('Boundary: this is a headless TS workflow with in-memory storage and synthetic HTTP; native SQLite/HTTP have separate Rust tests. It is not desktop UI verification.');
} finally { ai.dispose(); }
