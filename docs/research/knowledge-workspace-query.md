# 知识工作台搜索、分页与保存视图调研

## 基线问题

当前 `GET /knowledge-cards` 会把所有正常卡片读入 Rust，再在 handler 中做搜索和过滤；知识页也会同时请求过滤结果和完整卡片列表。数据规模较小时这种方式简单，但卡片增长后会造成重复传输、重复渲染和搜索延迟，分页状态也无法写入 URL。

本轮先落地一个不破坏旧客户端的最小切片：新增服务端查询分页接口，优先让全局搜索使用它；现有 `/knowledge-cards` 保留兼容，知识工作台的完整分页迁移留到确认分页选择模型之后。

## 成熟方案结论

### SQLite FTS5：索引负责候选集，LIKE 负责兼容兜底

SQLite 官方文档说明 FTS5 使用 `MATCH` 查询全文索引，并可以按 `rank` 排序；FTS5 也支持外部内容表、前缀查询和辅助函数。[SQLite FTS5](https://www.sqlite.org/fts5.html)

本项目的正文包含中文、英文、标点和标签，不能假设默认 tokenizer 对所有中文子串都能按用户预期分词。因此新索引只作为快速候选集和相关性排序来源，同时保留标题、正文、标签和来源片段的 `LIKE` 兜底；查询语法统一做引号转义，避免用户输入把 `AND/OR` 等 FTS 运算符当成控制语法。

### TanStack Query：分页变量必须进入 query key，切页保留旧数据

TanStack Query 官方文档要求 query function 依赖的变量包含在可序列化 query key 中，这样筛选、搜索词和页码才能分别缓存；分页文档推荐使用 `placeholderData: keepPreviousData`，切页请求时继续展示上一页，避免列表在 pending/success 之间跳闪。[Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)、[Paginated Queries](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries)

当前项目的知识页仍是手动请求，因此第一版先让 API 返回稳定的 `{ cards, total, page, page_size, has_more }` 契约，并将搜索页的页码写入 URL；后续迁移到 Query hook 时可以直接把这些字段映射到 query key 和 `keepPreviousData`。

### TanStack Router：URL 是可分享的工作状态

TanStack Router 官方文档把搜索参数视为应用状态，强调它们适合保存分页、筛选、排序，让刷新、后退、书签和分享保持相同上下文；同时应在路由边界做类型校验。[Search Params](https://tanstack.com/router/latest/docs/guide/search-params)

因此全局搜索页采用 `?q=...&scope=cards&page=...`，查询词变化时回到第 1 页，切换文章/卡片范围时也回到第 1 页；不把页码藏在组件内存中。

### Notion/Anki：保存视图应建立在稳定查询模型之上

Notion 的官方文档把视图、过滤、排序和分组作为同一数据集上的可复用工作状态；Anki 浏览器则把搜索、当前结果选择、全选、反选和撤销放在同一个浏览工作区。[Notion Views, Filters & Sorts](https://www.notion.com/help/views-filters-and-sorts)、[Anki Browsing](https://docs.ankiweb.net/browsing.html)

这说明“保存视图”不应只是保存一个显示名称，而应保存完整的过滤、排序、分页/视图模式契约。本轮先不把不成熟的本地视图直接写进服务端 schema；在查询接口稳定后再增加可迁移的 saved view 实体，避免用户保存了无法复现的客户端状态。

## 本轮设计决策

1. 新增 `GET /api/knowledge-cards/query`，返回分页对象；旧列表 API 不改返回形状。
2. 查询支持当前已有的关键词、类型、状态、标签、项目和“从未使用”过滤，并支持 `updated/created/usage/review` 排序。
3. FTS5 索引覆盖标题、正文、标签和来源片段，使用外部内容表和触发器保持同步；已删除卡片通过主表条件排除。
4. 搜索页卡片 Tab 使用服务端分页，默认每页 24 条；文章 Tab 保持现有搜索实现。
5. 搜索页的 `q`、`scope`、`page` 写入路由查询参数；空查询或切换范围时清理/重置页码。
6. 第一版不引入 TanStack Table/Virtual 或新的 UI 框架。分页接口稳定、数据量达到实际阈值后，再评估知识工作台的虚拟列表和全量迁移。
7. 查询结果在知识工作台和全局搜索页使用 TanStack Query 做短时缓存；query key 包含筛选条件、搜索范围和页码，卡片写入/批量变更后只失效知识卡片相关缓存。编辑器和选中状态仍保留在组件内，避免把草稿生命周期与远端缓存强耦合。

## 后续落地记录

服务端查询契约稳定后，已补上保存视图实体（见 `knowledge-saved-views.md`），并在知识页提供保存/选择/删除入口。前期实现曾保留完整卡片集请求，以支撑详情编辑、重复检测、关联候选和状态计数；后续拆分这些职责后再迁移列表分页，避免先引入虚拟化。

## 后续落地记录（2026-08-26）

在分页契约稳定后，知识工作台已完成第一阶段拆分：

- 主列表改用 `/knowledge-cards/query`，默认每页 24 张；页码和所有筛选条件进入 Query key 与 URL。
- 增加下一页预取、旧响应 revision guard，以及“已有列表时后台刷新”的轻量状态提示。
- 增加 `/knowledge-cards/summary` 聚合接口，状态数量不再依赖拉取完整卡片数组。
- 卡片详情使用现有 `/knowledge-cards/:id` 深链接按需读取；关联候选和重复提示使用小范围服务端查询。
- `allCards` 全量请求已从知识工作台移除；复习页等仍需要完整集合的旧流程暂不在本切片改造。

当前仍保留的边界：主列表仍由本地 state 接收 `fetchQuery` 结果，后续可把列表 observer 迁移为 `useQuery` + `placeholderData: keepPreviousData`，并统一 mutation 失效矩阵；这属于状态模型重构，不与本次分页拆分混在一起。

## 后续落地记录（2026-08-27：数据质量视图）

调研建议把“数据待完善”做成可行动的质量视图，而不是只在卡片详情里提示字段缺失。因此本轮增加了四个明确、可修复的筛选维度：

- `missing_source`：没有来源日期、来源记录/复盘 ID 或证据片段。
- `missing_project`：没有项目关系。
- `missing_tags`：没有标签。
- `short_content`：正文去除首尾空白后少于 24 个字符。

实现方式保持查询职责在服务端：SQLite 聚合接口返回全库活跃卡片的质量计数，分页查询通过 `quality` 参数与关键词、状态、项目、标签等条件做 AND 组合；软删除卡片不会进入计数和结果。状态筛选额外支持只用于读取的 `all` 值，统计页从质量入口打开时不会被默认的“待确认”状态遮蔽。卡片创建/编辑和批量状态 mutation 仍只接受真实的 `draft/confirmed/outdated`。

统计页的“知识健康”区块消费同一个摘要接口，把四类质量计数转换为可点击的修复入口；知识页桌面侧栏与移动端 Sheet 共用同一组质量选项，计数明确标注为全库活跃卡片，避免把全局计数误认为当前组合筛选后的数量。

质量筛选同时进入 TanStack Query key、URL 查询参数、保存视图和详情返回路径。例如 `?quality=missing_source&page=2` 刷新、后退或分享时仍能恢复工作上下文。非法质量值在路由边界和服务端分别拒绝，避免将任意字符串带入 SQL 条件。

本轮暂不引入独立的质量修复向导或自动补全：来源补录需要用户确认原文，项目/标签批量修复已经复用现有批量操作。后续可在真实使用中统计四类问题的修复率，再决定是否做“一键打开缺失字段”的详情动作。

## 验收标准

- 旧客户端请求 `/knowledge-cards` 仍收到数组。
- 搜索页卡片结果显示总数、当前页和上一页/下一页操作；刷新或后退可以回到同一页。
- 中文子串、英文、标签和带标点的搜索词至少有 LIKE 兜底，不因 FTS 语法错误导致 500。
- FTS 触发器能覆盖新建、编辑和软删除；已删除卡片不会出现在查询结果。
- 类型检查、Rust 测试、迁移测试和前端构建通过。
