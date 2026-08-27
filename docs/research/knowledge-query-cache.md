# 知识工作台请求缓存、失效、分页与状态调研

> 调研日期：2026-08-26  
> 范围：只对照 TanStack Query React v5 官方文档，并核对本仓库当前实现。  
> 边界：本文记录调研结论与已落地切片；后续实现按小范围、可回滚的方式推进。

## 结论先行

本仓库已经安装 `@tanstack/react-query@5.102.3`，也已经建立 `QueryClientProvider`。知识工作台主列表仍主要使用 `queryClient.fetchQuery` 加本地 `useState`，但全局搜索页已完成第一阶段的局部迁移，由 `useQuery` observer 管理文章搜索和知识卡片分页。后续仍应采用“局部、渐进迁移”，不要一次性改造所有页面。

建议顺序如下：

1. 先建立知识域 query key factory 和 query options，把 URL 中的筛选条件规范化为同一份查询输入。
2. 先把全局搜索的知识卡片 Tab 迁移为 `useQuery`，验证分页、缓存、取消请求和状态分层。
3. 再把知识页列表/详情迁移为服务端分页；在移除当前全量 `allCards` 请求之前，先把状态统计、重复检测等依赖拆成独立接口或独立查询。
4. 将创建、编辑、批量移动、删除/恢复、触碰/评分等写操作改为 `useMutation`，在 mutation 成功后集中失效相关查询；服务端已经返回完整卡片对象的场景可以先 `setQueryData` 更新详情，再做有边界的列表失效。
5. 最后统一初次加载、后台刷新、分页占位、首次失败和刷新失败的 UI，不让后台刷新覆盖正在看的内容。

暂缓以下事项：把 Query cache 持久化到 localStorage、立即改用 `useInfiniteQuery`、对批量移动/删除做全量乐观更新、恢复全局窗口聚焦自动刷新，以及把所有历史/统计/设置页面一起迁移。它们都会扩大状态契约或测试范围，当前没有足够收益支撑优先做。

## 当前代码基线

### Query 已接入，但使用方式不一致

- `src/main.tsx` 已创建 `QueryClient` 并包裹 `QueryClientProvider`；全局默认配置是 `retry: false`、`refetchOnWindowFocus: false`。
- `src/App.tsx` 的侧边栏到期数量使用 `useQuery`，并设置了 60 秒 `refetchInterval`；它只读取 `data`，错误会被静默隐藏。
- `src/components/KnowledgePage.tsx` 使用 `useQueryClient().fetchQuery` 缓存筛选卡片、全量卡片、标签、项目和保存视图，但结果仍写回本地 state，当前组件并没有通过 `useQuery` 订阅这些 query。
- 知识页当前的卡片查询在 `loadCards` 中同时请求筛选列表和完整 `listKnowledgeCards()`；筛选结果按本地 state 再排序。筛选 cache key 包含当前筛选字段，但没有页码/每页数量，因为该路径仍是全量列表。
- `src/components/SearchPage.tsx` 的文章搜索和卡片搜索现在都由 `useQuery` observer 驱动；卡片分页每页 24 条，页码进入 URL 和 query key，切页使用 `keepPreviousData` 并预取下一页。
- `SearchPage` 的 query function 消费 TanStack Query 的 `AbortSignal`；知识页 `loadCards` 仍保留请求 revision guard，多个筛选快速切换时继续防止旧响应覆盖新列表。
- `src/lib/api.ts` 的读取函数已通过 `ReadRequestOptions` 对外暴露 `AbortSignal`，搜索页和知识页的服务端查询会把取消信号传到 `fetch`。
- 写操作大多是直接调用 `api.*` 后再手动 `loadCards`。知识页虽然定义了 `invalidateKnowledgeQueries`，但当前没有形成统一的 mutation 失效流程；标签、项目、保存视图、回收站和复习统计也没有通过同一个知识域契约联动失效。
- 页面错误大多被压缩成一个字符串；知识页的标签/项目请求失败时回退为空数组，复习页的部分辅助请求失败时回退为 `null`/空数组。这些是可接受的“辅助数据降级”，但主列表需要区分“没有数据的首次失败”和“已有数据的刷新失败”。

## TanStack Query 官方事实与本仓库映射

### 1. 查询键是缓存、共享和自动更新的契约

TanStack Query 要求 query key 顶层是数组，并且应当是可序列化、能唯一描述查询结果的值；如果 query function 依赖会变化的变量，这些变量必须进入 query key。key 变化时，`useQuery` 会自动订阅/切换到对应查询。[Queries](https://tanstack.com/query/latest/docs/framework/react/guides/queries)、[Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)、[useQuery](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)

对应到本仓库，建议把 URL 查询参数和 Query key 都建立在同一个规范化对象上，而不是分别在路由、组件和 API 函数里拼接：

```ts
type KnowledgeListParams = {
  q: string;
  project: string;
  tag: string;
  status: KnowledgeCardStatus | "all";
  type: KnowledgeCardType | "all";
  usage: "never_used" | "all";
  sort: KnowledgeCardSort;
  page: number;
  pageSize: number;
};

const knowledgeKeys = {
  root: ["knowledge"] as const,
  cards: (params: KnowledgeListParams) => ["knowledge", "cards", params] as const,
  card: (id: string) => ["knowledge", "card", id] as const,
  tags: ["knowledge", "tags"] as const,
  projects: ["knowledge", "projects"] as const,
  views: ["knowledge", "views"] as const,
  trash: ["knowledge", "trash"] as const,
};
```

这里的代码只是建议的契约示例，不是本轮要落地的业务代码。关键要求是：`q/project/tag/status/type/usage/sort/page/pageSize` 经过同一套默认值和空值规范化后，同时进入 API 请求和 query key。当前知识页的 `filtered` key 只覆盖全量列表筛选，后续服务端分页必须补上页码、每页数量和排序，否则不同页面会错误共享缓存。

### 2. `staleTime` 和 `gcTime` 是两个不同问题

官方文档说明：`staleTime` 决定数据在多长时间内被视为 fresh；默认是 0。stale 数据可能在新 observer 挂载、窗口重新获得焦点、网络重连时后台刷新。没有活跃 observer 的 query 会留在 cache 中，默认在 5 分钟后由 `gcTime` 回收。[Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)、[useQuery](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)

因此本仓库不应把“刷新频率”和“缓存保留时间”混成一个配置：

| 数据 | 建议的第一版策略 | 原因与边界 |
| --- | --- | --- |
| 知识卡片列表页 | `staleTime` 30–60 秒，`gcTime` 保持默认 | 当前已有 30 秒的手动 `fetchQuery` 策略；切页返回时可以复用短期结果，写操作成功后仍由失效主动刷新。数值是产品取舍，不是 TanStack 的硬性要求。 |
| 卡片详情 | `staleTime` 30–60 秒 | 详情可能被编辑或批量操作影响；保持短期读取缓存，同时依赖 mutation 失效保证一致性。 |
| 标签、项目计数、保存视图 | `staleTime` 5 分钟左右 | 变化频率低，创建/移动/标签操作成功时主动失效；不需要每次进页面都重新请求。 |
| 到期复习数量 | 保留定时刷新，必要时单独设置 `staleTime` | 当前已经每分钟轮询；复习评分成功后应立即失效，而不是等待下一次 interval。 |
| 回收站 | 30–60 秒 | 删除/恢复后主动失效；不建议为了“离开后仍能看到”把所有回收站数据永久缓存。 |

应用当前将 `retry` 和窗口聚焦刷新全局关闭，这是一个合理的桌面/个人工作台保守基线，不应因为采用 Query 就盲目恢复全部默认行为。官方提供了 query 级别的 `retry`、`retryDelay`、`refetchOnWindowFocus` 和 `refetchOnReconnect` 配置。[useQuery](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)

建议保持全局 `refetchOnWindowFocus: false`，对知识读查询按错误类型设置有限重试：网络错误或 5xx 最多重试 1 次，401/403/404 不重试；写操作不自动重试。`ApiError.status` 已在本仓库存在，这个规则可以直接建立在现有错误模型上。该重试次数是本项目的可执行建议，并非官方默认值。

当前知识页把 `staleTime` 传给了 `fetchQuery`。迁移到 `useQuery`/query options 时，应在真正的 observer 上继续声明对应的 `staleTime`；官方预取文档特别说明，预取调用里的 `staleTime` 只影响那次请求，不能代替 `useQuery` 自己的配置。[Prefetching & Router Integration](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)

### 3. 失效优先于手动维护一份“规范化缓存”

TanStack Query 的官方建议是：写操作通常用 `useMutation`；成功后用 `queryClient.invalidateQueries` 标记相关查询 stale，并让正在显示的 observer 后台重新获取。失效可以按 key 前缀匹配整组查询，也可以用更精确的 key 或 `exact` 匹配。[Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)、[Query Invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)

官方的 mutation 失效示例还说明：如果 `onSuccess` 返回一个 Promise，mutation 会等到失效/重新获取完成后才结束；多个相关查询可以并行失效。[Invalidations from Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)

知识域可以采用下面的失效矩阵：

| 操作 | 成功后至少失效的 query | 是否直接写 cache |
| --- | --- | --- |
| 新建卡片 | `knowledge` 下的列表、标签、项目计数、复习统计（若状态为已确认） | 若列表排序/筛选归属明确，可只更新当前列表；第一版以失效为准。 |
| 编辑卡片 | `knowledge.card(id)`、所有卡片列表、标签/项目计数、相关复习统计 | 服务端返回完整卡片时，可 `setQueryData` 更新详情；列表仍失效，因为排序、筛选和项目归属可能改变。 |
| 批量加/移除标签或项目 | 所有列表、标签、项目计数、当前卡片详情 | 不做跨多个筛选页的猜测式乐观更新。 |
| 批量软删除/恢复 | 所有列表、回收站、项目计数、标签计数、复习相关 query | 首轮只做 mutation pending + 失效；服务端目前主要返回更新数量，尚不足以可靠地重建每一页列表。 |
| 保存视图新增/编辑/删除 | `knowledge.views` | mutation 成功返回视图对象时可直接写入视图列表，再失效保证一致。 |
| 复习评分 | 当前卡片详情、列表、到期队列、复习统计 | 已返回更新后的卡片，可更新详情；到期队列和统计必须失效。 |

当前代码的 `loadCards()` 能解决当前组件的刷新，但不能让其他页面或已经缓存的筛选结果知道数据已变化；只调用一个未使用的 `invalidateKnowledgeQueries` 也不会让本地 state 自动更新，因为这些结果不是由 `useQuery` observer 渲染的。迁移后应把失效放进 mutation hook 或知识域 mutation helper，避免每个按钮都自行决定刷新哪些数据。服务端返回完整对象时，可参考官方的 `setQueryData` 更新详情，但必须以不可变方式写入，并结合列表失效处理排序/筛选变化。[Updates from Mutation Responses](https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses)

### 4. 批量操作先采用“服务器确认 + 精确失效”，暂不做复杂乐观缓存

官方文档提供两种乐观更新方式：在 UI 里根据 mutation variables 显示临时状态，或在 `onMutate` 中取消正在进行的查询、快照旧数据、写入新数据，在失败时回滚，并在 `onSettled` 失效查询。[Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)

本仓库批量移动、标签变更、软删除/恢复会同时影响多个筛选结果、项目/标签计数、回收站和复习队列；当前 API 还没有返回每张卡片的完整变更快照。若现在对所有页面做乐观更新，失败回滚和跨页选择会明显增加复杂度。可执行取舍是：

- 第一版使用 mutation 的 `isPending` 禁用重复提交，成功后等待相关 query 失效完成；当前页面保留旧数据并显示轻量刷新态。
- 对删除/恢复沿用已经存在的真实撤销 API，不把 Toast 快照当成唯一恢复机制。
- 等列表 query、详情 query 和批量响应契约稳定后，再只为同组件内、可完整回滚的操作增加局部乐观 UI。

### 5. 分页：先用普通 `useQuery`，不要立即切换无限滚动

TanStack 官方分页示例把页码放入 query key。分页 key 变化时，如果直接使用 `useQuery`，UI 会在 pending/success 之间跳动；v5 推荐用 `placeholderData: keepPreviousData` 保留上一页，使用 `isPlaceholderData` 判断当前展示的是否仍是旧页，并在尚未确认下一页存在时禁用“下一页”。[Paginated / Lagged Queries](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries)

官方示例也展示了：当前页确认 `hasMore` 后，可以用 `queryClient` 预取下一页，让用户点击下一页时直接命中 cache。[React Query Pagination Example](https://tanstack.com/query/latest/docs/framework/react/examples/pagination)、[Prefetching & Router Integration](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)

本仓库已经有 `{ cards, total, page, page_size, has_more }` 的服务端响应，并将搜索页 `page` 写入 URL，所以当前取舍是：

- 先迁移为普通 `useQuery` 的编号分页，query key 包含规范化筛选条件、`page` 和 `page_size`。
- 页码变化使用 `placeholderData: keepPreviousData`；同时展示“正在更新”而不是把旧页伪装成新页，`isPlaceholderData` 或 `isFetching` 时禁用会造成重复请求的分页按钮。
- 当前页成功且 `has_more` 为真时，低成本预取下一页；不预取所有页，避免搜索词变化带来请求爆炸。
- URL 筛选条件变化时重置到第 1 页；若旧页与新筛选条件不相同，UI 应明确显示正在切换筛选，避免用户误认为旧结果属于新筛选。
- 目前不使用 `useInfiniteQuery`。编号分页更适合已经存在的 URL 深链接、后退恢复和批量选择语义；只有在产品明确需要“加载更多/连续滚动”，且后端改为 cursor 契约后，再评估无限查询。

知识主页面迁移时有一个边界不能跳过：当前 `allCards` 同时承担状态数量、重复检测、选中项和列表数据等职责。不能仅仅把列表截断成一页就删除全量请求。应先拆为：

1. 当前筛选的分页列表 query；
2. 服务端聚合统计 query（draft/confirmed/outdated、项目计数、标签计数）；
3. 以标题/正文查重的独立查询或按需检查接口；
4. 详情 query `knowledge.card(id)`。

拆分完成前，可以保留全量数据作为过渡，但不要把它当作分页完成的标志。

### 6. 请求取消比“响应序号”更完整，但仍需保留结果语义

TanStack Query 会向 query function 传入 `AbortSignal`。如果 query function 消费这个 signal，查询过时或变为 inactive 时可以取消底层 `fetch`，取消后 query 状态会回到之前的状态。[Query Cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)

知识页 `loadCards` 仍有本地 revision guard，但主列表尚未完全迁移为 observer。下一阶段应继续把读取函数的 `signal` 传递和 Query 状态语义用于知识页；典型 query function 形态是：

```ts
queryFn: ({ signal }) => api.queryKnowledgeCards(params, { signal })
```

其中 `api` 层仍负责把非 2xx 响应转换为现有 `ApiError`。Abort 造成的异常不应作为用户可见错误 Toast；普通网络错误、鉴权错误和服务端错误则按统一错误策略处理。

## 后续落地记录（2026-08-27）

`SearchPage` 已完成 Slice A 的最小迁移：文章查询和知识卡片分页查询由 `useQuery` observer 直接作为显示数据源，query key 继续包含搜索范围、规范化关键词和卡片页码；请求函数消费 Query 传入的 `AbortSignal`。输入框仍保留 300ms 防抖，输入态与已提交查询分离，因此用户编辑关键词时不会为每个字符立即请求，回车和路由恢复仍会立即提交。

分页查询使用 `keepPreviousData`：切页或搜索刷新时保留上一组可显示结果，工具栏 spinner 表示后台请求；没有旧数据时显示结果 skeleton。首次查询失败会显示错误和“重试”，已有旧结果时仍保留结果，避免把刷新失败误判为“没有数据”。删除文章后通过搜索 query 前缀失效，让 observer 重新获取，而不是只修改当前组件的一份数组副本。

本轮没有把知识工作台一次性改成 `useQuery`，因为它还把编辑草稿、详情深链接、分页列表、质量摘要、关联候选和批量 mutation 集中在一个组件中；先完成搜索页验证 Query 状态模型，再拆分知识域 observer 与 mutation helper，风险更低。

### 7. loading/error 应按“有没有可显示数据”分层

官方 Query 状态把 `isPending` 定义为还没有数据的 pending 状态，把 `isFetching` 定义为任何 fetch（包括后台刷新）；`isRefetching` 等价于 `isFetching && !isPending`。官方还区分首次加载失败 `isLoadingError` 和已有数据刷新失败 `isRefetchError`。[Queries](https://tanstack.com/query/latest/docs/framework/react/guides/queries)、[Background Fetching Indicators](https://tanstack.com/query/latest/docs/framework/react/guides/background-fetching-indicators)、[useQuery](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)

建议知识工作台统一使用下面的状态矩阵：

| 场景 | Query 状态 | UI 行为 |
| --- | --- | --- |
| 首次进入、没有缓存 | `isPending` / `isLoading` | 列表位置显示 skeleton；不要只在页面角落放一个 spinner。 |
| 已有数据，后台刷新 | `isFetching` / `isRefetching` | 保留当前列表和选择状态，在工具栏显示细进度/“正在更新”；不阻塞阅读。 |
| 首次请求失败且无数据 | `isLoadingError` 或 `isError && !data` | 显示内联错误、错误原因和“重试”；不要显示空列表，避免把错误误判为空数据。 |
| 刷新失败但已有旧数据 | `isRefetchError` 或 `isError && data` | 保留旧数据，显示非阻塞警告和重试；可标注“内容可能不是最新”。 |
| 分页切换中 | `isPlaceholderData` | 保留上一页，明确页码/筛选正在更新；禁用会产生重复请求的按钮。 |
| 创建/编辑/批量操作中 | mutation `isPending` | 只锁定相关控件，显示具体动作中的文案；完成失效并等待必要刷新后再解除忙碌态。 |

`error` 不应再和整个页面的空态共用一个布尔判断。列表、详情、来源文章、标签/项目等可以各自拥有 query 状态；辅助数据失败时可以降级，但主数据失败必须提供可操作的重试入口。

## 推荐的实施切片与验收

### Slice A：查询契约与搜索页验证

- 新增知识域 key factory/query options，不改变现有 API 返回形状。
- 给 `queryKnowledgeCards` 增加可传 `AbortSignal` 的读取入口。
- 将 `SearchPage` 的文章和卡片 Tab 改为 `useQuery`，保留文章详情的独立读取实现。
- 使用 `placeholderData: keepPreviousData`、`isPlaceholderData`、`isFetching` 和下一页预取。
- 保持 `q/scope/page` 为 URL 真正来源，组件只从路由参数派生 query 输入。

验收：同一 `q + page` 返回页面切换时命中 cache；不同 `q/project/tag/status/type/sort/page` 不共享错误结果；快速输入不会出现旧搜索覆盖新搜索；刷新/后退可恢复页码；首次失败和刷新失败的 UI 不相同。

### Slice B：知识页列表与详情

- 把筛选列表改为服务端分页 query；详情改为 `knowledge.card(id)`，深链接不再依赖先拉完整列表。
- 在保留 `allCards` 之前，先实现聚合统计和按需重复检测的独立数据来源。
- 当前筛选变化清理/重置 page，保存视图只保存筛选条件，不保存结果和页码。

验收：桌面列表/详情和移动端列表/全屏详情都共享同一 query cache；切换页面再返回不重复发起 fresh 数据请求；编辑详情后列表的排序、项目、标签和状态都能通过失效同步。

### Slice C：mutation 与统一失效

- 创建、编辑、批量标签/项目操作、软删除/恢复、复习评分分别封装为 `useMutation` 或知识域 mutation helper。
- 按失效矩阵处理列表、详情、标签、项目、回收站、到期队列和统计；`onSuccess`/`onSettled` 返回失效 Promise。
- 第一版不跨多个分页结果做乐观 cache 重写，只锁定操作控件、保留旧列表并等待刷新。

验收：任一写操作后，当前页面与已打开的相关页面不会继续显示明显过期数据；批量失败不会丢失当前列表；删除撤销和回收站恢复都可以在刷新后验证结果。

### Slice D：全站状态规范化

- 将可读页面的首次加载、后台刷新、首次错误、刷新错误、空态和重试按钮统一到现有反馈组件。
- 为主 query 和辅助 query 分开显示错误，不因为标签/项目统计失败而遮蔽可用卡片。
- 只有在知识域验证稳定后，再考虑迁移 Review/Stats/History 等页面。

## 明确不采用的方案（当前阶段）

### 不立即持久化 Query cache

TanStack 官方确实提供 `persistQueryClient`，可将 QueryClient 保存到同步或异步存储，并用 `maxAge`/`buster` 控制恢复缓存的有效性。[persistQueryClient](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient)

但本项目目前是带鉴权的个人知识工作台，数据可能被另一个浏览器、桌面端或服务器操作修改；若把服务端数据持久化到 localStorage，需要额外处理身份切换、版本失效、敏感数据残留和 mutation 离线队列。当前只需要进页面间的短期内存缓存，默认 `gcTime` 已足够；离线编辑和跨端同步应单独立项。

### 不立即把编号分页改成无限查询

`useInfiniteQuery` 适合连续加载和 cursor/next-page 参数，但会让 URL 页码、跨页批量选择、滚动恢复和缓存失效的交互契约变复杂。现有服务端返回的是页码/总数/`has_more`，先把普通分页做好，等真实数据量和用户滚动行为证明需要后再扩展。

### 不把 `fetchQuery` 当作最终的组件状态方案

`fetchQuery` 可以预先请求并填充 cache，但如果页面仍只把结果复制到本地 state，其他 observer 无法自然订阅失效后的更新，loading/error 也会继续分散。知识页可以暂时用它做低频元数据预取，但主列表和详情应最终由 `useQuery`/Query observer 渲染。

## 官方引用索引

- [Queries](https://tanstack.com/query/latest/docs/framework/react/guides/queries)
- [Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- [useQuery API](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)
- [Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [Query Invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
- [Invalidations from Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)
- [Updates from Mutation Responses](https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses)
- [Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)
- [Query Cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
- [Paginated / Lagged Queries](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries)
- [React Query Pagination Example](https://tanstack.com/query/latest/docs/framework/react/examples/pagination)
- [Prefetching & Router Integration](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
- [Background Fetching Indicators](https://tanstack.com/query/latest/docs/framework/react/guides/background-fetching-indicators)
- [persistQueryClient](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient)
