# UI/UX 规范落地记录（2026-10-12）

## 边界与依据

本轮落实用户的“保留呼吸感、禁止浏览器默认控件、使用本地组件库、兼顾 PC 和手机、形成新模块规范”要求。规范入口为 [UI_UX_GUIDELINES.md](UI_UX_GUIDELINES.md)，AGENTS 已将其加入新增 / 修改模块的必读流程。此前 UI 调研与审查数据继续保留在 [UI_MATURITY.md](UI_MATURITY.md) 及 ui-audit 工件中。

只修改前端组件、样式、构建门槛、回归与文档。现有个人档案 API、SQLite v28、鉴权、服务器监听、配置、部署脚本和数据格式均未修改；没有新增运行时依赖，依赖锁文件不变。

## 控件

- 浏览器原生下拉统一替换为已有 Radix Select；SelectField 复用该组件并保持空值及业务字符串原义，不向 API 传递内部展示值。
- Input、Textarea、Field 统一位于 reading-surface.tsx；设置旧适配器继续委托共享组件。默认数字微调按钮和搜索取消图标被统一样式接管。
- 补齐本地 Checkbox / Radio。内部语义 input 保留键盘、label、name、disabled、checked 和 indeterminate；可见框、标记与焦点均由共享样式绘制。
- 原生日期字段替换为现有日期 Popover，并补齐空值、清除、禁用、错误描述和窄屏七列适配。Popover / Select 在现有 Dialog / Sheet 之上，按可用视口限制高度。
- 业务页面只有隐藏系统文件入口保留原生 input。表单使用 noValidate 和应用内错误，保留原有校验；档案必填与邮箱格式错误显示在现有 InlineError 中。
- check-ui-contract.mjs 扫描业务 JSX，拒绝裸 select / option / textarea、可见 input、原生日期类型和未关闭默认校验的 form。仅豁免明确的共享 ui 目录及隐藏 file 入口。check:bundle 已先执行 check:ui，现有 CI 无需新增重复步骤。

## 布局

手机浏览通过层级和按需展开腾出内容空间，不缩小文字或卡片内边距。按钮通常 44px，字段 / 控件间保留 12–16px，独立区块 24–32px。

- 记录：取消主区域第二次预留的导航内边距，手机改为一个主滚动区；卡片保留正文与留白，关闭详情恢复入口焦点且不滚动原列表。
- 知识：手机移除重复范围 / 数量标题，以搜索、状态选择和“视图”入口组织工具；排序和展示方式使用现有 ReadingActions。零条或单页不显示禁用分页；批量操作仍有显式入口。
- 周期回顾：手机保留搜索和一行类型 / 状态选择，隐藏重复侧栏、标题和生成时间摘要；保留月份、版本、确认状态及阅读入口。
- 统计：关键数字先行；PC 用数字面板与月度概览并排，手机先数字后图表。主区“月份”和图表区“回顾”明确区分职责；手机视图用库选择器保留全部四个入口。
- 设置：手机分类使用库选择器，避免横向分类文字被部分截断；五个分类、未保存确认和原 URL 入口保持。PC 原侧栏分类保留。
- 档案：所有选择字段与许可控件使用共享库；空经历列表不再在宽屏重复展示两个空区域。

## 文件职责

| 文件 / 范围 | 本轮目的 |
| --- | --- |
| ui/reading-surface.tsx、ui/checkbox.tsx、ui/select.tsx | 文本、复选 / 单选、共享选择字段及样式接口 |
| ui/date-picker.tsx、ui/popover.tsx | 日期空值 / 清除 / 错误描述、弹层与七列边界 |
| reading-workbench.css、src/index.css、personal-profile.css | 控件留白、共用样式、一次性导航空间与页面重排 |
| KnowledgeLibrary.tsx、HistoryPage.tsx、ReviewsPage.tsx、StatsPage.tsx、SettingsPage.tsx | 浏览、筛选、滚动、概览与分类响应式 |
| ProfilePage.tsx、profile/ProfileEditors.tsx | 档案库控件、许可、校验与空列表 |
| CandidateOrganizer.tsx、ReusePanel.tsx、RelatedKnowledgeField.tsx | 类型、来源日期、项目、文本与合并字段 |
| KnowledgePage.tsx、KnowledgeImportDialog.tsx、KnowledgeTrashPage.tsx、TodayAIPanel.tsx | 来源日期、导入、回收站和候选选择的库控件 |
| TodayPage.tsx、SearchPage.tsx、ReviewPage.tsx、ReviewItemsPanel.tsx、reviews/ReviewShared.tsx、SpaceManagerDialog.tsx、MarkdownContent.tsx | 文本 / 多行字段接入共享组件，原事件和草稿编排保留 |
| settings/shared.tsx、ConnectionPanel.tsx、AIPanel.tsx、AppearancePanel.tsx、ExportPanel.tsx、WallpaperManagerPanel.tsx、ReviewSettingsPanel.tsx | 字段、开关、确认、方案选择和表单校验模式 |
| ReadingActions.tsx、WorkspaceHeader.tsx | 可见动作名称，保留稳定入口与面板关闭顺序 |
| scripts/check-ui-contract.mjs、package.json | UI 控件自动门槛，与既有 bundle / CI 流程集成 |
| 三个浏览器回归脚本 | 库控件选择、混合状态、键盘、几何与原流程验证 |
| public/sw.js | PWA 静态缓存版本 v15 |
| AGENTS.md、两份 UI_UX 文档 | 新模块规范、索引、验收与兼容记录 |

文件路径均相对仓库，ui/ 和工作台样式位于 src/components/ 下。既有未提交的个人档案前后端改动保留，本轮未重置或覆盖其他修改。

## 验证

- `npm test`：32 个文件 / 141 项通过。
- `npm run check:ui`：共享控件契约通过；`npm run check:bundle`：类型、生产构建与预算通过，首屏 gzip 179,646 / 180,000 字节。既有大 chunk 提示保留，没有放宽预算。
- `scripts/production-ui-regression.mjs`：62 项通过，包含原导航 / 阅读 / 分栏 / 恢复、设置分类库选择器，以及混合复选状态和 Space 全选 / 清除；业务写入 0。
- 同脚本 `KNOWLEDGE_UI_GUIDELINES_ONLY=1`：27 项通过，包含六宽度的首屏内容 / 选择器边界 / 图表与图例边界、手机单一滚动与返回位置、选择器键盘及面板内浮层、空库完整起步按钮与无禁用分页。
- `scripts/workspace-optimization-regression.mjs`：16 项通过，覆盖六宽度明暗、文字对比度、壁纸、AI 任务 / 候选 / 复用、手机软键盘与阅读返回。
- `scripts/personal-profile-regression.mjs`：11 组通过，使用独立 SQLite、HTTP 与一次模拟 AI 调用；原许可、保存、刷新、冲突、来源 / 目标、简历 / PDF 和短屏保留，新增 radio 方向键、checkbox Space、库下拉和本地中文必填 / 邮箱错误反馈。无真实 AI 调用或真实数据库写入。
- 修改的脚本与 `public/sw.js` 语法检查、`git diff --check` 和规范路径检查通过。

回归适配记录：原生 select 的 selectOption 改为库 combobox / option 操作，业务输出断言保留；手机设置的横向 tab 改为同等分类选择器，增加五个分类、当前选择与焦点断言。新几何场景用实际可见的详情窗避免隐藏 PC 详情 DOM 的重复定位；下拉的打开 / 关闭焦点等待 Radix 生命周期，最终键盘目标、滚动位置与焦点断言未放宽。

规范中列出的纯文档检查及实际页面边界已覆盖。未运行 Rust、Tauri 和部署专项命令，因为本轮没有修改相关实现；未进行实体手机输入法或完整 PWA 离线升级设备验收。

截图与原报告通过 `KNOWLEDGE_UI_OUTPUT` 指定本地输出目录，分为 production、workspace、profile、geometry。所有内容为合成资料，产物不纳入源码提交。

复现时先构建 dist 和已有 server debug 程序；预览可使用 `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`，如果已有 4173 预览正在提供当前 dist，可复用。设置 KNOWLEDGE_PLAYWRIGHT_MODULE 为已有 playwright-core 模块，KNOWLEDGE_FRONTEND_ORIGIN 为本机预览来源，依次运行上述三个脚本。档案脚本自行启动随机端口和新临时数据目录，不使用真实 8080 数据库。

## 兼容与回退

没有业务 API 或数据迁移。回退本轮仅恢复相关前端组件 / 样式并重新构建 dist，不应回退此前个人档案服务端或恢复业务数据库。静态缓存版本需与实际资源同步处理，避免已安装客户端保留过期入口。UI 契约门槛属于构建流程变化，依赖保持原锁文件。

真实 AI、实体手机输入法、Tauri Rust 与部署专项不属于本轮执行；浏览器检查使用独立 SQLite / 模拟 AI 或完全拦截的内存 API。测试截图不使用真实个人资料。
