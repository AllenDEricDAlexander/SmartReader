# SmartReader

SmartReader 是一款本地优先的桌面科研文献阅读器，基于 Tauri、React、TypeScript 和 SQLite。它将 PDF 阅读、文献索引、论文信息维护、分类、批注与可配置的 AI 助手连接在同一份本地文献库中。

## 当前能力

### 文献导入与阅读

- 支持桌面原生文件选择、多选导入、目录导入、拖拽和系统 Open With。目录导入递归查找 PDF，不跟随符号链接；单份导入 PDF 上限为 128 MiB。
- 新导入文献保存为库内受管 PDF，按内容 SHA-256 去重；相同内容换文件名导入也只保留一份副本。
- 导入后通过 TypeScript 和 PDF.js 提取逐页文本并建立本地倒排索引。跨文献检索支持拉丁文字、中文、元数据、页码及上下文，结果可直接打开命中页。
- 保留单篇 PDF 内的全文搜索、真实匹配数量、页码跳转、缩放、适合宽度和页面、阅读历史前进/后退、最近文件及会话恢复。
- 支持真实的双 PDF 左右并排对比，两侧独立选择文献、定位和缩放，已有批注以只读方式展示；锁定文献会清除对应窗格。
- PDF 加载失败、超时、需要密码或索引失败均有明确状态；索引失败保留已导入文件，可输入原 PDF 密码后重试。没有文本层的扫描件不会被标记为已完成全文识别。
- 书签、选区高亮、下划线、锚定原文的笔记和页面笔记由 SmartReader 管理。支持跳转、编辑、删除、标签关联及批注 JSON 导入/导出，不写回原始 PDF。
- 保留收藏、标签管理、快捷键覆盖与冲突提示、缓存状态、桌面集成及会话恢复偏好。

### 论文信息与预览

- 预览展示标题、作者、期刊、发表年份、DOI、摘要、关键词、研究主题、收录状态，以及研究领域、学科方向、期刊类型、文件大小、收藏和全部个人批注。
- 支持读取 PDF Info、XMP 和 PDF.js `info.Custom` 中明确的学术字段，包括 DOI、Journal、PublicationYear、PublicationDate。发表年份不会由文件创建时间猜测，未知收录状态不会由 AI 编造。
- 信息不全的学位论文、预印本等可手工补充。只将实际修改过的字段设为人工维护，重新索引和 AI 补全均保留这些值。
- 预览位于列表旁的独立区域，鼠标悬停可切换，支持固定、关闭及重新打开。较窄的桌面窗口使用分类选择器和上下布局，避免覆盖文献列表。
- 显式展开信息项会记录关注频率，用于优先排列个人常看的字段。实际前台阅读时间与按文本长度估算的阅读时长分别展示。

### 分类与批量管理

- 按研究领域、学科方向、发表年份、期刊类型、论文主题五个维度，使用提取或 AI 补全得到的信息自动归类。
- 支持创建、重命名、移动、合并和删除分类，以及最多 8 层的子分类。人工整理的分类和关联会被保留。
- 支持论文批量移动分类、追加归类、移出分类、置顶、收藏及删除。同一论文可归入多个分类，无需复制 PDF。
- 删除或合并分类保留论文。删除文献时会明确确认：删除库内副本、索引、批注与书签，不删除磁盘上的原始 PDF。
- 分类文件夹支持密码加密、锁定、解锁和解除加密，具体保护范围见下方“数据和加密边界”。

### 多厂商 AI

在“设置 → AI 厂商”中添加厂商名称、Base URL、模型名称和自己的 API Key，再选择当前厂商。客户端使用 OpenAI-compatible `POST /chat/completions` 协议，保留自定义路径前缀；通常填写厂商提供的含 `/v1` 的 Base URL，也接受完整的 `/chat/completions` 地址，不会重复追加路径。

- 支持保存和切换多套厂商配置，以及 HTTP/HTTPS 地址；模型名称由用户填写，不固定到某一家厂商或模型。
- API Key 默认仅在当前会话使用。需要跨重启保存时，使用至少 8 个字符的密码加密保存，重启后需解锁；改变 Base URL 会清除旧凭据，避免将其带到新的地址。
- 文件导入、本地索引和阅读无需 AI。用户可手动补全文献信息，也可显式启用“导入后自动 AI 补全与分类”。
- 文献问答基于可访问文献的本地检索结果，提供来源标签和页码跳转。相关摘录、文献信息和问题会发送至所选厂商；锁定的文献不参与检索。
- AI 失败不会删除本地文件或索引。支持重试、取消、超时和明确的鉴权/权限/限额错误；不会自动重试可能计费的请求，也不会将服务端原始错误或密钥写入错误提示。

真实厂商的模型效果、账号权限和额度需要用户配置有效凭据后验证。仓库提供本地兼容接口用于功能复测，不附带真实厂商凭据。

## 数据和加密边界

- SQLite 位于 Tauri 应用数据目录下的 `smartreader.sqlite3`。库内文献状态和 PDF BLOB 通过原生二进制 IPC 传输，并由 Rust 命令在同一事务内提交，并检查 revision，冲突时不静默覆盖新数据。
- 既有 `desktop:` 路径记录保持原身份；从最近文件、书签等入口重开时继续使用原书签、批注与阅读位置，不强制迁移成新的受管文献。
- 受管文献的批注、收藏、阅读状态等写入同一文献记录。加密后不会另在旧文档表中保存一份库内批注明文。
- 文件夹加密使用 Web Crypto 的 PBKDF2-SHA-256 和 AES-256-GCM，保护库内 PDF、论文元数据、全文索引、阅读状态、批注和书签；不是对整个 SQLite 数据库进行加密。
- 手工分类名称、目录结构、厂商地址/模型等外层配置仍可见，磁盘原始 PDF 不会被修改或加密。加密时保留手工分类与保险库归属，移除加密范围外的自动推断分类关联，并清理无引用的自动分类。
- 同一论文从所有分类入口共用加密状态。锁定会关闭相关标签页、撤销 Blob URL、清除相应字节缓存和界面内容，并丢弃迟到的读取、索引或 AI 结果。解锁密钥仅在当前会话保留。
- 一篇文献不能同时加入两个独立加密文件夹。加密目录的移动、合并或删除，以及将文献移出原加密范围，需要先解除相应加密；不会静默把文件降为明文。
- `LibraryStorage` 仅预留可替换的存储接口、稳定文献 ID 和 revision 边界。当前未实现云同步、浏览器持久化或移动端界面。
- 当前不包含 OCR、PDF 内容编辑/写回、文本或图片导出和打印。批注 JSON 导出不等同于修改或导出 PDF 内容。

## 技术栈与结构

- Bun、Vite、React 18、TypeScript、Vitest。
- Tauri v2、Rust、rusqlite/SQLite；桌面 AI HTTP 传输使用 reqwest/Tokio。
- `@react-pdf-viewer` 与 PDF.js 负责 PDF 阅读渲染；TypeScript 负责文献模型、索引、分类、加密和 AI 业务。

```text
src/
  ai/            兼容客户端、桌面 HTTP Adapter、厂商凭据、信息补全与问答
  annotations/   书签、批注模型和状态处理
  app/           桌面入口、工作区、Reader 与文献库的集成
  cache/         PDF 字节与 Blob URL 生命周期
  commands/      快捷键和命令注册
  documents/     标签页、阅读进度和导航历史
  library/       受管 PDF、元数据、全文索引、分类、加密、存储与文献库 UI
  persistence/   既有 typed persistence API 与 debounce 写入
  platform/      原生选择器、目录导入、拖拽、Open With 和 Tauri bridge
  preferences/   阅读器偏好和快捷键配置
  reader/        阅读工作区、搜索、批注、会话恢复和实际阅读计时
  settings/      阅读设置与 AI 厂商设置
  tags/          文档及批注标签管理
  viewer/        @react-pdf-viewer 隔离层与渲染代次保护
  workspaces/    双 PDF 并排对比及其他专用工作区

src-tauri/src/
  db.rs              SQLite 初始化、既有数据与迁移
  library_storage.rs 文献库状态、PDF BLOB、原子提交和 revision 校验
  ai_http.rs         桌面兼容 HTTP 请求、取消、限额和安全错误
  file_commands.rs   PDF 读取、目录扫描和文件检查
  lib.rs             命令注册与桌面集成
  migrations/        不可变的 001–006 迁移及新增 007_research_library.sql
```

## 开发环境

需要 Bun、Rust toolchain 和 Tauri v2 所需系统依赖。

```bash
bun install
```

`postinstall` 会把 `pdfjs-dist` 的 worker 复制到 `public/pdf.worker.min.js`。

```bash
# 前端开发服务器（仅开发壳，不提供浏览器端本地文献库）
bun run dev

# Tauri 桌面开发模式
bun run tauri

# TypeScript 类型检查
bun run typecheck

# 前端测试
bun run test

# 前端构建
bun run build

# Rust 格式检查
cargo fmt --manifest-path src-tauri/Cargo.toml --check

# Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml
```

桌面原生存储和 AI HTTP 调用应通过 `bun run tauri` 验证。仅打开 Vite 页面不等同于完成桌面功能验证。

## macOS 本机打包安装

确认已经执行过 `bun install`，然后运行：

```bash
./scripts/build-install-macos.sh
```

脚本会构建 macOS `.app`，应用仅供本机使用的临时签名，安装或更新 `/Applications/SmartReader.app`，再校验应用标识、可执行文件和签名，但不会自动启动应用。可通过 `--install-dir <绝对路径>` 安装到其他目录。

## 本地桌面复测

以下复测使用项目已有的 Bun，并需 Python 3 生成合成论文；不需要真实厂商 API Key。

```bash
# 生成 4 份合成 PDF，其中 3 份内容唯一
python3 scripts/qa/create-papers.py /tmp/smartreader-qa-papers

# 在单独终端启动兼容 API 测试服务
bun scripts/qa/mock-ai.mjs

# 服务运行后，在另一终端验证无界面业务串联
bun scripts/qa/verify-workflow.ts /tmp/smartreader-qa-papers

# 构建独立 QA 标识的 macOS 应用包，隔离正式应用的数据目录
bunx tauri build --debug --bundles app --config '{"identifier":"com.smartreader.qa20261011","productName":"SmartReader QA"}'

# 用户明确启动 QA 应用
open "src-tauri/target/debug/bundle/macos/SmartReader QA.app"
```

`verify-workflow.ts` 使用真实 PDF.js、文献/AI 服务、加密及本机 HTTP，但存储是内存中的 `LibraryStorage`。它核对导入去重、分类、人工值、检索引用、加密和重建服务实例后的恢复；原生 SQLite/HTTP 另有 Rust 测试。这些结果不能替代真实桌面 UI 操作和应用退出后的重启验收。

在 QA 程序的 AI 设置中使用以下测试配置；`qa-only-key` 是脚本内固定的假凭据，仅供本机复测。

| 配置 | Base URL | 模型 | API Key |
| --- | --- | --- | --- |
| 主配置 | `http://127.0.0.1:17861/v1` | `qa-primary` | `qa-only-key` |
| 另一兼容路径 | `http://127.0.0.1:17861/alt/v1` | `qa-secondary` | `qa-only-key` |
| 限额错误 | `http://127.0.0.1:17861/v1` | `qa-rate-limit` | `qa-only-key` |
| 延迟与取消 | `http://127.0.0.1:17861/v1` | `qa-slow` | `qa-only-key` |

可通过 `SMARTREADER_QA_PORT` 改变服务端口。`qa-slow` 延迟 5 秒返回，适合测试取消；它不代表真实厂商超时。合成 PDF 的内容和 AI 回答均不是真实研究证据。结束后关闭 QA 窗口，并在服务终端按 Ctrl+C。

建议依次检查：导入四份文件仅出现三篇论文、命中页打开、补录预印本元数据、重启保留人工值、分类与批量操作、加密锁定各入口、错误密码、解锁、厂商切换、AI 自动分类和引用跳页。桌面环境必须已解锁，具体结果和未完成项记录在验收报告中。

## 验证与设计文档

文档变更运行 `git diff --check`；前端变更运行 `bun run typecheck` 和相关测试；构建链路或原生变更补充 build、Rust 格式检查和测试。构建成功、组件测试成功与真实桌面验收分别记录，不互相替代。

- [桌面文献库与 AI 实施计划](docs/superpowers/plans/2026-10-11-research-library-ai.md)
- [桌面科研功能验收记录](docs/superpowers/reports/2026-10-11-desktop-research-validation.md)
- [原始 PDF 阅读器设计](docs/superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md)
- [原始实施计划](docs/superpowers/plans/2026-06-15-smartreader-pdf-reader.md)
- [PDF 核心补全计划](docs/superpowers/plans/2026-06-16-smartreader-pdf-core-completion.md)
