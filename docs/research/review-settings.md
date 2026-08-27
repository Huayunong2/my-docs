# 复习设置成熟方案调研

> 调研日期：2026-08-26  
> 范围：每日新卡上限、单次复习批次上限、FSRS 参数暴露范围、设置持久化与默认值/边界。  
> 来源约束：只采用 Anki 官方手册、Anki 官方源码仓库和 FSRS 官方仓库；文中“建议”属于结合本项目现状得出的产品推论，不等同于来源硬性规定。

## 结论先行

首期只建议暴露两个设置：

1. **每日新卡上限**：控制每天最多引入多少张尚未学习过的卡片。
2. **单次复习批次上限**：控制一次打开复习页时装载/展示多少张卡片，是本应用的会话体验设置，不改变卡片的 FSRS 状态或到期日期。

建议首期默认值为：

| 设置 | 默认值 | 建议边界 | 作用域 |
| --- | ---: | ---: | --- |
| 每日新卡上限 | 20 | `0–100` | 全局默认；首期不做项目级覆盖 |
| 单次复习批次上限 | 20 | `1–100` | 全局 |
| FSRS 期望保持率 | 90%（内部默认） | 首期不开放编辑 | 全局算法默认 |
| FSRS 原始参数向量 | 内置默认/后续优化结果 | 不提供手工输入 | 系统内部 |

其中 20 和 100 是本项目的产品建议，不是 Anki 或 FSRS 规定的固定数值。当前服务端每日新卡默认值已经是 20，因此首期沿用它可以避免升级后突然改变用户负担。

## 官方产品做法

### 1. 每日新卡上限是负载控制，不是一次加载数量

Anki 官方把 `New Cards/Day` 定义为“每天可以引入的新卡数量”，并明确说明：如果当天学习少于上限，或中间漏学一天，下一天不会因为欠额而额外发放卡片；上限仍回到原设定值。[Anki Deck Options — New Cards/Day](https://docs.ankiweb.net/deck-options.html#new-cardsday)

Anki 同时提醒，新卡会在短期内带来额外学习/复习负担；官方举例说明，持续每天引入 20 张新卡，日复习量可能大约达到 200 张。因此这个设置应被解释为“控制长期负担”，而不是“今天想学多少就补多少”。[Anki Deck Options — Daily Limits](https://docs.ankiweb.net/deck-options.html#daily-limits)

Anki 的上限与牌组层级、预设相关：官方支持为多个牌组共享 preset，也允许牌组和子牌组拥有不同的限制；选中的牌组还控制整个学习会话的总量。[Anki Deck Options — Presets and Subdecks](https://docs.ankiweb.net/deck-options.html#presets)

**对本项目的推论：**首期应把每日新卡上限定义为一个持久化的“计划设置”，每天按自然日重新计算剩余额度，不做未使用额度结转；未来若项目模型成熟，再增加项目级覆盖或 preset，而不是第一版就复制 Anki 的完整层级规则。

### 2. 每日复习上限与单次批次上限必须分开

Anki 还提供 `Maximum Reviews/Day`，它限制一天最多展示多少张到期复习卡；达到上限后，即使仍有等待中的卡片，也不会继续展示，并会在完成页提示仍有卡片被隐藏。[Anki Deck Options — Maximum Reviews/Day](https://docs.ankiweb.net/deck-options.html#maximum-reviewsday)

这不是“单次打开页面加载多少张”的设置。Anki 的官方牌组选项页面列出了每日限制、学习步骤、排序等调度选项，但没有把“单次 UI 批次大小”作为独立的 FSRS 参数或调度参数。[Anki Deck Options](https://docs.ankiweb.net/deck-options.html)

**对本项目的推论：**

- `每日新卡上限`影响“今天允许引入多少新卡”，应参与服务端 due 队列计算。
- `单次复习批次上限`只影响一次会话取多少张卡，属于分页/会话体验层；不能减少卡片的真实到期数量，也不能写入 review log。
- 当剩余到期卡多于批次上限时，应显示“本批完成，仍有 N 张待复习”，提供“继续下一批”，避免用户误以为已经完成全部复习。
- 本项目当前只有一个全局复习队列，因此首期批次上限用全局设置即可；若将来支持项目/牌组，应先明确“总批次上限”与“项目子限额”的优先级。

### 3. FSRS 的期望保持率可以配置，但原始参数不应手工暴露

Anki 官方把 FSRS 的 `Desired Retention` 定义为卡片再次到期时希望记住它的概率，默认值为 90%；官方说明，提高保持率会缩短间隔并显著增加复习量，接近 100% 时负担会快速上升，并建议保持在 97% 以下。[Anki Deck Options — Desired Retention](https://docs.ankiweb.net/deck-options.html#desired-retention)

Anki 官方还说明，FSRS 参数应通过优化器根据用户自己的复习历史生成，不应手工修改，也不应直接复制别人的参数；优化需要一定数量的复习记录，官方建议不必频繁执行，约每月一次即可。[Anki Deck Options — FSRS Parameters](https://docs.ankiweb.net/deck-options.html#fsrs-parameters)

FSRS 官方 Rust 实现的调度接口以 `desired_retention` 和持久化的 `MemoryState` 为输入，并由 `next_states` 返回四种评分后的下一状态/间隔；这说明保持率和记忆状态属于调度契约，而不是普通 UI 显示字段。[FSRS-rs README — Schedule reviews](https://github.com/open-spaced-repetition/fsrs-rs#schedule-reviews)

FSRS 官方示例还展示了对用户复习历史进行参数优化，并强调运行时需要保存用户的 FSRS 参数/记忆状态；但它没有要求应用必须提供手工编辑参数的界面。[FSRS-rs README — Optimize parameters from review logs](https://github.com/open-spaced-repetition/fsrs-rs#optimize-parameters-from-review-logs)

**对本项目的首期决策：**

- 不在普通“复习设置”中暴露 21 个左右的原始 FSRS 权重输入框。
- 继续内部使用当前 0.90 期望保持率，先保证评分、预览和落盘调度一致。
- 如果后续确实需要高级设置，先只开放带解释和预估负担的“期望保持率”，建议边界为 `0.80–0.95`，默认 `0.90`；`0.95–0.97` 可放到“高级”并显示负担警告，禁止或谨慎支持更高值。
- “优化 FSRS 参数”应是独立的高级流程：需要足够复习记录、显示数据范围和影响说明，并默认不立即重排已有卡片。Anki 官方明确提醒，改变参数后是否重排到期日期是另一个选择，而且重排可能让大量卡片立即到期。[Anki Deck Options — Reschedule Cards on Change](https://docs.ankiweb.net/deck-options.html#reschedule-cards-on-change)

## 设置持久化设计

### 推荐契约

设置应由服务端作为唯一事实来源持久化，前端只缓存和编辑，不把 `localStorage` 当作复习计划的最终存储。原因是每日额度、批次边界和 FSRS 状态都会影响服务端队列；只写浏览器会造成刷新、换设备或多个客户端之间不一致。

首期建议保存以下键值，并保留显式 schema/version 迁移：

```text
review_new_daily_limit = 20
review_session_limit   = 20
```

建议 API 语义为：

```text
GET /api/review/settings
PUT /api/review/settings
```

`PUT` 应由服务端做整数化和边界校验，成功后返回规范化后的完整设置，而不是让前端自行假设保存成功。数据库缺少设置行时，应按内置默认值读取；首次成功写入后再创建行。这样既能兼容现有用户，也方便未来增加字段。

### 默认值与边界

- 每日新卡上限允许 `0`，表示今天不引入新卡，但仍可复习已有到期卡；不接受负数、小数、空字符串或超出上限的整数。
- 单次批次上限最小为 `1`，否则复习页无法推进；建议上限 `100`，避免一次请求造成移动端过长队列、内存和交互负担。
- 服务端在查询时仍应对请求中的 `limit` 做硬上限保护，不能因为客户端传入 `100000` 就绕过设置；设置值是产品上限，请求值还可以更小，例如“本次只复习 5 张”。
- 修改每日新卡上限只影响未来的取卡，不追溯修改已经写入的复习记录或 FSRS 状态；这与 Anki 对多数牌组选项“非追溯”的说明一致。[Anki Deck Options — Presets](https://docs.ankiweb.net/deck-options.html#presets)
- 修改批次上限只影响下一次取卡/继续下一批，不应改变卡片的 `due`、记忆状态、复习次数或统计口径。

## 推荐首期交互

在设置页新增“复习”分组，保持两个清晰的数字输入：

1. **每天引入新卡**：20 张；辅助文案说明“未使用额度不结转”。
2. **每批复习卡片**：20 张；辅助文案说明“批次完成后可以继续下一批，不代表当天没有更多到期卡”。

保存时显示内联成功状态；非法输入在字段附近提示；保存失败保留用户输入并提供重试。进入复习页时，从服务端读取批次设置并按设置取队列；评分完成后继续复用已有的 due/stats 失效逻辑。

首期不放“FSRS 参数”大表单。可以在复习设置底部放一个低干扰的说明卡：当前使用 FSRS、期望保持率 90%，参数由系统维护；未来有足够复习数据后再提供“查看高级设置/优化”入口。

## 后续扩展边界

在以下条件满足前，不建议扩展到复杂牌组 preset、项目级额度或自动优化：

- 已有稳定的设置迁移和跨设备同步契约；
- 复习队列能明确区分新卡、学习中卡片和到期复习卡；
- 统计页能展示每日限制导致的隐藏数量；
- FSRS 优化流程能明确数据范围、预览影响并可回滚；
- 有足够真实复习记录，不再用默认参数伪装成个性化优化。

## 来源清单

- [Anki Manual — Deck Options](https://docs.ankiweb.net/deck-options.html)
- [Anki Manual — Daily Limits](https://docs.ankiweb.net/deck-options.html#daily-limits)
- [Anki Manual — Desired Retention](https://docs.ankiweb.net/deck-options.html#desired-retention)
- [Anki Manual — FSRS Parameters](https://docs.ankiweb.net/deck-options.html#fsrs-parameters)
- [Anki Manual — Reschedule Cards on Change](https://docs.ankiweb.net/deck-options.html#reschedule-cards-on-change)
- [FSRS-rs — official Rust implementation and README](https://github.com/open-spaced-repetition/fsrs-rs)
- [FSRS-rs — scheduling example](https://github.com/open-spaced-repetition/fsrs-rs#schedule-reviews)

