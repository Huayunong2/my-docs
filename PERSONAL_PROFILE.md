# 个人档案：正式模块

更新日期：2026-10-12。本模块从空档案开始，通过 HTTP API 保存到服务端 SQLite。没有浏览器业务数据库，不加载虚构人物，不把 AI 分析写回原始事实。

## 实际使用

- `/profile` 概览汇总已取得学历、当前在读/在职情况、活动目标、成果与里程碑；手写方向与状态事实分开。
- `tab=timeline` 浏览教育、工作、学习、项目、成果、证书和里程碑。`profileKind` / `q` 保存筛选，`entry` 保存选中条目，刷新与返回保持可定位性。PC 宽屏使用已有可调整分栏；手机详情隐藏全局工具，优先阅读正文，返回列表恢复位置。
- `tab=goals` 保存独立目标、期望日期、下一步和状态，关联真实空间 ID；不会改写空间中的知识或复习状态。
- 条目可关联今日记录、知识条目或空间；名称从服务端刷新，改名不改变关联身份。删除/归档的来源显示不可用；手写依据不是独立验证。
- `tab=context` 按用途推荐并逐条选择允许使用的资料，由服务端复核许可和版本后编排。联系方式字段不发送，用户仍应检查自己写入简介等自由文本的内容。
- 个人分析把当前预览和问题发送给已配置 AI，保留当时背景、指纹、资料 ID 和独立结果；事实变化或迁移后提示旧结果。AI 可不配置，其他档案功能正常使用。分析不是一小时过期的任务结果；它保存在 SQLite，历史支持分页。用量/费用尚未汇入悬浮任务统计，显示未记录，不计为零。
- 保存失败、401/403 和版本冲突不会清空表单。冲突三方比较会保留服务器未冲突的修改；同时修改的字段需用户选择，再保存。移除进入回收站，恢复保留 ID，当前背景选择不自动重新加入。

## 导入与职业输出

JSON Resume 导入先本地预览并由本人确认状态，只补当前概况空白字段，完全相同的经历跳过；姓名不同必须确认属于本人。识别基本资料、技能自述、教育、工作、项目、奖项、发表和证书。未识别模块留在原文件，非 JSON Resume 结构不承诺无损解析；PDF/Word 解析与自动全库抽取尚未实现。

Markdown 是资料输出，不替代完整迁移包。背景 Markdown 只用当前所选许可资料；完整 Markdown 可以包含未允许选入背景的记录，范围明确预览，不包含个人分析全文。

JSON Resume / 简历打印有独立的条目选择，不受“允许发送给 AI”限制；联系方式需单独勾选。计划中条目不导出，奖项与普通交付区别映射，关联交付成果可以进入所属经历的 highlights。浏览器打印/保存 PDF 使用 A4 打印样式，不引入服务端无头浏览器。私密依据说明与分析不进入简历输出。

## 数据链、迁移与恢复

数据流：页面 → `src/lib/api.ts` → `/api/profile` 认证路由 → `server/src/profile.rs` → `server/src/db/profile.rs` → SQLite。

SQLite v28 在 `server/src/db.rs` 版本化迁移创建 `personal_profile`、`personal_entries`、`personal_goals`、`personal_analyses`。默认概况为空。条目 ID 稳定，保存采用全档案 revision；实体文本使用受校验的明确 DTO，分类、状态与排序字段结构化存储。

完整 JSON 归档升级为 v4，加入 `personal_profile` 块（概况、条目、目标、分析）。ZIP 外层保持 v1，清单增加档案计数与存在标记，业务数据仍是 data.json v4。旧 v1/v2/v3 JSON 缺字段时不清空已有档案；空档案导入默认保留目标档案。不同的既有档案默认拒绝导入，替换需要用户明确勾选、提交当前档案版本，并在保护快照后执行。版本变化或导入失败不应部分覆盖业务数据；文章来源 ID 沿现有导入映射重写，空间按导出的当前规范名称映射到目标 ID。

普通数据库快照包含全部档案表。恢复旧快照可能使个人档案回到当时状态或为空，遵循现有恢复保护点和失败回滚流程。旧程序无法完整读取 v4 归档；回退程序前保留新版本完整迁移包，再恢复升级前数据库保护点，不能只换旧二进制并宣称新数据仍可完整使用。

独立验证使用随机本机端口、临时 SQLite 与模拟 AI，不连接用户正在使用的数据库。

## API

| 资源 | 行为 |
| --- | --- |
| GET/PATCH `/profile` | 读取档案、版本与概况；更新带 expectedRevision |
| PUT `/profile/entries/:id`、PATCH `.../state` | 条目保存、软移除/恢复，重复相同提交不创建额外条目 |
| PUT `/profile/goals/:id`、PATCH `.../state` | 独立目标保存、软移除/恢复 |
| GET `/profile/sources?kind=&q=` | 受保护的真实来源 ID 查询，每次最多 30 项，可继续搜索 |
| POST `/profile/import-resume` | 本人确认的简历资料批量导入，事务与重复检测 |
| POST `/profile/context` | 复核当前版本、所选条目和许可，返回背景与指纹，不调用模型 |
| POST `/profile/analyze` | 校验预览指纹与请求 ID，重复请求复用结果；失败/中断保留状态 |
| GET `/profile/analyses`、GET `.../:id` | 分页摘要与按需读取结果/当时背景；列表不返回全文 |

所有资源沿用令牌、CORS、安全响应头与本地测试令牌只读边界。旧复盘和知识提取没有默认注入档案背景。没有新增环境变量、依赖或端口契约；个人分析新增现有模型路由任务 `profile_analysis`。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `ProfilePage.tsx`、`profile/ProfileEditors.tsx`、`personal-profile.css` | 真实读写、宽窄布局、来源选择、目标、背景、分析、资料输出和冲突体验 |
| `src/lib/personalProfile.ts`、测试 | 日期精度、界面校验、三方合并、简历互通与输出边界；测试样例不作为应用初始数据 |
| `src/lib/api.ts`、`src/router.tsx`、`src/App.tsx` | 集中契约、认证/错误复用、路由搜索参数和按需加载 |
| `server/src/profile.rs`、`server/src/db/profile.rs` | 领域规则、真实来源、事务、版本、许可与分析状态/快照 |
| `server/src/models.rs`、`main.rs`、`server.rs` | DTO、模型路由、模块注册与认证路由 |
| `server/src/db.rs`、`wallpaper_package.rs` | v28 迁移、v4 归档、ZIP 清单、显式替换及版本保护 |
| `ExportPanel.tsx`、`src/lib/fullPackage.ts` | 导入预览计数、替换确认与清单校验 |
| `AIRoutingPanel.tsx`、`AiTaskTray.tsx` | 个人分析模型路由词汇；统计范围没有伪造个人分析用量 |
| `ResponsiveSplit.tsx`、`WorkbenchSplit.tsx` | 复用已有分栏，并按服务器隔离本机比例 |
| `scripts/personal-profile-regression.mjs` | 真 HTTP / SQLite / 模拟 AI 与浏览器端到端验证 |
| `db/workspace.rs`、`persistence_tests.rs` | 更新真实旧 schema 夹具及 v4 格式断言，保留旧回归要求 |
| `AGENTS.md`、`CONTEXT.md`、README、本说明 | 正式入口、领域词汇、兼容性与操作说明 |

## 验证

```bash
npm test
npm run check:bundle
cargo fmt --manifest-path server/Cargo.toml --check
cargo test --manifest-path server/Cargo.toml --locked
cargo clippy --manifest-path server/Cargo.toml --all-targets --locked -- -D warnings
node --check scripts/personal-profile-regression.mjs
git diff --check
```

`check:bundle` 包含 TypeScript 与生产构建。专用脚本需要已有 playwright-core 和 Chrome，可用 KNOWLEDGE_PLAYWRIGHT_MODULE、KNOWLEDGE_CHROME_PATH 指定；先构建 server debug 可执行文件与 dist。脚本自己启动随机本机端口、全新 XDG 数据目录和 HTTP 模拟供应商，不连接用户服务器，不读取原库、不调用真实 AI；检查缺令牌/错误令牌、本地只读/CORS、保存/F5、冲突、来源、目标、背景许可、持久分析、旧归档保留、简历联系人许可、PDF 和短屏。输出目录通过 KNOWLEDGE_UI_OUTPUT 配置。

原有两个浏览器脚本仍使用内存 API，指定 KNOWLEDGE_FRONTEND_ORIGIN 为本机生产预览来源，验证原有页面和工作区。未测试实体手机输入法、真实 AI 服务商、实际生产部署或 Tauri 壳；相关外部效果不属于本次执行。默认完整 CI 中的两项手动基准继续 ignored，没有绕过回归。

## 首轮验收与独立本机实例

- 前端：32 个测试文件 / 141 项通过；生产构建与 bundle 预算通过，首屏 JavaScript gzip 179,012 / 180,000 字节。
- 服务端：cargo fmt 检查、146 项测试及 Clippy `-D warnings` 通过，2 项原有手动基准保持 ignored。
- 浏览器：真实 HTTP / SQLite / 模拟 AI 9 组通过；原生产 UI 62 项、工作区 16 项通过。原生产 UI 首次并发运行时的图片关闭焦点断言失败，未改动原断言，独立复跑全部通过。
- 专用真实联调只有一次本机模拟供应商调用，重复请求复用结果；无运行错误。截图与 PDF 使用合成资料，输出目录通过 `KNOWLEDGE_UI_OUTPUT` 指定，不纳入源码提交。
- 脚本语法、文档路径、旧 Demo 入口残留和 git diff 空白检查通过。未进行真实 AI 服务商、实体手机输入法或 Tauri 专项验证；没有部署现有生产服务。

## 升级后仍提示服务器不支持个人档案

只更新前端静态文件不会更新正在运行的服务端进程。如果健康检查正常，但已认证的 `GET /api/profile` 返回 404，应先确认前端连接地址与实际运行的服务端版本；401/403 属于认证问题，不能按缺失接口处理。

升级时遵循 README 的部署流程：先创建并校验业务数据库保护快照、保留旧程序及当前配置，再用 `cargo build --manifest-path server/Cargo.toml --release --locked` 构建并重启对应服务。保留现有工作目录、监听、令牌与服务配置。新版本启动时通过版本化迁移升级 SQLite，不手工修改数据库文件。

验收应覆盖健康检查、认证后的档案接口、数据库完整性与原有数据保持，以及桌面和手机的只读访问。测试资料和模拟 AI 只在隔离实例使用；不同实例使用不同数据库，不会自动同步资料。

已有本机升级验证确认：旧服务程序导致档案接口 404；更新并重启后接口返回 200，v25 数据通过迁移升至 v28，原有业务数据保持，页面警告消失。个人机器上的保护点、运行标识与测试产物路径不作为通用部署参数发布。

回退前先保存新版本的数据与完整迁移包，再按现有恢复保护与失败回滚流程使用升级前快照和旧程序；普通快照不包含壁纸，沿用恢复时保留目标端壁纸的约定。仅替换旧程序不能视为完整的数据回退。
