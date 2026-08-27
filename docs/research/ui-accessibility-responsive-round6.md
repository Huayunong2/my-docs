# UI 无障碍与响应式优化调研（Round 6）

- 调研日期：2026-08-27
- 调研范围：下一轮 UI 的无障碍、响应式导航、键盘焦点、触控目标、减少动效/透明度/高对比度，以及长尾页面 token 迁移
- 约束：只读审计；本轮不修改应用代码，仅新增本研究文档。工作区中已有的应用改动均保留原状。
- 目标基线：WCAG 2.2 AA；AAA 条目作为可选增强，不把 AAA 建议误写成 AA 必须项。
- 资料范围：只使用 W3C/WAI-ARIA APG、WCAG、MDN、Radix、Tailwind、React 与 Motion 官方资料。

## 结论先行

项目已经具备一套适合继续演进的基础：React 19、Tailwind CSS v4、Radix Dialog/Dropdown/Popover/Select/Tabs、Framer Motion、TanStack Router，以及 src/index.css 中的 --ui-* 语义 token。下一轮不需要再引入一套大而全的 UI 框架；优先把已有 primitive 组合成一致的行为契约。

建议按以下顺序落地：

| 优先级 | 先处理的事情 | 完成定义 |
| --- | --- | --- |
| **P0** | 自定义弹层统一为 Radix Dialog/Sheet；补跳过链接、主内容焦点目标和路由标题；修复焦点被固定底栏/批量栏遮挡；让全局快捷键避开输入控件和弹层；修复折叠侧栏隐藏当前项的问题 | 键盘可以完整打开、操作、关闭并回到原触发点；任何当前页面都能从键盘定位；焦点不被固定 UI 完全盖住 |
| **P1** | 移动导航和详情布局的响应式收口；触控目标统一；日历状态改成明确的移动端状态选择；移除 hover-only 操作；检查所有图标按钮和选择控件的名称/状态 | 320 CSS px 宽度、文字放大和触控设备下不丢功能、不依赖悬停或右键 |
| **P2** | prefers-reduced-motion、prefers-reduced-transparency、prefers-contrast、forced-colors 的 token 与组件策略；补高对比度下的选中/状态/焦点表达 | 用户偏好不会使内容消失；状态不只靠颜色；系统高对比模式下仍能区分可操作、选中、错误和焦点 |
| **P3** | 长尾页面 token 迁移和静态检查 | 共享 primitive 先收口，长尾页面按清单迁移；新增 raw 颜色有明确例外和检查机制 |

这个顺序符合 W3C 对 WCAG 2.2 的建议：开发或更新内容时应优先采用当前版本；WCAG 2.2 也明确覆盖桌面与移动设备。[WCAG 2.2 Recommendation](https://www.w3.org/TR/WCAG22/)

## 1. 当前仓库审计快照

### 已有的正向基础

1. index.html:2-16 已有 lang="zh-CN"、移动 viewport、color-scheme 和基础标题。
2. src/components/ui/sheet.tsx、Feedback.tsx、CommandPalette.tsx 已使用 Radix Dialog；dropdown-menu.tsx、tabs.tsx 也使用 Radix 的复合组件。Radix 官方说明其 primitive 遵循 WAI-ARIA APG，并提供角色、键盘和焦点管理，但组件的可访问名称仍由应用负责。[Radix Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility)
3. src/App.tsx:248-274 使用 MotionConfig reducedMotion="user"；src/index.css:930-938 也有全局 prefers-reduced-motion 规则。
4. src/index.css:103-184 已建立 canvas、surface、border、text、focus、overlay、status、skeleton 等角色 token，src/index.css:214-217 有全局 :focus-visible 轮廓。
5. Sidebar.tsx 的普通导航使用 nav、链接和 aria-current；移动端已有四个主入口加“更多”抽屉，方向是对的。
6. StatsPage.tsx:1069-1203 已有移动端日期操作 Sheet，以及“请假、休息、生病、出差”等日期状态入口；因此下一轮重点是让状态选择更显眼、更符合单选语义，而不是重新发明一套入口。

### 主要风险

| 风险 | 代码证据 | 判断 |
| --- | --- | --- |
| 自定义覆盖层没有统一的 modal 语义和焦点生命周期 | HistoryPage.tsx:210-235、ArticleDetail.tsx:108-113、ReviewsPage.tsx:525-549、TodayPage.tsx:966-1023 | P0。静态代码可确认这些层没有使用 Dialog；是否实际造成焦点逃逸需要运行时测试，但风险明确 |
| 主内容没有跳过链接/稳定焦点目标，页面标题仍是静态的 | App.tsx:263-268 的 main 无 id；index.html:16 只有静态标题 | P0。影响键盘用户定位和多页面辨识 |
| 全局快捷键直接监听 window | App.tsx:186-213 | P0/P1。输入标题、Markdown、搜索或 Dialog 内输入时应避免抢占快捷键 |
| 桌面侧栏组折叠后会把当前项一起隐藏 | Sidebar.tsx:288-305 先筛出当前项，随后仍对整个容器加 hidden | P0。当前页面可能在导航中消失，影响定位、回退和键盘发现 |
| 固定移动底栏、Sheet、批量栏的底部空间没有统一变量 | Sidebar.tsx:133-160、index.css 移动规则中的 main padding-bottom、safe-bottom | P0/P1。需要验证焦点和最后一行内容是否被遮挡 |
| 触控密度不一致 | .ui-icon-button 基准为 40/36px，但若干页面覆盖到 h-8、h-7、sm:h-6；日历状态辅助按钮在 StatsPage.tsx:1298-1310 最小为 24px | P1。24px 是 WCAG 2.2 AA 最低目标尺寸，产品默认应尽量使用 44px |
| hover-only 操作可能对键盘用户不可见 | HistoryPage.tsx:314-328 的编辑/删除按钮在桌面使用 sm:opacity-0 sm:group-hover:opacity-100 | P1。按钮仍可能获得焦点，但没有 group-focus-within 显示状态 |
| 透明度回退只覆盖了部分 shell/nav，没有把所有关键表面变成不透明 | index.css:764-779 处理 blur，并覆盖部分 sidebar/mobile nav；--ui-surface-soft、overlay 及页面专属 alpha 仍可能透视 | P2。prefers-reduced-transparency 目前在 MDN 标为有限可用，应有稳健的基础样式 |
| 长尾页面仍大量直接消费 gray/white/emerald/amber 等颜色 | MarkdownContent.tsx、HistoryPage.tsx、ArchivePage.tsx、SearchPage.tsx、KnowledgeTrashPage.tsx、ReviewsPage.tsx、TodayPage.tsx、StatsPage.tsx 等 | P3，但共享浮层、焦点、状态色的迁移应提前到 P0/P2 一起完成 |

这份审计是静态检查，不等同于 WCAG 合规声明；焦点路径、屏幕阅读器朗读、系统高对比度、真实触控尺寸和动态布局必须在浏览器中复核。

## 2. P0：先修复可访问性结构和焦点生命周期

### 2.1 统一所有真正的弹层

**证据。** 历史详情的移动端覆盖层、ArticleDetail 的 modal 模式、复盘版本对比和 Today 的 AI 结果面板都通过普通 div 加点击冒泡关闭。它们没有统一的 role="dialog"、aria-modal、Escape 关闭、焦点陷阱、初始焦点和关闭后焦点回收。Sidebar 的“更多”和命令面板虽使用 Radix Dialog，但都是受控 Root 配合外部按钮，仍应确认触发点和关闭后的焦点回收。

**建议。**

1. 继续使用仓库已有的 Radix Dialog/Sheet，不新增 Modal 库。每个 modal 入口使用 Dialog.Trigger asChild；程序化打开的场景保存触发按钮 ref，并在 onCloseAutoFocus 中明确回到该按钮。
2. 每个 Dialog 都提供 Dialog.Title；有说明文本时使用 Dialog.Description。图标关闭按钮必须有可访问名称。长文章详情的初始焦点可放到标题或内容开始处，而不是把屏幕阅读器直接送到最底部的第一个按钮。
3. HistoryPage 桌面右侧详情是布局中的详情 region，不必伪装成 modal；移动端详情、版本对比和 AI 面板则应视为 modal/sheet。两种模式共享 ArticleDetail 内容，但不要共享错误的焦点模型。
4. 删除确认属于高风险动作，保留现有确认 Dialog，并检查取消/关闭后的焦点仍回到删除按钮；异步保存或删除中要防止 Dialog 被意外关闭后焦点落到 body。

**验收。** 用键盘打开每个弹层：焦点进入弹层；Tab/Shift+Tab 不逃逸；Esc 可关闭；关闭后回到触发点；背景不可操作；标题和说明被朗读；长内容不会因为初始焦点而把标题滚出视口。

依据：[WAI-ARIA APG Dialog Modal Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)、[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)、[WCAG 2.2 4.1.2 Name, Role, Value](https://www.w3.org/TR/WCAG22/#name-role-value)。

### 2.2 建立“跳过内容—主内容—页面标题”基线

**证据。** App.tsx:263-267 的主内容没有 id 或稳定焦点目标；应用没有 skip link。index.html 的标题是“每日总结”，路由变化后没有页面级标题策略。

**建议。**

1. 在 App shell 中把第一个可聚焦元素设为“跳到主要内容”，目标为 main id="main-content" tabIndex={-1}。跳过链接平时视觉隐藏，获得键盘焦点时显示。
2. 按真实路由设置页面标题，例如“今日 — 每日总结”“知识 — 每日总结”“卡片标题 — 知识 — 每日总结”。标题更新应发生在路由/页面状态变化之后，不要只依赖初始 HTML title。
3. 主内容页保持一个清晰的 h1；详情页使用标题作为详情层的 Dialog.Title 或 region heading。不要为了视觉隐藏标题而删除语义标题。

依据：[WCAG 2.2 2.4.1 Bypass Blocks](https://www.w3.org/TR/WCAG22/#bypass-blocks)、[WCAG 2.2 2.4.2 Page Titled](https://www.w3.org/TR/WCAG22/#page-titled)、[WCAG 2.2 2.4.6 Headings and Labels](https://www.w3.org/TR/WCAG22/#headings-and-labels)、[React DOM common props](https://react.dev/reference/react-dom/components/common)。

### 2.3 保留可见焦点，不让 outline-hidden 变成焦点丢失

**证据。** 全局已有 *:focus-visible，但多个按钮和 Radix Content 使用 outline-hidden，再由各组件自行决定是否补 ring。这在实现正确时没问题，但非常容易出现“鼠标看起来漂亮、键盘没有焦点”的回归。

**建议。**

1. 规定每个可聚焦组件必须有一个可审计的 focus-visible 样式：至少有 2px 左右的高对比边界或等价的环，并且不能只靠 hover 背景。
2. 不要在共享 primitive 中无条件去掉 outline；如需去掉浏览器默认样式，必须在同一 primitive 中提供 focus-visible 替代方案。Dropdown、Tabs、Select、Calendar、知识卡片链接和 icon button 都应从共享样式继承。
3. 焦点样式要同时覆盖浅色、深色、不同 accent theme、prefers-contrast: more 和 forced-colors: active。
4. 重点检查历史卡片操作按钮的 group-focus-within、折叠组按钮、移动底栏、批量操作栏和日历单元格；这些位置最容易“焦点存在但不可见”。

依据：[WCAG 2.2 2.4.7 Focus Visible](https://www.w3.org/TR/WCAG22/#focus-visible)、[WCAG 2.2 2.4.13 Focus Appearance（AAA）](https://www.w3.org/TR/WCAG22/#focus-appearance)、[MDN :focus-visible](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/%3Afocus-visible)、[Tailwind hover/focus variants](https://tailwindcss.com/docs/hover-focus-and-other-states)。

### 2.4 把全局快捷键限制在合适的上下文

**证据。** App.tsx:186-213 在 window 上捕获 Ctrl/Cmd+1–9 和 Ctrl/Cmd+K，没有跳过 input、textarea、select、contenteditable、IME 组合态或 Dialog 内的编辑状态。

**建议。**

1. 快捷键 handler 先判断事件目标是否为可编辑元素；焦点在搜索、标题、Markdown、备注或命令面板输入框时不抢占。使用组合键时仍应保持浏览器和编辑器的常见操作可用。
2. 给快捷键提供可见的帮助入口，并在命令面板中显示当前可用快捷键。快捷键命令应和链接/按钮操作有等价的可发现入口。
3. 如果未来增加单字符快捷键，必须提供关闭/重新映射机制；当前 Ctrl/Cmd 组合键虽然不是典型的单字符快捷键，但同样需要避开编辑上下文。
4. 不要用 tabIndex > 0 试图修补顺序；通过 DOM 顺序、语义元素和局部焦点管理来控制焦点。

依据：[WCAG 2.2 2.1.1 Keyboard](https://www.w3.org/TR/WCAG22/#keyboard)、[WCAG 2.2 2.1.2 No Keyboard Trap](https://www.w3.org/TR/WCAG22/#no-keyboard-trap)、[WCAG 2.2 2.1.4 Character Key Shortcuts](https://www.w3.org/TR/WCAG22/#character-key-shortcuts)、[WAI-ARIA APG Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)。

## 3. P1：响应式导航与详情布局

### 3.1 保留五项移动底栏，但强化“更多”和安全区契约

**现状。** Sidebar.tsx:132-205 已将移动端压缩为“今日、知识、复习、统计、更多”，低频页面和主题放入底部 Dialog。这符合当前产品方向，建议保留，不再把历史、归档、搜索、设置塞回底栏。

**建议。**

1. 将“更多”按钮本身包在 Dialog.Trigger asChild 中，而不是只设置 aria-haspopup/aria-expanded 后由外部 setMoreOpen 打开；这样 Radix 能知道触发点并处理默认焦点回收。若保留完全程序化打开，必须用 ref 手动回收焦点。
2. 把移动导航高度抽为共享 CSS 变量，例如 --ui-mobile-nav-height，同时供 main 的 padding-bottom、滚动容器的 scroll-padding-bottom、知识页批量栏和底部 Sheet 使用。安全区只加一次，避免“导航、批量栏、safe area”相互叠加或互相覆盖。
3. 底栏和批量操作栏都要在 env(safe-area-inset-bottom) 之上布局；最后一个可聚焦元素滚动到视口底部时，必须仍能完整看到焦点环和文字。
4. 路由链接当前以 search={{} as never}} 导航，会清空知识筛选/搜索上下文。建议明确区分“切换主页面时重置筛选”和“返回列表时保留上下文”，至少不要让浏览器后退和详情返回丢失用户刚才的查询状态。

依据：[WCAG 2.2 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum)、[MDN env()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)、[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)、[WCAG 2.2 3.2.3 Consistent Navigation](https://www.w3.org/TR/WCAG22/#consistent-navigation)。

### 3.2 修复桌面侧栏折叠的当前项消失问题

**证据。** Sidebar.tsx:288-305 计算了 visibleItems，折叠组时只保留当前项；但承载这些项的 div 仍被加上 hidden，所以当前页并不会真正显示。

**建议。** 选择一种明确模型：

- 组展开时显示完整列表，组折叠时显示一个始终可见的“当前项”插槽；或
- 当当前路由属于某组时自动保持该组展开，用户点击折叠后允许折叠但保留当前项；或
- 使用 Radix Collapsible 的 Trigger/Content，由组件处理展开状态，再单独渲染当前项。

按钮已有 aria-expanded/aria-controls，因此不需要升级为 menu 或 menubar。普通应用导航应继续使用 nav、列表和链接；只有确实实现菜单的箭头键、Escape 和 roving focus 行为时才使用 menu 模型。若未来把归档年月做成真正的层级树，只有在实现完整树键盘模型时才使用 Treeview；否则继续用 Disclosure + 普通链接更稳妥。

依据：[WAI-ARIA APG Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)、[Radix Collapsible](https://www.radix-ui.com/primitives/docs/components/collapsible)、[Radix Navigation Menu](https://www.radix-ui.com/primitives/docs/components/navigation-menu)、[WAI-ARIA APG Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)。

### 3.3 以容器宽度而不只是 viewport breakpoint 决定详情布局

**证据。** HistoryPage.tsx:99-105 在打开详情时使用 md:min-w-[380px]，详情面板 HistoryPage.tsx:194-197 还有 min-w-[440px]；当侧栏、列表和详情同时存在时，viewport 宽度不等于详情容器实际宽度。项目的 PageHeader 已经使用 container query，这是可复用的方向。

**建议。**

1. 详情页和工具栏的布局用 minmax(0,1fr)、容器 query 和可折叠 action set，避免固定 min-width 把 320/375px 设备推成横向页面。
2. 移动端坚持“列表页 → 全屏详情/编辑页”；桌面端才并排显示列表与详情。详情页的返回、编辑、删除操作保持相同 DOM 顺序，避免响应式 CSS 改变键盘焦点顺序。
3. 代码块、表格和 Mermaid 图可以保留局部横向滚动，但页面壳、导航、表单和操作栏不应出现非必要的二维滚动。
4. 测试宽度至少包含 320、375、430、768、1024 CSS px，并测试浏览器文字放大 200% 和横屏，而不是只看一个“手机模拟器”宽度。

依据：[WCAG 2.2 1.4.10 Reflow](https://www.w3.org/TR/WCAG22/#reflow)、[Tailwind Responsive Design](https://tailwindcss.com/docs/responsive-design)、[Tailwind theme/container query variables](https://tailwindcss.com/docs/theme)。

## 4. P1：触控目标、状态选择和 hover-only 操作

### 4.1 统一 hit target，而不是只放大图标

**规范和现状。** WCAG 2.2 的 AA 目标尺寸最低为 24×24 CSS px，并允许间距、等价控件、行内文本等例外；AAA 的增强目标为 44×44 CSS px。MDN 对 button 的通用建议也是让按钮交互区域达到 44×44 CSS px。仓库中的 .ui-icon-button 移动基准为 40×40、桌面基准为 36×36，移动底栏项目约为 48px；但页面覆盖值有 32、28、24px，不能只看共享基准。

**建议。**

1. 定义“视觉图标尺寸”和“交互 hitbox 尺寸”两个概念：图标可以是 14–18px，按钮本身在触控环境尽量 min-width/min-height:44px；密集桌面工具栏至少满足 WCAG AA 24px 并有足够间距。
2. 对 HistoryPage、ReviewsPage、MarkdownContent Mermaid 控件、知识批量栏、归档年月树、日历状态按钮做一次几何盘点；不要用负 margin 让相邻目标重叠。
3. 对日历单元格，移动端整格按钮已经是较好的大目标；桌面端右上角日期状态按钮不要依赖 24px 小图标，扩大透明 hitbox 或把操作放入明确的日期操作面板。
4. 图标按钮始终提供 aria-label；有可见文字时，label 的可见文字应与 accessible name 一致。原生 button 仍优先于带 onClick 的 div。

依据：[WCAG 2.2 2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)、[WCAG 2.2 2.5.5 Target Size (Enhanced, AAA)](https://www.w3.org/TR/WCAG22/#target-size-enhanced)、[MDN button 元素](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button)。

### 4.2 移动端日历状态要成为一等操作

**现状。** StatsPage.tsx:1093-1129 的移动日期 Sheet 已提供“设置日期状态”，StatsPage.tsx:1159-1178 也有状态选项；但桌面右上角状态按钮在移动端隐藏，移动用户只能先点整格再进入二级 Sheet。CalendarDay 还用 onContextMenu 作为额外入口，这不能成为唯一操作路径。

**建议。**

1. 在移动日期操作 Sheet 中把“日期状态”作为与“编辑记录”同级的主操作，显示当前状态；若业务允许记录和日期状态并存，需要确认目前 !dayActionTarget.has_article 的条件是否过严。
2. 四个互斥状态应建模成真正的单选组：可用原生 fieldset/legend/input[type=radio]，或引入 Radix Radio Group；如果继续使用立即提交的按钮，就不要把普通 action 误标为 toggle，状态反馈要用文本、图标和明确的选中样式共同表达。
3. 状态按钮的颜色只能辅助说明；每个状态都要有文字名称和可朗读的当前状态。错误、保存中和成功消息使用 role="alert"/status message 的正确时机，不要只改变颜色。
4. onContextMenu 可以保留为桌面快捷操作，但必须与点击、键盘和移动 Sheet 完全等价。

依据：[WCAG 2.2 2.5.1 Pointer Gestures](https://www.w3.org/TR/WCAG22/#pointer-gestures)、[WCAG 2.2 2.5.2 Pointer Cancellation](https://www.w3.org/TR/WCAG22/#pointer-cancellation)、[MDN button 的状态属性说明](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button)、[WCAG 2.2 4.1.3 Status Messages](https://www.w3.org/TR/WCAG22/#status-messages)。

### 4.3 取消“只在 hover 时显示操作”

**证据。** HistoryPage.tsx:314-328 的编辑和删除按钮在桌面默认透明，只有卡片 hover 时显示；键盘 focus-within 没有对应显示规则。相同模式应通过全仓库搜索继续盘点。

**建议。** 使用 group-focus-within:opacity-100 和 focus-visible 样式，或者在桌面始终显示二级操作、只在空间紧张时折叠到 overflow menu。不要让一个可 Tab 到但肉眼不可见的按钮成为正常状态。

依据：[WCAG 2.4.7 Focus Visible](https://www.w3.org/TR/WCAG22/#focus-visible)、[WCAG 2.4.13 Focus Appearance（AAA）](https://www.w3.org/TR/WCAG22/#focus-appearance)、[Tailwind descendant/group focus variants](https://tailwindcss.com/docs/hover-focus-and-other-states)、[WCAG 1.4.13 Content on Hover or Focus](https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus)。

## 5. P2：减少动效、透明度、高对比度和强制颜色

### 5.1 减少动效要是组件策略，不只是把 duration 设成 0.001ms

**现状。** 项目已经有 MotionConfig 和 CSS media query，这是正确起点；但页面仍有 Framer Motion 的位移/缩放/spring、active:scale-95、卡片 hover 位移、页面淡入、无限 shimmer 和 spinner。index.css:930-938 的全局规则只能压缩 CSS 动画，不能替代所有 JS motion variant 的语义判断。

**建议。**

1. 对进入/退出、抽屉、卡片 hover、按钮按下、日历月份切换、骨架 shimmer 分别定义“正常”和“reduce”两种行为。reduce 优先移除位移、缩放和连续循环；必要时保留短暂 opacity 或颜色变化。
2. Framer Motion 组件继续读取 useReducedMotion() 或继承 MotionConfig，但不要假定 CSS 的 animation-duration 会取消 JS spring。对于不需要动画的结构，使用静态状态而不是 0.001ms 的“假动画”。
3. .ui-skeleton::after 在 reduce 下改成静态骨架，不再播放 shimmer；spinner 需要有文字状态，并在 reduce 下避免持续旋转。
4. 动效不能成为理解状态变化的唯一线索；展开、保存、选中和错误都必须有 DOM 状态、文本或可访问状态。

依据：[WCAG 2.2 2.3.3 Animation from Interactions（AAA）](https://www.w3.org/TR/WCAG22/#animation-from-interactions)、[MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)、[Tailwind motion-safe/motion-reduce variants](https://tailwindcss.com/docs/hover-focus-and-other-states)、[MotionConfig](https://motion.dev/docs/react-motion-config)。

### 5.2 透明度偏好需要不透明 fallback

**现状。** @media (prefers-reduced-transparency: reduce) 会关闭 blur，并把部分 sidebar/mobile nav surface 改为不透明；但 surface-soft、overlay 和页面专属 alpha 仍可能透视。MDN 将 prefers-reduced-transparency 标为有限可用，因此不能把它当成唯一保障。

**建议。**

1. 先把关键内容的基础背景定义为不透明：主内容、底栏、Sheet/Dialog、Dropdown/Popover、批量栏、表单字段和错误/成功提示不依赖背景透视才能阅读。
2. 在 prefers-reduced-transparency: reduce 下，把 --ui-sidebar-surface、overlay 和浮层 surface 映射到不透明的 canvas/raised 角色，并加强边界；普通浏览器即使不支持该 media query，也应获得可读的基础样式。
3. blur 仅作为装饰层，不作为层级、选中或错误状态的唯一差异；同时检查深色模式和 accent theme。

依据：[MDN prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-transparency)、[WCAG 2.2 1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)、[WCAG 2.2 1.4.11 Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast)。

### 5.3 为 contrast preference 和强制颜色建立 token 层

**现状。** 当前 CSS 有 light/dark 和 status token，并已在 index.css:781-863 对共享 surface、焦点、按钮、状态提示和 skeleton 做了基础 forced-colors 覆盖；但仍没有 prefers-contrast 专门规则，且页面专属的 Stats 日历状态、知识选中 marker、进度条和各种 emerald/rose/amber/sky 颜色没有全部纳入该覆盖层。

**建议。**

1. 在 prefers-contrast: more 下提升 --ui-border-strong、焦点环、选中边界和文字对比，不要只把背景变得更鲜艳。prefers-contrast 是增强层，不应替代默认对比度。
2. 在 forced-colors: active 下为焦点、边框、选中标记和按钮状态提供系统颜色（如 CanvasText、ButtonText、Highlight、HighlightText）或使用 currentColor；不要依赖 box-shadow，因为强制颜色模式可能移除阴影。
3. 不要全局使用 forced-color-adjust: none 来抵抗用户配色；只有明确维护自身对比度的局部控件才考虑它，并进行单独测试。
4. 选中、错误、请假、休息、出差、生病等状态都要同时有文字/图标/边界/ARIA 状态；颜色是辅助层，不是唯一信息。
5. Mermaid SVG、进度条、日期单元格和 mark 搜索高亮需要在 forced colors 下检查，避免背景被系统替换后文字消失。

依据：[MDN prefers-contrast](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-contrast)、[MDN forced-colors](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/forced-colors)、[MDN forced-color-adjust](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/forced-color-adjust)、[WCAG 2.2 1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)、[WCAG 2.2 1.4.11 Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast)。

## 6. P3：长尾页面 token 迁移

### 6.1 迁移原则

Tailwind 官方把 theme variables 定义为设计 token，并建议用 @theme 生成可复用 utility；对于不需要对应 utility 的语义角色，普通 CSS variables 放在 :root 仍然合适。当前项目的 --ui-* 角色 token 可以继续保留，不需要把每一个页面专属值都塞进 Tailwind 色阶。[Tailwind Theme Variables](https://tailwindcss.com/docs/theme)

迁移时遵循四条规则：

1. **语义优先。** 页面消费 surface、raised、inset、border、focus、text-muted、status-*，不在调用处决定 gray-100 还是 white/10。
2. **状态分维度。** 每种状态提供 surface、border、text、solid/action 四个角色；selected 不与 hover 共用表达；focus 不只改变背景。
3. **内容专属 token。** Markdown 的 code、blockquote、table、Mermaid 不是普通卡片，单独增加 reader-code-*、reader-quote-*、reader-table-* 角色，避免机械替换后代码块对比度下降。
4. **基础样式先于偏好覆盖。** 先让默认 light/dark 有可靠的实色 fallback，再在 reduced transparency、contrast 和 forced colors 中覆盖角色值。

### 6.2 页面迁移顺序

| 顺序 | 文件/区域 | 需要收口的角色 | 原因 |
| --- | --- | --- | --- |
| 1 | src/components/ui/*、index.css | modal、overlay、floating、field、button、nav、focus、status、mobile nav height | 一处修复覆盖最多页面，也是 P0/P2 的依赖 |
| 2 | HistoryPage.tsx、ArticleDetail.tsx、ReviewsPage.tsx、Today AI panel | reader surface、modal、divider、hover/focus action、danger | 这些页面同时有自定义浮层和大量长尾颜色，风险高 |
| 3 | ArchivePage.tsx、SearchPage.tsx、KnowledgeTrashPage.tsx | tree、empty、error、highlight、selected row、restore action | 交互密集，适合验证状态 token 和触控目标 |
| 4 | StatsPage.tsx | calendar day、today、exemption/status、legend、progress | 状态数量最多，必须验证“颜色之外的状态信息” |
| 5 | MarkdownContent.tsx | code block、inline code、quote、table、Mermaid loading/error | 内容样式特殊，单独迁移比通用替换安全 |
| 6 | SettingsPage.tsx 与 settings/*、ReviewPage.tsx | setting surface、success/error、review state、disabled | 长尾维护成本高，但共享角色稳定后迁移最省成本 |

### 6.3 具体长尾问题

- MarkdownContent.tsx:56-170,192-260 直接使用 gray/white/pink/red；应先建立 reader token，同时给 Mermaid SVG 一个可理解的标题/文本替代或明确的非文本装饰语义。
- HistoryPage.tsx:210-235 与 ArticleDetail.tsx:108-113 的 overlay/surface 既是 token 问题，也是 Dialog 语义问题；先修结构，再迁移颜色。
- ArchivePage.tsx:117-132,232-260 的年月树和移动选择器应共享 disclosure 状态、focus 样式与 surface token。
- SearchPage.tsx:42,302-358,437-497 的搜索高亮、空状态和分页文字不应依靠低对比度 gray；高亮应保证文字与背景在 light/dark/forced colors 中都可读。
- KnowledgeTrashPage.tsx:115-200 的行选中、状态徽章、恢复按钮应使用 selected/status token，并保持 checkbox 的可见 focus 和足够 hitbox。
- ReviewsPage.tsx:461-505,525-549 的版本列表和比较弹层应使用共享 dialog/selected/status 角色。
- TodayPage.tsx:966-1023 的 AI 面板应使用共享 Sheet/Dialog surface、overlay、close action 和状态 token。
- StatsPage.tsx:1232-1355 的日历颜色映射建议改成语义状态对象，保留文字标签/图标/边界，避免 raw emerald/rose/amber/sky 同时承担所有含义。

### 6.4 加一道防回退检查

不建议把所有 raw 颜色一刀切禁止，因为 reader code、品牌 accent 和图表可能有合理例外；建议在 CI 或代码审查中维护一个小型 allowlist，并对新出现的以下模式发出检查提示：

    bg-white / bg-gray-* / text-gray-* / border-gray-*
    dark:bg-white/* / dark:text-gray-* / dark:border-white/*
    状态区域直接使用 emerald / rose / amber / sky
    固定的 black/*、white/* overlay 或 shadow 作为浮层层级

检查的目标不是追求零字符串，而是强制开发者回答“这是内容专属颜色，还是应该消费一个语义角色”。Tailwind 的 @theme 与普通 CSS variable 可同时使用：前者适合需要 utility API 的设计值，后者适合当前项目这种跨主题的角色映射。[Tailwind Theme Variables](https://tailwindcss.com/docs/theme)

## 7. 建议的实施顺序与验收矩阵

### Phase A：P0 基础行为

1. 抽出统一 Dialog/Sheet wrapper，迁移四类自定义覆盖层。
2. 增加 skip link、main-content、路由标题和焦点回收。
3. 修复 Sidebar 折叠组当前项消失、More trigger、移动底栏滚动内边距。
4. 为快捷键增加 editable target/dialog guard，并为所有自定义 clickable container 复核原生语义。

### Phase B：P1 移动和输入

1. 统一 44px 默认触控 hitbox，24px 作为密集桌面控件的最低线。
2. 日历状态改成移动端显式单选/状态 action，桌面右键只做快捷入口。
3. 所有 hover-only 操作补 focus-within；核对 icon button accessible name、aria-expanded、aria-current、aria-pressed/radio 语义。
4. 以容器 query 收口列表/详情/工具栏，验证 URL 查询状态在导航、详情和返回链路中是否按设计保留。

### Phase C：P2 用户偏好

1. 为每种 Motion 元素提供 reduce variant；skeleton/shimmer/spinner 改为静态或非连续反馈。
2. 为关键 surface/overlay 建立不透明回退。
3. 增加 contrast/forced-colors token 覆盖和状态非颜色表达。

### Phase D：P3 长尾迁移

1. 先迁移共享 primitive，再按 6.2 的页面顺序迁移。
2. light/dark/accent × idle/hover/focus/selected/disabled/error 全组合回归。
3. 开启 raw token 检查；每个例外必须在代码附近说明原因。

### 验收矩阵

| 维度 | 必测场景 | 通过标准 |
| --- | --- | --- |
| 键盘 | Tab/Shift+Tab 浏览；Enter/Space 操作；Dialog 的 Esc、循环和返回；快捷键处于 input/textarea/contenteditable 时 | 没有键盘陷阱；焦点始终可见；关闭弹层后回到合理触发点；快捷键不破坏输入 |
| 导航 | 直接打开 /today、/knowledge、/knowledge/:cardId、/review、/stats、/search；列表→详情→返回；刷新 | 标题、当前导航、查询状态和页面结构可辨识；不出现 404 或丢失上下文 |
| 响应式 | 320/375/430/768/1024px，横屏，200% 文字/页面缩放 | 关键功能不依赖二维滚动；详情、Sheet、底栏、批量栏不互相遮挡 |
| 触控 | 真机或 DevTools 测量 button/link/checkbox 的可点击矩形 | 普通移动操作目标尽量 44×44；密集桌面目标至少满足 WCAG 2.2 2.5.8，目标间不重叠 |
| 日历 | 空白日、已有记录日、已有状态日；鼠标、触控、键盘三条路径 | 状态可从移动端显式入口选择；请假/休息/生病/出差有文本和选中反馈；右键不是唯一入口 |
| 动效 | prefers-reduced-motion: reduce | 无持续 shimmer/spinner/位移缩放干扰；信息和操作仍完整 |
| 透明度/对比度 | prefers-reduced-transparency: reduce、prefers-contrast: more、Windows forced-colors: active | 关键 surface 不依赖透明背景；焦点/选中/错误/状态可区分；文字与非文本对比达标 |
| token | light/dark/accent × 页面清单 | 长尾页面不再随意复制共享 primitive 的 raw surface/status 色；例外可解释 |

## 8. 官方一手资料索引

以下链接均为可直接打开的官方资料；上文每项建议已经在对应段落附上来源。

### W3C / WCAG

- [WCAG 2.2 Recommendation](https://www.w3.org/TR/WCAG22/)
- [2.1 Keyboard](https://www.w3.org/TR/WCAG22/#keyboard) / [2.1.2 No Keyboard Trap](https://www.w3.org/TR/WCAG22/#no-keyboard-trap) / [2.1.4 Character Key Shortcuts](https://www.w3.org/TR/WCAG22/#character-key-shortcuts)
- [2.4.1 Bypass Blocks](https://www.w3.org/TR/WCAG22/#bypass-blocks) / [2.4.2 Page Titled](https://www.w3.org/TR/WCAG22/#page-titled) / [2.4.7 Focus Visible](https://www.w3.org/TR/WCAG22/#focus-visible) / [2.4.11 Focus Not Obscured](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum)
- [1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum) / [1.4.10 Reflow](https://www.w3.org/TR/WCAG22/#reflow) / [1.4.11 Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast)
- [2.3.3 Animation from Interactions](https://www.w3.org/TR/WCAG22/#animation-from-interactions) / [2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)
- [4.1.2 Name, Role, Value](https://www.w3.org/TR/WCAG22/#name-role-value) / [4.1.3 Status Messages](https://www.w3.org/TR/WCAG22/#status-messages)

### WAI-ARIA APG

- [APG Patterns overview](https://www.w3.org/WAI/ARIA/apg/patterns/)
- [Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [Dialog Modal Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
- [Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)

### MDN

- [:focus-visible](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/%3Afocus-visible)
- [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion) / [prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-transparency)
- [prefers-contrast](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-contrast) / [forced-colors](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/forced-colors) / [forced-color-adjust](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/forced-color-adjust)
- [env()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- [MDN button 元素](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button)

### Radix / Tailwind / React / Motion

- [Radix Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility) / [Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) / [Collapsible](https://www.radix-ui.com/primitives/docs/components/collapsible) / [Navigation Menu](https://www.radix-ui.com/primitives/docs/components/navigation-menu)
- [Tailwind Responsive Design](https://tailwindcss.com/docs/responsive-design) / [Hover, focus, and other states](https://tailwindcss.com/docs/hover-focus-and-other-states) / [Theme variables](https://tailwindcss.com/docs/theme)
- [React DOM common components and props](https://react.dev/reference/react-dom/components/common)
- [MotionConfig reducedMotion](https://motion.dev/docs/react-motion-config)
