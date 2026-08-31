import { lazy, useCallback } from "react";
import {
  Navigate,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import AppShell, { useAppShell } from "./App";
import type { KnowledgeCardStatus, KnowledgeCardType } from "./lib/api";

const TodayPage = lazy(() => import("./components/TodayPage"));
const HistoryPage = lazy(() => import("./components/HistoryPage"));
const ArchivePage = lazy(() => import("./components/ArchivePage"));
const SearchPage = lazy(() => import("./components/SearchPage"));
const StatsPage = lazy(() => import("./components/StatsPage"));
const ReviewsPage = lazy(() => import("./components/ReviewsPage"));
const ReviewPage = lazy(() => import("./components/ReviewPage"));
const KnowledgePage = lazy(() => import("./components/KnowledgePage"));
const KnowledgeTrashPage = lazy(() => import("./components/KnowledgeTrashPage"));
const SettingsPage = lazy(() => import("./components/SettingsPage"));

export type AppSearch = {
  q?: string;
  date?: string;
  returnTo?: string;
  page?: number;
  scope?: string;
  project?: string;
  tag?: string;
  status?: string;
  type?: string;
  sort?: string;
  usage?: string;
  quality?: string;
  view?: "list" | "detail";
  reviewKind?: "weekly" | "monthly";
  reviewStatus?: "draft" | "confirmed";
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function positiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function validateAppSearch(search: Record<string, unknown>): AppSearch {
  const view = stringValue(search.view);
  return {
    q: stringValue(search.q),
    date: stringValue(search.date),
    returnTo: stringValue(search.returnTo),
    page: positiveInteger(search.page),
    scope: stringValue(search.scope),
    project: stringValue(search.project),
    tag: stringValue(search.tag),
    status: stringValue(search.status),
    type: stringValue(search.type),
    sort: stringValue(search.sort),
    usage: stringValue(search.usage),
    quality: stringValue(search.quality),
    view: view === "detail" ? "detail" : view === "list" ? "list" : undefined,
    reviewKind: validReviewKind(stringValue(search.reviewKind)),
    reviewStatus: validReviewStatus(stringValue(search.reviewStatus)),
  };
}

function stringNonce(value?: string) {
  if (!value) return undefined;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash) || 1;
}

function validStatus(value?: string): KnowledgeCardStatus | "all" | undefined {
  return value === "all" || value === "draft" || value === "confirmed" || value === "outdated" ? value : undefined;
}

function validType(value?: string): KnowledgeCardType | undefined {
  return value === "fact" || value === "method" || value === "concept" || value === "decision" || value === "case" || value === "quote" || value === "principle" || value === "snippet"
    ? value
    : undefined;
}

function validSort(value?: string): "updated" | "created" | "usage" | "review" | undefined {
  return value === "updated" || value === "created" || value === "usage" || value === "review" ? value : undefined;
}

function validUsage(value?: string): "never_used" | undefined {
  return value === "never_used" ? value : undefined;
}

function validQuality(value?: string): "missing_source" | "missing_project" | "missing_tags" | "short_content" | undefined {
  return value === "missing_source" || value === "missing_project" || value === "missing_tags" || value === "short_content" ? value : undefined;
}

function validSearchScope(value?: string): "articles" | "cards" | undefined {
  return value === "articles" || value === "cards" ? value : undefined;
}

function validReviewKind(value?: string): "weekly" | "monthly" | undefined {
  return value === "weekly" || value === "monthly" ? value : undefined;
}

function validReviewStatus(value?: string): "draft" | "confirmed" | undefined {
  return value === "draft" || value === "confirmed" ? value : undefined;
}

const rootRoute = createRootRoute({
  validateSearch: validateAppSearch,
  component: AppShell,
  notFoundComponent: () => <Navigate to="/today" replace />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/today" replace />,
});

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/today",
  component: TodayRoute,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history",
  component: HistoryRoute,
});

const archiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/archive",
  component: ArchiveRoute,
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: SearchRoute,
});

const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats",
  component: StatsRoute,
});

const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reviews",
  component: ReviewsRoute,
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: ReviewRoute,
});

const knowledgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/knowledge",
  component: KnowledgeRoute,
});

const knowledgeNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/knowledge/new",
  component: KnowledgeNewRoute,
});

const knowledgeTrashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/knowledge/trash",
  component: KnowledgeTrashRoute,
});

const knowledgeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/knowledge/$cardId",
  component: KnowledgeDetailRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  todayRoute,
  historyRoute,
  archiveRoute,
  searchRoute,
  statsRoute,
  reviewsRoute,
  reviewRoute,
  knowledgeRoute,
  knowledgeNewRoute,
  knowledgeTrashRoute,
  knowledgeDetailRoute,
  settingsRoute,
]);

function useRootSearch() {
  return useSearch({ from: rootRoute.id }) as AppSearch;
}

function TodayRoute() {
  const search = useRootSearch();
  const shell = useAppShell();
  const returnFromToday = useCallback(() => {
    if (search.returnTo) shell.openReviewLibrary(search.returnTo);
  }, [search.returnTo, shell.openReviewLibrary]);
  return (
    <TodayPage
      targetDate={search.date}
      targetNonce={stringNonce(search.date)}
      onDateChange={shell.openRecordDate}
      returnTo={search.returnTo}
      onReturn={search.returnTo ? returnFromToday : undefined}
      onNavigate={shell.navigate}
      zen={shell.zen}
      onToggleZen={shell.onToggleZen}
      dark={shell.dark}
      onWikiLink={shell.openSearchTerm}
    />
  );
}

function HistoryRoute() {
  const shell = useAppShell();
  return <HistoryPage onEditDate={shell.openRecordDate} />;
}

function ArchiveRoute() {
  const shell = useAppShell();
  return <ArchivePage onEditDate={shell.openRecordDate} />;
}

function SearchRoute() {
  const search = useRootSearch();
  const shell = useAppShell();
  return (
    <SearchPage
      onEditDate={shell.openRecordDate}
      onOpenKnowledgeCard={shell.openKnowledgeCard}
      initialQuery={search.q}
      initialNonce={stringNonce(search.q)}
      initialScope={validSearchScope(search.scope)}
      initialPage={search.page}
      onQueryChange={(query) => shell.updateSearch({ q: query || undefined, page: undefined })}
      onScopeChange={(scope) => shell.updateSearch({ scope: scope === "articles" ? undefined : scope, page: undefined })}
      onPageChange={(page) => shell.updateSearch({ page: page > 1 ? page : undefined })}
    />
  );
}

function StatsRoute() {
  const search = useRootSearch();
  const shell = useAppShell();
  return (
    <StatsPage
      onEditDate={shell.openRecordDate}
      onSearchTerm={shell.openSearchTerm}
      onNavigate={shell.navigate}
      onOpenKnowledgeQuality={shell.openKnowledgeQuality}
      initialMonth={search.date}
      onMonthChange={(month) => shell.updateSearch({ date: month })}
    />
  );
}

function ReviewsRoute() {
  const search = useRootSearch();
  const shell = useAppShell();
  const handleQueryChange = useCallback((query: string) => {
    shell.updateSearch({ q: query || undefined });
  }, [shell.updateSearch]);
  const handleKindChange = useCallback((kind: "all" | "weekly" | "monthly") => {
    shell.updateSearch({ reviewKind: kind === "all" ? undefined : kind });
  }, [shell.updateSearch]);
  const handleStatusChange = useCallback((status: "all" | "draft" | "confirmed") => {
    shell.updateSearch({ reviewStatus: status === "all" ? undefined : status });
  }, [shell.updateSearch]);
  return (
    <ReviewsPage
      onNavigate={shell.navigate}
      onEditDate={shell.openRecordDate}
      initialQuery={search.q}
      initialKind={search.reviewKind}
      initialStatus={search.reviewStatus}
      onQueryChange={handleQueryChange}
      onKindChange={handleKindChange}
      onStatusChange={handleStatusChange}
    />
  );
}

function ReviewRoute() {
  const shell = useAppShell();
  return <ReviewPage onEditDate={shell.openRecordDate} onNavigate={shell.navigate} onOpenKnowledgeCard={shell.openKnowledgeCard} />;
}

function KnowledgeRoute() {
  return <KnowledgeRouteContent />;
}

function KnowledgeNewRoute() {
  return <KnowledgeRouteContent forcedView="detail" />;
}

function KnowledgeTrashRoute() {
  return <KnowledgeTrashPage />;
}

function KnowledgeDetailRoute() {
  const { cardId } = useParams({ from: knowledgeDetailRoute.id });
  return <KnowledgeRouteContent cardId={cardId} />;
}

function KnowledgeRouteContent({ cardId, forcedView }: { cardId?: string; forcedView?: "list" | "detail" }) {
  const search = useRootSearch();
  const shell = useAppShell();
  const initialView = forcedView || search.view || (cardId ? "detail" : "list");
  return (
    <KnowledgePage
      onEditDate={shell.openRecordDate}
      onNavigate={shell.navigate}
      initialCardId={cardId}
      initialNonce={stringNonce(cardId)}
      initialQuery={search.q}
      initialProject={search.project}
      initialTag={search.tag}
      initialStatus={validStatus(search.status)}
      initialType={validType(search.type)}
      initialSort={validSort(search.sort)}
      initialUsage={validUsage(search.usage)}
      initialQuality={validQuality(search.quality)}
      initialView={initialView}
      initialPage={search.page}
      onSearchParamsChange={shell.updateSearch}
      onOpenCard={shell.openKnowledgeCard}
      onNewCard={shell.openNewKnowledgeCard}
      onBackToList={shell.backToKnowledge}
      dark={shell.dark}
      onWikiLink={shell.openSearchTerm}
    />
  );
}

function SettingsRoute() {
  const shell = useAppShell();
  return (
    <SettingsPage
      accentTheme={shell.accentTheme}
      onChangeAccentTheme={shell.onChangeAccentTheme}
      themeMode={shell.themeMode}
      onChangeThemeMode={shell.onChangeThemeMode}
      onConnectionSaved={shell.returnFromConnectionSettings}
    />
  );
}

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default router;
