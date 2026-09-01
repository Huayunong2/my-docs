import { useEffect, useRef, useState } from "react";
import { Download, LockKeyhole, RefreshCw, RotateCcw, Save, ShieldCheck, Trash2 } from "lucide-react";
import * as api from "../../lib/api";
import type { BackupMeta } from "../../lib/api";
import { LoadingState, useConfirmDialog } from "../ui/Feedback";
import { Card, DangerBtn, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone, daysSince, formatSize } from "./shared";

const backupDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatBackupDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? backupDateFormatter.format(date) : value;
}

export default function BackupPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadPending, setReloadPending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const reloadTimerRef = useRef<number | null>(null);
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const newest = backups[0];
  const stale = newest ? daysSince(newest.created_at) > 7 : false;
  const { confirm, dialog } = useConfirmDialog();

  const refresh = async () => {
    if (busy || reloadPending) return;
    setBusy("refresh");
    try {
      setBackups(await api.listBackups());
      setLoadError("");
      setMsg("");
    } catch (e) {
      setLoadError(api.getErrorMessage(e));
      setMsg("");
      setTone("bad");
    } finally {
      setLoading(false);
      setBusy(null);
    }
  };

  useEffect(() => { void refresh(); }, [refreshToken]);

  useEffect(() => () => {
    if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
  }, []);

  const schedulePageReload = () => {
    setReloadPending(true);
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      window.location.reload();
    }, 1200);
  };

  const create = async () => {
    if (busy || reloadPending) return;
    setBusy("create");
    setMsg("正在创建服务器快照…");
    setTone("neutral");
    try {
      const created = await api.createBackup();
      setBackups((current) => [created, ...current.filter((backup) => backup.name !== created.name)]);
      setMsg(`已创建服务器快照：${created.name}。需要撤销导入或迁移时，可以从列表恢复它。`);
      setTone("good");
    } catch (e) {
      setMsg(`创建快照失败：${api.getErrorMessage(e)}`);
      setTone("bad");
    } finally {
      setBusy(null);
    }
  };

  const download = async (name: string) => {
    if (busy || reloadPending) return;
    setBusy(`download:${name}`);
    setMsg(`正在准备下载：${name}`);
    setTone("neutral");
    try {
      await api.downloadBackup(name);
      setMsg(`已开始下载服务器快照：${name}`);
      setTone("good");
    } catch (e) {
      setMsg(`下载失败：${api.getErrorMessage(e)}`);
      setTone("bad");
    } finally {
      setBusy(null);
    }
  };

  const restore = async (backup: BackupMeta) => {
    if (busy || reloadPending) return;
    const ok = await confirm({
      title: "恢复服务器快照",
      message: `将用“${backup.name}”替换当前服务器上的全部数据。恢复前会自动创建一个系统保护点；恢复完成后页面会刷新。只有在确认快照内容正确时才继续。`,
      confirmText: "恢复此快照",
      danger: true,
    });
    if (!ok) return;
    setBusy(`restore:${backup.name}`);
    setMsg(`正在恢复服务器快照：${backup.name}…`);
    setTone("neutral");
    try {
      const result = await api.restoreBackup(backup.name);
      setMsg(`已恢复 ${result.restored_from}。恢复前保护点为 ${result.pre_restore_backup.name}，页面将在片刻后刷新。`);
      setTone("good");
      schedulePageReload();
    } catch (e) {
      const errorMessage = api.getErrorMessage(e);
      const restoreCompleted = errorMessage.includes("数据已恢复");
      setMsg(restoreCompleted
        ? `${errorMessage} 页面将在片刻后刷新，请稍后重新检查快照列表。`
        : `恢复失败：${errorMessage}\n如果服务端已创建恢复前保护点，请不要继续写入，先刷新列表检查它。`);
      setTone(restoreCompleted ? "warn" : "bad");
      if (restoreCompleted) {
        schedulePageReload();
      }
    } finally {
      setBusy(null);
    }
  };

  const deleteBackup = async (backup: BackupMeta) => {
    const name = backup.name;
    if (busy || reloadPending) return;
    if (backup.protected) return;
    const ok = await confirm({
      title: "删除备份",
      message: `删除备份“${name}”？删除后无法从此列表下载它；如果它是唯一恢复点，建议先下载。`,
      confirmText: "删除备份",
      danger: true,
    });
    if (!ok) return;
    setBusy(`delete:${name}`);
    try {
      await api.deleteBackup(name);
      setBackups((current) => current.filter((backup) => backup.name !== name));
      setMsg(`已删除备份：${name}`);
      setTone("good");
    } catch (e) {
      setMsg(`删除失败：${api.getErrorMessage(e)}`);
      setTone("bad");
    } finally {
      setBusy(null);
    }
  };

  const statusMessage = loading
    ? "正在读取最近的服务器快照…"
    : loadError
      ? `无法读取服务器快照：${loadError}\n请刷新列表后再判断是否需要创建恢复点。`
      : !newest
      ? "还没有服务器快照。建议在导入或迁移前先创建一个恢复点。"
      : stale
        ? `最近创建于 ${formatBackupDate(newest.created_at)}，已超过 7 天：${newest.name}`
        : `最近创建于 ${formatBackupDate(newest.created_at)}：${newest.name}`;

  return (
    <div className="settings-panel-stack flex min-w-0 flex-col gap-5">
      <Card className="settings-backup-card">
        <SectionTitle desc="在当前时间点留下可恢复的服务器副本；迁移到另一台服务器时，请下载完整归档。">服务器快照</SectionTitle>
        <StatusBox tone={loading ? "neutral" : loadError ? "bad" : !newest || stale ? "warn" : "good"} message={statusMessage} />
        {msg && <div className="mt-3"><StatusBox message={msg} tone={tone} /></div>}
        <div className="settings-section-actions mt-4 flex flex-col gap-2 sm:flex-row sm:justify-start">
          <PrimaryBtn onClick={create} disabled={busy !== null || reloadPending}>
            <Save size={15} /> {busy === "create" ? "创建中…" : "创建服务器快照"}
          </PrimaryBtn>
          <SecondaryBtn onClick={() => void refresh()} disabled={busy !== null || reloadPending}>
            <RefreshCw size={15} className={busy === "refresh" ? "animate-spin" : ""} /> {busy === "refresh" ? "刷新中…" : "刷新列表"}
          </SecondaryBtn>
        </div>
      <div className="settings-backup-list-section mt-5 border-t border-[var(--ui-border)] pt-5">
        <div className="flex items-start justify-between gap-3">
          <SectionTitle desc="恢复前会自动创建保护点；带锁标记的系统快照由系统保留，不能删除。">快照列表</SectionTitle>
          {!loading && !loadError && <span className="settings-count-badge shrink-0">{backups.length} 个</span>}
        </div>
        {loading ? (
          <LoadingState label="正在读取快照" rows={2} />
        ) : loadError ? (
          <p className="text-sm leading-6 text-[var(--ui-text-muted)]">快照列表暂时不可用。修复连接后点击“刷新列表”，不要根据当前页面判断服务器上是否有快照。</p>
        ) : backups.length === 0 ? (
          <p className="text-sm leading-6 text-[var(--ui-text-muted)]">暂无快照。创建后，这里会显示恢复、下载和保护状态。</p>
        ) : (
          <div className="settings-backup-list" role="list" aria-busy={busy === "refresh" || reloadPending}>
            {backups.map((backup, index) => {
              const downloadBusy = busy === `download:${backup.name}`;
              const deleteBusy = busy === `delete:${backup.name}`;
              const restoreBusy = busy === `restore:${backup.name}`;
              const isProtected = backup.protected ?? (
                backup.kind === "automated"
                || backup.kind === "pre_upgrade"
                || backup.kind === "pre_restore"
                || backup.name.startsWith("daily-summary-auto-")
                || backup.name.startsWith("pre-upgrade-")
                || backup.name.startsWith("pre-restore-")
                || backup.name === "daily-summary-latest.db"
              );
              const kindLabel = backup.kind === "pre_restore"
                ? "恢复前保护点"
                : backup.kind === "pre_upgrade"
                  ? "升级前保护点"
                  : backup.kind === "automated"
                    ? "自动快照"
                    : "手动快照";
              return (
                <div key={backup.name} className="settings-backup-row" role="listitem">
                  <div className="settings-backup-row-main min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="max-w-full truncate font-mono text-sm font-medium text-[var(--ui-text)]">{backup.name}</p>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${isProtected ? "ui-status-muted" : "ui-status-accent"}`}>
                        {isProtected ? <LockKeyhole size={11} /> : <ShieldCheck size={11} />}
                        {isProtected ? `系统保护 · ${kindLabel}` : kindLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--ui-text-subtle)]">
                      {formatSize(backup.size_bytes)} · {formatBackupDate(backup.created_at)}{index === 0 ? " · 最近创建" : ""}
                    </p>
                  </div>
                  <div className="settings-row-actions grid gap-2 sm:grid-cols-3">
                    <SecondaryBtn
                      onClick={() => void restore(backup)}
                      disabled={busy !== null || reloadPending}
                      title="用此快照替换当前数据"
                      className="settings-row-action text-xs"
                    >
                      <RotateCcw size={13} /> {restoreBusy ? "恢复中…" : "恢复"}
                    </SecondaryBtn>
                    <SecondaryBtn onClick={() => void download(backup.name)} disabled={busy !== null || reloadPending} className="settings-row-action text-xs">
                      <Download size={13} /> {downloadBusy ? "准备中…" : "下载"}
                    </SecondaryBtn>
                    <DangerBtn
                      onClick={() => void deleteBackup(backup)}
                      disabled={busy !== null || reloadPending || isProtected}
                      title={isProtected ? "系统保护备份不能删除" : "删除此备份"}
                      className="settings-row-action text-xs"
                    >
                      {isProtected ? <LockKeyhole size={13} /> : <Trash2 size={13} />} {isProtected ? "系统保护" : deleteBusy ? "删除中…" : "删除备份"}
                    </DangerBtn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </Card>
      {dialog}
    </div>
  );
}
