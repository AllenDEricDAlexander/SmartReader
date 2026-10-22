import http from 'node:http';
import assert from 'node:assert/strict';

const port = Number(process.env.SMARTREADER_QA_PORT || 17861);
let requests = 0;
let embeddingInputs = 0;
let cloudUploads = 0;
// Keep the server running while restarting the desktop app to verify index reuse.
// This is synthetic process memory, not a real Milvus deployment.
const collections = new Map();
const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};
const server = http.createServer(async (request, response) => {
  const chat = ['/v1/chat/completions', '/alt/v1/chat/completions'].includes(request.url);
  const embeddings = ['/v1/embeddings', '/alt/v1/embeddings'].includes(request.url);
  const milvus = /^\/milvus\/v2\/vectordb\/(collections\/(?:list|describe|create|load)|entities\/(?:insert|delete|query|search))$/.exec(request.url ?? '')?.[1];
  if (request.method !== 'POST' || (!chat && !embeddings && !milvus)) {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${milvus ? 'qa-cloud-token' : 'qa-only-key'}`) {
    json(response, 401, { error: { message: 'Use the documented synthetic QA key.' } });
    return;
  }
  const chunks = [];
  let byteLength = 0;
  try {
    for await (const chunk of request) {
      byteLength += chunk.byteLength;
      if (byteLength > 1024 * 1024) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
  } catch {
    return;
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let body;
  try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  const sequence = ++requests;
  if (embeddings || milvus) {
    try {
      let result = { code: 0, data: {} };
      if (embeddings) {
        assert.equal(body.model, 'qa-embedding');
        assert.equal(body.encoding_format, 'float');
        assert(Array.isArray(body.input) && body.input.length > 0);
        assert(body.input.every((text) => typeof text === 'string' && text.trim()));
        embeddingInputs += body.input.length;
        result = { data: body.input.map((text, index) => ({ index,
          embedding: /hippocampal consolidation|overnight/i.test(text) ? [1, 0] : [0, 1] })) };
      } else if (milvus === 'collections/list') {
        result = { code: 0, data: [...collections.keys()] };
      } else {
        assert.match(body.collectionName, /^smartreader_knowledge_[1-9]\d{0,3}$/);
        const rows = collections.get(body.collectionName);
        if (milvus === 'collections/create') {
          if (rows) result = { code: 100, message: 'collection already exists' };
          else collections.set(body.collectionName, []);
        } else if (!rows) {
          result = { code: 100, message: 'collection not found' };
        } else if (milvus === 'entities/insert') {
          assert(Array.isArray(body.data));
          for (const entry of body.data) {
            assert.deepEqual(Object.keys(entry).sort(), ['id', 'paper_fp', 'paper_id', 'vector']);
            assert.match(entry.paper_id, /^[0-9a-f]{64}$/);
            assert.match(entry.paper_fp, /^[0-9a-f]{64}$/);
            assert(entry.id.startsWith(`${entry.paper_id}:`));
            assert(Array.isArray(entry.vector) && entry.vector.length === Number(body.collectionName.split('_').at(-1)));
            assert(entry.vector.every(Number.isFinite) && Math.hypot(...entry.vector) > 0);
          }
          rows.push(...body.data);
          cloudUploads += body.data.length;
        } else if (milvus === 'entities/delete') {
          const [, scope] = /^paper_id (?:==|in) (.+)$/.exec(body.filter ?? '') ?? [];
          assert(scope, 'cloud deletes must be scoped to papers');
          const ids = [...scope.matchAll(/"([0-9a-f]{64})"/g)].map((match) => match[1]);
          assert(ids.length > 0);
          collections.set(body.collectionName, rows.filter((row) => !ids.includes(row.paper_id)));
        } else if (milvus === 'entities/query') {
          assert.equal(body.consistencyLevel, 'Strong');
          assert.deepEqual(body.outputFields, ['count(*)']);
          const [, paper, fingerprint] = /^paper_id == "([0-9a-f]{64})" and paper_fp == "([0-9a-f]{64})"$/.exec(body.filter ?? '') ?? [];
          assert(paper && fingerprint);
          result = { code: 0, data: [{ 'count(*)': rows.filter((row) => row.paper_id === paper && row.paper_fp === fingerprint).length }] };
        } else if (milvus === 'entities/search') {
          assert.equal(body.consistencyLevel, 'Strong');
          assert.deepEqual(body.outputFields, ['id', 'paper_fp']);
          const scopes = [...String(body.filter).matchAll(/\(paper_id == "([0-9a-f]{64})" and paper_fp == "([0-9a-f]{64})"\)/g)];
          assert(scopes.length > 0);
          const query = body.data[0];
          const scoped = rows.filter((row) => scopes.some(([, paper, fingerprint]) => row.paper_id === paper && row.paper_fp === fingerprint));
          result = { code: 0, data: scoped.map((row) => ({ id: row.id, paper_fp: row.paper_fp,
            distance: row.vector.reduce((dot, value, index) => dot + value * query[index], 0) / (Math.hypot(...row.vector) * Math.hypot(...query)),
          })).sort((a, b) => b.distance - a.distance).slice(0, body.limit) };
        }
      }
      console.log(JSON.stringify({ request: sequence, kind: embeddings ? 'embeddings' : milvus, model: body.model,
        embeddingInputs, cloudUploads, collections: collections.size,
        cloudRows: [...collections.values()].reduce((count, rows) => count + rows.length, 0) }));
      json(response, 200, result);
    } catch {
      console.log(JSON.stringify({ request: sequence, kind: 'protocol-error' }));
      json(response, 400, { code: 400, error: { message: 'QA protocol assertion failed.' } });
    }
    return;
  }
  if (!Array.isArray(body.messages) || body.messages.some((message) => typeof message?.content !== 'string')) {
    json(response, 400, { error: { message: 'Expected text chat messages.' } });
    return;
  }
  const user = body.messages?.filter((message) => message.role === 'user').at(-1)?.content ?? '';
  let content = 'OK';
  let kind = 'connection';
  if (body.model === 'qa-rate-limit') {
    response.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Simulated quota limit.' } }));
    console.log(JSON.stringify({ request: sequence, kind: 'rate-limit', model: body.model }));
    return;
  }
  if (body.messages?.[0]?.content.includes('文献编目助手')) {
    kind = 'metadata';
    let data;
    try { data = JSON.parse(user); } catch { response.writeHead(400).end(); return; }
    const education = data.fileName.includes('education');
    const preprint = data.fileName.includes('preprint');
    content = JSON.stringify({
      title: data.existingMetadata.title,
      authors: preprint ? [] : ['Ada Tester', 'Lin Example'],
      journal: preprint ? '' : education ? 'Journal of QA Education' : 'Journal of QA Neuroscience',
      year: preprint ? '' : '2025', doi: data.existingMetadata.doi,
      abstract: data.existingMetadata.abstract, keywords: data.existingMetadata.keywords,
      researchFields: [education ? '教育学' : '认知神经'],
      disciplines: [education ? '教育研究' : '神经科学'],
      journalType: preprint ? '预印本' : '期刊论文', researchTopics: [education ? '学习反馈' : '注意力与记忆'],
    });
  } else if (user !== 'Reply with exactly OK.') {
    let data;
    try { data = JSON.parse(user); } catch { /* Direct chat is ordinary text. */ }
    const source = data?.sources?.[0];
    kind = source ? 'answer' : 'direct';
    content = source ? `这是本地 QA 接口的模拟回答。所选文献为《${source.title}》，以下片段用于验证来源跳转：[${source.label}]\n\n${source.excerpt.slice(0, 600)}`
      : `这是本地 QA 接口的模拟对话。当前请求包含 ${body.messages.filter((message) => message.role === 'user').length} 条用户消息。`;
  }
  if (body.model === 'qa-long' && kind !== 'connection' && kind !== 'metadata') {
    content = Array.from({ length: 24 }, (_, index) =>
      `第 ${index + 1} 段：这是用于桌面滚动联调的合成回答。生成过程中向上阅读已有内容，页面应保留阅读位置；点击“回到最新回答”后继续跟随输出。页头的取消回答按钮应始终可用。`,
    ).join('\n\n');
  }
  console.log(JSON.stringify({ request: sequence, kind, model: body.model, stream: body.stream === true }));
  if (body.stream === true) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.flushHeaders();
    // Delay each delta so desktop QA can observe incremental output and cancel.
    const pieces = content.match(/[\s\S]{1,16}/gu) ?? [];
    let emitted = 0;
    const sendChunk = () => {
      if (response.destroyed) return;
      if (emitted === pieces.length) {
        response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      const frame = `data: ${JSON.stringify({ id: `qa-${sequence}`, object: 'chat.completion.chunk', model: body.model,
        choices: [{ index: 0, delta: { content: pieces[emitted++] }, finish_reason: null }] })}\n\n`;
      // Split the frame itself as well as the answer; the native path must buffer SSE.
      response.write(frame.slice(0, 9));
      timer = setTimeout(() => {
        if (response.destroyed) return;
        response.write(frame.slice(9));
        timer = setTimeout(sendChunk, 100);
      }, 20);
    };
    let timer = setTimeout(sendChunk, body.model === 'qa-slow' ? 5000 : 20);
    response.on('close', () => {
      clearTimeout(timer);
      console.log(JSON.stringify({ request: sequence, kind: response.writableFinished ? 'stream-complete' : 'stream-cancelled', chunks: emitted }));
    });
    return;
  }
  const send = () => {
    if (response.destroyed) return;
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ id: `qa-${sequence}`, object: 'chat.completion', model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  };
  if (body.model === 'qa-slow') {
    const timer = setTimeout(send, 5000);
    response.on('close', () => { clearTimeout(timer); });
  } else send();
});
server.listen(port, '127.0.0.1', () => console.log(`Synthetic OpenAI-compatible QA server: http://127.0.0.1:${port}/v1`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
