# 移动导航、知识页移动端与 URL 路由调研

> 调研日期：2026-08-26
> 范围：移动底栏与“更多”入口、知识页移动端两级布局、真实 URL 路由与查询参数、Radix/WAI-ARIA/React DayPicker 组件边界。
> 本文件记录实现前的调研依据与方案边界；随后已按限定方案落地到当前工作区。本文不替代代码验收，具体实现以 `src/router.tsx`、`src/components/Sidebar.tsx`、`src/components/KnowledgePage.tsx` 及测试结果为准。

## 1. 结论先行

本轮建议采用以下限定方案：

1. 引入 `@tanstack/react-router`，把页面身份、卡片详情、可分享的搜索/筛选状态放进 URL；继续保留 `@tanstack/react-query` 管理 API 数据缓存，不把 Router cache 当成业务数据缓存。
2. 移动端底栏保留 5 个一级入口：`今日`、`知识`、`复习`、`统计`、`更多`。底栏应使用真正的路由链接和语义化 `nav`，而不是继续用一个本地 `page` 状态切换全部页面。
3. “更多”应是响应式样式的 Radix `Dialog` bottom sheet，里面放历史、归档、复盘、设置、主题等导航链接。不要用 `DropdownMenu` 承担普通页面导航。
4. 移动端知识页拆成两个路由状态：
   - `/knowledge`：卡片列表、搜索与筛选入口、批量选择、新建入口。
   - `/knowledge/:cardId`：全屏卡片详情/编辑。

   桌面端仍可在同一个路由树中渲染项目栏、卡片列表和详情三栏。
5. 移动端搜索和筛选使用 `Dialog` bottom sheet；桌面端需要时使用锚定到工具栏的 `Popover`。单卡或批量操作的溢出菜单使用 `DropdownMenu`。
6. 卡片列表使用语义化的 `ul/li`、路由链接和独立 checkbox；不要把包含链接与 checkbox 的卡片行实现为 ARIA `listbox/option`。WAI-ARIA 明确指出，listbox 的交互模型不适合在 option 内再放链接、按钮或 checkbox。[WAI-ARIA Listbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
7. `React DayPicker` 只负责日期选择和日期状态的视觉 modifier；请假、休息等业务状态仍由外部的单选操作面板处理，不用 DayPicker 的多选模式表达互斥状态。

这套方案保留现有 React、Vite、Tailwind、Radix、TanStack Query 和 React DayPicker，主要改变状态边界和响应式组合方式，不建议为本轮再引入新的 UI 大框架。

## 2. 当前仓库的事实与迁移约束

以下结论来自本地代码检查，而不是外部推测：

- 当前 `package.json` 使用 React 19、Vite、Tailwind 4、`@tanstack/react-query`、`react-day-picker`、Radix primitives，以及本轮补充的 `@tanstack/react-router`；路由实现集中在 `src/router.tsx`，后续仍应沿用“Router 管 URL、Query 管服务端数据、组件状态管临时编辑”的边界。
- `src/App.tsx` 当前用 `useState<Page>` 保存页面，用 `recordTarget`、`searchTarget`、`knowledgeTarget` 这类临时对象跨页面传递目标；刷新后这些状态会丢失，也没有真实的浏览器历史路由。
- `src/components/Sidebar.tsx` 当前移动底栏把 9 个导航项和主题按钮放进 `grid-cols-10`，这是移动端标签被挤压的直接结构原因。
- `src/components/KnowledgePage.tsx` 当前在 `xl` 断点进入三栏布局，`selectedId`、`showFilters` 等关键交互状态仍在组件本地；移动端没有独立的列表路由和详情路由。
- `src/main.tsx` 已有 `QueryClientProvider`。路由迁移时应保留它，并把 QueryClient 通过 Router context 或现有 Provider 复用。
- `server/src/server.rs` 通过 Axum 的 `ServeDir` 作为静态文件 fallback。引入 browser history 后，必须在部署环境验证直接访问 `/knowledge/<id>` 是否能返回 `index.html`；当前代码没有显式展示 SPA history fallback。
- `src/main.tsx` 的 PWA share target 逻辑会用 `replaceState` 清理查询字符串。路由迁移时要先消费 `share-target`，再明确导航到目标路由，不能无条件擦除 Router 需要的 URL 状态。

## 3. TanStack Router 的官方能力与适用边界

### 3.1 为什么适合当前项目

TanStack Router 官方定位包含类型安全导航、嵌套路由和 layout route、路径参数、搜索参数校验、搜索参数导航、预加载和代码分割，并且设计为可以和 TanStack Query 等客户端数据缓存配合使用。[TanStack Router Overview](https://tanstack.com/router/latest/docs/overview)

这与当前项目的需求正好对应：

| 需求 | Router 的承担范围 | 不应由 Router 承担 |
| --- | --- | --- |
| `/knowledge/:cardId` | 路径参数、详情页身份、链接生成 | 卡片内容的 API 缓存与编辑草稿 |
| 项目/标签/状态筛选 | 类型化 search params | 服务器数据查询结果本身 |
| 移动列表到详情 | `Link`、`useNavigate`、后退/前进 | 卡片保存、批量删除事务 |
| 刷新、书签、分享 | 从 URL 恢复页面和筛选状态 | 将卡片正文放进 URL |
| 列表回退 | history 与 scroll restoration | 自行复制一套滚动缓存 |

TanStack 官方的数据加载文档也明确区分了 Router 自带的轻量 route cache 与 TanStack Query：Router cache 适合较少跨路由共享的数据，但没有持久化适配器、跨路由共享缓存、完整 mutation 和 cache-level optimistic update；如果已经知道需要更健壮的数据缓存，应使用 TanStack Query。[TanStack Router Data Loading](https://tanstack.com/router/latest/docs/guide/data-loading)

因此本项目的边界应当是：

> Router 管 URL 与路由生命周期；TanStack Query 管服务器状态；组件本地状态管临时编辑、面板开关和选择过程。

### 3.2 code-based 还是 file-based

TanStack Router 支持 code-based 和 file-based 两种路由配置。官方认为 file-based routing 更适合规模增长、维护和自动代码分割；Vite 使用 file-based routing 时需要 `@tanstack/router-plugin`，并且插件应放在 React 插件之前。[TanStack Router DX Decisions](https://tanstack.com/router/latest/docs/decisions-on-dx)、[TanStack Router Vite Installation](https://tanstack.com/router/latest/docs/installation/with-vite)

对本项目的限定建议：

- 本轮设计以 `@tanstack/react-router` 为唯一候选 Router。
- 如果希望尽量小范围迁移，可以先采用 code-based route tree，把现有页面组件逐个挂到路由上，并继续沿用目前的手动 `lazy`。
- 如果同时准备拆分页面文件、统一 route-level code splitting，直接采用 file-based routing 更适合长期维护；但这会增加 Vite 插件、生成的 route tree 和目录迁移，不应与移动端视觉改造混成一个不可回滚的大改动。
- 无论选哪种方式，都不要继续把所有页面状态集中回 `App.tsx` 的 `page` 字符串；路由应成为页面身份的唯一来源。

### 3.3 browser history、hash history 与静态部署

TanStack Router 默认使用 browser history；官方说明 hash history 适用于服务器不支持把任意路径重写到 `index.html` 的环境。[TanStack Router History Types](https://tanstack.com/router/latest/docs/guide/history-types)

本项目要求使用干净路径 `/knowledge/:cardId`，所以推荐顺序是：

1. 首选 browser history，并为 Axum/静态托管配置 SPA fallback，使非 `/api` 路径回到 `dist/index.html`。
2. 将生产构建后的以下地址作为发布验收项：
   - `/today`
   - `/knowledge`
   - `/knowledge/<existing-card-id>`
   - `/search?q=...`
   - `/stats?month=2026-08`
3. 只有在无法控制静态服务器重写时，才退回 hash history；这会牺牲用户要求的干净深链接，不应作为默认方案。

### 3.4 URL 状态契约

推荐的路由树如下：

```text
root layout
├── /today
├── /knowledge
│   ├── /knowledge/new          （建议保留，用于新建表单）
│   └── /knowledge/:cardId
├── /review
├── /stats
└── /search
```

“更多”里的完整页面不应只是弹层状态。如果历史、归档、复盘、设置仍保留为独立页面，建议也给它们稳定的二级路径，例如 `/history`、`/archive`、`/reviews`、`/settings`；它们不出现在移动一级底栏，但仍可被刷新、后退和分享。

建议的 URL 参数：

| 页面 | 参数 | 说明 |
| --- | --- | --- |
| `/today` | `date=YYYY-MM-DD` | 打开指定日期；缺省为今天 |
| `/knowledge` | `q`、`status`、`type`、`usage` | 搜索词和基础筛选 |
| `/knowledge` | `project`、`tag` | 当前项目/标签；多值时采用稳定、可校验的数组序列化 |
| `/knowledge` | `sort`、`view`、`page` | 排序、列表/其他视图、分页；`page` 可在服务端分页落地时启用 |
| `/knowledge/:cardId` | 同上 | 详情页继承列表上下文，返回列表时恢复筛选 |
| `/review` | `queue` 或 `project` | 只在确实影响复习队列时加入，避免把临时 UI 状态暴露出来 |
| `/stats` | `month=YYYY-MM`、可选 `date=YYYY-MM-DD` | 月历月份和选中日期 |
| `/search` | `q`、`scope`、`dateFrom`、`dateTo` | 全局搜索范围和日期范围 |

不应写入 URL 的状态：

- `filterOpen`、`moreOpen`、`dialogOpen`；这些是临时视觉状态。
- `selectedIds`；选择几十张卡片会制造过长、难分享且容易过期的 URL。
- 编辑草稿、`dirty`、保存中状态、toast、动画状态和内部 `nonce`。
- token、私密内容或完整 Markdown 正文。

TanStack Router 官方支持 JSON-first search params、`validateSearch`、类型推导和组件中的 `useSearch`；官方也建议对非法或意外参数提供合理 fallback，避免一个损坏的 URL 让用户无法进入页面。[TanStack Router Search Params](https://tanstack.com/router/latest/docs/guide/search-params)

实现时应采用以下行为约定：

- `q`、`status`、`project`、`tag`、`sort`、`view` 使用枚举/字符串 schema 校验；非法值回退到默认值。
- 日期统一使用 ISO 格式，不把本地化显示字符串直接放入 URL。
- 搜索词、筛选和排序变化把分页重置到第一页。
- 输入搜索词时使用 debounce，并用 `replace` 避免每个字符制造一条 history；打开卡片、切换页面和提交一组筛选使用正常 push，方便用户后退。
- 默认值可以从 URL 中省略，保持链接短且稳定；TanStack Router 提供 search middleware 处理保留和移除默认值的能力。[TanStack Router Search Params Middleware](https://tanstack.com/router/latest/docs/guide/search-params)

### 3.5 列表详情回退、滚动和未保存编辑

TanStack Router 的 `Link` 会生成真实的 `<a href>`，支持浏览器的打开新标签行为；官方同时提供 `replace`、`resetScroll` 和预加载等 Link/navigation 选项。[TanStack Router Navigation](https://tanstack.com/router/latest/docs/guide/navigation)

因此知识页应遵循：

```text
/knowledge?status=draft&project=FPGA-DIAG
        │ 点击卡片 Link
        ▼
/knowledge/card-123?status=draft&project=FPGA-DIAG
        │ 返回
        ▼
恢复原列表筛选和列表滚动位置
```

知识页当前存在 `main`、卡片列表和桌面三栏内部滚动容器。TanStack Router 提供对多个可滚动区域进行监控、缓存和恢复的 scroll restoration；迁移后必须实测自定义滚动容器，而不能只验证浏览器窗口滚动。[TanStack Router Scroll Restoration](https://tanstack.com/router/latest/docs/guide/scroll-restoration)

当前编辑器有自动保存和 `dirty` 状态。路由迁移不能让点击底栏或系统后退绕过它。TanStack Router 官方提供 `useBlocker`/`Block` 处理未保存表单和 `beforeunload`；建议把已有确认 Dialog 接到路由 blocker 上。[TanStack Router Navigation Blocking](https://tanstack.com/router/latest/docs/guide/navigation-blocking)

## 4. 移动导航的 UI 与无障碍边界

### 4.1 底栏的语义和布局

底栏应使用一个带标签的 `nav` landmark，里面是路由链接；如果页面有多个 navigation landmark，每个应有不同的可访问名称。WAI-ARIA 将 `nav` 作为 navigation landmark，并建议利用 landmark 帮助辅助技术快速定位区域。[WAI-ARIA Landmarks](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/)、[WAI-ARIA Navigation Landmark Example](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/navigation.html)

推荐结构：

```text
移动底栏
├── 今日       -> /today
├── 知识       -> /knowledge
├── 复习       -> /review     （显示到期数 badge）
├── 统计       -> /stats
└── 更多       -> 打开 More Dialog，不直接切换到一个虚构 page
```

设计规则：

- 导航项目使用 router `Link`，让浏览器获得真实 href、当前项状态和后退/前进语义。
- 当前项使用可访问的当前页标记，不只改变颜色；图标旁保留文字，不把图标当成唯一标签。
- `更多` 是一个 button，因为它打开面板而不是直接前往页面；按钮需要清晰的可访问名称和展开状态。
- 底栏不放主题切换、历史、归档等低频功能；主题放进 More Dialog。
- 每个触控目标至少满足 WCAG 2.2 的 24×24 CSS px 最低要求，并建议在本项目移动底栏使用约 44px 高的点击区域，为中文标签和误触留出空间。[WCAG 2.2 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

### 4.2 “更多”为什么用 Dialog，而不是 DropdownMenu

Radix Dialog 被定义为覆盖主窗口并使底层内容 inert 的窗口；它支持受控/非受控模式、焦点陷阱、Esc 关闭，以及用 `Title`/`Description` 向屏幕阅读器宣布内容。[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)

这正好适合移动端 More sheet：内容可能包含分组导航、主题切换、版本信息和设置入口，面板需要有独立滚动区和较大的触控区域。

Radix Dropdown Menu 的定位则是“由按钮触发的一组动作或功能菜单”，并为 menu item 提供 roving tabindex、方向键、typeahead 和 Esc 行为。[Radix Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu) WAI-ARIA 也把 menu button 定义为打开 menu 的按钮，menu 内部使用菜单项键盘模型。[WAI-ARIA Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)

所以限定为：

- More sheet：`Dialog.Root` + `Dialog.Portal` + `Dialog.Overlay` + `Dialog.Content` + 内部语义 `nav`/链接。
- 卡片行“更多”、批量操作溢出菜单、单项操作：`DropdownMenu`。
- 不要把页面导航链接包装成 `DropdownMenu.Item` 后再模拟网站导航；普通导航应保持链接语义。Radix Navigation Menu 文档也特别区分了导航链接与操作系统式的 menu role。[Radix Navigation Menu](https://www.radix-ui.com/primitives/docs/components/navigation-menu)

### 4.3 Dialog bottom sheet 的实现边界

Radix Primitives 官方提供 Dialog，但没有一个独立命名为 `Sheet` 的 primitive；bottom sheet 应是 Dialog Content 的响应式样式，而不是再引入一个重复的弹层系统。[Radix Components](https://www.radix-ui.com/primitives/docs/components)

建议的行为契约：

- 手机：从底部进入，宽度占满，最大高度约为视口高度的 85–90%，正文可滚动，底部操作区固定并包含 safe-area padding。
- 桌面：同一个组件可切换为居中 Dialog，或根据内容量退化为 Popover/普通侧栏。
- 打开后焦点进入面板；关闭后焦点回到触发按钮；Tab 不应跑到背景页面；Esc 关闭。
- 必须提供 `Dialog.Title`；如果视觉设计不需要标题，可以用 visually hidden 方式保留可访问标题。复杂内容可提供 `Dialog.Description`，或按 Dialog 文档的方式显式移除描述引用。
- 筛选面板的“应用”应是明确提交动作；“取消”恢复面板打开前的临时值；关闭手势不应悄悄提交半成品筛选。
- 不应把打开/关闭状态塞进 URL，避免用户分享一个刚好打开了面板的链接。

WAI-ARIA 的 Dialog 模式要求打开时把焦点移入 Dialog、限制 Tab/Shift+Tab 在 Dialog 内循环、Esc 关闭，并为复杂内容选择合适的初始焦点。[WAI-ARIA Dialog Modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

### 4.4 Popover 的适用范围

Radix Popover 是由按钮触发、通过 portal 展示富内容的浮层；支持受控状态、对齐/方向/碰撞处理、焦点管理，并且默认是 non-modal。[Radix Popover](https://www.radix-ui.com/primitives/docs/components/popover)

适合本项目：

- 桌面端工具栏的紧凑筛选。
- 项目/标签选择器。
- 需要保留背景上下文、内容较短的快捷编辑。

不适合本项目：

- 移动端完整的搜索 + 状态 + 项目 + 标签 + 排序表单；它需要 Dialog bottom sheet 的宽度、滚动和模态焦点边界。
- 跨页面的详情内容；卡片详情应是真实 `/knowledge/:cardId` 路由。
- 破坏性批量操作确认；使用现有确认 Dialog/alert dialog 语义。

## 5. 知识页移动端两级布局

### 5.1 列表页 `/knowledge`

手机上只保留一个垂直列表，不再尝试把项目栏、列表和编辑器压缩在同一屏：

```text
知识列表
├── 顶部：标题 + 新建卡片
├── 工具栏：搜索与筛选（打开 Dialog sheet）+ 当前筛选 chip
├── 状态切换：待确认 / 已确认 / 已过时
├── 卡片列表：标题、摘要、状态、项目/标签、复习信息
├── 选择模式：checkbox + 数量
└── 选择后：固定在移动底栏上方的批量操作栏
```

建议：

- 只在列表外显示当前筛选摘要，例如“待确认 · FPGA-DIAG · 12 张”，不要把所有筛选控件常驻挤在首屏。
- `搜索与筛选` button 打开同一个 Dialog sheet；sheet 内的表单值先是临时 draft，点击“应用”后才写入 URL。
- 清除筛选是一个明确按钮；应用后将分页重置为 1。
- 新建卡片推荐使用 `/knowledge/new`，这样新建表单也具备返回、刷新和未保存保护；若暂不增加该路径，至少要明确新建表单是不可深链接的临时状态。
- 卡片条目使用 `li`，标题或摘要区域是 router Link，checkbox 是独立控件；不要把整个 `li` 和 checkbox 一起包进一个 button 或 link。

### 5.2 详情/编辑页 `/knowledge/:cardId`

手机上详情页是全屏编辑器，不显示三栏缩略版：

```text
卡片详情
├── 顶部：返回知识列表 + 卡片标题/保存状态 + 溢出操作
├── 主体：类型、状态、标题、Markdown 内容
├── 元数据：项目、标签、来源、关联卡片
├── 预览/复习信息（按区块折叠）
└── 底部：保存或自动保存状态，不遮挡编辑器
```

- 返回链接保留 `/knowledge` 的 search params；不能回到一个默认空列表。
- 保存状态应区分“未修改、保存中、已保存、保存失败”，不能只靠页面离开时再保存。
- 有未保存变更时，底栏导航、返回、浏览器后退和关闭编辑器都要进入同一个 blocker/确认流程。
- 桌面端 `/knowledge/:cardId` 仍可以渲染三栏工作区；路由身份不变，只切换布局组合。
- 新建、编辑和查看应共享表单组件，但不要共享同一个“移动端面板”状态；路由负责决定是列表还是详情。

### 5.3 批量选择栏

移动端有选择项时，批量栏固定在底栏上方和 safe area 之上：

```text
[已选 3 张] [完成] [移动] [标签] [更多…]
```

- `完成` 退出选择模式；未选择时不要显示空的固定栏。
- 主要动作只保留移动端高频动作；移入项目、移出项目、删除等复杂动作放入 Dialog 或 DropdownMenu。
- 选择范围必须在 UI 中写明“当前列表中的 3 张”，以后有分页时再提供“选择当前页 / 选择全部筛选结果”。
- 删除前必须显示数量和影响范围；完成后提供可撤销反馈，这属于后续批量业务实现，但移动布局应预留位置。
- 当前页面已有选择按钮与 DropdownMenu 批量动作，迁移时应复用动作语义，不要在移动端复制一套不同的状态模型。

### 5.4 为什么不使用 listbox 或 ARIA grid

WAI-ARIA 明确说明，listbox 的 option 名称会被按扁平字符串计算，而且其交互模型不支持在 option 内操作链接、按钮或 checkbox；如果要呈现多个交互元素，应考虑 grid 或更合适的普通文档结构。[WAI-ARIA Listbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)

ARIA grid 可以容纳多个可聚焦控件，但它是 composite widget：只有一个元素进入页面 Tab 序列，作者必须实现方向键、Home/End、焦点移动以及单元格内控件的交互。[WAI-ARIA Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

本项目的卡片列表不是表格，也没有必要为普通移动列表引入方向键网格模型。因此建议使用普通 `ul/li` + 链接 + checkbox。只有未来把知识库做成真正的表格工作区，并愿意完整实现 grid 键盘模型时，才评估 ARIA grid。

## 6. React DayPicker 的相关边界

本轮重点不是重写月历，但 URL 中可能需要日期和日期范围，因此 DayPicker 的职责应提前固定：

- 单个日期（例如 `/today?date=2026-08-26`）使用 DayPicker 的 single selection。
- 日期范围（例如全局搜索的 `dateFrom/dateTo`）使用 range selection。
- DayPicker 官方内置 single、multiple、range 三类选择模式，并通过 `selected` 与 `onSelect` 控制选择结果。[DayPicker Selection Modes](https://daypicker.dev/selections/selection-modes)
- 记录、草稿、豁免、缺失等日期状态用 custom modifiers 改变外观和交互判断；官方支持把自定义 matcher 放进 `modifiers`，并在日期事件中读取 modifier。[DayPicker Custom Modifiers](https://daypicker.dev/guides/custom-modifiers)
- 请假、休息、放假等是一个日期对应一个业务状态，不是“多选日期”问题。日期点选之后再打开外部 Action Sheet/Dialog，用 radio group 或明确的单选按钮选择状态。
- 如果确实要替换 DayPicker 的 `DayButton` 或其他内部组件，必须转发收到的 `aria-*`、`tabIndex`、`ref` 和事件处理器，并尽量组合默认组件，而不是重写焦点管理。[DayPicker Custom Components](https://daypicker.dev/guides/custom-components)
- DayPicker 的月份导航状态若要可分享，可以把 `month=YYYY-MM` 放到 `/stats` URL；面板是否打开、当前 hover 哪一天等仍是本地状态。

## 7. 组件选择矩阵

| 交互 | 推荐组件/语义 | 选择理由 | 明确不要做 |
| --- | --- | --- | --- |
| 移动底栏 | `nav` + TanStack `Link` | 页面导航、真实 href、当前项和浏览器历史 | 用 button + `setPage` 伪造所有页面 |
| 更多入口 | Radix `Dialog`，内容样式为 bottom sheet | 有限底层交互、焦点管理、Esc、复杂分组内容 | 用 DropdownMenu 承担整组页面导航 |
| 移动搜索/筛选 | Radix `Dialog` | 需要大面积表单、滚动、应用/取消和 safe area | 用小 Popover 承载完整移动筛选表单 |
| 桌面快捷筛选 | Radix `Popover` | 锚定触发器、保留背景上下文、碰撞处理 | 让 Popover 变成跨页面详情容器 |
| 卡片/批量溢出操作 | Radix `DropdownMenu` | actions、子菜单、checkbox/radio item、键盘导航 | 把普通链接伪装成 menu item |
| 知识卡片列表 | 原生 `ul/li` + `Link` + checkbox | 一行含多个独立交互目标，文档结构清晰 | 嵌套 interactive element 或伪造 listbox |
| 卡片详情 | 路由页面 `/knowledge/:cardId` | 可刷新、可分享、可后退 | 仅用本地 `selectedId` 或大 Popover |
| 日期选择 | React DayPicker | single/range、modifier、键盘和日期导航 | 用 multiple mode 表达互斥业务状态 |
| 破坏性确认 | 现有 Dialog/alert dialog 语义 | 让用户明确看到范围、取消和确认 | 在 DropdownMenu 点击后直接删除 |

## 8. 推荐的后续实现顺序

本文件不实施代码；后续真正开发时建议按以下可回滚切片进行：

### Slice A：先建立路由壳

- 增加 Router 依赖并定义 primary/secondary routes。
- 让 root layout 同时承载桌面侧栏、移动底栏和 `Outlet`。
- 先把现有页面挂到真实路径，保留现有页面组件，暂不同时重写业务逻辑。
- 配置并验证 browser history 的静态 fallback。
- 为 `/knowledge` 定义 search schema；详情子路由继承列表筛选参数。TanStack Router 官方支持父路由 search params 继承到子路由。[TanStack Router Search Params](https://tanstack.com/router/latest/docs/guide/search-params)

### Slice B：移动导航与弹层原语

- 把移动底栏收敛为 5 项。
- 建立 `MoreSheet`、`KnowledgeFiltersSheet` 两个项目内 Radix wrapper，统一标题、关闭、滚动、safe-area 和焦点规则。
- 将 More 内的页面入口替换为真实链接。
- 保留现有 DropdownMenu，仅用于操作动作。

### Slice C：知识列表/详情分离

- 抽出移动列表与移动详情两个布局组件，桌面继续共享三栏布局。
- 卡片点击改为 Link，打开详情时保留 search params。
- 新建表单采用 `/knowledge/new` 或明确记录其非深链接边界。
- 把批量栏做成固定布局，确保不覆盖底栏、编辑器或 safe area。

### Slice D：恢复与可访问性验收

- 直接刷新所有 primary routes 和现有 card detail route。
- 测试浏览器后退：详情 → 列表时筛选、搜索词和滚动位置保持。
- 测试 Dialog：打开焦点、Tab 循环、Esc、点击外部、关闭后焦点回到触发器。
- 测试非法 query、缺失卡片 ID、新建路由和过期项目/标签。
- 测试 390×844、768×1024、1280px 以上窗口，以及键盘和 200% 缩放。
- 测试卡片行中 Link、checkbox、溢出菜单互不嵌套，不能因为点击 checkbox 而误打开详情。

## 9. 本轮不做的决定

- 不迁移到 Next.js、MUI 或另一个完整设计系统。
- 不在本轮引入新的底部抽屉库；Radix Dialog + 本地响应式样式已经覆盖需求。
- 不把筛选面板的打开状态、批量选择状态和编辑正文放到 URL。
- 不把知识详情做成 route masking 或仅视觉上的 modal；第一版优先保证真实可刷新 URL。
- 不在本轮重写整个日历；只固定 DayPicker 的日期选择与业务状态分层。
- 不以 ARIA grid/listbox 替代普通卡片列表，除非未来确实做成表格型数据工作区。

## 10. 官方来源索引

### TanStack Router

- [Overview](https://tanstack.com/router/latest/docs/overview)
- [Navigation](https://tanstack.com/router/latest/docs/guide/navigation)
- [Search Params](https://tanstack.com/router/latest/docs/guide/search-params)
- [How to Navigate with Search Parameters](https://tanstack.com/router/latest/docs/how-to/navigate-with-search-params)
- [History Types](https://tanstack.com/router/latest/docs/guide/history-types)
- [Scroll Restoration](https://tanstack.com/router/latest/docs/guide/scroll-restoration)
- [Navigation Blocking](https://tanstack.com/router/latest/docs/guide/navigation-blocking)
- [Data Loading](https://tanstack.com/router/latest/docs/guide/data-loading)
- [TanStack Query Integration](https://tanstack.com/router/latest/docs/integrations/query)
- [Decisions on Developer Experience](https://tanstack.com/router/latest/docs/decisions-on-dx)
- [Installation with Vite](https://tanstack.com/router/latest/docs/installation/with-vite)

### Radix Primitives

- [Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)
- [Popover](https://www.radix-ui.com/primitives/docs/components/popover)
- [Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu)
- [Navigation Menu](https://www.radix-ui.com/primitives/docs/components/navigation-menu)
- [Components index](https://www.radix-ui.com/primitives/docs/components)

### WAI-ARIA / WCAG

- [Landmarks Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/)
- [Navigation Landmark Example](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/navigation.html)
- [Dialog Modal Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Menu Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)
- [Listbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
- [Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- [WCAG 2.2 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

### React DayPicker

- [Selection Modes](https://daypicker.dev/selections/selection-modes)
- [Custom Modifiers](https://daypicker.dev/guides/custom-modifiers)
- [Custom Components](https://daypicker.dev/guides/custom-components)
