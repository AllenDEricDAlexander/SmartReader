# SmartReader 标签管理 UI 修复设计

## 背景

标签管理功能已经具备看板、工具栏、概览、标签云、表格、详情栏、创建、编辑、删除和合并等能力，但当前页面承载方式与原型不一致。点击左侧“标签管理”后，页面进入独立 `tags` workspace，导致顶部栏、左侧导航和底部状态栏消失，只剩标签管理主体和右侧详情栏，视觉上接近全屏孤岛。

本次目标是修复这个 UI BUG，并在不重写功能的前提下优化标签管理页面结构，使它成为 SmartReader 首页框架中的正式内容页，贴近原型图的整体布局。

## 目标

1. 点击左侧“标签管理”后，保留顶部栏、左侧导航和底部状态栏。
2. 标签管理作为 `HomeDashboard` 的内容页渲染，而不是独立 `tags-mode` 全屏 workspace。
3. 复用已完成的标签管理业务能力，不重写标签后端、持久化或 dashboard 查询能力。
4. 优化标签管理主区、右侧详情栏、工具栏、空态和表格布局，使其更贴近原型。
5. 右侧“标签详情”的关闭按钮只关闭或清空当前详情，不关闭整个标签管理页面。
6. 保持首页、阅读器、设置、最近文件、收藏文件、批注管理、书签管理等既有行为不变。

## 非目标

1. 不新增数据库迁移。
2. 不修改标签 dashboard 的后端统计规则。
3. 不引入新 UI 框架、状态管理库或图表库。
4. 不重做标签管理功能，只调整页面承载关系和必要 UI 细节。
5. 不启动项目运行，完成后由用户自行运行应用验收。

## 推荐方案

采用“标签管理成为 `HomeDashboard` 正式内容页”的方案。

点击左侧“标签管理”时，`ReaderApp` 不再切换到 `workspaceOverride = 'tags'`。它应调用现有首页导航路径，将 `homeSidebarPage` 设置为 `tags`，并清空 `workspaceOverride`，让应用保持在 `activeWorkspace === 'home'`。

`HomeDashboard` 在 `activeSidebarPage === 'tags'` 时渲染标签管理内容。这样标签管理天然位于现有 SmartReader 框架内，顶部栏、左侧导航、底部状态栏、全局搜索和快捷入口都保持一致。

## 架构与组件边界

### ReaderApp

`ReaderApp` 继续维护顶层 workspace 状态、首页侧边栏状态、标签列表状态和持久化 API 注入。

调整点：

1. `onOpenTags` 不再直接 `setWorkspaceOverride('tags')`。
2. `onOpenTags` 改为进入首页侧边栏的 `tags` 页面。
3. 若保留 `AppWorkspace` 中的 `tags` 类型，应仅作为兼容路径；新的主路径从首页内容页进入。

### ReaderWorkspaceSwitch

`ReaderWorkspaceSwitch` 继续负责分发 `home`、`reader`、`settings`、`import`、`compare`、`annotations`、`bookmarks` 等顶层 workspace。

调整点：

1. `HomeDashboard` 接收标签管理需要的 `persistence`、`onTagsChange`、`onOpenDocument` 等能力。
2. 如果保留 `activeWorkspace === 'tags'` 分支，可作为兼容分支，但主流程不再依赖它。

### HomeDashboard

`HomeDashboard` 成为标签管理页面的 shell。

调整点：

1. 新增 `tagsContent` 分支。
2. `activeSidebarPage === 'tags'` 时渲染 `TagManager`。
3. `HomeTopBar`、`HomeSidebar`、`HomeStatusBar` 保持不变。
4. 标签管理内容需要放在 `home-main` 内部，并吃满可用高度。

### TagManager

`TagManager` 继续作为标签管理页面级组件，负责 dashboard 加载、筛选、排序、分页、选中、创建、编辑、删除、合并和刷新。

调整点：

1. 去掉“关闭整个标签管理页面”的职责。
2. 将 `onClose` 语义改为 `onCloseDetail`，或者在调用层把关闭动作限制为清空详情。
3. 右侧详情关闭后，`selectedTagId` 变为 `null`，页面仍停留在标签管理。
4. 用户点击标签云或表格行时，重新设置 `selectedTagId` 并显示详情。

### TagDetailsPanel

`TagDetailsPanel` 只负责展示或清空当前标签详情。

调整点：

1. 关闭按钮只触发当前详情关闭。
2. `detail === null` 时显示“暂无标签详情”的空态。
3. 不触发 workspace 关闭，也不返回首页。

## 状态流

进入标签管理：

1. 用户点击左侧“标签管理”。
2. `ReaderApp.openHomeSidebarPage('tags')` 执行。
3. `workspaceOverride` 清空。
4. `homeSidebarPage` 设置为 `tags`。
5. `activeWorkspace` 保持或回到 `home`。
6. `HomeDashboard` 渲染顶部栏、左侧栏、中间标签管理和底部栏。

加载标签看板：

1. `TagManager` 挂载后调用 `persistence.loadTagDashboard()`。
2. 成功后渲染概览、标签云、表格和详情。
3. 默认选中使用次数最高或第一条标签。
4. 搜索、颜色筛选、排序和分页只影响前端当前视图。
5. 创建、编辑、删除、合并成功后重新加载 dashboard，保持统计一致。

关闭详情：

1. 用户点击右侧详情 `X`。
2. `TagManager` 清空 `selectedTagId`。
3. 右侧栏显示空态。
4. 标签云、表格和工具栏继续可用。
5. 用户再次点击标签云或表格行后恢复详情。

## UI 修复点

### 外框

标签管理页面不再独占全屏。它必须位于 `HomeDashboard` 框架中，保留：

1. 顶部 SmartReader 品牌栏、打开文件按钮、全局搜索和快捷入口。
2. 左侧导航和当前“标签管理”高亮状态。
3. 底部本地模式、缩放、任务状态等状态栏。

### 主内容布局

标签管理内容区使用桌面优先的两列布局：

1. 左侧为主区，包含标题、工具栏、概览、标签云和表格。
2. 右侧为详情栏。
3. 主区和详情栏需要吃满 `home-main` 可用高度。
4. 内容较多时内部滚动，不能把整体页面撑出异常空白。

### 工具栏

工具栏保持原型中的紧凑横向布局：

1. 搜索框优先占据剩余空间。
2. 颜色筛选、排序、清除筛选、创建标签按钮宽度稳定。
3. 颜色筛选避免只展示裸色值，优先展示色点和可读文本。
4. 窄宽度下工具栏可以换行，但不能重叠。

### 空态

无标签时仍保留页面结构：

1. 概览卡显示 0。
2. 标签云显示轻量空态。
3. 表格显示表头和空态。
4. 右侧详情显示“暂无标签详情”。
5. 创建标签按钮保持可用。

### 详情栏

右侧详情栏贴近原型：

1. 顶部显示“标签详情”和关闭按钮。
2. 有选中标签时显示颜色、名称、编辑按钮、统计、描述、代表性文献、文件夹分布、最近活动和整理建议。
3. 无选中标签时显示轻量空态。
4. 关闭按钮只清空详情，不退出标签管理。

## 错误处理

1. `loadTagDashboard` 失败时，标签管理内容区显示错误状态和“重试”，但首页框架不消失。
2. 创建、编辑、删除、合并失败时，保留弹窗和用户输入，并展示错误信息。
3. 删除当前选中标签后，清空详情或按刷新结果选中新的默认标签，不能留下已删除标签的详情。
4. 打开关联文献失败时，复用现有文档打开失败处理，不在标签管理内新增全局错误机制。

## 设计模式考虑

本次任务的核心问题是页面承载边界错误，不是业务规则变化。因此不引入 Strategy、Factory、Command、Decorator 等新抽象。

选择沿用现有 shell/page 结构：

1. `HomeDashboard` 作为首页框架和内容页 facade。
2. `TagManager` 作为标签管理页面组件。
3. `TagDetailsPanel`、`TagTable`、`TagCloudPanel` 等继续作为局部展示组件。

这个选择解决的是“标签管理应该复用首页框架”的真实问题。直接接入现有 `HomeDashboard` 比新增通用 WorkbenchLayout 更小、更安全，也更符合当前代码风格。

## 测试计划

### TypeScript 测试

1. `HomeDashboard.test.tsx`
   - `activeSidebarPage='tags'` 时渲染标签管理页。
   - 顶部栏、左侧栏、底部栏仍存在。
   - 不再回退到“快速开始”首页内容。

2. `ReaderWorkspaceSwitch.test.tsx` 或 `App.test.tsx`
   - 点击“标签管理”后仍在 Home 框架内。
   - “标签管理”侧边栏项保持高亮。
   - 标签管理创建流程仍能调用 `createTag`。

3. `TagManager.test.tsx`
   - dashboard 数据能正常渲染。
   - 详情关闭按钮只清空详情，不卸载标签管理。
   - 搜索、创建和刷新流程保持可用。

### 验证命令

优先运行目标测试：

```bash
bunx vitest run src/home/HomeDashboard.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/tags/TagManager.test.tsx
```

再运行类型检查：

```bash
bun run typecheck
```

如实现涉及 `App.test.tsx` 的集成路径，再补充：

```bash
bunx vitest run src/app/App.test.tsx
```

## 验收清单

1. 标签管理页面显示在原型要求的 SmartReader 主框架内。
2. 顶部栏、左侧栏、底部状态栏均保留。
3. 左侧“标签管理”保持高亮。
4. 标签管理主区和右侧详情栏布局稳定，无大片异常空白。
5. 详情 `X` 只关闭当前详情，不关闭页面。
6. 创建、编辑、删除、合并、筛选、排序、分页继续可用。
7. 无标签时页面结构完整，空态清晰。
8. 不新增迁移，不修改后端统计规则。
9. 相关目标测试和类型检查通过，若有无法验证项需明确说明。
