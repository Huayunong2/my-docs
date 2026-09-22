import { useState } from "react";
import { DatabaseBackup, ArrowLeftRight } from "lucide-react";
import BackupPanel from "./BackupPanel";
import ExportPanel from "./ExportPanel";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

export default function DataSafetyPanel({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [backupRefreshToken, setBackupRefreshToken] = useState(0);
  const [view, setView] = useState(() =>
    new URLSearchParams(window.location.search).get("tab") === "export"
      ? "transfer"
      : "backup",
  );
  return (
    <div className="st-data-workspace">
      <Tabs value={view} onValueChange={setView}>
        <TabsList aria-label="数据管理方式">
          <TabsTrigger value="backup">
            <DatabaseBackup size={15} />
            备份与恢复
          </TabsTrigger>
          <TabsTrigger value="transfer">
            <ArrowLeftRight size={15} />
            导出与迁移
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="wb-muted st-data-note">
        {view === "backup"
          ? "为当前数据创建保护点；恢复操作仍需核对备份并确认。"
          : "选择要迁移的内容，先检查导入预览，再决定是否写入。"}
      </p>
      <div hidden={view !== "backup"}>
        <BackupPanel refreshToken={backupRefreshToken} />
      </div>
      <div hidden={view !== "transfer"}>
        <ExportPanel
          onBackupCreated={() =>
            setBackupRefreshToken((current) => current + 1)
          }
          onDirtyChange={onDirtyChange}
        />
      </div>
    </div>
  );
}
