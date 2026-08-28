import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  ArrowUpRight,
  BarChart3,
  BookMarked,
  BookOpenText,
  Brain,
  CalendarDays,
  ChevronDown,
  FileText,
  MoreHorizontal,
  Monitor,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Page } from "../App";
import { readLocalStorage, writeLocalStorage } from "../lib/storage";
import { themeModeLabels, themeModes, type ThemeMode } from "../lib/theme";

type NavItem = { id: Page; label: string; icon: LucideIcon; description?: string };

function pathForPage(page: Page) {
  return page === "knowledge" ? "/knowledge" : `/${page}`;
}

const desktopNavGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "工作台",
    items: [
      { id: "today", label: "今日", icon: NotebookPen },
      { id: "knowledge", label: "知识", icon: BookMarked },
    ],
  },
  {
    label: "复习与洞察",
    items: [
      { id: "review", label: "复习", icon: Brain },
      { id: "stats", label: "统计", icon: BarChart3 },
      { id: "reviews", label: "复盘", icon: BookOpenText },
    ],
  },
  {
    label: "资料",
    items: [
      { id: "history", label: "历史", icon: CalendarDays },
      { id: "archive", label: "归档", icon: Archive },
      { id: "search", label: "搜索", icon: Search },
    ],
  },
  {
    label: "系统",
    items: [{ id: "settings", label: "设置", icon: Settings }],
  },
];

const mobilePrimaryNav: NavItem[] = [
  { id: "today", label: "今日", icon: NotebookPen, description: "写下今天" },
  { id: "knowledge", label: "知识", icon: BookMarked, description: "整理卡片" },
  { id: "review", label: "复习", icon: Brain, description: "保持记忆" },
  { id: "stats", label: "统计", icon: BarChart3, description: "回看节奏" },
];

const mobileMoreNav: NavItem[] = [
  { id: "history", label: "历史", icon: CalendarDays, description: "浏览每日记录" },
  { id: "archive", label: "归档", icon: Archive, description: "管理归档内容" },
  { id: "search", label: "搜索", icon: Search, description: "搜索记录和卡片" },
  { id: "reviews", label: "复盘", icon: BookOpenText, description: "查看 AI 复盘" },
  { id: "settings", label: "设置", icon: Settings, description: "连接与外观" },
];

const themeIcons: Record<ThemeMode, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

interface SidebarProps {
  page: Page;
  onPrefetch: (p: Page) => void;
  onOpenPalette: () => void;
  dark: boolean;
  onToggleDark: () => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
  dueCount?: number | null;
}

export default function Sidebar({ page, onPrefetch, onOpenPalette, dark, onToggleDark, themeMode, onChangeThemeMode, dueCount }: SidebarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && readLocalStorage("sidebar-collapsed") === "1");
  const secondaryActive = mobileMoreNav.some((item) => item.id === page);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      writeLocalStorage("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [toggleCollapsed]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={[
          "ui-sidebar-shell hidden h-full shrink-0 select-none flex-col transition-[width] duration-300 md:flex",
          collapsed ? "w-[76px] min-w-[76px]" : "w-[224px] min-w-[224px]",
        ].join(" ")}
      >
        <DesktopSidebar
          page={page}
          onPrefetch={onPrefetch}
          dark={dark}
          onToggleDark={onToggleDark}
          themeMode={themeMode}
          onChangeThemeMode={onChangeThemeMode}
          onOpenPalette={onOpenPalette}
          dueCount={dueCount}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      </aside>

      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        {/* Mobile bottom navigation: keep primary tasks visible and move maintenance pages into More. */}
        <nav
          aria-label="主导航"
          className="ui-mobile-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 px-2 pt-1.5 backdrop-blur-xl safe-bottom md:hidden"
        >
          {mobilePrimaryNav.map((item) => (
            <MobileNavButton
              key={item.id}
              item={item}
              active={page === item.id}
              onPrefetch={() => onPrefetch(item.id)}
              badge={item.id === "review" && typeof dueCount === "number" ? dueCount : undefined}
            />
          ))}
          <Dialog.Trigger asChild>
            <button
              type="button"
              className={[
                "relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium transition-all active:scale-95",
                secondaryActive ? "ui-mobile-nav-item-active" : "ui-mobile-nav-item",
              ].join(" ")}
              aria-label="打开更多入口"
            >
              <MoreHorizontal size={19} strokeWidth={secondaryActive ? 2.35 : 2} />
              <span>更多</span>
              {secondaryActive && <span className="absolute left-1/2 top-1 h-0.5 w-4 -translate-x-1/2 rounded-full bg-[var(--ui-accent-solid)]/80" />}
            </button>
          </Dialog.Trigger>
        </nav>

        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-[70] backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
          <Dialog.Content className="ui-modal-surface fixed inset-x-0 bottom-0 z-[71] max-h-[min(94dvh,640px)] overflow-y-auto rounded-t-2xl border-t px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] outline-hidden data-[state=open]:animate-slide-up">
            <div className="ui-sheet-grabber mx-auto mt-2 h-1 w-10 rounded-full" aria-hidden="true" />
            <div className="flex items-start justify-between gap-4 py-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-[var(--ui-text)]">更多入口</Dialog.Title>
                <Dialog.Description className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
                  低频页面和外观设置集中在这里，主导航保持清爽。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="ui-icon-button h-9 w-9" aria-label="关闭更多入口">
                  <X size={17} />
                </button>
              </Dialog.Close>
            </div>
            <nav aria-label="更多页面" className="grid gap-2 sm:grid-cols-2">
              {mobileMoreNav.map((item) => (
                <MobileMoreButton
                  key={item.id}
                  item={item}
                  active={page === item.id}
                  onClick={() => setMoreOpen(false)}
                  onPrefetch={() => onPrefetch(item.id)}
                />
              ))}
            </nav>
            <div className="ui-sidebar-divider mt-4 border-t pt-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="ui-section-kicker">显示模式</span>
                <span className="text-[11px] text-[var(--ui-text-muted)]">{themeModeLabels[themeMode]}</span>
              </div>
              <div className="ui-mobile-theme-switcher grid grid-cols-3 gap-1 rounded-xl p-1" role="group" aria-label="显示模式">
                {themeModes.map((mode) => {
                  const Icon = themeIcons[mode];
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onChangeThemeMode(mode)}
                      aria-pressed={themeMode === mode}
                      className={["ui-mobile-theme-option flex min-h-10 items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-semibold transition-colors", themeMode === mode ? "ui-theme-choice-active" : "ui-theme-choice"].join(" ")}
                    >
                      <Icon size={14} aria-hidden="true" />
                      <span>{themeModeLabels[mode]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function DesktopSidebar({ page, onPrefetch, onOpenPalette, dark, onToggleDark, dueCount, collapsed, onToggleCollapse }: SidebarProps & { collapsed: boolean; onToggleCollapse: () => void }) {
  const ThemeIcon = dark ? Sun : Moon;
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = JSON.parse(readLocalStorage("sidebar-groups") || "{}");
      return stored && typeof stored === "object" ? stored as Record<string, boolean> : {};
    } catch {
      return {};
    }
  });

  const toggleGroup = (label: string) => {
    setCollapsedGroups((current) => {
      const next = { ...current, [label]: !current[label] };
      writeLocalStorage("sidebar-groups", JSON.stringify(next));
      return next;
    });
  };

  return (
    <>
      <div className={["ui-sidebar-brand ui-sidebar-divider border-b pb-4 pt-4", collapsed ? "px-3" : "px-3.5"].join(" ")}>
        <div className={collapsed ? "flex flex-col items-center gap-3" : "flex items-center gap-2.5"}>
          <Link
            to="/today"
            search={{} as never}
            className={collapsed ? "inline-flex rounded-xl" : "inline-flex min-w-0 flex-1 items-center rounded-xl"}
            aria-label="今日记录"
            title={collapsed ? "今日记录" : undefined}
          >
            <span className="ui-sidebar-logo flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--ui-accent-solid)] text-white">
              <FileText size={18} strokeWidth={2.2} />
            </span>
            {!collapsed && (
              <span className="ml-2.5 inline-flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-bold tracking-tight text-[var(--ui-text)]">每日总结</span>
                <span className="mt-0.5 truncate text-[11px] text-[var(--ui-text-subtle)]">记录 · 沉淀 · 复习</span>
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="ui-icon-button h-9 w-9"
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!collapsed}
            aria-keyshortcuts="Control+B Meta+B"
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenPalette}
          onPointerEnter={() => onPrefetch("search")}
          onFocus={() => onPrefetch("search")}
          className={[
            "mt-4 flex min-h-10 w-full items-center rounded-xl border text-sm transition-all duration-200",
            collapsed ? "justify-center border-transparent px-0" : "gap-2.5 px-3",
            "ui-sidebar-search",
          ].join(" ")}
          aria-label="打开快速跳转"
          aria-keyshortcuts="Control+K Meta+K"
          title={collapsed ? "快速跳转（Ctrl/⌘ K）" : undefined}
        >
          <Search size={16} strokeWidth={2.1} />
          {!collapsed && <span className="min-w-0 flex-1 text-left text-[13px]">快速跳转</span>}
          {!collapsed && (
            <kbd className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ui-text-subtle)]">
              ⌘K
            </kbd>
          )}
        </button>
      </div>

      <nav aria-label="侧边导航" className={["min-h-0 flex-1 overflow-y-auto pt-4", collapsed ? "space-y-4 px-2" : "space-y-5 px-3"].join(" ")}>
        {desktopNavGroups.map((group, groupIndex) => {
          const groupCollapsed = !collapsed && Boolean(collapsedGroups[group.label]);
          const visibleItems = groupCollapsed ? group.items.filter((item) => item.id === page) : group.items;
          const groupId = `sidebar-group-${groupIndex}`;
          return (
          <div key={group.label}>
            {!collapsed && (
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className="ui-sidebar-group-toggle mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[10px] font-semibold tracking-[0.1em] transition-colors"
                aria-expanded={!groupCollapsed}
                aria-controls={groupId}
              >
                <span>{group.label}</span>
                <ChevronDown size={13} className={["transition-transform duration-200", groupCollapsed ? "-rotate-90" : ""].join(" ")} aria-hidden="true" />
              </button>
            )}
            <div id={collapsed ? undefined : groupId} className={["space-y-1", groupCollapsed && visibleItems.length === 0 ? "hidden" : ""].join(" ")}>
              {visibleItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavButton
                    key={item.id}
                    active={page === item.id}
                    to={pathForPage(item.id)}
                    onPrefetch={() => onPrefetch(item.id)}
                    ariaLabel={item.label}
                    collapsed={collapsed}
                  >
                    <Icon className={collapsed ? "" : "mr-3"} size={18} strokeWidth={page === item.id ? 2.4 : 2.1} />
                    {!collapsed && item.label}
                    {item.id === "review" && typeof dueCount === "number" && (
                      <span
                        className={[
                          "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                          collapsed ? "absolute right-1 top-1" : "ml-auto",
                          dueCount > 0
                            ? "bg-[var(--ui-accent-solid)] text-white"
                            : "ui-status-muted",
                        ].join(" ")}
                        aria-label={`今日到期 ${dueCount} 张`}
                      >
                        {dueCount > 99 ? "99+" : dueCount}
                      </span>
                    )}
                  </NavButton>
                );
              })}
            </div>
          </div>
          );
        })}
      </nav>

      <div className={["ui-sidebar-divider border-t pb-4 pt-3", collapsed ? "px-2" : "px-3"].join(" ")}>
        {!collapsed && typeof dueCount === "number" && (
          <Link
            to="/review"
            search={{} as never}
            onPointerEnter={() => onPrefetch("review")}
            onFocus={() => onPrefetch("review")}
            className="ui-sidebar-review-card mb-2.5 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:shadow-xs"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ui-accent-solid)] text-white shadow-xs shadow-accent/20">
              <Brain size={16} strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-[var(--ui-text)]">复习队列</span>
              <span className="mt-0.5 block truncate text-[11px] text-[var(--ui-text-muted)]">
                {dueCount > 0 ? `${dueCount > 99 ? "99+" : dueCount} 张待复习` : "今日已清空"}
              </span>
            </span>
            <ArrowUpRight size={15} className="shrink-0 text-[var(--ui-accent-text)]/70" />
          </Link>
        )}
        <button
          type="button"
          onClick={onToggleDark}
          className={[
            "ui-sidebar-theme flex min-h-10 w-full items-center rounded-xl py-2.5 text-sm transition-colors duration-200",
            collapsed ? "justify-center px-0" : "gap-3 px-4",
          ].join(" ")}
          aria-label={dark ? "切换到浅色模式" : "切换到深色模式"}
          title={collapsed ? (dark ? "浅色模式" : "深色模式") : undefined}
        >
          <ThemeIcon size={17} strokeWidth={2.1} />
          {!collapsed && (dark ? "浅色模式" : "深色模式")}
        </button>
      </div>
    </>
  );
}

function NavButton({
  active,
  to,
  onPrefetch,
  ariaLabel,
  collapsed,
  children,
}: {
  active: boolean;
  to: string;
  onPrefetch: () => void;
  ariaLabel: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <Link
      to={to as never}
      search={{} as never}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      title={collapsed ? ariaLabel : undefined}
      className={[
        "relative flex min-h-10 w-full items-center rounded-xl py-2.5 text-sm font-medium transition-colors duration-200",
        collapsed ? "justify-center px-2" : "px-3.5",
          active ? "ui-sidebar-nav-item-active" : "ui-sidebar-nav-item",
      ].join(" ")}
    >
      {children}
      {active && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[var(--ui-accent-solid)]"
          transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
        />
      )}
    </Link>
  );
}

function MobileNavButton({
  item,
  active,
  onPrefetch,
  badge,
}: {
  item: NavItem;
  active: boolean;
  onPrefetch: () => void;
  badge?: number;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={pathForPage(item.id) as never}
      search={{} as never}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      onTouchStart={onPrefetch}
      aria-current={active ? "page" : undefined}
      className={[
        "relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium transition-all duration-200 active:scale-95",
        active ? "ui-mobile-nav-item-active" : "ui-mobile-nav-item",
      ].join(" ")}
      title={item.label}
    >
      <Icon size={19} strokeWidth={active ? 2.35 : 2} />
      <span className="max-w-full truncate leading-none">{item.label}</span>
      {badge !== undefined && (
        <span
          className={[
            "absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none shadow-xs",
            badge > 0
              ? "bg-[var(--ui-accent-solid)] text-white"
              : "ui-status-muted",
          ].join(" ")}
          aria-label={`今日到期 ${badge} 张`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {active && <span className="absolute left-1/2 top-1 h-0.5 w-4 -translate-x-1/2 rounded-full bg-[var(--ui-accent-solid)]/80" />}
    </Link>
  );
}

function MobileMoreButton({ item, active, onClick, onPrefetch }: { item: NavItem; active: boolean; onClick: () => void; onPrefetch: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={pathForPage(item.id) as never}
      search={{} as never}
      onClick={onClick}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      className={[
        "flex min-h-14 items-center gap-3 rounded-2xl border px-3 text-left transition-colors",
        active
          ? "ui-status-accent"
          : "ui-mobile-more-item",
      ].join(" ")}
    >
      <span className={[
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
        active ? "bg-[var(--ui-accent-solid)] text-white shadow-xs" : "ui-mobile-more-icon",
      ].join(" ")}>
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{item.label}</span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--ui-text-subtle)]">{item.description}</span>
      </span>
    </Link>
  );
}
