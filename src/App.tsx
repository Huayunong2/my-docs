import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import TodayPage from "./components/TodayPage";
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
  const [dueCount, setDueCount] = useState<number | null>(null);

  // 侧栏「今日到期」角标：挂载时 + 每分钟刷新；未配置/失败时静默隐藏
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      api.getDueReviewCards(1)
        .then((res) => { if (!cancelled) setDueCount(res.stats.due); })
        .catch(() => { if (!cancelled) setDueCount(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  const toggleDark = useCallback(() => setDark((d) => !d), []);
  const navigate = useCallback((nextPage: Page) => {
    preloadPage(nextPage);
    setPage(nextPage);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const loadPage of Object.values(pageLoaders)) void loadPage();
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={dark ? "dark" : ""} style={{ display: "contents" }}>
      <div className="flex h-dvh w-screen bg-surface dark:bg-surface-dark transition-colors duration-300">
        <Sidebar page={page} onNavigate={navigate} onPrefetch={preloadPage} dark={dark} onToggleDark={toggleDark} dueCount={dueCount} />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Suspense fallback={<PageFallback />}>
            <PageContent page={page} recordTarget={recordTarget} searchTarget={searchTarget} knowledgeTarget={knowledgeTarget} onEditDate={openRecordDate} onSearchTerm={openSearchTerm} onOpenKnowledgeCard={openKnowledgeCard} onNavigate={navigate} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function PageFallback() {
  return <div className="flex min-h-full items-center justify-center text-sm text-gray-400">正在打开…</div>;
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
}: {
  page: Page;
  recordTarget: { date: string; nonce: number } | null;
  searchTarget: { query: string; nonce: number } | null;
  knowledgeTarget: { cardId: string; nonce: number } | null;
  onEditDate: (date: string) => void;
  onSearchTerm: (query: string) => void;
  onOpenKnowledgeCard: (cardId: string) => void;
  onNavigate: (page: Page) => void;
}) {
  switch (page) {
    case "today":
      return <TodayPage targetDate={recordTarget?.date} targetNonce={recordTarget?.nonce} onNavigate={onNavigate} />;
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
      return <ReviewPage onEditDate={onEditDate} onNavigate={onNavigate} />;
    case "knowledge":
      return <KnowledgePage onEditDate={onEditDate} onNavigate={onNavigate} initialCardId={knowledgeTarget?.cardId} initialNonce={knowledgeTarget?.nonce} />;
    case "settings":
      return <SettingsPage />;
    default:
      return <TodayPage />;
  }
}

export default App;
