import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useBlocker } from "@tanstack/react-router";
import { Bot, DatabaseBackup, Monitor, Moon, Palette, Plug, Settings, SlidersHorizontal, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AIPanel from "./settings/AIPanel";
import ConnectionPanel from "./settings/ConnectionPanel";
import DataSafetyPanel from "./settings/DataSafetyPanel";
import ReviewSettingsPanel from "./settings/ReviewSettingsPanel";
import { useConfirmDialog } from "./ui/Feedback";
import PageHeader from "./ui/PageHeader";
import { readLocalStorage, readSessionStorage, removeSessionStorage, writeLocalStorage } from "../lib/storage";
import { themeModeLabels, themeModes, type ThemeMode } from "../lib/theme";

type Tab = "connect" | "review" | "ai" | "data" | "appearance";

const settingsTabStorageKey = "daily-summary-settings-tab";
const settingsTabs: Tab[] = ["connect", "review", "ai", "data", "appearance"];
const tabAliases: Record<string, Tab> = {
  connect: "connect",
  review: "review",
  ai: "ai",
  backup: "data",
  export: "data",
  data: "data",
  appearance: "appearance",
};

function initialSettingsTab(): Tab {
  if (typeof window === "undefined") return "connect";
  const fromUrl = new URLSearchParams(window.location.search).get("tab");
  if (fromUrl && tabAliases[fromUrl]) return tabAliases[fromUrl];
  const requested = readSessionStorage(settingsTabStorageKey);
  if (requested && tabAliases[requested]) {
    removeSessionStorage(settingsTabStorageKey);
    return tabAliases[requested];
  }
  const preferred = readLocalStorage(settingsTabStorageKey);
  if (preferred && tabAliases[preferred]) return tabAliases[preferred];
  return "connect";
}

interface SettingsPageProps {
  accentTheme: string;
  onChangeAccentTheme: (theme: string) => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
  onConnectionSaved?: (message?: string) => void;
}

const THEMES = [
  { id: "", name: "靛蓝", color: "#6366f1" },
  { id: "violet", name: "紫罗兰", color: "#8b5cf6" },
  { id: "blue", name: "晴蓝", color: "#3b82f6" },
  { id: "emerald", name: "翡翠绿", color: "#10b981" },
  { id: "rose", name: "玫瑰红", color: "#f43f5e" },
  { id: "cyan", name: "青色", color: "#06b6d4" },
];

const themeIcons: Record<ThemeMode, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export default function SettingsPage({ accentTheme, onChangeAccentTheme, themeMode, onChangeThemeMode, onConnectionSaved }: SettingsPageProps) {
  const [tab, setTab] = useState<Tab>(() => initialSettingsTab());
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(() => new Set([tab]));
  const [dirtyTabs, setDirtyTabs] = useState<Set<Tab>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);
  const { confirm, dialog } = useConfirmDialog();
  const markDirty = useCallback((id: Tab, dirty: boolean) => {
    setDirtyTabs((current) => {
      if (dirty) {
        if (current.has(id)) return current;
        return new Set(current).add(id);
      }
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);
  const labels: Record<Tab, string> = { connect: "连接服务", review: "复习计划", ai: "AI 配置", data: "备份与迁移", appearance: "外观" };
  const tabIcons: Record<Tab, LucideIcon> = { connect: Plug, review: SlidersHorizontal, ai: Bot, data: DatabaseBackup, appearance: Palette };
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setMountedTabs((current) => {
      if (current.has(next)) return current;
      return new Set(current).add(next);
    });
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      writeLocalStorage(settingsTabStorageKey, next);
    }
    requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = 0;
      document.getElementById(`settings-tab-${next}`)?.focus();
    });
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: Tab) => {
    const index = settingsTabs.indexOf(current);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % settingsTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + settingsTabs.length) % settingsTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = settingsTabs.length - 1;
    if (nextIndex === index) return;
    event.preventDefault();
    const next = settingsTabs[nextIndex];
    switchTab(next);
  };

  useEffect(() => {
    const handlePopState = () => {
      const requested = new URLSearchParams(window.location.search).get("tab");
      const next = requested && tabAliases[requested];
      if (!next || next === tab) return;
      setTab(next);
      setMountedTabs((current) => current.has(next) ? current : new Set(current).add(next));
      requestAnimationFrame(() => {
        if (contentRef.current) contentRef.current.scrollTop = 0;
        document.getElementById("settings-tab-" + next)?.focus();
      });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [tab]);

  const shouldBlockSettings = useCallback(async () => {
    if (!dirtyTabs.size) return false;
    const shouldLeave = await confirm({
      title: "放弃未保存的设置？",
      message: "离开设置页会丢弃当前尚未保存的连接、复习计划或 AI 配置修改，也会关闭待确认的导入预览。已经保存的内容不会受影响。",
      confirmText: "放弃并离开",
      danger: true,
    });
    return !shouldLeave;
  }, [confirm, dirtyTabs.size]);

  useBlocker({
    shouldBlockFn: shouldBlockSettings,
    enableBeforeUnload: dirtyTabs.size > 0,
    disabled: dirtyTabs.size === 0,
  });

  const panel = (id: Tab, children: ReactNode) => (
    <div
      id={`settings-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`settings-tab-${id}`}
      tabIndex={-1}
      hidden={tab !== id}
      className="min-h-0 outline-hidden"
    >
      {mountedTabs.has(id) ? children : null}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-surface page-surface-settings settings-page flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="settings-header ui-soft-divider shrink-0 border-b px-3 pb-3 pt-4 sm:px-4 md:px-8 md:pb-5 md:pt-6">
        <div className="settings-header-inner">
          <PageHeader icon={Settings} title="设置" description="连接、复习、AI、备份与迁移、外观" className="mb-4" />
          <div className="settings-tabs ui-segment flex w-full min-w-0 gap-1 overflow-x-auto p-0.5 sm:w-fit sm:overflow-visible" role="tablist" aria-orientation="horizontal" aria-label="设置分类">
            {settingsTabs.map((id) => {
              const Icon = tabIcons[id];
              return (
                <button
                  key={id}
                  id={`settings-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-label={labels[id] + (dirtyTabs.has(id) ? "（有未保存更改）" : "")}
                  aria-controls={`settings-panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => switchTab(id)}
                  onKeyDown={(event) => handleTabKeyDown(event, id)}
                  className={[
                    "ui-segment-item h-11 min-w-max w-auto shrink-0 whitespace-nowrap px-3 sm:h-10 sm:min-w-[88px]",
                    tab === id ? "ui-segment-item-active" : "",
                  ].join(" ")}
                >
                    <Icon size={15} aria-hidden="true" />
                    {labels[id]}
                    {dirtyTabs.has(id) && <span className="h-1.5 w-1.5 rounded-full bg-[var(--ui-warning-text)]" aria-hidden="true" />}
                  </button>
              );
            })}
          </div>
        </div>
      </div>
      <div ref={contentRef} className="settings-content min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 md:px-8 md:py-6">
        <div className="settings-content-inner">
          {panel("connect", <ConnectionPanel onConnectionSaved={onConnectionSaved} onDirtyChange={(dirty) => markDirty("connect", dirty)} />)}
          {panel("review", <ReviewSettingsPanel onDirtyChange={(dirty) => markDirty("review", dirty)} />)}
          {panel("ai", <AIPanel onDirtyChange={(dirty) => markDirty("ai", dirty)} />)}
          {panel("data", <DataSafetyPanel onDirtyChange={(dirty) => markDirty("data", dirty)} />)}
          {panel("appearance", (
            <div className="settings-appearance-grid grid w-full gap-4">
            <div className="ui-panel p-5">
              <h3 className="text-sm font-semibold text-[var(--ui-text)]">显示模式</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-subtle)]">选择跟随系统、浅色或深色，偏好会保存在当前设备。</p>
              <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="显示模式">
                {themeModes.map((id) => {
                  const Icon = themeIcons[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onChangeThemeMode(id)}
                      aria-pressed={themeMode === id}
                      className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition-colors ${themeMode === id ? "ui-status-accent shadow-xs" : "ui-theme-choice"}`}
                    >
                      <Icon size={15} /> {themeModeLabels[id]}
                    </button>
                  );
                })}
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
          ))}
        </div>
      </div>
      {dialog}
    </motion.div>
  );
}
