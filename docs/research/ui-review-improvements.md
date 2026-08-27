# UI review improvements：调研与设计依据

- 调研日期：2026-08-26
- 调研范围：复习 0/知识页、月历、知识卡片批量操作
- 落地状态：先完成调研，再按结论修改产品代码、数据库 schema、API 与界面；本文保留方案与验收依据
- 资料原则：优先采用 W3C/WHATWG 相关规范、SQLite/TanStack/React DayPicker/Radix 官方文档，以及 Carbon/MUI 等成熟设计系统的官方文档

## 结论摘要

| 问题 | 推荐方案 | 与当前仓库的适配性 | 优先级 |
| --- | --- | --- | --- |
| 展开筛选后搜索、新建卡片被挤压 | 将侧栏拆成“固定头部 + 独立滚动筛选区 + 固定底部操作区”，并给 flex/grid 子项补齐 `min-h-0`/`min-w-0` | 直接使用现有 Tailwind CSS；不需要新库 | P0（明显可用性问题） |
| 移动端月历无法选请假等状态 | 日期单击打开移动端 Dialog/bottom sheet；状态用可见的互斥单选项，编辑记录作为独立动作；不把右键菜单作为唯一入口 | 已安装 Radix Dialog、Select；已有 `react-day-picker` 可作为后续增强，不必立即替换当前日历 | P0（功能不可达） |
| 空项目刷新后消失 | 把项目从卡片 JSON 派生值提升为持久化实体；用项目表 + 卡片关系表，项目列表用 `LEFT JOIN` 统计 | SQLite、Axum、现有 API 足够；不需要本地存储或新 ORM | P0（数据丢失/状态不一致） |
| 卡片批量删除、移动等操作 | 原生 checkbox + 三态全选 + 批量操作栏；明确“移动/添加/移出”的语义；服务端单事务执行 | 已有批量 endpoint、Radix Dropdown/Dialog、TanStack Query；需扩展契约和后端事务 | P0（数据操作风险） |

总体判断：当前仓库缺的不是新的 UI 框架，而是三个边界——布局的滚动边界、日期状态的交互边界、项目与卡片关系的数据边界。优先修正这些边界，再做颜色、圆角和“更正式”的视觉细节，返工成本最低。

## 1. 仓库约定、技术栈与当前实现证据

### 1.1 文档与工程约定

扫描仓库根目录后，没有发现根级 `AGENTS.md`，也没有既有 `docs/` 或 `notes/` 研究目录；`README.md` 是现有的主要项目说明。因此按用户指定创建本文件：

`docs/research/ui-review-improvements.md`

本轮没有发现 `AGENTS.md`；研究文档随后作为本轮实现的设计依据，产品改动集中在 `server/src/*`、`src/components/*` 与 `src/lib/api.ts`。

### 1.2 相关技术栈与已安装依赖

`package.json`/已安装依赖显示：

- 前端为 React 19 + Vite + TypeScript + Tailwind CSS 4。
- 已安装 `@radix-ui/react-dialog`、`@radix-ui/react-dropdown-menu`、`@radix-ui/react-select`、`@radix-ui/react-popover`，适合承载 Dialog、菜单、选择器和弹出层的可访问行为。
- 已安装 `react-day-picker@10.0.1`，可用于日历的 modifiers、日期按钮和键盘行为；当前页面仍有自定义月历单元格。
- 已安装 `@tanstack/react-query@5.102.3`，但知识页当前主要通过 API 调用和本地 React state 重新加载数据。
- 后端为 Rust/Axum + SQLite。README 明确把服务器 SQLite 作为手机、网页和桌面端共享的统一数据源；项目领域数据不应以 `localStorage` 作为权威来源。

这里不建议为了实现上述需求额外引入 MUI、Carbon 或新的表格/日历库。它们的官方文档可以作为交互参考；当前依赖已经能覆盖主要行为。

### 1.3 基线根因与工作区待验证状态

以下先记录按 `git diff` 对比出的基线根因，再标出最终校验时工作区中已有的未提交实现。未提交实现不是本轮修改，不能视为已经通过测试或产品验收。

- **侧栏挤压（基线）**：`src/components/KnowledgePage.tsx` 的宽屏布局使用 `240px minmax(340px,430px) minmax(0,1fr)` 三列；第一列同时放搜索、项目、展开式筛选、“新建卡片”和工作流提示。第一列虽然是 flex column，但筛选内容没有明确成为 `flex: 1; min-height: 0; overflow-y: auto` 的独立滚动区域，展开后会和操作区争夺高度。**本轮实现**已经把搜索/搜索按钮放入固定头部、把中间内容放入 `xl:flex-1 xl:overflow-y-auto`、把“新建卡片”放到 `shrink-0` 底部；仍建议在真实设备上做窄屏、缩放和浮层裁剪验收。
- **空项目消失（基线）**：`KnowledgePage.tsx` 的 `createProject` 只修改本地 `projectCounts` 和当前筛选值，没有调用创建项目 API。服务端 `server/src/knowledge.rs` 的 `list_projects` 又是从卡片 `projects` JSON 中反向统计项目，所以零卡片项目在刷新后没有任何数据来源。**本轮实现**新增 `knowledge_projects` 实体表、`POST /knowledge-cards/projects` 创建接口、迁移回填和 `knowledge_card_projects` 关系表；项目列表从项目表 `LEFT JOIN` 计数，零卡项目刷新后仍保留。旧的 `cards.projects` JSON 作为兼容字段，与关系表在同一事务同步。
- **移动端状态不可达（基线）**：`StatsPage.tsx` 的日历单元格在移动端主要是“点击编辑”；状态按钮被 `sm:flex` 隐藏，剩下的状态入口是桌面右键菜单。**当前实现**将移动端日期点击改为底部操作 Sheet，明确提供“编辑记录”和“设置/编辑日期状态”；桌面端仍保留整格编辑与独立状态按钮，状态弹层继续使用现有 Radix Dialog 的 modal、Escape 和焦点管理语义。
- **批量操作的模型不足（基线）**：客户端已有选中 ID 和 `confirm`/`add_tags`/`add_projects`/`delete` 等动作，但 `add_projects` 是追加项目关系，不等于“移动”；删除和状态更新仍有逐卡 `Promise.all` 路径。卡片选择还嵌在外层卡片 `<button>` 内的自定义 `span[role=checkbox]` 中，存在交互元素嵌套和键盘/读屏语义不清的风险。**当前实现**将删除、状态、标签和项目更新收拢到服务端 batch transaction，增加加入/替换/移出项目动作，卡片行改为独立的选择按钮与打开按钮，并在操作后刷新列表与项目计数；移动端批量操作改为固定栏触发底部 Sheet，桌面端继续使用 Radix Dropdown Menu。

## 2. 响应式侧栏：固定操作区，滚动内容区

### 2.1 一手资料结论

1. CSS Flexbox 的默认最小尺寸可能由内容的 min-content 决定，flex item 不会自动缩到比内容更小；需要显式使用 `min-width`/`min-height` 或让滚动容器承担溢出。MDN 的 [`flex`](https://developer.mozilla.org/en-US/docs/Web/CSS/flex) 与 [`min-width`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/min-width) 文档分别说明了 flex 收缩和自动最小尺寸的行为。
2. CSS Grid 的 `minmax()` 定义轨道的最小/最大尺寸范围；使用 `minmax(0, 1fr)` 可以让可伸缩轨道真正分配剩余空间，而不是被子内容的最小尺寸撑开。参见 MDN [`minmax()`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/minmax) 和 W3C [CSS Grid Layout 规范](https://www.w3.org/TR/css-grid-1/)。
3. Tailwind 官方文档将 `grid-cols-*` 映射为 `minmax(0,1fr)` 轨道，也支持显式的任意值网格模板；`shrink-0` 用于禁止一个 flex item 收缩，`overflow-y-auto` 用于只在需要时产生纵向滚动。参见 [Grid Template Columns](https://tailwindcss.com/docs/grid-template-columns)、[Flex Shrink](https://tailwindcss.com/docs/flex-shrink) 和 [Overflow](https://tailwindcss.com/docs/overflow)。
4. Tailwind 的响应式前缀是 mobile-first；官方示例展示了在较宽断点启用 `flex`/`shrink-0`，而不是让同一个布局在所有宽度下硬挤。参见 [Responsive Design](https://tailwindcss.com/docs/responsive-design)。

### 2.2 适用于本仓库的布局设计

建议把知识页第一列看成一个垂直 shell，而不是一个“所有内容一起滚动”的面板：

```text
知识页第一列（flex column，min-h-0）
├─ 搜索与项目入口                 shrink-0
├─ 状态/类型/使用/标签筛选         flex-1 min-h-0 overflow-y-auto
└─ 新建卡片 + 必要的批量/工作流入口  shrink-0
```

可对应到现有 Tailwind 类的实现契约如下：

```text
aside:       flex min-h-0 flex-col
header:      shrink-0
filterBody:  min-h-0 flex-1 overflow-y-auto
primaryCTA:  shrink-0
wideMain:    min-w-0
wideGrid:    240px minmax(340px,430px) minmax(0,1fr)
```

具体建议：

- 搜索框、项目切换、新建项目输入框和“新建卡片”按钮保留在固定区，筛选项和标签列表进入唯一的滚动区。这样筛选再长也不会把搜索与主 CTA 压缩到不可用。
- 侧栏自身及其父级必须允许收缩：从页面到三列 grid 的中间层逐级检查 `min-h-0`；主内容列使用 `min-w-0`。只在子项加 `overflow-hidden` 而不修正最小尺寸，容易把内容裁掉或导致焦点不可见。
- “新建卡片”在移动端可作为底部固定/粘性主按钮，但要为安全区留出空间，并避免覆盖筛选区最后一项；桌面端保持固定底部区即可。
- 宽屏三列可以继续使用现有的 `minmax(0,1fr)` 思路；在平板或主区较窄时提前切换为抽屉/两列/单列，而不是等到 `xl` 后仍强行保持三列。断点应以可用主区宽度验收，而不是只看浏览器 viewport。
- 筛选区内部可以保留展开动画，但动画只改变滚动区内容高度；不要让整个侧栏或 CTA 参与高度竞争。已有 `@formkit/auto-animate`/CSS transition 足够，不需要新增布局库。

### 2.3 适用性与风险

**适用性**：完全基于现有 CSS/Flex/Grid/Tailwind；不改变 API、数据结构或组件库。它直接针对当前第一列“搜索—项目—展开筛选—新建卡片”共用高度的问题。

**风险**：

- 如果筛选区高度过短，用户会感觉滚动层级增多；建议只让标签/筛选选项滚动，搜索和主要动作永远可见。
- `overflow-hidden` 可能裁剪 Radix Popover/Select 的浮层；浮层应通过 portal 或放在不会裁剪的层级，不能为了修布局把弹层截断。
- 如果只在 `xl` 测试，平板横屏仍可能出现三列拥挤；至少验收 1024、1280、1440 CSS px，以及浏览器缩放 200% 的情况。

## 3. 移动端月历：日期操作 sheet + 互斥状态

### 3.1 一手资料结论

1. W3C ARIA Authoring Practices 的 [Date Picker Dialog 示例](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/)把日期选择放在有名称的 modal dialog 中，并规定了 Escape 关闭、焦点返回触发按钮、日历键盘导航、月份标题 live region 和完整星期名称等行为。该页面也明确提醒示例需要结合实际辅助技术测试，不能把示例代码当成自动合规保证。
2. ARIA [Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)指出 grid 是复合组件，通常只有一个元素进入 Tab 顺序，内部用方向键移动；如果每个日期只承载一个控件，应优先让该控件获得焦点。若不需要复杂网格键盘模型，不应为了添加 ARIA 而把普通按钮网格复杂化。
3. 已安装的 React DayPicker 官方文档支持用 [custom modifiers](https://daypicker.dev/guides/custom-modifiers) 表达不同日期状态，用 [custom components](https://daypicker.dev/guides/custom-components) 扩展日期按钮；自定义组件必须转发 `aria-*`、`tabIndex`、`ref` 和事件处理器，以保留默认的键盘和读屏行为。其 [custom selections](https://daypicker.dev/guides/custom-selections) 文档还说明了自定义状态时 Enter/Space 的处理。
4. 已安装的 Radix Dialog 官方文档说明 Dialog 提供 modal 语义、焦点移入/恢复、Escape 关闭以及 Title/Description 关联：[Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)。Radix Select 文档说明其键盘与标签模式：[Select](https://www.radix-ui.com/primitives/docs/components/select)。本仓库已有这两个依赖和封装。
5. WAI-ARIA [Radio Group pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)适用于同一日期只能选一个状态的情况；如果使用自定义单选控件，需要 radiogroup 名称、`aria-checked` 和方向键行为。仓库没有安装 `@radix-ui/react-radio-group`，因此优先考虑原生 `input[type=radio]`；紧凑空间下也可复用已有 Select，而不是为了单选专门引入新包。
6. WCAG 2.2 的 [2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)规定指针目标通常至少为 24×24 CSS px；[2.4.11 Focus Not Obscured](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum)要求焦点控件不能被作者创建的内容完全遮挡；[4.1.3 Status Messages](https://www.w3.org/TR/WCAG22/#status-messages)要求状态变化能被辅助技术感知而不必强制抢焦点。

### 3.2 适用于本仓库的交互设计

移动端点击某个日期后，建议打开一个带标题的 bottom sheet/Dialog，而不是直接把“编辑”当成唯一动作：

```text
2026 年 8 月 26 日
当前状态：未记录 / 已记录 / 请假……

状态（互斥）
○ 无例外（清除状态）
○ 休息
○ 请假
○ 生病
○ 出差

[编辑当天记录]                         [保存状态]
```

建议的交互规则：

- 日期单元格本身提供可发现的单击/触摸入口；右键菜单只能作为桌面快捷方式，不能是移动端选状态的唯一入口。
- “编辑当天记录”和“设置例外状态”是两个并列意图。已有文章时，服务端当前会拒绝同日 exemption；UI 应显示“已有记录，编辑记录”并禁用/隐藏冲突的例外状态，而不是让用户选择后再收到难以理解的 409。
- `休息/请假/生病/出差` 属于同一天的互斥例外原因；“清除原因”应回到无例外状态。不要同时把它们建成多个独立开关。
- 状态不能只靠颜色表达。日期单元格应同时显示文字、图标或可读的 `aria-label`，例如“8 月 26 日，请假，点击编辑状态”；颜色仅用于辅助区分。
- Dialog 内的状态选项和按钮要能在窄屏触摸；底部 sheet 内容在键盘弹出、浏览器底部工具栏和安全区变化时仍可滚动，不能挡住当前焦点。状态保存后用 `aria-live="polite"` 或 Radix Toast/现有反馈机制报告“已设置为请假”，不要强制把焦点跳到页面顶部。
- 如果继续保留自定义 7 列月历，优先将日期 cell 改为原生 `button` 并处理焦点；不要在 `div[role=button]` 上叠加越来越多的 ARIA。若迁移到 DayPicker，用 modifiers 标记状态、用其 `DayButton`/custom component 扩展内容，并严格转发官方要求的属性。

### 3.3 适用性与风险

**适用性**：Radix Dialog、Select 和现有 `safe-bottom` 样式可以承载移动端 sheet；后端已有 day exemption 的 GET/PUT/DELETE API 和原因枚举。现有数据约束（有文章的日期不能有 exemption）可以转化为明确的 UI 状态机。

**风险**：

- 不能把“状态”任意扩展成后端不存在的枚举；先区分“记录存在”和“例外原因”，否则前后端会出现不一致。
- 自定义 ARIA grid 的键盘行为、读屏朗读和触摸行为很容易不完整；若只是选择日期，原生按钮或 DayPicker 的默认按钮比手写完整 grid 更稳。
- 底部 sheet 若使用普通 fixed div，必须自行补齐 modal role、焦点陷阱、Escape、返回触发点和读屏名称；优先复用现有 Radix Dialog 封装。
- 7 列在小屏上每格宽度有限，日期数字的点击目标和状态按钮不要全部塞进 cell；把复杂动作放进 sheet 能降低误触。

## 4. 空项目持久化：项目必须是实体，不是卡片统计的副产品

### 4.1 根因

当前 `createProject` 的本地更新只制造了一个临时的 `projectCounts` 项；服务端 `list_projects` 则从已有卡片的 `projects` JSON 反向统计名称。一个没有卡片的项目既没有数据库行，也没有卡片关系，刷新后自然无法被查询出来。这是持久化模型缺少“项目实体”的问题，不是 React cache 或刷新时机问题。

### 4.2 一手资料结论

1. SQLite [LEFT JOIN 文档](https://www.sqlite.org/lang_select.html)说明左连接会保留左侧数据集的行，即使右侧没有匹配项；这正是“零卡片项目仍显示，数量为 0”的查询语义。把卡片筛选条件误放进 `WHERE`，会再次把没有匹配卡片的行过滤掉。
2. SQLite [Foreign Key 文档](https://www.sqlite.org/foreignkeys.html)说明外键用于保证关系两端存在，并支持 `ON DELETE`/`ON UPDATE` 动作；关系表应建立索引，且 SQLite 需要显式启用 foreign-key enforcement。项目与卡片关系不能只靠字符串拼接来保证完整性。
3. SQLite [Transaction 文档](https://www.sqlite.org/lang_transaction.html)说明显式 transaction 可以将多个写操作组成原子提交；[UPSERT 文档](https://sqlite.org/lang_upsert.html)说明可依据唯一约束在冲突时更新/忽略。创建项目、迁移回填、批量移动都应利用这些原语。
4. TanStack Query 官方 [Invalidations from Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)建议在 mutation 成功后使相关 query 失效并重新获取。若知识页后续统一改为 Query 管理，这比只改本地计数更可靠；当前手动 reload 也必须同时刷新项目列表和卡片列表。

### 4.3 推荐的数据模型与查询策略

推荐把项目提升为独立实体，并把卡片与项目建成多对多关系：

```text
knowledge_projects
  id TEXT PRIMARY KEY
  name TEXT NOT NULL UNIQUE
  created_at / updated_at
  archived_at（可选；如果产品需要归档而不是删除）

knowledge_card_projects
  card_id TEXT NOT NULL REFERENCES knowledge_cards(id) ON DELETE CASCADE
  project_id TEXT NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE
  PRIMARY KEY (card_id, project_id)
```

建议策略：

- 新建项目先写 `knowledge_projects`，成功后才切换当前项目；刷新时项目列表直接查项目表，因此 0 卡片项目自然保留。
- 从现有 `knowledge_cards.projects` JSON 做一次幂等迁移：先按清洗后的名称去重创建项目，再写关系表；整个 schema migration/backfill 放在 transaction 中。迁移期间选择一个 canonical source，避免 JSON 和关系表以后各自被修改。
- 项目名需要明确规范化规则：至少 trim 空白，决定是否大小写不敏感；唯一约束应和产品规则一致，避免“FPGA-DIAG”和“ FPGA-DIAG ”变成两个项目。
- 项目列表可采用如下语义（伪 SQL，仅表达查询约束）：

  ```sql
  SELECT p.id, p.name, COUNT(cp.card_id) AS card_count
  FROM knowledge_projects AS p
  LEFT JOIN knowledge_card_projects AS cp
    ON cp.project_id = p.id
  GROUP BY p.id, p.name
  ORDER BY p.name;
  ```

  关键不是这段 SQL 的具体命名，而是从项目表出发并使用 `LEFT JOIN`；否则数量为 0 的项目永远无法出现。
- 卡片列表按项目过滤时使用关系表上的 join/`EXISTS`，不要继续把“项目是否存在”与“卡片是否存在”混在一个 JSON 统计接口里。导入/导出也应以稳定项目 ID 或规范化名称转换关系，避免重命名后产生孤儿关系。
- 如果暂时不做完整多对多迁移，最低可行方案是增加独立项目表并把当前名称作为唯一键；但只要卡片允许属于多个项目，关系表是更稳妥、也更容易支持移动/移出/重命名的长期模型。

### 4.4 适用性与风险

**适用性**：不需要 ORM 或新依赖；Rust/Axum handler、现有 SQLite migration 和 API 层即可实现。该模型同时解决空项目刷新、项目重命名、批量移动和计数准确性。

**风险**：

- 迁移必须覆盖旧卡片 JSON、重复名称、空名称和回滚；不能只新增表而不回填。
- 双写 JSON 与关系表会形成新的不一致源。推荐关系表为唯一写入来源；过渡期若保留 JSON，只读兼容或在同一 transaction 内同步。
- “删除项目”是删除实体还是归档需要产品决定；删除实体时必须明确卡片关系是否解除、卡片本身是否保留。默认应保留卡片。
- 开启外键 enforcement、增加关系表索引后，旧数据中的坏引用可能暴露；应在迁移前做检查并输出可诊断错误。
- TanStack Query 失效/重取只能解决客户端缓存，不会替代服务端持久化；即使继续使用当前手动 reload，也要在创建/移动成功后刷新项目与卡片两个数据集。

## 5. 卡片批量操作：选择范围明确，动作语义可逆/可确认

### 5.1 一手资料结论

1. WAI-ARIA [Checkbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/)定义了二态/三态 checkbox；全选框在部分行已选时应反映 `mixed`，Space 可切换，且每个 checkbox 必须有可访问名称。
2. WAI-ARIA [Toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)适合把一组相关按钮、checkbox 和菜单组织成带名称的工具栏；多个批量动作出现后，应给工具栏一个 `aria-label`/`aria-labelledby`，而不是让读屏用户遇到无名按钮集合。
3. WAI-ARIA [Listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)强调多选时选择状态与焦点状态是两个概念，且推荐不要求用户按住 Ctrl/⌘ 才能选择；如果使用 listbox 模式，必须完整实现其键盘/`aria-multiselectable` 语义。对于当前卡片列表，原生 checkbox 通常比把整组卡片改造成 listbox 更简单。
4. Carbon Design System 的 [Data Table batch actions](https://carbondesignsystem.com/components/data-table/usage/)建议多选 checkbox、表头三态全选，选中后在顶部显示 batch action bar；进入批量模式时禁用容易产生歧义的行内操作，并提供取消/取消全选。其 [responsive data table](https://carbondesignsystem.com/components/data-table/usage/#responsive)相关说明也强调移动端的行操作不能只依赖 hover。
5. MUI X 的 [Row selection](https://mui.com/x/react-data-grid/row-selection/)文档区分“全选所有行”和“只选当前可见行”，并说明筛选/服务端分页下是否保留不可见行的选中状态是一个必须明确的选择；`keepNonExistentRowsSelected` 是其保留 selection 的示例。这是成熟表格对“选择范围”歧义的直接提醒，不代表需要引入 MUI。
6. 已安装的 Radix Dropdown Menu 支持可勾选项、子菜单、焦点管理、键盘导航和碰撞处理：[Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu)。它适合移动端把次要批量动作放进“更多”菜单，但删除、移动等关键动作仍应有清晰可见的入口和确认。
7. WCAG 2.2 的目标尺寸、焦点不被遮挡、状态消息要求同样适用于批量工具栏；对应规范见 [2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum)、[2.4.11](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum) 和 [4.1.3](https://www.w3.org/TR/WCAG22/#status-messages)。

### 5.2 推荐的批量交互契约

#### 选择

- 每张卡片使用原生 checkbox，名称形如“选择《卡片标题》”；卡片打开动作与 checkbox 分开，避免当前“外层 button + 内层 role=checkbox”的嵌套交互。
- 列表头提供“选择当前可见卡片”的原生 checkbox。部分可见行选中时使用 `indeterminate`/`aria-checked="mixed"`；Space、Enter 和触摸都应可用，焦点轮廓保持可见。
- 选中一张以上时显示命名的批量工具栏，并明确“已选 N 张”。建议动作分为：

  - `移动到项目`：从当前项目移出并加入目标项目，或在全量视图中弹窗要求选择“替换全部项目关系/仅追加”；
  - `添加到项目`：保留原项目关系，追加目标项目；
  - `移出当前项目`：只删除当前项目关系；
  - `添加标签`、`批量确认`；
  - `删除`：单独作为危险动作。

- 目前项目是多值数组，所以“移动”绝不能只显示一个含糊的“改项目”。至少在弹窗中显示来源、目标以及“是否保留其他项目”的明确说明。若当前处于“全部卡片”视图、没有单一来源项目，应要求用户选择移动模式或禁用模糊动作。
- 先确定选择范围并在 UI 中写出来：默认建议“当前可见”，另提供“选择全部匹配结果”而不是静默保留隐藏 ID。切换筛选后若保留了隐藏选中项，应继续显示数量和范围；若清除，应提示“筛选变化，已清除不可见选择”。
- 在移动端，工具栏可以变成安全区内的 sticky bottom bar；动作过多时使用 Radix Dropdown 的“更多操作”，但不能只在 hover 或桌面右键时出现。

#### 服务端动作

建议把现有 batch API 扩展为有明确语义的动作，而不是继续让 `add_projects` 承担移动：

```text
move_project   { card_ids, source_project_id?, target_project_id }
add_project    { card_ids, target_project_id }
remove_project { card_ids, project_id }
delete         { card_ids }
```

服务端契约还应满足：

- 去重并校验 ID、项目是否存在、来源关系是否匹配；返回 `updated`、`skipped`、错误明细或可诊断原因，不能只返回一个模糊的总数。
- 一个批量请求在一个 SQLite transaction 内完成，成功则整体提交，失败则整体回滚；逐卡 `Promise.all` 可能造成部分成功，前端很难向用户解释。
- `delete` 前端显示确切数量和影响范围；成功后清空 selection、刷新列表/项目计数并以状态消息报告结果。若要提供撤销，必须先有可恢复机制，不能只在 UI 上放“撤销”而没有后端保证。
- 批量移动要和项目实体/关系表的迁移保持一致；如果项目仍只是卡片 JSON，无法可靠地区分“从当前项目移出”和“替换全部项目”。

### 5.3 适用性与风险

**适用性**：现有批量 endpoint、Radix Dropdown/Dialog、原生 HTML checkbox 和现有反馈组件足以承载第一版；不需要引入 MUI Data Grid 或新的批量操作库。

**风险**：

- 若继续只对“待确认草稿卡”显示选择，必须把这是业务限制写在 UI 上；否则用户会以为已确认卡片也能批量删除/移动。当前代码的 `visibleDraftIds` 使选择范围看起来像隐式限制。
- 筛选、分页和全选的范围若不明确，最容易出现误删/误移动；应把范围写入确认文案和可访问名称。
- 大批量 ID 会增加请求体和 SQLite 写锁时间；可设置上限、分批但在服务端 transaction 中处理，或返回 job 状态。不要为了避免超时退回逐卡无原子性的 `Promise.all`。
- 删除、移动和项目归属变化会同时影响卡片列表、项目计数和筛选结果；成功后不能只更新当前行，需刷新所有相关查询/状态。

## 6. 建议的落地顺序与验收清单

### 6.1 建议顺序

1. 先确定项目实体/关系模型和 batch 动作契约，因为“空项目保留”和“移动到另一个项目”共享同一数据边界。
2. 实现移动端日期状态的状态机与 Dialog 入口，保留后端现有“有文章不可 exemption”约束，并用 UI 提前解释冲突。
3. 调整知识页侧栏的滚动边界，确保新 UI 的项目列表和筛选项不会重新挤压搜索/CTA。
4. 最后完善批量工具栏视觉层级、正式感、反馈和动画；视觉调整不应改变上述状态/数据契约。

### 6.2 验收清单

**布局**

- 展开全部筛选、标签很多时，搜索输入和“新建卡片”仍可见、可聚焦、可点击。
- 1024/1280/1440 宽度、200% 缩放和键盘 Tab 顺序没有横向溢出或被裁剪的浮层。
- 移动端没有双重滚动困惑；sticky CTA 不遮住最后一项，也不遮住键盘焦点。

**月历**

- 手机单击任意日期即可发现“请假/休息/生病/出差”和清除入口，不需要右键、hover 或长按猜测。
- 有文章日期的例外操作被清晰解释；保存后月历文字/图标和读屏状态同步更新。
- Dialog 有标题、描述、Escape/返回关闭、焦点恢复和安全区；状态目标至少达到 WCAG 2.5.8 的 24×24 CSS px，实际操作建议更大。

**项目持久化**

- 新建 0 卡片项目后刷新、重新登录、手机端访问仍存在且计数为 0。
- 新建同名/空白名、迁移重复名称、项目归档/删除的结果符合产品规则。
- 创建、重命名、移动、删除项目关系不会留下孤儿关系；迁移失败可回滚。

**批量操作**

- 0/1/多张、全选/部分选择、筛选后选择、空项目移动和跨项目移动都有明确反馈。
- “移动”“添加”“移出”在确认文案中含义不同；删除显示准确数量并有取消路径。
- 键盘可选中、取消和执行动作；全选框能表达 mixed；状态变化由 `aria-live` 或等价机制播报。
- 批量请求是原子操作，部分失败不会悄悄留下用户不知道的半成品状态；项目计数、卡片列表和 selection 一起刷新。

## 7. 来源索引

以下链接均为本研究实际采用的官方规范、官方文档或成熟项目官方设计系统文档：

- CSS/Tailwind：
  [MDN flex](https://developer.mozilla.org/en-US/docs/Web/CSS/flex)、[MDN min-width](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/min-width)、[MDN minmax](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/minmax)、[W3C CSS Grid](https://www.w3.org/TR/css-grid-1/)、[Tailwind grid columns](https://tailwindcss.com/docs/grid-template-columns)、[Tailwind flex shrink](https://tailwindcss.com/docs/flex-shrink)、[Tailwind overflow](https://tailwindcss.com/docs/overflow)、[Tailwind responsive design](https://tailwindcss.com/docs/responsive-design)
- 日期与可访问交互：
  [WAI-ARIA date picker dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/)、[WAI-ARIA grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)、[WAI-ARIA radio](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)、[React DayPicker custom components](https://daypicker.dev/guides/custom-components)、[React DayPicker custom modifiers](https://daypicker.dev/guides/custom-modifiers)、[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)、[Radix Select](https://www.radix-ui.com/primitives/docs/components/select)
- SQLite/数据一致性：
  [SQLite SELECT/LEFT JOIN](https://www.sqlite.org/lang_select.html)、[SQLite foreign keys](https://www.sqlite.org/foreignkeys.html)、[SQLite transactions](https://www.sqlite.org/lang_transaction.html)、[SQLite UPSERT](https://sqlite.org/lang_upsert.html)、[TanStack Query mutation invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)
- 批量选择与操作：
  [WAI-ARIA checkbox](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/)、[WAI-ARIA toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)、[WAI-ARIA listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)、[Carbon data table usage](https://carbondesignsystem.com/components/data-table/usage/)、[MUI X row selection](https://mui.com/x/react-data-grid/row-selection/)、[Radix Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu)
- WCAG 2.2：
  [2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)、[2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum)、[4.1.3 Status Messages](https://www.w3.org/TR/WCAG22/#status-messages)
