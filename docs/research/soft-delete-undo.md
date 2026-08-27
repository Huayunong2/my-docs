# 批量删除、撤销与回收站方案调研

## 背景与现状

当前知识卡片的批量删除会直接删除数据库记录。前端可以在删除后暂时保留一份 ID 快照，但刷新页面、服务重启或请求失败后，这份快照就无法可靠地恢复数据。因此，“删除后撤销”不能只做成一个 Toast 按钮，而需要一个持久化的数据状态。

本轮目标是让删除操作满足以下约束：

1. 批量删除是原子的，部分失败时不留下半完成状态。
2. 删除后可以在短时间内撤销，也可以在刷新后从回收站恢复。
3. 默认的知识列表、复习队列、项目计数和统计不包含已删除卡片。
4. 恢复时保留卡片正文、标签、项目关系、复习记录和来源信息。
5. 不为了一个小范围能力引入完整 UI 框架；继续复用当前的 Radix UI、Sonner 和已有 API 分层。

## 成熟方案的关键结论

### SQLite：用事务保证批量操作的一致性

SQLite 的事务可以把多条更新组成一个原子操作：成功时整体提交，失败时整体回滚。批量删除因此应当更新一组墓碑字段，而不是逐条物理删除关系和正文，再依赖前端补偿。参考 [SQLite Transactions](https://www.sqlite.org/lang_transaction.html)。

### SQLite：增加可空/默认字段适合作为小步迁移

SQLite 支持通过 `ALTER TABLE ... ADD COLUMN` 增加列；增加带默认值的非空文本字段不需要重写既有行，适合当前项目采用递增 schema version 的迁移方式。参考 [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)。本项目将新增 `deleted_at`，空字符串代表正常记录，时间戳代表已删除记录，以保持现有 SQLite 版本和序列化逻辑简单兼容。

### Radix UI：破坏性确认应使用有语义的对话框

Radix Alert Dialog 针对会中断用户流程、需要明确回应的高风险操作提供了焦点陷阱、Escape 关闭、可访问标题和描述等行为。当前项目已经使用 Radix Dialog，因此删除确认继续沿用这套基础设施，并把真正的物理清理与“移入回收站”分开。参考 [Radix Alert Dialog](https://www.radix-ui.com/primitives/docs/components/alert-dialog)。

### TanStack Query：乐观更新适合后续统一数据缓存层

TanStack Query 的官方模式支持在 mutation 前保存上下文、失败时回滚、成功后失效查询。它适合下一阶段把知识列表和回收站改造成统一 query cache；但本轮不在没有完整 query key/失效策略的情况下做前端乐观删除，而是先使用服务端确认结果，再提供一个真实的恢复请求。参考 [TanStack Query Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)。

## 本轮确定的设计

### 数据模型

- 在 `knowledge_cards` 增加 `deleted_at TEXT NOT NULL DEFAULT ''`。
- 删除只设置 `deleted_at` 和 `updated_at`，不删除卡片正文、项目关联或复习元数据。
- 普通查询统一过滤 `deleted_at = ''`；回收站查询只读取 `deleted_at <> ''`。
- 项目卡片计数只统计未删除卡片；恢复后计数自动恢复。
- 导出默认只导出正常卡片，避免已删除内容被普通备份意外重新导入。

### API

- 保留现有批量接口，新增 `restore` action。
- 现有 `delete` action 改为软删除，保持调用方兼容。
- 增加 `GET /api/knowledge-cards/trash`，供回收站页面读取已删除卡片。
- 恢复与删除都走数据库事务；恢复不重置卡片已有的复习状态。

### 交互

- 删除成功后显示带“撤销”动作的 Toast；点击后调用真实 restore API，而不是只恢复本地数组。
- Toast 消失后，用户仍可通过知识页的“回收站”入口恢复卡片。
- 回收站支持逐条恢复和批量恢复；本轮不提供物理清理，避免把可恢复数据和不可逆操作混在同一轮改造中。
- 删除确认保留当前有语义的确认对话框；“移入回收站”文案明确说明可恢复。

### 验收标准

- 删除多张卡片后刷新，卡片不出现在普通列表；回收站仍可见。
- 点击撤销或在回收站恢复后刷新，卡片重新出现在原项目和原筛选条件下。
- 删除/恢复批量请求任意一条失败时，事务不会留下部分更新。
- 复习页不会继续把已删除卡片作为到期卡片。
- 前端类型检查、前端测试、Rust 检查和持久化测试全部通过。

