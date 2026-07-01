import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bot, DatabaseBackup, Download, Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AIPanel from "./settings/AIPanel";
import ConnectionPanel from "./settings/ConnectionPanel";
import BackupPanel from "./settings/BackupPanel";
import ExportPanel from "./settings/ExportPanel";

type Tab = "connect" | "ai" | "backup" | "export";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("connect");
  const contentRef = useRef<HTMLDivElement>(null);
  const labels: Record<Tab, string> = { connect: "连接", ai: "AI", backup: "备份", export: "导出" };
  const icons: Record<Tab, LucideIcon> = { connect: Plug, ai: Bot, backup: DatabaseBackup, export: Download };
  const switchTab = (next: Tab) => {
    setTab(next);
    requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = 0;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="shrink-0 border-b border-gray-100 bg-surface px-3 pb-3 pt-[calc(env(safe-area-inset-top,0px)+1rem)] dark:border-white/10 dark:bg-surface-dark sm:px-4 md:px-8 md:pb-5 md:pt-6">
        <h2 className="mb-4 text-xl font-bold text-gray-800 dark:text-gray-100">设置</h2>
        <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1 dark:bg-white/5 sm:w-fit">
          {(Object.keys(labels) as Tab[]).map((id) => (
            (() => {
              const Icon = icons[id];
              return (
                <button
                  key={id}
                  onClick={() => switchTab(id)}
                  className={`inline-flex h-10 min-w-[74px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-all duration-200 ${tab === id ? "bg-white dark:bg-white/10 text-gray-800 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"}`}
                >
                  <Icon size={15} />
                  {labels[id]}
                </button>
              );
            })()
          ))}
        </div>
      </div>
      <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 md:px-8 md:py-6">
        {tab === "connect" && <ConnectionPanel />}
        {tab === "ai" && <AIPanel />}
        {tab === "backup" && <BackupPanel />}
        {tab === "export" && <ExportPanel />}
      </div>
    </motion.div>
  );
}
