# 知识、导入、复习、复盘与设置重构

更新：2026-09-22。

## 上一轮核查

知识页主体重构已实际写入仓库，原有 81 项单测、25 项隔离浏览器检查及前端打包预算检查通过。上一轮仍有两项体验缺口：知识页采用独立的较亮背景层级，以及导入弹窗保留旧结构。本轮补齐这两项，并重构复习、复盘和设置。

## 本轮实现

### 统一视觉角色

知识、复习、复盘、设置使用同一个 `--ui-canvas` 页面底色，面板使用已有语义表面变量。深色强调文字统一提升可读性，主题色仍由用户原有偏好控制。弹窗使用不透明的浮层表面，避免背景文字透入正文。

`WorkspaceHeader` 与作用域样式统一页面标题、工具栏、边框、字号与操作尺寸，不更换现有 UI 依赖。

### 知识导入

流程为“选择方式 → 准备内容 → 预览与核对 → 显式导入”。直接导入与 AI 辅助提炼分别说明适用内容、支持格式及数据流向。拖放区支持本地文本文件，保留文件大小检查；直接导入保留 JSON、Markdown 与单条文本解析器，不新增未经支持的二进制格式。

预览本身不写入数据。手工导入明确展示有效行及错误行；AI 候选可逐条核对，空标题或正文会阻止提交。只有明确点击导入才写入待确认草稿，不直接建立复习题。

关闭未导入内容前会要求确认。AI 后台任务保留现有恢复机制。从导入页面前往 AI 配置时，原文只在当前浏览器会话中临时保存；返回后重新打开导入可继续，存储失败时会阻止导航并提示先复制原文。

### 记忆复习

先展示真实队列与准备入口，点击开始后才进入作答。问题、可选提示、参考答案和评分分层展示；长答案独立滚动，评分区保持可见。暂停不提交评分。

评分仍使用服务端 FSRS 接口和间隔预览。新增同步请求锁，避免快速连按重复提交；快捷键不拦截输入法、输入框、编辑弹窗或其他弹层。编辑知识条目时关闭未保存内容需确认；评分失败时保留当前答案和队列。评分后立即更新侧栏到期数量缓存。

纠正“确认知识后自动进入复习”的不准确表述：知识条目和复习题分开维护，进入复习需要已有复习题。

### 周期复盘

按月份与周期组织连续文档。类型、状态与搜索使用已有服务端查询，支持已加载月份定位。最新草稿与已确认基线分开标识，不混淆“最新生成”与“已确认”。

历史版本、对比、来源查看、确认、知识提取和删除保留。详情改为阅读优先的侧边文档面板，元数据按需展开；删除放在次级菜单，仍需确认。未保存编辑的取消与退出保护保留。

### 设置

桌面使用分类导航与独立内容区，窄屏切换为可横向滚动的分类栏，并确保当前分类可见。新增设置分类搜索，不检索或显示密钥值。

已打开分类的表单保持挂载，切换分类不丢失未保存输入，原有离开页面保护不变。连接测试成功后才保存的规则保持不变。

数据页拆为“备份与恢复”和“导出与迁移”，避免两套长表单同时挤在首屏。外观页提供明暗模式布局预览和有名称的强调色选择，沿用现有持久化回调。

## 文件职责

| 文件 | 本轮职责 |
| --- | --- |
| `src/index.css` | 全局深色强调文字一致性 |
| `src/components/knowledge/knowledge.css` | 知识页回归共享底色与面板角色 |
| `src/components/workspace/WorkspaceHeader.tsx` | 复习、复盘、设置共享页头 |
| `src/components/workspace/workspace.css` | 工作区、导入、阅读面板、窄屏与主题样式 |
| `src/components/KnowledgeImportDialog.tsx` | 分步导入、关闭保护、配置往返与原有解析/任务编排 |
| `src/components/knowledge/ImportDropzone.tsx` | 拖放与键盘可访问的文件选择 |
| `src/components/ReviewPage.tsx` | 准备、作答、评分、完成与编辑保护 |
| `src/components/ReviewsPage.tsx` | 周期复盘档案、月份导航和版本入口 |
| `src/components/reviews/ReviewShared.tsx` | 阅读侧面板、元数据与安全操作 |
| `src/components/SettingsPage.tsx` | 分类导航、查找设置、表单保留与窄屏定位 |
| `src/components/settings/AppearancePanel.tsx` | 明暗模式和强调色可视化选择 |
| `src/components/settings/DataSafetyPanel.tsx` | 备份/恢复与导出/迁移分区 |
| `src/lib/importWorkflow.ts` 及对应测试 | 文件类型/大小与编辑候选的前端校验 |
| `scripts/workspace-ui-regression.mjs` | 隔离 API 的跨页面浏览器回归 |
| `AGENTS.md` | 模块与验证入口索引 |

## 验证与复现

```bash
npm test
npm run check:bundle
# check:bundle 会重新运行 TypeScript 检查和 Vite 生产构建。
git diff --check
```

浏览器回归需要本机 Vite 运行在 `127.0.0.1:5173`，并有 Chromium/Chrome：

```bash
npm run dev -- --host 127.0.0.1
npm install --prefix /tmp/knowledge-ui-tools playwright-core
KNOWLEDGE_PLAYWRIGHT_MODULE=/tmp/knowledge-ui-tools/node_modules/playwright-core/index.mjs \
  node scripts/knowledge-ui-regression.mjs
KNOWLEDGE_PLAYWRIGHT_MODULE=/tmp/knowledge-ui-tools/node_modules/playwright-core/index.mjs \
  node scripts/workspace-ui-regression.mjs
```

可通过 `KNOWLEDGE_CHROME_PATH` 指定 Chrome 可执行文件、`KNOWLEDGE_UI_OUTPUT` 指定截图与报告输出目录。默认新回归输出在 `/tmp/daily-summary-workspace-audit/`。测试依赖位于临时目录，不改变项目依赖与锁文件。

验证基线：89 项单测、25 项知识回归、46 项跨页面浏览器检查。浏览器使用合成数据与内存 API 拦截，覆盖浅色/深色、360/390/768/1280/1600px、输入法保护、快速评分、长答案操作区、导入预览与提交、AI 后台恢复、配置往返、未保存保护、版本基线与对比、备份确认以及设置表单保留。

## 边界与回退

没有修改 API 契约、数据库结构、服务端、令牌规则、端口或部署配置。没有新增运行时依赖，也没有重启服务。前端构建更新 `dist/`；当前服务从该目录读取静态资源。

未执行真实知识库写入、真实 AI 请求、真实备份恢复，也未验证 Firefox、Safari、Tauri 原生窗口和实体移动设备。后端测试未运行，因为本轮未改后端。构建仍会提示部分延迟加载分块大于 500 kB；初始 JavaScript gzip 预算检查独立通过。

本轮开始前的文件在 `/tmp/daily-summary-workspace-audit/before/`，保留相对仓库路径；上一轮知识页原始入口另在 `/tmp/daily-summary-knowledge-before/KnowledgePage.tsx`。本轮回退应以本轮快照为基准，逐文件恢复本轮涉及内容并重新构建，不应使用全仓库 reset 或覆盖之后新增的用户修改。无需数据库迁移。

## 调研依据

参考的是交互原则，而不是复刻品牌：Linear 的层级与密度整理，Notion 的导入方式/能力边界/进度组织，Radix 的键盘与焦点管理。

- Linear： https://linear.app/changelog/2024-03-20-new-linear-ui
- Notion： https://www.notion.com/help/import-data-into-notion
- Radix Tabs： https://www.radix-ui.com/primitives/docs/components/tabs
- Radix Dialog： https://www.radix-ui.com/primitives/docs/components/dialog

## 最终一轮：统计、记录、搜索、导航与今日 AI（2026-09-22）

### 结构变化

统计页拆为记录概览、记忆复习、知识整理、生成复盘四个任务视图。默认页保留四项核心指标、可操作月历和实际字数趋势，删除重复覆盖环、重复指标和长期占位说明。月历继续调用原有日期状态接口；周/月复盘仍使用原生成流程。知识完整度不再把可选来源缺失描述为质量失败，也不相加成虚构的健康分。

记录页在没有选中文档时完整使用列表区域，按时间展示文档行；打开内容后再呈现详情，窄屏改为独立阅读弹层。保留时间线、按月份、回收站、定位日期、分页加载、删除确认与撤销。次要删除操作收进菜单，减少危险按钮常驻。

搜索页提供记录、知识、复盘三个真实检索范围。输入法组合中不会触发提交；搜索、范围与分页继续写入 URL。新增复盘读取预览，分离搜索失败和打开文档失败，保留原有内容高亮与文章编辑路径。

侧边栏重排主导航、回顾与成长及系统入口，移除多层折叠菜单和重复复习卡。折叠偏好沿用现有键；窄屏保持五项底部导航和更多入口。复习角标只在存在待复习题时出现，Ctrl/Cmd+B 不拦截正文编辑。

今日 AI 总结与知识提取独立为 `TodayAIPanel`。打开面板不会自动请求 AI。总结保留在当前页面，不覆盖今日原文；知识可以直接从原文提取，无需先生成总结。提取先调用已有候选分析接口（不保存知识条目），允许逐项选择、编辑和核对，只有点击保存后才调用草稿导入接口。提交时先确保原记录保存成功，并核对原文版本及来源日期；旧结果、空标题/正文和重复点击均有保护。

全站移除重复页头口号与今日页多处字数说明；长标题在移动端换行。按钮内边距导致月份箭头被压小、移动月历图标遮挡日期、记录页旧固定宽度和手机记录标签过窄等问题，在实际截图检查后修正。

### 性能与服务端兼容

移除启动两秒后预加载全部页面的逻辑，保留路由懒加载及悬停/聚焦意图预加载。移除记录列表逐项入场动画；复习图表禁用无必要的初始动画，尊重 reduced-motion。

真实只读检查发现当前运行服务端缺少 `/reviews/query`。前端现在仅在此端点返回 404 时读取已有 `/reviews` 列表并做内存分页/筛选，权限、连接和服务端错误不会被掩盖。新版本服务端仍使用原分页路径；旧版本回退需要读取完整复盘列表，大量历史数据时推荐后续正常升级服务端。本次未重启服务、未更改鉴权，也未创建第二份业务数据库。旧版“当前月”展示辅助统计使用客户端日历月份；新接口仍以服务端统计为准。

### 最终文件索引与验证

| 文件 | 本轮目的 |
|---|---|
| `src/components/StatsPage.tsx` | 按任务组织统计，收敛重复信息，保留月历与复盘生成 |
| `src/components/HistoryPage.tsx` | 文档行、条件详情区、移动阅读、次级危险操作 |
| `src/components/SearchPage.tsx`、`src/router.tsx` | 三范围检索、可恢复 URL、输入法保护与结果阅读 |
| `src/components/Sidebar.tsx` | 简化导航、折叠、键盘与移动端更多入口 |
| `src/components/TodayPage.tsx`、`src/components/TodayAIPanel.tsx` | 总结与候选知识工作流、源版本保护、长标题换行 |
| `src/components/workspace/final-ui.css`、`WorkspaceHeader.tsx` | 统一排版、组件对齐、滚动区、小屏与移动端 |
| `src/components/KnowledgePage.tsx`、`ReviewPage.tsx`、`ReviewsPage.tsx`、`SettingsPage.tsx` | 移除重复页头说明，不改变业务流程 |
| `src/lib/todayAiWorkflow.ts`、同名单测 | 原文快照一致性与候选字段校验 |
| `src/lib/reviewCompatibility.ts`、同名单测、`src/lib/api.ts` | 旧版复盘服务的只读回退；不吞掉认证或服务异常 |
| `src/App.tsx` | 从全量定时预加载改为访问意图预加载 |
| `public/sw.js` | 缓存版本递增到 v4，避免已安装 PWA 持续引用旧前端 |
| `scripts/final-ui-regression.mjs` | 隔离内存数据的最终 UI 回归 |

运行：

```bash
npm test
npm run build
npm run check:bundle
node --check public/sw.js
KNOWLEDGE_PLAYWRIGHT_MODULE=/tmp/knowledge-ui-tools/node_modules/playwright-core/index.mjs \
  node scripts/final-ui-regression.mjs
```

最终回归为 100 项单测（22 个文件）、63 项新增浏览器检查，并重跑 25 项知识与 46 项工作区回归。新增覆盖统计分类、月份切换、真实复盘检索、旧端点回退、记录分页和弹层切换、知识提取预览/确认、过期原文阻止入库、AI 失败重试、输入法与快捷键、360/390/768/1024/1280/1600px，以及 740×480 横屏和 reduced-motion。

本轮使用真实服务认证做了 8 个入口的只读访问检查，禁止任何写请求；发现的旧复盘端点 404 已由兼容路径处理。没有向真实 AI 服务商请求生成，没有对真实知识、记录或备份做测试写入。令牌没有进入源码、截图说明或测试报告。

当前初始 JavaScript gzip 为 138,217 字节；上一轮为 177,913 字节，减少约 22.3%，仍低于 180,000 字节预算。此数字是构建指标，不代表所有设备上的加载耗时或帧率。大于 500 kB 的部分延迟加载分块提示仍存在。

没有新增运行时依赖、数据库迁移或服务端 API；前端仅重用已有接口并为旧版读取提供兼容。浏览器验证为 Chrome，未完成 Firefox/Safari、实体手机、原生 Tauri 的实机验证；后端未修改，未运行后端测试。

当前任务前的源码快照在 `/tmp/daily-summary-final-before/src/`，文档在同目录，Service Worker 单独保存为 `sw.js`。回退应逐文件对照本轮快照并重新构建，不覆盖后续用户变更。构建已更新 `dist/`，没有执行部署脚本或重启生产服务。

## 2026-09-22：统计生产版修复与全站交互

本轮在 8080 的真实生产包上复现 `TypeError: t is not a function`。错误发生于 Recharts 使用的 es-toolkit CommonJS 兼容入口初始化；开发预览正常不能证明生产包正常。对应上游问题：https://github.com/recharts/recharts/issues/7376 。

`vite.config.ts` 接入 `scripts/recharts-compat.ts`，仅在生产构建中将 Recharts 的兼容函数导入转换为同一工具包的命名 ESM 导入。不改 node_modules、不关闭压缩、不改变图表计算，不引入新依赖。新增转换单测。

侧边栏使用独立 `workspace/sidebar.css`，统一导航项、图标、分组与选中态；新增悬停快捷键提示、折叠标签提示、方向键导航、显示模式菜单及快捷键入口。保留原路由、折叠偏好和真实复习角标。

`WorkspaceInteractions.tsx` 与 `interactions.css` 提供全站短时反馈、主要页面切换淡入、按需出现的返回顶部和快捷键对话框。输入、输入法与弹层不会触发导航快捷键；遵循系统减少动态效果设置。不以重新挂载页面的方式播放动画。

`MonthPicker.tsx` 提供统计月份快速选择及键盘操作。`PageLoadError.tsx` 接入路由错误边界，加载失败时保留导航和重新加载入口；预加载失败不再产生未处理的 Promise 拒绝。

新增 `scripts/production-ui-regression.mjs`，默认检查 8080 的优化后静态资源，明确断言统计页、含 XAxis 的图表、其他路由和失败恢复状态。API 使用内存夹具，不触碰真实业务数据。`final-ui-regression.mjs` 增加可配置的 loopback 测试来源，使原业务回归也能针对生产包运行。

本轮验证：111 项单元测试、30 项生产交互检查、63 项完整生产 UI 回归通过。另在真实服务上完成 8 个页面的认证只读检查，统计图表渲染成功，没有运行时异常、认证失败或写入。初始 JavaScript gzip 为 168100 字节，低于 180000 字节预算；大分块提示仍存在。

没有修改后端、数据库、鉴权或部署配置，也没有运行真实 AI 生成、恢复备份或数据写入。未测试 Firefox、Safari、Tauri 原生窗口和实体移动设备。缓存版本更新为 daily-summary-v5；刷新仍显示旧界面时需强制刷新。

回退参考 `/tmp/daily-summary-stats-repair/before/` 与本轮源码差异，只还原本轮文件；不要覆盖之后新增的用户修改。撤销构建适配会重新暴露旧图表依赖的生产兼容问题，不建议单独撤销此修复。

生产回归复现（先构建，确保本地 8080 服务正在提供本项目 dist；接口均由测试夹具拦截）：

```bash
npm test
npm run check:bundle
KNOWLEDGE_PLAYWRIGHT_MODULE=/tmp/knowledge-ui-tools/node_modules/playwright-core/index.mjs \
  node scripts/production-ui-regression.mjs
KNOWLEDGE_PLAYWRIGHT_MODULE=/tmp/knowledge-ui-tools/node_modules/playwright-core/index.mjs \
  KNOWLEDGE_FRONTEND_ORIGIN=http://127.0.0.1:8080 \
  node scripts/final-ui-regression.mjs
```

Playwright 可按上文安装到临时目录，或把 `KNOWLEDGE_PLAYWRIGHT_MODULE` 指向现有模块；本轮实际使用已有 `/tmp/daily-summary-knowledge-audit/browser-tools/`，没有修改依赖清单。使用另一 loopback 静态预览端口时设置 `KNOWLEDGE_FRONTEND_ORIGIN`。生产检查会拒绝开发源码资源，需先构建。
