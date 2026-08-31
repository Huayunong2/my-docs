import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BookOpenText,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileClock,
  GitCompareArrows,
  Layers3,
  LoaderCircle,
  Pin,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as api from "../lib/api";
import type { Review, ReviewKind, ReviewStatus } from "../lib/api";
import type { Page } from "../App";
import { formatReviewMonth, formatReviewTimestamp, normalizeReviewContent, reviewBodyContent, reviewExcerpt, reviewPreview } from "../lib/reviewContent";
import { selectLatestReview } from "../lib/reviewGeneration";
import { ReviewViewerModal, ReviewStatusPill } from "./reviews/ReviewShared";
import MarkdownContent from "./MarkdownContent";
import { EmptyState, InlineError, LoadingState, useConfirmDialog } from "./ui/Feedback";
import PageHeader from "./ui/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { readSessionStorage, removeSessionStorage, reviewLibraryReturnStorageKey, writeSessionStorage } from "../lib/storage";
import { toast } from "sonner";

type KindFilter = "all" | ReviewKind;
type StatusFilter = "all" | ReviewStatus;

type PeriodGroup = {
  key: string;
  kind: ReviewKind;
  periodStart: string;
  periodEnd: string;
  latest: Review;
  confirmed: Review | null;
  versions: Review[];
};

type MonthGroup = {
  month: string;
  periods: PeriodGroup[];
};

type ReviewAction = { id: string; kind: "confirm" | "delete" };

type SourceModalState = {
  review: Review;
  articles: api.Article[];
  sourceReviews: Review[];
  failedCount: number;
  loading: boolean;
  error: string;
};

type ReviewLibraryReturnState = {
  path: string;
  expandedPeriods: string[];
  scrollTop: number;
  savedAt: number;
};

const MONTH_PAGE_SIZE = 6;
const REVIEW_PAGE_SIZE = 36;
const REVIEW_RETURN_MAX_AGE_MS = 30 * 60 * 1000;

function readReviewLibraryReturnState(): ReviewLibraryReturnState | null {
  const raw = readSessionStorage(reviewLibraryReturnStorageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReviewLibraryReturnState>;
    if (
      typeof parsed.path !== "string"
      || !Array.isArray(parsed.expandedPeriods)
      || typeof parsed.scrollTop !== "number"
      || typeof parsed.savedAt !== "number"
      || Date.now() - parsed.savedAt > REVIEW_RETURN_MAX_AGE_MS
    ) return null;
    return {
      path: parsed.path,
      expandedPeriods: parsed.expandedPeriods.filter((key): key is string => typeof key === "string"),
      scrollTop: Math.max(0, parsed.scrollTop),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export default function ReviewsPage({
  onNavigate,
  onEditDate,
  initialQuery,
  initialKind,
  initialStatus,
  onQueryChange,
  onKindChange,
  onStatusChange,
}: {
  onNavigate?: (page: Page) => void;
  onEditDate?: (date: string, returnTo?: string) => void;
  initialQuery?: string;
  initialKind?: ReviewKind;
  initialStatus?: ReviewStatus;
  onQueryChange?: (query: string) => void;
  onKindChange?: (kind: KindFilter) => void;
  onStatusChange?: (status: StatusFilter) => void;
} = {}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [kindFilter, setKindFilter] = useState<KindFilter>(initialKind || "all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus || "all");
  const [query, setQuery] = useState(initialQuery || "");
  const [expandedPeriods, setExpandedPeriods] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [viewerReadOnly, setViewerReadOnly] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [comparePair, setComparePair] = useState<{ current: Review; previous: Review; versions: Review[]; partial: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [extractingKnowledgeId, setExtractingKnowledgeId] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeHasAction, setNoticeHasAction] = useState(false);
  const [visibleMonthCount, setVisibleMonthCount] = useState(MONTH_PAGE_SIZE);
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [hasMoreReviews, setHasMoreReviews] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reviewSummary, setReviewSummary] = useState({
    draftCount: 0,
    confirmedCount: 0,
    currentMonthWeeklyDrafts: 0,
    latest: "",
  });
  const [sourceModal, setSourceModal] = useState<SourceModalState | null>(null);
  const loadRequestRef = useRef(0);
  const reviewPageRef = useRef(1);
  const sourceRequestRef = useRef(0);
  const deleteConfirmingRef = useRef(false);
  const onQueryChangeRef = useRef(onQueryChange);
  const lastSyncedQueryRef = useRef((initialQuery || "").trim());
  const reviewReturnStateRef = useRef(readReviewLibraryReturnState());
  const editingTriggerRef = useRef<HTMLButtonElement | null>(null);
  const compareTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  const loadReviews = useCallback(async ({ showLoading = true, append = false }: { showLoading?: boolean; append?: boolean } = {}) => {
    const requestId = ++loadRequestRef.current;
    const nextPage = append ? reviewPageRef.current + 1 : 1;
    if (append) setLoadingMore(true);
    else if (showLoading) setLoading(true);
    else setRefreshing(true);
    setError("");
    setErrorStatus(null);
    try {
      const result = await api.queryReviews({
        kind: kindFilter === "all" ? undefined : kindFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
        q: query.trim() || undefined,
        page: nextPage,
        page_size: REVIEW_PAGE_SIZE,
      });
      if (requestId === loadRequestRef.current) {
        setReviews((current) => append
          ? [...current, ...result.reviews.filter((review) => !current.some((item) => item.id === review.id))]
          : result.reviews);
        reviewPageRef.current = result.page;
        setTotalReviewCount(result.total);
        setHasMoreReviews(result.has_more);
        setReviewSummary({
          draftCount: result.draft_count,
          confirmedCount: result.confirmed_count,
          currentMonthWeeklyDrafts: result.current_month_weekly_drafts,
          latest: result.latest_generated_at || "",
        });
      }
    } catch (e) {
      if (requestId === loadRequestRef.current) {
        setError(api.getErrorMessage(e));
        setErrorStatus(e instanceof api.ApiError ? e.status : null);
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [kindFilter, query, statusFilter]);

  useEffect(() => {
    onQueryChangeRef.current = onQueryChange;
  }, [onQueryChange]);

  useEffect(() => {
    const nextQuery = initialQuery || "";
    lastSyncedQueryRef.current = nextQuery.trim();
    setQuery((current) => current === nextQuery ? current : nextQuery);
  }, [initialQuery]);

  useEffect(() => {
    const nextKind = initialKind || "all";
    setKindFilter((current) => current === nextKind ? current : nextKind);
  }, [initialKind]);

  useEffect(() => {
    const nextStatus = initialStatus || "all";
    setStatusFilter((current) => current === nextStatus ? current : nextStatus);
  }, [initialStatus]);

  useEffect(() => {
    const delay = query.trim() ? 250 : 0;
    const timeout = window.setTimeout(() => {
      const normalizedQuery = query.trim();
      // Keep URL synchronisation one-way for the current value. Writing the
      // same value back during mount can re-render the route, recreate its
      // callback, and start the request effect again indefinitely.
      if (normalizedQuery !== lastSyncedQueryRef.current) {
        lastSyncedQueryRef.current = normalizedQuery;
        onQueryChangeRef.current?.(normalizedQuery);
      }
      void loadReviews();
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [loadReviews, query]);

  useEffect(() => {
    setVisibleMonthCount(MONTH_PAGE_SIZE);
  }, [kindFilter, query, statusFilter]);

  useEffect(() => {
    const saved = reviewReturnStateRef.current;
    if (!saved || loading || typeof window === "undefined") return;
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (saved.path !== currentPath) return;
    setExpandedPeriods(Object.fromEntries(saved.expandedPeriods.map((key) => [key, true])));
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("main")?.scrollTo({ top: saved.scrollTop, behavior: "auto" });
      removeSessionStorage(reviewLibraryReturnStorageKey);
      reviewReturnStateRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading]);

  const filtered = reviews;

  const monthGroups = useMemo(() => groupReviewsByMonth(filtered), [filtered]);
  const summary = useMemo(() => {
    return {
      total: totalReviewCount,
      drafts: reviewSummary.draftCount,
      confirmed: reviewSummary.confirmedCount,
      currentMonthWeeklyDrafts: reviewSummary.currentMonthWeeklyDrafts,
      latest: reviewSummary.latest || "暂无",
    };
  }, [reviewSummary, totalReviewCount]);

  const hasActiveFilters = kindFilter !== "all" || statusFilter !== "all" || query.trim().length > 0;
  const visibleMonthGroups = monthGroups.slice(0, visibleMonthCount);
  const canRevealMoreMonths = visibleMonthGroups.length < monthGroups.length;

  const changeKind = (value: string) => {
    const next = value as KindFilter;
    setKindFilter(next);
    onKindChange?.(next);
  };

  const changeStatus = (value: string) => {
    const next = value as StatusFilter;
    setStatusFilter(next);
    onStatusChange?.(next);
  };

  const clearFilters = () => {
    setQuery("");
    setKindFilter("all");
    setStatusFilter("all");
    onQueryChange?.("");
    onKindChange?.("all");
    onStatusChange?.("all");
  };

  const openEditor = (review: Review, event?: React.MouseEvent<HTMLButtonElement>, readOnly = false) => {
    if (event) editingTriggerRef.current = event.currentTarget;
    setEditingReview(review);
    setViewerReadOnly(readOnly);
    setEditTitle(review.title);
    setEditContent(review.content);
  };

  const saveReview = async (status?: ReviewStatus): Promise<boolean> => {
    if (!editingReview || saving || reviewAction) return false;
    setSaving(true);
    setError("");
    setErrorStatus(null);
    try {
      const updated = await api.updateReview(editingReview.id, {
        title: editTitle,
        content: editContent,
        status,
      });
      setEditingReview(updated);
      setEditTitle(updated.title);
      setEditContent(updated.content);
      await loadReviews({ showLoading: false });
      toast.success(status === "confirmed" ? "已确认此复盘版本" : updated.status === "confirmed" ? "复盘修改已保存" : "复盘草稿已保存");
      return true;
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
      setErrorStatus(e instanceof api.ApiError ? e.status : null);
      toast.error(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteReview = async (review: Review): Promise<boolean> => {
    if (reviewAction || saving || deleteConfirmingRef.current) return false;
    deleteConfirmingRef.current = true;
    setReviewAction({ id: review.id, kind: "delete" });
    try {
      const ok = await confirm({
        title: "删除 AI 复盘",
        message: `删除「${review.title}」v${review.version}？\n\n只会删除这个复盘版本，不会删除每日记录或其他版本。`,
        confirmText: "删除",
        danger: true,
      });
      if (!ok) return false;
      setError("");
      setErrorStatus(null);
      await api.deleteReview(review.id);
      if (editingReview?.id === review.id) setEditingReview(null);
      await loadReviews({ showLoading: false });
      toast.success(`已删除「${review.title}」v${review.version}`);
      return true;
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
      setErrorStatus(e instanceof api.ApiError ? e.status : null);
      toast.error(message);
      return false;
    } finally {
      deleteConfirmingRef.current = false;
      setReviewAction(null);
    }
  };

  const confirmReview = async (review: Review): Promise<boolean> => {
    if (reviewAction || saving) return false;
    setError("");
    setErrorStatus(null);
    setReviewAction({ id: review.id, kind: "confirm" });
    try {
      const updated = await api.updateReview(review.id, { status: "confirmed" });
      if (editingReview?.id === review.id) {
        setEditingReview(updated);
        setEditTitle(updated.title);
        setEditContent(updated.content);
      }
      await loadReviews({ showLoading: false });
      toast.success(`已确认「${review.title}」v${review.version}`);
      return true;
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
      setErrorStatus(e instanceof api.ApiError ? e.status : null);
      toast.error(message);
      return false;
    } finally {
      setReviewAction(null);
    }
  };

  const extractKnowledgeFromReview = async (review: Review) => {
    setExtractingKnowledgeId(review.id);
    setNotice("");
    setNoticeHasAction(false);
    setError("");
    setErrorStatus(null);
    try {
      const { cards, skipped } = await api.extractKnowledgeCards({
        content: normalizeReviewContent(review.kind, review.title, review.content),
        source_review_id: review.id,
        source_date: review.period_end,
        max_cards: review.kind === "monthly" ? 12 : 8,
      });
      setNotice(
        cards.length
          ? skipped > 0
            ? `已从「${review.title}」提取 ${cards.length} 张新草稿，跳过 ${skipped} 张与已有卡片重复。`
            : `已从「${review.title}」提取 ${cards.length} 张知识卡片草稿，可到知识工作台确认。`
          : skipped > 0
            ? `这份复盘的 ${skipped} 个知识点已沉淀过，无需重复提取。`
            : "这份复盘里没有足够稳定的知识卡片。"
      );
      setNoticeHasAction(cards.length > 0);
    } catch (e) {
      const message = api.getErrorMessage(e);
      setError(message);
      setErrorStatus(e instanceof api.ApiError ? e.status : null);
      toast.error(message);
    } finally {
      setExtractingKnowledgeId("");
    }
  };

  const togglePeriod = (key: string) => {
    setExpandedPeriods((current) => ({ ...current, [key]: !current[key] }));
  };

  const openCompare = (period: PeriodGroup) => {
    const previous =
      period.versions.find((review) => review.id !== period.latest.id && review.version < period.latest.version) ||
      period.versions.find((review) => review.id !== period.latest.id);
    if (previous) setComparePair({ current: period.latest, previous, versions: period.versions, partial: hasMoreReviews });
  };

  const confirmDiscardChanges = useCallback(() => confirm({
    title: "放弃未保存修改？",
    message: "关闭或取消编辑后，刚才修改的标题和正文不会保存。",
    confirmText: "放弃修改",
  }), [confirm]);

  const openSources = async (review: Review, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) sourceTriggerRef.current = event.currentTarget;
    const requestId = ++sourceRequestRef.current;
    setSourceModal({ review, articles: [], sourceReviews: [], failedCount: 0, loading: true, error: "" });
    const ids = review.kind === "weekly" ? review.source_article_ids : review.source_review_ids;
    if (ids.length === 0) {
      setSourceModal({ review, articles: [], sourceReviews: [], failedCount: 0, loading: false, error: "这份复盘没有可定位的来源。" });
      return;
    }

    if (review.kind === "weekly") {
      const results = await Promise.allSettled(ids.map((id) => api.getArticle(id)));
      if (requestId !== sourceRequestRef.current) return;
      const articles = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failedCount = results.length - articles.length;
      setSourceModal({
        review,
        articles,
        sourceReviews: [],
        failedCount,
        loading: false,
        error: failedCount > 0 ? `${failedCount} 个来源暂时无法加载，可能已被删除。` : "",
      });
      return;
    }

    const results = await Promise.allSettled(ids.map((id) => api.getReview(id)));
    if (requestId !== sourceRequestRef.current) return;
    const sourceReviews = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failedCount = results.length - sourceReviews.length;
    setSourceModal({
      review,
      articles: [],
      sourceReviews,
      failedCount,
      loading: false,
      error: failedCount > 0 ? `${failedCount} 个来源暂时无法加载，可能已被删除。` : "",
    });
  };

  const retrySources = () => {
    if (sourceModal) void openSources(sourceModal.review);
  };

  const closeSources = () => {
    // Invalidate the pending batch before unmounting the dialog. A slow source
    // request must not resurrect a modal the user has already dismissed.
    sourceRequestRef.current += 1;
    setSourceModal(null);
  };

  const openSourceArticle = (article: api.Article) => {
    closeSources();
    const returnTo = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "";
    if (returnTo) {
      const main = document.querySelector<HTMLElement>("main");
      writeSessionStorage(reviewLibraryReturnStorageKey, JSON.stringify({
        path: returnTo,
        expandedPeriods: Object.entries(expandedPeriods).filter(([, expanded]) => expanded).map(([key]) => key),
        scrollTop: main?.scrollTop || 0,
        savedAt: Date.now(),
      } satisfies ReviewLibraryReturnState));
    }
    if (onEditDate) onEditDate(article.date, returnTo || undefined);
    else onNavigate?.("today");
  };

  const openSourceReview = (review: Review) => {
    const trigger = sourceTriggerRef.current;
    closeSources();
    editingTriggerRef.current = trigger;
    sourceTriggerRef.current = null;
    openEditor(review, undefined, true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-surface page-surface-reviews min-h-full px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6"
    >
      <PageHeader
        icon={BookOpenText}
        title="复盘库"
        description="按年月和周期管理 AI 周复盘、月复盘及历史版本"
        actions={onNavigate && (
          <button type="button" onClick={() => onNavigate("stats")} className="ui-button-secondary">
            <Sparkles size={14} /> 去统计生成
          </button>
        )}
        className="mb-4 md:mb-6"
      />

      {error && (
        <div className="mb-4 flex flex-col items-start gap-2">
          <InlineError
            message={error}
            onRetry={reviews.length > 0 ? () => void loadReviews({ showLoading: false }) : undefined}
            retrying={refreshing}
          />
          {(errorStatus === 401 || errorStatus === 0) && onNavigate && reviews.length > 0 && (
            <button type="button" onClick={() => onNavigate("settings")} className="ui-button-secondary h-8 min-h-8 px-3 text-xs">
              去连接设置
            </button>
          )}
        </div>
      )}
      {notice && (
        <div role="status" aria-live="polite" className="ui-alert-good mb-4 flex flex-wrap items-center justify-between gap-2">
          <span>{notice}</span>
          {noticeHasAction && onNavigate && (
            <button type="button" onClick={() => onNavigate("knowledge")} className="font-semibold underline underline-offset-2 hover:opacity-80">
              去知识工作台
            </button>
          )}
        </div>
      )}

      <div className="ui-panel reviews-filter-panel mb-4 p-3 sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-text-subtle)]" size={15} />
          <label htmlFor="review-library-search" className="sr-only">搜索复盘标题、正文、周期或模型</label>
          <input
            id="review-library-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题、正文或周期"
            className={`ui-field h-11 pl-9 ${query ? "pr-20" : "pr-11"} md:h-10`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="ui-icon-button absolute right-10 top-1/2 h-8 w-8 -translate-y-1/2"
              aria-label="清除复盘搜索"
              title="清除搜索"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadReviews({ showLoading: false })}
            disabled={loading || refreshing}
            className="ui-icon-button absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 disabled:cursor-wait"
            aria-label="刷新复盘列表"
            title={refreshing ? "正在刷新复盘列表" : "刷新复盘列表"}
            aria-busy={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <fieldset className="min-w-0">
            <legend className="mb-1.5 px-0.5 text-[11px] font-semibold tracking-wide text-[var(--ui-text-subtle)]">复盘类型</legend>
            <Tabs value={kindFilter} onValueChange={changeKind} aria-label="复盘类型" className="block">
              <TabsList className="w-full">
              {(["all","weekly","monthly"] as const).map((k) => (
                <TabsTrigger key={k} value={k} className="h-8 min-w-0 flex-1 px-2.5">
                  {{all:"全部",weekly:"周复盘",monthly:"月复盘"}[k]}
                </TabsTrigger>
              ))}
              </TabsList>
            </Tabs>
          </fieldset>
          <fieldset className="min-w-0">
            <legend className="mb-1.5 px-0.5 text-[11px] font-semibold tracking-wide text-[var(--ui-text-subtle)]">复盘状态</legend>
            <Tabs value={statusFilter} onValueChange={changeStatus} aria-label="复盘状态" className="block">
              <TabsList className="w-full">
              {(["all","draft","confirmed"] as const).map((s) => (
                <TabsTrigger key={s} value={s} className="h-8 min-w-0 flex-1 px-2.5">
                  {{all:"全部",draft:"草稿",confirmed:"已确认"}[s]}
                </TabsTrigger>
              ))}
              </TabsList>
            </Tabs>
          </fieldset>
        </div>
      </div>

      {!loading && filtered.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[var(--ui-text-subtle)]">
            <span>{hasActiveFilters ? "当前筛选结果" : "全部复盘"} · {summary.total} 个版本</span>
            {summary.latest !== "暂无" && <span>最近生成 {formatReviewTimestamp(summary.latest)}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <ReviewMetric icon={Layers3} label="复盘版本" value={summary.total} tone="accent" />
            <ReviewMetric icon={CheckCircle2} label="已确认" value={summary.confirmed} tone="green" />
            <ReviewMetric icon={FileClock} label="草稿" value={summary.drafts} tone="amber" />
            <ReviewMetric icon={BookOpenText} label="本月周复盘待确认" value={summary.currentMonthWeeklyDrafts} tone="gray" />
          </div>
        </div>
      )}

      <div className="reviews-content-stage min-h-[320px]">
        {loading ? (
          <LoadingState label="加载复盘..." rows={3} />
        ) : monthGroups.length === 0 ? (
          <EmptyState
            icon={BookOpenText}
            title={error && reviews.length === 0 ? "暂时无法加载复盘" : hasActiveFilters ? "没有符合条件的复盘" : "还没有周期回顾"}
            description={error && reviews.length === 0
              ? "请检查连接后重试；如果是首次使用，可到设置页确认服务器地址和令牌。"
              : hasActiveFilters
                ? "当前筛选没有结果，清除筛选后继续浏览。"
                : "先在统计页生成周复盘或月复盘，生成的版本会保留在这里。"}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {error && reviews.length === 0 && (
                  <button type="button" onClick={() => void loadReviews({ showLoading: false })} disabled={loading || refreshing} aria-busy={refreshing} className="ui-button-primary disabled:cursor-wait">
                    {refreshing && <LoaderCircle size={14} className="animate-spin" />}
                    {refreshing ? "重试中…" : "重试加载"}
                  </button>
                )}
                {hasActiveFilters && !(error && reviews.length === 0) && (
                  <button type="button" onClick={clearFilters} className="ui-button-secondary">
                    清除筛选
                  </button>
                )}
                {!hasActiveFilters && !(error && reviews.length === 0) && onNavigate && (
                  <button type="button" onClick={() => onNavigate("stats")} className="ui-button-primary">
                    <Sparkles size={14} /> 去统计生成
                  </button>
                )}
                {error && reviews.length === 0 && onNavigate && (
                  <button type="button" onClick={() => onNavigate("settings")} className="ui-button-secondary">
                    去连接设置
                  </button>
                )}
              </div>
            }
          />
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[11px] text-[var(--ui-text-subtle)]">
              <span>
                按月份整理 · 显示 {visibleMonthGroups.length} / {monthGroups.length} 个月
                {hasMoreReviews && ` · 已加载 ${filtered.length} / ${summary.total} 个版本（当前页）`}
              </span>
              {(canRevealMoreMonths || hasMoreReviews) && (
                <button
                  type="button"
                  onClick={() => {
                    if (canRevealMoreMonths) setVisibleMonthCount((count) => count + MONTH_PAGE_SIZE);
                    else void loadReviews({ showLoading: false, append: true });
                  }}
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                  className="font-semibold text-[var(--ui-accent-text)] hover:underline disabled:cursor-wait disabled:opacity-70"
                >
                  {loadingMore ? "加载中…" : canRevealMoreMonths ? "显示更早月份" : "加载更早复盘"}
                </button>
              )}
            </div>
            <div className="space-y-4">
              {visibleMonthGroups.map((group) => (
                <section key={group.month} className="ui-panel p-3 sm:p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[var(--ui-text)]">{formatReviewMonth(group.month)}</h3>
                    <span className="text-xs text-[var(--ui-text-subtle)]">{group.periods.length} 个周期</span>
                  </div>
                  <div className="space-y-3">
                    {group.periods.map((period) => (
                      <PeriodCard
                        key={period.key}
                        period={period}
                        expanded={!!expandedPeriods[period.key]}
                        onToggle={() => togglePeriod(period.key)}
                        onOpen={openEditor}
                        onConfirm={confirmReview}
                        onDelete={deleteReview}
                        onOpenSources={openSources}
                        actionInFlight={reviewAction}
              partial={hasMoreReviews}
                        onCompare={(event) => {
                          compareTriggerRef.current = event.currentTarget;
                          openCompare(period);
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      {editingReview && (
        <ReviewViewerModal
          review={editingReview}
          title={editTitle}
          content={editContent}
          saving={saving || !!reviewAction}
          onTitleChange={setEditTitle}
          onContentChange={setEditContent}
          onSave={() => saveReview()}
          onConfirm={() => saveReview("confirmed")}
          onDelete={() => deleteReview(editingReview)}
          onExtractKnowledge={() => extractKnowledgeFromReview(editingReview)}
          extractingKnowledge={extractingKnowledgeId === editingReview.id}
          onOpenSources={(event) => void openSources(editingReview, event)}
          onDiscardChanges={confirmDiscardChanges}
          readOnly={viewerReadOnly}
          onClose={() => { setEditingReview(null); setViewerReadOnly(false); }}
          onRestoreFocus={() => editingTriggerRef.current?.focus()}
        />
      )}
      {comparePair && (
        <ReviewCompareModal
          current={comparePair.current}
          previous={comparePair.previous}
          versions={comparePair.versions}
          partial={comparePair.partial}
          onClose={() => setComparePair(null)}
          onRestoreFocus={() => compareTriggerRef.current?.focus()}
        />
      )}
      {sourceModal && (
        <ReviewSourcesModal
          state={sourceModal}
          onClose={closeSources}
          onRetry={retrySources}
          onOpenArticle={openSourceArticle}
          onOpenReview={openSourceReview}
          onRestoreFocus={() => sourceTriggerRef.current?.focus()}
        />
      )}
      {dialog}
    </motion.div>
  );
}

function ReviewMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: "accent" | "green" | "amber" | "gray";
}) {
  const toneClass = {
    accent: "ui-status-accent",
    green: "ui-status-success",
    amber: "ui-status-warning",
    gray: "ui-status-muted",
  }[tone];

  return (
    <div className="ui-panel flex items-center gap-3 px-3 py-2.5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <div className="min-w-0">
        <div className="text-lg font-bold leading-none text-[var(--ui-text)]">{value}</div>
        <div className="mt-1 truncate text-[11px] text-[var(--ui-text-subtle)]">{label}</div>
      </div>
    </div>
  );
}

function PeriodCard({
  period,
  expanded,
  onToggle,
  onOpen,
  onConfirm,
  onDelete,
  onOpenSources,
  actionInFlight,
  partial,
  onCompare,
}: {
  period: PeriodGroup;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (review: Review, event?: React.MouseEvent<HTMLButtonElement>) => void;
  onConfirm: (review: Review) => void | Promise<boolean>;
  onDelete: (review: Review) => void | Promise<boolean>;
  onOpenSources: (review: Review, event?: React.MouseEvent<HTMLButtonElement>) => void;
  actionInFlight: ReviewAction | null;
  partial: boolean;
  onCompare: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const latest = period.latest;
  const confirmedVersion = period.confirmed && period.confirmed.id !== latest.id ? period.confirmed : null;
  const previewContent = reviewPreview(latest.kind, latest.title, latest.content, 300);
  const kindLabel = period.kind === "weekly" ? "周复盘" : "月复盘";
  const sourceCount = period.kind === "weekly"
    ? latest.source_article_ids.length
    : latest.source_review_ids.length;
  const versionsId = `review-versions-${period.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <article className="ui-panel-muted reviews-period-card relative p-3 pl-7 transition-colors hover:border-[var(--ui-selected-border)] sm:p-4 sm:pl-8">
      <div className="absolute bottom-3 left-3 top-3 w-px bg-[var(--ui-border)]" />
      <div
        className={[
          "absolute left-[7px] top-5 h-3 w-3 rounded-full ring-4",
          period.kind === "monthly"
            ? "ui-status-accent ring-[var(--ui-surface-selected)]"
              : latest.status === "confirmed"
              ? "ui-status-success ring-[var(--ui-success-surface)]"
              : "ui-status-warning ring-[var(--ui-warning-surface)]",
        ].join(" ")}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="ui-chip h-6 px-2 py-0 text-[11px]">
              {kindLabel} · {period.periodStart} 至 {period.periodEnd}
            </span>
            <ReviewStatusPill status={latest.status} />
            <span className="ui-chip h-6 px-2 py-0 text-[11px] text-[var(--ui-accent-text)]">
              <Pin size={11} />
              最新生成
            </span>
            {confirmedVersion && (
              <span className="ui-status-success inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium" title={`已确认版本为 v${confirmedVersion.version}，最新生成版本为 v${latest.version}`}>
                <CheckCircle2 size={11} />
                已确认 v{confirmedVersion.version}
              </span>
            )}
            <span className="ui-chip h-6 px-2 py-0 text-[11px] text-[var(--ui-text-subtle)]">
              最新生成 v{latest.version} · {partial ? `当前页 ${period.versions.length} 版` : `共 ${period.versions.length} 版`}
            </span>
            {sourceCount > 0 ? (
              <button
                type="button"
                onClick={(event) => onOpenSources(latest, event)}
                disabled={!!actionInFlight}
                className="ui-chip h-7 min-h-10 px-2 py-0 text-[11px] text-[var(--ui-accent-text)] underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40 disabled:cursor-wait disabled:opacity-50 sm:min-h-7"
                title={`查看这份${kindLabel}的来源`}
              >
                来源 {sourceCount} {period.kind === "weekly" ? "篇" : "个"}
              </button>
            ) : (
              <span className="ui-chip h-6 px-2 py-0 text-[11px] text-[var(--ui-text-subtle)]">
                来源 0 {period.kind === "weekly" ? "篇" : "个"}
              </span>
            )}
          </div>
          {confirmedVersion && latest.status === "draft" && (
            <div className="reviews-baseline-note mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-5" role="note">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <p><strong>最新生成 v{latest.version} 仍是草稿。</strong> 已确认基线是 v{confirmedVersion.version}，确认最新版本后才会更新。</p>
            </div>
          )}
          <h4 className="break-words text-sm font-semibold text-[var(--ui-text)]">{latest.title || "（无标题）"}</h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ui-text-muted)]">
            {previewContent}
          </p>
          <div className="mt-2 text-[11px] text-[var(--ui-text-subtle)]">
            生成于 {formatReviewTimestamp(latest.generated_at)}
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-32">
          <button
            type="button"
            onClick={(event) => onOpen(latest, event)}
            disabled={!!actionInFlight}
            aria-busy={actionInFlight?.id === latest.id}
            className="ui-button-primary w-full disabled:cursor-wait"
          >
            查看最新生成
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={!!actionInFlight}
            className="ui-button-secondary w-full disabled:cursor-wait"
            aria-expanded={expanded}
            aria-controls={versionsId}
          >
            <ChevronDown size={14} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
            {expanded ? "收起版本" : `${partial ? "查看当前页 " : "查看 "}${period.versions.length} 个版本`}
          </button>
          {period.versions.length > 1 && (
            <button
              type="button"
              onClick={onCompare}
              disabled={!!actionInFlight}
              className="ui-button-ghost w-full disabled:cursor-wait"
            >
              <GitCompareArrows size={14} />
              版本对比
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div id={versionsId} className="mt-3 space-y-2 border-t border-[var(--ui-border)] pt-3">
          {period.versions.map((review) => {
            const itemAction = actionInFlight?.id === review.id ? actionInFlight.kind : null;
            return (
              <div key={review.id} className="ui-panel-muted rounded-lg p-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-[var(--ui-text-muted)]">v{review.version}</span>
                      <ReviewStatusPill status={review.status} />
                      {review.id === latest.id && (
                        <span className="ui-status-accent rounded-full px-2 py-0.5 text-[11px] font-medium">
                          最新
                        </span>
                      )}
                      {review.id === period.confirmed?.id && (
                        <span className="ui-status-success rounded-full px-2 py-0.5 text-[11px] font-medium">已确认版本</span>
                      )}
                      <span className="text-[11px] text-[var(--ui-text-subtle)]">{formatReviewTimestamp(review.generated_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--ui-text-muted)]">{review.title}</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={(event) => onOpen(review, event)}
                      disabled={!!actionInFlight}
                      className="ui-button-secondary h-8 min-h-10 w-full disabled:cursor-wait sm:min-h-8 sm:w-auto"
                    >
                      查看/编辑
                    </button>
                    {review.status !== "confirmed" && (
                      <button
                        type="button"
                        onClick={() => void onConfirm(review)}
                        disabled={!!actionInFlight}
                        aria-busy={itemAction === "confirm"}
                        className="ui-button-success h-8 min-h-10 w-full px-3 text-xs disabled:cursor-wait sm:min-h-8 sm:w-auto"
                      >
                        {itemAction === "confirm" ? <LoaderCircle size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                        {itemAction === "confirm" ? "确认中…" : "确认版本"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void onDelete(review)}
                      disabled={!!actionInFlight}
                      aria-busy={itemAction === "delete"}
                      className="ui-button-danger h-8 min-h-10 w-full disabled:cursor-wait sm:min-h-8 sm:w-auto"
                    >
                      {itemAction === "delete" ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      {itemAction === "delete" ? "删除中…" : "删除"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function ReviewCompareModal({
  current,
  previous,
  versions,
  partial,
  onClose,
  onRestoreFocus,
}: {
  current: Review;
  previous: Review;
  versions: Review[];
  partial: boolean;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const [currentId, setCurrentId] = useState(current.id);
  const [previousId, setPreviousId] = useState(previous.id);

  useEffect(() => {
    setCurrentId(current.id);
    setPreviousId(previous.id);
  }, [current.id, previous.id]);

  const currentReview = versions.find((review) => review.id === currentId) || current;
  const previousReview = versions.find((review) => review.id === previousId) || previous;
  const previousOptions = versions.filter((review) => review.id !== currentReview.id);

  const selectCurrent = (id: string) => {
    setCurrentId(id);
    if (id === previousId) {
      const fallback = versions.find((review) => review.id !== id);
      if (fallback) setPreviousId(fallback.id);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="ui-modal-surface fixed inset-x-3 bottom-3 z-50 flex max-h-[min(92dvh,860px)] max-w-6xl flex-col overflow-hidden outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
        >
          <div className="ui-soft-divider flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
            <div>
              <div className="flex items-center gap-2">
                <GitCompareArrows size={17} className="text-[var(--ui-accent-text)]" />
                <Dialog.Title className="text-base font-bold text-[var(--ui-text)]">版本对比</Dialog.Title>
              </div>
              <Dialog.Description className="mt-1 text-xs text-[var(--ui-text-subtle)]">
                {currentReview.period_start} 至 {currentReview.period_end} · v{currentReview.version} 对比 v{previousReview.version}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="ui-icon-button h-9 w-9" aria-label="关闭版本对比">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          {versions.length > 2 && (
            <div className="ui-soft-divider grid gap-3 border-b px-4 py-3 sm:grid-cols-2 sm:px-5">
              <label className="min-w-0 text-xs font-semibold text-[var(--ui-text-muted)]">
                主版本
                <select
                  value={currentReview.id}
                  onChange={(event) => selectCurrent(event.target.value)}
                  className="ui-field mt-1.5 h-10 w-full text-sm font-normal"
                  aria-label="选择主版本"
                >
                  {versions.map((review) => (
                    <option key={review.id} value={review.id}>
                      v{review.version} · {review.status === "confirmed" ? "已确认" : "草稿"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 text-xs font-semibold text-[var(--ui-text-muted)]">
                对比版本
                <select
                  value={previousReview.id}
                  onChange={(event) => setPreviousId(event.target.value)}
                  className="ui-field mt-1.5 h-10 w-full text-sm font-normal"
                  aria-label="选择对比版本"
                >
                  {previousOptions.map((review) => (
                    <option key={review.id} value={review.id}>
                      v{review.version} · {review.status === "confirmed" ? "已确认" : "草稿"}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] font-normal leading-5 text-[var(--ui-text-subtle)] sm:col-span-2">
                {partial
                  ? `当前只加载了这组复盘的 ${versions.length} 个版本；加载更早复盘后，才能继续选择更早版本。`
                  : "可选择任意两个已加载版本，核对内容变化和确认状态。"}
              </p>
            </div>
          )}
          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-2">
            <ComparePane label="主版本" review={currentReview} accent />
            <ComparePane label="对比版本" review={previousReview} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ComparePane({ label, review, accent = false }: { label: string; review: Review; accent?: boolean }) {
  return (
    <section className={["ui-soft-divider min-h-[280px] border-t p-4 sm:min-h-[360px] md:border-l md:border-t-0", accent ? "border-t-0 md:border-l-0" : ""].join(" ")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={[
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            accent
              ? "ui-status-accent"
              : "ui-status-muted",
          ].join(" ")}
        >
          {label}
        </span>
        <ReviewStatusPill status={review.status} />
        <span className="text-xs text-[var(--ui-text-subtle)]">v{review.version}</span>
      </div>
      <h4 className="mb-3 text-sm font-semibold text-[var(--ui-text)]">{review.title || "（无标题）"}</h4>
      <div className="ui-panel-muted max-w-none p-3">
        <MarkdownContent content={reviewBodyContent(review.kind, review.title, review.content)} />
      </div>
    </section>
  );
}

function ReviewSourcesModal({
  state,
  onClose,
  onRetry,
  onOpenArticle,
  onOpenReview,
  onRestoreFocus,
}: {
  state: SourceModalState;
  onClose: () => void;
  onRetry: () => void;
  onOpenArticle: (article: api.Article) => void;
  onOpenReview: (review: Review) => void;
  onRestoreFocus: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isWeekly = state.review.kind === "weekly";
  const sourceCount = isWeekly ? state.review.source_article_ids.length : state.review.source_review_ids.length;
  const loadedCount = state.articles.length + state.sourceReviews.length;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="ui-modal-surface fixed inset-x-3 bottom-3 z-50 flex max-h-[min(92dvh,760px)] max-w-2xl flex-col overflow-hidden outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2"
          onOpenAutoFocus={(event) => {
            if (!headingRef.current) return;
            event.preventDefault();
            headingRef.current.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
        >
          <div className="ui-soft-divider flex items-start justify-between gap-3 border-b px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <Dialog.Title asChild>
                <h2 ref={headingRef} tabIndex={-1} className="text-base font-bold text-[var(--ui-text)]">查看来源</h2>
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-[var(--ui-text-subtle)]">
                {isWeekly ? "周复盘" : "月复盘"} · {state.review.period_start} 至 {state.review.period_end} · 共 {sourceCount} {isWeekly ? "篇今日记录" : "个周期回顾"}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="ui-icon-button h-11 w-11 shrink-0 sm:h-9 sm:w-9" aria-label="关闭来源列表" title="关闭来源列表">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {state.loading ? (
              <div className="ui-panel-muted flex min-h-32 items-center justify-center gap-2 text-sm text-[var(--ui-text-muted)]" role="status" aria-live="polite">
                <LoaderCircle size={16} className="animate-spin text-[var(--ui-accent-text)]" /> 正在加载来源…
              </div>
            ) : (
              <>
                {state.error && (
                  <div className="ui-alert-bad mb-3 flex flex-wrap items-center justify-between gap-2" role="alert">
                    <span>{state.error}</span>
                    <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">重试</button>
                  </div>
                )}
                {loadedCount === 0 ? (
                  <div className="ui-panel-muted flex min-h-32 items-center justify-center px-4 text-center text-sm text-[var(--ui-text-subtle)]">
                    暂时没有可打开的来源。
                  </div>
                ) : (
                  <ul className="space-y-2" aria-label="复盘来源列表">
                    {state.articles.map((article) => (
                      <li key={article.id} className="ui-panel-muted flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-chip h-6 gap-1 px-2 py-0 text-[11px]"><CalendarDays size={12} /> {article.date}</span>
                            <span className="text-xs font-semibold text-[var(--ui-text)]">{article.title || "（无标题）"}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ui-text-muted)]">
                            {reviewExcerpt(article.content || "暂无正文", 150)}
                          </p>
                        </div>
                        <button type="button" onClick={() => onOpenArticle(article)} className="ui-button-secondary min-h-11 w-full shrink-0 px-3 text-xs sm:h-9 sm:min-h-9 sm:w-auto">
                          打开今日记录
                        </button>
                      </li>
                    ))}
                    {state.sourceReviews.map((review) => (
                      <li key={review.id} className="ui-panel-muted flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-chip h-6 px-2 py-0 text-[11px]">{review.kind === "weekly" ? "周复盘" : "月复盘"}</span>
                            <ReviewStatusPill status={review.status} />
                            <span className="text-[11px] text-[var(--ui-text-subtle)]">v{review.version}</span>
                          </div>
                          <p className="mt-1 truncate text-xs font-semibold text-[var(--ui-text)]">{review.title || "（无标题）"}</p>
                          <p className="mt-0.5 text-[11px] text-[var(--ui-text-subtle)]">{review.period_start} 至 {review.period_end}</p>
                        </div>
                        <button type="button" onClick={() => onOpenReview(review)} className="ui-button-secondary min-h-11 w-full shrink-0 px-3 text-xs sm:h-9 sm:min-h-9 sm:w-auto">
                          查看复盘
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="ui-soft-divider border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] text-xs text-[var(--ui-text-subtle)] sm:px-5 sm:pb-3">
            点击来源可回到原始内容，帮助核对这份周期回顾的依据。
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function majorityMonth(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const counts = new Map<string, number>();
  const d = new Date(s);
  while (d <= e) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    d.setDate(d.getDate() + 1);
  }
  let best = start.slice(0, 7);
  let bestCount = 0;
  for (const [month, count] of counts) {
    if (count > bestCount) {
      best = month;
      bestCount = count;
    }
  }
  return best;
}

function groupReviewsByMonth(reviews: Review[]): MonthGroup[] {
  const periodMap = new Map<string, Review[]>();
  for (const review of reviews) {
    const key = `${review.kind}:${review.period_start}:${review.period_end}`;
    periodMap.set(key, [...(periodMap.get(key) || []), review]);
  }

  const monthMap = new Map<string, PeriodGroup[]>();
  for (const [key, versions] of periodMap.entries()) {
    const sorted = [...versions].sort((a, b) => b.version - a.version || b.generated_at.localeCompare(a.generated_at));
    const latest = selectLatestReview(sorted);
    if (!latest) continue;
    const confirmed = sorted.find((review) => review.status === "confirmed") || null;
    const orderedVersions = [latest, ...sorted.filter((review) => review.id !== latest.id)];
    const month = majorityMonth(latest.period_start, latest.period_end);
    const period: PeriodGroup = {
      key,
      kind: latest.kind,
      periodStart: latest.period_start,
      periodEnd: latest.period_end,
      latest,
      confirmed,
      versions: orderedVersions,
    };
    monthMap.set(month, [...(monthMap.get(month) || []), period]);
  }

  return [...monthMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, periods]) => ({
      month,
      periods: periods.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "monthly" ? -1 : 1;
        return b.periodStart.localeCompare(a.periodStart);
      }),
    }));
}
