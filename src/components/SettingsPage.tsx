import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bot, DatabaseBackup, Download, Palette, Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AIPanel from "./settings/AIPanel";
import ConnectionPanel from "./settings/ConnectionPanel";
import BackupPanel from "./settings/BackupPanel";
import ExportPanel from "./settings/ExportPanel";

type Tab = "connect" | "ai" | "backup" | "export" | "appearance";

interface SettingsPageProps {
  accentTheme: string;
  onChangeAccentTheme: (theme: string) => void;
}

const THEMES = [
  { id: "", name: "靛蓝", color: "#6366f1" },
  { id: "violet", name: "紫罗兰", color: "#8b5cf6" },
  { id: "blue", name: "天蓝", color: "#3b82f6" },
  { id: "emerald", name: "翡翠", color: "#10b981" },
  { id: "rose", name: "玫瑰", color: "#f43f5e" },
  { id: "cyan", name: "青色", color: "#06b6d4" },
];

export default function SettingsPage({ accentTheme, onChangeAccentTheme }: SettingsPageProps) {
  const [tab, setTab] = useState<Tab>("connect");
  const contentRef = useRef<HTMLDivElement>(null);
  const labels: Record<Tab, string> = { connect: "连接", ai: "AI", backup: "备份", export: "导出", appearance: "外观" };
  const icons: Record<Tab, LucideIcon> = { connect: Plug, ai: Bot, backup: DatabaseBackup, export: Download, appearance: Palette };
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
                  className={`inline-flex h-10 min-w-[74px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-all duration-200 ${tab === id ? "bg-white dark:bg-white/10 text-gray-800 dark:text-gray-100 shadow-xs" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"}`}
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
        {tab === "appearance" && (
          <div className="ui-panel p-5">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">主题色</h3>
            <p className="mt-1 text-xs leading-5 text-gray-400 dark:text-gray-500">选择应用的强调色，即时生效并自动保存</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {THEMES.map((t) => (
                <button
                  key={t.id || "default"}
                  onClick={() => onChangeAccentTheme(t.id)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-all ${accentTheme === t.id ? "border-accent bg-accent-light shadow-xs" : "border-gray-200 hover:border-gray-300 dark:border-white/10 dark:hover:border-white/20"}`}
                >
                  <span className="h-5 w-5 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
