import { useState } from "react";
import BackupPanel from "./BackupPanel";
import ExportPanel from "./ExportPanel";

export default function DataSafetyPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [backupRefreshToken, setBackupRefreshToken] = useState(0);
  return (
    <div className="settings-data-layout grid w-full items-start gap-5 xl:grid-cols-[minmax(0,1.16fr)_minmax(20rem,0.84fr)]">
      <BackupPanel refreshToken={backupRefreshToken} />
      <ExportPanel
        onBackupCreated={() => setBackupRefreshToken((current) => current + 1)}
        onDirtyChange={onDirtyChange}
      />
    </div>
  );
}
