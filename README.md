# daily-summary

个人工作、学习复盘工具。数据统一保存在服务器 SQLite 中，手机浏览器、网页端和桌面端访问同一份数据。

## 适合什么场景

- 每天只写一份工作/学习复盘。
- 手机和电脑都要能查看、补写、搜索。
- 不想维护复杂数据库和用户系统。
- 希望 AI 只作为总结/周月复盘辅助，而不是替你自动覆盖原文。

不适合：

- 多用户团队协作。
- 离线优先同步。
- 对安全合规有强要求的敏感记录。公网 IP + HTTP 模式没有传输加密。

## 功能

- 今日记录：Markdown 编辑、预览、自动保存、标签、心情。
- 历史、归档、全文搜索、统计月历。
- Markdown 预览支持代码块、表格、Mermaid。
- 未写原因：请假、放假、生病、出差、休息、其他；不会打断连续覆盖。
- 本周统计：记录天数、豁免天数、空缺天、最长记录、高频词。
- AI 日总结：服务端代理，浏览器不保存 AI Key，输出简洁纯文本。
- AI 周/月复盘：独立保存为复盘库草稿，不占用每日记录。
- 复盘库：按年月、周期、版本管理周/月复盘，可确认、编辑、删除。
- SQLite 快照备份、下载、删除。
- Markdown/JSON 导出，支持 Markdown ZIP 下载。
- 手机端底部导航和设置页适配。

## 架构

```text
手机浏览器 ──HTTP/HTTPS──┐
桌面端(Tauri) ───────────┼── Rust axum ── SQLite
网页端 ──────────────────┘
```

桌面端不维护本地数据库。所有客户端都走服务器 API，避免双轨数据和同步冲突。

## 一键部署

支持 Debian/Ubuntu VPS。脚本默认走增量部署：构建前端、构建服务端、重启服务；只有首次安装、环境缺失或显式传参时才安装依赖、写 systemd、配置防火墙/Caddy。

### 1. 获取项目

```bash
git clone <你的仓库地址> daily-summary
cd daily-summary
```

如果你是上传压缩包到服务器，解压后进入项目目录即可。

### 2. 公网 IP 模式

没有域名时使用这个模式：

```bash
chmod +x setup.sh
./setup.sh --bootstrap 你的公网IP
```

部署完成后打开：

```text
http://你的公网IP:8080
```

进入「设置 -> 连接」填写：

```text
服务器地址：http://你的公网IP:8080/api
访问令牌：setup.sh 输出的 Access token
```

注意：公网 IP 模式是 HTTP，内容和 token 不加密。能用，但不是强安全方案。

### 3. 域名 HTTPS 模式

如果以后有域名，并且 DNS 已指向服务器：

```bash
./setup.sh --bootstrap your.domain.com
```

脚本会安装 Caddy，并自动配置 HTTPS。访问地址：

```text
https://your.domain.com
```

设置页服务器地址：

```text
https://your.domain.com/api
```

### 4. 自定义项目路径

如果你的服务器路径是 `/root/MyDocs/daily-summary`：

```bash
cd /root/MyDocs/daily-summary
APP_DIR=/root/MyDocs/daily-summary ./setup.sh 你的公网IP
```

默认情况下，`setup.sh` 使用脚本所在目录作为项目目录；`APP_DIR` 只在你需要固定路径时使用。

### 5. setup 参数

日常增量更新：

```bash
./setup.sh 你的公网IP
```

首次安装或修复系统环境：

```bash
./setup.sh --bootstrap 你的公网IP
```

常用参数：

- `--bootstrap`：安装/修复依赖、systemd、ufw 或 Caddy。
- `--force-deps`：强制检查依赖并运行必要的 `apt-get update`。
- `--force-systemd`：强制重写 systemd service。
- `--no-backup`：跳过升级前 SQLite 快照。

默认增量模式不会反复执行 `apt-get update`，也不会在 service 文件未变化时重复 `daemon-reload`。

## 老版本升级

在项目目录拉取或同步新代码后执行：

```bash
chmod +x setup.sh
./setup.sh 你的公网IP
```

脚本会：

- 复用已有 `server/.env` 里的 `DAILY_SUMMARY_TOKEN`。
- 复用已有 AI 配置。
- 构建最新前端和服务端。
- 重启 systemd 服务。
- systemd 配置未变化时不重复初始化。
- 依赖已满足时不执行 `apt-get update`。
- 如果发现旧数据库，会先复制一份 `pre-upgrade-时间.db` 到备份目录。

强制更换访问令牌：

```bash
FORCE_NEW_TOKEN=1 ./setup.sh 你的公网IP
```

更换后，所有手机/桌面端都需要在设置页重新填写 token。

## 常用命令

查看服务状态：

```bash
systemctl status daily-summary
```

查看日志：

```bash
journalctl -u daily-summary -f
```

重启服务：

```bash
sudo systemctl restart daily-summary
```

本机测试 API：

```bash
curl http://127.0.0.1:8080/api/articles?page=1\&page_size=1
```

公网测试：

```bash
curl http://你的公网IP:8080/api/articles?page=1\&page_size=1
```

如果返回 `Unauthorized`，说明服务正常，只是没有带 token。

## 手机和桌面使用

手机：

```text
http://你的公网IP:8080
```

桌面开发：

```bash
npm install
npm run desktop:dev
```

桌面打包时写入默认 API 地址：

```bash
VITE_API_BASE_URL=http://你的公网IP:8080/api npm run desktop:build
```

如果没有指定默认 API，桌面端首次打开后在「设置 -> 连接」里手动填写服务器地址和 token。

## AI 配置

AI Key 只放服务器，不放浏览器或桌面端。

编辑：

```bash
nano server/.env
```

配置：

```text
DAILY_SUMMARY_AI_API_KEY=你的key
DAILY_SUMMARY_AI_BASE_URL=https://api.openai.com/v1
DAILY_SUMMARY_AI_MODEL=gpt-4o-mini
```

重启：

```bash
sudo systemctl restart daily-summary
```

AI 行为：

- 今日页「AI 总结」只生成简洁纯文本，不写回正文。
- 周复盘基于本周每日记录生成草稿。
- 月复盘只读取已确认的周复盘，减少扫描每日记录的压力。
- 同一周期可以重复生成多个版本。
- 旧版本、草稿、已确认版本都可以删除。
- 复盘确认不是不可变归档；这是个人工具，允许继续编辑。

## 备份和恢复

设置页「备份」可以创建、下载、删除 SQLite 快照。

服务器默认数据目录：

```text
~/.local/share/.daily-summary
```

数据库：

```text
~/.local/share/.daily-summary/data.db
```

备份目录：

```text
~/.local/share/.daily-summary/backups
```

手动恢复流程：

```bash
sudo systemctl stop daily-summary
cp ~/.local/share/.daily-summary/data.db ~/.local/share/.daily-summary/data.db.before-restore
cp /path/to/backup.db ~/.local/share/.daily-summary/data.db
sudo systemctl start daily-summary
```

不提供网页恢复按钮，是为了避免误点覆盖数据库。

## 安全建议

公网 IP + HTTP 模式的安全上限有限。最低要求：

- 使用脚本生成的长 token，不要改成短密码。
- 云服务器安全组只放行 SSH 和 `8080/tcp`。
- 不在公共 Wi-Fi 下记录特别敏感内容。
- 手机丢失或怀疑 token 泄露后，立即执行：

```bash
FORCE_NEW_TOKEN=1 ./setup.sh 你的公网IP
```

更好的方案仍然是域名 + HTTPS：

```bash
./setup.sh your.domain.com
```

## 排错

### 手机打不开

先在服务器上查：

```bash
systemctl status daily-summary
ss -lntp | grep 8080
curl http://127.0.0.1:8080/api/articles?page=1\&page_size=1
```

如果本机 curl 正常，手机打不开，通常是云服务器安全组没有放行 `8080/tcp`。

### 设置页连接失败

检查：

- 服务器地址是否是 `http://服务器IP:8080/api`。
- token 是否和 `server/.env` 里的 `DAILY_SUMMARY_TOKEN` 一致。
- 服务是否重启成功。

### AI 不工作

检查：

```bash
grep DAILY_SUMMARY_AI server/.env
journalctl -u daily-summary -f
```

如果没有配置 `DAILY_SUMMARY_AI_API_KEY`，每日 AI 总结和周/月 AI 复盘会返回明确错误。

### 复盘接口不存在

说明服务端还在运行旧版本。重新构建并重启：

```bash
./setup.sh 你的公网IP
```

## 本地开发

服务端开发：

```bash
cd server
DAILY_SUMMARY_ALLOW_NO_TOKEN=1 DAILY_SUMMARY_BIND=127.0.0.1:8080 cargo run
```

前端开发：

```bash
npm install
npm run dev
```

开发时可在设置页填写：

```text
http://127.0.0.1:8080/api
```

构建检查：

```bash
npm run build
cd server && cargo check
cd ../src-tauri && cargo check
```

## 环境变量

- `DAILY_SUMMARY_TOKEN`：API 访问令牌，生产必填。
- `DAILY_SUMMARY_ALLOW_NO_TOKEN=1`：仅本地开发放行。
- `DAILY_SUMMARY_BIND=0.0.0.0:8080`：公网 IP 模式监听地址。
- `DAILY_SUMMARY_BIND=127.0.0.1:8080`：域名 + Caddy 模式监听地址。
- `DAILY_SUMMARY_ALLOWED_ORIGINS=http://你的公网IP:8080`：CORS 白名单。
- `DAILY_SUMMARY_AI_API_KEY`：服务端 AI Key。
- `DAILY_SUMMARY_AI_BASE_URL`：OpenAI-compatible API Base URL。
- `DAILY_SUMMARY_AI_MODEL`：AI 模型名。
- `VITE_API_BASE_URL=http://你的公网IP:8080/api`：前端构建时默认 API 地址。
