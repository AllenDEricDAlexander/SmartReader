import http from 'node:http';

const port = Number(process.env.SMARTREADER_QA_PORT || 17861);
let requests = 0;
const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || !['/v1/chat/completions', '/alt/v1/chat/completions'].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== 'Bearer qa-only-key') {
    response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Use the documented synthetic QA key.' } }));
    return;
  }
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.byteLength;
    if (byteLength > 1024 * 1024) { response.writeHead(413).end(); return; }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let body;
  try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  const user = body.messages?.filter((message) => message.role === 'user').at(-1)?.content ?? '';
  let content = 'OK';
  let kind = 'connection';
  if (body.model === 'qa-rate-limit') {
    response.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Simulated quota limit.' } }));
    console.log(JSON.stringify({ request: ++requests, kind: 'rate-limit' }));
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
    kind = 'answer';
    let data;
    try { data = JSON.parse(user); } catch { response.writeHead(400).end(); return; }
    const source = data.sources?.[0];
    content = source ? `这是本地 QA 接口的模拟回答。所选文献为《${source.title}》，以下片段用于验证来源跳转：[${source.label}]\n\n${source.excerpt.slice(0, 240)}` : '没有提供可验证的来源。';
  }
  const sequence = ++requests;
  console.log(JSON.stringify({ request: sequence, kind, model: body.model, route: request.url }));
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
