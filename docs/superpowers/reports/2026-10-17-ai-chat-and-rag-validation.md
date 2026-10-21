# AI 对话与 RAG 修复复测

## 本轮定位和修复

- 空知识库默认直接聊天，父 fieldset 又禁用导入按钮，导致无法添加第一份 PDF；现已保留导入可用，只禁用直接模式下的检索控件。
- Tauri 大消息走异步 Channel 拉取，命令 Promise 可能早于尾部分块返回；现同时等待命令成功和 `end`，并覆盖超时、取消及回调错误。
- 原生 HTTP 白名单缺少 Milvus `entities/query`，云端索引检查在真实桌面路径会被拒绝；补齐查询及清理使用的 `collections/list`，并逐项验证白名单。
- 云端半途上传失败后，单行指纹会将残缺索引判为完成；改用 Strong 计数验证完整分块，查询限定文献和内容/模型指纹，并处理并发创建集合。
- 清理不再依赖当前会话记住的单个向量维度；加密、锁定和删除时按文献从全部受管维度集合删除，切回本地仍能使用会话令牌清理旧向量。清理失败明确提示，不阻断本地工作。
- 云端发布复用既有访问维护屏障；检索前后检查内容没有变化，防止新向量对应旧页码来源。
- 全文为空的扫描件不阻断其他文献；旧索引自然失败后可以重建，取消期间不会偷偷重启。多轮历史按实际文件范围和模式隔离，失败轮不进入后续请求。

沿用现有 VectorStore Adapter、LibraryService 和 transport，没有新增依赖或迁移；保留工作区已有未提交改动。

## 执行结果

| 复测 | 结果 | 说明 |
| --- | --- | --- |
| `bun run typecheck` | 通过 | 最终源码与测试签名通过；QA 脚本不在 tsconfig 覆盖范围，另由实际执行验证 |
| `bun run test src/ai src/settings/AiSettings.test.tsx src/app/ResearchApp.test.tsx` | 9 文件 / 168 项通过 | 最终 AI/RAG 定向回归，使用默认时区 |
| `bun run test` | 既有书签日期用例失败 | 当轮 725/726 通过；之后又补了 5 个针对性回归。失败位于未修改的 `bookmarkManagementUtils.test.ts:137`，夹具固定 `+08:00` 日期，与本地日界线有关 |
| `TZ=Asia/Shanghai bun run test` | 73 文件 / 731 项通过 | 最终完整测试集，明确记录时区条件；未修改书签源码或测试 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 74 通过 / 1 ignored | 首次沙箱禁止回环端口导致 HTTP 用例失败，获准执行后全部通过。ignored 是由联合脚本单独启动的桥接用例 |
| `bun scripts/qa/verify-knowledge.ts` | 通过 | 真实 PDF.js、LibraryService、AiService、临时磁盘 SQLite、原生向量检索及 Rust HTTP。厂商响应为本机夹具 |
| `bun run build` | 通过 | 仍有既有 pdfjs `eval` 和 chunk 体积警告 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 通过 | 仅相关原生文件格式修正 |
| `git diff --check` | 通过 | 最终文档更新后复查 |

联合脚本覆盖：非关键词语义命中第 2 页、指定文件隔离、关闭连接后的持久化恢复、公开缓存复用、私有向量不落盘、锁定/解锁、重建 AI 服务后的完整云索引复用、切回本地模式后加密文献的云向量删除，以及无文献直接对话。所有聊天、embedding、Milvus 请求现在经原生 HTTP 白名单，不再用直接 fetch 绕过。PDF.js 在无界面环境有标准字体加载警告，文本解析及断言通过。脚本退出并清理自己的端口、进程与临时数据。

## 授权后的实际桌面验证

用户随后允许启动桌面，并明确选择“先完成隔离桌面验证，真实服务稍后配置”。本轮启动了工作区构建的 SmartReader，确认现有阿里云配置没有已保存密钥、embedding 尚未保存；未修改正式配置。实际功能测试使用另一个应用标识 `com.smartreader.qa20261017`、独立数据目录、`create-papers.py` 合成 PDF 和仅监听 `127.0.0.1:17861` 的假厂商。界面交互经原生桌面窗口、真实 Tauri IPC、SQLite、Rust HTTP 和 PDF.js 完成。

| 桌面操作 | 实际结果 |
| --- | --- |
| 保存假厂商并验证聊天/embedding 连接 | 显示“连接验证成功”和“向量模型验证成功，维度 2” |
| 空库直接聊天及继续追问 | 成功；第二轮模拟响应确认包含 2 条用户消息 |
| 空库点击“添加本地 PDF” | 原生文件对话框导入成功，自动显示“向量已建立” |
| 本地 RAG 询问 `What helps retain learned material overnight?` | 命中 attention-study 第 2 页，包含 hippocampal consolidation；显示“本地向量检索” |
| 流式可见性 | 观察到答案局部内容先出现，完成后显示完整正文与来源 |
| 点击 S1 来源 | PDF 阅读器显示第 2 / 3 页 |
| 仅选 education-study 询问同题 | 提示无可用段落，不借用另一文献来源 |
| 切换 Milvus 并询问同题 | 显示“Milvus 向量检索”，仍命中第 2 页 |
| 重复提问与取消 | 云端累计上传维持 3 条；取消后移除未完成轮次，界面恢复可操作，迟到内容未出现 |
| 模拟 HTTP 429 | 显示明确限额提示，没有再发一次非流式请求 |
| 退出并重启 QA 应用 | 两份文献与公开向量缓存恢复；已记住的假密钥无需重填即可普通聊天；Milvus 令牌按会话规则要求重新输入 |
| 重启后复用云索引 | 服务计量 cloudUploads 仍为 3，只新增问题 embedding、完整性 query 与 search，没有重新 embedding 文献或上传 |
| 修复后的来源跳转返回 | 原回答、单文献选择及未发送草稿恢复，可以发送草稿并完成第二轮追问 |
| 显式“新建对话” | 清空对话，恢复“从一个问题开始” |
| 修复后的宽屏回答布局 | 实际截图确认正文与来源栏顶端对齐，大块空白消失 |

本轮发现并修复：`AiAssistant` 卸载导致会话丢失；CSS 隐式网格导致来源卡片挤高正文；本地检索标签仍写已移除的 sqlite-vec。会话快照仅归属 `AiService` 内存，沿用锁定/删除、忘记密钥、换厂商和销毁清理；QA SQLite 只读检查确认测试问题和未发送草稿均未写入数据库，公开向量缓存为 2 份。扩展的模拟服务支持 direct/history/SSE/embedding/Milvus，日志只记请求类型与计量。

补充验证：AI 相关 9 文件 / **176 项通过**；`TZ=Asia/Shanghai bun run test` 全量 73 文件 / **739 项通过**；typecheck、正式/隔离 macOS debug app 构建、模拟服务语法与临时集成测试、`verify-workflow.ts` 和 diff 检查通过。此前 Rust 74 项通过，本轮未修改 Rust。构建仍有既有 pdfjs `eval`、bundle identifier 命名警告。原有无界面工作流仍有标准字体警告，但所有断言通过。

收尾已关闭本轮启动的 SmartReader、隔离 QA 应用及回环模拟服务。正式和隔离应用包保留在工作区 `src-tauri/target/debug/bundle/macos/`，没有安装到 `/Applications`。隔离 QA 数据和合成 PDF 保留用于复现，不包含真实密钥或用户文献。

## 当前未覆盖与边界

- 已完成上述真实桌面交互，但按用户本轮选择没有访问真实 API Key、阿里云账号或真实 Milvus；不能据此判定实际厂商权限、额度和检索质量。
- 初次未获启动授权时，浏览器安全策略拒绝了 `file://` 组件页；后续使用已授权的原生桌面应用完成验证，没有绕过浏览器限制。
- 纯 Vite 页面本身不挂载桌面 AI 服务（`src/main.tsx`），不能代替原生 IPC 验收。
- 远端向量删除仍需对应服务与令牌可用；无令牌、离线、退出应用或更换服务后，旧远端可能仍有向量，需按界面提示在 Milvus 核对清理。本地缓存清理不受此影响。
- 流式显示及“在本机记住”跨应用重启已在隔离桌面验证；真实厂商检索质量待用户配置后验证。文献加密的原生联合断言与会话失效单测通过，本轮没有逐项操作桌面加密表单。
