import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import * as api from "../../lib/api";
import { Button } from "../ui/button";
import { InlineError } from "../ui/Feedback";

export default function RuntimeOverview() {
  const query = useQuery({ queryKey: ["runtimeHealth", api.getServerUrl()], queryFn: api.healthCheck, staleTime: 30000 });
  const health = query.data;
  const monitoring = health?.monitoring;
  const time = (value?: number | null) => value === undefined ? "服务器未提供" : value ? new Date(value * 1000).toLocaleString() : "暂无记录";
  const disk = monitoring?.disk_usage_percent;
  const metrics = health ? [
    ["服务器连接", `已连接 · v${health.version}`],
    ["数据库完整性", monitoring?.database_integrity === "ok" ? "检查通过" : monitoring?.database_integrity || "尚未检查"],
    ["AI 配置", !health.ai_config ? "服务器未提供" : !(health.ai_config.api_key_configured ?? health.ai_config.configured) ? "未配置" : monitoring?.ai_consecutive_failures ? `连续失败 ${monitoring.ai_consecutive_failures} 次` : "已配置"],
    ["最近本地备份", time(monitoring?.last_backup_unix)],
    ["最近异地备份", time(monitoring?.offsite_last_success_unix)],
    ["磁盘占用", disk == null ? "无法获取" : `${disk.toFixed(1)}%${monitoring?.disk_usage_warning ? " · 需要关注" : ""}`],
  ] : [];
  return <section className="wb-panel runtime-overview" aria-label="运行概览">
    <header className="runtime-heading"><div><h3><Activity size={18} aria-hidden="true"/>运行概览</h3><p>连接、数据保护与服务配置</p></div><Button size="small" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15}/>刷新</Button></header>
    {query.isError ? <InlineError message="无法读取运行状态，请检查服务器连接与令牌。" onRetry={() => void query.refetch()}/> : !health ? <p role="status">正在读取运行状态…</p> : <>
      <dl className="runtime-metrics">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd>{label === "磁盘占用" && disk != null && <div className="runtime-disk" role="meter" aria-label="磁盘占用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={disk}><span style={{width:`${Math.max(0, Math.min(100,disk))}%`}} data-warning={monitoring?.disk_usage_warning}/></div>}</div>)}</dl>
      <footer className="runtime-actions"><Button asChild size="small"><Link to="/settings" search={{tab:"data"}}>查看备份与数据</Link></Button><Button asChild size="small" variant="ghost"><Link to="/settings" search={{tab:"ai"}}>检查 AI 配置</Link></Button></footer>
    </>}
  </section>;
}
