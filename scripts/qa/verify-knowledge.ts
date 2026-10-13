/** Real PDF + TS RAG + Rust SQLite/sqlite-vec. HTTP fixtures simulate vendors.
 * The Rust test bridge exercises native library functions, not GUI/Tauri IPC.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import { LibraryService } from '../../src/library/libraryService';
import { createLibraryStorage } from '../../src/library/libraryStorage';
import { AiService } from '../../src/ai/aiService';
import { requestCompletion } from '../../src/ai/openAiClient';
import { requestEmbeddings } from '../../src/ai/embeddingsClient';
import { createKnowledgeStorage } from '../../src/ai/knowledgeStorage';
import { createKnowledgeVectorSearch } from '../../src/ai/knowledgeVectors';
import type { AiTransport } from '../../src/ai/aiTransport';

const directory = await mkdtemp(join(tmpdir(), 'smartreader-knowledge-'));
const database = join(directory, 'qa.sqlite');
const portProbe = createServer();
await new Promise<void>((done) => portProbe.listen(0, '127.0.0.1', done));
const address = portProbe.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>((done) => portProbe.close(() => done()));
const nativeUrl = `http://127.0.0.1:${port}`;
let bridgeOutput = '';
const native = spawn('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'library_storage::tests::native_knowledge_qa_bridge', '--', '--ignored', '--nocapture'], {
  cwd: resolve('.'), detached: process.platform !== 'win32',
  env: { ...process.env, SMARTREADER_KNOWLEDGE_QA_DB: database, SMARTREADER_KNOWLEDGE_QA_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
native.stdout.on('data', (bytes) => { bridgeOutput += bytes.toString(); });
native.stderr.on('data', (bytes) => { bridgeOutput += bytes.toString(); });
const exited = new Promise<number | null>((done) => native.once('exit', done));
const invoke = async <T>(command: string, args?: Record<string, unknown> | Uint8Array): Promise<T> => {
  const response = await fetch(nativeUrl, { method: 'POST', signal: AbortSignal.timeout(10_000), body: JSON.stringify({ command, args: args instanceof Uint8Array ? { frame: Array.from(args) } : args ?? {} }) });
  const payload = await response.json() as { data: T; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.data;
};

let embeddingInputs = 0;
let chatRequests = 0;
let sourceTextUploaded = false;
const collections = new Map<string, Array<{ id: string; vector: number[] }>>();
const api = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const chunk of request) raw += chunk.toString();
    const body = JSON.parse(raw);
    let result: unknown;
    if (request.url?.endsWith('/embeddings')) {
      assert.equal(request.headers.authorization, 'Bearer qa-only-key');
      assert.equal(body.model, 'qa-embedding');
      assert.equal(body.encoding_format, 'float');
      for (const text of body.input) if (text.includes('\n')) embeddingInputs += 1;
      result = { data: body.input.map((text: string, index: number) => ({ index,
        embedding: /hippocampal consolidation|overnight/i.test(text) ? [1, 0] : [0, 1] })) };
    } else if (request.url?.endsWith('/chat/completions')) {
      assert.equal(request.headers.authorization, 'Bearer qa-only-key');
      assert.equal(body.model, 'qa-chat');
      chatRequests += 1;
      result = { choices: [{ message: { content: 'Synthetic knowledge answer [S1]' } }] };
    } else {
      assert.equal(request.headers.authorization, 'Bearer qa-cloud-token');
      assert.match(body.collectionName, /^smartreader_[a-f0-9]{32}$/);
      result = { code: 0, data: {} };
      if (request.url?.endsWith('/collections/create')) collections.set(body.collectionName, []);
      else if (request.url?.endsWith('/entities/insert')) {
        sourceTextUploaded ||= body.data.some((entry: Record<string, unknown>) => Object.keys(entry).some((key) => !['id', 'vector'].includes(key)));
        collections.get(body.collectionName)!.push(...body.data);
      } else if (request.url?.endsWith('/entities/search')) {
        const hits = await invoke<Array<{ id: string; score: number }>>('search_knowledge_vectors', { entries: collections.get(body.collectionName), query: body.data[0], limit: 20 });
        result = { code: 0, data: hits.map((hit) => ({ id: hit.id, distance: hit.score })) };
      } else if (request.url?.endsWith('/collections/drop')) collections.delete(body.collectionName);
      else throw new Error('Unexpected fixture route');
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(result));
  } catch {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end('{"code":500,"message":"QA protocol assertion failed"}');
  }
});
let ai: AiService | undefined;
try {
  await new Promise<void>((done, reject) => {
    const deadline = setTimeout(() => reject(new Error('Native test bridge did not become ready')), 60_000);
    native.stdout.on('data', () => { if (bridgeOutput.includes('KNOWLEDGE_QA_READY')) { clearTimeout(deadline); done(); } });
    native.once('exit', () => { clearTimeout(deadline); reject(new Error('Native test bridge exited before readiness')); });
  });
  await new Promise<void>((done) => api.listen(0, '127.0.0.1', done));
  const apiAddress = api.address();
  assert(apiAddress && typeof apiAddress !== 'string');
  const apiUrl = `http://127.0.0.1:${apiAddress.port}`;
  const transport: AiTransport = async (request, signal) => {
    const response = await fetch(request.url, { method: 'POST', headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request.body), signal });
    return { status: response.status, body: await response.text() };
  };
  const createAi = (library: LibraryService) => new AiService(library,
    (provider, key, messages, options) => requestCompletion(provider, key, messages, { ...options, transport }), {
      embeddings: (provider, key, texts, options) => requestEmbeddings(provider, key, texts, { ...options, transport }),
      storage: createKnowledgeStorage(invoke), vectors: createKnowledgeVectorSearch(invoke, transport),
    });
  GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/build/pdf.worker.js');
  const fixtures = join(directory, 'pdfs');
  execFileSync('python3', ['scripts/qa/create-papers.py', fixtures]);
  let library = new LibraryService(createLibraryStorage(invoke));
  const attention = await library.importPdf(new Uint8Array(await readFile(join(fixtures, 'attention-study.pdf'))), 'attention-study.pdf');
  const education = await library.importPdf(new Uint8Array(await readFile(join(fixtures, 'education-study.pdf'))), 'education-study.pdf');
  ai = createAi(library);
  const profile = { id: 'qa-provider', name: 'Synthetic Aliyun', baseUrl: `${apiUrl}/v1`, model: 'qa-chat', embeddingModel: 'qa-embedding' };
  await ai.saveProvider(profile, 'qa-only-key');
  const question = 'What helps retain learned material overnight?';
  assert.equal(library.search(question).length, 0);
  const answer = await ai.ask(question, [attention.id]);
  assert.equal(answer.retrieval, 'local-vector');
  assert.equal(answer.sources.length, 1);
  assert.equal(answer.sources[0].page, 2);
  assert.equal(answer.sources[0].paperId, attention.id);
  const documentInputs = embeddingInputs;
  await ai.ask(question, [attention.id]);
  assert.equal(embeddingInputs, documentInputs, 'warm index must not re-embed documents');
  ai.dispose();
  await invoke('_qa_reopen');
  library = new LibraryService(createLibraryStorage(invoke));
  await library.initialize();
  ai = createAi(library);
  await ai.saveProvider(profile, 'qa-only-key');
  await ai.ask(question, [attention.id]);
  assert.equal(embeddingInputs, documentInputs, 'reopened SQLite must restore vector caches');
  assert.equal((await invoke<{ migrations: number }>('_qa_counts')).migrations, 8);
  const previousChatCount = chatRequests;
  await assert.rejects(ai.ask(question, [education.id]), /没有可用段落/);
  assert.equal(chatRequests, previousChatCount, 'unrelated selected files must not borrow other documents');
  await ai.saveKnowledgeSettings('milvus', `${apiUrl}/milvus`, 'qa-cloud-token');
  const cloud = await ai.ask(question, [attention.id]);
  assert.equal(cloud.retrieval, 'milvus-vector');
  assert.equal(cloud.sources[0].page, 2);
  assert.equal(collections.size, 0, 'temporary cloud index must be cleaned up');
  assert.equal(sourceTextUploaded, false);
  await ai.saveKnowledgeSettings('local', '');
  const folder = await library.createFolder('Private QA knowledge');
  await library.categorize([attention.id], [folder.id], 'add');
  const vault = await library.encryptFolder(folder.id, 'qa knowledge password');
  assert.equal((await invoke<{ caches: number }>('_qa_counts')).caches, 1, 'encryption must remove the attention cache atomically');
  const privateAnswer = await ai.ask(question, [attention.id]);
  assert.equal(privateAnswer.sources[0].page, 2);
  assert.equal((await invoke<{ caches: number }>('_qa_counts')).caches, 1, 'private vectors must stay in unlock-session memory');
  const storedBytes = await readFile(database);
  assert.equal(storedBytes.includes(Buffer.from('Neural mechanisms of attention and memory')), false);
  assert.equal(storedBytes.includes(Buffer.from('qa-only-key')), false);
  await library.lockVault(vault.id);
  await assert.rejects(ai.ask(question, [attention.id]), /导入或解锁/);
  await assert.rejects(library.unlockVault(vault.id, 'wrong password'));
  await library.unlockVault(vault.id, 'qa knowledge password');
  assert.equal((await ai.ask(question, [attention.id])).sources[0].page, 2);
  console.log('PASS: real PDF + Rust SQLite/sqlite-vec; semantic page-2 retrieval; selected-file isolation; durable public cache; private-cache erasure; cloud protocol fixture and cleanup.');
} finally {
  ai?.dispose();
  if (native.exitCode === null) {
    const timeout = setTimeout(() => { try { process.platform === 'win32' ? native.kill() : process.kill(-native.pid!, 'SIGTERM'); } catch {} }, 5000);
    await invoke('_qa_close').catch(() => undefined);
    await exited;
    clearTimeout(timeout);
  }
  api.closeAllConnections();
  await new Promise<void>((done) => api.close(() => done()));
  await rm(directory, { recursive: true, force: true });
}
