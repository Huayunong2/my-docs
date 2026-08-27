# UI 现代化第二轮：调研与落地依据

- 调研日期：2026-08-26
- 范围：侧边栏、视觉 token、知识卡片批量操作、首屏性能
- 原则：优先使用当前项目已有的 React、Tailwind CSS、Radix primitives、Sonner；只有现有能力无法覆盖时才增加依赖。
- 状态：本轮已依据下列资料落地一组低风险改造；后续页面级改造继续沿用这些约束。

## 一手资料结论

### 1. 侧边栏应该是可组合的 shell

shadcn/ui 的官方 Sidebar 文档把侧栏拆成 `SidebarHeader`、可滚动的 `SidebarContent`、`SidebarGroup`/`SidebarMenu` 和固定的 `SidebarFooter`，并提供 `icon` 折叠模式、`Link` 渲染、可控的开合状态和 `Cmd/Ctrl+B` 快捷键。[Sidebar](https://ui.shadcn.com/docs/components/base/sidebar)

因此本项目继续保留自有侧栏，不整体引入 shadcn 组件，但遵守相同的边界：品牌与折叠控制属于固定头部，导航属于独立滚动区，主题/低频设置属于固定底部；折叠状态保存在本地，并支持 `Ctrl/Cmd+B`。

### 2. 批量操作需要独立的选择语义和工具栏

Carbon Design System 的 Data Table 文档将排序、行选择和批量 action toolbar 作为同一个数据表交互模型；选中记录后，操作应集中在明确的表格工具栏中，而不是依赖行 hover 或逐行操作。[Data table usage](https://carbondesignsystem.com/components/data-table/usage/)

本项目因此使用原生 checkbox，表头选择支持“全部/部分/无”三态；筛选后的可见集合选择不会误清除其他集合的选择；移动端批量工具栏固定在底部导航安全区上方。删除、确认、标签和项目动作继续由服务端事务执行，完成/失败使用 Sonner 状态反馈。

### 3. 颜色应使用语义角色而不是组件内散落的灰色

Radix Colors 官方文档建议给颜色 scale 建立 `accent`、`primary`、`neutral` 等语义别名，并为背景、交互、边框和文本分别选择对应阶梯；其 scale 也为浅色/深色模式和透明状态提供成套值。[Aliasing](https://www.radix-ui.com/colors/docs/overview/aliasing)、[Palette composition](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette)

本项目没有为了颜色 token 新增 Radix Colors 依赖，而是在 CSS 中建立 `--ui-canvas`、`--ui-surface`、`--ui-surface-soft`、`--ui-border`、`--ui-text` 和阴影/圆角角色。现有组件通过 `.ui-panel`、`.ui-field`、`.ui-button-*` 等稳定类消费这些角色，主题切换只替换变量值。

### 4. Tailwind v4 的 token 应放在 CSS 主题层

Tailwind 官方文档说明，`@theme` 变量同时是设计 token 和 utility API；普通 CSS 变量适合不需要生成 utility 的语义值，二者可以并存。[Theme variables](https://tailwindcss.com/docs/theme)

本项目保留 `@theme` 中可生成 utility 的品牌色/字体/动画，同时用普通 CSS 变量表达运行时的浅色/深色表面角色，避免为了改一个表面颜色修改大量 JSX utility。

## 本轮设计决策

1. **降低装饰噪音**：普通面板不再使用大面积渐变和毛玻璃；主按钮使用单色 accent，hover 主要通过边框/表面/阴影表达。
2. **正式的复习空状态**：复习队列为 0 时显示“今日复习”状态、待复习数量、今日已复习、已确认卡片和下一批复习日期，并提供知识库/统计两个下一步。
3. **反馈有语义**：知识卡片保存、确认、删除、批量操作的成功/失败用 Sonner 报告；详情内的提示按成功/错误/警告使用不同语义样式，并暴露 `status`/`alert` 语义。
4. **首屏按路由切分**：今日页面包含编辑器和 Markdown 依赖，应与根 shell 一样 lazy-load；页面预加载仍通过现有 `preloadPage` 机制完成。
5. **草稿先保护、服务器再确权**：输入变化时按日期写入本地备份；读取时只有本地版本晚于服务器版本才恢复，服务器成功保存后立即清理。localStorage 只承担短期断网/切页保护，不参与列表、统计和导出的权威数据。
6. **批量动作补齐**：除添加标签、加入/移动/移出项目和删除外，补充移除标签；服务端仍在同一事务内执行，并以不区分大小写的方式匹配要移除的标签。列表行和表头均使用原生 checkbox，筛选后保留的不可见选择会在工具栏中单独说明，并可一键清除。
7. **自动分包优先于手写 vendor 分组**：实测手写 `manualChunks` 会把编辑器、图表和动画的共享运行时带入首屏；移除这层强制分组后由 Vite/Rolldown 根据动态路由自动拆分，生产首屏 JavaScript gzip 从约 533KB 降至 171.5KB，低于仓库现有 180KB 预算。重量级图表/编辑器仍会在进入相应页面时按需加载。
8. **侧边栏承担导航与下一步提示**：在保留可折叠、分组、滚动和固定底部设置的基础上，展开态增加可见的“快速跳转”入口（复用现有 `cmdk` 命令面板），并在有复习数据时提供“复习队列”摘要入口。这样快捷键能力不会藏在文档里，用户也能从导航直接进入当天最明确的下一步；折叠态仍只保留图标和 tooltip，避免窄栏变成第二个信息面板。

## 验收约束

- 不改变现有 API、SQLite 数据模型和 URL 路由契约。
- 桌面侧栏在展开/折叠后仍可用，导航链接仍是真实路由链接。
- 批量选择必须支持键盘和读屏可识别的 checkbox，不因筛选/反选丢失隐藏集合的选择。
- 浅色和深色主题都要通过 `tsc`、生产构建和既有测试；不能以新增视觉效果掩盖错误反馈。
- 浏览器视觉回归仍需在真实桌面/移动 viewport 验收；当前环境没有可用的 in-app Browser，因此本轮以静态检查、构建、测试和 HTTP smoke 为证据，并明确保留人工验收项。
