# AI 对话与 RAG 修复

## 需求与边界

用户配置 API Key 后无法正常对话，且设计的 RAG 不能工作。经代码核查，这不是单点缺陷，而是四类问题：对话入口被文献范围锁死且只有一问一答；Base URL 补全与推理模型响应导致请求失败后缺少可诊断信息；向量检索每次提问都把全部向量通过 IPC 搬进搬出；Milvus 每次提问新建并删除临时集合。按用户确认，四项一并修复：完整多轮对话且无文献也可聊、密钥可在本机记住、向量索引持久化、回答流式输出。

沿用现有受管 PDF、全文索引、厂商凭据、引用跳页和文献加密服务，不新增数据库进程或 Python 组件。

## 实施步骤

1. `ai_http.rs`：新增基于 Tauri Channel 的 `ai_http_stream`，与同步请求共用校验、注册与取消；按 UTF-8 边界缓冲转发原始响应文本，先发 `status` 再发 `chunk`，非 2xx 的错误体同样转发。请求/响应上限提至 8 MiB，端点白名单补齐 Milvus 的 describe/load/query/upsert/delete。
2. `knowledge_vectors.rs`：新增 `search_knowledge_scope` 与 `knowledge_cache_status`。检索直接从 SQLite 读取所选公开文献的向量 BLOB，在 Rust 内按余弦相似度做有界 top-k，合并会话内私有向量；只有问题向量跨 IPC。公开性检查、维度不符跳过（交由 `cache_status` 触发重建）、范围预算 67,108,864 个向量值。
3. `openAiClient.ts`：`parseServiceUrl`/`servicePath` 拆出地址校验，裸主机补 `/v1`；`streamCompletion` 解析 SSE、分离 `reasoning_content`、空流打 `AI_STREAM_EMPTY` 标记；厂商报错挂在 Error 上而不写进 message（服务端可能回显论文摘录），仅连接验证显示。
4. `knowledgeService.ts`/`knowledgeVectors.ts`：索引以持久指纹决定是否重新 embedding；Milvus 改为按维度命名的持久集合 + `paper_id`/`paper_fp`，重启后读回指纹即跳过上传，按 `paper_id` 替换与清理；embedding 批量失败时自动降批。
5. `aiService.ts`/`AiAssistant.tsx`/`AiSettings.tsx`：`ask` 接受历史与 grounding，无文献时退化为纯模型对话，无法核对的引用标签只移除不丢弃整条回答；界面改为对话记录 + 流式渲染 + 新建对话；密钥新增“在本机记住”。

## 关键故障行为

明确指定文件却都不可访问时报错，不退化为无依据回答。取消的一轮不在对话中留残缺回答，迟到的 delta 不写入后一轮。流式被服务以请求错误拒绝或返回非事件流时降级为一次非流式请求；网络、鉴权与限额错误直接上报，不重复计费。锁定或删除文献时同一 SQLite 事务清除公开向量缓存，并尽力删除云端向量；私有向量仅驻留解锁会话。进入 Milvus 过滤表达式的标识先校验为 64 位十六进制。

## 本轮继续完善

继续复用现有 `KnowledgeVectorStore` Adapter、`LibraryService.withStableAccess` 与流式 transport，不增加依赖、服务或数据库迁移。Adapter 已能隔离本地/云端检索变化，无需再引入新策略层。

1. `AiAssistant`：空库和直接对话也能导入 PDF；历史按实际文件集合与对话模式隔离，只发送成功完成的问答轮，保留已显示的记录。
2. `aiTransport`：同时等待命令返回和 Channel `end`，保留迟到的尾部分块；本地超时、取消和异常统一清理，避免无限等待。
3. `aiService`：全文为空的扫描件不阻断其他文献的语义检索；旧索引失败后允许重建，取消仍终止；识别公开文献转加密，触发缓存失效及云端清理，失败明确提示。
4. `knowledgeService` / `knowledgeVectors`：Strong 计数验证完整分块，按文件和指纹隔离查询；列举受管维度集合清理旧向量；复用访问维护屏障协调云发布与加密；检索前后核对内容，拒绝旧页码来源；并发创建集合失败后确认已存在才继续。
5. `ai_http.rs` / QA：补齐实际缺失的 Milvus `entities/query` 与新增 `collections/list` 白名单，联合脚本经 Rust HTTP 访问模拟厂商，覆盖重启后的索引复用和加密云端清理。组件测试、Rust 测试及构建分别验证；浏览器和真实服务验证单独记录。

## 授权启动桌面后的补充

用户授权启动桌面进行实际验证，并选择先验证隔离模拟环境、稍后配置真实服务。使用独立应用标识 `com.smartreader.qa20261017` 与合成 PDF，不向真实厂商发送文献。

实际操作发现两项新缺陷：点击来源返回后对话丢失；宽屏来源栏挤高标题行，正文下方出现大块空白。前者将当前会话快照归属已有 `AiService`，沿用 `answerEpoch` 清理和拒收旧结果，禁止写入数据库；后者将正文组合成同一个网格子项，与来源栏顶端对齐。继续复用既有组件和状态所有权，不增加层次、依赖或持久化结构。

扩展既有 `mock-ai.mjs`，让桌面测试支持普通文本对话、SSE、embedding、Milvus 集合和指纹计数；保留原有工作流兼容。最终重建应用后，复验来源跳转返回、草稿/范围恢复、追问、显式清空、应用重启、索引复用及错误提示。
