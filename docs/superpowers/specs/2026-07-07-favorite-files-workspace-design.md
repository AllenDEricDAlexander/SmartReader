# SmartReader 收藏文件工作区设计

## 背景

当前首页侧栏已经有 `收藏文件` 入口。点击后，`HomeDashboard` 将 `activeSidebarPage` 设置为 `favoriteFiles`，但该页面仍落到 `HomeBlankPage` 占位分支，因此只显示空白标题，没有真实功能。

已有可复用基础：

- `HomeFavorites`：首页收藏卡片，已有继续阅读和取消收藏语义。
- `HomeRecentFilesWorkspace`：最近文件工作区，已有搜索、排序、阅读状态筛选、卡片/列表视图、更多菜单和空状态模式。
- `FavoriteDocument`：收藏文件前端模型，当前字段较少。
- `list_favorite_documents`：后端收藏列表查询，当前只返回基础收藏字段。
- `tags` 与 `document_tags`：已有标签和文档标签关联表，可支持真实标签筛选。

## 目标

实现一个真实可用、贴近截图结构的收藏文件工作区，替换当前 `favoriteFiles` 空白占位页。

页面应支持：

- 收藏文件主列表。
- 搜索、排序、阅读状态筛选。
- 标签筛选和目录筛选。
- 卡片/列表双视图，默认卡片视图。
- 继续阅读、取消收藏、更多菜单。
- 右侧真实数据优先的信息栏。
- 清晰的无收藏、无筛选结果、缺少数据降级状态。

## 非目标

本次不做以下内容：

- 不新增真实文件夹体系或文件夹表。
- 不新增 `favoritedAt` 字段或收藏时间迁移。
- 不实现真实“定位文件”能力，仅沿用现有待补充提示。
- 不在收藏页内新增标签编辑能力。
- 不用静态假数据填充右侧统计、活动或推荐理由。
- 不抽象通用文件工作区组件，避免影响最近文件页。

## 页面入口

`HomeDashboard` 增加 `favoriteFiles` 专用渲染分支：

- `activeSidebarPage === 'recentFiles'`：继续渲染 `HomeRecentFilesWorkspace`。
- `activeSidebarPage === 'favoriteFiles'`：渲染新的 `HomeFavoriteFilesWorkspace`。
- 其他仍未实现页面继续使用 `HomeBlankPage`。

这样只替换收藏文件页，不影响首页、最近文件页和其他占位页。

## 数据模型

扩展前端 `FavoriteDocument` 模型：

```ts
export type FavoriteDocument = {
  documentKey: string;
  displayName: string;
  path: string | null;
  lastPage: number;
  progress: number;
  pageCount: number | null;
  missing: boolean;
  lastOpenedAt: string | null;
  tagIds: number[];
};
```

字段用途：

- `pageCount`：展示页码进度。
- `missing`：后续可用于缺失文件状态展示。
- `lastOpenedAt`：支持最近打开优先排序和右侧最近活动。
- `tagIds`：支持真实标签筛选、标签 chips 和常用标签统计。

## 后端查询

调整 `list_favorite_documents_tx` 查询：

- 返回收藏文件的完整展示字段：`document_key`、`display_name`、`path`、`last_page`、`progress`、`page_count`、`missing`、`last_opened_at`。
- 为每个收藏文件返回关联的 `document_tags.tag_id`。
- 无标签时返回空数组。
- 默认排序继续使用 `last_opened_at DESC`。

不新增数据库迁移。现有 `documents.favorite`、`documents.last_opened_at`、`document_tags` 已能支持本次范围。

## 主区域设计

新增 `HomeFavoriteFilesWorkspace` 组件。

### 顶部

顶部包含：

- 小标题：`文档管理`。
- 主标题：`收藏文件`。
- 描述：集中管理已收藏的本地 PDF。
- 计数：`共 N 个收藏，当前显示 M 个`。

### 工具栏

工具栏包含：

- 搜索框：搜索文件名、路径或目录。
- 排序：
  - 最近打开优先。
  - 文件名 A-Z。
  - 阅读进度高到低。
  - 阅读进度低到高。
- 阅读状态筛选：
  - 全部进度。
  - 未开始。
  - 阅读中。
  - 已读完。
- 标签筛选：
  - 全部标签。
  - 仅展示至少被当前收藏文件使用的标签。
- 目录筛选：
  - 全部目录。
  - 从收藏文件 `path` 推导目录。
  - 无路径文件归类为 `本地浏览器文件`。
- 视图切换：
  - 卡片视图。
  - 列表视图。

默认视图为卡片视图，贴近截图。

### 卡片视图

每张卡片展示：

- PDF 图标。
- 文件名。
- 目录。
- 阅读进度条与百分比。
- 页码：有 `pageCount` 时展示 `lastPage / pageCount 页`，否则展示 `第 lastPage 页`。
- 标签 chips。
- 最近打开时间；无 `lastOpenedAt` 时展示 `最近打开时间未知`。
- `继续阅读` 按钮。
- 星标取消收藏按钮。
- 更多菜单。

### 列表视图

列表视图展示相同核心信息，但布局更紧凑，适合大量收藏：

- 文件主信息。
- 目录。
- 阅读进度。
- 标签。
- 最近打开。
- 操作按钮。

### 空状态

空状态分两类：

- 无收藏文件：显示 `暂无收藏文件`，说明收藏 PDF 后会显示在这里，并提供 `打开 PDF` 操作。
- 筛选无结果：显示 `没有匹配的收藏文件`，提供 `清除筛选` 操作。

## 右侧信息栏设计

右侧信息栏真实数据优先，不展示假数据。

### 收藏概览

展示：

- 收藏文件数。
- 有标签的收藏数。
- 目录数。
- 平均阅读进度。
- 已读完比例。

### 常用标签

基于 `availableTags` 和收藏文件 `tagIds` 统计：

- 只展示真实关联到收藏文件的标签。
- 展示标签名称、颜色和收藏文件数量。
- 点击标签后联动主列表标签筛选。
- 无标签时显示轻量空状态，并提示可到标签管理维护标签。

### 最近活动

由于没有 `favoritedAt`，不展示伪造的“最近收藏时间”。

本次展示 `最近打开的收藏文件`：

- 基于 `lastOpenedAt` 排序。
- 展示文件名和最近打开时间。
- 缺少 `lastOpenedAt` 或无可用数据时显示空状态。

### 智能推荐收藏理由

不使用静态示例。

仅在有真实、可解释依据时展示规则型理由，例如：

- 阅读进度较高。
- 同标签收藏文件较多。
- 最近打开过。

如果依据不足，显示 `暂无可用推荐理由`。

## 交互流程

### 打开收藏文件

点击 `继续阅读` 或菜单 `打开`：

- 调用现有 `onOpenFavoriteDocument(document)`。
- 沿用首页收藏卡片的失败提示：`无法打开收藏文件 / 该收藏文件暂无可打开的本地路径。`

### 取消收藏

点击星标或菜单 `取消收藏`：

- 调用 `onToggleFavorite(documentKey, false)`。
- 成功后由 `ReaderApp` 刷新收藏列表和最近文件收藏状态。
- 当前筛选结果为空时保留在收藏页并显示筛选空状态。

### 定位文件

菜单 `定位文件` 本次不实现真实定位：

- 沿用现有 notice：`定位文件功能待补充 / 定位文件将在最近文件管理功能中补充。`

### 筛选联动

- 搜索、排序、阅读状态、标签、目录均在前端基于已加载收藏列表计算。
- 右侧常用标签点击后设置标签筛选。
- 目录 chip 或目录选择器设置目录筛选。
- `清除筛选` 重置搜索、排序、阅读状态、标签、目录，但不强制改变当前视图模式。

## 筛选与统计规则

### 阅读状态

沿用最近文件页的进度区间：

- 未开始：`progress <= 0`。
- 阅读中：`progress > 0 && progress < 1`。
- 已读完：`progress >= 1`。

### 目录推导

目录从 `path` 推导：

- 有路径：使用现有目录展示工具或同等逻辑获得父目录。
- 无路径：归类为 `本地浏览器文件`。

该筛选不是完整文件夹体系，文案应避免称为“文件夹管理”。

### 标签筛选

标签筛选基于收藏文件 `tagIds`：

- 选择某标签时，仅显示包含该标签 ID 的收藏文件。
- 标签列表只显示当前收藏集合中实际出现的标签。

## 错误与降级

- 收藏列表为空：显示无收藏空状态。
- 筛选无结果：显示筛选空状态。
- 标签为空：隐藏标签筛选选项或展示 `暂无标签`。
- 文件路径缺失：目录展示为 `本地浏览器文件`。
- `lastOpenedAt` 缺失：最近活动显示空状态，不伪造时间。
- 打开失败：沿用现有收藏打开失败提示。

## 设计模式判断

本次不引入 Strategy、Factory、Template Method 等设计模式。

原因：

- 收藏页是单一页面编排，变化点有限。
- 筛选、排序、统计适合用纯函数实现，便于测试且符合现有 `HomeRecentFilesWorkspace` 风格。
- 抽象通用文件工作区会影响最近文件页，当前收益不足，风险较高。

采用的组织方式：

- 页面组件负责状态和渲染。
- 纯函数负责筛选、排序、统计和目录/标签派生。
- 回调沿用 `HomeDashboard` 与 `ReaderApp` 的现有打开、收藏、notice 流程。

## 测试计划

### 前端组件测试

新增 `HomeFavoriteFilesWorkspace.test.tsx`，覆盖：

- 渲染标题、计数和收藏文件。
- 搜索文件名、路径和目录。
- 阅读状态筛选。
- 标签筛选。
- 目录筛选。
- 排序。
- 卡片/列表视图切换。
- 继续阅读回调。
- 取消收藏回调。
- 更多菜单打开、取消收藏、定位文件回调。
- 无收藏空状态。
- 筛选无结果空状态。
- 右侧收藏概览统计。
- 常用标签展示和点击联动。
- 最近活动真实数据展示和空状态。
- 推荐理由有依据展示、无依据空状态。

### Dashboard/路由测试

补充或调整 `HomeDashboard` / `ReaderWorkspaceSwitch` 相关测试：

- `favoriteFiles` 页面渲染收藏工作区。
- `favoriteFiles` 不再渲染 `HomeBlankPage`。

### 持久化 API 测试

保留 `listFavoriteDocuments()` 的命令名不变，确认前端 API 仍调用 `list_favorite_documents`。

### Rust 数据库测试

补充 `db.rs` 测试：

- 收藏列表返回新增字段。
- 收藏文档返回关联 `tagIds`。
- 无标签收藏返回空 `tagIds`。
- 默认按 `last_opened_at DESC` 返回。

## 验证命令

实现完成后优先运行：

```bash
npm test -- HomeFavoriteFilesWorkspace
npm test -- HomeDashboard
npm test -- persistenceApi
cargo test --manifest-path src-tauri/Cargo.toml marks_and_lists_favorite_documents
```

最终视改动范围再运行：

```bash
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```
