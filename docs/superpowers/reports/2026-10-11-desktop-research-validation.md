# 桌面科研文献库与 AI 验收记录

日期：2026-10-11（Asia/Shanghai）。状态：**自动化与无界面业务验证完成；桌面交互验收 waiting-unlock**。

本记录对应用户要求的桌面本地文献库完善、TypeScript 索引与多厂商 AI、论文信息预览、分类及加密。用户已授权启动服务和桌面 UI 测试，明确暂不实现浏览器持久化或移动端；云端仅预留接口。

## 版本与范围

| 步骤 | 提交 | 已实现范围 |
| --- | --- | --- |
| Step 1 | `98aee76` | SQLite 文献库状态、PDF BLOB、原子提交、revision 校验、TypeScript 存储 Adapter |
| Step 2 | `54cf943` | PDF 提取、逐页索引、分类、加密、受管文献服务 |
| Step 3 | `59a685d` | 多厂商兼容协议、凭据管理、元数据补全、问答、桌面 HTTP 传输 |
| Step 4 | `011695f` | 桌面文献库/预览/分类/AI 设置 UI、Reader 与既有数据集成、并发与锁定回归 |
| Step 5 | 本报告与 QA 脚本所在提交 | 二进制 IPC 写入与按文献隔离访问代次的收尾修正、自动化及无界面业务验证完成；原生应用已构建并曾启动，验证进程现已停止；GUI 保留 waiting-unlock 门禁 |

实施计划：[2026-10-11-research-library-ai.md](../plans/2026-10-11-research-library-ai.md)。以下“自动化覆盖”列说明测试入口和已覆盖行为；桌面实测列须由实际操作结果补充，不据此推定通过。

工作区原有两份未跟踪的 `reader-progress-render-window` Spec/Plan 保持原样，未纳入本次提交；既有 001–006 SQL 迁移未修改。

## 用户要求与证据映射

| 用户要求 | 实现与自动化证据 | 桌面实测 |
| --- | --- | --- |
| 打通现有阅读、书签、批注、收藏与会话恢复 | `ResearchApp.test.tsx`、`libraryPersistence.test.ts`：受管文献保存到同一库记录；旧 `desktop:` 记录保留原身份和批注；旧书签跳页；跨 App/服务实例恢复进度 | 待执行 QA-03、QA-08、QA-09 |
| 双 PDF 真实并排阅读 | `LibraryCompareWorkspace.test.tsx` 8 项覆盖独立页码/缩放、只读批注、错误重试、Blob 生命周期、锁定和迟到读取保护 | 待执行 QA-13 |
| 导入后以 TypeScript 自动建立索引 | `libraryService.test.ts`、`pdfExtraction.test.ts`、`librarySearch.test.ts`：内容去重、逐页提取、索引失败保留文件及重试、中英文检索、命中页码与上下文；无界面实测真实 4 PDF → 3 文献及第 2 页命中 | GUI 待执行 QA-02、QA-03 |
| 完整科研信息预览 | `PaperPreview.test.tsx`：标题、作者、期刊、年份、DOI、摘要、关键词、主题、收录状态、文件大小、实际/估算阅读时间、收藏与批注跳页 | 待执行 QA-04 |
| 标准 PDF 自动识别，非标准论文手动补录且长期保留 | `pdfExtraction.test.ts`：真实 PDF.js 解析 Info/XMP/Custom DOI、Journal、PublicationYear/Date，保守识别 Subject，不推断收录状态或将 CreationDate 当发表年；`PaperMetadataEditor.test.tsx`、`libraryService.test.ts`：仅提交人工变更字段，重索引/AI 不覆盖，跨实例保留 | 待执行 QA-02、QA-05、QA-08 |
| 轻量预览，悬停、固定、关闭且不遮挡列表 | `LibraryWorkspace.test.tsx`、`PaperPreview.test.tsx`：固定对象不随悬停/排序变化，关闭后可重开；局部容器布局支持桌面侧栏与窄窗口 | 待执行 QA-01、QA-04 |
| 记忆个人高频信息项 | `PaperPreview.test.tsx`：显式展开才计数，初次显示/重渲染/收起不计数，按持久化 `fieldUsage` 排序 | 待执行 QA-04、QA-08 |
| AI 五维自动分类 | `aiService.test.ts`、`libraryFolders.test.ts`：研究领域、学科方向、发表年份、期刊类型、论文主题；显式开启导入后补全；无界面真实 HTTP 实测五项归属和人工年份保持 | GUI 待执行 QA-10 |
| 自定义多级分类的创建、重命名、移动、合并、删除 | `libraryFolders.test.ts`、`LibraryWorkspace.test.tsx`：最多 8 层，拒绝循环及冲突，递归合并同名子分类，删除分类保留论文 | 待执行 QA-06 |
| 批量移动/归类/置顶/收藏/删除 | `libraryService.test.ts`、`LibraryWorkspace.test.tsx`：批量事务更新，移动与追加语义区分，删除确认仅库内副本，错误可见且保存禁重复 | 待执行 QA-06 |
| 一篇论文多分类且不重复存文件 | `libraryService.test.ts`、`libraryFolders.test.ts`、`LibraryWorkspace.test.tsx`：SHA-256 文献 ID、多对多关联、重复导入和合并不复制 PDF | 待执行 QA-02、QA-06 |
| 文件夹整体加密 | `libraryCrypto.test.ts`、`libraryService.test.ts`、`libraryPersistence.test.ts`：真实 AES-GCM 密文、随机盐/IV、密码/篡改校验、PDF 与文献状态原子切换、所有分类入口共同锁定、迟到请求不泄漏、标签补偿与锁定协调 | 待执行 QA-07、QA-08、QA-12 |
| 多厂商 API Key + Base URL + model | `openAiClient.test.ts`、`aiTransport.test.ts`、`aiService.test.ts`、`AiSettings.test.tsx`，以及 Rust `ai_http.rs` 本地 HTTP 测试；无界面实测两个兼容端点、配置切换、加密密钥解锁 | GUI 待执行 QA-10；真实厂商未调用 |
| AI 问答可追溯，锁定资料不参与 | `aiService.test.ts`、`AiAssistant.test.tsx`：检索相关页、引用标签校验、自然语言召回、来源跳转、取消和锁定代次屏蔽晚结果 | 待执行 QA-11、QA-12 |
| 桌面本地运行并预留云扩展 | `libraryStorage.test.ts`、Rust `library_storage.rs`：存储接口注入、SQLite CAS/事务与迁移，不存在浏览器持久化实现；`main.tsx` 仅在 Tauri 环境创建科研服务 | 原生构建和进程启动已完成；UI 仍等待解锁 |

## 已有自动化与构建记录

| 检查 | 最近已执行结果 | 说明 |
| --- | --- | --- |
| `bun run test` | 70 个文件、634/634 项通过 | 已核对本轮日志 `/tmp/smartreader-final-verified-tests.log` |
| PDF 元数据聚焦测试 | `pdfExtraction.test.ts` 23/23 通过 | 包括真实最小 PDF 的 Custom Info 解析与 Subject 回归 |
| `bun run typecheck` | 已执行通过 | 主代理提供的本轮最终检查结果 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 60/60 项通过 | 已核对 `/tmp/smartreader-final-verified-rust.log`；包含 SQLite 原子性和兼容 HTTP 本地服务测试 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 已执行通过 | 主代理确认本轮格式检查完成 |
| `git diff --check` | 已执行通过 | 本次文档检查也已执行 |
| `bun run build` | 已执行通过 | 保留 PDF.js `eval` 与较大 chunk 警告，尚未宣称消除这些警告 |
| 独立 QA 标识的 Tauri debug 构建 | 已完成 | `tauri build --debug --no-bundle --config '{"identifier":"com.smartreader.qa20261011","productName":"SmartReader QA"}'` |
| QA macOS `.app` 构建 | 已完成 | `src-tauri/target/debug/bundle/macos/SmartReader QA.app`；独立标识，未安装到 `/Applications` |
| QA 桌面进程 | 曾成功启动，现已停止 | `./src-tauri/target/debug/smartreader`；启动不等于已验证界面和业务操作 |
| 原生 QA 数据库初始化 | 已核对 | 独立数据库可读、已应用 7 个迁移、文献数为 0；没有把无界面夹具数据当作已通过 GUI 导入 |
| 本地兼容 API fixture 服务 | 已完成 8 次无界面验证请求，现已停止 | 回环地址端口 17861；这些请求由 TS smoke 发起，不代表桌面 GUI 已完成请求链路 |
| `bun scripts/qa/verify-workflow.ts` | PASS | 真实 PDF、实际 TS 服务、真实 loopback HTTP；注入内存存储，边界见下节 |

PDF 写入已改为原生二进制 IPC（SRL1 帧），不再把文件字节展开为 JSON 数字数组；新增 UTF-8、长度/容量、空文件、删除与事务回滚覆盖。锁定无关文献不再打断公开论文的信息补全。

本轮自动化日志及实际验证脚本已核对。临时日志保存在验证机器的 `/tmp`，不随仓库分发。若后续 GUI 验收发现问题并修改代码，应对修改后的版本重新执行受影响的检查并更新记录。

## 无界面业务串联实测（已执行，非 GUI）

执行入口为 `scripts/qa/verify-workflow.ts`：使用合成 PDF 文件、安装版 PDF.js、真实 `LibraryService`/`AiService`/兼容客户端与 Web Crypto，并通过真实 HTTP 访问回环地址 fixture，共 8 次请求。

已核对的断言和操作包括：

- 4 份 PDF 归并为 3 篇唯一文献；真实提取 DOI、期刊；`hippocampal consolidation` 命中第 2 页。
- 自动 AI 补全后具有五维分类；人工年份 `2024` 在再次补全后保持，人工标题在重新建立服务实例后保持。
- 创建主/子分类、多个分类归属、批量收藏与置顶；写入笔记、书签和 30 秒阅读记录。
- 问答来源为第 2 页，模拟回答带 `[S1]`；两个 Base URL 路径与两套模型配置都完成连接验证。
- 加密后保存状态不含测试私密标题、批注或假 API Key，PDF 密文不再以 `%PDF-` 开头；锁定后文献不可读且全文无命中。
- 使用同一份内存存储重新创建服务实例，错误密码被拒绝，正确密码恢复标题、30 秒阅读记录、第 2 页及原 PDF 字节；保存的 API Key 需重新解锁才能连接。

**此脚本注入的是内存 `LibraryStorage` 和基于 `fetch` 的测试传输。** 服务实例重建不是操作系统进程重启；它没有通过 Tauri IPC 操作原生 SQLite，也没有操作 GUI。原生 SQLite、二进制帧与 HTTP 由 60 项 Rust 测试独立验证，真实桌面及退出重启仍保留下列门禁。

无界面 PDF.js 执行记录包含标准字体路径警告；文本及元数据断言通过，但这不证明真实桌面中的字体渲染结果。

## 桌面运行环境与当前阻碍

- QA 使用独立标识 `com.smartreader.qa20261011`、名称 `SmartReader QA`，与正式应用的数据目录隔离。
- 已构建并实际启动过 Tauri 桌面进程；本地兼容接口完成了 headless 请求。本轮收尾时两者均已停止，没有保留后台运行进程。
- 独立 debug `.app` 已构建成功且未安装到 `/Applications`；QA SQLite 已应用 7 个迁移且文献数为 0。上述 headless 数据保存在内存夹具中，未写入此原生文献库。
- **当前状态为 `waiting-unlock`（GUI Blocked）**：桌面自动化工具报告 Mac 已锁定，无法自行解锁。已请求用户手动解锁；本轮没有成功执行任何 GUI 操作，全部 GUI 场景保持待完成。
- 保留 `/tmp/smartreader-qa-papers` 合成资料、独立空 QA 数据库和 QA 应用包用于续测；续测时按 README 重新启动 fixture 和 QA 应用。
- 不把窗口无法交互时的进程存活、成功构建、组件测试或 HTTP fixture 启动当作桌面验收通过。

## 桌面实测记录（待补）

| 编号 | 场景与检查点 | 结果与证据 |
| --- | --- | --- |
| QA-01 | 默认 1180×780 和最小 860×560 桌面布局；目录、列表、预览、模态框和滚动均可用 | 未执行：等待 Mac 解锁；待记录实际窗口尺寸与截图/操作结果 |
| QA-02 | 导入 4 份合成 PDF，确认仅 3 篇唯一文献；标准与缺失元数据文件状态准确；目录导入可用 | 无界面已验证真实 PDF 提取及 4→3 去重；原生选择器、目录导入和 GUI 列表尚未执行 |
| QA-03 | 搜索 `hippocampal consolidation` 打开命中页；阅读、前后导航、缩放、书签、批注和收藏 | 无界面已验证第 2 页命中并执行书签/批注/收藏写入；PDF 实际渲染、导航和界面操作尚未执行 |
| QA-04 | 预览全部信息、悬停、固定、排序后仍固定、关闭重开；展开字段后的顺序/频次；阅读计时 | 未执行：待记录界面及字段变化，后台时间不得计入实际阅读 |
| QA-05 | 补录预印本缺失字段；再索引和 AI 补全后人工值保持；原始 PDF 未被改写 | 无界面已验证人工标题/年份与再次 AI 补全；GUI 补录、重索引操作和原始文件对照尚未执行 |
| QA-06 | 建立层级目录、重命名/移动/合并/删除；多分类追加；批量置顶/收藏/移动/删除 | 无界面已执行主/子分类、多归属移动和批量置顶/收藏；完整 GUI 操作仍待执行 |
| QA-07 | 加密目录，验证多个分类入口共同锁定；错误密码失败、正确密码解锁、解除加密 | 无界面已验证密文、锁定拒绝读取/检索、错误密码及正确解锁；原生 GUI 与解除加密操作尚未执行 |
| QA-08 | 退出并重启 QA 应用：库内文献、人工字段、收藏、分类、批注、阅读位置保留；加密目录与保存密钥需重新解锁 | 已验证同一内存存储中新建服务实例恢复记录/文件与解锁密钥；真实桌面退出、进程重启和 SQLite 恢复尚未执行 |
| QA-09 | 既有路径文献及旧书签/批注仍以 `desktop:` 身份打开；新导入文献走受管库；会话切换不会串文档 | 未执行：使用独立 QA 数据中的合成 legacy 记录，待记录结果 |
| QA-10 | 本地 fixture 两个厂商配置/路径切换、连接验证、自动五维分类、401/429 错误展示 | 无界面真实 HTTP 已验证双端点和自动分类；401/429 有自动化覆盖，桌面设置及错误展示尚未执行 |
| QA-11 | 基于本地检索问答，回答来源点击进入对应论文及页码，错误引用不被接受 | 无界面已取得第 2 页来源及 `[S1]` 模拟回答；实际点击跳转和 GUI 展示尚未执行 |
| QA-12 | `qa-slow` 请求期间取消或锁定文献；晚返回不回填回答、搜索结果或旧预览 | 未执行：待记录取消/锁定后等待超过 fixture 延迟的结果 |
| QA-13 | 两份受管 PDF 左右独立渲染、跳页、缩放，已有批注只读展示；锁定时清空对应侧 | 8 项组件测试通过；实际双 PDF 桌面渲染尚未执行 |

## 可复现的本地夹具

生成文件：

```bash
python3 scripts/qa/create-papers.py /tmp/smartreader-qa-papers
```

- `attention-study.pdf`：3 页，有明确期刊、DOI、年份和可检索短语。
- `attention-copy.pdf`：与前者内容完全相同，用于去重。
- `education-study.pdf`：2 页，另一研究主题。
- `preprint-study.pdf`：1 页，缺失作者、期刊、年份、DOI，供手动补录。

这些论文、作者、期刊、DOI 和结论均为合成测试数据，不能用于学术论证。

启动兼容服务：

```bash
bun scripts/qa/mock-ai.mjs
```

服务启动后，在另一个终端执行：

```bash
bun scripts/qa/verify-workflow.ts /tmp/smartreader-qa-papers
```

默认只监听 `127.0.0.1:17861`，使用固定假凭据 `qa-only-key`。可配置 `/v1` + `qa-primary` 与 `/alt/v1` + `qa-secondary`；`qa-rate-limit` 返回 429；`qa-slow` 延迟 5 秒，用于取消与晚结果检查。可用 `SMARTREADER_QA_PORT` 改端口。

该服务用于验证协议、业务回填和桌面链路；本轮已执行无界面流程，桌面链路仍待解锁后验证。它不验证真实模型的回答质量、供应商可用性、模型权限或账户额度。**本轮未读取、申请或使用真实厂商凭据，也未进行真实厂商调用。**

## 数据边界与未覆盖能力

- 加密保护库内 PDF、元数据、全文索引、阅读状态、批注与书签；原始磁盘 PDF 不改变，手工分类名称和外层目录/配置仍可见。
- 加密时保留手工关联与保险库归属，清除加密范围外的自动推断关联并清理无引用自动分类；不会声称整个 SQLite 数据库或所有分类名称都已加密。
- 没有 OCR。扫描 PDF 的空文本状态和可手工补录不等同于完成全文识别。
- 云端目前只有 `LibraryStorage` 扩展边界；未实现云同步、浏览器存储或移动端 UI。
- 真实桌面交互、应用退出后重启，以及桌面 UI → Tauri → fixture 链路仍须在 Mac 解锁后填写；在此之前，不作“所有功能已完成真实桌面验收”的结论。

## 收尾待办

- [ ] 用户解锁 Mac 后完成上述桌面场景，并记录失败、修复与复测。
- [x] 更新本轮 634 项前端/60 项 Rust 测试、类型检查、格式检查、构建和对应实现版本。
- [x] 记录 headless 真实 HTTP 与内存存储边界，Step 5 以本报告/QA 脚本所在提交为准；真实厂商调用保持未执行。
- [x] 已关闭 QA 程序和本地 fixture 服务；保留合成 PDF、QA 应用包和独立空 QA 数据库用于后续桌面验证。
