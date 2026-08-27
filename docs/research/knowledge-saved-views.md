# 知识库保存视图调研与方案

## 为什么现在做

服务端查询已经有稳定的筛选、排序、分页契约，下一步可以把常用工作状态保存下来。否则“待确认”“本周复习”“无项目”等工作流每次刷新都要重新点选，URL 虽能保存一次状态，但不能形成可复用入口。

## 一手资料结论

- Notion 官方把 view、filter、sort、group 作为同一数据集上的可复用配置；视图的价值在于反复回到同一种工作上下文，而不是单纯给列表换一个名字。[Views, Filters & Sorts](https://www.notion.com/help/views-filters-and-sorts)
- Anki 浏览器把搜索结果、当前结果选择、全选、反选和撤销放进同一浏览工作区；保存视图后仍应回到同一查询语义，而不是另建一份卡片副本。[Browsing](https://docs.ankiweb.net/browsing.html)
- TanStack Router 官方建议把分页、筛选、排序等应用状态保存在经过验证的 search params 中，以支持刷新、后退、书签和分享。[Search Params](https://tanstack.com/router/latest/docs/guide/search-params)
- SQLite 的 UPSERT/事务适合把一个保存视图作为独立实体写入，并保持名称与 JSON 配置的一致性；视图不是卡片数据的派生统计，不应只放在前端 localStorage。[SQLite Transactions](https://www.sqlite.org/lang_transaction.html)、[SQLite UPSERT](https://sqlite.org/lang_upsert.html)

## 确定的最小设计

### 数据

新增 `knowledge_saved_views` 表：

```text
id, name, filters_json, created_at, updated_at
```

`filters_json` 只保存已经存在的查询字段：`q`、`project`、`tag`、`status`、`type`、`usage`、`sort`。不保存结果、不复制卡片，也不把分页页码保存进视图；打开视图时从第 1 页开始，当前页仍由 URL 管理。

### API

- `GET /knowledge-cards/views`
- `POST /knowledge-cards/views`：创建名称和筛选配置
- `PUT /knowledge-cards/views/:id`：更新名称/配置，预留给后续编辑
- `DELETE /knowledge-cards/views/:id`

名称 trim 后限制长度；筛选配置由服务端白名单化，未知字段丢弃，避免把前端任意 JSON 变成未来无法迁移的永久契约。

### 交互

- 知识页顶部显示紧凑的“保存视图”入口和已保存视图下拉列表；视图名称是主要识别，当前过滤条件仍可从 URL 看到。
- 打开视图会应用筛选并将 `q/project/tag/status/type/usage/sort/page` 写入 URL，页面刷新和后退保持一致。
- 删除视图只删除视图配置，不删除卡片；危险删除使用现有 Radix Dialog/确认基础设施。
- 本轮不做复杂的分组、可见列和共享权限，避免把个人知识库提前扩展成协作数据库。

## 验收标准

- 创建的视图服务重启后仍存在。
- 打开视图后筛选、排序与 URL 一致，刷新后结果不变。
- 删除视图不会影响卡片、项目和回收站数据。
- 空名称、未知筛选字段和非法枚举不会写入不可用配置。
- 数据库迁移、前后端类型检查、构建和测试通过。

