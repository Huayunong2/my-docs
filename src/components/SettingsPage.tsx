import { useState } from "react";
import { motion } from "framer-motion";
import AIPanel from "./settings/AIPanel";
import ConnectionPanel from "./settings/ConnectionPanel";
import BackupPanel from "./settings/BackupPanel";
import ExportPanel from "./settings/ExportPanel";

type Tab = "connect" | "ai" | "backup" | "export";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("connect");
  const labels: Record<Tab, string> = { connect: "连接", ai: "AI", backup: "备份", export: "导出" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full flex flex-col px-3 sm:px-4 md:px-8 py-4 md:py-6 overflow-y-auto"
    >
      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4 md:mb-6">设置</h2>
      <div className="grid grid-cols-4 gap-1 mb-5 md:mb-6 bg-gray-100 dark:bg-white/5 rounded-xl p-1 w-full sm:w-fit sm:inline-grid">
        {(Object.keys(labels) as Tab[]).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`h-10 rounded-lg px-3 text-sm font-medium transition-all duration-200 ${tab === id ? "bg-white dark:bg-white/10 text-gray-800 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"}`}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      {tab === "connect" && <ConnectionPanel />}
      {tab === "ai" && <AIPanel />}
      {tab === "backup" && <BackupPanel />}
      {tab === "export" && <ExportPanel />}
    </motion.div>
  );
}
