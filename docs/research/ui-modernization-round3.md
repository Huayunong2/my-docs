# UI 现代化第三轮独立调研

> 调研日期：2026-08-27  
> 范围：页面头部、知识库列表密度、渐进式筛选、可保存视图，以及 React + Tailwind + Radix + TanStack Router 的低风险落地方式。  
> 调研阶段只新增本文件；后续实现记录见第 5 节，代码变更集中在共享页面头部、知识列表密度/筛选和侧栏快捷入口。

## 结论先行

本轮建议把“现代化”收敛成一套小而稳定的交互契约，而不是引入新的完整 UI 框架：

1. **统一 Page Header，但把 `actions` 从一团可换行的 ReactNode，提升为有优先级的 action slot。** 页面头部固定表达“我在哪里、正在看什么、最重要的下一步是什么”；窄容器只保留一个主要动作，其余进入 `更多`/overflow。
2. **知识库只提供两档密度：舒适（默认）和紧凑。** 当前是卡片列表而不是数据表，不建议照搬 Carbon 的四档 row size，也不建议这一轮增加 board、gallery 等新布局。
3. **筛选采用渐进式披露。** 顶部只放搜索、当前高频状态、筛选入口、排序和密度；项目、标签、类型、使用情况、质量检查等通过筛选 Sheet/侧栏分组展开，并始终显示已启用筛选条件和“清除全部”。
4. **保存视图只保存检索语义，不保存瞬时 UI 状态。** 过滤、排序和质量条件属于视图；分页、选中卡片、当前详情、侧边栏展开、密度属于导航或个人偏好。这样既接近 Linear/Notion 的成熟模型，也不会让保存视图变成复杂的布局配置系统。
5. **继续使用当前技术栈。** Tailwind v4 的 container queries 处理 action slot 的容器适配；Radix Dialog/Dropdown Menu/Popover/ Tabs/本地 Sheet 处理焦点和键盘行为；TanStack Router search params 继续作为可刷新、可复制、可后退的筛选状态来源。不建议新增 MUI、Ant Design、另一套 Headless UI 或 ResizeObserver 布局库。

这是一个基于官方设计系统和产品文档的综合判断。文档中标记为“建议阈值”“建议 API”“本仓库取舍”的内容，是结合本仓库现状做出的推论，不是任何一个外部产品的硬性规范。

## 1. 调研方法与本仓库基线

### 1.1 资料选择

只纳入以下类型的一手资料：

- GitHub Primer、IBM Carbon、Microsoft Fluent、Atlassian Design System、Adobe Spectrum 的官方组件/设计指南；
- Linear、Notion 官方产品帮助文档和产品更新；
- Tailwind CSS、Radix UI、TanStack Router 官方文档。

没有使用第三方 UI 评测、博客、聚合文章或仅凭截图推断的规范。外部资料描述了成熟产品的结构和行为，但通常不会规定本项目所需的具体断点、字号或卡片高度，因此具体像素值仍应在实现后用真实窗口尺寸验证。

### 1.2 当前实现观察

| 位置 | 当前能力 | 对本轮的影响 |
| --- | --- | --- |
| [`src/components/ui/PageHeader.tsx`](../../src/components/ui/PageHeader.tsx) | 已有共享头部，支持 `title`、`description`、图标和一个 `actions` ReactNode；动作容器使用 `flex-wrap`。 | 已有可复用 seam，适合增量加 slot；但“所有动作都可换行”没有表达动作优先级，容易产生页面之间高度和折行不一致。 |
| [`src/components/KnowledgePage.tsx`](../../src/components/KnowledgePage.tsx) | 已有状态 Tabs、保存视图、桌面筛选侧栏、移动筛选 Sheet、分页列表、移动端批量操作栏，以及列表/详情模式。 | 本轮重点是重新编排这些能力，而不是重新发明知识库功能。 |
| [`src/components/TodayPage.tsx`](../../src/components/TodayPage.tsx) | 使用独立的每日记录头部；日期切换、保存状态、模板、AI 摘要、提取卡片等动作较多，并且在移动端分多行。 | 是 Page Header 契约的压力测试对象，但不适合和知识库一起做大规模重写，建议后迁移。 |
| [`src/router.tsx`](../../src/router.tsx) | 已使用 TanStack Router；有 `/today`、`/knowledge`、`/knowledge/$cardId`、`/review`、`/stats`、`/search` 等真实路由，并对 `q`、`project`、`tag`、`status`、`type`、`sort`、`usage`、`quality`、`view` 等搜索参数做手动清洗。 | URL 状态基础已经存在。后续应继续集中参数语义，而不是再引入另一套本地筛选状态。 |
| [`src/index.css`](../../src/index.css) | 已有语义色彩、面板、字段、按钮、toolbar 等本地 token/utility。 | 适合增加 header/action/density 的少量语义 token，不适合再叠一套外部设计系统的颜色和 spacing。 |
| [`package.json`](../../package.json) | 已有 React 19、Tailwind CSS 4、Radix Dialog/Dropdown Menu/Popover/Select/Tabs、TanStack Query/Router、Lucide。 | 需求所需的基础积木已经齐全；新增库的收益有限，反而会扩大视觉和无障碍回归面。 |

当前 worktree 在本调研开始前已经存在其他未提交改动。本轮没有清理、覆盖或回滚这些改动；只新增本研究文件。

## 2. 页面头部：从“右侧动作”变成稳定的页面契约

### 2.1 一手资料的共同模式

| 一手资料 | 观察到的模式 | 对本项目可迁移的规则 |
| --- | --- | --- |
| [Primer PageHeader](https://primer.style/product/components/page-header/) 与 [PageHeader guidelines](https://primer.style/product/components/page-header/guidelines/) | Page Header 不只是标题，还组织上下文/导航、标题、描述和动作；窄屏会重新排列这些元素。指南明确区分 context bar、title bar、description 和 contextual navigation，并建议窄屏把次要 trailing action 放到 overflow。 | 头部应有语义区域，而不是所有内容都塞进同一个 `actions` 容器；移动端需要明确的动作降级策略。 |
| [Primer ActionBar](https://primer.style/product/components/action-bar/) | 一组横向 IconButton 通过分隔线形成 action group；空间不够时，不适合继续挤压，而是把不适合显示的项放进 overflow。 | action slot 要知道哪些是主要、次要、更多，而不是无条件 `flex-wrap`。 |
| [Carbon Data Table usage](https://carbondesignsystem.com/components/data-table/usage/) | 数据表 toolbar 承担主按钮、搜索、过滤、显示设置和工具；搜索展开后可以占据标题下方的空间；批量选择后在顶部出现 batch action bar。 | 知识库的列表头部、筛选工具和批量操作应分成不同层级，避免把“页面动作”和“选中项动作”混为一行。 |
| [Carbon Menu buttons](https://carbondesignsystem.com/components/menu-buttons/usage/) | 页面头部多个动作在较小屏幕可以合并为单个 action button；overflow menu 适合较小对象或卡片的附加动作；combo button 适合空间有限但仍需保留一个主要动作的场景。 | 窄容器保留主要动作，把次要动作合并进 `更多`；行级动作不要占用页面头部空间。 |
| [Fluent Toolbar usage](https://fluent2.microsoft.design/components/web/react/core/toolbar/usage) | Toolbar 不应换成第二行；动作过多时使用 overflow utility；动作应按逻辑分组，并将破坏性/状态改变动作与普通动作分开。 | 头部 action slot 默认不换行；折叠应是显式且可预期的，而不是由 flex 布局随机产生。 |
| [Atlassian Page header](https://atlassian.design/components/page-header/) | Page header 的基本职责是定义页面顶部，可组合标题、面包屑、按钮、搜索和过滤器。 | 标题、上下文、页面级工具可以共存，但应有清晰的区域和阅读顺序。 |

### 2.2 统一头部应该固定什么

建议把每个页面头部抽象成下面五个语义区域，实际页面可以省略其中任意区域：

```text
Context      面包屑、父级返回、日期或当前工作区
Title area   图标 + 唯一 h1 + 可选描述/状态
Navigation   页签、视图切换或范围切换
Primary      当前页面最重要的一个动作
Secondary    少量常用但非首要动作
Overflow     不常用、管理型、破坏性或窄屏不宜展示的动作
```

这里的关键不是组件名字，而是阅读顺序和优先级：

- 一个页面保持一个明确的 `h1`；状态徽标、字数、同步状态不应伪装成标题。
- `Primary` 应该是单一、可识别的主任务，例如“新建卡片”“保存”；不要把“筛选”“导出”“设置”等同级堆成多个主按钮。
- `Secondary` 适合少量、频繁且不会破坏当前上下文的动作。
- `Overflow` 适合管理、导入导出、删除、复制链接、显示设置等动作；破坏性动作应在菜单中分隔并要求确认。
- 选择了列表项目后，批量动作应形成独立的 selection/batch bar，而不是偷偷改变普通页面头部的含义。

### 2.3 响应式 action slot 的建议行为

下面的区间是本仓库的实现假设，参考了 Primer/Carbon/Fluent 的“重排或 overflow、不要继续挤压”的原则；它们不是外部设计系统规定的断点。最终应在 320、390、768、1024、1280px 以及侧栏展开/折叠两种状态下验收。

| 头部可用容器宽度 | 标题区 | 动作区 | 规则 |
| --- | --- | --- | --- |
| 宽（建议约 ≥ 720px） | 标题、描述保持左侧；描述最多两行 | 主动作 + 1～3 个次要动作 | 标题与动作左右对齐，动作组不换行。 |
| 中（建议约 480～719px） | 标题优先，描述允许收窄或移到下一行 | 主动作 + 最多一个高频次要动作，其余进入 `更多` | 可以让动作组位于标题下方，但不让每个按钮各自换行。 |
| 窄（建议 < 480px） | 图标、标题、状态先显示；长描述折叠或放到详情 | 一个主动作或“新建”图标按钮 + `更多` | 筛选、视图设置、管理动作进入 Sheet/Dropdown；标题区不被按钮挤压。 |

对于侧边栏场景，应该优先使用 **container query** 而不是只看 viewport breakpoint：同一个页面在侧栏展开和折叠后，可用宽度不同，即使浏览器窗口宽度没有变化。Tailwind 官方文档提供了移动优先的 responsive utilities 和 v4 原生 container queries，适合给头部自身设置命名容器（例如 `page-header`）再根据容器宽度切换布局。[Tailwind responsive design](https://tailwindcss.com/docs/responsive-design)

不建议第一版用 JavaScript 测量每个按钮的实际宽度来决定 overflow。那会引入 ResizeObserver、字体加载、动画和 hydration 时序问题；本项目的动作数量是可控的，CSS 容器查询加明确的优先级足够覆盖第一轮。只有在动作来自插件、用户自定义且数量不可预测时，才值得考虑运行时测量。

### 2.4 针对本仓库的 Page Header 取舍

当前 [`PageHeader.tsx`](../../src/components/ui/PageHeader.tsx) 的 `actions?: ReactNode` 兼容性价值很高，不应一次性改成新的复杂对象协议。低风险方向是：

1. 保留现有 `actions` 入参，新增一个本地 `PageHeaderActions` 小原语，负责渲染 `primary`、`secondary`、`overflow` 三类内容。
2. 逐步给 `PageHeader` 增加可选的 `context`、`navigation` 或 `status` slot；旧页面不提供这些 slot 时，布局不变。
3. 让 `PageHeaderActions` 在宽容器显示显式动作，在中/窄容器只显示主动作和 `更多`；不要把调用方传入的每个按钮都无条件 `flex-wrap`。
4. 继续使用 Lucide 图标，但图标按钮必须有可访问名称；只有图标而无稳定文字的动作使用 `aria-label`，工具提示只作为补充。Radix 的 primitives 负责常见的角色、焦点和键盘处理，但组件使用者仍必须提供正确的 label 和语义。[Radix accessibility overview](https://www.radix-ui.com/primitives/docs/overview/accessibility)
5. `TodayPage` 先不做“全页头部重写”。先迁移知识页、统计、复习、搜索等较简单页面验证契约，再针对每日记录的日期导航、保存状态和编辑动作做第二阶段组合。

建议的调用形态可以类似下面的概念 API；这是设计草案，不是本轮代码：

```tsx
<PageHeader
  context={...}
  icon={BookMarked}
  title="知识工作台"
  description="..."
  navigation={...}
  actions={
    <PageHeaderActions
      primary={...}
      secondary={...}
      overflow={...}
    />
  }
/>
```

这里仍然把 slot 作为 ReactNode，以便页面对动作内容保留控制权；共享原语只负责层级、间距、折叠和无障碍，不负责猜测业务动作。

### 2.5 对当前页面的具体落点

- **知识页**：将状态 Tabs 视为 `navigation` 或 filter summary，不再把一个固定宽度很大的 Tabs 当成普通右侧 action；保存视图条作为头部下方的 compact view bar；新建卡片作为唯一主动作；筛选/排序/显示密度属于列表工具。
- **每日记录**：日期切换属于 `context`/navigation；保存属于主动作；模板、AI 摘要、提取卡片、历史等按频率分为 secondary 和 overflow。移动端只显示日期导航、保存状态/主保存动作及更多入口。
- **复习页**：开始复习/继续复习是主动作；筛选、规则、统计说明是 secondary 或 overflow；复习卡片内的单项操作不能污染页面头部。
- **统计/搜索/历史**：优先迁移到共享头部，验证标题、描述和右侧动作在中等宽度下的收缩行为。

## 3. 知识库列表：密度、渐进式筛选和保存视图

### 3.1 一手资料的共同模式

| 一手资料 | 观察到的模式 | 本项目应吸收的部分 |
| --- | --- | --- |
| [Carbon Data table usage](https://carbondesignsystem.com/components/data-table/usage/) | 提供 tall、normal、short、compact 四档行尺寸；表头应与行尺寸匹配。toolbar 负责全局动作、搜索、过滤、显示设置；选中行后出现 batch action bar。 | 证明“密度是完整的视觉/交互设置”，不能只改 padding；同时应把页面级工具和选中项工具分层。四档不必原样照搬。 |
| [Primer DataTable guidelines](https://www.primer.style/product/components/data-table/guidelines/) | 建议从约 20 行开始验证分页；强调减少不必要列、适应窄屏、避免无意义截断/换行，并允许在窄屏移除低优先级信息或水平滚动。 | 当前每页 24 张卡片属于合理的首版范围，先保留分页；移动端应减少次要元数据，而不是缩小所有字体。 |
| [Notion views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts) | 同一数据库可以有多种视图；视图独立保存布局、属性可见性、筛选、排序、分组；小屏下视图 tab 会收进更多菜单；支持 side peek/center peek/full page。 | 保留当前桌面列表 + 详情、移动列表 + 全屏详情；把“当前视图”和“筛选条件”做成可理解的模型，但不必引入 Notion 的多布局和协作复杂度。 |
| [Notion database properties](https://www.notion.com/help/database-properties) 与 [database performance](https://www.notion.com/en-gb/help/optimize-database-load-times-and-performance?nxtPslug=optimize-database-load-times-and-performance) | 可按视图隐藏属性；可见属性越多，数据库加载和响应可能越慢。 | 把次要卡片元数据从默认展示移到详情/更多信息，既改善密度也控制认知和渲染负担。 |
| [Linear display options](https://linear.app/docs/display-options) | 显示选项与过滤器分开；布局、分组、排序、可见属性可以按视图设置或设为默认。 | “筛选结果是什么”和“结果如何显示”要分开；密度属于 display preference，不应默默改变查询结果。 |
| [Linear custom views](https://linear.app/docs/custom-views) 与 [filters](https://linear.app/docs/filters) | 过滤列表可保存、收藏、复制链接；过滤条件会反映到 URL；视图可以作为持久化入口，但分享不自动扩大权限。 | 当前保存视图可以继续增强为可深链接的检索入口；本项目暂不引入权限、团队分享和复杂收藏体系。 |

### 3.2 明确选择：两档密度，不做四档

知识卡片包含标题、正文摘要、来源、项目、标签、状态和复习信息，阅读成本高于普通任务表格。因此建议：

| 模式 | 默认用途 | 视觉目标 | 建议显示 |
| --- | --- | --- | --- |
| **舒适 Comfortable（默认）** | 阅读、确认、编辑、手机触控 | 保留呼吸感和层次，不让长标题/摘要被挤成难读的细条 | 标题可两行；摘要最多 2～3 行；核心状态、项目/标签和更新时间保留；卡片之间有明显分组间距。 |
| **紧凑 Compact** | 快速扫描、批量选择、处理大量卡片 | 提升单位屏幕的信息量，但不牺牲点击目标 | 标题一行优先；摘要隐藏或一行；次要元数据合并到一行/更多；批量选择和键盘操作仍保持稳定的触控/焦点区域。 |

这两个模式的具体 padding、line-height 和 excerpt 行数应以现有 token 为基础定义，而不是在各卡片上分别写新数值。建议使用诸如 `--knowledge-card-padding`、`--knowledge-excerpt-lines`、`--knowledge-meta-visibility` 的语义层；最终的 CSS class 可以仍然只是 Tailwind utility 的组合。

不建议此轮暴露 Carbon 式四档尺寸：

- 卡片不是表格行，用户很难理解 short/normal/tall/compact 的差别；
- 四档会增加移动端、详情页、批量选择和测试组合；
- 当前最需要解决的是“展开时被挤压”和“筛选可发现性”，不是提供更多微调开关。

密度应该是个人显示偏好，默认可以记在本地设置或用户偏好中；它不应改变 API query key，也不应自动写入保存视图。若未来确实需要分享“同一密度的看板”，再将它提升为 URL 的可选 display 参数。

### 3.3 渐进式筛选方案

建议把现有筛选分成三层，而不是同时展示全部控件：

| 层级 | 始终可见/容易发现的内容 | 本仓库对应 |
| --- | --- | --- |
| 第一层：即时定位 | 搜索、当前状态、筛选入口、排序、视图/密度 | 当前状态 Tabs 可保留，但应与头部 action 分离；搜索和排序位于列表工具区。 |
| 第二层：快速筛选反馈 | 已启用条件的 chips、条件数量、“清除全部” | 项目、标签、类型、使用情况、质量条件选中后，必须在列表上方可见并可单独移除。 |
| 第三层：高级条件 | 分组折叠的项目、标签、类型、使用情况、质量检查 | 桌面侧栏继续支持；移动端放入 Radix Dialog 体系的 Sheet。默认收起低频分组。 |

交互原则：

- 筛选入口显示当前条件数量，例如“筛选 · 3”；没有条件时不要占用大块面板。
- 使用 chips 表达“当前结果为何这样”，避免用户打开 Sheet 才知道筛选仍然生效。
- 桌面侧栏可以保持常驻，但高级分组默认折叠；侧栏展开/收起不应改变 query。
- 移动 Sheet 顶部固定“筛选”“清除全部”“关闭”，底部不被移动导航和安全区遮挡。
- 为保持当前实现的低风险，第一版继续即时写入 URL/查询：选择一个条件后结果立即更新，用户可以继续调整或关闭 Sheet。只有测试显示多条件组合需要“草稿—应用”事务时，再增加本地 draft state 和“应用筛选”按钮；不要一开始同时维护两套筛选真相。
- 不把所有高级过滤改造成 AND/OR 嵌套构建器。Notion/Linear 都支持更丰富的高级过滤，但当前领域模型和界面尚未证明需要它；本项目先保持现有的明确字段筛选。

这也意味着“搜索”和“过滤”需要在视觉上是同一个列表工作区的工具，但语义上仍是两个可独立清除的状态：搜索词清空不应把项目、标签、状态等条件一并抹掉。

### 3.4 保存视图：保存查询语义，分离显示偏好

建议的保存视图模型：

```text
Saved view = name + query filters + sort (+ optional quality conditions)

URL/navigation = q, project, tag, status, type, usage, quality, sort, page,
                 view(list/detail), cardId, optional savedViewId

Personal display preference = density, sidebar collapsed, reduced motion preference
Transient selection = selected card ids, current batch mode, open Sheet
```

具体取舍如下：

1. 当前 [`KnowledgePage.tsx`](../../src/components/KnowledgePage.tsx) 已有服务端保存视图和筛选条件，继续沿用；不把它改造成新数据库模型。
2. 保存视图条应从“大块面板”收敛为列表上方的 compact view bar：显示当前视图名称、条件是否已被修改、保存/另存为，以及管理菜单。
3. 应明确区分三种状态：已保存、当前条件已修改、未命名的临时筛选。修改已保存视图后提供“保存更改”和“另存为”，不要静默覆盖。
4. 当前路由中的 `view` 已表示 `list`/`detail` 展示模式（见 [`src/router.tsx`](../../src/router.tsx)），不要再让它兼任保存视图 ID。若要让命名视图可深链接，后续使用独立的 `savedView`/`savedViewId` 参数，并在打开时从视图加载过滤器。
5. 切换保存视图时应将 `page` 重置为 1；不保存当前页、选中卡片和打开的详情。卡片详情使用 `/knowledge/:cardId` 深链接，返回时保留列表查询参数。
6. 密度、侧边栏展开、移动 Sheet 是否打开属于个人/瞬时状态，不写进保存视图。这样一个视图不会因为用户在手机上打开过筛选 Sheet 而产生脏状态。
7. 本轮不增加共享权限、协作者、视图文件夹、团队默认视图、视图评论或复杂收藏管理。Linear 的官方文档证明这些是成熟产品可以承受的能力，但不是当前知识库 UI 现代化的低风险切片。

当前每页 24 条可以先保留。Primer 用约 20 行作为验证分页的起点，但没有宣称一个通用最佳值；24 与当前卡片高度、批量操作和分页实现相容，应该先通过真实使用和性能数据决定是否调整，而不是借密度改造顺便改变分页策略。[Primer DataTable guidelines](https://www.primer.style/product/components/data-table/guidelines/)

## 4. React + Tailwind + Radix + TanStack Router 的低风险落地

### 4.1 技术选择矩阵

| 问题 | 推荐 | 原因 | 本轮不做 |
| --- | --- | --- | --- |
| Page Header 结构 | 本地 `PageHeader` + `PageHeaderActions` | 已有组件和 token；可以兼容旧调用方，视觉规则集中在一个 seam。 | 不引入 Primer/Carbon/Fluent React 组件包，不同时维护两套设计 token。 |
| 容器响应式 | Tailwind v4 container query + mobile-first utilities | 头部真正受可用容器宽度影响；Tailwind v4 已提供原生 container query 能力。[Tailwind responsive design](https://tailwindcss.com/docs/responsive-design) | 第一版不引入 ResizeObserver 或基于 JS 的“测按钮宽度再折叠”。 |
| 更多/overflow | 现有 Radix Dropdown Menu wrapper | 已有焦点管理、键盘导航、submenu/checkable item/collision 等能力；Radix 支持渐进采用和自定义封装。[Radix Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu) | 不再添加另一套 menu/popover 组件，也不手写键盘 roving focus。 |
| 移动筛选 | 现有本地 Sheet（Radix Dialog 基础） | Dialog 有 focus trap、Esc 关闭、触发器焦点返回和 Title/Description 语义；适合全屏/底部移动筛选。[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) | 不为了筛选再引入第三方 bottom-sheet 库。 |
| 页签/状态导航 | 现有 Radix Tabs | 知识状态切换属于导航/范围，不应与普通按钮混排。 | 不把状态 Tabs 复制成多个 viewport 专用实现。 |
| URL 状态 | TanStack Router `validateSearch` + `useSearch`/navigate | 官方定位是可序列化、可 bookmark/share、刷新和后退不丢失的全局状态；搜索参数可以独立于 pathname 变化。[TanStack Router search params](https://tanstack.com/router/latest/docs/guide/search-params) | 不再新增一套“只存在组件 state 的筛选器”。 |
| 参数类型 | 继续集中现有手动 validator；复杂度显著上升时再接 schema | 当前参数数量可控，`router.tsx` 已有枚举清洗；新增 Zod 会扩大依赖和迁移面。TanStack Router 确实支持 Zod/Valibot/ArkType 等 schema 校验。[TanStack Router validation](https://tanstack.com/router/latest/docs/how-to/validate-search-params) | 本轮不为“看起来更类型安全”而批量重写路由。 |
| 列表数据 | 保持现有 TanStack Query 语义，UI 重构与数据层重构分开 | 头部/密度/筛选是展示契约；混入 query observer/cache 重构会让回归边界扩大。 | 不在同一个切片里重写 KnowledgePage 的请求流程或更换缓存方案。 |

### 4.2 建议的分层边界

```text
Route search params
        ↓  (唯一可分享/可刷新查询状态)
Knowledge query model
        ↓
Knowledge list / selection / detail

PageHeaderActions 只负责动作优先级与响应式呈现
Filter Sheet      只负责编辑 query model
Saved view        只负责保存/恢复 query model
Density preference 只负责显示，不进入 query model
```

最重要的低风险原则是保持 query model 的字段语义稳定。头部改造不应该把 `status` 改名成另一套显示术语，密度切换不应该触发新的卡片 API 请求，保存视图也不应该序列化 React 组件状态。

### 4.3 路由参数的具体建议

TanStack Router 官方把 search params 视作可序列化的全局状态，适用于刷新、复制链接、打开新标签页和浏览器后退。当前仓库已经沿着这条路径实现，因此建议继续做小幅收敛：

- 将 `q`、`project`、`tag`、`status`、`type`、`usage`、`quality`、`sort` 视为检索参数；默认值不要写进 URL，只有非默认值才序列化。
- 将 `page` 视为列表位置；筛选、排序、保存视图变化时归一到 1。
- 将 `view=list|detail` 视为当前显示模式；详情路由用 `$cardId`，不让组件内部 open state 代替 URL。
- 如果要深链接命名保存视图，增加 `savedView` 独立参数；不要复用已有 `view`。
- 让所有筛选入口都通过同一 route navigation helper 修改参数，避免 Sheet、桌面侧栏、chips 各自拼 URL。
- 后续参数变多后，优先抽出 codec/validator 文件或接入一个 schema；当前不需要为了新 Page Header 立即做这件事。

## 5. 本轮实现记录（2026-08-27）

本轮已完成以下低风险切片：

1. 新增 [`src/components/ui/PageHeader.tsx`](../../src/components/ui/PageHeader.tsx)，并迁移知识、复习、统计、搜索、历史、复盘、归档、设置及回收站页面；`TodayPage` 保留其编辑器专用头部。
2. 为 `PageHeader` 增加独立的 `navigation` slot，以及 `PageHeaderActions` 的主/次动作语义。次要动作在头部容器较窄且存在 overflow 替代入口时收起，避免继续依赖无策略的逐按钮换行；没有替代入口的次要动作保持可见。当前使用容器查询而非 JavaScript 测量。
3. 知识列表提供舒适/紧凑两档密度；密度只存为设备展示偏好，不进入查询参数或保存视图。
4. 知识筛选条件存在时自动展开高级筛选区，并在折叠标题旁显示当前条件数量；列表上方同步显示可单独移除的 active filter chips 和“清除全部”。
5. 侧栏增加快速跳转和复习队列摘要入口，并同步统一“今日”命名。

## 6. 分阶段落地顺序

这一节是实现建议，不是本轮实施记录。

### Phase 0：先固定契约和视觉验收尺寸

- 写出 Page Header 的 slot 规则和动作优先级表。
- 确认舒适/紧凑两档卡片的内容可见性。
- 以 320、390、768、1024、1280px，加侧栏展开/折叠，建立截图验收矩阵。
- 先不改变查询参数和后端接口。

### Phase 1：共享头部

- 新增 `PageHeaderActions` 本地原语，保留现有 `PageHeader.actions` 兼容性。
- 用 container query 处理宽/中/窄三种 action slot 状态。
- 先迁移统计、搜索、历史、复习等简单页面。
- 知识页把状态 Tabs、保存视图条、列表工具拆出语义层；新建卡片成为主动作。
- 每个菜单/图标按钮补齐 label、focus-visible 和破坏性操作确认。

### Phase 2：知识列表密度和渐进筛选

- 加入舒适/紧凑显示偏好；只影响显示，不进入 API query key。
- 桌面筛选侧栏的低频组默认折叠；移动 Sheet 保留即时 URL 更新。
- 增加 active filter chips、条件计数和“清除全部”。
- 将列表工具做成 compact toolbar，不再让筛选控件在头部全部展开。

### Phase 3：保存视图体验

- 现有保存视图改为 compact view bar。
- 增加“已修改 / 保存更改 / 另存为”的明确状态。
- 视图切换清除页码并保留可复制 URL；需要命名视图深链时新增 `savedView`，不复用 `view`。
- 只有当使用量证明有必要时，再加入收藏/置顶；暂不做共享权限和视图管理层级。

### Phase 4：每日记录和跨页一致性

- 将每日记录的日期导航、保存、模板和 AI/提取动作映射到统一优先级。
- 检查复习、统计、搜索、知识、每日记录之间的 h1、描述、主动作、更多入口位置是否一致。
- 在真实移动设备和键盘操作下验证 Sheet、Dropdown、返回焦点及安全区。

## 6. 风险、取舍与明确暂缓项

| 方案 | 结论 | 理由 |
| --- | --- | --- |
| 引入 MUI/Ant Design/完整外部 design system | 暂缓 | 会把已有 Tailwind token、Radix 封装、视觉语言和组件 API 同时迁移；对本轮头部和列表问题是过度方案。 |
| 增加一套 Headless UI 或 React Aria 只为 action overflow | 暂缓 | 当前 Radix 已覆盖 menu、dialog、popover、tabs；除非出现 Radix 无法满足的组件语义，否则新增 primitives 只会增加一致性成本。 |
| 所有动作使用 `flex-wrap` | 拒绝 | 不能表达优先级，会造成窄宽度下随机换行和严重挤压；应使用显式 overflow。 |
| JS 测量按钮后自动决定折叠 | 第二阶段再评估 | 真正适合动作数量动态、用户可定制的产品；当前动作集合稳定，CSS container query 更可预测。 |
| 知识库增加 board/gallery/calendar 多布局 | 暂缓 | Notion 的多视图是成熟数据库产品的一整套能力；当前核心问题是卡片阅读、筛选和批量处理，不是缺少布局类型。 |
| 四档或更多密度 | 暂缓 | 信息架构收益小，测试组合大；两档足以验证扫描与阅读的基本差异。 |
| AND/OR 嵌套筛选构建器 | 暂缓 | 会扩大查询 DSL、URL 编码、后端过滤和空状态解释的范围；目前没有足够需求证据。 |
| 保存视图共享、权限、文件夹、协作 | 暂缓 | 这是产品协作模型，不是 UI modernisation 的低风险增量；先做好个人保存和深链。 |

## 7. 验收标准

实现下一轮时，建议至少满足以下可观察标准：

- 页面头部在 320/390/768/1024/1280px 和侧栏两种状态下无水平滚动；主动作始终可见或有明确的 `更多` 入口。
- 同类页面的 h1、描述、主动作、次要动作、overflow 位置和间距一致；页面不会因为动作数量随机换成三四行。
- 移动端筛选 Sheet 不被底部导航或 safe-area 遮挡；打开、关闭、Esc、返回焦点和键盘 Tab 顺序可预测。
- 筛选、排序、列表/详情模式、卡片详情链接刷新后仍能恢复；浏览器后退不会丢失列表查询条件。
- active filter chips 能说明当前结果受哪些条件影响，并可单独移除；“清除全部”不会误删搜索历史、保存视图或卡片数据。
- 舒适/紧凑只改变显示密度，不改变结果数量、排序、query key、批量选中语义和详情内容。
- 保存视图能明确显示已保存/已修改/临时条件；保存视图切换后页码回到 1，选中状态清空。
- 桌面保留列表 + 详情，移动保留列表 + 全屏详情；不因密度改造而增加另一套数据加载路径。
- 图标按钮有可访问名称，菜单项有清晰文字；破坏性动作与普通动作分组，颜色不是唯一的状态表达方式。

## 8. 最终推荐

本仓库下一轮最值得做的不是“再增加几个组件”，而是建立一条从页面头部到列表工具的稳定层级：

```text
Page Header
  ├─ 页面上下文 / h1 / 描述
  ├─ 主动作 + 次要动作 + 更多
  └─ 导航或范围切换

View bar
  ├─ 当前保存视图 / 临时条件状态
  └─ 保存、另存为、管理

List toolbar
  ├─ 搜索 / 状态 / 排序 / 密度
  ├─ active filter chips
  └─ 高级筛选 Sheet/侧栏

Selection bar
  └─ 只在选中卡片时出现的批量动作
```

建议按“共享头部契约 → 两档密度 → 渐进筛选 → 保存视图状态 → 每日记录迁移”的顺序实施。它最大化复用当前已有的 Tailwind、Radix 和 TanStack Router 投资，也把视觉改造、查询语义改造、数据缓存改造拆成可独立回滚的切片。

## 9. 一手资料索引

### 设计系统与组件

- [GitHub Primer PageHeader](https://primer.style/product/components/page-header/)
- [GitHub Primer PageHeader guidelines](https://primer.style/product/components/page-header/guidelines/)
- [GitHub Primer ActionBar](https://primer.style/product/components/action-bar/)
- [GitHub Primer DataTable guidelines](https://www.primer.style/product/components/data-table/guidelines/)
- [IBM Carbon Data table usage](https://carbondesignsystem.com/components/data-table/usage/)
- [IBM Carbon Menu buttons usage](https://carbondesignsystem.com/components/menu-buttons/usage/)
- [Microsoft Fluent Toolbar usage](https://fluent2.microsoft.design/components/web/react/core/toolbar/usage)
- [Atlassian Page header](https://atlassian.design/components/page-header/)
- [Adobe Spectrum Action Group](https://spectrum.adobe.com/page/action-group/)

### 产品/数据库视图

- [Linear Custom views](https://linear.app/docs/custom-views)
- [Linear Display options](https://linear.app/docs/display-options)
- [Linear Filters](https://linear.app/docs/filters)
- [Notion Views, filters & sorts](https://www.notion.com/help/views-filters-and-sorts)
- [Notion Database properties](https://www.notion.com/help/database-properties)
- [Notion Optimize database load times and performance](https://www.notion.com/en-gb/help/optimize-database-load-times-and-performance?nxtPslug=optimize-database-load-times-and-performance)

### 技术栈官方文档

- [Tailwind CSS Responsive design](https://tailwindcss.com/docs/responsive-design)
- [Radix UI Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility)
- [Radix UI Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)
- [Radix UI Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu)
- [TanStack Router Search Params](https://tanstack.com/router/latest/docs/guide/search-params)
- [TanStack Router Validate Search Params](https://tanstack.com/router/latest/docs/how-to/validate-search-params)
