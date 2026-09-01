import { useEffect, useState } from "react";
import { ChevronDown, ClipboardCopy, Link2, RefreshCw, Save, Trash2, Wifi } from "lucide-react";
import * as api from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { useConfirmDialog } from "../ui/Feedback";
import { Card, DangerBtn, Input, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone, normalizeInputUrl } from "./shared";

export default function ConnectionPanel({
  onConnectionSaved,
  onDirtyChange,
}: {
  onConnectionSaved?: (message?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [serverUrl, setServerUrl] = useState(api.getServerUrl());
  const [token, setToken] = useState(api.getApiToken());
  const [savedServerUrl, setSavedServerUrl] = useState(api.getServerUrl());
  const [savedToken, setSavedToken] = useState(api.getApiToken());
  const [showToken, setShowToken] = useState(false);
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const [testing, setTesting] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.healthCheck>> | null>(null);
  const [healthError, setHealthError] = useState("");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  const checkHealth = async () => {
    setHealthLoading(true);
    try {
      setHealth(await api.healthCheck());
      setHealthError("");
    } catch (e) {
      setHealthError(api.getErrorMessage(e));
    } finally {
      setHealthLoading(false);
    }
  };

  const normalizedUrl = normalizeInputUrl(serverUrl);
  const savedNormalizedUrl = normalizeInputUrl(savedServerUrl);
  const urlWarning = api.validateServerUrl(serverUrl);
  const urlIsInvalid = Boolean(urlWarning && !urlWarning.includes("公网 HTTP"));
  const isUnconfiguredDesktop = api.isDesktopClient() && !serverUrl.trim();
  const savedIsUnconfiguredDesktop = api.isDesktopClient() && !savedServerUrl.trim();
  const connectionMode = isUnconfiguredDesktop
    ? "桌面端未配置"
    : normalizedUrl.startsWith("https://")
      ? "HTTPS"
      : normalizedUrl.startsWith("http://")
        ? api.isLoopbackServerUrl(normalizedUrl) ? "本机 HTTP" : "公网 IP / HTTP"
        : "同源 / 本地";
  const savedConnectionMode = savedIsUnconfiguredDesktop
    ? "桌面端未配置"
    : savedNormalizedUrl.startsWith("https://")
      ? "HTTPS"
      : savedNormalizedUrl.startsWith("http://")
        ? api.isLoopbackServerUrl(savedNormalizedUrl) ? "本机 HTTP" : "公网 IP / HTTP"
        : "同源 / 本地";
  const displayUrl = savedIsUnconfiguredDesktop
    ? "未配置，请填写 http://服务器IP:8080/api"
    : savedNormalizedUrl.startsWith("/") && typeof window !== "undefined"
      ? window.location.origin + savedNormalizedUrl
      : savedNormalizedUrl;
  const isDirty = normalizeInputUrl(serverUrl) !== savedNormalizedUrl || token.trim() !== savedToken.trim();
  const connectionStatusLabel = isDirty
    ? ["待保存", connectionMode].join(" · ")
    : savedIsUnconfiguredDesktop ? "尚未配置" : savedConnectionMode;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const testConnection = async (url = serverUrl, currentToken = token, allowStoredFallback = true) => {
    setTesting(true);
    setMsg("");
    setTone("neutral");
    try {
      if (api.isDesktopClient() && !url.trim()) {
        setMsg("桌面端必须填写服务器地址，例如 http://服务器IP:8080/api。");
        setTone("warn");
        return false;
      }
      const warning = api.validateServerUrl(url);
      if (warning && !warning.includes("公网 HTTP")) {
        setMsg(warning);
        setTone("bad");
        return false;
      }
      const candidateUrl = normalizeInputUrl(url);
      const headers = new Headers();
      const canReuseStoredToken = allowStoredFallback && candidateUrl === savedNormalizedUrl;
      const requestToken = currentToken.trim() || (canReuseStoredToken ? api.getApiTokenForUrl(candidateUrl) : "");
      if (requestToken) headers.set("Authorization", `Bearer ${requestToken}`);
      const res = await fetch(`${candidateUrl}/articles?page=1&page_size=1`, { headers });
      if (res.ok) {
        setMsg("连接成功，可以保存这组服务器配置。");
        setTone("good");
        return true;
      }
      setMsg(res.status === 401
        ? "令牌无效或未填写。请检查令牌后重试；如果这是新服务器，请确认服务端令牌已经生效。"
        : `服务器返回 ${res.status}: ${await res.text()}`);
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
    const connected = await testConnection(serverUrl, token, false);
    if (!connected) return;
    api.setServerUrl(serverUrl);
    api.setApiToken(token);
    setServerUrl(normalizedUrl);
    setSavedServerUrl(normalizedUrl);
    setSavedToken(token.trim());
    setMsg("连接成功，服务器配置已保存到当前设备。");
    setTone("good");
    window.setTimeout(() => {
      onConnectionSaved?.("连接成功，服务器配置已保存到当前设备。");
    }, 0);
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
    setSavedServerUrl("");
    setSavedToken("");
    setHealth(null);
    setMsg("已清除这台设备保存的连接配置。");
    setTone("neutral");
  };

  const copyApiUrl = async () => {
    try {
      await copyText(displayUrl);
      setMsg(`已复制 API 地址：${displayUrl}`);
      setTone("neutral");
    } catch {
      setMsg("复制 API 地址失败，当前浏览器未允许访问剪贴板；请选中页面中的地址后复制。");
      setTone("bad");
    }
  };

  const updateServerUrl = (value: string) => {
    setServerUrl(value);
    setMsg("");
    setTone("neutral");
  };

  const updateToken = (value: string) => {
    setToken(value);
    setMsg("");
    setTone("neutral");
  };

  const localAiLink = api.getLocalAiAccessUrl();
  const copyLocalAiLink = async () => {
    if (!localAiLink) return;
    try {
      await copyText(localAiLink);
      setMsg("已复制本地 AI 访问链接。链接只适用于本机测试，打开后会加载完整今日记录页面。");
      setTone("neutral");
    } catch {
      setMsg("复制本地 AI 访问链接失败，当前浏览器未允许访问剪贴板；请选中链接后复制。");
      setTone("bad");
    }
  };

  return (
    <div className="settings-panel-stack flex w-full flex-col gap-5">
      <Card className="settings-connection-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle desc="输入服务端地址和令牌，测试成功后才会保存到当前设备。修改表单不会立即改变当前连接。">连接服务</SectionTitle>
          <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${isDirty || isUnconfiguredDesktop || Boolean(urlWarning) ? "ui-status-warning" : "ui-status-muted"}`}>
            {connectionStatusLabel}
          </span>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void saveAndTest(); }} className="settings-connection-form grid gap-5">
          <div className="settings-connection-fields grid gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)]">
            <label htmlFor="server-url" className="block min-w-0">
              <span className="block text-sm font-semibold text-[var(--ui-text)]">服务器地址</span>
              <span id="server-url-hint" className="mt-1 block text-xs leading-5 text-[var(--ui-text-muted)]">浏览器同源部署可保留默认地址；远程或桌面端填写包含 /api 的地址。</span>
              <Input
                id="server-url"
                value={serverUrl}
                onChange={(event) => updateServerUrl(event.target.value)}
                placeholder="http://服务器IP:8080/api"
                aria-describedby={urlWarning ? "server-url-hint server-url-warning" : "server-url-hint"}
                aria-invalid={urlIsInvalid || isUnconfiguredDesktop}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={testing}
                className="mt-2 h-11 font-mono text-xs sm:text-sm"
              />
              {urlWarning && (
                <span
                  id="server-url-warning"
                  role={urlIsInvalid ? "alert" : "status"}
                  className={`mt-2 block text-xs leading-5 ${urlIsInvalid ? "text-[var(--ui-danger-text)]" : "text-[var(--ui-warning-text)]"}`}
                >
                  {urlWarning}
                </span>
              )}
            </label>
            <label htmlFor="server-token" className="block min-w-0">
              <span className="block text-sm font-semibold text-[var(--ui-text)]">访问令牌</span>
              <span id="server-token-hint" className="mt-1 block text-xs leading-5 text-[var(--ui-text-muted)]">令牌只保存在当前设备；不要把它粘贴到不可信的页面或聊天中。</span>
              <Input
                id="server-token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(event) => updateToken(event.target.value)}
                placeholder="粘贴服务端生成的访问令牌"
                aria-describedby="server-token-hint"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={testing}
                className="mt-2 h-11 pr-11 font-mono text-sm"
              />
            </label>
          </div>
          <div className="settings-connection-controls flex flex-col gap-3 border-t border-[var(--ui-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--ui-text-muted)]">
              <input type="checkbox" checked={showToken} onChange={(event) => setShowToken(event.target.checked)} disabled={testing} className="accent-[var(--ui-accent-solid)]" />
              显示令牌
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <SecondaryBtn onClick={() => void testConnection()} disabled={testing}>
                <Wifi size={15} /> {testing ? "测试中..." : "仅测试连接"}
              </SecondaryBtn>
              <PrimaryBtn type="submit" disabled={testing}>
                <Save size={15} /> {testing ? "测试中..." : "测试并保存"}
              </PrimaryBtn>
            </div>
          </div>
        </form>
        <div className="mt-4"><StatusBox message={msg} tone={tone} /></div>
        <div className="settings-saved-connection mt-5">
          <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-[minmax(10rem,0.32fr)_minmax(0,1fr)]">
            <div>
              <p className="text-xs text-[var(--ui-text-subtle)]">已保存模式</p>
              <p className="mt-1 font-medium text-[var(--ui-text)]">{savedConnectionMode}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[var(--ui-text-subtle)]">已保存 API 地址</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--ui-text-muted)]">{displayUrl}</p>
            </div>
          </div>
          <SecondaryBtn onClick={copyApiUrl} disabled={savedIsUnconfiguredDesktop} className="mt-3">
            <ClipboardCopy size={15} /> 复制已保存 API 地址
          </SecondaryBtn>
        </div>
      </Card>

      <Card className="settings-advanced-card">
        <details
          open={diagnosticsOpen}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setDiagnosticsOpen(open);
            if (open && !health && !healthError) void checkHealth();
          }}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40">
            <span>
              <span className="block text-sm font-semibold text-[var(--ui-text)]">高级诊断</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--ui-text-muted)]">服务端版本、功能状态和运维检查；日常连接不需要打开这里。</span>
            </span>
            <ChevronDown size={17} className={`shrink-0 text-[var(--ui-text-subtle)] transition-transform ${diagnosticsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </summary>
          <div className="mt-4 border-t border-[var(--ui-border)] pt-4">
            {isDirty && (
              <p className="mb-3 text-xs leading-5 text-[var(--ui-warning-text)]" role="status">
                当前表单尚未保存；下方诊断仍针对已保存的服务器连接，保存后请刷新诊断。
              </p>
            )}
            {healthError ? (
              <StatusBox tone="bad" message={`无法读取服务端诊断：${healthError}\n如果连接尚未通过认证，请先保存连接配置。`} />
            ) : health ? (
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <InfoTile label="服务端版本" value={health.version} mono />
                <InfoTile label="前端版本" value="1.0.0" mono />
                <InfoTile label="编译时间" value={new Date(Number(health.build) * 1000).toLocaleString()} mono />
                <InfoTile label="AI 功能" value={health.features.ai ? "已配置" : "未配置"} good={health.features.ai} />
                <InfoTile label="周期回顾" value={health.features.reviews ? "可用" : "不可用"} good={health.features.reviews} />
                <InfoTile label="知识条目" value={health.features.knowledge ? "可用" : "不可用"} good={health.features.knowledge} />
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
                    meta={health.db_size ? (health.db_size < 1048576 ? `${(health.db_size / 1024).toFixed(1)} KB` : `${(health.db_size / 1048576).toFixed(1)} MB`) : "—"}
                    mono
                    wide
                  />
                )}
                {health.last_backup && <InfoTile label="最近备份" value={health.last_backup} />}
              </div>
            ) : healthLoading ? (
              <p className="text-sm text-[var(--ui-text-subtle)]" role="status">正在读取服务端诊断...</p>
            ) : (
              <p className="text-sm text-[var(--ui-text-subtle)]">暂无诊断信息。</p>
            )}
            <SecondaryBtn onClick={() => void checkHealth()} disabled={healthLoading} className="mt-3">
              <RefreshCw size={15} className={healthLoading ? "animate-spin" : ""} /> {healthLoading ? "刷新中..." : "刷新诊断"}
            </SecondaryBtn>
          </div>
        </details>
      </Card>

      <details className="group">
        <summary className="ui-panel-muted flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40 sm:p-5">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--ui-text)]">高级与本机设置</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--ui-text-muted)]">本地 AI 测试入口、网络安全提示和本机连接配置。</span>
          </span>
          <ChevronDown size={17} className="shrink-0 text-[var(--ui-text-subtle)] transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-3 grid gap-4">
          {localAiLink && (
            <Card>
              <SectionTitle desc="只在 localhost、127.0.0.1 或 ::1 上启用的测试入口；适合交给具备浏览器能力的 AI 查看完整页面。">本地 AI 访问（测试）</SectionTitle>
              <p className="text-sm leading-6 text-[var(--ui-text-muted)]">
                该链接使用公开的测试令牌，不是生产访问令牌。令牌只在当前浏览器会话中使用，页面载入后会从地址栏移除；服务端还会将此令牌限制为 loopback 上的只读请求。
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input readOnly value={localAiLink} aria-label="本地 AI 访问链接" className="min-w-0 break-all font-mono text-xs" />
                <SecondaryBtn onClick={copyLocalAiLink}><Link2 size={15} /> 复制本地链接</SecondaryBtn>
              </div>
            </Card>
          )}

          <Card>
            <SectionTitle>服务端与网络安全</SectionTitle>
            <StatusBox
              tone={urlIsInvalid ? "bad" : urlWarning ? "warn" : "neutral"}
              message={urlWarning || "当前待保存地址格式有效。公网 HTTP 模式仍不加密，敏感内容不要在不可信网络下填写。"}
            />
            <ul className="mt-3 space-y-1.5 text-sm text-[var(--ui-text-muted)]">
              <li>使用脚本生成的长令牌，不要改成短密码。</li>
              <li>手机丢失或令牌泄露后，用 FORCE_NEW_TOKEN=1 重新部署并换令牌。</li>
              <li>云服务器安全组只放行必要端口。</li>
            </ul>
          </Card>

          <Card>
            <SectionTitle desc="只影响这台设备，不会删除服务器上的今日记录、知识条目或复习历史。">本机连接配置</SectionTitle>
            <div className="flex flex-col gap-2 sm:flex-row">
              <DangerBtn onClick={clearLocalConfig}><Trash2 size={15} /> 清除本机配置</DangerBtn>
            </div>
          </Card>
        </div>
      </details>
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
    <div className={`ui-panel-muted rounded-lg p-3 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="text-xs text-[var(--ui-text-subtle)]">{label}</div>
      <div className={[
        "mt-1 break-words text-sm font-medium",
        mono ? "font-mono text-xs" : "",
        good === undefined ? "text-[var(--ui-text)]" : good ? "text-[var(--ui-success-text)]" : "text-[var(--ui-text-subtle)]",
      ].join(" ")}>
        {value}
      </div>
      {meta && <div className="mt-0.5 text-xs text-[var(--ui-text-subtle)]">{meta}</div>}
    </div>
  );
}
