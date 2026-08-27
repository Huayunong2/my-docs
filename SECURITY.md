# 安全策略

## 支持范围

安全修复以 `master` 分支的最新代码为准。由于项目支持自托管，实际风险还取决于反向代理、服务器防火墙、备份仓库和环境变量的配置。

## 报告漏洞

请不要在公开 Issue、Pull Request 或讨论区发布尚未修复的漏洞、利用代码、访问令牌、AI Key 或真实个人数据。

优先通过 GitHub 的私有安全报告提交：

<https://github.com/Huayunong2/my-docs/security/advisories/new>

报告中请尽量包含：

- 受影响的 commit、版本或依赖版本；
- 可复现步骤或最小化示例；
- 影响范围和可能的利用条件；
- 临时缓解措施（如果已知）。

如果私有安全报告入口不可用，请先通过仓库维护者的 GitHub 个人主页联系，并避免公开敏感细节：<https://github.com/Huayunong2>。

## 部署安全边界

- 生产环境必须配置 `DAILY_SUMMARY_TOKEN`，不要启用 `DAILY_SUMMARY_ALLOW_NO_TOKEN=1`。
- 长期公网使用应采用域名 + HTTPS；公网 IP + HTTP 不提供传输加密。
- `server/.env`、`server/.env.backup`、迁移包和 Restic 密码文件都可能包含敏感信息，必须保存在 Git 忽略范围之外并限制文件权限。
- AI 功能会把相关内容发送给配置的 AI 服务商；启用前应评估数据处理政策和记录敏感性。
- Restic 密码丢失会导致异地备份无法恢复，密码需要通过独立安全渠道保存。

## 依赖安全

前端依赖通过 npm audit 检查，Rust 依赖通过 RustSec audit-check 检查；GitHub Actions 中还会定期运行 CI 和依赖安全检查。发现新的依赖漏洞时，请优先升级锁文件并补充回归验证。
