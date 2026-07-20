# SmartReader 书签管理工作台设计

## 背景

SmartReader 已经具备书签添加、查询、重命名、删除以及打开 PDF 并跳转到指定页码的完整基础链路，但当前书签管理界面仍只是简单列表：

1. `HomeBookmarksWorkspace` 只展示书签名称、文档名称和页码。
2. 页面没有分组、搜索、筛选、排序、分页、详情栏或批量操作。
3. 书签模型只有 `title`，没有独立备注。
4. `BookmarkManagerWorkspace` 与首页内的书签管理入口存在两套简单界面，后续容易出现行为分叉。
5. 当前“打开书签管理”入口还复用了打开全局搜索的刷新动作，页面导航与搜索弹窗存在不必要的耦合。

本设计把现有书签管理入口升级为完整桌面工作台，并增加页面级书签看板查询。页面继续复用 SmartReader 已有 App Shell、导航、主题变量、书签写入能力和 PDF 跳转能力。

## 已确认决策

1. 以仓库真实技术栈为准，使用 React、TypeScript、Lucide 和现有 CSS Token，不新增 Ant Design 或其他 UI 依赖。
2. `title` 继续表示必填的“书签名称/摘要”。
3. 新增独立、可空的 `note` 字段，用于书签备注。
4. 允许为备注新增一个数据库迁移，并最小扩展 Rust 书签模型、SQL 和既有 Tauri 数据契约。
5. 采用页面级 dashboard 方案，新增只读 Tauri Command `load_bookmark_dashboard`。
6. 直接优化当前书签管理页，不新建平行路由或第二套书签管理功能。
7. 不新增章节、书签类型、作者、年份或页面缩略图数据模型；缺少的数据按明确规则隐藏或降级。
8. 页面只使用真实持久化数据，不用 mock、临时数组或重复状态模拟写入结果。
9. 完成设计文档后不自动启动项目，运行验收由用户执行。

## 目标

1. 在现有 SmartReader App Shell 内提供完整书签管理工作台。
2. 按文档分组展示全部书签。
3. 支持搜索、文档筛选、日期筛选、排序、分页和紧凑密度切换。
4. 支持单条选中和固定右侧详情栏。
5. 支持书签名称与独立备注的持久化编辑。
6. 支持单条删除和可报告部分失败的批量删除。
7. 支持打开文档、跳转书签、复制引用和相邻书签切换。
8. 提供稳定的加载、空、无结果、错误和源文件缺失状态。
9. 保持全局搜索与书签管理共享同一份 dashboard 数据，不维护重复书签状态。
10. 保持现有书签添加、删除、PDF 打开和页码跳转语义不变。

## 非目标

1. 不新增或重构 PDF 页面渲染、缩略图或封面生成系统。
2. 不实现章节识别、目录解析或章节持久化。
3. 不实现书签类型、书签标签或颜色分类。
4. 不解析作者、年份、期刊或引用元数据。
5. 不新增批量删除 Tauri Command。
6. 不新增前端状态管理库、表格库、CSS 框架或组件库。
7. 不重构全局目录、阅读器核心、最近文件、收藏文件、标签、批注或笔记页面。
8. 不修改已有 migration 文件。
9. 不删除本地 PDF 文件，不修复或重新扫描失效源文件。
10. 不额外开发当前项目不存在的暗色主题。

## 当前实现接入点

### 页面与导航

1. `src/home/HomeSidebar.tsx`
   - 已有“书签管理”导航项。
2. `src/home/HomeDashboard.tsx`
   - `activeSidebarPage === 'bookmarks'` 时渲染 `HomeBookmarksWorkspace`。
3. `src/home/HomeBookmarksWorkspace.tsx`
   - 当前 App Shell 内的书签管理主入口，是本次优化的 canonical page。
4. `src/workspaces/BookmarkManagerWorkspace.tsx`
   - 旧独立工作区入口，改为复用同一书签管理核心视图，不能继续维护另一套列表行为。

### 前端状态与操作

1. `src/app/ReaderApp.tsx`
   - 当前负责全局书签查询结果、页面跳转、重命名和删除协调。
2. `src/reader/hooks/useReaderDecorations.ts`
   - 当前负责活动文档书签的持久化和 `bookmarksByDocument` 同步。
3. `src/reader/annotations/BookmarkActions.tsx`
   - 现有阅读器内重命名和删除入口继续保留。
4. `src/persistence/persistenceApi.ts`
   - 已有 `saveBookmark`、`listBookmarks`、`listAllBookmarks` 和 `deleteBookmark`。

### Rust 与 SQLite

1. `src-tauri/src/db.rs`
   - 已有书签数据结构、保存、单文档查询、全量查询和删除逻辑。
2. `src-tauri/src/lib.rs`
   - 注册现有数据库 Command。
3. `src-tauri/src/migrations/002_reader_core_completion.sql`
   - 创建了当前 `bookmarks` 表，不能修改。
4. 当前最新 migration 版本为 `005_recent_file_management`，因此本次新增版本为 `006`。

## 数据库设计

新增且只新增一个 migration：

`src-tauri/src/migrations/006_bookmark_management.sql`

迁移内容只为现有表增加备注列：

```sql
ALTER TABLE bookmarks ADD COLUMN note TEXT;
```

规则：

1. `note` 允许为 `NULL`。
2. 历史书签升级后 `note` 自动为 `NULL`。
3. 空白备注在写入前归一化为 `NULL`。
4. 不为 `note` 增加索引；当前数据量和前端搜索方式不需要全文或普通索引。
5. 不修改、重排或重新格式化旧 migration。
6. migration 注册顺序追加在 `005_recent_file_management` 之后。

## Rust 书签模型与写入契约

### 书签模型

`PersistedBookmark` 和相关查询记录新增：

```text
note: Option<String>
```

Rust 反序列化对 `note` 使用默认空值，保证旧前端请求或测试 fixture 不携带该字段时仍可处理。前端持久化模型对应：

```text
note: string | null
```

新建书签继续使用现有添加流程，只在保存负载中补充 `note: null`，不改变默认标题、页码或创建时间行为。

### 既有 Command

1. `save_bookmark`
   - 插入时写入 `note`。
   - 更新时同时更新 `page`、`title`、`note` 和 `updated_at`。
   - 名称和备注由一次数据库更新原子保存。
2. `list_bookmarks`
   - 返回 `note`，保证阅读器和管理页使用同一领域字段。
3. `list_all_bookmarks`
   - 返回 `note`，保留既有接口兼容能力。
4. `delete_bookmark`
   - SQL 和语义保持不变。

## 书签 Dashboard Command

新增只读 Command：

```text
load_bookmark_dashboard
```

该 Command 不接收搜索、筛选或分页参数，一次返回本地全部书签及必要文档元数据。前端负责视图派生，避免为本地工作台引入服务端分页状态和多次往返。

### 返回结构

```text
BookmarkDashboard
├── totalBookmarks
└── groups[]
    ├── document
    │   ├── documentKey
    │   ├── displayName
    │   ├── path
    │   ├── missing
    │   ├── fileSize
    │   └── pageCount
    ├── bookmarkCount
    └── bookmarks[]
        ├── id
        ├── documentKey
        ├── page
        ├── title
        ├── note
        ├── createdAt
        └── updatedAt
```

### 查询规则

1. 以 `bookmarks` 为主表，`LEFT JOIN documents`。
2. 没有对应文档记录时仍返回书签。
3. 缺少文档名称时使用 `document_key` 作为展示兜底。
4. 文档不存在或没有文档记录时 `missing = true`。
5. `fileSize`、`pageCount` 等无法获取的值返回 `NULL`，不生成占位数据。
6. `bookmarkCount` 是该文档全部书签数量，不受当前前端筛选或分页影响。
7. 后端按文档展示名、页码和标题返回稳定基础顺序；最终用户选择的排序由前端执行。

### 设计模式

`load_bookmark_dashboard` 使用轻量 Facade + Dashboard DTO：

1. Facade 集中处理书签与文档表的聚合。
2. DTO 与页面读取需求对齐，避免前端多次查询并自行猜测缺失文档。
3. 不增加 repository、service、factory 或 strategy 层。
4. 搜索、排序、分页和相邻项计算使用纯函数，直接且可测试。

Strategy、Factory、Command Pattern 等模式不适合当前变化点；引入这些抽象只会增加文件和调用层级。

## 单一数据源与 ReaderApp 数据流

`ReaderApp` 持有：

1. `bookmarkDashboard`
2. `bookmarkDashboardLoading`
3. `bookmarkDashboardError`
4. dashboard 请求编号引用

不再单独持有另一份 `globalSearchBookmarks` 状态。全局搜索需要的 `PersistedBookmarkRecord[]` 通过 `useMemo` 从 dashboard groups 展平，并合并所属文档的名称、路径和缺失状态。

### 首次进入

1. 用户点击侧边栏“书签管理”。
2. `ReaderApp` 切换 `activeSidebarPage`。
3. 调用 `refreshBookmarkDashboard`。
4. 首次加载显示保持页面两栏尺寸的 Skeleton。
5. 成功后写入 dashboard。
6. `HomeBookmarksWorkspace` 根据 dashboard 派生当前页面。

### 全局搜索解耦

当前书签入口同时调用 `openGlobalSearch`。本次拆分为：

1. 打开书签管理：只切换页面并刷新 dashboard。
2. 打开全局搜索：打开搜索界面，同时刷新 dashboard 和批注集合。

这样进入书签管理不会额外弹出全局搜索，两个入口仍共享同一份最新书签数据。

### 请求竞争

每次刷新递增请求编号。只有最新请求可以写入 dashboard、loading 和 error 状态，防止较慢的旧请求覆盖新结果。

### 写操作同步

1. 保存名称或备注：
   - 通过 `useReaderDecorations` 的通用书签更新方法调用 `saveBookmark`。
   - 持久化成功后更新已加载的 `bookmarksByDocument`。
   - 随后刷新 dashboard。
2. 单条删除：
   - 通过现有书签删除方法调用 `deleteBookmark`。
   - 持久化成功后更新活动文档状态。
   - 随后刷新 dashboard。
3. 写入失败：
   - 不修改 dashboard。
   - 不移除或覆盖活动文档中的书签。
   - 保留编辑输入或批量失败选择。

现有重命名入口委托给通用书签更新方法，避免管理页与阅读器分别实现持久化规则。

## 前端组件架构

### Canonical 页面

`HomeBookmarksWorkspace` 继续作为 App Shell 内的 canonical page，负责组合书签工作台。旧 `BookmarkManagerWorkspace` 只做兼容包装，复用同一核心内容组件，不复制筛选、编辑或删除逻辑。

### 组件边界

1. `HomeBookmarksWorkspace`
   - 作为 App Shell 内的轻量包装。
   - 接收 dashboard、loading、error 和领域操作。
2. `BookmarkManagementContent`
   - 组合主区和详情栏。
   - 由 `HomeBookmarksWorkspace` 和旧 `BookmarkManagerWorkspace` 共同复用。
3. `useBookmarkManagement`
   - 管理搜索、筛选、排序、分页、展开、选中和批量模式。
   - 不直接调用 Tauri Command。
4. `BookmarkToolbar`
   - 搜索、文档筛选、日期筛选、排序、清除筛选、密度和批量入口。
5. `BookmarkGroupList`
   - 渲染当前页的文档分组和书签行。
6. `BookmarkGroupHeader`
   - 展开状态、文档图标、文档名称和全部书签数量。
7. `BookmarkListItem`
   - 名称、页码进度、创建时间、备注摘要和操作。
8. `BookmarkBatchToolbar`
   - 当前页全选、选中数量、批量删除和取消。
9. `BookmarkPagination`
   - 总数、上一页、页码、下一页和每页数量。
10. `BookmarkDetailPanel`
   - 页码预览占位、文档信息、章节降级、相邻书签和快速操作。
11. `BookmarkEditorDialog`
    - 同时编辑名称和备注，并支持聚焦备注字段。
12. `BookmarkPageState`
    - 首次加载、全局空、筛选空和首次错误状态。

### 纯函数

新增 `bookmarkManagementUtils.ts`，负责：

1. dashboard 展平。
2. 搜索匹配。
3. 文档和日期筛选。
4. 分组内排序。
5. 分页和当前页重新分组。
6. 相邻书签查找。
7. 删除后的合理选中项。
8. 引用文本生成。
9. 文档与页码进度格式化。

这些 helper 不读取 React 状态、不调用 persistence，也不修改输入数组。

## 页面布局

页面继续复用：

1. `HomeTopBar`
2. `HomeSidebar`
3. `HomeStatusBar`

工作台内部使用两栏布局：

1. 主内容区：`minmax(0, 1fr)`。
2. 右侧详情栏：约 `320px`。
3. 页面主体独立滚动，不破坏 App Shell。
4. 窄窗口达到现有响应式断点后，详情栏移动到主列表下方。

### 页面标题

标题：

```text
书签管理
```

副标题：

```text
统一管理所有文献中的书签，快速定位重要内容
```

右上角显示：

```text
共 N 个书签
```

`N` 来自 `dashboard.totalBookmarks`。

## 搜索、筛选和排序

### 搜索

搜索框 placeholder：

```text
搜索书签名称、备注或文档...
```

大小写不敏感，匹配：

1. 书签 `title`
2. 书签 `note`
3. 文档名称
4. 文档路径

搜索输入使用 React `useDeferredValue` 优化大列表派生，不增加防抖依赖。清空按钮恢复空关键词。

### 筛选

只展示真实字段支持的筛选：

1. 全部文档 / 指定文档
2. 全部日期
3. 今天
4. 最近 7 天
5. 最近 30 天

日期按用户本地时区和 `createdAt` 判断。无效时间只在“全部日期”中保留。

不展示：

1. 类型筛选
2. 章节筛选

“清除筛选”重置关键词、文档筛选和日期筛选，但保留当前密度模式。

### 排序

排序选项：

1. 创建时间降序
2. 创建时间升序
3. 页码升序
4. 页码降序

文档分组始终按文档名称稳定排序；选择的排序模式作用于每个文档组内的书签。相同排序值使用创建时间、页码、标题和 ID 作为稳定次级顺序。

## 分页与分组语义

派生顺序：

```text
展平 dashboard
→ 搜索
→ 筛选
→ 按文档分组并排序
→ 将各组书签连续展平
→ 按书签记录分页
→ 将当前页记录重新按文档分组
```

规则：

1. 默认每页 20 条。
2. 可选 20、50、100 条。
3. 分页总数是当前搜索和筛选后的书签数量。
4. 同一文档书签超过页容量时，可出现在相邻页。
5. 分组标题数量显示该文档全部书签数，而不是当前页数量。
6. 文档组默认展开。
7. 展开状态按 `documentKey` 保存。
8. 搜索、筛选、排序或每页数量变化后回到第一页。
9. 页数因删除减少时，当前页回退到最后一个有效页。

## 列表与选中状态

列表默认使用标准密度；第二个视图按钮切换紧凑密度，不开发独立网格。

### 分组标题

显示：

1. 展开/收起图标
2. PDF 图标
3. 文档名称
4. 全部书签数量
5. 源文件缺失标记

### 表格列

1. 书签名称/摘要
2. 页码及页码进度
3. 创建时间
4. 备注
5. 操作

规则：

1. 名称和备注单行省略。
2. 使用原生 `title` 以及明确的可访问名称提供完整内容。
3. 空值统一显示 `—`。
4. 页码统一显示“第 N 页”。
5. 已知总页数时显示 `N / M` 以及 `N ÷ M` 的页码进度。
6. 未知总页数时不显示百分比。
7. 创建时间沿用项目现有 `formatDateTime` 风格。

点击书签行只负责选中，不立即跳转：

1. 同时只选中一条。
2. 使用浅蓝背景、主色描边和 `aria-selected`。
3. 选中项被筛选隐藏时清空详情。
4. 展开和收起分组不丢失仍然可见的选中状态。

## 右侧详情栏

详情栏始终存在。未选中时显示：

```text
请选择一条书签查看详情
```

选中后包含以下模块。

### 页码预览

项目没有可直接复用的独立页面缩略图接口，因此不新增 PDF 渲染系统。使用稳定的页面占位卡展示：

1. 当前页码
2. 总页数
3. 页码进度
4. PDF 页面图标

### 所属文档

展示真实可用字段：

1. PDF 图标
2. 文档名称
3. 文件路径
4. 文件大小
5. 总页数
6. 缺失状态
7. “打开文档”按钮

作者、年份和封面不存在时不渲染。

### 章节位置

当前没有章节数据，显示：

```text
未识别章节
```

不生成伪章节或从标题猜测章节。

### 相邻书签

相邻项只在当前文档内计算：

1. 页码升序
2. 创建时间升序
3. ID 升序

点击上一条或下一条后：

1. 切换当前选中书签。
2. 自动展开目标文档组。
3. 自动切换到目标所在分页。
4. 聚焦并高亮目标行。

没有相邻项时对应按钮禁用。

### 快速操作

1. 跳转到该书签
2. 编辑备注
3. 复制引用
4. 删除书签

“打开文档”和“跳转到该书签”都复用现有 `openRecordPage` 能力，以选中书签页码为目标，不新增 PDF 打开或跳页逻辑。

## 编辑名称与备注

书签管理页使用专用编辑弹窗：

1. “书签名称”为必填单行输入。
2. “备注”为可选多行输入。
3. 从详情栏“编辑备注”打开时自动聚焦备注。
4. 从行操作“编辑书签”打开时默认聚焦名称。
5. 保存前去除名称首尾空格。
6. 空名称阻止保存并显示校验错误。
7. 备注去除首尾空格，空白备注归一化为 `NULL`。
8. 一次 `save_bookmark` 同时保存名称和备注。
9. 保存成功后关闭弹窗并刷新 dashboard。
10. 保存失败时保留输入和弹窗，显示错误信息。
11. 保存期间禁用重复提交。
12. `Escape` 可关闭未提交弹窗；存在修改时先提示放弃更改。

## 复制引用

默认格式：

```text
《文档名称》，“书签名称”，第 N 页
```

规则：

1. 缺失文档名称时使用可用的文档 key。
2. 缺失书签名称的情况不会产生，因为名称为必填。
3. 缺失页码时省略页码片段，但正常持久化记录必须有页码。
4. 使用 WebView 的 `navigator.clipboard.writeText`。
5. 剪贴板不可用或写入失败时显示明确错误。
6. 不新增 Tauri 剪贴板插件。

## 单条删除

1. 删除前显示确认弹窗。
2. 弹窗明确展示书签名称和不可撤销说明。
3. 默认焦点位于取消按钮。
4. 删除期间禁用重复提交。
5. 只调用现有 `delete_bookmark`。
6. 删除成功后刷新 dashboard。
7. 删除失败时保留原列表和选中项并显示错误。

删除后的选中顺序：

1. 当前文档中的下一条。
2. 当前文档中的上一条。
3. 当前筛选结果中的下一条。
4. 当前筛选结果中的上一条。
5. 没有可选项时清空详情。

## 批量操作

进入批量模式后：

1. 每条书签显示复选框。
2. 支持单条选择。
3. 支持全选当前页。
4. 显示当前选中数量。
5. 提供批量删除和取消。
6. 文档分组标题不参与删除。

批量删除：

1. 确认弹窗显示准确数量。
2. 顺序调用现有 `delete_bookmark`，不并发写 SQLite。
3. 单条失败不终止后续删除。
4. 完成后刷新 dashboard。
5. 成功项从选择集合移除。
6. 失败项保持选中。
7. 显示“成功 N 条，失败 M 条”。
8. 全部成功时退出批量模式。
9. 取消批量模式清空批量选择，不清除普通详情选中项。

## 源文件缺失

dashboard 根据 `documents.missing` 和关联记录判断文件状态。

缺失文件时：

1. 分组标题和详情栏显示“源文件不可用”。
2. 禁用“打开文档”和“跳转到该书签”。
3. 仍允许查看名称、备注、页码和时间。
4. 仍允许编辑、复制和删除。
5. 不新增文件扫描、重新关联或自动修复能力。

## 加载、空状态和错误处理

### 首次加载

使用与最终两栏布局尺寸一致的 Skeleton，避免大面积跳动。

### 全局无书签

显示：

```text
暂无书签
在阅读文献时添加书签后，可在这里统一管理
```

提供“打开文档”按钮，调用现有打开 PDF 能力。

### 搜索或筛选无结果

显示：

```text
没有找到符合条件的书签
```

提供“清除筛选”。

### 首次查询失败

1. 页面级错误说明。
2. “重试”按钮。
3. 不渲染空白页面。

### 后台刷新失败

1. 保留最后一次成功 dashboard。
2. 显示非阻塞错误提示。
3. 提供再次刷新入口。

### 写操作失败

1. 编辑失败保留输入。
2. 删除失败保留列表和选中。
3. 批量删除报告成功和失败数量。
4. 所有按钮在请求期间显示 busy/disabled 状态。

## 可访问性

1. 所有纯图标按钮提供明确 `aria-label`。
2. 分组按钮提供 `aria-expanded` 和关联内容 ID。
3. 书签行提供 `aria-selected`。
4. 批量选择提供可读标签和当前页全选状态。
5. 菜单支持方向键、Home、End 和 Escape。
6. 弹窗形成焦点约束，关闭后焦点返回触发按钮。
7. 删除确认默认焦点不落在危险按钮。
8. 异步状态使用 `role="status"` 或 `role="alert"`。
9. 选中、错误和文件缺失状态同时使用文本、图标或边框，不只依赖颜色。
10. 文本和交互色继续遵循现有主题变量的对比度。

## 样式策略

1. 在 `src/app/styles.css` 中增加 `bookmark-management-*` 前缀的专属样式。
2. 复用：
   - `--sr-bg`
   - `--sr-surface`
   - `--sr-surface-muted`
   - `--sr-border`
   - `--sr-text`
   - `--sr-text-muted`
   - `--sr-primary`
   - `--sr-danger`
   - `--sr-radius`
3. 使用浅灰页面背景、白色卡片、细边框和克制阴影。
4. 选中行使用浅蓝背景和主色描边。
5. 危险操作使用现有红色变量。
6. 不使用渐变、高饱和装饰色或新的主题变量体系。
7. 标准与紧凑密度只调整行高、间距和次级文字显示，不改变数据能力。
8. 样式选择器保持页面级隔离，不能影响最近文件、标签管理或阅读器。

## 测试设计

### Rust 与 migration 测试

1. 从现有 migration 序列升级后存在 `bookmarks.note`。
2. 历史书签的 `note` 为 `NULL`。
3. 新建书签可省略备注并成功保存。
4. 保存备注后可以通过单文档查询读回。
5. 清空备注后数据库值恢复为 `NULL`。
6. `load_bookmark_dashboard` 正确返回总数和文档分组。
7. dashboard 返回文件大小和总页数。
8. 没有文档关联的书签仍然返回并标记缺失。
9. 同一文档的 `bookmarkCount` 正确。
10. 新 Command 已在 Tauri handler 中注册。
11. 既有删除语义保持不变。

### Persistence API 测试

1. `loadBookmarkDashboard` 调用 `load_bookmark_dashboard`。
2. `saveBookmark` 正确传递 `note`。
3. `note: null` 可以正常传递。
4. dashboard 响应类型与前端模型一致。

### 纯函数测试

1. 搜索名称、备注、文档名和路径。
2. 清空搜索。
3. 文档筛选。
4. 今天、最近 7 天和最近 30 天筛选。
5. 四种排序。
6. 分页与当前页重新分组。
7. 文档跨页时分组数量保持全部数量。
8. 相邻书签计算。
9. 删除后的选择顺序。
10. 选中项被筛选隐藏时的校验。
11. 引用文本字段降级。
12. 页码进度和空值格式化。

### 组件测试

1. 正常渲染书签列表。
2. 按文档分组并展开、收起。
3. 搜索和清空。
4. 切换文档与日期筛选。
5. 切换排序和每页数量。
6. 标准与紧凑密度切换。
7. 选择书签后显示详情。
8. 关闭详情清除选中。
9. 上一条和下一条切换并定位。
10. 编辑名称和备注成功。
11. 编辑失败保留输入。
12. 单条删除成功。
13. 删除确认取消。
14. 批量选择和全选当前页。
15. 批量删除全部成功。
16. 批量删除部分失败。
17. 全局空状态。
18. 搜索无结果状态。
19. 首次查询失败与重试。
20. 后台刷新失败保留旧数据。
21. 源文件缺失时禁用打开和跳转。
22. 点击跳转调用现有打开与定位回调。
23. 复制引用成功和失败。
24. 当前选中书签被删除后的状态处理。

### 应用集成测试

1. 点击侧边栏书签管理打开当前 App Shell 内页面。
2. 打开书签管理不会弹出全局搜索。
3. 打开页面触发 dashboard 刷新。
4. 较旧 dashboard 请求结果不会覆盖较新结果。
5. 编辑和删除后 dashboard 与活动文档书签同步。
6. 全局搜索从 dashboard 派生书签结果。
7. 旧独立书签入口复用同一核心视图。

## 验证命令

优先运行目标测试，再运行完整验证：

```bash
bun run test src/home/bookmarkManagementUtils.test.ts src/home/HomeBookmarksWorkspace.test.tsx src/persistence/persistenceApi.test.ts src/reader/hooks/useReaderDecorations.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml
bun run typecheck
bun run test
bun run build
git diff --check
```

当前 `package.json` 没有 Lint 脚本。最终结果必须标记“项目未配置可执行的 Lint 命令”，不能声称 Lint 已通过。

验证不自动执行 `bun run dev`、`bun run tauri` 或其他项目启动命令。

## 预计修改范围

### 新增

1. `src-tauri/src/migrations/006_bookmark_management.sql`
2. `src/home/BookmarkManagementContent.tsx`
3. `src/home/useBookmarkManagement.ts`
4. `src/home/bookmarkManagementUtils.ts`
5. `src/home/bookmarkManagementUtils.test.ts`
6. `src/home/BookmarkToolbar.tsx`
7. `src/home/BookmarkGroupList.tsx`
8. `src/home/BookmarkDetailPanel.tsx`
9. `src/home/BookmarkEditorDialog.tsx`
10. `src/home/HomeBookmarksWorkspace.test.tsx`

### 修改

1. `src-tauri/src/db.rs`
2. `src-tauri/src/lib.rs`
3. `src/persistence/persistenceApi.ts`
4. `src/persistence/persistenceApi.test.ts`
5. `src/reader/hooks/useReaderDecorations.ts`
6. `src/reader/hooks/useReaderDecorations.test.tsx`
7. `src/app/ReaderApp.tsx`
8. `src/app/ReaderWorkspaceSwitch.tsx`
9. `src/home/HomeDashboard.tsx`
10. `src/home/HomeBookmarksWorkspace.tsx`
11. `src/workspaces/BookmarkManagerWorkspace.tsx`
12. `src/app/styles.css`
13. 直接覆盖书签入口和状态流的现有测试

实现计划必须在执行前再次核对实际依赖关系，并以最小文件集合为准。不能因为本清单列出文件就进行无关修改。

## 风险与控制

### Dashboard 与全局搜索共享

风险：替换旧 `globalSearchBookmarks` 状态时可能使全局搜索加载时机变化。

控制：

1. 使用 dashboard 展平 helper。
2. 保留全局搜索打开时的显式刷新。
3. 增加入口解耦和搜索结果集成测试。

### 旧书签兼容

风险：新 `note` 字段导致旧保存负载或测试 fixture 反序列化失败。

控制：

1. Rust `note` 使用 serde 默认。
2. 新建流程显式写 `note: null`。
3. 增加旧负载兼容测试。

### 批量部分失败

风险：部分删除成功后，列表和选择集合不一致。

控制：

1. 顺序执行并记录每个结果。
2. 完成后从数据库重新加载 dashboard。
3. 只保留失败 ID 的批量选择。

### 工作区已有改动

当前主工作区已经存在与阅读器 UI 相关的 staged/unstaged 改动。

控制：

1. 书签任务不得覆盖这些文件中的用户改动。
2. 如实现必须触及重叠文件，先重新读取 diff 并做局部补丁。
3. 每个任务只提交明确路径。
4. 验证结果需区分书签改动与既有工作区改动造成的失败。

## 验收清单

1. 侧边栏“书签管理”进入现有 App Shell 内的完整工作台。
2. 进入页面不会额外打开全局搜索。
3. 页面使用真实 dashboard 数据，不包含 mock。
4. 书签按文档分组。
5. 搜索、文档筛选、日期筛选、排序和分页可用。
6. 标准与紧凑密度可切换。
7. 点击书签显示固定右侧详情。
8. 名称和备注可持久化编辑。
9. 备注为空时持久化为 `NULL`。
10. 单条删除有确认并调用既有能力。
11. 批量删除可用并正确报告部分失败。
12. 打开文档和跳转页码复用现有能力。
13. 相邻书签切换能够定位列表。
14. 复制引用可用并有失败提示。
15. 源文件缺失时仍可查看、编辑和删除。
16. 加载、全局空、筛选空、查询失败和刷新失败状态完整。
17. 只新增 `006_bookmark_management.sql` 一个 migration。
18. 只新增 `load_bookmark_dashboard` 一个 Tauri Command。
19. 未修改旧 migration。
20. 未改变书签添加、删除和跳转语义。
21. 未修改 PDF 阅读器核心。
22. 未修改其他业务页面行为。
23. 未引入新依赖。
24. 相关 Rust 与 TypeScript 测试通过。
25. TypeScript 类型检查和项目构建通过。
26. 若完整测试受现有工作区改动影响，最终报告准确区分并提供目标验证结果。
