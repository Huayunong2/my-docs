import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  Bot,
  DatabaseBackup,
  Palette,
  Plug,
  Settings,
  SlidersHorizontal,
  Search,
  X,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AIPanel from "./settings/AIPanel";
import ConnectionPanel from "./settings/ConnectionPanel";
import DataSafetyPanel from "./settings/DataSafetyPanel";
import ReviewSettingsPanel from "./settings/ReviewSettingsPanel";
import { useConfirmDialog } from "./ui/Feedback";
import WorkspaceHeader from "./workspace/WorkspaceHeader";
import AppearancePanel from "./settings/AppearancePanel";
import {
  readLocalStorage,
  readSessionStorage,
  removeSessionStorage,
  writeLocalStorage,
} from "../lib/storage";
import { type ThemeMode } from "../lib/theme";

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

export default function SettingsPage({
  accentTheme,
  onChangeAccentTheme,
  themeMode,
  onChangeThemeMode,
  onConnectionSaved,
}: SettingsPageProps) {
  const [search, setSearch] = useState("");
  const [verticalNav, setVerticalNav] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches,
  );
  const [tab, setTab] = useState<Tab>(() => initialSettingsTab());
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(
    () => new Set([tab]),
  );
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
  const labels: Record<Tab, string> = {
    connect: "连接服务",
    review: "复习计划",
    ai: "AI 配置",
    data: "备份与迁移",
    appearance: "外观",
  };
  const tabIcons: Record<Tab, LucideIcon> = {
    connect: Plug,
    review: SlidersHorizontal,
    ai: Bot,
    data: DatabaseBackup,
    appearance: Palette,
  };
  const descriptions: Record<Tab, string> = {
    connect: "管理服务地址与访问令牌，测试成功后再保存连接。",
    review: "设置每天的复习节奏，不改变已经记录的复习历史。",
    ai: "连接你的模型服务，按需要为不同任务配置模型。",
    data: "创建保护点、恢复数据或迁移内容，危险操作仍需确认。",
    appearance: "调整明暗模式与强调色，让阅读和操作更舒适。",
  };
  const keywords: Record<Tab, string> = {
    connect: "服务器 地址 令牌 token 网络 诊断",
    review: "FSRS 新题 队列 每天 上限 记忆",
    ai: "模型 API Key 路由 提示词",
    data: "导入 导出 恢复 备份 迁移 数据库",
    appearance: "主题 颜色 深色 浅色 系统",
  };
  const matchedTabs = settingsTabs.filter((id) =>
    `${labels[id]} ${descriptions[id]} ${keywords[id]}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setVerticalNav(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (verticalNav) return;
    const frame = requestAnimationFrame(() => {
      const selected = document.getElementById(`settings-tab-${tab}`);
      const container = selected?.parentElement;
      if (!selected || !container) return;
      const item = selected.getBoundingClientRect(),
        box = container.getBoundingClientRect();
      if (item.right > box.right)
        container.scrollLeft += item.right - box.right + 8;
      if (item.left < box.left)
        container.scrollLeft -= box.left - item.left + 8;
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, verticalNav]);
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
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      writeLocalStorage(settingsTabStorageKey, next);
    }
    requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = 0;
      document.getElementById(`settings-tab-${next}`)?.focus();
    });
  };
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: Tab,
  ) => {
    const index = settingsTabs.indexOf(current);
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      nextIndex = (index + 1) % settingsTabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      nextIndex = (index - 1 + settingsTabs.length) % settingsTabs.length;
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
      setMountedTabs((current) =>
        current.has(next) ? current : new Set(current).add(next),
      );
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
      message:
        "离开设置页会丢弃当前尚未保存的连接、复习计划或 AI 配置修改，也会关闭待确认的导入预览。已经保存的内容不会受影响。",
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
      className="st-tab-panel min-h-0 outline-hidden"
    >
      {mountedTabs.has(id) ? children : null}
    </div>
  );

  return (
    <div className="wb-page st-page">
      <WorkspaceHeader
        icon={Settings}
        title="设置"
        actions={
          <span className="st-save-summary" role="status">
            {dirtyTabs.size
              ? `${dirtyTabs.size} 个分类有未保存更改`
              : ""}
          </span>
        }
      />
      <div className="st-layout">
        <aside className="st-navigation" aria-label="设置导航">
          <label className="wb-search st-search">
            <Search size={15} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="查找设置…"
              aria-label="查找设置"
            />
            {search && (
              <button
                type="button"
                className="wb-icon-button"
                aria-label="清除设置搜索"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </label>
          {search.trim() ? (
            <div className="st-search-results" aria-label="设置搜索结果">
              <p className="wb-eyebrow">{matchedTabs.length} 个相关分类</p>
              {matchedTabs.map((id) => {
                const Icon = tabIcons[id];
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => {
                      setSearch("");
                      switchTab(id);
                    }}
                  >
                    <Icon size={17} />
                    <span>
                      {labels[id]}
                      <small>{descriptions[id]}</small>
                    </span>
                  </button>
                );
              })}
              {!matchedTabs.length && (
                <p className="wb-muted">
                  没有匹配的设置。试试“模型”“备份”或“主题”。
                </p>
              )}
            </div>
          ) : null}
          <div
            className="st-nav-tabs"
            role="tablist"
            aria-orientation={verticalNav ? "vertical" : "horizontal"}
            aria-label="设置分类"
          >
            {settingsTabs.map((id) => {
              const Icon = tabIcons[id];
              return (
                <button
                  key={id}
                  type="button"
                  id={`settings-tab-${id}`}
                  role="tab"
                  aria-selected={tab === id}
                  aria-label={
                    labels[id] + (dirtyTabs.has(id) ? "（有未保存更改）" : "")
                  }
                  aria-controls={`settings-panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => switchTab(id)}
                  onKeyDown={(event) => handleTabKeyDown(event, id)}
                >
                  <Icon size={17} />
                  <span>{labels[id]}</span>
                  {dirtyTabs.has(id) && <i aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="st-nav-foot">
            <ShieldCheck size={17} />
            <p>
              数据保存在你的服务端。
              <br />
              连接与外观偏好保存在本机。
            </p>
          </div>
        </aside>
        <section className="st-main">
          <header className="st-category-heading">
            <span className="wb-eyebrow">偏好与配置</span>
            <h2>{labels[tab]}</h2>
            <p>{descriptions[tab]}</p>
          </header>
          <div ref={contentRef} className="st-content">
            {panel(
              "connect",
              <ConnectionPanel
                onConnectionSaved={onConnectionSaved}
                onDirtyChange={(dirty) => markDirty("connect", dirty)}
              />,
            )}
            {panel(
              "review",
              <ReviewSettingsPanel
                onDirtyChange={(dirty) => markDirty("review", dirty)}
              />,
            )}
            {panel(
              "ai",
              <AIPanel onDirtyChange={(dirty) => markDirty("ai", dirty)} />,
            )}
            {panel(
              "data",
              <DataSafetyPanel
                onDirtyChange={(dirty) => markDirty("data", dirty)}
              />,
            )}
            {panel(
              "appearance",
              <AppearancePanel
                accentTheme={accentTheme}
                onChangeAccentTheme={onChangeAccentTheme}
                themeMode={themeMode}
                onChangeThemeMode={onChangeThemeMode}
              />,
            )}
          </div>
        </section>
      </div>
      {dialog}
    </div>
  );
}
