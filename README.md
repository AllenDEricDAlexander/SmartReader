# SmartReader

SmartReader 是一款桌面端 PDF 阅读器，当前 MVP 聚焦本地 PDF 阅读核心能力。

## 当前 MVP 范围

当前实现聚焦 PDF 阅读器核心能力：本地 PDF 打开、阅读、搜索、跳转、缩放、书签、SmartReader 管理的批注、最近文件、会话恢复、快捷键、缓存和桌面系统集成。

分类、标签、分类级加密、RAG、云同步、写回原始 PDF 文件不属于当前 MVP。

## 技术方案

PDF 阅读基于 `@react-pdf-viewer` 和 PDF.js。SmartReader 通过 React bridge 调用 viewer 的渲染、搜索、页码、缩放和高亮能力；SmartReader 自己管理桌面文件打开、标签页、最近文件、会话恢复、书签、批注、快捷键、缓存和 SQLite 持久化。

主要技术栈：

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

## 已覆盖能力

- 通过浏览器文件选择器、拖拽、Tauri 原生文件对话框打开 PDF。
- 支持桌面系统 Open With 事件和 PDF 文件关联。
- 已打开的桌面路径 PDF 再次打开时聚焦已有标签页。
- 桌面路径 PDF 支持最近文件、阅读进度和会话恢复。
- 浏览器 `File` 打开的 PDF 仅作为运行时会话，不跨重启恢复。
- 支持搜索、页码跳转、缩放、适合宽度、适合页面。
- 支持 per-tab 阅读历史，明确跳转才进入后退/前进历史。
- 支持书签新增、列表、跳转、删除和 SQLite 持久化。
- 支持 SmartReader 管理的高亮批注和页面笔记，不写回原始 PDF。
- 支持批注列表、跳转、删除、JSON 导入和 JSON 导出。
- 支持运行时 PDF byte cache、blob URL cache 和桌面 PDF 磁盘缓存读取。
- 支持快捷键注册和偏好设置面板的快捷键冲突提示。

## 验证命令

```bash
bun run typecheck
bun run test
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```
