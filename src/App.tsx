import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Outlet, useLocation, useNavigate as useRouterNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import Sidebar from "./components/Sidebar";
import CommandPalette from "./components/CommandPalette";
import * as api from "./lib/api";
import { connectionReturnStorageKey, readLocalStorage, readSessionStorage, removeSessionStorage, writeLocalStorage } from "./lib/storage";
import { colorSchemeForMode, nextExplicitThemeMode, resolveDarkTheme, themeColorForMode, type ThemeMode } from "./lib/theme";

export type Page = "today" | "history" | "archive" | "search" | "stats" | "reviews" | "review" | "knowledge" | "settings";
export type { ThemeMode } from "./lib/theme";

const pageLoaders: Partial<Record<Page, () => Promise<unknown>>> = {
  today: () => import("./components/TodayPage"),
  history: () => import("./components/HistoryPage"),
  archive: () => import("./components/ArchivePage"),
  search: () => import("./components/SearchPage"),
  stats: () => import("./components/StatsPage"),
  reviews: () => import("./components/ReviewsPage"),
  review: () => import("./components/ReviewPage"),
  knowledge: () => import("./components/KnowledgePage"),
  settings: () => import("./components/SettingsPage"),
};

export function preloadPage(page: Page) {
  pageLoaders[page]?.();
}

function pageFromPath(pathname: string): Page {
  if (pathname.startsWith("/knowledge")) return "knowledge";
  const page = pathname.replace(/^\//, "") as Page;
  return ["today", "history", "archive", "search", "stats", "reviews", "review", "settings"].includes(page)
    ? page
    : "today";
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target.closest("[contenteditable='true']") !== null
    || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function titleForPath(pathname: string) {
  if (pathname === "/today" || pathname === "/") return "今日";
  if (pathname.startsWith("/knowledge/new")) return "新建卡片";
  if (pathname.startsWith("/knowledge/trash")) return "回收站";
  if (pathname.startsWith("/knowledge/")) return "知识卡片";
  const labels: Record<string, string> = {
    "/knowledge": "知识",
    "/review": "复习",
    "/stats": "统计",
    "/search": "搜索",
    "/history": "历史",
    "/archive": "归档",
    "/reviews": "复盘",
    "/settings": "设置",
  };
  return labels[pathname] || "每日总结";
}

export interface AppShellContextValue {
  navigate: (page: Page) => void;
  updateSearch: (patch: Record<string, unknown>) => void;
  openRecordDate: (date: string, returnTo?: string) => void;
  openReviewLibrary: (returnTo?: string) => void;
  openSearchTerm: (query: string) => void;
  openKnowledgeCard: (cardId: string) => void;
  openKnowledgeQuality: (quality: api.KnowledgeCardQuality) => void;
  openNewKnowledgeCard: () => void;
  backToKnowledge: () => void;
  returnFromConnectionSettings: (message?: string) => void;
  zen: boolean;
  onToggleZen: () => void;
  dark: boolean;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
  accentTheme: string;
  onChangeAccentTheme: (theme: string) => void;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell() {
  const value = useContext(AppShellContext);
  if (!value) throw new Error("useAppShell must be used inside AppShell");
  return value;
}

export function AppShell() {
  const routerNavigate = useRouterNavigate();
  const location = useLocation();
  const [zen, setZen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window !== "undefined") {
      const stored = readLocalStorage("themeMode");
      if (stored === "light" || stored === "dark" || stored === "system") return stored;
    }
    return "system";
  });
  const [systemDark, setSystemDark] = useState(() => {
    if (typeof window !== "undefined") return window.matchMedia("(prefers-color-scheme: dark)").matches;
    return false;
  });
  const [accentTheme, setAccentTheme] = useState<string>(() => {
    if (typeof window !== "undefined") return readLocalStorage("accentTheme") || "";
    return "";
  });

  const dark = resolveDarkTheme(themeMode, systemDark);

  // 侧栏「今日到期」角标：useQuery 缓存 + 每分钟自动刷新；失败时静默隐藏。
  const { data: dueCount } = useQuery({
    queryKey: ["dueCount"],
    queryFn: async () => (await api.getDueReviewCards(1)).stats.due,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (themeMode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [themeMode]);

  useEffect(() => {
    const el = document.documentElement;
    if (accentTheme) el.dataset.theme = accentTheme;
    else delete el.dataset.theme;
  }, [accentTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    const colorScheme = colorSchemeForMode(dark);
    root.style.colorScheme = colorScheme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", colorScheme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColorForMode(dark));
  }, [dark]);

  const toggleZen = useCallback(() => setZen((value) => !value), []);
  const changeThemeMode = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    if (typeof window !== "undefined") writeLocalStorage("themeMode", mode);
  }, []);
  const toggleDark = useCallback(() => changeThemeMode(nextExplicitThemeMode(dark)), [changeThemeMode, dark]);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const changeAccentTheme = useCallback((theme: string) => {
    setAccentTheme(theme);
    if (typeof window !== "undefined") writeLocalStorage("accentTheme", theme);
  }, []);

  const go = useCallback((to: string, search: Record<string, unknown> = {}, params?: Record<string, string>) => {
    void routerNavigate({
      to: to as never,
      params: params as never,
      search: search as never,
    });
  }, [routerNavigate]);

  const navigate = useCallback((nextPage: Page) => {
    preloadPage(nextPage);
    if (nextPage === "knowledge") go("/knowledge");
    else go(`/${nextPage}`);
    if (nextPage !== "today") setZen(false);
  }, [go]);

  const updateSearch = useCallback((patch: Record<string, unknown>) => {
    void routerNavigate({
      search: (previous) => {
        const next = { ...previous, ...patch };
        const previousSearch = previous as unknown as Record<string, unknown>;
        const nextSearch = next as Record<string, unknown>;
        const changed = Object.keys(patch).some((key) => previousSearch[key] !== nextSearch[key]);
        return (changed ? next : previous) as never;
      },
    });
  }, [routerNavigate]);

  const openRecordDate = useCallback((date: string, returnTo?: string) => {
    go("/today", returnTo ? { date, returnTo } : { date });
  }, [go]);

  const openReviewLibrary = useCallback((returnTo?: string) => {
    const search: Record<string, unknown> = {};
    if (returnTo && returnTo.startsWith("/") && typeof window !== "undefined") {
      try {
        const url = new URL(returnTo, window.location.origin);
        for (const key of ["q", "reviewKind", "reviewStatus"]) {
          const value = url.searchParams.get(key);
          if (value) search[key] = value;
        }
      } catch {
        // Ignore malformed return targets and open the default library view.
      }
    }
    go("/reviews", search);
  }, [go]);

  const openSearchTerm = useCallback((query: string) => {
    preloadPage("search");
    go("/search", query.trim() ? { q: query.trim() } : {});
  }, [go]);

  const openKnowledgeCard = useCallback((cardId: string) => {
    preloadPage("knowledge");
    void routerNavigate({
      to: "/knowledge/$cardId" as never,
      params: { cardId } as never,
      search: (previous) => ({
        q: previous.q,
        project: previous.project,
        tag: previous.tag,
        status: previous.status,
        type: previous.type,
        sort: previous.sort,
        usage: previous.usage,
        quality: previous.quality,
        page: previous.page,
        view: "detail",
      }) as never,
    });
  }, [routerNavigate]);

  const openKnowledgeQuality = useCallback((quality: api.KnowledgeCardQuality) => {
    preloadPage("knowledge");
    go("/knowledge", { quality, status: "all", view: "list" });
  }, [go]);

  const openNewKnowledgeCard = useCallback(() => {
    preloadPage("knowledge");
    go("/knowledge/new", { view: "detail" });
  }, [go]);

  // Keyboard shortcuts: Ctrl/Cmd+1-9 keeps the existing fast navigation workflow.
  useEffect(() => {
    const map: Record<string, Page> = {
      "1": "today", "2": "history", "3": "archive",
      "4": "search", "5": "stats", "6": "reviews",
      "7": "knowledge", "8": "settings", "9": "review",
    };
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && map[event.key]) {
        event.preventDefault();
        navigate(map[event.key]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  // Ctrl/Cmd+K 命令面板
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const loadPage of Object.values(pageLoaders)) void loadPage();
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, []);

  const backToKnowledge = useCallback(() => {
    void routerNavigate({
      to: "/knowledge" as never,
      search: (previous) => ({ ...previous, view: undefined }) as never,
    });
  }, [routerNavigate]);

  const returnFromConnectionSettings = useCallback((message?: string) => {
    if (message) toast.success(message);
    const target = readSessionStorage(connectionReturnStorageKey);
    removeSessionStorage(connectionReturnStorageKey);
    if (!target || !target.startsWith("/")) {
      return;
    }
    try {
      const url = new URL(target, window.location.origin);
      const search: Record<string, unknown> = {};
      const searchKeys = ["q", "date", "returnTo", "page", "scope", "project", "tag", "status", "type", "sort", "usage", "quality", "view", "tab"];
      for (const key of searchKeys) {
        const value = url.searchParams.get(key);
        if (!value) continue;
        search[key] = key === "page" ? Number(value) : value;
      }
      void routerNavigate({
        to: url.pathname as never,
        search: search as never,
      });
    } catch {
      go("/knowledge");
    }
  }, [go, routerNavigate]);

  const currentPage = useMemo(() => pageFromPath(location.pathname), [location.pathname]);

  useEffect(() => {
    document.title = `${titleForPath(location.pathname)} — 每日总结`;
  }, [location.pathname]);

  const contextValue: AppShellContextValue = {
    navigate,
    updateSearch,
    openRecordDate,
    openReviewLibrary,
    openSearchTerm,
    openKnowledgeCard,
    openKnowledgeQuality,
    openNewKnowledgeCard,
    backToKnowledge,
    returnFromConnectionSettings,
    zen,
    onToggleZen: toggleZen,
    dark,
    themeMode,
    onChangeThemeMode: changeThemeMode,
    accentTheme,
    onChangeAccentTheme: changeAccentTheme,
  };

  return (
    <MotionConfig reducedMotion="user">
      <AppShellContext.Provider value={contextValue}>
        <div className={dark ? "dark" : ""} style={{ display: "contents" }}>
          <div className="app-shell flex h-full w-full min-w-0 transition-colors duration-300">
            <a
              href="#main-content"
              className="sr-only fixed left-3 top-3 z-[100] rounded-lg bg-[var(--ui-accent-solid)] px-3 py-2 text-sm font-semibold text-white shadow-lg focus:not-sr-only"
            >
              跳到主要内容
            </a>
            {!zen && (
              <Sidebar
                page={currentPage}
                onPrefetch={preloadPage}
                onOpenPalette={openPalette}
                dark={dark}
                onToggleDark={toggleDark}
                themeMode={themeMode}
                onChangeThemeMode={changeThemeMode}
                dueCount={dueCount}
              />
            )}
            <main id="main-content" className="app-content min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto" tabIndex={-1}>
              <Suspense fallback={<PageFallback />}>
                <Outlet />
              </Suspense>
            </main>
            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={(page) => { navigate(page); setPaletteOpen(false); }} />
          </div>
          <Toaster richColors position="bottom-center" theme={dark ? "dark" : "light"} />
        </div>
      </AppShellContext.Provider>
    </MotionConfig>
  );
}

function PageFallback() {
  return (
    <div className="min-h-full animate-fade-in p-4 md:p-8">
      <div className="ui-skeleton mb-4 h-8 w-48" />
      <div className="ui-skeleton mb-4 h-16 w-full max-w-2xl" />
      <div className="space-y-4">
        <div className="ui-skeleton h-24 w-full" />
        <div className="ui-skeleton h-24 w-full" />
        <div className="ui-skeleton h-40 w-full" />
      </div>
    </div>
  );
}

export default AppShell;
