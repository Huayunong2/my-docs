# UI 现代化第五轮：跨页面颜色 token 迁移

- 调研日期：2026-08-27
- 范围：共享 primitive、浮层、主题层级、状态色、知识页筛选控件
- 当前技术栈：React 19、Tailwind CSS v4、Radix React wrappers、Lucide、Framer Motion、TanStack Router/Query
- 方法：优先核对 Radix Colors、Carbon、Primer、Motion 官方文档，并结合仓库现有 CSS 与组件调用点审计

## 结论

本项目已有 `--ui-*` 语义变量，因此本轮不引入 Material UI、Ant Design 或新的颜色运行时依赖。低风险做法是保留现有变量作为兼容层，补齐 `raised / inset / hover / selected / focus / status / overlay / skeleton` 角色，再按“共享 primitive → 高频页面 → 长尾页面”的顺序迁移。

### 一手资料与决策

1. Radix Colors 把色阶按 background、component background、hover/selected、border/focus、solid background、text 等用途组织，并通过 alias 将具体色值和语义角色分开。因此页面应消费 `surface`、`selected`、`border` 等角色，而不是在调用处拼出某个灰色或具体颜色。[Radix Colors：Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)、[Radix Colors：Aliasing](https://www.radix-ui.com/colors/docs/overview/aliasing)
2. Carbon 将颜色 token 分成 role 与 theme value，并用 layer、field、border、text、support、focus 等角色维持跨组件一致性；深色层级通过表面逐级变亮建立，而不是把所有内容叠在更暗的黑色上。[Carbon：Color overview](https://carbondesignsystem.com/elements/color/overview/)、[Carbon：Color layering](https://carbondesignsystem.com/elements/color/overview/#layering)
3. Carbon Data Table 将 selected、hover、focus 和 batch action 作为不同交互状态；批量栏在选择后独立出现，行级动作应避免与批量上下文混淆。[Carbon：Data table usage](https://carbondesignsystem.com/components/data-table/usage/)
4. Primer 的颜色 primitives 将前景、背景、状态和主题模式拆成平行维度；这支持同一组件在浅色、深色和高对比模式下只替换 token 值，不重写结构。[Primer：Color primitives](https://primer.style/product/primitives/color/)、[Primer：Primitives and theming](https://primer.style/product/primitives/)
5. Motion 官方的 `MotionConfig reducedMotion="user"` 会让整个 Motion 子树尊重系统减少动效偏好，并在偏好开启时禁用 transform/layout 动画、保留较温和的 opacity/backgroundColor 变化。[Motion for React：MotionConfig](https://www.motion.dev/docs/react-motion-config)、[Motion for React：Accessibility](https://motion.dev/docs/react-accessibility)

## 当前仓库审计

`src/index.css` 已经存在 `canvas / surface / border / text / sidebar` 等基础角色，但页面调用中仍有大量直接写死的 `bg-white`、`bg-gray-*`、`text-gray-*`、`dark:bg-white/*` 和状态色。它们不一定都是错误：正文和 markdown 代码块有自己的语义；真正需要优先收敛的是共享浮层、共享控件、知识列表和批量操作栏。

迁移优先级：

| 优先级 | 组件族 | 原因 |
| --- | --- | --- |
| P0 | Dialog/Sheet/Dropdown/Popover/Select | 一处改变即可覆盖多个页面，且最容易出现深色浮层层级不一致 |
| P1 | Tabs、知识筛选、知识列表、批量栏 | 高频操作，selected/hover/focus 语义最密集 |
| P2 | Sidebar、Stats、Archive、Reviews | 页面可见面积大，但需要逐页确认信息层级 |
| P3 | Markdown、编辑器内容、长尾设置卡片 | 内容语义多，不适合机械替换 |

## 本轮实现记录

- `src/index.css` 增加 raised/inset/hover/selected/focus/status/overlay/skeleton 角色，并让 `.ui-modal-surface`、`.ui-floating-surface`、`.ui-alert-*`、`.ui-toolbar`、`.ui-skeleton` 消费这些角色。
- 共享 Dropdown、Popover、Select 内容层和 Sheet/Dialog 遮罩改为统一 raised/overlay token。
- TabsList/TabsTrigger 改用本地 `ui-segment` 语义样式，激活项使用 raised surface，不再直接依赖 `bg-white`。
- Knowledge row 使用 `idle / active / selected` 状态；批量选中有独立边界、背景和 marker，行级 overflow 在批量模式下隐藏。
- Sidebar 支持持久化分组折叠；App shell 使用 `MotionConfig reducedMotion="user"`，并保留 reduced-transparency 的不透明回退。

## 后续迁移规则

1. 共享 primitive 优先使用语义变量，页面特有内容才保留具体色值。
2. `selected` 不与 `hover` 共用同一视觉表达；至少同时使用 surface、边界/marker 和前景层级。
3. `raised` 在深色主题中应比 canvas 更亮一级；浮层不以更重的黑色和阴影弥补层级。
4. 状态色同时提供 surface、border、text 和 solid 角色，不能只靠红/黄/绿颜色传达信息。
5. 迁移后用 light/dark × accent theme × focus/selected/disabled 组合回归；没有真实浏览器截图时，至少保留构建、语义 class 和 DOM 状态检查。

