# daily-summary Agent 指南

## 规则优先级与适用范围

本文件适用于仓库根目录及其所有子目录，是项目索引和执行约束。系统指令、用户指令以及更具体目录中的 AGENTS.md 优先级更高。

文中的规则分为三个级别：

- **MUST**：必须遵守；无法满足时不能声称任务已完成。
- **SHOULD**：默认遵守；确有理由跳过时，在交付说明中说明原因。
- **MAY**：按任务需要采用。

每次任务开始时：

1. **MUST** 读取本文件，并在目标目录继续查找更具体的 AGENTS.md。
2. **MUST** 运行 git status --short，把已有修改视为用户内容；不得覆盖、回滚或清理这些修改。
3. 如果目标文件已经有修改，**MUST** 先检查 git diff -- <path>；无法安全区分用户修改与当前任务时，必须停下请求确认。
4. **MUST** 根据下方索引读取与任务相关的 source of truth，不要求无条件通读无关模块。
5. **SHOULD** 使用 rg 或 rg --files 定位源码、配置和测试。

依赖、构建产物、部署暂存目录和本地运行数据不属于源码或提交内容，除非任务明确针对它们：
node_modules/、dist/、server/target/、src-tauri/target/、src-tauri/gen/、.deploy-stage.* 以及本地运行数据。

## 项目模型与领域边界

daily-summary 是一个单用户、自托管的工作记录、知识沉淀与间隔复习工具：

~~~text
今日记录 → AI/手工提炼 → 知识条目 → FSRS 记忆复习 → 复用追踪 → 备份/迁移
~~~

必须保持以下边界：

- 浏览器、手机浏览器和 Tauri 桌面端都是客户端，通过 HTTP API 访问服务端。
- Rust/Axum 服务端是鉴权、业务规则、AI 代理、导出、备份和数据访问的唯一边界。
- SQLite 是持久化单一数据源；前端不直接读写数据库，也不维护第二份业务数据库。
- AI 是可关闭的辅助能力。AI 生成的复盘和候选知识必须独立保存，不能覆盖原始今日记录。
- 以 CONTEXT.md 的领域词汇为准：今日记录、空间、主题、项目、文档、知识条目、复习题、记忆复习、周期回顾、来源、候选知识。

## 运行契约

除非任务明确修改运行契约，否则保持以下约定：

| 项目 | 约定 |
| --- | --- |
| 服务端端口 | 8080；可用 DAILY_SUMMARY_BIND 为部署或测试显式覆盖监听地址 |
| 本地 API | npm run server:dev 绑定 127.0.0.1:8080，并通过 DAILY_SUMMARY_ALLOW_NO_TOKEN=1 开启本地无令牌开发 |
| 服务端默认地址 | 未设置 DAILY_SUMMARY_BIND 时回退到 0.0.0.0:8080；域名部署由 setup.sh 配置为 127.0.0.1:8080 并交给 HTTPS 反向代理，IP 部署是受控的 0.0.0.0:8080 明文例外 |
| Web 开发服务 | npm run dev 使用 http://localhost:5173 |
| Vite 代理 | /api 和根 /health 代理到 http://127.0.0.1:8080 |
| 健康检查 | 公开存活检查为 GET /health；受令牌保护的详细检查为 GET /api/health |
| 本地数据 | SQLite 和运行状态默认位于用户数据目录下的 .daily-summary/，具体路径以 server/src/helpers.rs 和 server/src/db.rs 为准 |
| 本地 AI 测试链接 | `http://127.0.0.1:5173/today?local_ai_token=daily-summary-local-ai-test-token`；仅 loopback 开发服务可用 |
| Tauri | 开发仍使用 http://localhost:5173；远程 API 地址通过设置页或 VITE_API_BASE_URL 配置，不得改为直接访问 SQLite |
| 服务端工作目录 | 从 server/ 运行，使静态资源回退正确解析到 ../dist；npm run server:dev 已处理该切换 |

端口、入口或 /api 前缀发生变化时，**MUST** 在同一变更中核对并同步：
package.json、vite.config.ts、server/src/server.rs、server/.env.example、部署脚本、健康检查和相关测试。

安全门槛：

- DAILY_SUMMARY_ALLOW_NO_TOKEN=1 只能用于 loopback 监听地址（127.0.0.1、localhost 或 ::1）；与非 loopback 监听组合时服务必须拒绝启动。
- 生产、systemd、反向代理和公开网卡监听不得启用无令牌模式；生产必须配置 DAILY_SUMMARY_TOKEN。
- 公网长期使用必须采用 HTTPS 反向代理。IP + HTTP 只能作为明确的受控网络例外，并且必须启用令牌和网络访问限制。
- 不能把有令牌保护的明文公网 HTTP 描述为安全传输；变更监听、TLS、反向代理或防火墙属于安全边界变更。

### 本地 AI 页面链接（测试令牌）

- 本地开发脚本通过 `DAILY_SUMMARY_LOCAL_AI_ACCESS=1`、`DAILY_SUMMARY_LOCAL_AI_TOKEN=daily-summary-local-ai-test-token` 开启测试入口；生产部署必须保持 `DAILY_SUMMARY_LOCAL_AI_ACCESS=0` 且不配置该令牌。
- 可交给具备浏览器能力的 AI 的入口是 `http://127.0.0.1:5173/today?local_ai_token=daily-summary-local-ai-test-token`。`localhost` 或 `::1` 对应地址也可以使用。
- `src/main.tsx` 会在 loopback 页面首次加载时消费 URL 令牌、写入当前会话临时存储并清理地址栏；`src/lib/api.ts` 只会对 loopback API 使用该临时令牌，并通过 `Authorization: Bearer ...` 发送。
- `server/src/middleware.rs` 只在显式开关、令牌配置和 loopback 绑定同时满足时接受该令牌，并仅允许 GET、HEAD、OPTIONS；它是公开的测试值，不替代生产 `DAILY_SUMMARY_TOKEN`。

## 项目索引

以下索引用于导航，不是额外的全量阅读要求。先读取“首先查看”，只有任务影响调用链或数据边界时再继续追踪。

### 按任务定位文件

| 任务 | 首先查看 | 继续追踪 |
| --- | --- | --- |
| 应用启动、全局布局、侧栏、主题、快捷键 | src/main.tsx、src/App.tsx | src/components/Sidebar.tsx、src/components/CommandPalette.tsx、src/index.css、src/lib/theme.ts |
| 页面路由、URL 搜索参数、页面间导航 | src/router.tsx | 目标页面组件、src/App.tsx 的 shell 回调 |
| 前端 API、DTO、错误处理、Query key | src/lib/api.ts | 对应服务端路由、handler、server/src/models.rs 和测试 |
| 今日记录、历史、归档、日期状态 | src/components/TodayPage.tsx | src/components/HistoryPage.tsx、src/components/ArchivePage.tsx、src/lib/dailyRecordSession.ts、server/src/articles.rs、server/src/archive.rs、server/src/day_exemptions.rs |
| 知识条目、空间、导入、回收站 | src/components/KnowledgePage.tsx | src/components/KnowledgeImportDialog.tsx、src/components/SpaceManagerDialog.tsx、src/components/KnowledgeTrashPage.tsx、src/lib/knowledgeImport.ts、src/lib/knowledgeMetadata.ts、server/src/knowledge.rs |
| 复习题、FSRS 记忆复习、复习历史 | src/components/ReviewPage.tsx | src/components/ReviewItemsPanel.tsx、src/components/ReviewsPage.tsx、src/lib/reviewContent.ts、server/src/review.rs、server/src/stats.rs |
| 周期回顾、AI 生成和模型路由 | src/components/StatsPage.tsx、src/components/settings/AIRoutingPanel.tsx | src/lib/reviewGeneration.ts、server/src/ai.rs、server/src/ai_client.rs |
| 设置、连接、AI、备份/导出 | src/components/SettingsPage.tsx、src/components/settings/ | src/lib/api.ts、server/src/exports.rs、server/src/backups.rs、server/src/backup_policy.rs、server/backup.env.example、ops.sh |
| 服务端启动、CLI 参数、快照和启动检查 | server/src/main.rs | server/src/server.rs、server/src/backup_policy.rs、ops.sh |
| SQLite 数据、schema、迁移、持久化测试 | server/src/db.rs | server/src/models.rs、server/src/persistence_tests.rs；迁移测试位于 server/src/db.rs 附近的测试模块 |
| HTTP 路由、鉴权、CORS、静态资源 | server/src/server.rs、server/src/middleware.rs | server/src/helpers.rs、server/.env.example、vite.config.ts |
| 生产部署、systemd、Caddy、防火墙 | setup.sh | README.md 的部署章节、ops.sh、.github/workflows/ci.yml、server/backup.env.example |
| Tauri 桌面壳 | src-tauri/tauri.conf.json、src-tauri/src/main.rs | src-tauri/build.rs、src-tauri/Cargo.toml、src-tauri/capabilities/、src-tauri/icons/；业务逻辑仍在 src/ 和 server/ |
| 设计、领域决策、术语或安全边界 | CONTEXT.md、SECURITY.md | 相关 docs/ 研究文档；仅在任务涉及该主题时读取 |

### 页面路由索引

页面路由集中定义在 src/router.tsx，页面主体位于 src/components/：

| 路由 | 页面 | 主要职责 |
| --- | --- | --- |
| /today | src/components/TodayPage.tsx | 编辑今日记录、日期切换和记录相关动作 |
| /history | src/components/HistoryPage.tsx | 分页浏览历史记录 |
| /archive | src/components/ArchivePage.tsx | 按月份查看归档记录 |
| /search | src/components/SearchPage.tsx | 搜索今日记录和知识条目 |
| /stats | src/components/StatsPage.tsx | 统计、月历、周回顾和周期回顾入口 |
| /reviews | src/components/ReviewsPage.tsx | 浏览已生成的周期回顾 |
| /review | src/components/ReviewPage.tsx | 执行 FSRS 记忆复习 |
| /knowledge | src/components/KnowledgePage.tsx | 浏览、筛选、编辑和批量管理知识条目 |
| /knowledge/new | src/components/KnowledgePage.tsx | 新建知识条目 |
| /knowledge/trash | src/components/KnowledgeTrashPage.tsx | 查看和恢复知识回收站内容 |
| /knowledge/$cardId | src/components/KnowledgePage.tsx | 查看或编辑单个知识条目 |
| /settings | src/components/SettingsPage.tsx | 连接、AI、复习、备份和导出设置 |

### 服务端模块索引

server/src/server.rs 的 build_router 是 HTTP API 路由的唯一索引。前端业务 API 调用集中在 src/lib/api.ts；设置页的服务器地址探测可以保留专用请求，但必须复用统一的鉴权和错误约定，不在页面组件中新增业务 API 契约。

| API 前缀/资源 | 服务端模块 |
| --- | --- |
| /articles、/archive、/day-exemptions | server/src/articles.rs、server/src/archive.rs、server/src/day_exemptions.rs |
| /stats | server/src/stats.rs |
| /knowledge-cards、/spaces、/review-items | server/src/knowledge.rs |
| /review | server/src/review.rs |
| /reviews、/ai | server/src/ai.rs，外部请求由 server/src/ai_client.rs 承担 |
| /export | server/src/exports.rs；完整归档入口也在 server/src/server.rs |
| /backups | server/src/backups.rs、server/src/backup_policy.rs |
| /health、鉴权、CORS、安全响应头 | server/src/server.rs、server/src/middleware.rs |
| 服务端启动、CLI 参数和快照 | server/src/main.rs |
| 构建标识和编译时元数据 | server/build.rs |

## 不可破坏的实现规则

- **MUST** 沿真实数据流检查跨层修改：页面组件 → src/lib/api.ts → server/src/server.rs 路由 → 领域 handler → server/src/models.rs / server/src/db.rs → SQLite。
- 如果索引与实际代码冲突，以实际 source of truth 为准；完成任务时修正失效索引，不得让索引阻塞安全修复。
- 修改路由或 URL 参数时，**MUST** 同时检查 src/router.tsx、页面初始参数、导航回调、返回行为和刷新行为。
- 修改 API 契约时，**MUST** 同步检查 src/lib/api.ts、服务端路由/模型/handler、成功与错误状态、缓存失效以及相关测试。
- 修改持久化时，**MUST** 检查 Database::initialize、schema_version、迁移测试、导入导出兼容性和恢复路径。
- 数据库变化**必须**通过 server/src/db.rs 的版本化迁移完成，不得直接改用户数据库文件。
- 浏览器存储只用于主题、连接配置、令牌和临时草稿等客户端辅助状态；今日记录、知识条目、复习题和复习状态的权威数据必须在服务端 SQLite。
- **SHOULD** 复用现有的 React、Tailwind、Radix、TanStack Query/Router、Lucide 和本地 UI 原语。新增依赖前说明收益、维护成本和替代方案。
- API 错误、加载、空状态、确认反馈和取消行为**必须**复用现有模式，并处理重复请求与缓存更新。
- 面向用户的文本**必须**使用 CONTEXT.md 的领域词汇；交互改动**必须**保持键盘访问、焦点管理、可读标签和窄屏布局。
- 机密信息只从环境变量或服务端配置读取；日志、错误消息、测试夹具和文档不得输出 token、AI Key、数据库内容或备份凭据。
- AI 请求只通过服务端代理发出；按任务最小化发送今日记录，不在日志、错误消息或诊断输出中记录完整 prompt、响应或凭据。
- 测试失败时必须先区分实现缺陷、测试缺陷和契约变化；不得仅为通过测试而删除、弱化或绕过回归断言。更新 snapshot 或期望值必须说明行为依据。
- 生产部署、恢复、备份删除、清理历史备份、修改防火墙或其他外部副作用操作，必须有明确用户授权；恢复或删除前先确认精确目标、保护点和回滚路径。

## 执行流程

### 1. 建立变更边界

先根据任务将影响归类为：UI、前端数据/API、服务端/API、数据库、部署/安全或文档。用 rg 定位真实实现和测试，并记录可能受影响的调用方、数据字段和配置。

### 2. 选择必要的追踪深度

- 仅文案、样式或局部 UI：通常只需检查目标组件及其共享 UI 原语。
- 前端行为、路由或 API 调用：追踪到 src/lib/api.ts、路由定义和相关缓存/导航。
- API、持久化、备份、鉴权或部署：沿完整数据流追踪到服务端 handler、模型、数据库或脚本。

### 3. 实现最小完整变更

- **MUST** 保持服务端单一数据源、端口契约和现有安全边界。
- **SHOULD** 只在以下情况进行额外方案调研：新增运行时/构建依赖、引入核心抽象或新的存储/网络协议、改变部署/备份/安全模型、较大架构重构。优先看官方文档、标准/规范和仍维护且技术栈匹配的项目，并在交付说明中记录简短结论。
- 普通 UI、CRUD、局部 bug 修复、样式调整和机械重命名不要求单独调研。
- 依赖变化**必须**同步锁文件：前端为 package-lock.json，服务端为 server/Cargo.lock，桌面端为 src-tauri/Cargo.lock。**SHOULD** 在依赖或发布相关任务中使用 npm ci 和 Cargo 的 --locked 选项验证可复现安装。
- 新增、删除或重命名环境变量时，**MUST** 检查所有读取方、server/.env.example、server/backup.env.example、setup.sh、ops.sh、systemd 配置、README 和相关测试；可用 rg 搜索 DAILY_SUMMARY_、RESTIC_ 和 BACKUP_ 做交叉核对。
- 稳定的新页面、服务端模块、API 资源、脚本、环境变量或用户入口完成后，**MUST** 更新本文件的相关索引；临时目录、测试夹具、内部 helper 和一次性重命名不需要机械登记。

## 验证矩阵

按实际影响选择检查，不要求每个小改动都运行全部 CI：

| 变更范围 | 至少运行 |
| --- | --- |
| 本文件、README 或其他文档 | 检查引用的路径、命令和链接；未影响代码时不要求产品测试 |
| 前端组件、交互或样式 | npm test、npm run build |
| 路由、前端 API、生产 bundle 或前端依赖 | 上一行检查，并视影响运行 npm run check:bundle |
| 服务端逻辑或 API | cargo fmt --manifest-path server/Cargo.toml --check、cargo test --manifest-path server/Cargo.toml --locked、cargo clippy --manifest-path server/Cargo.toml --all-targets --locked -- -D warnings |
| 数据库 schema 或迁移 | 服务端逻辑/API 检查，并确认迁移、旧数据、导入导出和恢复测试 |
| setup.sh、ops.sh 或部署防护 | bash -n setup.sh ops.sh；涉及安装模式时运行 bash scripts/test-setup-mode-guards.sh |
| 鉴权、CORS、健康检查、备份/恢复、导出、AI 或敏感信息处理 | 上述相关检查，并覆盖无令牌、错误 token、CORS 拒绝、路径穿越、恢复失败回滚和敏感字段不泄露等场景 |
| Tauri 桌面端 | cargo fmt --manifest-path src-tauri/Cargo.toml --check、cargo check --manifest-path src-tauri/Cargo.toml --locked |
| 跨前后端、数据库、部署或安全边界 | 合并所有相关行的检查；需要时补充手动联调 |

**SHOULD** 以 CONTRIBUTING.md、.github/workflows/ci.yml 和对应锁文件为准补充完整 CI 与依赖安全审计。无法运行某项检查时，**MUST** 在交付说明中写出准确命令、失败原因和剩余风险，不得将其描述为已通过。

涉及启动、代理、鉴权或健康检查时，**MAY** 手动联调：

~~~bash
npm run server:dev
npm run dev
curl http://127.0.0.1:8080/health
~~~

生产联调必须使用令牌和 server/.env 配置；不得把 server/.env 或其中的值写入工具输出、日志、补丁、提交或 URL，应通过受保护的环境注入或安全本地渠道使用。读取不到凭据时记录阻塞原因，不得把 token 写入命令参数。本地无令牌命令只用于开发且只能绑定 loopback。

## 交付要求

交付说明**必须**包含：

- 修改的文件及各自目的；
- 运行过的验证命令及结果；
- 未运行的检查及原因；
- 是否涉及 API、数据库、配置、部署或安全边界；
- 必要的迁移、兼容性和回滚提示；
- 若做过方案调研，给出简短结论。

任务只有在改动覆盖真实调用链、相关检查通过或失败原因已记录，并且没有引入未说明的架构、依赖或安全边界变化时，才可视为完成。

## 敏感内容与操作边界

- 真实源码和配置优先位于 src/、server/src/、server/build.rs、server/Cargo.toml、server/Cargo.lock、server/.env.example、server/backup.env.example、src-tauri/src/、src-tauri/build.rs、src-tauri/Cargo.toml、src-tauri/Cargo.lock、src-tauri/tauri.conf.json、src-tauri/capabilities/、src-tauri/icons/、public/、.github/workflows/、根配置和脚本。
- server/.env、server/.env.backup、数据库、备份包、token、AI Key 和 Restic 密码属于敏感内容；不得在工具输出、日志、补丁、提交或 URL 中暴露真实值，也不得复制到工作区；只能通过示例文件表达配置。
- setup.sh、systemd、CI 和监控输出不得显示完整 token、AI Key、Restic 密码或其他凭据；需要确认配置时只显示是否存在、来源或脱敏提示。
- 修改 setup.sh 或 ops.sh 前，**MUST** 阅读对应函数和 README.md；涉及真实数据的命令必须先确认目标路径和回滚点。
- 不得把 dist/、server/target/、src-tauri/target/、src-tauri/gen/、node_modules/、.deploy-stage.* 或本地运行数据作为提交内容。
- 未经用户明确要求，不得使用会覆盖或删除用户内容的命令，例如 git reset --hard、git checkout --、git clean 或递归删除。即使获得明确授权，也要先确认精确目标和可恢复性。
