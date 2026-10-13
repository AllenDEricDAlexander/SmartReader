# 桌面文献库与 AI 实施计划

日期：2026-10-11（Asia/Shanghai）。基线：`d01b5a9`。来源：用户授权完善现有功能、启动服务和桌面 UI 测试、分步提交；后续明确暂不实现浏览器持久化或移动端，云端只预留扩展。

## 设计与边界

- 保留 Tauri + React + TypeScript + SQLite；复用 PDF.js、阅读器、批注和现有界面风格。
- TypeScript 负责论文模型、PDF 元数据/全文提取、导入队列、分类、加密和 AI 业务。Rust 只提供本地存储和桌面 HTTP 传输。
- `LibraryStorage` 为存储 Adapter：默认 SQLite，可替换云端实现或由未来同步服务包装。稳定文献 ID、更新时间、事务 revision 为后续同步保留边界；本次不宣称实现云同步。
- 内容 SHA-256 去重；库内仅一份 PDF，多对多目录关系。文献库独立于“最近文件”，清空最近不影响归档。
- 新增单一 `007_research_library.sql`，不修改 001–006。状态与文件更新原子提交，revision 冲突禁止覆盖。
- 元数据包括标题、作者、期刊、年份、DOI、摘要、关键词、研究主题、研究领域、学科方向、期刊类型、收录状态。人工编辑优先且持久保存；未知收录状态不得由 AI 编造。
- 自动分类对应研究领域、学科方向、年份、期刊类型、主题五维；本地索引不依赖 API，AI 失败可重试，不丢失导入文献。
- 文件夹加密使用 Web Crypto PBKDF2 + AES-GCM，保护库内 PDF、元数据、索引、阅读状态、批注与书签。密钥仅在解锁会话内；锁定后关闭相关阅读标签页和缓存，任何分类均不可绕过。原始磁盘 PDF 不修改。多个独立保险库的交叉归属禁止静默降级。
- AI 使用单一 OpenAI 兼容客户端，通过 Base URL / API Key / model 支持多个厂商配置。默认 API Key 仅保留当前会话；持久保存需密码加密。自动处理需显式启用，界面说明发送论文摘录。桌面 HTTP Adapter 解决浏览器 CORS；不把业务搬到 Rust。
- 预览卡在列表旁留出空间，支持悬浮切换、固定、关闭；点击展开信息项记录关注频次。实际阅读计时与估算阅读时长分别展示。
- 新文献阅读继续复用现有 Reader，通过 PersistenceApi Adapter 将库内批注/收藏写入同一份文献记录，避免加密之外另存明文。

## 分步实现与提交

| 步骤 | 范围与文件 | 验证 | 提交 |
| --- | --- | --- | --- |
| 1 | `src/library/libraryModels.ts`、`libraryStorage.ts`/tests；Rust `library_storage.rs`、007 迁移、db/lib 注册 | Adapter 测试，Rust CAS/事务/迁移测试，typecheck | feat(library): add transactional desktop library storage |
| 2 | `src/library` 中 PDF 提取、索引、分类、加密、服务与测试 | 重复导入、人工覆盖、全文检索、目录循环/合并/批量、加密篡改/锁定/原子性 | feat(library): index papers and manage encrypted collections |
| 3 | `src/ai` 中客户端、配置/密钥、结构化补全与问答；Rust HTTP transport | 兼容 URL、错误/超时、响应校验、不覆盖人工值、提示词不可信边界 | feat(ai): support configurable OpenAI-compatible providers |
| 4 | 文献库/预览/分类/批量 UI、设置、现有 Reader 和入口适配 | 组件测试、完整 TS 测试、构建、Rust 回归 | feat(desktop): connect research library and AI workflows |
| 5 | 桌面运行验证与必要修复、README 和验收记录 | Tauri UI 导入/阅读/编辑/目录/收藏/批量/锁定/重启；本地兼容 API 测试；记录未跑的真实厂商调用 | test(desktop): verify research workflows and document delivery |
| 6 | 解锁后的原生桌面验收与发现问题的修正：分类清理、恢复缩放、分类操作菜单、离线中文 PDF 资源 | 真实 Tauri UI、SQLite 重启恢复、双端点模拟 API、中文 PDF 索引与渲染、最小窗口；针对发现的问题补回归 | fix(desktop): address native research workflow findings |

## 原生验收后的修正决策

- AI 更新主题后遗留空自动分类：在现有分类事务内复用 `pruneEmptyAutomaticFolders`，保留手工目录、仍有引用的目录及加密根目录。
- 保存的缩放与首次显示不一致：让 PDF bridge 的初始缩放引用与 `restore.zoom` 一致，验证首次放大及切换文档，不另建缩放状态层。
- 分类操作使用项目已有的按钮菜单交互，保留现有动作与对话框，提供键盘导航和焦点恢复；普通表单选择器保持现状。
- 标准中文 CMap PDF 的文本提取已实证失败：随现有 PDF.js 安装资源打包本地 CMap 与标准字体，索引和阅读器共享资源路径，避免联网获取。
- 这些修正继续使用现有服务、组件和存储 Adapter；直接复用既有逻辑即可，不增加设计模式、依赖或数据库迁移。

每步在验证后精确路径暂存并提交；不得纳入原有两份未跟踪 reader-progress 文档。步骤内部允许并行处理互不覆盖的文件。完整审核以用户原始要求为准，发现缺口继续修复，真实厂商调用需配置有效凭据后验证。
