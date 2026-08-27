# daily-summary

一个面向个人的、自托管的工作记录、知识沉淀与间隔复习工具。

它把「记录每天发生了什么」延伸为一条可持续的知识闭环：

```text
每日记录 → AI/手工提炼 → 知识卡片 → FSRS 间隔复习 → 复用追踪 → 备份与迁移
```

项目采用服务端集中存储，浏览器、手机和桌面端共享同一份 SQLite 数据。它适合希望拥有数据控制权、又不想维护复杂账号系统和同步基础设施的个人用户。

[![CI](https://github.com/Huayunong2/my-docs/actions/workflows/ci.yml/badge.svg)](https://github.com/Huayunong2/my-docs/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/deployment-self--hosted-2f855a.svg)](#部署)

## 项目定位

- 单用户优先：不内置多用户、组织、权限和社交协作系统。
- 数据自持有：正文、知识卡片、复习状态和复盘文档都存放在自建服务端。
- 客户端轻量：Web、移动浏览器和 Tauri 桌面端都通过同一套 HTTP API 工作。
- AI 可选：AI 只作为服务端辅助能力，不覆盖原始记录；没有 AI Key 也可以使用核心功能。
- 可恢复运维：提供 SQLite 快照、迁移包、Restic 加密异地备份和健康监控。

## 功能概览

### 记录与复盘

- Markdown 日记录：编辑、预览、自动保存、标签和心情。
- 历史记录、归档、全文搜索、统计和月历视图。
- 未写原因：请假、放假、生病、出差、休息和其他，不打断连续记录统计。
- AI 日总结、周复盘和月复盘，生成独立草稿，不覆盖每日原文。
- 复盘库支持按周期和版本管理草稿、已确认内容和历史版本。

### 知识库与复习

- 将事实、概念、方法、决策和案例沉淀为独立知识卡片。
- 支持来源追踪、标签、项目分组、全文搜索、批量操作、已保存视图和回收站恢复。
- 基于 FSRS 的间隔重复复习，支持「忘记 / 困难 / 记得 / 轻松」四档评分。
- 支持键盘操作、复习历史、间隔趋势和复用次数/最近使用时间追踪。

### 自托管与运维

- Rust + Axum API 服务和 SQLite 单文件数据存储。
- Debian/Ubuntu + systemd 一键部署，支持公网 IP 或域名 + Caddy HTTPS。
- 本地快照、迁移包、定期备份、恢复前保护点和 SQLite 完整性检查。
- Restic 加密异地备份，支持 S3-compatible、SFTP、Backblaze B2 等仓库。
- `/health` 存活检查和受令牌保护的 `/api/health` 运维检查。
- Tauri 桌面端可选，不维护第二份本地数据库。

## 架构

```text
┌─────────────────────┐
│ Web / 手机浏览器     │
├─────────────────────┤       HTTP(S)
│ Tauri 桌面端         │ ─────────────────┐
└─────────────────────┘                  │
                                         ▼
                                  ┌──────────────┐
                                  │ Rust / Axum  │
                                  │ API + 鉴权    │
                                  └──────┬───────┘
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │ SQLite       │
                                  │ 单一数据源    │
                                  └──────────────┘
```

客户端不直接访问 SQLite。服务端是唯一的数据边界，也负责鉴权、AI 请求代理、备份、导出和复习调度。

## 部署

### 运行要求

生产部署脚本面向 Debian/Ubuntu Linux，默认使用 systemd。首次部署需要具备 sudo 权限和可用的网络连接；域名 HTTPS 模式还需要将 DNS 指向服务器。

### 域名 + HTTPS（推荐）

```bash
git clone https://github.com/Huayunong2/my-docs.git daily-summary
cd daily-summary
chmod +x setup.sh ops.sh
./setup.sh --bootstrap your.example.com
```

脚本会构建前端和 Rust 服务端，配置 systemd，并在域名模式下配置 Caddy HTTPS。部署完成后访问：

```text
https://your.example.com
```

设置页中的 API 地址填写：

```text
https://your.example.com/api
```

### 公网 IP

没有域名时可以直接使用公网 IPv4：

```bash
./setup.sh --bootstrap 203.0.113.10
```

访问：

```text
http://203.0.113.10:8080
```

这种模式使用 HTTP，正文、访问令牌和其他请求内容不会加密传输，只适合受控网络或临时使用。正式长期使用请配置域名和 HTTPS。

### 增量升级

已部署项目更新代码后执行：

```bash
./setup.sh --cur
```

常用选项：

| 选项 | 用途 |
| --- | --- |
| `--bootstrap` | 首次部署或修复依赖、systemd、防火墙、Caddy |
| `--cur` | 复用已有域名，或探测当前公网 IPv4 |
| `--force-deps` | 强制检查依赖并执行依赖安装流程 |
| `--force-systemd` | 强制重写 systemd 配置 |
| `--no-backup` | 跳过升级前 SQLite 快照；谨慎使用 |

如果项目目录不是脚本所在目录，可以指定：

```bash
APP_DIR=/srv/daily-summary ./setup.sh --cur
```

部署脚本会在切换前构建 staging 版本，升级前生成数据库快照；启动失败时尝试恢复上一版前端、服务端和运行配置。

## 配置

生产配置由 `setup.sh` 管理，也可以参考 [server/.env.example](server/.env.example) 手动创建 `server/.env`。真实配置文件不会被 Git 追踪。

常用变量：

| 变量 | 说明 |
| --- | --- |
| `DAILY_SUMMARY_TOKEN` | API 访问令牌；生产环境必填 |
| `DAILY_SUMMARY_BIND` | 监听地址，例如 `127.0.0.1:8080` 或 `0.0.0.0:8080` |
| `DAILY_SUMMARY_ALLOWED_ORIGINS` | CORS 白名单，应填写实际 Web 来源 |
| `DAILY_SUMMARY_ALLOW_NO_TOKEN` | 仅本地开发使用；生产环境不要开启 |
| `DAILY_SUMMARY_AI_API_KEY` | 服务端 AI Key，可留空以关闭 AI |
| `DAILY_SUMMARY_AI_BASE_URL` | OpenAI-compatible API 地址 |
| `DAILY_SUMMARY_AI_MODEL` | AI 模型名 |
| `VITE_API_BASE_URL` | 构建桌面端时写入的默认 API 地址 |

AI Key 只应存放在服务端。备份相关变量见 [server/backup.env.example](server/backup.env.example)，其中的 Restic 密码文件和对象存储凭据必须通过独立安全渠道保存。

## 本地开发

### 安装依赖

```bash
npm ci
```

本地开发需要 Node.js 20+、Rust stable、Cargo 和一个可用的 SQLite 构建环境。前端和服务端可以分别启动：

终端一：

```bash
npm run server:dev
```

终端二：

```bash
npm run dev
```

打开 `http://localhost:5173`。`server:dev` 默认只绑定本机并允许无令牌访问，不能用于生产环境。

### Tauri 桌面端

```bash
npm run desktop:dev
```

构建桌面端时可以注入默认 API 地址：

```bash
VITE_API_BASE_URL=https://your.example.com/api npm run desktop:build
```

桌面端仍然使用服务端数据，不会自动创建第二套本地数据库。

## 备份、迁移与恢复

### 本地快照

```bash
./ops.sh local-backup
./ops.sh maintain-backups
```

### 迁移到新服务器

```bash
./ops.sh backup-bundle
```

迁移包包含 SQLite 数据库，以及存在时的 `server/.env`。它可能包含访问令牌和 AI Key，文件权限虽然会限制为 `0600`，但不会额外加密，只能通过可信通道传输。

新服务器完成首次部署后恢复：

```bash
./ops.sh restore /path/to/daily-summary-migration-<timestamp>.tar.gz
```

恢复流程会校验压缩包条目、大小限制、SHA-256 和 SQLite `integrity_check`，并在切换前保留 `pre-restore` 保护点。

### Restic 异地备份

```bash
cp server/backup.env.example server/.env.backup
mkdir -p ~/.config/daily-summary
openssl rand -base64 48 > ~/.config/daily-summary/restic-password
chmod 600 server/.env.backup ~/.config/daily-summary/restic-password
```

编辑 `server/.env.backup` 后执行：

```bash
./ops.sh init-offsite
./ops.sh offsite-backup
./ops.sh verify-offsite
```

丢失 Restic 密码后无法解密远端备份，因此密码文件必须另存一份。

## 运维与排错

```bash
systemctl status daily-summary
journalctl -u daily-summary -f
systemctl list-timers 'daily-summary-*'
```

服务健康检查：

```bash
curl http://127.0.0.1:8080/health
curl -H "Authorization: Bearer <token>" \
  http://127.0.0.1:8080/api/health
```

公开 `/health` 只返回存活状态、版本和构建标识；数据库、备份、磁盘和 AI 状态在受访问令牌保护的 `/api/health` 中返回。

## 测试与质量检查

本地运行与 CI 一致的主要检查：

```bash
npm ci
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

提交 Pull Request 前至少应运行受影响部分的测试，并在描述中说明部署、数据迁移或配置行为是否发生变化。

## 项目结构

```text
src/                  React + TypeScript Web 客户端
server/               Rust Axum API、SQLite 持久化和 AI/备份能力
src-tauri/             Tauri 桌面端壳
public/                PWA 和静态资源
scripts/               CI 与部署脚本测试
setup.sh               生产部署和升级
ops.sh                 备份、恢复、迁移和监控
.github/workflows/     CI 与安全检查
```

## 贡献

欢迎修复问题、改进文档和提交功能建议。开始前请阅读：

- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [行为准则](CODE_OF_CONDUCT.md)

Bug 和功能请求请使用 GitHub Issue 模板。安全漏洞不要公开创建 Issue，请按 [安全策略](SECURITY.md) 私下报告。

## 安全边界

这是一个单用户自托管项目，不是经过合规认证的团队协作或高敏感数据平台。部署时请注意：

- 不要在公网长期使用 HTTP IP 模式；优先使用域名 + HTTPS。
- 生产环境不要设置 `DAILY_SUMMARY_ALLOW_NO_TOKEN=1`。
- 不要把 `server/.env`、`server/.env.backup`、迁移包或 Restic 密码文件提交到 Git。
- 备份通常包含完整个人记录，异地备份应使用加密仓库并单独保护密码。
- AI 请求会将相关记录发送到你配置的 AI 服务商；请根据服务商政策和数据敏感性决定是否启用。

详见 [SECURITY.md](SECURITY.md)。

## 许可证

本项目以 [MIT License](LICENSE) 发布。
