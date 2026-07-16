import { useEffect, useState } from "react";
import { ClipboardCopy, RefreshCw, Save, Trash2, Wifi } from "lucide-react";
import * as api from "../../lib/api";
import { useConfirmDialog } from "../ui/Feedback";
import { Card, DangerBtn, Input, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone, normalizeInputUrl } from "./shared";

export default function ConnectionPanel() {
  const [serverUrl, setServerUrl] = useState(api.getServerUrl());
  const [token, setToken] = useState(api.getApiToken());
  const [showToken, setShowToken] = useState(false);
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.healthCheck>> | null>(null);
  const [healthError, setHealthError] = useState("");
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => { checkHealth(); }, []);
  const checkHealth = async () => {
    try {
      setHealth(await api.healthCheck());
      setHealthError("");
    } catch { setHealthError("无法获取服务端信息"); }
  };
  const normalizedUrl = normalizeInputUrl(serverUrl);
  const urlWarning = api.validateServerUrl(serverUrl);
  const isUnconfiguredDesktop = api.isDesktopClient() && !serverUrl.trim();
  const connectionMode = isUnconfiguredDesktop
    ? "桌面端未配置"
    : normalizedUrl.startsWith("https://")
      ? "HTTPS"
      : normalizedUrl.startsWith("http://")
        ? "公网 IP / HTTP"
        : "同源 / 本地";
  const displayUrl = isUnconfiguredDesktop ? "未配置，请填写 http://服务器IP:8080/api" : normalizedUrl;

  const testConnection = async (url = serverUrl, currentToken = token) => {
    setTesting(true);
    setMsg("");
    setTone("neutral");
    try {
      if (api.isDesktopClient() && !url.trim()) {
        setMsg("桌面端必须填写服务器地址，例如 http://服务器IP:8080/api。");
        setTone("warn");
        return false;
      }
      const headers = new Headers();
      if (currentToken.trim()) headers.set("Authorization", `Bearer ${currentToken.trim()}`);
      const res = await fetch(`${normalizeInputUrl(url)}/articles?page=1&page_size=1`, { headers });
      if (res.ok) {
        setMsg("连接成功。当前设备会使用这组服务器配置。");
        setTone("good");
        return true;
      }
      setMsg(res.status === 401 ? "令牌无效或未填写。" : `服务器返回 ${res.status}: ${await res.text()}`);
      setTone("bad");
    } catch (e) {
      setMsg(`无法连接：${api.getErrorMessage(e)}`);
      setTone("bad");
    } finally {
      setTesting(false);
    }
    return false;
  };

  const saveAndTest = async () => {
    api.setServerUrl(serverUrl);
    api.setApiToken(token);
    await testConnection(serverUrl, token);
  };

  const clearLocalConfig = async () => {
    const ok = await confirm({
      title: "清除本机配置",
      message: "只清除这台设备保存的地址和令牌，不会删除服务器数据。继续？",
      confirmText: "清除",
      danger: true,
    });
    if (!ok) return;
    api.setServerUrl("");
    api.setApiToken("");
    setServerUrl(api.isDesktopClient() ? "" : "/api");
    setToken("");
    setMsg("已清除这台设备保存的连接配置。");
    setTone("neutral");
  };

  const copyApiUrl = async () => {
    await navigator.clipboard.writeText(displayUrl);
    setMsg(`已复制 API 地址：${displayUrl}`);
    setTone("neutral");
  };

  return (
    <div className="grid w-full max-w-3xl gap-4">
      <Card>
        <SectionTitle desc="显示当前设备将连接到哪里。">连接状态</SectionTitle>
        <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500">模式</p>
            <p className="mt-1 font-medium text-gray-800 dark:text-gray-100">{connectionMode}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-400 dark:text-gray-500">API 地址</p>
            <p className="mt-1 break-all font-mono text-xs text-gray-600 dark:text-gray-300">{displayUrl}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:flex sm:flex-row">
          <SecondaryBtn onClick={copyApiUrl} disabled={isUnconfiguredDesktop}><ClipboardCopy size={15} /> 复制 API 地址</SecondaryBtn>
          <SecondaryBtn onClick={() => testConnection()} disabled={testing}><Wifi size={15} /> {testing ? "测试中..." : "仅测试连接"}</SecondaryBtn>
        </div>
        <div className="mt-3"><StatusBox message={msg} tone={tone} /></div>
      </Card>

      <Card>
        <SectionTitle desc="服务端版本、编译时间、AI 和复盘功能是否就绪。">服务端诊断</SectionTitle>
        {healthError ? (
          <StatusBox tone="bad" message={healthError} />
        ) : health ? (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <InfoTile label="服务端版本" value={health.version} mono />
            <InfoTile label="前端版本" value="1.0.0" mono />
            <InfoTile label="编译时间" value={new Date(Number(health.build) * 1000).toLocaleString()} mono />
            <InfoTile label="AI 功能" value={health.features.ai ? "已配置" : "未配置"} good={health.features.ai} />
            <InfoTile label="复盘功能" value={health.features.reviews ? "可用" : "不可用"} good={health.features.reviews} />
            <InfoTile label="知识库" value={health.features.knowledge ? "可用" : "不可用"} good={health.features.knowledge} />
            <InfoTile label="导出功能" value={health.features.exports ? "可用" : "不可用"} good={health.features.exports} />
            {health.monitoring && (
              <>
                <InfoTile
                  label="SQLite 检查"
                  value={health.monitoring.database_integrity === "ok" ? "正常" : health.monitoring.database_integrity}
                  good={health.monitoring.database_integrity === "ok"}
                />
                <InfoTile
                  label="AI 连续失败"
                  value={`${health.monitoring.ai_consecutive_failures} 次`}
                  good={health.monitoring.ai_consecutive_failures === 0}
                />
                {health.monitoring.disk_usage_percent != null && (
                  <InfoTile
                    label="磁盘使用率"
                    value={`${health.monitoring.disk_usage_percent}%`}
                    good={!health.monitoring.disk_usage_warning}
                  />
                )}
                {health.monitoring.offsite_last_success_unix && (
                  <InfoTile
                    label="最近异地备份"
                    value={new Date(health.monitoring.offsite_last_success_unix * 1000).toLocaleString()}
                    good
                  />
                )}
                {health.monitoring.offsite_verify_last_success_unix && (
                  <InfoTile
                    label="最近恢复演练"
                    value={new Date(health.monitoring.offsite_verify_last_success_unix * 1000).toLocaleString()}
                    good
                  />
                )}
              </>
            )}
            {health.db_path && (
              <InfoTile
                label="数据库路径"
                value={health.db_path}
                meta={health.db_size ? (health.db_size < 1048576 ? `${(health.db_size/1024).toFixed(1)} KB` : `${(health.db_size/1048576).toFixed(1)} MB`) : "—"}
                mono
                wide
              />
            )}
            {health.last_backup && (
              <InfoTile label="最近备份" value={health.last_backup} />
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400">加载中...</p>
        )}
        <SecondaryBtn onClick={checkHealth} className="mt-3"><RefreshCw size={15} /> 刷新诊断</SecondaryBtn>
      </Card>

      <Card>
        <SectionTitle desc="公网 IP 模式填写 http://服务器IP:8080/api。">服务器配置</SectionTitle>
        <div className="space-y-3">
          <Input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="http://服务器IP:8080/api" />
          <Input type={showToken ? "text" : "password"} value={token} onChange={(e) => setToken(e.target.value)} placeholder="粘贴 setup.sh 生成的 token" />
          <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <input type="checkbox" checked={showToken} onChange={(e) => setShowToken(e.target.checked)} className="accent-accent" />
            显示令牌
          </label>
          <PrimaryBtn onClick={saveAndTest} disabled={testing}><Save size={15} /> 保存并测试</PrimaryBtn>
        </div>
      </Card>

      <Card>
        <SectionTitle>安全提示</SectionTitle>
        <StatusBox
          tone={urlWarning ? "warn" : "neutral"}
          message={urlWarning || "当前地址格式有效。公网 HTTP 模式仍不加密，敏感内容不要在不可信网络下填写。"}
        />
        <ul className="mt-3 space-y-1.5 text-sm text-gray-500 dark:text-gray-400">
          <li>使用脚本生成的长令牌，不要改成短密码。</li>
          <li>手机丢失或令牌泄露后，用 FORCE_NEW_TOKEN=1 重新部署并换令牌。</li>
          <li>云服务器安全组只放行必要端口。</li>
        </ul>
      </Card>

      <Card>
        <SectionTitle>维护操作</SectionTitle>
        <div className="flex flex-col sm:flex-row gap-2">
          <DangerBtn onClick={clearLocalConfig}><Trash2 size={15} /> 清除本机配置</DangerBtn>
        </div>
      </Card>
      {dialog}
    </div>
  );
}

function InfoTile({
  label,
  value,
  meta,
  mono = false,
  good,
  wide = false,
}: {
  label: string;
  value: string;
  meta?: string;
  mono?: boolean;
  good?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`rounded-lg bg-gray-50 p-3 dark:bg-white/[0.035] ${wide ? "sm:col-span-2" : ""}`}>
      <div className="text-xs text-gray-400 dark:text-gray-500">{label}</div>
      <div className={[
        "mt-1 truncate text-sm font-medium",
        mono ? "font-mono text-xs" : "",
        good === undefined ? "text-gray-700 dark:text-gray-300" : good ? "text-emerald-600 dark:text-emerald-300" : "text-gray-400 dark:text-gray-500",
      ].join(" ")}>
        {value}
      </div>
      {meta && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">{meta}</div>}
    </div>
  );
}
