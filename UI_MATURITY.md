# 阅读工作台的成熟界面规范调研

调研日期：2026-10-12。范围：今日记录、知识条目、个人档案的桌面读写与移动阅读界面。资料限于 Linear、Apple、Radix、IBM Carbon 与 W3C 官方一手来源。本文记录界面依据、实际重构与验收；本轮只修改前端视觉、个人档案展示及回归脚本，沿用现有依赖和业务契约。

## 1. 稳定层级与动作位置

**来源事实**：Linear 2026 年更新让导航退后、正文成为焦点，减少多余图标及图标背景；统一页头中的常用操作位置，使跨页面操作更可预测。它也降低边界对比并减少分隔线。[Linear：A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh)

**项目建议（推导）**：全站固定“页名与上下文 → 页面动作 → 筛选/视图 → 内容”的顺序。正文标题是主要视觉锚点；数量、日期、来源与辅助说明使用次级文字。导航保持足够对比和明确选中状态，但不使用与正文争夺注意力的大色块。每个工作区只突出当前任务的主要动作，其余动作使用中性按钮或更多菜单。今日记录、知识条目、个人档案应共享这一结构。

## 2. 留白、密度与边界

**来源事实**：Carbon 的 spacing scale 包含 2、4、8、12、16、24、32 等像素值；接近的元素形成关系，较大间距形成分组和层级。密集信息区域可以存在，但整页应保留休息空间；分组可依靠空间，无须处处画线。[Carbon：Spacing](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview)

**项目建议（推导）**：优先复用现有 spacing，新增取值集中在 4/8/12/16/24/32。图标与标签用 8，字段内部用 8–12，列表行用 12–16，分组间用 24，页面外边距随窄屏/宽屏使用 16/24/32。把连续正文放在同一个阅读表面；只有独立任务、表单或状态区域才建立容器。内层通过标题、间距与浅分隔表示结构，避免连续的容器套容器。

## 3. 圆角与可控的视觉语法

**来源事实**：Linear 的更新对 tab 使用更紧凑的布局和圆角，对界面边界采用柔和处理；官方文章没有规定所有产品通用的圆角数值。[Linear：2026 design refresh](https://linear.app/now/behind-the-latest-design-refresh)

**项目建议（设计取值）**：普通控件取 6–8px，主要内容容器取 10–12px；胶囊只用于状态、标签或明确的一组切换控件。圆角由角色统一，不因某个页面临时增大。平面内容用细边界，弹层才使用更明显的阴影。以上像素值是本项目的建议，不是 Linear、Apple 或 Carbon 的强制标准。

## 4. 排版与连续阅读

**来源事实**：Apple 以组合字号、字重和行距的 text styles 建立清晰一致的层级；字号之外，字重也能表达细微层级。其官方设计提示要求按设备排布内容，主要内容无需水平滚动，并使关联文字、图片和按钮对齐。[Apple：The details of UI typography](https://developer.apple.com/videos/play/wwdc2020/10175/)、[Apple：UI Design Dos and Don’ts](https://developer.apple.com/design/tips/)

**项目建议（推导与设计取值）**：复用现有字体栈和 Markdown 阅读组件。页面标题、段落标题、正文、metadata 分别建立固定角色。建议正文 15–16px、中文长文行高 1.7–1.8；工具区 13–14px，避免把日期和来源全部缩成难读的小字。桌面正文可以设置合理最大宽度，列表仍按信息密度展开；具体宽度应结合中文正文和宽屏分栏验证。窄屏文本自然换行，代码和 Mermaid 保留各自的独立横向滚动。不要在全局 prose 样式中放大代码、图表与工具按钮。

## 5. 语义颜色与暗色

**来源事实**：Radix 区分应用背景、轻背景、组件 normal/hover/selected、非交互边界、交互边界、实色背景及主次文字；这套角色比逐组件选颜色更稳定。[Radix Colors：Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)

**来源事实**：Apple 明确暗色值不一定是浅色值的反转，建议使用随外观适配的语义颜色，验证两种外观下的可读性，并在暗色中通过 base/elevated 背景表达浮层深度。[Apple HIG：Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)

**项目建议（推导）**：复用 `src/index.css` 现有颜色角色，把 canvas、surface、muted、border、foreground、primary 的用途固定。浅色以中性底和清晰正文为主，暗色以不同深度灰面形成层次；强调色集中用于主动作、选中、焦点和有意义状态。标签、来源、计数默认中性，危险/成功颜色必须有对应文本。保留现有壁纸配置，开启壁纸后仍应验证阅读表面和透明层的实际对比。调整辅助文字的颜色时，不得用低 opacity 让文字不可读。

## 6. 分页、空状态与错误反馈

**来源事实**：Carbon 分页应靠近它分页的内容，显示当前范围、总量、页码与前后操作；窄屏可去掉选择器，但仍保留范围、总量与前后按钮。分页目的是改善可用性或性能，不应无意义地添加。[Carbon：Pagination guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/pagination/guidelines)

**项目建议（推导）**：知识条目与个人档案列表保持现有分页能力，以一条稳定页脚承载位置和导航；不要把分页封装成另一块强调卡片。窄屏确保按钮仍可触摸且标签可读。只做视觉统一时不改变分页请求、搜索参数或返回位置。

**来源事实**：Carbon 区分首次无数据、搜索无结果、任务完成和错误；建议短标题、必要说明和一个最重要的下一步。多个小区域同时为空时，可采用轻量文字及低层级动作，避免多个主按钮竞争。[Carbon：Empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states)

**项目建议（推导）**：首次为空可引导“新建知识条目”或“添加个人经历”；筛选无结果应引导调整条件；连接或请求失败则显示现有重试/设置动作。错误不可显示成“没有内容”。主区域空状态保持与正常内容一致的宽度和对齐，不需要大插画或巨大的空白装饰。个人分析与档案事实继续分别展示。

## 7. 触摸与键盘

**来源事实**：Apple 建议触摸控件至少 44×44 point；W3C WCAG 2.2 的目标尺寸最低条款是 24×24 CSS px，并列有间距、行内等例外。两者单位和适用场景不同，不宜当成同一个标准。[Apple：UI Design Dos and Don’ts](https://developer.apple.com/design/tips/)、[W3C：Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

**来源事实**：键盘功能应可用，接收键盘焦点的元素必须有可见且不会定时消失的焦点指示。[W3C：Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)、[W3C：Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)

**项目建议（推导与设计取值）**：移动端主要动作和分页采用约 44 CSS px 的可操作区域，图标本身可以更小。桌面保留紧凑控件，但焦点环不得因视觉简化而消失。继续使用原生 button/input 和现有 Radix 原语；菜单、对话框及移动操作面板保持 Escape、初始焦点和关闭后的入口焦点恢复。选中状态与键盘焦点是不同状态，不能只留 hover。移动阅读内容的下边界必须在底部导航与 AI 状态条之上。

## 8. 本轮落地与验证

以下是从资料推导的实施顺序，具体实现仍以仓库 source of truth 和 `AGENTS.md` 为准：

1. 先统一共享按钮、字段、页头、内容面和语义颜色，再收敛个人档案、知识条目、今日记录的局部覆盖。
2. 收敛边界、圆角、阴影和强调色；保留浏览、阅读、编辑和分页的功能入口。
3. 用桌面宽屏、桌面窄屏、手机长文和手机短屏表单检查层级；同时检查浅色、暗色、壁纸、空状态、错误、焦点与滚动。
4. 按仓库矩阵执行 `npm test`、`npm run build`，以及现有隔离生产浏览器回归；涉及个人档案行为还须执行其独立 SQLite / HTTP / 模拟 AI 回归，不能使用真实个人数据库。

研究阶段只读取官方一手资料。研究文档原先位于被仓库忽略的 docs/，本轮移至根目录作为正式变更说明；没有修改忽略规则。Apple 部分 HIG 页面仅返回 JavaScript 外壳，排版与布局使用可读取的 Apple 官方 WWDC transcript 和 Design Tips。

## 9. 实际重构

共享颜色角色改为中性的明暗配色：浅色画布 #f7f8fa / 白色内容面，暗色画布 #111318 / 内容面 #191c22。浏览器 theme-color 同步这两种画布值；对应单测仅更新配色契约，原主题模式断言保留。主文字和辅助文字分别保持独立角色，强调色和壁纸配置仍由原系统控制。

面板圆角统一为 12px，字段与普通按钮为 8px，桌面按钮保持紧凑、手机主要操作保留 44px 触摸区域，表单文字采用 16px。削弱重复阴影；页头图标取消独立大色块背景；桌面工作区外边距采用 32/36px。正文继续使用已有 Markdown 阅读排版，代码、Mermaid、图像与分栏流程保留。

个人档案将主要动作与标题集中在一行，保存状态降为辅助信息；视图切换使用下划线导航。新档案显示“介绍现在的你 / 积累经历与成果 / 明确下一步方向”三个可执行入口，替代多个空汇总卡片。已有资料使用统一面板、24px 区块间距和更清晰的文字层次。手机经历与分析详情直接进入阅读内容，并可返回原列表；平板背景及分析视图改为单栏，减少窄列。

分析为空时只显示一个起步区域和“选择背景，开始分析”动作，不显示第 1 页 / 0 条分页或第二个空阅读面板。单页分析隐藏分页；多页保留前后按钮与当前页，列表标题显示总量。请求失败仍显示错误与重试，不伪装为空资料。

### 文件职责

| 文件 | 本轮目的 |
| --- | --- |
| `src/index.css` | 中性明暗角色、面板圆角 |
| `src/lib/theme.ts`、`theme.test.ts` | 浏览器表面颜色与角色契约同步 |
| `src/components/workspace/reading-workbench.css`、`mobile-workbench.css` | 共享控件、标题、留白、空状态和手机触摸尺寸；移动局部规则同步消费圆角/阴影角色 |
| `src/components/ui/Feedback.tsx` | 空状态取消重复外层面板 |
| `src/components/ProfilePage.tsx`、`personal-profile.css` | 页头、起步引导、概览、经历阅读、分析列表/空状态/分页 |
| `scripts/personal-profile-regression.mjs` | 六宽度、明暗、空状态与实际多页导航验收 |
| `scripts/production-ui-regression.mjs` | 等待图片查看器异步焦点恢复，保留焦点与滚动断言 |
| `public/sw.js` | PWA 静态缓存升级至 v14，让已安装客户端获取新资源 |
| `AGENTS.md`、本说明 | 索引、依据、验收与回退 |

### 边界与回退

本轮没有修改服务端 API、数据库 schema、运行配置、部署脚本、鉴权、Tauri 或依赖锁文件；客户端静态资源缓存版本从 v13 更新为 v14。测试使用隔离数据库或全量内存 API；没有真实业务数据写入、真实 AI 请求、数据库恢复或服务端重启。新 dist 由现有 8080 服务直接提供，浏览器刷新后加载当前生产资源。

回退只需恢复本轮前端源码与重新构建 dist；不需要迁移业务数据库。当前工作区已有个人档案的前后端变更，本轮是在这些变更上继续优化，不能通过整仓库 reset 或恢复旧 API 来回退 UI。

### 验证结果

- `npm test`：32 个测试文件 / 141 项通过。
- `npm run check:bundle`：TypeScript、生产构建和首屏预算检查通过；首屏 JavaScript gzip 179,010 / 180,000 字节。已有 Markdown/Mermaid 大 chunk 提示仍存在，没有放宽预算或关闭压缩。
- 全站隔离生产回归：62 项通过，涵盖统计图表、导航、今日/记录/知识/复习/搜索/设置、移动阅读、图片、分栏、焦点和失败恢复；业务写入为 0。
- 工作区隔离回归：16 项通过，涵盖六宽度明暗、文字角色对比度至少 4.5、壁纸、短屏、模拟软键盘、任务状态条、滚动返回与候选草稿。
- 个人档案隔离回归：11 组通过，涵盖真实临时 SQLite、HTTP、一次模拟 AI 调用、资料保存/刷新/冲突、来源/目标/许可/简历、六宽度明暗、空态/错误重试、单页/多页分析与手机阅读返回。空态检查拦截业务写入并断言 0；主题检查直接断言 DOM 外观，不只依据存储值命名截图。
- 两个修改的脚本及 `public/sw.js` 语法检查、`git diff --check` 通过。
- 8080 只读检查：`/profile` 与 `/sw.js` 返回 200，响应内容与当前 dist 一致；未携带令牌的档案接口仍返回 401。

短屏补充断言发现初始视口的主按钮底部被裁切约 6px，原因是空态嵌套了两层垂直内边距和固定最小高度。手机空态改为自然高度，并使用外层留白；保留按钮完整可见、当前标签未裁切的断言后通过。

初次全站回归在图片关闭焦点断言失败：测试在查看器隐藏后立即读取焦点，早于 Radix 异步关闭回调。调试同时发现页面中有两个同名图片按钮，因此等待条件直接使用原入口元素；没有放宽最终焦点或原阅读位置断言，修正后专用检查和完整 62 项通过。档案主题矩阵的测试初始化曾每次导航写入浅色，已改为首次初始化，并增加实际 DOM 主题断言；最终明暗截图对应真实外观。

截图和原始报告通过 `KNOWLEDGE_UI_OUTPUT` 指定输出目录，分别保存 profile、production、workspace 与 image-focus 的产物。内容全部为合成资料，产物留在本地。

未运行服务端 Rust、Tauri 与部署脚本专项检查，因为本轮未修改这些实现；未测试实体手机输入法或真实 AI 服务商。PWA 完整离线升级生命周期未单独进行设备验收，本轮检查缓存脚本语法及 8080 正在提供 v14 脚本。

### 本机复现

以下浏览器检查依次执行，页面预览使用 `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`。如果 4173 已运行当前 dist 的预览，可直接复用。需要 Chrome 与 playwright-core；以下将浏览器测试工具安装到临时目录，不改变产品依赖。

```bash
npm install --prefix /tmp/knowledge-ui-tools playwright-core
export KNOWLEDGE_PLAYWRIGHT_MODULE=/tmp/knowledge-ui-tools/node_modules/playwright-core/index.mjs
export KNOWLEDGE_FRONTEND_ORIGIN=http://127.0.0.1:4173
node scripts/production-ui-regression.mjs
node scripts/workspace-optimization-regression.mjs
node scripts/personal-profile-regression.mjs
```

个人档案脚本自行启动已有 `server/target/debug/daily-summary`，另建全新临时数据目录和随机端口；它不使用上面的预览服务或真实 8080 数据库。
