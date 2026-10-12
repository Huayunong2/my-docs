# 贡献指南

感谢你愿意为 `daily-summary` 提交改进。这个项目是一个单用户、自托管的个人知识工作流，贡献应尽量保持数据可控、部署简单，并避免引入不必要的账号系统或云端依赖。

## 开始之前

- 先搜索已有 Issue，避免重复提交。
- 对行为变化较大的功能，先开一个 Issue 描述问题、使用场景和方案。
- 安全漏洞不要公开创建 Issue，请阅读 [SECURITY.md](SECURITY.md)。
- 提交内容需要遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 本地开发

环境要求：Node.js 20+、Rust stable、Cargo 和 npm。

```bash
npm ci
```

启动 API：

```bash
npm run server:dev
```

另开终端启动前端：

```bash
npm run dev
```

然后访问 `http://localhost:5173`。开发脚本只绑定本机并允许无令牌访问，不要把它当作生产启动方式。

## 提交前检查

根据改动范围运行相关检查；完整 CI 检查包括：

```bash
npm audit --omit=dev --audit-level=moderate
npm test
npm run check:bundle
npm run build
cargo fmt --manifest-path server/Cargo.toml --check
cargo test --manifest-path server/Cargo.toml --locked
cargo clippy --manifest-path server/Cargo.toml --all-targets --locked -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml --locked
bash -n setup.sh ops.sh
bash scripts/test-setup-mode-guards.sh
```

涉及数据库迁移、备份恢复、部署脚本或 API 契约的修改，应补充测试，并在 Pull Request 中说明兼容性和回滚方式。

不要为了让检查通过而删除、弱化或绕过回归断言。修改测试期望值或 snapshot 时，需要在 Pull Request 中说明对应的行为变化和依据；安全相关修改还应覆盖未授权请求、错误 token、CORS、路径校验、恢复回滚和敏感信息不泄露场景。

## Pull Request

请让每个 PR 聚焦一个问题，并在描述中包含：

- 背景和要解决的问题；
- 主要实现方式；
- 测试命令和结果；
- 是否涉及数据库迁移、配置迁移、破坏性变更或安全边界变化；
- UI 改动前后的截图或录屏（如果适用）。

不要提交：

- `node_modules/`、`dist/`、Rust `target/` 等构建产物；
- `server/.env`、备份包、数据库文件、token 或 AI Key；
- 个人数据、内部调研材料和 Agent 工作区元数据。

## 上传到 GitHub 的文件边界

保留 `src/`、`server/src/`、`src-tauri/src/`、`public/`、`src/assets/`、`scripts/`、`.github/`，以及构建配置、部署脚本、许可证、公开说明和测试。这些文件负责运行、复现构建、维护与回归，不应因为文件较多而删除。提交 `package-lock.json`、`server/Cargo.lock` 和 `src-tauri/Cargo.lock`，以保持依赖安装可复现。

个人档案说明、UI/UX 规范和实施记录属于公开维护文档。`docs/` 中内部调研默认忽略；被项目索引与回归脚本引用的 `docs/knowledge-ui-redesign.md` 单独放行。新增公开文档时同步检查 `.gitignore` 和引用路径，避免克隆后出现缺失链接。

构建产物、依赖、个人配置与数据留在本地。正在提供服务的 `dist/` 和 `server/target/` 即使被忽略，也不要在服务运行时随意删除。`server/.env.example` 与 `server/backup.env.example` 是可提交的配置模板；真实 `.env`、SQLite 文件及其 WAL/SHM 文件、密钥、备份包不可提交。个人数据导出的 JSON/ZIP 也不可提交，不能依靠扩展名判断它们是否安全。

浏览器截图、报告、视频和日志写入 `/tmp/`，或仓库内被忽略的 `ui-artifacts/`、`test-results/`、`playwright-report/`；使用 `KNOWLEDGE_UI_OUTPUT` 配置浏览器回归的输出目录。不要将所有 PNG、JSON 或 ZIP 全局忽略，产品图片、配置和测试夹具可能使用这些格式。

准备提交前检查：

```bash
git status --short
git diff --check
git diff --cached --stat
git ls-files -ci --exclude-standard
```

最后一个命令列出已被 Git 跟踪、但命中新忽略规则的文件；理想情况下应为空。`.gitignore` 只影响未跟踪文件，不会删除已跟踪文件或清除 Git 历史。已跟踪的本地文件需要核实后单独移出索引；若真实凭据曾被提交，还需要作废凭据并处理历史，单改忽略规则无效。

## Commit 建议

推荐使用简短的 Conventional Commits 前缀，例如：

```text
feat: add knowledge card export
fix: preserve review state during import
docs: clarify self-hosted deployment
chore: update dependencies
```

## 设计边界

除非有明确的设计讨论，优先保持：

- 服务端作为唯一数据源；
- SQLite 文件可备份、可迁移、可恢复；
- AI 作为可关闭的辅助能力，不覆盖原始记录；
- 公网部署默认令牌保护，敏感配置只在服务端保存。
