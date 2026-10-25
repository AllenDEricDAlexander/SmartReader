# 原生标题栏主题同步修复与桌面复测

## 问题与定位

前次会话管理复测记录了护眼模式下原生标题栏文字偏暗的问题。本轮核对了实际依赖的 Tauri 2.11.2 与 Tao 0.35.3 实现：窗口背景色和原生明暗外观是两条独立路径。应用原先只同步背景色，页面的 `color-scheme` 不会选择 AppKit 的标题文字与控件外观。

本轮旧 QA 包在当前系统外观下可直接复现“暗色页面配亮色标题栏”。此前护眼模式的暗底暗字并非每次启动都出现；确定的实现缺口是应用主题没有同步原生外观，而非护眼配色数值本身。

## 分步实现

1. 扩展现有 `set_window_background_color` 命令与 `TauriBridge.setWindowBackgroundColor`，接受可选原生主题。通过已有 Tauri API 先设置原生外观，再更新窗口、WebView 和 macOS backing layers。颜色与主题共用原串行队列；仅传颜色的旧调用不覆盖原生主题。第一步提交为 `4351e65`。
2. 在原有 `ReaderApp` 主题 effect 中传入明确映射：暗色为原生 `dark`，亮色与护眼色为原生 `light`。偏好恢复、首页／阅读页切换、设置保存及失败回退均沿用同一状态和更新路径。窗口同步失败提示统一为“窗口外观同步失败”。

保留原生标题栏、窗口按钮及三套既有页面配色，包括护眼色 `#C7EDCC`。未新增依赖、持久化字段、数据库迁移或额外设计模式；直接映射和已有队列足以保持前后端外观一致。

## 原生桌面操作

使用 computer use 操作实际 macOS Tauri QA 应用，标识仍为 `com.smartreader.cuaq20261023a`，复用其隔离测试数据。没有安装或覆盖正式应用，没有调用 AI 厂商或启动模拟 API 服务，也没有改变 macOS 系统主题。

| 操作 | 实际结果 |
| --- | --- |
| 旧包切暗色 | 页面变暗，标题栏仍为亮色，确认原生与页面外观脱节 |
| 新包恢复已保存暗色 | 原生标题栏为深色、标题为浅色，页面与原生外观一致 |
| 首页暗色切护眼 | 标题栏恢复亮色、深色文字清晰，页面仍为原有护眼绿 |
| 首页护眼切亮色 | 标题栏、原生控件与亮色页面一致 |
| 从原生选择器打开合成 PDF | `attention-study.pdf` 正常进入阅读页，无需真实用户文献 |
| 阅读页第 2 / 3 页切暗色 | 深色标题栏与浅色标题正常，页码仍为 2 / 3 |
| 阅读页暗色切护眼 | 标题栏亮色且文字清晰，阅读区保持护眼绿，页码与 67% 进度保留 |
| 护眼主题退出并重新启动 | 护眼偏好和正确的原生标题栏外观恢复，首页记录及文档标签仍显示第 2 / 3 页 |

截图为实际桌面观察，未将组件测试或构建成功当作原生绘制验收。标题栏采用系统提供的 Aqua／Dark Aqua 外观，未自绘标题或改变窗口按钮布局。

## 自动化与构建

- `bun run test src/platform/tauriBridge.test.ts --reporter=dot`：14 项通过，覆盖可选主题、旧调用兼容、颜色与主题成对有序提交，以及失败后的下一次更新。
- `bun run test src/app/App.test.tsx src/platform/tauriBridge.test.ts --reporter=dot --maxWorkers=2`：2 个文件、124 项通过。主题集成回归核对已保存护眼色、暗色切护眼、亮色及保存失败时的成对回退。
- `bun run typecheck` 通过；隔离 macOS debug app 构建包含的 TypeScript 与生产前端构建通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：75 项通过，1 项原有 native knowledge QA bridge 按设计 ignored。
- `git diff --check` 通过。既有 `src-tauri/gen/schemas/capabilities.json` 差异与本轮开始备份逐字一致，未纳入提交。
- 构建仍有既有 PDF.js `eval` 与大 chunk 提示。

## 边界与收尾

本轮视觉验收限于当前 macOS 环境及隔离 QA 应用，未操作系统级明暗设置，也未声称完成 Windows／Linux 的视觉验收。保存失败回退由集成测试覆盖，没有通过改写真实偏好文件制造桌面写入失败。

QA 应用在复测后退出；正式应用未启动。测试包位于 `src-tauri/target/debug/bundle/macos/SmartReader CUA QA.app`，合成 PDF 沿用 `/tmp/smartreader-cua-qa-20261023a/papers/attention-study.pdf`。
