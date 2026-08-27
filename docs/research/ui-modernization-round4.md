# UI 现代化第四轮：颜色、选择反馈、侧栏与轻量动效

- 调研日期：2026-08-27
- 调研范围：语义化颜色 token 与深色主题层级、列表选中/批量操作反馈、侧栏 active/折叠/移动端抽屉、`reduced-motion` 与轻量过渡
- 调研原则：优先官方设计系统、组件文档和 Web 标准；每条关键结论附直接来源链接
- 本轮状态：调研完成，并已落地 P1 选择反馈、P2 侧栏分组细节和 P3 动效偏好；颜色 token 的全量迁移仍按后续路线推进。
- 当前技术栈：React 19、Tailwind CSS v4、Radix React wrappers、Lucide、Framer Motion、TanStack Router/Query、Sonner

## 结论先行

本仓库已经具备完成这一轮现代化所需的组件积木，不建议再引入 Material UI、Ant Design、完整 Carbon React 或另一套 Headless UI。低风险路线是继续维护本地小型设计层，并把现有样式逐步收敛到以下四条契约：

1. **颜色按语义和层级消费，不按具体组件消费。** 页面使用 `canvas / surface / raised / selected / border / text / status` 等角色，浅色和深色只替换角色值；深色浮层通常应比画布更亮一级，而不是更暗。Radix Colors 将色阶 1–12 分别对应背景、组件背景、hover、selected、边框、focus、solid background 和文字用途；其 aliasing 指南也明确建议使用语义别名和可随主题变化的 mutable alias。[Radix Colors：Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)、[Radix Colors：Aliasing](https://www.radix-ui.com/colors/docs/overview/aliasing)、[Carbon：Color layering model](https://carbondesignsystem.com/elements/color/overview/)
2. **选中状态必须同时有可感知的状态、焦点和操作反馈。** 保留原生 checkbox 与三态“全选”，再用 selected surface、边缘指示和文字/图标强调表达选中；批量操作进入独立 toolbar，批量模式下不要继续展示会产生歧义的行级动作。Carbon 明确规定了 indeterminate select-all、批量 action bar 和批量模式下禁用行级操作；Material 也把状态视为可组合且应使用多个视觉指标的交互层。[Carbon：Data table usage](https://carbondesignsystem.com/components/data-table/usage/)、[Material 3：States](https://m3.material.io/foundations/interaction/states/overview)
3. **侧栏是应用 shell，不是一个无限增长的菜单。** 固定 header、可滚动 content、固定 footer；active 页面有 `aria-current="page"` 和稳定指示；桌面可折叠为 icon rail，移动端使用带焦点管理的 modal drawer/Sheet。shadcn Sidebar 把这些区域、可控开合、icon/offcanvas 模式和 keyboard shortcut 作为同一组合；Fluent Nav/Drawer 进一步要求活动父级可感知、动作不能只存在于 hover、抽屉 body 独立滚动。[shadcn/ui：Sidebar](https://ui.shadcn.com/docs/components/base/sidebar)、[Fluent Nav](https://fluent2.microsoft.design/components/web/react/core/nav/usage)、[Fluent Drawer](https://fluent2.microsoft.design/components/web/react/core/drawer/usage)、[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)
4. **动效只用来解释状态变化，不用来装饰每次渲染。** 默认用短时、局部的 opacity/color/小位移；`prefers-reduced-motion: reduce` 时取消大面积 transform/layout motion，保留不会造成不适的 opacity 或即时状态反馈。当前 Framer Motion 已提供全局 `MotionConfig reducedMotion="user"` 和局部 `useReducedMotion`，Tailwind 也提供 `motion-safe`/`motion-reduce`，无需增加动效库。[Primer：Motion and animation](https://primer.style/accessibility/design-guidance/motion-and-animation/)、[Motion for React：Accessibility](https://motion.dev/docs/react-accessibility)、[Tailwind：Transition property](https://tailwindcss.com/docs/transition-property)、[W3C：`prefers-reduced-motion`](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion)

## 1. 语义化颜色 token 与深色主题层级

### 1.1 一手资料得到的设计规则

#### Radix Colors：用色阶用途和 alias 分离“值”与“角色”

Radix Colors 的色阶不是单纯从浅到深的装饰色，而是针对 UI 用途设计的 12 个步骤：

| Radix 用途 | 对当前产品的对应场景 | 关键来源 |
| --- | --- | --- |
| App background / subtle background | 应用画布、侧栏、空白区域 | [Steps 1–2](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale#steps-1-2-backgrounds) |
| UI element / hover / active-selected background | 普通卡片、hover 卡片、选中的知识卡片或导航项 | [Steps 3–5](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale#steps-3-5-component-backgrounds) |
| Subtle border / component border / focus ring | 分隔线、控件边框、键盘焦点 | [Steps 6–8](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale#steps-6-8-borders) |
| Solid / solid hover background | 主按钮、强调徽标、已确认等强动作 | [Steps 9–10](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale#steps-9-10-solid-backgrounds) |
| Low/high contrast text | 辅助文字、正文和高对比文字 | [Steps 11–12](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale#steps-11-12-text) |

Radix 的 aliasing 指南建议将 `accent`、`success`、`warning`、`danger` 等语义别名映射到色阶，而不是让组件直接依赖 `blue-9` 或 `red-9`。同一个色阶也可能同时承担不同语义，因此“warning”和“pending”可以共享色值，但应该拥有不同语义 alias。[Radix Colors：Semantic aliases](https://www.radix-ui.com/colors/docs/overview/aliasing#semantic-aliases)

它还提出 mutable alias：浅色模式和深色模式可以将同一个 `--panel`、`--shadow`、`--overlay` 角色映射到不同值。指南给出的例子是浅色 panel 使用白色、深色 panel 使用灰色阶；阴影和 overlay 也应随主题改变，而不是只把同一组 rgba 反转。[Radix Colors：Mutable aliases](https://www.radix-ui.com/colors/docs/overview/aliasing#mutable-aliases)

**关键结论：** token 名称应该表达“它在界面中的作用”，而不是表达“它现在是什么颜色”或“它属于哪个组件”。`--ui-surface-raised` 比 `--card-bg` 更容易跨页面复用，也更容易在主题重做时整体替换。

#### Carbon：深色层级通过“逐层变亮”建立空间，而不是靠大量阴影

Carbon 将颜色分成 role-based token 与 theme value：role 在所有主题中保持不变，具体颜色值由主题提供。它把背景、layer、field、border、text、support、focus、skeleton 等作为跨组件的 core token，并将 hover、active、selected、focus 等作为交互状态 token。[Carbon：Implementing color and core tokens](https://carbondesignsystem.com/elements/color/overview/)

Carbon 的 layering model 有一个对本项目很重要的结论：

- 浅色主题通过白色与浅灰层交替建立不同层级；
- 深色主题中，每进入一层，背景通常向更亮的灰色移动；
- 不应把比深色全局背景更暗的组件大量叠在上面，除非是刻意的高对比模式；
- 选中状态除了改变背景，也应让文字或图标从 secondary 提升为 primary；focus 通常使用统一的 2px focus token，并满足非文本焦点对比度要求。[Carbon：Layering model](https://carbondesignsystem.com/elements/color/overview/)、[Carbon：Selected and focus states](https://carbondesignsystem.com/elements/color/overview/#selected)、[Carbon：Accessibility](https://carbondesignsystem.com/elements/color/overview/#accessibility)

**关键结论：** 深色模式的“高级感”主要来自稳定的表面层级和对比度，而不是把所有卡片都做成半透明黑色、再叠加更重的阴影。

#### Primer：功能 token 需要覆盖前景、背景、状态和主题模式

Primer 的颜色原语将前景和背景拆成可复用 CSS 变量，例如 `--fgColor-default`、`--fgColor-muted`、`--fgColor-danger`、`--bgColor-default`、`--bgColor-muted`、`--bgColor-inset` 和状态 emphasis/muted 变量。它还将 light/dark/high-contrast/colorblind 等主题作为独立主题文件，通过高层 data attributes 切换。[Primer：Color primitives](https://primer.style/product/primitives/color/)、[Primer：Primitives and theming](https://primer.style/product/primitives/)

**关键结论：** 当前项目不需要照搬 Primer 的 token 名称，但可以吸收其“前景/背景/状态/主题是平行维度”的建模方式；不能只准备一组 `text-gray-*` 和一组 `bg-*`。

### 1.2 当前仓库基线与风险点

当前 [`src/index.css`](../../src/index.css) 已有 `--ui-canvas`、`--ui-surface`、`--ui-surface-subtle`、`--ui-surface-soft`、`--ui-border`、`--ui-border-strong`、`--ui-text`、`--ui-text-muted`、`--ui-text-subtle`、`--ui-sidebar-surface` 等语义变量，并且已经有 `.dark` 值。这是正确的 seam，不建议替换成另一套完整主题库。

仍然存在的下一轮风险是：

- 部分页面和组件继续直接使用 `bg-white`、`bg-gray-*`、`text-gray-*`、`border-gray-*`，同一语义在浅色和深色中由不同组件自行解释；
- `--ui-surface` 与 `--ui-surface-soft` 已能表达两层表面，但“浮层/选中/hover/禁用/focus”尚未形成完整、可检查的角色矩阵；
- `--color-accent-light` 既用于背景 tint，也在部分地方承担 selected 或 focus 的含义，未来切换强调色时可能出现对比度不一致；
- `glass` 当前已经收敛为安静的侧栏背景，但 translucent surface、backdrop blur 与 overlay 仍应有统一角色，不应由每个 Dialog/Sheet 重新写 rgba。

这些是静态代码基线观察，不代表本轮已经修改或验证了视觉结果。

### 1.3 适合当前技术栈的 token 草案

建议保留现有 `--ui-*` 名称作为兼容层，下一轮只补充缺失角色，并逐步将硬编码 utility 迁移过去：

| 角色组 | 建议 token | 使用范围 | 主题切换原则 |
| --- | --- | --- | --- |
| Canvas | `--ui-canvas` | 应用主背景、列表空白区 | 深色为最底层；不要让内容区比 canvas 更暗一大截 |
| Surface | `--ui-surface` | 普通面板、编辑器、输入框 | 浅色接近白色；深色比 canvas 略亮 |
| Raised | `--ui-surface-raised` | Dialog、Sheet、Dropdown、浮层 | 两种主题都要与所在层形成边界；深色通常再亮一级 |
| Soft/inset | `--ui-surface-soft`、`--ui-surface-inset` | 工具栏、输入区、次级信息块 | 只表达容器分组，不冒充 selected |
| Hover | `--ui-surface-hover` | 可交互项 hover | 与 selected 分开，避免 pointer 离开后仍像选中 |
| Selected | `--ui-surface-selected`、`--ui-selected-marker` | 知识卡片多选、导航 active | 背景 + marker + 前景强调，不能只依靠颜色 |
| Border | `--ui-border-subtle`、`--ui-border`、`--ui-border-strong` | 分隔、默认边界、强调边界 | 深色不靠黑色 border；使用低透明白或对应灰阶 |
| Focus | `--ui-focus`、可选 `--ui-focus-inset` | 键盘/语音焦点 | 独立于 accent，确保在所有 surface 上可辨识 |
| Text | `--ui-text`、`--ui-text-muted`、`--ui-text-subtle`、`--ui-text-disabled` | 标题、正文、辅助、禁用 | 禁用是交互不可用，不要拿过低对比度的普通辅助色代替 |
| Action | `--ui-action`、`--ui-action-hover`、`--ui-on-action` | 主按钮、链接、强调控件 | 由 accent theme 提供值，角色名不随 violet/blue 改变 |
| Status | `--ui-success-*`、`--ui-warning-*`、`--ui-danger-*`、`--ui-info-*` | 状态 badge、提示、错误、批量结果 | 同一语义至少有 bg/border/text/solid 四个角色 |
| Overlay/shadow | `--ui-overlay`、`--ui-shadow-panel`、`--ui-shadow-raised` | 遮罩、面板、浮层 | 深色阴影趋向黑色；遮罩不应让底层仍可误操作 |

这里的 token 名称是本仓库的实现建议，不是外部系统的硬性命名。Carbon 的 role/value 分离和 Radix 的 mutable alias 是这套草案的依据。[Carbon：Tokens and themes](https://carbondesignsystem.com/elements/color/overview/#implementing-color)、[Radix Colors：Mutable aliases](https://www.radix-ui.com/colors/docs/overview/aliasing#mutable-aliases)

### 1.4 推荐的深色主题层级

后续实现时建议把深色 UI 明确成四级，先解决层级，再调色相：

```text
canvas       页面与侧栏底色
surface      普通卡片、编辑器、输入框
raised       Sheet、Dialog、Dropdown、浮动批量栏
emphasis     主按钮、选中 marker、危险确认等局部高对比区域
```

建议规则：

- 普通卡片不再普遍使用比 canvas 更黑的背景；
- `raised` 通过更亮表面、边框和有限阴影建立位置，不用过强 blur；
- selected 与 hover 不共享完全相同的背景；selected 至少再有边缘 marker 或前景强调；
- status 色使用“语义色 + 文字/图标/形状”三重表达，避免红/绿成为唯一信息；
- focus 使用固定、可审计的角色，不能因某个页面的背景色变化而消失；
- 颜色审查应以最终合成后的背景为准。Carbon 给出的参考是小文字至少 4.5:1、图形和 focus 通常至少 3:1；最终应按项目的目标 WCAG 版本复核，而不是只看 token 的 hex 值。[Carbon：Contrast ratios](https://carbondesignsystem.com/elements/color/overview/#contrast-ratios)

### 1.5 低风险实现顺序

1. 先补齐角色和浅/深值，不改调用方；保留旧变量作为 alias。
2. 先迁移共享 primitive：`.ui-panel`、`.ui-field`、`.ui-button-*`、`.ui-toolbar`、`.ui-chip`、Sheet/Dialog surface。
3. 再迁移 Sidebar、Knowledge row、批量 toolbar 和空/错/成功状态。
4. 最后处理页面中散落的 `bg-white`/`dark:bg-*`；每次只迁移一个组件族，避免大面积视觉回归。
5. 用 light/dark × accent themes × focus/selected/disabled 状态做对比度检查。

不建议在这个阶段安装 `@radix-ui/colors` 或 Primer primitives 作为运行时依赖。它们适合作为色彩和 token 设计参考；当前本地 CSS 变量已经能承载运行时主题，新增一套 token 文件会增加命名和迁移成本。

## 2. 列表选中与批量操作反馈

### 2.1 一手资料得到的交互规则

#### Carbon Data Table：选择、批量栏和行级动作必须分层

Carbon 的官方 Data Table 文档提供了最接近当前知识卡片列表的完整行为模型：

- selectable table 使用 checkbox 支持多选；
- 表头“全选”有 checked、unchecked、indeterminate 三态；
- 一旦选中项目，批量 action bar 出现在列表工具栏位置；
- 批量模式下，单行 action icon 和 overflow menu 应禁用，避免用户同时面对两套操作上下文；
- 行级 action 数量少时可内联，多时进入 overflow；触摸设备即使启用了 hover-only 配置，也应保留 overflow 入口；
- 预期有等待时优先使用 skeleton，而不是只显示 spinner。[Carbon：Selectable](https://carbondesignsystem.com/components/data-table/usage/#selectable)、[Carbon：Batch actions](https://carbondesignsystem.com/components/data-table/usage/#batch-actions)、[Carbon：Inline and overflow actions](https://carbondesignsystem.com/components/data-table/usage/#inline-actions)

Carbon 的 Color 文档又补充了 selected 与 focus 的视觉原则：selected 应有独立 selected token，并通常同时提升文字/图标前景；focus 应是所有可交互元素都有的 2px 级别可辨识边界。[Carbon：Selected state](https://carbondesignsystem.com/elements/color/overview/#selected)、[Carbon：Focus state](https://carbondesignsystem.com/elements/color/overview/#focus)

#### Material 3：状态可组合，并且需要多个视觉指标

Material 3 将 enabled、disabled、hover、focused、pressed、dragged 等作为组件状态，并明确指出状态可以组合、应一致应用；其状态页强调需要两个视觉指标来保证可访问性。[Material 3：States](https://m3.material.io/foundations/interaction/states/overview)

**关键结论：** 知识卡片的“当前详情卡片”和“批量选中卡片”必须是两个状态维度。一个卡片可以同时是 `selected + active`，不能让后一个状态覆盖前一个状态，也不能只用一个紫色背景表示所有含义。

#### Primer ActionBar：空间不足时进入 overflow，不让 action 自由换行

Primer ActionBar 将动作按组排列，空间不足时将放不下的按钮移入 overflow；分组分隔线在 overflow 中保留。[Primer：ActionBar](https://primer.style/product/components/action-bar/)

**关键结论：** 批量工具栏和页面头部都应显式表达 primary/secondary/overflow 优先级。`flex-wrap` 可以作为最后的布局保护，但不能成为操作编排策略。

### 2.2 当前 KnowledgePage 已有的基础

当前 [`src/components/KnowledgePage.tsx`](../../src/components/KnowledgePage.tsx) 已经有不少正确选择：

- 行内使用原生 checkbox；
- 表头支持三态选择和“全选当前列表”；
- 通过 `data-state="selected"`、`active`、`idle` 区分列表行视觉状态；
- 选中后出现独立的 batch toolbar；
- 桌面端使用 DropdownMenu 收纳批量动作，移动端使用 Sheet；
- 移动端 toolbar 位于底部导航和 safe-area 之上；
- 会显示不可见选择数量，并允许清除不可见项；
- 服务端操作完成后使用成功/失败反馈。

本轮不需要重新发明选择模型，重点是把这些状态变成稳定的视觉和无障碍契约。

### 2.3 建议的状态矩阵

| 状态 | 必须表达的含义 | 推荐视觉 | 推荐行为/语义 |
| --- | --- | --- | --- |
| Idle | 可选择、未聚焦 | 普通 surface；hover 仅轻微改变 surface/border | 行级 overflow 不抢占标题空间 |
| Hover | pointer 位于可操作对象上 | surface-hover 或 border-hover | 不改变 selected/active 的含义 |
| Focus | 键盘、语音或辅助输入当前焦点 | 2px focus ring 或 inset focus ring | 不依赖 hover；focus-visible 可见 |
| Active detail | 当前正在右侧/全屏查看的卡片 | 细左侧 marker + subdued surface | 与 selected marker 形状或位置区分 |
| Selected | 将参与批量操作 | checkbox checked + selected surface + marker + 前景强调 | 不用颜色作为唯一信号 |
| Selected + active | 当前查看且已加入批量集合 | 同时保留 selected marker 和 active marker，或合并成双层边界 | 测试两种主题下仍可辨认 |
| Pending | 批量请求正在执行 | toolbar 主按钮 loading/disabled；列表不闪烁 | 保持已选数量和目标范围可读，必要时 `aria-busy` |
| Succeeded | 请求完成 | 一条带数量的成功 Toast/状态消息，列表更新 | 说明“处理了几张”，不只写“成功” |
| Failed | 部分或全部失败 | 错误消息说明范围，并保留重试/取消路径 | 不清空选择，避免用户失去恢复入口 |

这张矩阵中的“surface + marker + 前景”是对 Carbon selected/focus 规则和 Material 多指标状态原则的综合应用。[Carbon：Interaction states](https://carbondesignsystem.com/elements/color/overview/#interaction-states)、[Material 3：States](https://m3.material.io/foundations/interaction/states/overview)

### 2.4 批量 toolbar 的信息架构

建议将 batch toolbar 固定为四个区域，而不是继续让动作自然挤压：

```text
Scope      已选 N 张 · 当前列表 / 当前筛选结果
Primary    高频且低风险动作，例如确认
Overflow   标签、加入/移动项目、移出项目、删除
Exit       清空选择 / 取消
```

#### 桌面端

- 放在列表工具区下方或列表顶部 sticky 位置；
- 保持一个明确的主动作，其余动作进入 DropdownMenu/overflow；
- 批量栏出现后，行级按钮不再与 batch action 同时可操作；
- “全选当前列表”和“选择当前筛选结果的全部卡片”必须使用不同文案，避免用户误以为已选中分页之外的记录。

#### 移动端

- 当前固定底部的方案可以保留，但必须持续位于 bottom navigation 和 safe-area 之上；
- 默认展示已选数量、一个主动作、`更多`、清空；项目/标签/删除放入 Sheet 或菜单；
- Sheet 内的动作应有清晰标题和可滚动 body；执行后关闭 Sheet，但不要无条件清除失败操作的选择；
- 选择数量、当前范围和危险操作确认在窄屏不得被折叠到用户看不到的地方。

这与 Carbon “batch bar 独立出现”及 Primer “空间不足进入 overflow”的原则一致，但移动端固定底部是本项目为触控场景做的布局适配，不是 Carbon 的强制位置规范。[Carbon：Batch actions](https://carbondesignsystem.com/components/data-table/usage/#batch-actions)、[Primer：ActionBar overflow](https://primer.style/product/components/action-bar/)

### 2.5 低风险实现建议

1. **保留原生 checkbox 和现有三态实现。** 不要把选择改成仅依赖 `aria-selected` 的自定义 div；如果未来引入 listbox/grid 语义，再按对应 WAI-ARIA pattern 重新建模。现在原生 checkbox 对多选最直接。
2. **把现有 `data-state` 变成 token 驱动的视觉层。** 增加 selected/hover/focus 的语义 class，避免在每一行继续拼 `bg-accent-light`、`dark:bg-*`。
3. **把 scope 作为显式状态。** 当前“当前列表”和不可见选择提示已经是基础；下一步应明确区分“本页可见集合”和“当前查询结果全集”，在跨页全选时再引入确认 banner，而不是悄悄扩大选择范围。
4. **维持页面级 action 与选择级 action 分离。** PageHeader 只负责页面动作，batch toolbar 只负责选中项；不要因为选中卡片就重排全局导航。
5. **用现有 Radix DropdownMenu/Sheet。** 它们已经在仓库中，能提供键盘导航、焦点管理和 escape 行为；不增加新的表格/批量操作库。[Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility)
6. **反馈带数量和结果。** 成功消息使用“已移动 8 张卡片”而非“操作成功”；部分失败时保留选择并展示重试。当前项目已有软删除/恢复能力，删除成功后可以进一步把 Sonner action 接到恢复动作，但这是后续实现项。
7. **行级动作使用渐进展示。** 常用且仅一个的动作可保留 inline；复制、移动、删除等低频动作进入 overflow；触摸设备不能把关键动作只隐藏在 hover 中。[Carbon：Inline actions](https://carbondesignsystem.com/components/data-table/usage/#inline-actions)、[Primer：DataTable row actions](https://primer.style/product/components/data-table/)

## 3. 侧栏 active、折叠与移动端抽屉

### 3.1 一手资料得到的结构和行为

#### shadcn Sidebar：固定区、滚动区和折叠模型

shadcn 官方 Sidebar 不是一个单体黑盒，而是由 `SidebarHeader`、可滚动的 `SidebarContent`、`SidebarGroup`/`SidebarMenu`、`SidebarFooter`、`SidebarRail` 和 `SidebarTrigger` 组合。它支持 controlled `open/onOpenChange`、`collapsible="offcanvas" | "icon" | "none"`，并提供 `cmd+b`/`ctrl+b` 快捷键。[shadcn/ui：Sidebar structure](https://ui.shadcn.com/docs/components/base/sidebar#structure)、[shadcn/ui：Sidebar state and modes](https://ui.shadcn.com/docs/components/base/sidebar#sidebar)、[shadcn/ui：useSidebar](https://ui.shadcn.com/docs/components/base/sidebar#usesidebar)

shadcn 还建议用 `isActive` 表示菜单当前项、用 `Collapsible` 包装可折叠分组，并提供 sidebar rail 作为调整/触发区域。[shadcn/ui：SidebarMenuButton](https://ui.shadcn.com/docs/components/base/sidebar#sidebarmenubutton)、[shadcn/ui：Collapsible groups](https://ui.shadcn.com/docs/components/base/sidebar#sidebargroup)、[shadcn/ui：Sidebar rail](https://ui.shadcn.com/docs/components/base/sidebar#structure)

**关键结论：** 当前自有 Sidebar 可以继续保留；应该吸收它的区域边界和状态契约，而不是为了“现代化”替换整个实现。

#### Fluent Nav：active 要在父级折叠时仍可见，动作不能只存在于 hover

Fluent Nav 要求 selection indicator 让用户一眼知道当前页面；当活动子项所在的分类已折叠时，selection indicator 应转移到分类上。它建议导航最多保持两级层级、每个导航节点通常只放一个 secondary action，并且 hover-only action 必须始终存在于 DOM，否则触摸读屏和虚拟光标用户无法访问。[Fluent Nav：Selection](https://fluent2.microsoft.design/components/web/react/core/nav/usage#selection)、[Fluent Nav：Secondary actions](https://fluent2.microsoft.design/components/web/react/core/nav/usage#secondary-actions)、[Fluent Nav：Grouping and hierarchy](https://fluent2.microsoft.design/components/web/react/core/nav/usage#grouping)、[Fluent Nav：Accessibility](https://fluent2.microsoft.design/components/web/react/core/nav/usage#accessibility)

Fluent Nav 还明确不支持 icon-only layout。这与 shadcn 的 `collapsible="icon"` 是一个有价值的取舍差异：本项目可以保留桌面端 expert-friendly icon rail，但不应把移动端主导航压成只有图标，也应为每个折叠图标保留 tooltip、`aria-label` 和可见的可恢复入口。[Fluent Nav：Icons](https://fluent2.microsoft.design/components/web/react/core/nav/usage#icons)

#### Fluent Drawer + Radix Dialog：抽屉需要明确的 header/body/footer 和焦点回路

Fluent Drawer 将抽屉拆成：

- header：描述性标题、关闭按钮和少量顶部操作；
- body：主要信息和控件，超出高度时独立滚动；
- footer：可选的主要操作，主按钮在其他按钮之前。

长内容可让 header/footer sticky；抽屉关闭与 dismiss 要区分，含输入或 checkbox 的抽屉在关闭可能丢失进度时应提醒用户；不要在 overlay drawer 上叠多个阻塞面。[Fluent Drawer：Anatomy](https://fluent2.microsoft.design/components/web/react/core/drawer/usage#anatomy)、[Fluent Drawer：Wrapping and overflow](https://fluent2.microsoft.design/components/web/react/core/drawer/usage#wrapping-and-overflow)、[Fluent Drawer：Collapsing vs dismissing](https://fluent2.microsoft.design/components/web/react/core/drawer/usage#collapsing-vs-dismissing)

Radix Dialog 提供 modal 内容 inert、焦点 trap、Escape 关闭并将焦点移回 trigger，以及 Title/Description 的读屏公告；这些能力成立的前提是调用方提供可访问的标题、描述和关闭按钮。[Radix Dialog：Features and accessibility](https://www.radix-ui.com/primitives/docs/components/dialog)、[Radix accessibility overview](https://www.radix-ui.com/primitives/docs/overview/accessibility)

shadcn 的官方 responsive drawer 示例也采用“桌面 Dialog、移动 Drawer”的同一业务内容组合，适合本项目的桌面/移动双形态。[shadcn/ui：Responsive Dialog](https://ui.shadcn.com/docs/components/radix/drawer#responsive-dialog)

### 3.2 当前 Sidebar 基线

当前 [`src/components/Sidebar.tsx`](../../src/components/Sidebar.tsx) 已具备：

- 桌面展开/折叠状态，并持久化到 localStorage；
- `Ctrl/Cmd+B` 快捷键；
- header、导航滚动区、footer 的基本分层；
- desktop `aria-current="page"`、折叠态 tooltip 和 Lucide icon；
- 移动端“今日/知识/复习/统计/更多”底栏；
- “更多”使用 Radix Dialog 形成底部 Sheet，并包含标题、描述、关闭按钮和 safe-area；
- 复习队列摘要和命令面板入口。

因此当前重点不是再加入口，而是把 active、分组折叠和抽屉状态做得更可预测。

### 3.3 推荐的 Sidebar 交互契约

#### Active

- 路由链接始终使用真实 URL；当前页面同时使用 `aria-current="page"`、前景色和细 marker；
- `active`、hover、focus、pressed 不共享一个背景色；
- 如果以后允许分组折叠，子页面 active 时父分组仍显示 active/partial indicator；
- 进入 `/knowledge/:cardId`、`/knowledge/new` 等子路由时，知识一级入口仍应保持 active；
- badge 只表达计数，不作为 active 唯一标识；0、99+ 和错误状态应有稳定文案。

#### Desktop 折叠

- 保留现有约 244px 展开、76px 折叠的两态，足以覆盖当前入口数量；
- 折叠只影响可见标签和分组，不改变当前 route、query 或页面数据；
- 每个 icon rail 项都保留 `aria-label`/tooltip，tooltip 不应遮挡相邻导航；
- 如果日后加入可拖动宽度，先只增加 `--sidebar-width` 和 rail hit area，不引入运行时 ResizeObserver 逻辑；
- 分组最多两级；超过两级的项目层级应放入页面内容或搜索，而不是继续嵌套侧栏。

#### 分组折叠

- 可用现有 Radix Collapsible，为“工作台、复习与洞察、资料、系统”分别保存开合；
- 当前路由所属组默认展开；用户主动收起后应持久化，但遇到 active 子项不能完全隐藏其位置；
- 分组标题是 disclosure trigger，不要同时伪装成无目的链接；
- 分组操作只保留一个必要的辅助入口，其余放 overflow，且动作节点始终存在于 DOM。

#### Mobile Drawer/More

- 当前底部主导航 + More Sheet 可以作为主导航方案继续使用；不应同时再放一套常驻移动侧栏，避免双重导航；
- 如果某个任务确实需要移动侧栏，复用现有 `SheetContent side="left"`，不新增 Drawer 库；
- 抽屉固定结构为 header/body/footer：header 放标题和关闭，body 独立 `overflow-y-auto`，footer 放高频主操作；
- 使用 `Dialog.Title`、`Dialog.Description`、Escape、点击遮罩关闭和 focus return；
- 有编辑输入的抽屉关闭前，要判断是否有未保存内容；
- 抽屉宽度、顶部/底部安全区和触控 hit area 用 token 控制；不把所有内容挤到 320px 视口中；
- 不在移动 More Sheet 里再打开另一个 modal drawer；需要二级选择时优先在同一 Sheet 内切换步骤或改用非阻塞 Popover。

### 3.4 低风险实现顺序

1. 先统一 `aria-current`、active marker、focus ring 和子路由 active 匹配。
2. 再为 desktop 分组加入 Radix Collapsible，并将 active group 自动展开。
3. 再将移动 Sheet 的 header/body/footer 和滚动规则抽成共享样式；不改变现有底栏信息架构。
4. 最后评估可调宽度、最近访问和 pinned project；这些属于拓展功能，不应和本轮基础视觉混在一起。

## 4. `reduced-motion` 与轻量过渡

### 4.1 一手资料得到的规则

#### Web 标准：`reduce` 是“移除或替换非必要运动”，不是把内容隐藏

W3C Media Queries Level 5 定义 `prefers-reduced-motion` 的值为 `no-preference` 或 `reduce`。`reduce` 表示用户希望移除或替换可能造成前庭不适或注意力干扰的 motion-based animation。[W3C Media Queries Level 5：`prefers-reduced-motion`](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion)

MDN 的实现说明也强调，reduced motion 不等于必须把所有动画粗暴设为 none；应去掉非必要的缩放、平移等触发因素，仍可以保留传达状态的温和替代。[MDN：`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)

#### Primer：默认把动画包在 `no-preference`，并提供非动画信息

Primer 建议 CSS 动画和 transition 放在 `@media (prefers-reduced-motion: no-preference)` 内；JavaScript 动画监听 `matchMedia` 并在偏好变化时更新。它还要求 informative animation 有文字替代、长时间运动可暂停/停止，并建议 micro animation 保持小范围、局部、非干扰性。[Primer：Support reduced motion](https://primer.style/accessibility/design-guidance/motion-and-animation/#support-reduced-motion)、[Primer：Provide an alternative](https://primer.style/accessibility/design-guidance/motion-and-animation/#provide-an-alternative-for-informative-animations)、[Primer：Make animations subtle](https://primer.style/accessibility/design-guidance/motion-and-animation/#make-animations-subtle)

#### Motion for React：全局策略 + 局部策略

当前项目已经使用 `framer-motion`。其官方 React accessibility 文档支持在 `MotionConfig` 设置 `reducedMotion="user"`：用户开启 reduced motion 后，transform 和 layout animation 会关闭，但 opacity、backgroundColor 等较温和的变化可以保留；对于侧栏这种需要不同策略的组件，可使用 `useReducedMotion` 将 x/y 动画替换成 opacity。[Motion for React：MotionConfig/reducedMotion](https://motion.dev/docs/react-accessibility#automatic)、[Motion for React：useReducedMotion](https://motion.dev/docs/react-accessibility#manual)、[Motion for React：Replace transform with opacity](https://motion.dev/docs/react-accessibility#replace-transform-with-opacity)

#### Tailwind：用 `motion-safe` 让“可动”成为显式选择

Tailwind 官方提供 `motion-safe` 和 `motion-reduce` variants。前者适合把 transform/transition 只放在用户没有请求降动效时，后者适合撤销已有的位移、缩放或 transition。[Tailwind：Supporting reduced motion](https://tailwindcss.com/docs/transition-property#supporting-reduced-motion)、[Tailwind：Motion variants](https://tailwindcss.com/docs/hover-focus-and-other-states#prefers-reduced-motion)

**关键结论：** 最稳妥的实现是“全局默认尊重用户偏好 + 个别复杂动画显式降级”，而不是只在 CSS 末尾放一个全局 duration override。尤其要审计 Framer Motion 的 transform，因为 CSS transition 的 duration 规则不能自动替换 JavaScript 设置的 transform。

### 4.2 当前动效基线与问题

当前 [`src/index.css`](../../src/index.css) 已有 `fadeIn`、`slideUp`、`scaleIn`、`shimmer`，并在 `@media (prefers-reduced-motion: reduce)` 将动画/transition 时长压到极短；Sidebar 的 active indicator 已局部使用 `useReducedMotion`。

同时，仓库中多个页面仍使用 Framer Motion 的 `initial/animate/exit`、spring、`x/y`、scale 或 layout-style transitions，而根部尚未设置统一的 `MotionConfig`。因此目前存在两个潜在不一致：

- CSS 动效已有系统级降级，但 JavaScript motion 由各页面分别决定；
- 无限 shimmer/spinner 在 reduced mode 下可能近似静止，必须确保旁边仍有清晰的文本状态，不要依赖转动本身传达“正在加载”。

这是下一轮需要处理的审计项，本轮不修改现有 CSS 或组件。

### 4.3 建议的动效预算

以下时间是本仓库的实现建议，不是外部设计系统的规范数值；它们的目的在于限制自由发挥、让界面保持安静：

| 动效层级 | 建议范围 | 可用属性 | 典型场景 |
| --- | --- | --- | --- |
| Instant | `0ms` | background/visibility 直接切换 | reduced mode、危险确认、数据完成后关键状态 |
| Micro | 约 `120–160ms` | color、background、border、opacity | hover、selected、按钮 pressed |
| Surface | 约 `180–240ms` | opacity；无障碍允许时小幅 translate | Sheet、Dialog、侧栏开合 |
| Content | 尽量不超过 `240ms` | opacity 或局部 height | 空状态替换、单个列表项进入 |
| Continuous | 默认禁用或提供控制 | 非必要不要无限循环 | shimmer、自动轮播、背景动效 |

建议约束：

- 页面路由切换只做一次整体 opacity 或极小位移，不对每张卡片做 stagger；
- hover 不改变布局，不使用大幅 translate/scale；
- selected/confirmed 反馈优先使用背景、border、icon 和文本，不用闪烁；
- Sheet/侧栏在普通模式可从边缘进入，reduced mode 改为 opacity 或直接出现；
- loading 状态必须同时有文本或 `aria-busy`，spinner/shimmer 只是辅助；
- 超过五秒的自动运动必须能停止或不启动，informative motion 必须有静态文字替代。[Primer：For engineers](https://primer.style/accessibility/design-guidance/motion-and-animation/#for-engineers)

### 4.4 低风险实现建议

1. **根部增加 MotionConfig 策略。** 在 App shell 或入口包裹 `MotionConfig reducedMotion="user"`，先覆盖所有 Framer Motion 子树；对确实需要特殊行为的组件再使用 `useReducedMotion`。
2. **将 CSS 的 transform 动效改为显式 `motion-safe:`。** 例如 hover lift、active scale、侧栏 slide、Sheet slide 只在 `motion-safe` 下启用；颜色/opacity transition 可以保留，但要使用语义时长 token。
3. **将现有 global reduce 规则从“全局 duration 兜底”逐步迁移为“可动属性默认安全”。** 第一阶段可以保留兜底避免回归；第二阶段按组件移除 `transition-all`，改成明确的 `transition-[color,background-color,border-color,opacity,box-shadow]`。
4. **为 motion component 写两个 variant。** 普通模式使用 `x/y/scale`，reduced 模式只使用 `opacity` 或 `initial={false}`；不要只依赖 CSS 覆盖。
5. **补充 reduced-transparency 兼容。** 对 `backdrop-blur` 和 translucent sidebar/overlay 预留 opaque fallback；W3C 同一规范也定义了 `prefers-reduced-transparency`，但该偏好应作为渐进增强，不应成为当前功能前置条件。[W3C：`prefers-reduced-transparency`](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-transparency)
6. **不增加新的动效库。** 现有 Framer Motion、Tailwind variants、Radix `data-state` 已覆盖本轮所需能力；Radix Dialog/Popover 的 open/closed data attributes 也适合与 CSS 的安全过渡结合。[Radix Dialog：Data attributes](https://www.radix-ui.com/primitives/docs/components/dialog#data-attributes)

## 5. 结合当前仓库的低风险实施路线

本节记录剩余路线和验收边界；本轮已先落地低风险部分，后续仍建议按下面顺序推进，每一步都能独立回滚和验收：

### 本轮实现记录（2026-08-27）

- [`src/App.tsx`](../../src/App.tsx) 在应用 shell 根部接入 `MotionConfig reducedMotion="user"`，并保留 Sidebar 对导航指示器的局部 `useReducedMotion` 降级。
- [`src/components/KnowledgePage.tsx`](../../src/components/KnowledgePage.tsx) 将列表行拆成 `idle`、`active`、`selected` 三种状态；批量选中现在有独立边界、背景和左侧 marker，且可与当前打开状态同时存在。
- [`src/index.css`](../../src/index.css) 补齐 `raised`、`inset`、`hover`、`selected`、`focus`、`status`、`overlay` 和 skeleton 角色，并增加知识行的 token 驱动状态样式；hover、active、selected 不再只依靠同一层 accent tint。
- 共享 Dialog/Sheet/Dropdown/Popover/Select 浮层已统一使用 raised surface 和 overlay token，并为支持该偏好的设备预留 reduced-transparency 的不透明回退。
- [`src/components/Sidebar.tsx`](../../src/components/Sidebar.tsx) 增加可持久化的桌面端分组折叠；折叠分组中仍保留当前活动项，整体收起为 icon rail 时不隐藏导航入口。
- 知识列表补充行级 overflow 操作：桌面端在 hover/focus 时显现、触屏端保持可达；进入批量选择后隐藏行级操作，避免单卡片动作与批量动作同时抢占注意力。
- 本轮没有引入新的 UI 组件库；继续复用已有 Radix wrappers、Tailwind、Lucide 和 Framer Motion。

### P0：颜色角色审计

- 建立 token 表和组件消费表；
- 补齐 raised/hover/selected/focus/status/overlay 角色；
- 只改共享 CSS primitive 和 Sidebar/Knowledge row，不全仓一次性替换；
- 对 light/dark/accent 组合检查文字、focus、selected、danger。

### P1：选择与批量反馈

- 将 Knowledge row 的 selected/active/focus 从同一组 accent tint 中分离；
- 保留原生 checkbox、三态表头和当前页/不可见选择语义；
- batch toolbar 明确 scope、primary、overflow、exit；
- 统一成功、失败、进行中消息，失败不丢选择；
- 批量模式下隐藏/禁用行级动作，并检查移动端安全区。

### P2：侧栏细节

- active route 覆盖所有知识子路由；
- 分组使用 Radix Collapsible，并保存用户主动的开合状态；
- 检查折叠态 tooltip、键盘、读屏和触摸可达性；
- 抽取共享 drawer header/body/footer，继续复用现有 Sheet/Dialog；
- 不改变当前移动底栏入口结构。

### P3：动效策略

- 根部接入 `MotionConfig reducedMotion="user"`；
- 对 Sidebar、Sheet、Page transition、Knowledge row、skeleton/shimmer 做逐项审计；
- 用 `motion-safe`/`motion-reduce` 替代散落的 `transition-all` 和未分级 transform；
- reduced mode 下验证加载、删除、恢复、批量成功等信息仍然可见；
- 最后才调时长和 easing，避免先追求“顺滑”再补无障碍。

## 6. 验收矩阵

### 颜色与主题

- 浅色、深色、至少两种 accent theme；
- canvas/surface/raised/selected/disabled/focus/status 的层级可解释；
- 文字、focus、图标和 selected marker 不仅靠颜色区分；
- 深色浮层不比 canvas 更暗；
- 小文字目标至少 4.5:1，focus/图形按目标 WCAG 规则复核。

### 列表与批量

- 无选中、部分选中、全选、跨筛选隐藏选中；
- selected、active、focus、selected+active 可同时辨认；
- 批量进行中、全部成功、部分失败、删除后恢复；
- 桌面 toolbar 与移动底部 toolbar 不遮挡内容和导航；
- 键盘可到达 checkbox、batch action、overflow、清空；触摸设备不依赖 hover。

### 侧栏与抽屉

- 展开/折叠/刷新后 route 与 active 不丢失；
- `/knowledge/new` 和 `/knowledge/:cardId` 仍高亮知识入口；
- 分组折叠时 active 子项仍有父级提示；
- 移动端 320px、390px 宽度下标题、关闭、body 滚动和 safe-area 正常；
- Dialog/Sheet 打开后焦点进入，Escape/关闭后焦点回到 trigger，不出现双重 modal。

### 动效与偏好

- `prefers-reduced-motion: reduce` 下不出现大面积平移、缩放、layout 动画；
- Framer Motion 和 CSS 两条路径都能降级；
- loading、成功、错误、删除和恢复不依赖动画才能理解；
- 普通模式下 motion 只作用于局部且不改变布局尺寸；
- `prefers-reduced-transparency` 若实现，仅作为 opaque fallback，不影响基础功能。

## 7. 来源索引

本轮优先使用以下一手来源：

- Radix Colors：[Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)、[Aliasing](https://www.radix-ui.com/colors/docs/overview/aliasing)、[Composing a palette](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette)
- Carbon Design System：[Color overview](https://carbondesignsystem.com/elements/color/overview/)、[Color tokens](https://carbondesignsystem.com/elements/color/tokens/)、[Data table usage](https://carbondesignsystem.com/components/data-table/usage/)
- Primer：[Color primitives](https://primer.style/product/primitives/color/)、[Primitives/theming](https://primer.style/product/primitives/)、[ActionBar](https://primer.style/product/components/action-bar/)、[DataTable](https://primer.style/product/components/data-table/)、[Motion and animation](https://primer.style/accessibility/design-guidance/motion-and-animation/)
- Fluent 2：[Nav usage](https://fluent2.microsoft.design/components/web/react/core/nav/usage)、[Drawer usage](https://fluent2.microsoft.design/components/web/react/core/drawer/usage)
- shadcn/ui：[Sidebar](https://ui.shadcn.com/docs/components/base/sidebar)、[Responsive Drawer](https://ui.shadcn.com/docs/components/radix/drawer)
- Radix Primitives：[Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility)、[Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)
- Material 3：[Interaction states](https://m3.material.io/foundations/interaction/states/overview)
- Tailwind CSS：[Transition property](https://tailwindcss.com/docs/transition-property)、[Hover/focus/state variants](https://tailwindcss.com/docs/hover-focus-and-other-states)
- Motion for React：[Accessibility](https://motion.dev/docs/react-accessibility)、[useReducedMotion](https://motion.dev/docs/react-use-reduced-motion)
- W3C/MDN：[Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/)、[MDN `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)
