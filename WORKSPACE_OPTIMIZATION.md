# 知识整理与工作区优化（2026-10-09）

本次围绕知识整理、实际复用、跨设备阅读、性能、AI 任务和运行状态优化。沿用 React、TanStack Query/Router、Radix、Rust/Axum 和 SQLite；没有新增依赖、环境变量、导航页面或生产部署操作。

## 针对复用历史重复区块与 AI 任务入口的修改

截图中的多个「复用历史 · 0」显示的是重复 UI 区块，不能据此判断数据库存在重复复用事件。本次没有读取真实数据库；知识阅读器源码只有一个复用组件挂载点，新的隔离生产浏览器验证中每个阅读器也只有一栏。旧页面出现四栏的具体运行原因尚未复现。复用历史初始收起，只有展开时才请求；阅读区保留一行「记录本次使用／查看历史」。

PC 的「AI 用量」按钮可用鼠标拖动，也可聚焦后按 `Alt+方向键` 微调位置；位置仅保存在本机。展开后的非模态浮动面板按小窗口设计，未选择任务时保留紧凑概览，选择任务后扩展阅读区，显示最近保留任务的 token 汇总、费用估算和进行状态，任务列表标出触发类型、处理范围与开始时间。每日总结来自今日记录，知识条目提取来自今日记录或知识导入，周回顾／月回顾来自统计页。供应商没有返回的用量与未配置的单价分别显示，不把未知值折算成零。汇总范围为当前服务保留的任务，不能代表供应商账户的全部历史消费。

这轮附加 UI 的生产浏览器检查入口为 `scripts/workspace-optimization-regression.mjs`，包含复用栏唯一性、历史按需读取、悬浮按钮拖动／位置保存、Alt+方向键和弹层焦点恢复检查。隔离 loopback 预览在允许本机浏览器运行的环境中完成验证，9 项行为检查通过；另外覆盖 390、768、1024、1440px 的明暗主题截图。关闭按钮保持右上角，关闭后焦点回到入口。

## 使用与 UI

- 今日记录的 AI 候选、知识导入、既有草稿／待完善条目、AI 任务面板共用 `src/components/knowledge/CandidateOrganizer.tsx`。逐条确认直接成为已确认知识条目，保存草稿保留审核步骤，跳过可恢复；原有批量保存草稿继续可用。
- 相似提示使用现有标题／正文规则，区分标题相同、正文相同、内容相似。新任务保留相似候选，旧同步接口默认仍会去重。人工选择目标、对照双方正文并编辑最终正文后合并，保留目标 ID、打开次数、实际复用和复习进度；正文变化沿用版本与复习题过期规则。
- 保存与合并使用幂等请求 ID；目标版本变化返回 409，编辑内容保留。来自今日记录的依据在服务器核对当前原文，导入任务的依据核对保留的任务原文。没有来源仍可手动确认，质量提示不是强制来源要求。
- 阅读区的「记录复用」立即保存一次事件，可随后选填已有项目空间和解决的问题。关闭详情编辑不删除事件，「撤销」明确撤销记录。历史打开次数继续单独显示，不能用于推算真实复用。统计页知识视图优先展示本周复用，再提供待完善入口。
- PC ≥1280px 保留列表／阅读并排；中等宽度转为单主体，移动端阅读优先。正文控制在约 72ch，移动触控按钮 ≥44px，复习操作区避开底部导航。列表内部保存返回位置，路由继续使用既有滚动恢复。
- 「简洁显示」保存为本机辅助配置，隐藏壁纸并减少装饰动态效果，不改写服务器壁纸分配。任务入口避开返回顶部按钮，任务面板仅在用户打开或开始任务后加载。
- 连接设置显示受保护的运行概览，包括版本、备份时间、磁盘占用、完整性检查与 AI 状态。离线提示明确说明服务器不可更新，本机临时草稿不等于服务器保存。

## API 与数据契约

新增接口均位于既有 `/api` 鉴权边界内，定义集中在 `src/lib/api.ts`，路由集中在 `server/src/server.rs`：

| 接口 | 行为 |
| --- | --- |
| POST `/knowledge-cards/organize` | 确认／保存候选或更新合并目标；`request_id` 幂等，目标必须提供 `expected_updated_at` |
| POST `/knowledge-cards/similar` | 返回最多五个相似条目与规则原因；由用户决定合并 |
| GET `/knowledge-cards/:id/sources` | 多来源依据，旧单来源字段继续作为主来源 |
| POST `/knowledge-cards/:id/reuse` | 根据请求 ID 一键创建实际复用事件 |
| GET `/knowledge-reuse` | 按知识条目或日期所属周分页，每页 20 条，周一至周日 |
| PATCH / DELETE `/knowledge-reuse/:id` | 补充项目／问题或软撤销事件 |
| GET `/knowledge-cards/query?summary=true` | 正文只返回前 320 字符；不传参数继续返回原完整形状，阅读／编辑时获取详情 |
| GET `/articles/tag-suggestions` | 最近 60 条活动记录的标签聚合，前端缓存一分钟 |
| POST / GET `/ai/tasks` | 创建或列出有容量限制的进程内任务；列表不携带结果全文 |
| GET / DELETE `/ai/tasks/:id` | 查看结果或取消；`summary=true` 仅返回状态，用于轮询 |
| POST `/ai/tasks/:id/retry` | 知识任务仅重试失败分块，单次总结／周期生成重试该操作 |

AI 任务保留一小时，最多 8 个运行任务、32 个保留任务，受保留原文内存限额约束。运行任务不因到期被清除。服务重启后任务失效；会话存储只保存服务器标识与任务 ID，不保存原文或结果。相同来源快照、任务与模型配置复用已有任务，明确重新生成才新建；周期回顾使用发起时捕获的来源快照，重试沿用发起时的配置。

模型档案新增可选 `input_price_cny` / `output_price_cny`，单位为人民币／百万 token，不做汇率换算。估算公式为 `(输入 token × 输入单价 + 输出 token × 输出单价) / 1,000,000`，使用发起时价格。供应商没返回用量、失败请求用量未知或价格未配置时，费用为不可用；部分已知用量可展示，但不把未知请求视为零费用。

SQLite v27 新增来源表、实际复用表、幂等收据表、trigram 索引、列表排序索引及派生 `content_chars`。正文长度在写入时维护，避免质量统计反复扫描长文。全文仍以原知识表为权威，派生字段不进入客户端业务数据库。

完整 JSON 仍为 v3，新增可选 `knowledge_sources` / `knowledge_reuse` 数组，旧包缺失这些字段仍可导入。重复导入按来源唯一约束和事件 ID 去重，撤销标记不会被旧事件包复活；来源文章 ID 沿用现有导入映射。ZIP 包复用同一 `data.json`。数据库快照包含新数据，恢复路径保留原壁纸规则。

## 性能证据与限制

测试使用 `Database::new_in_memory()`，固定合成正文、数据种子、每项 25 次采样；原始基线在本次修改前采集。以下是本机 debug 构建的数据库调用 p95，不含 HTTP／真实磁盘／外网时延，不能当作生产 SLA。

| 知识数量 | 场景 | 原始 p95 ms | 优化 p95 ms |
| --- | --- | ---: | ---: |
| 1,000 | 列表 | 3.072 | 0.492 |
| 10,000 | 列表 | 26.150 | 0.836 |
| 50,000 | 列表 | 130.011 | 2.800 |
| 50,000 | 中文有结果搜索 | 179.556 | 38.622 |
| 50,000 | 无结果搜索 | 1398.512 | 14.836 |

24 条列表原始 JSON 为 185,045 字节，摘要投影为 28,709 字节，减少约 84.5%。执行计划确认列表使用 `idx_knowledge_cards_active_order`。三字符以上、不含 LIKE 通配符的包含查询先用 SQLite 原生 trigram 筛候选，再执行原 LIKE 校验；短词与通配符保持原路径。索引采用 `detail=none` 降低位置记录成本；它会增加 SQLite 文件体积和首次迁移时间。[SQLite FTS5 官方说明](https://www.sqlite.org/fts5.html)

混合测试补充两来源、双关联、并行搜索、质量统计、今日保存与批量导入，并输出数据库锁等待。50,000 条下连续质量统计的单次 p95 从约 625ms 降至约 152ms，合成保存约 39ms；不间断统计循环仍可能让并行搜索等待约 1.2 秒。单连接串行化边界保留，客户端统计缓存减少日常重复请求；没有引入连接池，也不把阻塞执行路径描述为消除了锁竞争。

生产浏览器检查采集本机 LCP、CLS、长任务及资源数量，覆盖 390、768、1024、1440px，明暗主题、共享合成背景、简洁显示、合并冲突、复用、草稿确认和离线反馈。测试使用无网络节流的合成 API，不是实际用户的 p75 / INP 数据。

## 复现与验收

```bash
npm test
npm run build
npm run check:bundle
cargo fmt --manifest-path server/Cargo.toml --check
cargo test --manifest-path server/Cargo.toml --locked
cargo clippy --manifest-path server/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path server/Cargo.toml --locked knowledge_workspace_benchmark -- --ignored --nocapture
```

完整服务端测试包含仅绑定 loopback 的模拟 AI 供应商，需要允许本机监听，不访问真实 AI。性能测试是显式 ignored 测试，不属于每次 CI 的默认开销。

生产 UI 验证：

```bash
npm run preview -- --host 127.0.0.1 --port 4173
KNOWLEDGE_FRONTEND_ORIGIN=http://127.0.0.1:4173 node scripts/production-ui-regression.mjs
KNOWLEDGE_FRONTEND_ORIGIN=http://127.0.0.1:4173 node scripts/workspace-optimization-regression.mjs
```

浏览器脚本需要 `playwright-core` 和 Chrome。可通过 `KNOWLEDGE_PLAYWRIGHT_MODULE` 指定本机已有模块，通过 `KNOWLEDGE_CHROME_PATH` 指定浏览器；无需把它们添加到产品依赖。脚本拦截所有业务请求，不启动真实服务端，不允许对真实知识库写入。截图、资源指标与报告默认放在 `/tmp/daily-summary-workspace-optimization`。

已验证迁移旧数据、来源保留、合并冲突、复习进度不重置、复用幂等／撤销、旧包与新包往返、重复导入、任务去重／取消／过期、分块失败仅重试失败部分、用量缺失与价格快照。既有鉴权、恢复回滚和敏感信息边界测试保持通过。

本次首屏 gzip 179,120 字节（约 179.1 KB），通过 180,000 字节预算。前端仍对部分按需图表／Markdown chunk 给出体积提示，没有关闭压缩或绕过预算。没有修改 Tauri Rust、部署脚本或依赖，因此不额外运行桌面壳／部署／依赖变更检查。

## 升级与回退

升级前按现有流程创建数据库保护快照；第一次启动自动执行 v27 迁移，创建索引时应预留时间和磁盘空间。实际部署、保护点创建和恢复须另有明确授权，本次未执行这些操作。

旧客户端仍可使用原列表、单来源、打开计数和同步 AI 接口。旧版本工具不会理解多来源与实际复用数组，跨版本迁移应使用新版本工具。回退不能仅替换二进制并假定新数据仍可完整操作：先导出新增数据，再恢复升级前保护快照并回退程序；升级后产生的内容需要另行保存和迁移。

## 变更文件索引

| 文件 | 目的 |
| --- | --- |
| `server/src/db.rs` | v27 迁移、派生长度、搜索／排序索引、摘要投影及完整包兼容 |
| `server/src/db/workspace.rs` | 多来源、幂等收据、独立复用事件及持久化回归 |
| `server/src/db/workspace_benchmark.rs` | 固定合成数据与混合锁等待基准 |
| `server/src/knowledge/organize.rs` | 来源验证、相似提示、候选事务保存／合并及复用 API |
| `server/src/knowledge.rs` | 新候选保留相似内容，旧默认去重兼容，分析任务上下文与保留期 |
| `server/src/ai_tasks.rs` | 有界进程内任务、来源／配置快照、用量／费用与模拟供应商回归 |
| `server/src/ai.rs` | 任务快照读取及人民币单价校验 |
| `server/src/ai_client.rs` | 解析实际用量，失败尝试不当作零用量 |
| `server/src/articles.rs` | 阻塞路径中的记录读写与轻量标签聚合 |
| `server/src/stats.rs` | 统计在阻塞执行路径运行，计算前释放数据库锁 |
| `server/src/models.rs` | 可选单价／用量、来源／复用数据类型及兼容参数 |
| `server/src/main.rs`、`server/src/server.rs` | 注册模块与既有鉴权边界内的新路由 |
| `src/lib/api.ts`、`src/lib/knowledgeCandidateSave.test.ts`、`src/lib/aiTaskPolling.test.ts` | 集中契约、摘要标记、任务完成后取回完整结果的轮询回归与批量候选幂等重试 |
| `src/lib/simpleDisplay.ts` | 本机简洁显示及跨组件通知 |
| `src/lib/useResponsiveWallpaperImage.ts`、对应 `.test.ts` | 按服务器／版本／设备变体共享资源，引用释放回归 |
| `src/App.tsx` | 按意图加载任务面板、全站离线状态及简洁显示 |
| `src/components/TodayPage.tsx` | 延迟预览、缓存标签聚合 |
| `src/components/TodayAIPanel.tsx` | 共用逐条候选整理与保留相似内容的批量草稿保存 |
| `src/components/KnowledgeImportDialog.tsx` | 共用整理器、服务器隔离任务 ID、批量草稿幂等重试 |
| `src/components/KnowledgePage.tsx` | 摘要浏览、完整详情加载、整理后更新页面状态 |
| `src/components/knowledge/KnowledgeLibrary.tsx` | 打开次数文案与列表内部滚动恢复 |
| `src/components/knowledge/KnowledgeReader.tsx` | 来源、整理及实际复用入口 |
| `src/components/knowledge/CandidateOrganizer.tsx` | 编辑、来源核对、逐条确认／草稿／跳过、人工合并 |
| `src/components/knowledge/RelatedKnowledgeField.tsx` | 按需检索并修改关联，保留主动声明边 |
| `src/components/knowledge/AdditionalSources.tsx` | 多来源依据展示 |
| `src/components/knowledge/ReusePanel.tsx`、`WeeklyReuse.tsx` | 复用录入／撤销／历史及周视图 |
| `src/components/knowledge/organize.css` | 共用整理与阅读组件排版、触控和响应式布局 |
| `src/components/workspace/AiTaskLauncher.tsx`、`AiTaskTray.tsx`、`ConnectionStatus.tsx` | 可拖动用量入口、任务来源／用量展示及离线反馈 |
| `src/components/workspace/interactions.css` | 全站任务入口、简洁显示、离线提示与移动操作区 |
| `src/components/StatsPage.tsx` | 优先展示本周实际复用 |
| `src/components/settings/AIRoutingPanel.tsx` | 人民币模型单价配置 |
| `src/components/settings/AppearancePanel.tsx` | 简洁显示选项 |
| `src/components/settings/ConnectionPanel.tsx`、`RuntimeOverview.tsx` | 受保护运行概览与现有处理入口 |
| `scripts/production-ui-regression.mjs` | 同步当前合法壁纸快照与新增读取接口夹具，保留既有断言 |
| `scripts/workspace-optimization-regression.mjs` | 交互、真实明暗主题、四种屏宽、共享背景与截图／指标 |
| `AGENTS.md`、`README.md`、本文件 | 索引、用户说明、证据及兼容／回退边界 |

### 最终验证结果（2026-10-10）

- `npm test`：31 个测试文件、133 项测试通过。
- `npm run build`、`npm run check:bundle`：生产构建和首屏预算通过；保留按需大 chunk 的提示。
- `cargo fmt --manifest-path server/Cargo.toml --check`：通过。
- `cargo test --manifest-path server/Cargo.toml --locked`：140 项通过，2 项性能基准按设计 ignored；模拟 HTTP 供应商覆盖取消、重试、去重及价格快照，不使用真实 AI 额度。
- `cargo clippy --manifest-path server/Cargo.toml --all-targets --locked -- -D warnings`：通过。
- `scripts/production-ui-regression.mjs`：30 项通过。
- `scripts/workspace-optimization-regression.mjs`：9 项行为检查及四种宽度的明暗主题检查通过；浏览器错误列表为空。同页面多个壁纸表面每次仅请求一个相同设备变体。
- `git diff --check` 与浏览器脚本语法检查：通过。

此前受沙箱限制的本机监听／浏览器检查已在允许隔离 loopback 验证的环境完成，不再作为未完成检查。没有运行真实数据库恢复、生产部署或真实 AI 调用。Tauri 壳、部署脚本与依赖未变化，对应专项检查不适用。

状态轮询只读取轻量状态；任务完成后追加一次完整结果读取，避免成功状态下正文为空。该缺陷先由新增回归复现，再修复。壁纸检查在切换视口前卸载旧页面，避免把旧页面响应设备变体变化的有效请求误计入新页面资源数量；仍保持每次新页面仅一次资产请求的断言。

交付截图与浏览器报告保存于 `/home/conj-linux/.codex/visualizations/2026/10/09/01a11e48-a4ea-71c0-874a-e119dd918593/feedback-final`。浏览器及数据库基准均使用隔离合成数据；没有将实验室指标描述为真实用户性能达标。


## 使用流程审查与修正（2026-10-10）

本轮以实际操作场景检查既有修改：找到知识后记录使用、补充旧复用记录、连续输入多个标签／空间、AI 提取后编辑与切换任务、关掉面板稍后继续、目标被其他设备修改后完成合并，以及手机底部导航。使用隔离生产浏览器与合成 API 进行场景走查，没有招募真实用户，也没有操作真实内容；结论是这些场景是否顺畅及已发现阻碍是否修复，不能替代长期用户行为验证。

| 发现 | 本轮优化 | 影响文件 |
| --- | --- | --- |
| 输入分隔符后立即被清理，多个标签／空间难以连续输入 | 输入区保留原始文字，业务字段继续按分隔符解析，保存使用最新输入 | `CandidateOrganizer.tsx` |
| 合并返回版本冲突后只能重复提交旧版本 | 冲突期间禁用确认；提供读取最新版本并重新对照，保留人工编辑，再明确确认 | `CandidateOrganizer.tsx` |
| AI 任务切换会重置候选队列，已处理候选可能再次出现 | 按服务器、任务保留本次页面内候选编辑、跳过状态和处理结果 | `AiTaskTray.tsx` |
| 人工合并正文在关闭面板／切换任务后丢失 | 整理器提供可选的会话草稿回调，面板按候选保存输入与合并选项 | `CandidateOrganizer.tsx`、`AiTaskTray.tsx` |
| 查看结果后缺少回到用量概览的入口，总结不易拿去使用 | 返回紧凑概览、复制总结、返回原记录；周期回顾使用现有路由跳转 | `AiTaskTray.tsx` |
| 首次选中结果期间可能误显示“没有候选”，读取失败无重试入口 | 单独显示结果读取状态，提供重新读取和过期／重启提示，取消／重试防重复点击 | `AiTaskTray.tsx` |
| 补充旧复用记录也显示“已记录一次”，容易误以为新增了事件 | 区分新记录与已有记录的详情编辑，保存／撤销给出反馈；编辑期间防止误点新增 | `ReusePanel.tsx` |
| 阅读时提前请求项目列表，空周视图出现无意义分页按钮 | 只在编辑详情时读取项目；仅多页时展示分页 | `ReusePanel.tsx`、`WeeklyReuse.tsx` |
| 手机打开整理器会自动聚焦输入、弹出软键盘 | 移除强制输入聚焦；正文与最终正文提供明确的可读标签 | `CandidateOrganizer.tsx` |
| 移动端拖动或沿用 PC 位置可能覆盖底部导航 | 以实际导航顶边约束悬浮按钮位置，恢复位置时重新检查边界 | `AiTaskLauncher.tsx` |

人工合并与候选会话草稿只留在当前页面的内存，不写入浏览器持久化存储或形成第二份业务数据库；刷新后未保存的修改不会自动恢复。服务端任务结果仍受已有保留期约束，需要长期保留时请确认入库或保存草稿。

本轮只修改上述前端组件、`scripts/workspace-optimization-regression.mjs` 与本说明。没有新增 API、数据库迁移、配置、依赖、部署或安全边界。服务端、Tauri 壳及部署脚本本轮未修改，未重复运行这些专项检查；前一轮服务端验证记录保留于上文。

本轮验证：`npm test` 133 项通过；`npm run check:bundle` 内含生产构建与预算检查通过，首屏 gzip 178,884 / 180,000 字节；生产浏览器回归 30 项通过；场景回归 10 项及四宽度明暗主题验证通过。合并夹具现在严格验证 `expected_updated_at`，旧版本重试始终失败，必须读取最新版本后才能通过；测试不再以“只拒绝第一次”的方式掩盖版本恢复问题。场景中还模拟连续按键、任务切换、关闭再开、复制、历史详情反馈与导航避让。

最终截图和报告：`/home/conj-linux/.codex/visualizations/2026/10/09/01a11e48-a4ea-71c0-874a-e119dd918593/usability-audit`。回退这些交互变更只需回退本轮前端修改；此前整轮 v27 数据迁移的回退约束保持不变。


## 移动重设计（2026-10-10）

本轮根据截图反馈重新组织手机阅读与辅助操作，沿用既有配色、图标和领域能力。参考 [Apple 滚动视图指南](https://developer.apple.com/design/human-interface-guidelines/scroll-views) 对同向嵌套滚动的提醒，以及 [Material 底部面板指南](https://m2.material.io/components/sheets-bottom/web) 的移动模态工具呈现方式；具体视觉与布局是本项目的实现，没有引入外部 UI 模板或新依赖。

- 内容区按实际屏高扣除底部导航与进行中任务状态条，不把正文放在固定控件下面。页面保持一个主要纵向滚动出口，段落末尾和表单操作可以滚动到完整可见的位置。
- 知识详情隐藏重复的知识库页头与阅读／编辑／复习标签栏，保留一条返回、保存状态与更多操作的导航。编辑、复习、导入、新建、确认沉淀、状态修改与回收站入口都继续可达；阅读时隐藏重复的底部管理栏。
- 手机不显示可拖动的闲置 AI 悬浮按钮。入口位于底部「更多 → AI 用量与任务」；运行任务显示在导航上方的预留状态条，内容视口同步缩小。PC 仍保留可拖动入口，手机切换不覆盖 PC 保存的位置。
- AI 在手机打开为有遮罩的模态底部面板，关闭回到移动入口。用量概览采用两列指标与纵向任务行；选中任务后进入单任务界面，收起重复汇总和任务列表，正文与表单在面板内滚动。
- 面板跟随 `visualViewport` 的高度与底部偏移，兼容缩小视口与软键盘出现时的固定布局；保留显式关闭、外部点击关闭、Escape、焦点恢复。入场使用短时渐入与位移动画，尊重减少动态效果和简洁显示。
- 统一今日、知识库、历史、搜索、复习、复盘、统计和设置的手机页边距、标题、圆角、触控目标与底部空间。代码块与表格只在自己的区域横向滚动。返回顶部工具位于更多菜单，避免另一枚悬浮按钮遮挡正文。

本轮修改文件：

| 文件 | 目的 |
| --- | --- |
| `src/components/workspace/mobile-workbench.css` | 统一 <768px 视口、导航、正文、组件与 AI 面板设计 |
| `src/main.tsx` | 挂载移动工作台样式 |
| `src/App.tsx` | 找回已知任务、打开面板事件与运行状态空间分配 |
| `src/components/Sidebar.tsx` | 手机 AI 用量与返回顶部工具、模态切换的焦点交接 |
| `src/components/KnowledgePage.tsx` | 详情状态标记与完整的移动操作菜单 |
| `src/components/workspace/AiTaskLauncher.tsx` | PC 拖动位置与手机状态入口分工 |
| `src/components/workspace/AiTaskTray.tsx` | 移动模态面板、可视视口适配与焦点恢复 |
| `scripts/workspace-optimization-regression.mjs` | 扩展六种宽度、单栏详情、任务状态条、短屏与模拟键盘检查 |
| `scripts/production-ui-regression.mjs` | 增加全站 360／390px 的导航边界与截图检查 |
| `README.md`、`AGENTS.md`、本文件 | 同步使用入口、项目索引、设计依据与验证边界 |

验证：`npm test` 133 项通过；`npm run check:bundle` 内含 `npm run build -- --manifest`，构建及预算通过，首屏 gzip 179,120 / 180,000 字节。生产浏览器回归 44 项通过；工作区场景 11 项通过，覆盖 360、390、430、768、1024、1440px 明暗主题，以及 390×500 短屏与 420px 模拟可视视口。检查包括正文边界不进入导航或状态条、所有主要功能入口、结果表单按钮可滚动到可见区域、焦点交接与无横向页面溢出。截图与报告分别位于可视化目录的 `mobile-redesign` 和 `mobile-production`。

键盘场景使用浏览器可视视口模拟，不能描述为已在实体 iPhone／Android 键盘上验证；真实设备的输入法和浏览器栏行为仍需要设备检查。全站截图采用隔离合成数据，不读取真实记录、不调用真实 AI。

本轮仅前端与文档，无新增 API、业务数据表、依赖、环境变量、端口、安全边界或生产操作；因此未重复运行未修改的 Rust、Tauri 与部署专项检查。回退本轮前端布局即可恢复旧移动呈现，业务数据不受影响；此前 v27 数据迁移回退约束继续有效。

模拟键盘断言允许与导航检查一致的 1 CSS 像素取整差。诊断确认面板下边界为 420px，按钮下边界为 420.36px，来自 Chromium 对滚动位置的整数取整；不将这个亚像素差判定为内容被键盘遮挡，超过 1px 的遮挡仍使测试失败。几何证据保存在 `keyboard-geometry.json`。

## 阅读优先收尾（2026-10-10）

检查点 `a0c99cb` 保存之前的知识整理、AI 工作流和移动阅读改动。补齐移动知识库显式批量选择的生产回归：浏览时隐藏选择框，通过条目菜单进入，结束选择清空已选状态且回到阅读布局。

阅读改动还包含今日编辑器按需挂载、读取失败与空记录区分、明确编辑入口 `tab=edit`、搜索返回条件与滚动恢复、设置紧凑分类和单题复习。复用区域重复的根因是相邻组件使用相同 React key，已改为按组件职责加前缀；重复开关整理器的回归保持只出现一个复用区域。

基线：生产 UI 52 项通过，首屏 gzip 179,455 / 180,000 字节；服务端 fmt、140 项测试（2 项手动基准 ignored）和 clippy 通过。初次沙箱测试因禁止 loopback 监听失败，允许隔离本机监听后原命令通过；没有访问真实供应商。
