import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Toaster } from "sonner";
import Sidebar from "./components/Sidebar";
import TodayPage from "./components/TodayPage";
import CommandPalette from "./components/CommandPalette";
import * as api from "./lib/api";

export type Page = "today" | "history" | "archive" | "search" | "stats" | "reviews" | "review" | "knowledge" | "settings";

const pageLoaders = {
  history: () => import("./components/HistoryPage"),
  archive: () => import("./components/ArchivePage"),
  search: () => import("./components/SearchPage"),
  stats: () => import("./components/StatsPage"),
  reviews: () => import("./components/ReviewsPage"),
  review: () => import("./components/ReviewPage"),
  knowledge: () => import("./components/KnowledgePage"),
  settings: () => import("./components/SettingsPage"),
};

const HistoryPage = lazy(pageLoaders.history);
const ArchivePage = lazy(pageLoaders.archive);
const SearchPage = lazy(pageLoaders.search);
const StatsPage = lazy(pageLoaders.stats);
const ReviewsPage = lazy(pageLoaders.reviews);
const ReviewPage = lazy(pageLoaders.review);
const KnowledgePage = lazy(pageLoaders.knowledge);
const SettingsPage = lazy(pageLoaders.settings);

function preloadPage(page: Page) {
  if (page !== "today") void pageLoaders[page]();
}

function App() {
  const [page, setPage] = useState<Page>("today");
  const [recordTarget, setRecordTarget] = useState<{ date: string; nonce: number } | null>(null);
  const [searchTarget, setSearchTarget] = useState<{ query: string; nonce: number } | null>(null);
  const [knowledgeTarget, setKnowledgeTarget] = useState<{ cardId: string; nonce: number } | null>(null);
  const [zen, setZen] = useState(false);
  const toggleZen = useCallback(() => setZen((z) => !z), []);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // 侧栏「今日到期」角标：useQuery 缓存 + 每分钟自动刷新；失败时静默隐藏
  const { data: dueCount } = useQuery({
    queryKey: ["dueCount"],
    queryFn: async () => (await api.getDueReviewCards(1)).stats.due,
    refetchInterval: 60_000,
  });
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });
  const [accentTheme, setAccentTheme] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("accentTheme") || "";
    }
    return "";
  });

  useEffect(() => {
    const el = document.documentElement;
    if (accentTheme) el.dataset.theme = accentTheme;
    else delete el.dataset.theme;
  }, [accentTheme]);

  const toggleDark = useCallback(() => setDark((d) => !d), []);
  const changeAccentTheme = useCallback((theme: string) => {
    setAccentTheme(theme);
    if (typeof window !== "undefined") localStorage.setItem("accentTheme", theme);
  }, []);
  const navigate = useCallback((nextPage: Page) => {
    preloadPage(nextPage);
    setPage(nextPage);
    if (nextPage !== "today") setZen(false);
  }, []);
  const openRecordDate = useCallback((date: string) => {
    setRecordTarget({ date, nonce: Date.now() });
    setPage("today");
  }, []);
  const openSearchTerm = useCallback((query: string) => {
    setSearchTarget({ query, nonce: Date.now() });
    navigate("search");
  }, [navigate]);
  const openKnowledgeCard = useCallback((cardId: string) => {
    setKnowledgeTarget({ cardId, nonce: Date.now() });
    navigate("knowledge");
  }, [navigate]);

  // Keyboard shortcuts: Ctrl+1-9 page switching
  useEffect(() => {
    const map: Record<string, Page> = {
      "1": "today", "2": "history", "3": "archive",
      "4": "search", "5": "stats", "6": "reviews",
      "7": "knowledge", "8": "settings", "9": "review",
    };
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && map[e.key]) {
        e.preventDefault();
        navigate(map[e.key]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  // Ctrl/Cmd+K 命令面板
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
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

  return (
    <div className={dark ? "dark" : ""} style={{ display: "contents" }}>
      <div className="flex h-dvh w-screen bg-surface dark:bg-surface-dark transition-colors duration-300">
        {!zen && <Sidebar page={page} onNavigate={navigate} onPrefetch={preloadPage} dark={dark} onToggleDark={toggleDark} dueCount={dueCount} />}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Suspense fallback={<PageFallback />}>
            <PageContent page={page} recordTarget={recordTarget} searchTarget={searchTarget} knowledgeTarget={knowledgeTarget} onEditDate={openRecordDate} onSearchTerm={openSearchTerm} onOpenKnowledgeCard={openKnowledgeCard} onNavigate={navigate} zen={zen} onToggleZen={toggleZen} dark={dark} accentTheme={accentTheme} onChangeAccentTheme={changeAccentTheme} />
          </Suspense>
        </main>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={(p) => navigate(p)} />
      </div>
      <Toaster richColors position="bottom-center" theme={dark ? "dark" : "light"} />
    </div>
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

function PageContent({
  page,
  recordTarget,
  searchTarget,
  knowledgeTarget,
  onEditDate,
  onSearchTerm,
  onOpenKnowledgeCard,
  onNavigate,
  zen,
  onToggleZen,
  dark,
  accentTheme,
  onChangeAccentTheme,
}: {
  page: Page;
  recordTarget: { date: string; nonce: number } | null;
  searchTarget: { query: string; nonce: number } | null;
  knowledgeTarget: { cardId: string; nonce: number } | null;
  onEditDate: (date: string) => void;
  onSearchTerm: (query: string) => void;
  onOpenKnowledgeCard: (cardId: string) => void;
  onNavigate: (page: Page) => void;
  zen: boolean;
  onToggleZen: () => void;
  dark: boolean;
  accentTheme: string;
  onChangeAccentTheme: (theme: string) => void;
}) {
  switch (page) {
    case "today":
      return <TodayPage targetDate={recordTarget?.date} targetNonce={recordTarget?.nonce} onNavigate={onNavigate} zen={zen} onToggleZen={onToggleZen} dark={dark} onWikiLink={onSearchTerm} />;
    case "history":
      return <HistoryPage onEditDate={onEditDate} />;
    case "archive":
      return <ArchivePage onEditDate={onEditDate} />;
    case "search":
      return <SearchPage onEditDate={onEditDate} initialQuery={searchTarget?.query} initialNonce={searchTarget?.nonce} onOpenKnowledgeCard={onOpenKnowledgeCard} />;
    case "stats":
      return <StatsPage onEditDate={onEditDate} onSearchTerm={onSearchTerm} onNavigate={onNavigate} />;
    case "reviews":
      return <ReviewsPage />;
    case "review":
      return <ReviewPage onEditDate={onEditDate} onNavigate={onNavigate} onOpenKnowledgeCard={onOpenKnowledgeCard} />;
    case "knowledge":
      return <KnowledgePage onEditDate={onEditDate} onNavigate={onNavigate} initialCardId={knowledgeTarget?.cardId} initialNonce={knowledgeTarget?.nonce} dark={dark} onWikiLink={onSearchTerm} />;
    case "settings":
      return <SettingsPage accentTheme={accentTheme} onChangeAccentTheme={onChangeAccentTheme} />;
    default:
      return <TodayPage />;
  }
}

export default App;
