# SmartReader 最近文件工作台补全设计

## 背景

当前 SmartReader 已有 `最近文件` 页面，但页面密度、列表结构和功能闭环仍接近半成品。现有实现能展示最近文件、搜索、排序、进度筛选、收藏筛选、列表/卡片切换和继续阅读，但与 UI 需求图相比还有明显缺口：

1. 列表没有形成高密度表格，缺少需求图中的文件管理感。
2. 最近文件没有展示或绑定文档标签。
3. 标签管理已经具备能力，但最近文件页还没有接入文件和标签的关系维护。
4. `定位文件`、`从最近记录移除`、`清空历史` 等最近文件管理动作仍是占位提示。
5. 右侧辅助信息区缺失，页面不像需求图中的完整工作台。
6. 当前最近文件模型使用 `modifiedAt` 显示最近打开时间，语义不准确。

本设计目标是把 `最近文件` 补成完整工作台：主区高密度列表，支持文件绑定现有标签，支持批量标签操作，支持真实移出最近和清空历史，右侧用现有数据派生最近活动、快捷操作和统计信息。

## 已确认决策

1. 范围采用完整工作台方案。
2. 文件绑定现有标签采用三入口：
   - 行内标签列可直接编辑。
   - 行右侧更多菜单保留 `管理标签`。
   - 批量操作支持绑定和移除标签。
3. 右侧最近活动不新增活动日志表，先从现有最近文件、收藏和标签关系数据派生。
4. `从最近记录移除` 和 `清空历史` 做真实功能，但不删除本地文件，不删除书签、批注、收藏或标签关系。
5. UI 需求图中的 `作者`、`来源期刊/会议` 暂不实现。最近文件页只展示真实已有数据。
6. 不打开浏览器，不启动项目运行；验证使用命令行测试和类型检查。

## 目标

1. 最近文件页默认呈现接近需求图的高密度列表表格。
2. 最近文件列表展示真实标签，并支持按现有标签筛选。
3. 单个文件可以绑定或解绑已有标签。
4. 多选文件后可以批量绑定标签、批量移除标签、批量移出最近记录。
5. 支持单个移出最近记录和清空最近历史。
6. 右侧展示由现有数据派生的最近活动、快捷操作和本地统计。
7. 最近打开时间使用真实 `last_opened_at`，不再用文件修改时间冒充。
8. 保持阅读器、首页、标签管理、收藏文件、书签和批注等既有行为不变。

## 非目标

1. 不实现 PDF 作者、标题、来源期刊、会议等文献元数据解析。
2. 不新增最近文件审计日志或活动日志表。
3. 不删除本地 PDF 文件。
4. 不删除文档相关书签、批注、收藏和标签关系。
5. 不引入新前端框架、状态管理库、表格库或图表库。
6. 不重构无关页面或阅读器打开流程。
7. 不修改已有 migration 文件。

## 数据与持久化设计

### 最近文件模型

扩展前后端 `PersistedDocument` 模型：

1. 新增 `lastOpenedAt: string | null`，来源于 `documents.last_opened_at`。
2. 新增 `tagIds: number[]`，来源于现有 `document_tags`。
3. 保留现有 `modifiedAt`，只表示文件系统修改时间，不用于最近打开排序或展示。

后端 `list_recent_documents` 返回未隐藏的最近文件，并为每个文档查询 `tagIds`。

前端排序和展示应优先使用 `lastOpenedAt`。如果历史数据没有该字段，则兜底显示 `最近打开时间未知`，并排序到已知时间之后。

### 最近隐藏标记

新增一个 migration，建议文件名为 `src-tauri/src/migrations/005_recent_file_management.sql`。

新增字段：

1. `documents.recent_hidden_at TEXT`

新增索引：

1. `idx_documents_recent_hidden_at`
2. 若现有查询需要，可补 `idx_documents_last_opened_at`

规则：

1. `list_recent_documents` 只返回 `recent_hidden_at IS NULL` 的记录。
2. `remove_recent_document(documentKey)` 将单个文档 `recent_hidden_at` 设为当前时间。
3. `clear_recent_documents()` 将当前未隐藏最近记录批量设置 `recent_hidden_at`。
4. `save_document` 代表重新打开或刷新该文档，应把 `recent_hidden_at` 置空，并更新 `last_opened_at`。
5. 隐藏最近记录不影响 `documents` 主记录，不影响外键关联数据。

这个设计避免误删用户数据，也满足“重新打开同一个文件后再次出现在最近列表”的直觉。

### 标签绑定命令

复用现有命令：

1. `attach_document_tag(documentKey, tagId)`
2. `detach_document_tag(documentKey, tagId)`
3. `list_tags()`

新增或扩展前端 API：

1. `removeRecentDocument(documentKey)`
2. `clearRecentDocuments()`

如实现批量操作时不新增批量后端命令，前端可以按选中文档逐个调用已有 attach/detach/remove 命令。若性能或一致性需要，可以在实现计划中评估新增批量命令，但本设计不强制。

## 前端架构

### ReaderApp

`ReaderApp` 继续作为数据协调点：

1. 加载 `recentDocuments`。
2. 加载 `availableTags`。
3. 持有 `favoriteDocuments`。
4. 将最近文件、标签、收藏和相关动作传入 `HomeDashboard`。

新增动作：

1. 刷新最近文件列表。
2. 移出单个最近文件。
3. 清空最近历史。
4. 标签绑定或解绑完成后刷新最近文件和可用标签。

实现时应保持回调稳定，避免重新引入之前 `useSessionRestore` 相关 effect 抖动问题。

### HomeDashboard

`HomeDashboard` 继续负责首页框架和侧边栏内容分发。

`activeSidebarPage === 'recentFiles'` 时渲染增强后的 `HomeRecentFilesWorkspace`，并传入：

1. `documents`
2. `favoriteDocumentKeys`
3. `tags`
4. `onOpenPdf`
5. `onReopenDocument`
6. `onToggleFavorite`
7. `onToggleDocumentTag`
8. `onRemoveRecent`
9. `onClearRecent`
10. `onOpenTags`

### HomeRecentFilesWorkspace

`HomeRecentFilesWorkspace` 是本次主要页面组件。它只拥有页面 UI 状态，不直接持久化数据。

本地状态：

1. 搜索关键词。
2. 排序模式。
3. 进度筛选。
4. 标签筛选。
5. 收藏筛选。
6. 视图模式。
7. 选中文档集合。
8. 当前打开的更多菜单。
9. 当前打开的标签选择器。
10. 批量操作弹层状态。
11. 清空历史确认状态。

派生数据使用本地 helper 计算，不能修改原始 `documents` 数组。

建议拆出 `recentWorkspaceUtils.ts`，放置搜索、排序、筛选、统计和右侧活动派生逻辑，便于测试。

## UI 设计

### 主列表

默认使用列表视图。表格列为：

1. 选择框。
2. 文件名。
3. 本地路径。
4. 最近打开。
5. 阅读进度。
6. 上次页码。
7. 标签。
8. 操作。

不显示作者和来源列。

文件名单元格：

1. PDF 图标。
2. 文件名。
3. 可选状态标识，例如已收藏、缺失文件。

阅读进度：

1. 百分比。
2. 进度条。

上次页码：

1. 已知页数显示 `lastPage / pageCount`。
2. 页数未知显示 `第 lastPage 页` 或 `页数未知`，保持布局稳定。

标签列：

1. 显示当前文件已有标签 chip。
2. 无标签时显示 `添加标签` 或 `暂无标签`。
3. 点击标签区域打开已有标签选择器。
4. 标签选择器只支持现有标签，不在最近文件页创建标签。
5. 没有可用标签时提示去 `标签管理`。

操作列：

1. `继续阅读`
2. 收藏/取消收藏 icon。
3. 更多菜单。

更多菜单包含：

1. 打开。
2. 管理标签。
3. 收藏或取消收藏。
4. 定位文件。
5. 从最近记录移除。

`定位文件` 如平台命令仍不存在，可以继续展示待补充提示，不作为本次核心验收。

### 顶部工具栏

工具栏包含：

1. 搜索最近文件。
2. 排序。
3. 阅读进度筛选。
4. 标签筛选。
5. 收藏状态筛选。
6. 清除筛选。
7. 列表视图/卡片视图切换。
8. 批量操作入口。

排序选项：

1. 最近打开优先。
2. 文件名 A-Z。
3. 阅读进度高到低。
4. 阅读进度低到高。

进度筛选：

1. 全部进度。
2. 未开始。
3. 阅读中。
4. 已读完。

标签筛选：

1. 全部标签。
2. 未打标签。
3. 具体标签。

收藏筛选：

1. 全部文件。
2. 已收藏。
3. 未收藏。

清除筛选只重置搜索和筛选排序，不重置视图模式。

### 批量操作

选中文档后显示批量操作状态。

支持：

1. 批量绑定标签。
2. 批量移除标签。
3. 批量从最近记录移除。

批量绑定标签：

1. 选择一个现有标签。
2. 对所有选中文档调用绑定。
3. 已绑定的文档保持幂等。
4. 完成后刷新最近列表。

批量移除标签：

1. 选择一个现有标签。
2. 对所有选中文档调用解绑。
3. 未绑定的文档保持幂等。
4. 完成后刷新最近列表。

批量移出最近：

1. 弹确认。
2. 确认后逐个移出或调用批量后端命令。
3. 完成后清空选择。

### 右侧辅助栏

右侧辅助栏不新增活动表，内容由现有数据派生。

最近活动：

1. 最近打开的文件。
2. 已收藏的最近文件。
3. 已有标签的最近文件。

文案应避免审计承诺，例如使用 `最近打开`、`已标记标签`，不要写成精确操作日志。

快捷操作：

1. 继续上次会话。
2. 打开本地 PDF。
3. 从最近会话恢复。
4. 清空历史记录。

本地统计：

1. 最近文件数。
2. 收藏文件数。
3. 已打标签文件数。
4. 已读完文件数。

统计从 `recentDocuments`、`favoriteDocumentKeys`、`tagIds` 派生。

### 卡片视图

保留卡片视图，但不是主要验收焦点。卡片需要展示：

1. 文件名。
2. 路径。
3. 最近打开。
4. 进度。
5. 标签。
6. 继续阅读。
7. 收藏和更多菜单。

### 空态和错误态

无最近文件：

1. 显示 `暂无最近文件`。
2. 提供 `打开文件`。

筛选无结果：

1. 显示 `没有匹配的最近文件`。
2. 提供 `清除筛选`。

无标签：

1. 标签列显示 `暂无标签`。
2. 标签选择器显示 `暂无可用标签` 和 `去标签管理`。

标签操作失败：

1. 保持弹层打开。
2. 显示失败原因。
3. 不清空当前选择。

清空历史：

1. 必须弹确认。
2. 文案明确只清空最近记录，不删除文件或阅读数据。

## 设计模式考虑

本任务显式考虑设计模式，但不引入重型模式。

不采用 Strategy、Factory、Command、Decorator 等模式，原因是当前业务规则稳定，变化点不复杂。为筛选和排序创建策略类会扩大文件数量和调用层级，不符合当前项目偏直接、可读、易测的风格。

采用现有的轻量 facade 边界：

1. `PersistenceApi` 作为前端持久化 facade。
2. Tauri command 作为页面能力入口。
3. `HomeRecentFilesWorkspace` 作为页面组件。
4. `recentWorkspaceUtils` 作为纯函数派生层。

这个结构解决的真实问题是数据闭环和页面复杂度控制，而不是为了使用模式而增加抽象。

## 测试计划

### Rust 测试

覆盖：

1. migration 后 `documents.recent_hidden_at` 存在。
2. `list_recent_documents` 返回 `lastOpenedAt` 和 `tagIds`。
3. 隐藏的文档不出现在最近列表。
4. `remove_recent_document` 只隐藏单个文档。
5. `clear_recent_documents` 隐藏当前最近记录。
6. `save_document` 重新打开后清除隐藏状态。
7. 标签绑定后最近文件返回对应 `tagIds`。

### TypeScript API 测试

覆盖：

1. `createPersistenceApi().removeRecentDocument` 调用 `remove_recent_document`。
2. `createPersistenceApi().clearRecentDocuments` 调用 `clear_recent_documents`。
3. `PersistedDocument` fixture 包含 `lastOpenedAt` 和 `tagIds`。

### 组件测试

`HomeRecentFilesWorkspace.test.tsx` 覆盖：

1. 默认列表视图展示高密度表格列。
2. 使用 `lastOpenedAt` 排序和展示。
3. 标签 chip 渲染。
4. 标签筛选，包括未打标签。
5. 行内标签选择器绑定和解绑。
6. 更多菜单进入管理标签。
7. 多选和批量绑定标签。
8. 批量移除标签。
9. 单个移出最近记录。
10. 清空历史确认。
11. 右侧派生活动和统计。
12. 无最近文件、筛选无结果、无标签、标签操作失败空态。

`HomeDashboard.test.tsx` 或 `ReaderWorkspaceSwitch.test.tsx` 覆盖：

1. `recentFiles` 页面传入 `availableTags`。
2. 标签操作成功后触发刷新。
3. 侧边栏和顶部栏仍保留。

### 验证命令

优先运行目标测试：

```bash
bunx vitest run src/persistence/persistenceApi.test.ts src/home/HomeRecentFilesWorkspace.test.tsx src/home/HomeDashboard.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx
```

如触及 `ReaderApp` 集成路径，补充：

```bash
bunx vitest run src/app/App.test.tsx
```

后端验证：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

类型检查：

```bash
bun run typecheck
```

不启动项目运行。

## 实现任务与提交边界

按照项目规则，每个任务完成后单独提交。

1. 设计规格提交。
2. 后端 migration 和最近文件命令提交。
3. 前端 persistence 类型和 API 提交。
4. 最近文件工作台 UI、标签绑定和批量操作提交。
5. 测试补齐和验证收口提交。

提交时只 stage 当前任务相关文件，避免带入其他 agent 或用户的改动。

## 验收清单

1. 最近文件页主区接近 UI 需求图的高密度文件管理列表。
2. 列表展示真实最近打开时间。
3. 列表展示文件已有标签。
4. 支持按标签筛选，包括未打标签。
5. 支持单个文件行内绑定和解绑已有标签。
6. 支持更多菜单进入标签管理动作。
7. 支持批量绑定标签和批量移除标签。
8. 支持单个文件从最近记录移除。
9. 支持清空最近历史，且有确认。
10. 移出最近和清空历史不删除本地文件、书签、批注、收藏或标签关系。
11. 重新打开被移出的文件后，它重新出现在最近列表。
12. 右侧辅助栏展示派生的最近活动、快捷操作和本地统计。
13. 无最近文件、筛选无结果、无标签和标签操作失败都有稳定反馈。
14. 不展示作者和来源列。
15. 只新增一个 migration，不修改旧 migration。
16. 目标测试、后端测试和类型检查通过，无法验证项必须说明原因。
