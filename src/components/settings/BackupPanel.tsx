import { useEffect, useMemo, useState } from "react";
import * as api from "../../lib/api";
import type { BackupMeta } from "../../lib/api";
import { useConfirmDialog } from "../ui/Feedback";
import { Card, DangerBtn, PrimaryBtn, SecondaryBtn, SectionTitle, StatusBox, type Tone, daysSince, formatSize } from "./shared";

export default function BackupPanel() {
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const newest = useMemo(() => backups[0], [backups]);
  const stale = newest ? daysSince(newest.created_at) > 7 : false;
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => { refresh(); }, []);
  const refresh = async () => {
    try { setBackups(await api.listBackups()); setMsg(""); } catch (e) { setMsg(`加载失败：${api.getErrorMessage(e)}`); setTone("bad"); }
  };
  const create = async () => {
    setMsg("创建中..."); setTone("neutral");
    try { const m = await api.createBackup(); setBackups((p) => [m, ...p]); setMsg(`已创建备份：${m.name}`); setTone("good"); } catch (e) { setMsg(`创建失败：${api.getErrorMessage(e)}`); setTone("bad"); }
  };
  const download = async (name: string) => {
    try { await api.downloadBackup(name); setMsg(`已开始下载：${name}`); setTone("good"); } catch (e) { setMsg(`下载失败：${api.getErrorMessage(e)}`); setTone("bad"); }
  };
  const del = async (name: string) => {
    const ok = await confirm({ title: "删除备份", message: `删除备份 ${name}？`, confirmText: "删除", danger: true });
    if (!ok) return;
    try { await api.deleteBackup(name); setBackups((p) => p.filter((b) => b.name !== name)); setMsg(`已删除备份：${name}`); setTone("good"); } catch (e) { setMsg(`删除失败：${api.getErrorMessage(e)}`); setTone("bad"); }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <Card>
        <SectionTitle desc="建议每周至少创建一次快照。">备份状态</SectionTitle>
        <StatusBox
          tone={!newest ? "warn" : stale ? "warn" : "good"}
          message={!newest ? "还没有备份。" : stale ? `最近备份已超过 7 天：${newest.name}` : `最近备份正常：${newest.name}`}
        />
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <PrimaryBtn onClick={create}>创建备份</PrimaryBtn>
          <SecondaryBtn onClick={refresh}>刷新列表</SecondaryBtn>
        </div>
        <div className="mt-3"><StatusBox message={msg} tone={tone} /></div>
      </Card>

      <Card>
        <SectionTitle>备份列表</SectionTitle>
        {backups.length === 0 && <p className="text-sm text-gray-400">暂无备份</p>}
        <div className="space-y-2">
          {backups.map((b, index) => (
            <div key={b.name} className={`rounded-lg border p-3 ${index === 0 ? "border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-900/10" : "border-gray-100 dark:border-white/5"}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-mono font-medium text-gray-700 dark:text-gray-300 truncate">{b.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{formatSize(b.size_bytes)} · {b.created_at}{index === 0 ? " · 最新" : ""}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <SecondaryBtn onClick={() => download(b.name)} className="py-1.5 text-xs">下载</SecondaryBtn>
                  <DangerBtn onClick={() => del(b.name)} className="py-1.5 text-xs">删除</DangerBtn>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      {dialog}
    </div>
  );
}

