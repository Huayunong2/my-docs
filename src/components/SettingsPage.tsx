import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bot, DatabaseBackup, Download, Monitor, Moon, Palette, Plug, Settings, SlidersHorizontal, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ThemeMode } from "../App";
import AIPanel from "./settings/AIPanel";
import ConnectionPanel from "./settings/ConnectionPanel";
import BackupPanel from "./settings/BackupPanel";
import ExportPanel from "./settings/ExportPanel";
import ReviewSettingsPanel from "./settings/ReviewSettingsPanel";
import PageHeader from "./ui/PageHeader";
import { readSessionStorage, removeSessionStorage } from "../lib/storage";

type Tab = "connect" | "review" | "ai" | "backup" | "export" | "appearance";

const settingsTabStorageKey = "daily-summary-settings-tab";
const settingsTabs: Tab[] = ["connect", "review", "ai", "backup", "export", "appearance"];

function initialSettingsTab(): Tab {
  if (typeof window === "undefined") return "connect";
  const requested = readSessionStorage(settingsTabStorageKey);
  if (requested && settingsTabs.includes(requested as Tab)) {
    removeSessionStorage(settingsTabStorageKey);
    return requested as Tab;
  }
  return "connect";
}

interface SettingsPageProps {
  accentTheme: string;
  onChangeAccentTheme: (theme: string) => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
}

const THEMES = [
  { id: "", name: "靛蓝", color: "#6366f1" },
  { id: "violet", name: "浆果紫", color: "#8a5f78" },
  { id: "blue", name: "铁蓝", color: "#2e7180" },
  { id: "emerald", name: "苔绿", color: "#2f896b" },
  { id: "rose", name: "赭红", color: "#a85d56" },
  { id: "cyan", name: "青铜青", color: "#187e82" },
];

export default function SettingsPage({ accentTheme, onChangeAccentTheme, themeMode, onChangeThemeMode }: SettingsPageProps) {
  const [tab, setTab] = useState<Tab>(initialSettingsTab);
  const contentRef = useRef<HTMLDivElement>(null);
  const labels: Record<Tab, string> = { connect: "连接", review: "复习", ai: "AI", backup: "备份", export: "导出", appearance: "外观" };
  const icons: Record<Tab, LucideIcon> = { connect: Plug, review: SlidersHorizontal, ai: Bot, backup: DatabaseBackup, export: Download, appearance: Palette };
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
      className="page-surface page-surface-settings flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="settings-header ui-soft-divider shrink-0 border-b px-3 pb-3 pt-4 sm:px-4 md:px-8 md:pb-5 md:pt-6">
        <PageHeader icon={Settings} title="设置" description="连接服务、复习计划、AI、备份与外观偏好" className="mb-4" />
        <div className="settings-tabs ui-segment grid w-full grid-cols-3 gap-1 sm:flex sm:w-fit sm:overflow-visible">
          {(Object.keys(labels) as Tab[]).map((id) => (
            (() => {
              const Icon = icons[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => switchTab(id)}
                  className={`ui-segment-item h-11 min-w-0 w-full shrink-0 whitespace-nowrap px-2 sm:h-10 sm:min-w-[74px] sm:w-auto ${tab === id ? "ui-segment-item-active" : ""}`}
                >
                  <Icon size={15} />
                  {labels[id]}
                </button>
              );
            })()
          ))}
        </div>
      </div>
      <div ref={contentRef} className="settings-content min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 md:px-8 md:py-6">
        {tab === "connect" && <ConnectionPanel />}
        {tab === "review" && <ReviewSettingsPanel />}
        {tab === "ai" && <AIPanel />}
        {tab === "backup" && <BackupPanel />}
        {tab === "export" && <ExportPanel />}
        {tab === "appearance" && (
          <div className="grid w-full max-w-3xl gap-4">
            <div className="ui-panel p-5">
              <h3 className="text-sm font-semibold text-[var(--ui-text)]">显示模式</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-subtle)]">选择跟随系统、浅色或深色，偏好会保存在当前设备。</p>
              <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="显示模式">
                {([
                  ["system", "跟随系统", Monitor],
                  ["light", "浅色", Sun],
                  ["dark", "深色", Moon],
                ] as const).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onChangeThemeMode(id)}
                    aria-pressed={themeMode === id}
                    className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition-colors ${themeMode === id ? "ui-status-accent shadow-xs" : "ui-theme-choice"}`}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ui-panel p-5">
              <h3 className="text-sm font-semibold text-[var(--ui-text)]">主题色</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-subtle)]">选择应用的强调色，即时生效并自动保存</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {THEMES.map((t) => (
                  <button
                    key={t.id || "default"}
                    type="button"
                    onClick={() => onChangeAccentTheme(t.id)}
                    aria-pressed={accentTheme === t.id}
                    className={`ui-theme-choice flex items-center gap-2 rounded-xl px-3 py-2 transition-all ${accentTheme === t.id ? "ui-theme-choice-active" : ""}`}
                  >
                    <span className="h-5 w-5 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="text-sm font-medium text-[var(--ui-text)]">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
