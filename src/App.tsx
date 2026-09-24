import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type CSSProperties,
} from "react";
import { MotionConfig } from "framer-motion";
import { Outlet, useLocation, useNavigate as useRouterNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import WorkspaceInteractions from "./components/workspace/WorkspaceInteractions";
import { WallpaperSurfaceProvider } from "./components/workspace/WallpaperSurface";
import { pageShortcuts, isInteractionBlocked } from "./lib/navigationInteractions";
import Sidebar from "./components/Sidebar";
import CommandPalette from "./components/CommandPalette";
import * as api from "./lib/api";
import { connectionReturnStorageKey, readLocalStorage, readSessionStorage, removeSessionStorage, writeLocalStorage } from "./lib/storage";
import { colorSchemeForMode, nextExplicitThemeMode, resolveDarkTheme, themeColorForMode, type ThemeMode } from "./lib/theme";
import {
  applyWallpaperAssetsToTargets as persistApplyWallpaperAssetsToTargets,
  builtInWallpapers,
  defaultWallpaperPreferences,
  deleteWallpaperAssets as persistDeleteWallpaperAssets,
  deleteWallpaperPreset as persistDeleteWallpaperPreset,
  applyWallpaperPreset as persistApplyWallpaperPreset,
  loadWallpaperAssetFiles,
  loadWallpaperAssets,
  loadWallpaperPreferences,
  loadWallpaperPresets,
  renameWallpaperPreset as persistRenameWallpaperPreset,
  resetWallpaper as resetWallpaperStorage,
  saveWallpaperAsset,
  saveWallpaperPreset as persistSaveWallpaperPreset,
  saveWallpaperTargetPreference,
  wallpaperIdForDate,
  wallpaperModuleForPage,
  type WallpaperApplyMode,
  type WallpaperAssignmentTargetId,
  type WallpaperAssetDraft,
  type WallpaperAssetMetadata,
  type WallpaperPreferenceValue,
  type WallpaperPreferences,
  type WallpaperPreset,
} from "./lib/wallpapers";

export type Page = "today" | "history" | "archive" | "search" | "stats" | "reviews" | "review" | "knowledge" | "settings";
export type { ThemeMode } from "./lib/theme";

const pageLoaders: Partial<Record<Page, () => Promise<unknown>>> = {
  today: () => import("./components/TodayPage"),
  history: () => import("./components/HistoryPage"),
  // 旧的 archive 页面仍由路由兼容，但预加载统一后的记录页。
  archive: () => import("./components/HistoryPage"),
  search: () => import("./components/SearchPage"),
  stats: () => import("./components/StatsPage"),
  reviews: () => import("./components/ReviewsPage"),
  review: () => import("./components/ReviewPage"),
  knowledge: () => import("./components/KnowledgePage"),
  settings: () => import("./components/SettingsPage"),
};

export function preloadPage(page: Page) {
  void pageLoaders[page]?.().catch(() => { /* Navigation handles a failed lazy chunk; prefetch must stay silent. */ });
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
    "/history": "记录",
    "/archive": "记录",
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
  returnFromToday: (returnTo?: string) => void;
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
  wallpaperPreferences: WallpaperPreferences;
  wallpaperPreferencesReady: boolean;
  wallpaperStorageError: string | null;
  wallpaperAssets: WallpaperAssetMetadata[];
  wallpaperPresets: WallpaperPreset[];
  onChangeWallpaperPreference: (
    target: WallpaperAssignmentTargetId,
    preference: WallpaperPreferenceValue,
  ) => Promise<boolean>;
  onApplyWallpaperAssets: (
    targets: WallpaperAssignmentTargetId[],
    wallpaperIds: string[],
    mode: WallpaperApplyMode,
  ) => Promise<boolean>;
  onAddWallpaperAsset: (asset: WallpaperAssetDraft) => Promise<boolean>;
  onDeleteWallpaperAssets: (wallpaperIds: string[]) => Promise<boolean>;
  onSaveWallpaperPreset: (name: string, presetId?: string) => Promise<boolean>;
  onRenameWallpaperPreset: (presetId: string, name: string) => Promise<boolean>;
  onDeleteWallpaperPreset: (presetId: string) => Promise<boolean>;
  onApplyWallpaperPreset: (presetId: string | null) => Promise<boolean>;
  onResetWallpaper: (target: WallpaperAssignmentTargetId) => Promise<boolean>;
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
  const [wallpaperPreferences, setWallpaperPreferences] = useState<WallpaperPreferences>(
    () => defaultWallpaperPreferences(),
  );
  const [wallpaperStorageError, setWallpaperStorageError] = useState<string | null>(null);
  const [wallpaperAssets, setWallpaperAssets] = useState<WallpaperAssetMetadata[]>([]);
  const [wallpaperPresets, setWallpaperPresets] = useState<WallpaperPreset[]>([]);
  const [wallpaperPreferencesReady, setWallpaperPreferencesReady] = useState(false);
  const [wallpaperAssetsRevision, setWallpaperAssetsRevision] = useState(0);
  const [wallpaperDate, setWallpaperDate] = useState(() => new Date());
  const [loadedWallpaperAsset, setLoadedWallpaperAsset] = useState<{
    assetId: string;
    desktopUrl: string;
    mobileUrl: string;
  } | null>(null);
  const wallpaperPreferenceLoadRevision = useRef(0);

  const dark = resolveDarkTheme(themeMode, systemDark);

  useEffect(() => {
    let current = true;
    void Promise.allSettled([
      loadWallpaperPreferences(),
      loadWallpaperAssets(),
      loadWallpaperPresets(),
    ])
      .then(([preferencesResult, assetsResult, presetsResult]) => {
        if (!current) return;
        const failures: string[] = [];
        if (preferencesResult.status === "fulfilled") {
          if (wallpaperPreferenceLoadRevision.current === 0) {
            setWallpaperPreferences(preferencesResult.value);
          }
        } else {
          failures.push("页面分配");
        }
        if (assetsResult.status === "fulfilled") {
          setWallpaperAssets(assetsResult.value);
        } else {
          failures.push("图片库");
        }
        if (presetsResult.status === "fulfilled") {
          setWallpaperPresets(presetsResult.value);
        } else {
          failures.push("壁纸方案");
        }
        setWallpaperStorageError(
          failures.length > 0
            ? "壁纸数据未能完整读取（" + failures.join("、") + "）。为避免覆盖现有数据，管理操作已暂停；请刷新后重试。"
            : null,
        );
      })
      .finally(() => {
        if (current) setWallpaperPreferencesReady(true);
      });
    return () => {
      current = false;
    };
  }, []);

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
  const changeWallpaperPreference = useCallback(
    async (target: WallpaperAssignmentTargetId, preference: WallpaperPreferenceValue) => {
      try {
        const preferences = await saveWallpaperTargetPreference(target, preference);
        wallpaperPreferenceLoadRevision.current += 1;
        setWallpaperPreferences(preferences);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );
  const applyWallpaperAssetsToTargets = useCallback(
    async (
      targets: WallpaperAssignmentTargetId[],
      wallpaperIds: string[],
      mode: WallpaperApplyMode,
    ) => {
      try {
        const preferences = await persistApplyWallpaperAssetsToTargets(targets, wallpaperIds, mode);
        wallpaperPreferenceLoadRevision.current += 1;
        setWallpaperPreferences(preferences);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );
  const addWallpaperAsset = useCallback(async (asset: WallpaperAssetDraft) => {
    try {
      await saveWallpaperAsset(asset.metadata, asset.files, asset.thumbnails);
      setWallpaperAssets((current) => [
        asset.metadata,
        ...current.filter((item) => item.id !== asset.metadata.id),
      ]);
      setWallpaperAssetsRevision((revision) => revision + 1);
      return true;
    } catch {
      return false;
    }
  }, []);
  const deleteWallpaperAssetsFromLibrary = useCallback(async (wallpaperIds: string[]) => {
    try {
      const { preferences, presets } = await persistDeleteWallpaperAssets(wallpaperIds);
      wallpaperPreferenceLoadRevision.current += 1;
      setWallpaperPreferences(preferences);
      setWallpaperPresets(presets);
      setWallpaperAssets((current) =>
        current.filter((asset) => !wallpaperIds.includes(asset.id)),
      );
      setWallpaperAssetsRevision((revision) => revision + 1);
      return true;
    } catch {
      return false;
    }
  }, []);
  const saveWallpaperPreset = useCallback(async (name: string, presetId?: string) => {
    try {
      const preset = await persistSaveWallpaperPreset(name, presetId);
      setWallpaperPresets((current) =>
        [preset, ...current.filter((item) => item.id !== preset.id)]
          .sort((left, right) => right.updatedAt - left.updatedAt),
      );
      return true;
    } catch {
      return false;
    }
  }, []);
  const renameWallpaperPresetInLibrary = useCallback(async (presetId: string, name: string) => {
    try {
      const preset = await persistRenameWallpaperPreset(presetId, name);
      setWallpaperPresets((current) =>
        [preset, ...current.filter((item) => item.id !== preset.id)]
          .sort((left, right) => right.updatedAt - left.updatedAt),
      );
      return true;
    } catch {
      return false;
    }
  }, []);
  const deleteWallpaperPresetFromLibrary = useCallback(async (presetId: string) => {
    try {
      await persistDeleteWallpaperPreset(presetId);
      setWallpaperPresets((current) => current.filter((item) => item.id !== presetId));
      return true;
    } catch {
      return false;
    }
  }, []);
  const applyWallpaperPresetToLibrary = useCallback(async (presetId: string | null) => {
    try {
      const preferences = await persistApplyWallpaperPreset(presetId);
      wallpaperPreferenceLoadRevision.current += 1;
      setWallpaperPreferences(preferences);
      return true;
    } catch {
      return false;
    }
  }, []);

  const resetWallpaperTarget = useCallback(async (target: WallpaperAssignmentTargetId) => {
    try {
      const preferences = await resetWallpaperStorage(target);
      wallpaperPreferenceLoadRevision.current += 1;
      setWallpaperPreferences(preferences);
      return true;
    } catch {
      return false;
    }
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
    else if (nextPage === "archive") go("/history", { historyView: "month" });
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

  const returnFromToday = useCallback((returnTo?: string) => {
    const fallback = () => go("/history");
    if (!returnTo || !returnTo.startsWith("/") || typeof window === "undefined") {
      fallback();
      return;
    }
    try {
      const url = new URL(returnTo, window.location.origin);
      const allowedPaths = new Set(["/history", "/reviews", "/search", "/stats", "/knowledge", "/review"]);
      if (url.origin !== window.location.origin || !allowedPaths.has(url.pathname)) {
        fallback();
        return;
      }
      const search: Record<string, unknown> = {};
      const searchKeys = [
        "q", "date", "historyView", "historyMonth", "returnTo", "page", "scope", "project", "tag",
        "status", "type", "sort", "usage", "quality", "view", "tab", "reviewKind", "reviewStatus",
      ];
      for (const key of searchKeys) {
        const value = url.searchParams.get(key);
        if (!value) continue;
        search[key] = key === "page" ? Number(value) : value;
      }
      void routerNavigate({ to: url.pathname as never, search: search as never });
    } catch {
      fallback();
    }
  }, [go, routerNavigate]);

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
    const map = pageShortcuts;
    const handler = (event: KeyboardEvent) => {
      if (isInteractionBlocked(event) || isEditableTarget(event.target) || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
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
      if (isInteractionBlocked(event) || isEditableTarget(event.target) || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Route chunks are loaded on navigation or explicit hover/focus intent.

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
      const searchKeys = ["q", "date", "historyView", "historyMonth", "returnTo", "page", "scope", "project", "tag", "status", "type", "sort", "usage", "quality", "view", "tab"];
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
  const wallpaperModule = wallpaperModuleForPage(currentPage);
  const wallpaperPreference = wallpaperPreferences[wallpaperModule];
  const selectedWallpaperId = wallpaperIdForDate(
    wallpaperPreference,
    wallpaperDate,
  );
  const builtInWallpaper = builtInWallpapers.find(
    (asset) => asset.id === selectedWallpaperId,
  );

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    const timer = window.setTimeout(
      () => setWallpaperDate(new Date()),
      Math.max(1_000, nextMidnight.getTime() - now.getTime() + 100),
    );
    return () => window.clearTimeout(timer);
  }, [wallpaperDate]);

  useEffect(() => {
    let current = true;
    const objectUrls = new Set<string>();
    setLoadedWallpaperAsset(null);

    if (!selectedWallpaperId || builtInWallpaper) {
      return () => {
        current = false;
      };
    }

    void loadWallpaperAssetFiles(selectedWallpaperId)
      .then((files) => {
        if (!current || !files) return;
        const desktopBlob = files.desktopBlob ?? files.mobileBlob;
        const mobileBlob = files.mobileBlob ?? files.desktopBlob;
        if (!desktopBlob || !mobileBlob) return;
        const makeUrl = (blob: Blob) => {
          const url = URL.createObjectURL(blob);
          objectUrls.add(url);
          return url;
        };
        const desktopUrl = makeUrl(desktopBlob);
        const mobileUrl =
          mobileBlob === desktopBlob ? desktopUrl : makeUrl(mobileBlob);
        setLoadedWallpaperAsset({
          assetId: selectedWallpaperId,
          desktopUrl,
          mobileUrl,
        });
      })
      .catch(() => {
        if (current) setLoadedWallpaperAsset(null);
      });

    return () => {
      current = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedWallpaperId, wallpaperAssetsRevision, builtInWallpaper]);

  const activeWallpaper = builtInWallpaper
    ? {
        desktopUrl: builtInWallpaper.desktopUrl,
        mobileUrl: builtInWallpaper.mobileUrl,
      }
    : loadedWallpaperAsset?.assetId === selectedWallpaperId
      ? loadedWallpaperAsset
      : null;
  const wallpaperStyle = activeWallpaper
    ? ({
        "--module-wallpaper-desktop": `url("${activeWallpaper.desktopUrl}")`,
        "--module-wallpaper-mobile": `url("${activeWallpaper.mobileUrl}")`,
        "--module-wallpaper-overlay": String(wallpaperPreference.overlay / 100),
      } as CSSProperties)
    : undefined;

  useEffect(() => {
    document.title = `${titleForPath(location.pathname)} — 每日总结`;
  }, [location.pathname]);

  const contextValue: AppShellContextValue = {
    navigate,
    updateSearch,
    openRecordDate,
    openReviewLibrary,
    returnFromToday,
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
    wallpaperPreferences,
    wallpaperPreferencesReady,
    wallpaperStorageError,
    wallpaperAssets,
    wallpaperPresets,
    onChangeWallpaperPreference: changeWallpaperPreference,
    onApplyWallpaperAssets: applyWallpaperAssetsToTargets,
    onAddWallpaperAsset: addWallpaperAsset,
    onDeleteWallpaperAssets: deleteWallpaperAssetsFromLibrary,
    onSaveWallpaperPreset: saveWallpaperPreset,
    onRenameWallpaperPreset: renameWallpaperPresetInLibrary,
    onDeleteWallpaperPreset: deleteWallpaperPresetFromLibrary,
    onApplyWallpaperPreset: applyWallpaperPresetToLibrary,
    onResetWallpaper: resetWallpaperTarget,
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
                onOpenShortcuts={() => setShortcutsOpen(true)}
                dark={dark}
                onToggleDark={toggleDark}
                themeMode={themeMode}
                onChangeThemeMode={changeThemeMode}
                dueCount={dueCount}
              />
            )}
            <main
              id="main-content"
              className="app-content min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
              data-wallpaper-module={wallpaperModule}
              data-wallpaper-active={activeWallpaper ? "true" : "false"}
              style={wallpaperStyle}
              tabIndex={-1}
            >
              <WallpaperSurfaceProvider
                value={{
                  module: wallpaperModule,
                  preferences: wallpaperPreferences,
                  date: wallpaperDate,
                  assetsRevision: wallpaperAssetsRevision,
                }}
              >
                <Suspense fallback={<PageFallback />}>
                  <Outlet />
                </Suspense>
              </WallpaperSurfaceProvider>
            </main>
            <WorkspaceInteractions pageKey={currentPage} open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
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
    <div className="min-h-full p-4 md:p-8" role="status" aria-label="正在加载页面" aria-busy="true">
      <div className="ix-loading-indicator" aria-hidden="true" />
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
