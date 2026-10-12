# 知识页重构：浏览、阅读与编辑分离

日期：2026-09-22。

## 调研与取舍

Linear 的 2024 年界面重构强调层级、平衡、信息密度和明暗主题对比度，而不是增加装饰：https://linear.app/changelog/2024-03-20-new-linear-ui 。
Notion 的数据库文档支持在同一数据集上切换视图，并通过 side peek 在阅读时保留左侧浏览上下文：https://www.notion.com/help/views-filters-and-sorts 。
Radix 的无障碍与 Dialog 文档强调语义、键盘操作、焦点管理和弹层退出：https://www.radix-ui.com/primitives/docs/overview/accessibility ，https://www.radix-ui.com/primitives/docs/components/dialog 。

本项目采用这些交互原则，不复制品牌外观，不引入图片依赖、虚构统计或另一套业务数据。原有语义主题变量与现有 Radix 组件继续复用。

## 信息架构

进入知识页先展示知识库，不再自动选择第一条或常驻编辑表单。左侧负责状态、空间和标签导航，中间负责搜索、筛选与浏览。选择条目后，桌面保留相邻列表并打开阅读区域，窄屏转为独立详情；桌面还可切换专注阅读。

卡片视图呈现标题、真实正文摘要、类型、状态、空间、标签与更新时间；列表视图提高浏览密度。沿用 `knowledge-density` 这个本地显示偏好，不在浏览器新增业务副本。

阅读、编辑和复习分别按需呈现。阅读视图保留 Markdown、代码、复制、来源和关联知识；编辑继续使用 CodeMirror、自动保存、冲突恢复和来源核验；复习继续使用原有复习题与间隔趋势。

来源仍然可选。关联来源不完整时，确认操作会切换到编辑并展开来源区域，而不是隐藏错误或绕过原校验。删除仍进入知识回收站，删除当前条目后返回列表，撤销时重新打开恢复的条目。

筛选集中在响应式抽屉中，并通过可移除的条件标签解释当前结果。只有选中条目时才出现批量工具。URL 继续承载搜索、空间、标签、状态、排序和页码；阅读条目不再强行改变状态筛选。

## 键盘与布局

`/` 聚焦搜索，`N` 新建，`Ctrl/Cmd+S` 保存，`Esc` 退出详情前先处理保存保护。输入框、输入法组合状态、弹窗、菜单与下拉列表不会意外触发浏览快捷键。真实链接保留在新标签页打开的行为。

抽屉关闭后恢复触发器焦点。触摸设备的选择与操作入口保持可见。主页面不再在每次切换条目时整页淡入，避免短暂发白；独立滚动区、深色主题和 reduced-motion 均有对应处理。


## 文件职责

- `src/components/KnowledgePage.tsx`：保留 API、草稿、来源校验、状态变更、导入和批量操作的编排，接入新的浏览与详情布局。
- `src/components/knowledge/KnowledgeLibrary.tsx`：空间导航、检索、显示方式、知识条目集合、选择与分页。
- `src/components/knowledge/KnowledgeReader.tsx`：正文阅读、复制 Markdown、来源和关联知识。
- `src/components/knowledge/knowledge.css`：局部作用域内的布局、排版、主题与响应式样式，不改其他页面的视觉规则。
- `src/lib/knowledgePresentation.ts` 与同名测试：安全的显示摘要、日期展示、键盘触发边界。
- `scripts/knowledge-ui-regression.mjs`：使用内存模拟 API 的浏览器回归，拒绝外部网络请求，不连接真实数据写入接口。

## 验证与复现

运行 `npm test`、`npm run build`、`npm run check:bundle`。浏览器检查需要先运行 `npm run dev -- --host 127.0.0.1`。

浏览器测试依赖只需装到临时目录，不必改变项目依赖：

```bash
npm install --prefix /tmp/knowledge-ui-tools playwright-core
KNOWLEDGE_PLAYWRIGHT_MODULE=/tmp/knowledge-ui-tools/node_modules/playwright-core/index.mjs \
  node scripts/knowledge-ui-regression.mjs
```

默认使用 `/usr/bin/google-chrome`；可通过 `KNOWLEDGE_CHROME_PATH` 指定其他 Chromium 可执行文件。输出默认在 `/tmp/daily-summary-knowledge-audit/`，可用 `KNOWLEDGE_UI_OUTPUT` 更改。

25 项浏览器检查覆盖首次浏览无写入、显示偏好、服务端分页、输入法与搜索、阅读与编辑分离、专注模式、自动保存及失败恢复、复习入口、筛选与焦点、批量操作、新建校验、删除撤销、来源核验、360/390/768/1024/1280/1600px 布局、深色模式、缺失深链接及接口失败恢复。截图全部使用模拟内容，不代表用户的真实知识库。

没有修改 API、数据库结构、后端鉴权或部署配置，也没有重启服务。构建会更新项目 `dist/`；当前服务的静态资源目录是 `../dist`，因此刷新原页面可加载新构建。没有执行真实数据写入联调、Safari/Firefox 或实体移动设备测试。

无需数据库迁移。回退时使用变更前的 Git 版本或本机保护副本，逐文件恢复相关前端入口与显示模块并重新构建；不得覆盖其他用户修改。新增显示模块不会改写已有知识内容。
