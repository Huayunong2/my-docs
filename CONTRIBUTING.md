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
cargo check --manifest-path src-tauri/Cargo.toml --locked
bash -n setup.sh ops.sh
bash scripts/test-setup-mode-guards.sh
```

涉及数据库迁移、备份恢复、部署脚本或 API 契约的修改，应补充测试，并在 Pull Request 中说明兼容性和回滚方式。

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
