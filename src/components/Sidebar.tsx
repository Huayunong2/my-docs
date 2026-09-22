import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RadioItem, ItemIndicator } from "@radix-ui/react-dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
} from "./ui/dropdown-menu";
import {
  navigationIndex,
  shortcutForPage,
  isInteractionBlocked,
} from "../lib/navigationInteractions";
import "./workspace/sidebar.css";
import * as Dialog from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  BookMarked,
  BookOpenText,
  Brain,
  CalendarDays,
  ChevronRight,
  ChevronsUpDown,
  Check,
  Keyboard,
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
  type LucideIcon,
} from "lucide-react";
import type { Page } from "../App";
import { readLocalStorage, writeLocalStorage } from "../lib/storage";
import { themeModeLabels, themeModes, type ThemeMode } from "../lib/theme";
import "./workspace/final-ui.css";

type NavItem = { id: Page; label: string; icon: LucideIcon };
const primary: NavItem[] = [
  { id: "today", label: "今日", icon: NotebookPen },
  { id: "history", label: "记录", icon: CalendarDays },
  { id: "knowledge", label: "知识", icon: BookMarked },
];
const learning: NavItem[] = [
  { id: "review", label: "复习", icon: Brain },
  { id: "reviews", label: "复盘", icon: BookOpenText },
  { id: "stats", label: "统计", icon: BarChart3 },
];
const utilities: NavItem[] = [
  { id: "search", label: "搜索", icon: Search },
  { id: "settings", label: "设置", icon: Settings },
];
const mobilePrimary = [primary[0], primary[2], learning[0], learning[1]];
const mobileMore = [primary[1], learning[2], ...utilities];
const themeIcons = { system: Monitor, light: Sun, dark: Moon };
interface SidebarProps {
  page: Page;
  onPrefetch: (page: Page) => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
  dark: boolean;
  onToggleDark: () => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
  dueCount?: number | null;
}

export default function Sidebar(p: SidebarProps) {
  const [collapsed, setCollapsed] = useState(
    () => readLocalStorage("sidebar-collapsed") === "1",
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [hint, setHint] = useState<{
    key: string;
    label: string;
    top: number;
    left: number;
  } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hideHint = useCallback(() => {
    clearTimeout(hintTimer.current);
    setHint(null);
  }, []);
  const showHint = (target: HTMLElement, item: NavItem, immediate = false) => {
    hideHint();
    if (!collapsed) return;
    const { right, top, height } = target.getBoundingClientRect();
    hintTimer.current = setTimeout(
      () =>
        setHint({
          key: item.id,
          label: item.label,
          top: Math.min(innerHeight - 52, Math.max(8, top + height / 2 - 20)),
          left: right + 14,
        }),
      immediate ? 0 : 220,
    );
  };
  useEffect(() => {
    hideHint();
    window.addEventListener("resize", hideHint);
    document.addEventListener("scroll", hideHint, true);
    return () => {
      clearTimeout(hintTimer.current);
      window.removeEventListener("resize", hideHint);
      document.removeEventListener("scroll", hideHint, true);
    };
  }, [collapsed, p.page, hideHint]);
  const navigateWithKeys = (event: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    )
      return;
    const links = Array.from(
      event.currentTarget
        .closest("aside")
        ?.querySelectorAll<HTMLAnchorElement>("a.shell-nav-link") || [],
    );
    const next = navigationIndex(
      event.key,
      links.indexOf(event.currentTarget),
      links.length,
    );
    if (next === null) return;
    event.preventDefault();
    links[next]?.focus();
  };
  const toggle = useCallback(
    () =>
      setCollapsed((value) => {
        writeLocalStorage("sidebar-collapsed", value ? "0" : "1");
        return !value;
      }),
    [],
  );
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        isInteractionBlocked(event) ||
        !!document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        ) ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "b"
      )
        return;
      if (
        (event.target instanceof Element ? event.target : null)?.closest(
          'input,textarea,[contenteditable="true"],[role="dialog"],.cm-editor',
        )
      )
        return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [toggle]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => {
      if (media.matches) setMoreOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const badge = (id: Page) =>
    id === "review" && typeof p.dueCount === "number" && p.dueCount > 0 ? (
      <span
        className="shell-badge"
        aria-label={`今日可复习 ${p.dueCount} 道题`}
      >
        {p.dueCount > 99 ? "99+" : p.dueCount}
      </span>
    ) : null;
  const navLink = (item: NavItem, mobile = false) => (
    <Link
      key={item.id}
      to={`/${item.id}` as never}
      search={{} as never}
      onPointerEnter={(event) => {
        p.onPrefetch(item.id);
        if (!mobile && event.pointerType !== "touch")
          showHint(event.currentTarget, item);
      }}
      onPointerLeave={hideHint}
      onBlur={hideHint}
      onClick={hideHint}
      onFocus={(event) => {
        p.onPrefetch(item.id);
        if (!mobile) showHint(event.currentTarget, item, true);
      }}
      onKeyDown={mobile ? undefined : navigateWithKeys}
      aria-current={p.page === item.id ? "page" : undefined}
      aria-label={item.label}
      aria-describedby={
        !mobile && collapsed && hint?.key === item.id
          ? "sidebar-navigation-hint"
          : undefined
      }
      className={mobile ? "shell-mobile-link" : "shell-nav-link"}
    >
      <span className="sb-nav-icon">
        <item.icon size={mobile ? 20 : 18} strokeWidth={1.8} />
      </span>
      <span className="shell-nav-label">{item.label}</span>
      {badge(item.id)}
      {!mobile && shortcutForPage[item.id] && (
        <kbd className="sb-nav-shortcut" aria-hidden="true">
          {mac ? "⌘" : "Ctrl"} {shortcutForPage[item.id]}
        </kbd>
      )}
    </Link>
  );
  const ThemeIcon = themeIcons[p.themeMode];
  return (
    <>
      <aside
        className="shell-sidebar sb-refined"
        data-collapsed={collapsed}
        aria-label="侧边栏"
      >
        <div className="shell-brand">
          <Link to="/today" search={{} as never} aria-label="今日记录">
            <span className="shell-logo">
              <FileText size={18} />
            </span>
            <strong>每日总结</strong>
          </Link>
          <button
            type="button"
            className="shell-icon"
            onClick={toggle}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!collapsed}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
        </div>
        <button
          type="button"
          className="shell-command"
          onClick={p.onOpenPalette}
          aria-label="打开快速跳转"
          aria-keyshortcuts="Control+K Meta+K"
          title="快速跳转"
        >
          <Search size={16} />
          <span>快速跳转</span>
          <kbd>{mac ? "⌘ K" : "Ctrl K"}</kbd>
        </button>
        <nav className="shell-navigation" aria-label="侧边导航">
          <div>
            <span className="shell-group-label">工作空间</span>
            {[...primary, utilities[0]].map((item) => navLink(item))}
          </div>
          <div className="shell-nav-group">
            <span className="shell-group-label">回顾与分析</span>
            {learning.map((item) => navLink(item))}
          </div>
        </nav>
        <div className="shell-footer">
          <div className="sb-settings-row">
            {navLink(utilities[1])}
            <button
              type="button"
              className="shell-icon sb-help-button"
              onClick={p.onOpenShortcuts}
              aria-label="查看快捷键"
              title="快捷键（?）"
            >
              <Keyboard size={17} />
            </button>
          </div>
          <div className="sb-appearance-row">
            <button
              type="button"
              className="shell-nav-link sb-theme-toggle"
              onClick={p.onToggleDark}
              aria-label={p.dark ? "切换到浅色模式" : "切换到深色模式"}
              title={p.dark ? "切换到浅色模式" : "切换到深色模式"}
            >
              <span className="sb-nav-icon">
                <ThemeIcon size={18} strokeWidth={1.8} />
              </span>
              <span className="shell-nav-label">
                {p.themeMode === "system" ? themeModeLabels[p.themeMode] : `${themeModeLabels[p.themeMode]}模式`}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="shell-icon sb-appearance-trigger"
                  aria-label="选择显示模式"
                  title="显示模式"
                >
                  <ChevronsUpDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="end"
                sideOffset={10}
                className="sb-display-menu"
              >
                <DropdownMenuLabel>显示模式</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={p.themeMode}
                  onValueChange={(value) =>
                    p.onChangeThemeMode(value as ThemeMode)
                  }
                >
                  {themeModes.map((mode) => {
                    const Icon = themeIcons[mode];
                    return (
                      <RadioItem
                        key={mode}
                        value={mode}
                        className="sb-radio-item"
                      >
                        <Icon size={16} />
                        <span>{themeModeLabels[mode]}</span>
                        <ItemIndicator>
                          <Check size={14} />
                        </ItemIndicator>
                      </RadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>
      {hint &&
        collapsed &&
        createPortal(
          <div
            id="sidebar-navigation-hint"
            role="tooltip"
            className="sb-tooltip"
            style={{ top: hint.top, left: hint.left }}
          >
            <span>{hint.label}</span>
            {shortcutForPage[hint.key as Page] && (
              <kbd>
                {mac ? "⌘" : "Ctrl"} {shortcutForPage[hint.key as Page]}
              </kbd>
            )}
          </div>,
          document.body,
        )}
      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <nav className="shell-mobile-nav" aria-label="主导航">
          {mobilePrimary.map((item) => navLink(item, true))}
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="shell-mobile-link"
              data-active={mobileMore.some((item) => item.id === p.page)}
              aria-label="打开更多入口"
            >
              <MoreHorizontal size={20} />
              <span>更多</span>
            </button>
          </Dialog.Trigger>
        </nav>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-[70]" />
          <Dialog.Content className="shell-more-dialog">
            <header>
              <Dialog.Title>更多</Dialog.Title>
              <Dialog.Close asChild>
                <button className="shell-icon" aria-label="关闭更多入口">
                  <X size={19} />
                </button>
              </Dialog.Close>
            </header>
            <Dialog.Description className="sr-only">
              页面导航与显示模式
            </Dialog.Description>
            <nav aria-label="更多页面">
              {mobileMore.map((item) => (
                <Link
                  key={item.id}
                  to={`/${item.id}` as never}
                  search={{} as never}
                  aria-current={p.page === item.id ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                >
                  <item.icon size={19} />
                  <span>{item.label}</span>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </nav>
            <div
              className="shell-theme-options"
              role="group"
              aria-label="显示模式"
            >
              {themeModes.map((mode) => {
                const Icon = themeIcons[mode];
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={p.themeMode === mode}
                    onClick={() => p.onChangeThemeMode(mode)}
                  >
                    <Icon size={16} />
                    {themeModeLabels[mode]}
                  </button>
                );
              })}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
