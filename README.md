# SmartReader

当前项目不是知识库、云同步工具或 PDF 编辑器。分类、标签、分类级加密、RAG、云同步、写回原始 PDF 文件不属于当前 MVP。

SmartReader 是一款本地优先的桌面端 PDF 阅读器，当前版本聚焦 PDF 阅读核心能力：打开本地 PDF、阅读、搜索、跳转、缩放、书签、SmartReader 管理的批注和笔记、收藏、标签、最近文件、会话恢复、快捷键、缓存和桌面系统集成。

## 当前状态

项目已经具备一个可开发验证的 Tauri + React PDF 阅读器骨架，并围绕阅读器核心能力拆分了前端模块、Rust/Tauri 命令、SQLite 迁移和测试。

已覆盖能力：

- 通过浏览器文件选择器、拖拽、Tauri 原生文件对话框、最近文件和桌面系统 Open With 打开 PDF。
- PDF 加载失败和加载超时会进入可恢复错误状态，不再无限 loading。
- 已打开的桌面路径 PDF 再次打开时聚焦已有标签页。
- 桌面路径 PDF 支持最近文件、阅读进度和会话恢复。
- 浏览器 `File` 打开的 PDF 仅作为运行时会话，不跨重启恢复。
- 支持搜索命令、页码跳转、缩放、适合宽度、适合页面；当前 viewer API 暂不提供真实匹配列表和匹配计数。
- 支持 per-tab 阅读历史，明确跳转才进入后退/前进历史。
- 支持书签新增、列表、跳转、删除和 SQLite 持久化。
- 支持 SmartReader 管理的高亮、下划线和页面笔记，不写回原始 PDF。
- 支持批注列表、跳转、删除、可编辑笔记、标签、JSON 导入和 JSON 导出。
- 支持文档收藏，以及文档、批注和笔记的标签创建、重命名、合并、删除和关联计数。
- 支持设置工作区：快捷键覆盖、快捷键冲突提示、缓存状态、桌面集成状态和会话恢复偏好。
- 支持运行时 PDF byte cache、blob URL cache 和桌面 PDF 磁盘缓存读取。
- AI 助手、对比阅读、文件夹库管理、全文知识库、导出文本/图片、打印、重命名/移动/删除本地文件仍是未来版本入口；当前不会伪装成可用功能。

## 技术栈

- Bun
- Vite
- React 18
- TypeScript
- Vitest
- Tauri v2
- Rust
- rusqlite / SQLite
- `@react-pdf-viewer`
- PDF.js

PDF 阅读基于 `@react-pdf-viewer` 和 PDF.js。SmartReader 通过 `PdfViewerBridge` 调用 viewer 的渲染、搜索、页码、缩放和高亮能力；SmartReader 自己管理桌面文件打开、标签页、最近文件、会话恢复、书签、批注、快捷键、缓存和 SQLite 持久化。

## 项目结构

```text
src/
  annotations/   书签、批注模型和状态处理
  app/           应用外壳、阅读器布局和交互编排
  cache/         PDF byte cache 和 blob URL 生命周期
  commands/      命令注册、默认快捷键和快捷键事件处理
  documents/     打开文档、标签页、阅读进度和阅读历史
  library/       最近文件映射和重新打开状态
  persistence/   前端 typed persistence API 和 debounce 写入
  platform/      文件选择、拖拽、Open With、Tauri bridge 和路径过滤
  preferences/   阅读器偏好和快捷键覆盖配置
  reader/        阅读工作区、工具栏、侧栏、搜索、批注和 reader hooks
  settings/      设置工作区、快捷键、缓存、桌面集成和会话恢复设置
  tags/          标签模型、标签选择器和标签管理工作区
  viewer/        @react-pdf-viewer 隔离层和 viewer controller

src-tauri/
  src/db.rs                     SQLite 初始化、迁移和持久化命令
  src/file_commands.rs          本地 PDF 读取、路径检查和缓存文件辅助命令
  src/lib.rs                    Tauri 插件、命令注册和 Open With 转发
  src/migrations/001_init.sql   初始文档、会话、偏好表
  src/migrations/002_reader_core_completion.sql
                                书签、批注、缓存和 Open With 事件表
  src/migrations/003_workbench_stabilization.sql
                                收藏、标签和文档/批注标签关系
```

## 数据和文件边界

- 桌面路径 PDF 是可恢复来源，会保存最近文件、阅读进度、会话、书签和批注。
- 浏览器 `File` 只属于当前运行时会话，重启后需要用户重新打开。
- 收藏浏览器 `File` 时会保存一条不可自动重开的收藏记录；普通浏览器打开不会进入最近文件。
- 批注由 SmartReader 管理并存入 SQLite，不修改原始 PDF。
- 标签由 SmartReader 管理，可关联文档、批注和笔记。
- SQLite 访问集中在 Rust/Tauri 命令后面，React 组件不直接写 SQL。
- PDF 渲染、搜索、缩放和页面导航能力由 `@react-pdf-viewer` 承担，应用状态由 SmartReader 自己维护。

## 开发环境

需要本机具备：

- Bun
- Rust toolchain
- Tauri v2 所需系统依赖

安装依赖：

```bash
bun install
```

`postinstall` 会把 `pdfjs-dist` 的 worker 复制到 `public/pdf.worker.min.js`，供 PDF.js 在运行时加载。

## 常用命令

```bash
# 前端开发服务器
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

## 验证清单

文档或代码变更后优先运行与变更范围匹配的最小命令：

- 仅文档变更：`git diff --check`
- 前端类型或行为变更：`bun run typecheck`、`bun run test`
- 前端构建链路变更：`bun run build`
- Tauri/Rust/SQLite 变更：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`

## 设计文档

- `docs/superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md`
- `docs/superpowers/plans/2026-06-15-smartreader-pdf-reader.md`
- `docs/superpowers/plans/2026-06-16-smartreader-pdf-core-completion.md`
