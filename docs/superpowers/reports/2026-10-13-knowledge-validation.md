# AI 知识库验证记录

日期：2026-10-13。范围：问答文件选择、本地 SQLite/sqlite-vec、阿里云兼容 embedding 配置、云端 Milvus Adapter。正式应用数据和凭据未写入；原有两份未跟踪的 Egon 文档未修改或提交。

## 已实现

- 问答页直接添加本地 PDF，筛选文件，多选指定范围或使用全部可检索文献；空选择不会扩大范围。导入重复文件仍可选中已有文献，导入不离开问答工作区。
- 按页建立 1,200 字符、160 字符重叠的分块与语义向量。公开向量使用 SQLite 单独缓存，模型、地址、内容指纹变化后重建；真实 sqlite-vec 在请求内存连接中进行余弦检索。索引有状态、错误、重建和取消入口。
- embedding 与聊天模型分别配置，复用厂商 API Key，支持独立 embedding 地址、响应维度验证及已知阿里云 Qwen3.8-27B 非流式兼容参数。
- 云端 Milvus REST v2 使用本次检索自己的临时集合，向量与分块 ID 入云，检索后清理。令牌仅保留当前会话并绑定服务地址；失败和取消仍尝试清理，未知来源 ID 拒绝接受。
- 加密/删除原子清除公开缓存，加密文献向量仅保留当前解锁会话并禁止进入 Milvus。原生缓存写入再次核对公开状态。取消、锁定和删除后不接受迟到的回答或索引结果。
- 新增唯一迁移 `008_knowledge_vectors.sql`；旧迁移未修改。新增唯一 Rust 依赖 `sqlite-vec 0.1.9`；未增加 JS 依赖、Python运行组件或数据库服务。

## 已执行证据

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| `bun run typecheck` | 通过 | TypeScript 类型 |
| `bun run test` | 73 文件、670 测试通过 | UI 组件、厂商配置、范围、语义检索、缓存和失败行为；服务依赖按测试注入 |
| `bun run build` | 通过 | 前端生产构建；保留 PDF.js 的既有 eval 与 bundle 容量警告 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 通过 | Rust 格式 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 67 通过，1 忽略 | 原生 SQLite、实际 sqlite-vec、迁移、事务清理、embedding HTTP 转发与安全传输；忽略项是脚本显式启动的测试桥 |
| `bun scripts/qa/verify-knowledge.ts` | 通过 | 真实 PDF.js + LibraryService + AiService + Rust 临时磁盘 SQLite + 实际 sqlite-vec，HTTP 使用协议夹具 |
| `bunx tauri build --debug --bundles app --config '{"identifier":"com.smartreader.qa20261013","productName":"SmartReader QA"}'` | 通过 | macOS QA 包链接和打包；核对独立应用标识，未启动 |

联合脚本证明：无关键词匹配的问题命中合成 PDF 第 2 页；只选择无关文件时拒绝生成回答且不借用其他文件；重复问题及关闭/重新打开 SQLite 连接后不重算文献向量；迁移数为 8；加密原子删除公开缓存且私有向量不落库；临时 SQLite 中没有私有论文标题或假 API Key 明文；锁定、错误密码和解锁行为正确；Milvus 协议夹具的临时集合已清理且不接收源文本。

联合脚本只创建自己的临时目录和数据库，完成后终止自己的服务并删除目录。Node 下 PDF.js 有标准字体资源路径警告，逐页文本提取和断言成功；桌面字体资源由既有 postinstall 打包。

## 未验证与使用步骤

没有调用真实阿里云或真实 Milvus，不能把协议夹具结果视为真实厂商验收。新问答交互通过组件与 ReaderApp 集成测试验证，本轮未使用 GUI 或启动正式应用；Rust 测试桥不是 Tauri IPC/桌面 UI。

本轮生成的 QA 包为 `src-tauri/target/debug/bundle/macos/SmartReader QA.app`，使用独立应用数据目录；没有覆盖 `/Applications/SmartReader.app`。正式版本可由用户执行已有 `scripts/build-install-macos.sh` 构建安装。

1. 用户自行启动新版应用，进入 AI 厂商设置，编辑现有阿里云配置，将 embedding 模型保存为账号实际可用的模型（表单建议 `text-embedding-v4`）。
2. 专用聊天部署不一定提供 embedding；如需独立地址，填写账号实际 embedding Base URL，重新输入原账号可用 API Key，保存并点击“验证向量模型”。
3. 保持默认本地检索，打开问答，添加 PDF、选择文件并提问。扫描件需先 OCR 或补充摘要。
4. 云端模式需另填实际 Milvus 服务地址和令牌，权限需覆盖创建、插入、检索、删除集合。没有该服务信息时无法完成真实云端验收。

本地向量保存与检索不表示 embedding 推理离线：当前阿里云配置会发送分块文本/问题，聊天会发送匹配摘录。加密文献解锁后的主动本地问答仍有这些厂商请求。
