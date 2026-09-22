import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BookOpenText,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileClock,
  GitCompareArrows,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import type { Review, ReviewKind, ReviewStatus } from "../lib/api";
import type { Page } from "../App";
import {
  formatReviewMonth,
  formatReviewTimestamp,
  normalizeReviewContent,
  reviewBodyContent,
  reviewExcerpt,
  reviewPreview,
} from "../lib/reviewContent";
import { selectLatestReview } from "../lib/reviewGeneration";
import { ReviewViewerModal, ReviewStatusPill } from "./reviews/ReviewShared";
import MarkdownContent from "./MarkdownContent";
import {
  EmptyState,
  InlineError,
  LoadingState,
  useConfirmDialog,
} from "./ui/Feedback";
import WorkspaceHeader from "./workspace/WorkspaceHeader";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import {
  readSessionStorage,
  removeSessionStorage,
  reviewLibraryReturnStorageKey,
  writeSessionStorage,
} from "../lib/storage";
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
      typeof parsed.path !== "string" ||
      !Array.isArray(parsed.expandedPeriods) ||
      typeof parsed.scrollTop !== "number" ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > REVIEW_RETURN_MAX_AGE_MS
    )
      return null;
    return {
      path: parsed.path,
      expandedPeriods: parsed.expandedPeriods.filter(
        (key): key is string => typeof key === "string",
      ),
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
  const [kindFilter, setKindFilter] = useState<KindFilter>(
    initialKind || "all",
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialStatus || "all",
  );
  const [query, setQuery] = useState(initialQuery || "");
  const [expandedPeriods, setExpandedPeriods] = useState<
    Record<string, boolean>
  >({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [viewerReadOnly, setViewerReadOnly] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [comparePair, setComparePair] = useState<{
    current: Review;
    previous: Review;
    versions: Review[];
    partial: boolean;
  } | null>(null);
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

  const loadReviews = useCallback(
    async ({
      showLoading = true,
      append = false,
    }: { showLoading?: boolean; append?: boolean } = {}) => {
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
          setReviews((current) =>
            append
              ? [
                  ...current,
                  ...result.reviews.filter(
                    (review) => !current.some((item) => item.id === review.id),
                  ),
                ]
              : result.reviews,
          );
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
    },
    [kindFilter, query, statusFilter],
  );

  useEffect(() => {
    onQueryChangeRef.current = onQueryChange;
  }, [onQueryChange]);

  useEffect(() => {
    const nextQuery = initialQuery || "";
    lastSyncedQueryRef.current = nextQuery.trim();
    setQuery((current) => (current === nextQuery ? current : nextQuery));
  }, [initialQuery]);

  useEffect(() => {
    const nextKind = initialKind || "all";
    setKindFilter((current) => (current === nextKind ? current : nextKind));
  }, [initialKind]);

  useEffect(() => {
    const nextStatus = initialStatus || "all";
    setStatusFilter((current) =>
      current === nextStatus ? current : nextStatus,
    );
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
    setExpandedPeriods(
      Object.fromEntries(saved.expandedPeriods.map((key) => [key, true])),
    );
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("main")
        ?.scrollTo({ top: saved.scrollTop, behavior: "auto" });
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

  const hasActiveFilters =
    kindFilter !== "all" || statusFilter !== "all" || query.trim().length > 0;
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

  const openEditor = (
    review: Review,
    event?: React.MouseEvent<HTMLButtonElement>,
    readOnly = false,
  ) => {
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
      toast.success(
        status === "confirmed"
          ? "已确认此复盘版本"
          : updated.status === "confirmed"
            ? "复盘修改已保存"
            : "复盘草稿已保存",
      );
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
      const updated = await api.updateReview(review.id, {
        status: "confirmed",
      });
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
        content: normalizeReviewContent(
          review.kind,
          review.title,
          review.content,
        ),
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
            : "这份复盘里没有足够稳定的知识卡片。",
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
      period.versions.find(
        (review) =>
          review.id !== period.latest.id &&
          review.version < period.latest.version,
      ) || period.versions.find((review) => review.id !== period.latest.id);
    if (previous)
      setComparePair({
        current: period.latest,
        previous,
        versions: period.versions,
        partial: hasMoreReviews,
      });
  };

  const confirmDiscardChanges = useCallback(
    () =>
      confirm({
        title: "放弃未保存修改？",
        message: "关闭或取消编辑后，刚才修改的标题和正文不会保存。",
        confirmText: "放弃修改",
      }),
    [confirm],
  );

  const openSources = async (
    review: Review,
    event?: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (event) sourceTriggerRef.current = event.currentTarget;
    const requestId = ++sourceRequestRef.current;
    setSourceModal({
      review,
      articles: [],
      sourceReviews: [],
      failedCount: 0,
      loading: true,
      error: "",
    });
    const ids =
      review.kind === "weekly"
        ? review.source_article_ids
        : review.source_review_ids;
    if (ids.length === 0) {
      setSourceModal({
        review,
        articles: [],
        sourceReviews: [],
        failedCount: 0,
        loading: false,
        error: "这份复盘没有可定位的来源。",
      });
      return;
    }

    if (review.kind === "weekly") {
      const results = await Promise.allSettled(
        ids.map((id) => api.getArticle(id)),
      );
      if (requestId !== sourceRequestRef.current) return;
      const articles = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failedCount = results.length - articles.length;
      setSourceModal({
        review,
        articles,
        sourceReviews: [],
        failedCount,
        loading: false,
        error:
          failedCount > 0
            ? `${failedCount} 个来源暂时无法加载，可能已被删除。`
            : "",
      });
      return;
    }

    const results = await Promise.allSettled(
      ids.map((id) => api.getReview(id)),
    );
    if (requestId !== sourceRequestRef.current) return;
    const sourceReviews = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failedCount = results.length - sourceReviews.length;
    setSourceModal({
      review,
      articles: [],
      sourceReviews,
      failedCount,
      loading: false,
      error:
        failedCount > 0
          ? `${failedCount} 个来源暂时无法加载，可能已被删除。`
          : "",
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
    const returnTo =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "";
    if (returnTo) {
      const main = document.querySelector<HTMLElement>("main");
      writeSessionStorage(
        reviewLibraryReturnStorageKey,
        JSON.stringify({
          path: returnTo,
          expandedPeriods: Object.entries(expandedPeriods)
            .filter(([, expanded]) => expanded)
            .map(([key]) => key),
          scrollTop: main?.scrollTop || 0,
          savedAt: Date.now(),
        } satisfies ReviewLibraryReturnState),
      );
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
    <div className="wb-page rp-page">
      <WorkspaceHeader
        icon={BookOpenText}
        title="复盘"
        actions={
          onNavigate && (
            <button
              type="button"
              className="ui-button-primary"
              onClick={() => onNavigate("stats")}
              title="前往统计页生成周复盘或月复盘"
            >
              <Sparkles size={15} />
              生成复盘
            </button>
          )
        }
      />
      {error && (
        <div className="mb-4 flex flex-col items-start gap-2">
          <InlineError
            message={error}
            onRetry={
              reviews.length > 0
                ? () => void loadReviews({ showLoading: false })
                : undefined
            }
            retrying={refreshing}
          />
          {(errorStatus === 401 || errorStatus === 0) &&
            onNavigate &&
            reviews.length > 0 && (
              <button
                type="button"
                onClick={() => onNavigate("settings")}
                className="ui-button-secondary h-8 min-h-8 px-3 text-xs"
              >
                去连接设置
              </button>
            )}
        </div>
      )}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="ui-alert-good mb-4 flex flex-wrap items-center justify-between gap-2"
        >
          <span>{notice}</span>
          {noticeHasAction && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("knowledge")}
              className="font-semibold underline underline-offset-2 hover:opacity-80"
            >
              去知识工作台
            </button>
          )}
        </div>
      )}

      <div className="rp-layout">
        <aside className="rp-navigation">
          <div className="rp-nav-heading">
            <span className="wb-eyebrow">周期回顾</span>
            <BookOpenText size={15} />
          </div>
          <button
            type="button"
            className="rp-nav-item"
            data-active={statusFilter === "all"}
            onClick={() => changeStatus("all")}
          >
            <Layers3 size={16} />
            <span>全部版本</span>
            <b>{summary.total}</b>
          </button>
          <button
            type="button"
            className="rp-nav-item"
            data-active={statusFilter === "draft"}
            onClick={() => changeStatus("draft")}
          >
            <FileClock size={16} />
            <span>待确认草稿</span>
            <b>{summary.drafts}</b>
          </button>
          <button
            type="button"
            className="rp-nav-item"
            data-active={statusFilter === "confirmed"}
            onClick={() => changeStatus("confirmed")}
          >
            <CheckCircle2 size={16} />
            <span>已确认版本</span>
            <b>{summary.confirmed}</b>
          </button>
          <div className="rp-month-nav">
            <span className="wb-eyebrow">当前已加载月份</span>
            {visibleMonthGroups.map((group) => (
              <button
                type="button"
                key={group.month}
                onClick={() =>
                  document
                    .getElementById(`review-month-${group.month}`)
                    ?.scrollIntoView({
                      block: "start",
                      behavior: window.matchMedia(
                        "(prefers-reduced-motion: reduce)",
                      ).matches
                        ? "auto"
                        : "smooth",
                    })
                }
              >
                <CalendarDays size={14} />
                {formatReviewMonth(group.month)}
                <span>{group.periods.length}</span>
              </button>
            ))}
          </div>
          <p className="rp-nav-note">
            保留每次生成的版本。
            <br />
            新草稿不会覆盖已确认内容。
          </p>
        </aside>
        <section className="rp-main">
          <div className="rp-library-heading">
            <div>
              <span className="wb-eyebrow">复盘档案</span>
              <h2>
                {kindFilter === "weekly"
                  ? "每周回顾"
                  : kindFilter === "monthly"
                    ? "每月回顾"
                    : "所有周期"}
              </h2>
            </div>
            <span>{loading ? "读取中…" : `${summary.total} 个版本`}</span>
          </div>
          <div className="rp-tools">
            <label className="wb-search">
              <Search size={16} />
              <input
                id="review-library-search"
                type="search"
                aria-label="搜索复盘标题、正文、周期或模型"
                placeholder="搜索标题、正文或周期"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="wb-icon-button"
                  aria-label="清除复盘搜索"
                  onClick={() => setQuery("")}
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <button
              type="button"
              className="wb-icon-button"
              aria-label="刷新复盘列表"
              onClick={() => void loadReviews({ showLoading: false })}
              disabled={loading || refreshing}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "animate-spin" : ""}
              />
            </button>
          </div>
          <div className="rp-filterbar">
            <Tabs value={kindFilter} onValueChange={changeKind}>
              <TabsList aria-label="复盘类型">
                {(["all", "weekly", "monthly"] as const).map((kind) => (
                  <TabsTrigger key={kind} value={kind}>
                    {
                      { all: "全部周期", weekly: "周复盘", monthly: "月复盘" }[
                        kind
                      ]
                    }
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="rp-status-filter">
              <label htmlFor="review-status-select" className="sr-only">
                复盘状态
              </label>
              <select
                id="review-status-select"
                value={statusFilter}
                onChange={(event) => changeStatus(event.target.value)}
              >
                <option value="all">全部状态</option>
                <option value="draft">待确认草稿</option>
                <option value="confirmed">已确认版本</option>
              </select>
            </div>
            {hasActiveFilters && (
              <button type="button" className="rp-clear" onClick={clearFilters}>
                清除筛选
                <X size={12} />
              </button>
            )}
          </div>
          {!loading && summary.latest !== "暂无" && (
            <p className="rp-result-note">
              最近生成 {formatReviewTimestamp(summary.latest)} ·{" "}
              {hasActiveFilters ? "当前筛选结果" : "按时间归档"}
            </p>
          )}
          <div className="reviews-content-stage min-w-0 min-h-[320px]">
            {loading ? (
              <LoadingState label="加载复盘..." rows={3} />
            ) : monthGroups.length === 0 ? (
              <EmptyState
                icon={BookOpenText}
                title={
                  error && reviews.length === 0
                    ? "暂时无法加载复盘"
                    : hasActiveFilters
                      ? "没有符合条件的复盘"
                      : "还没有周期回顾"
                }
                description={
                  error && reviews.length === 0
                    ? "请检查连接后重试；如果是首次使用，可到设置页确认服务器地址和令牌。"
                    : hasActiveFilters
                      ? "当前筛选没有结果，清除筛选后继续浏览。"
                      : "先在统计页生成周复盘或月复盘，生成的版本会保留在这里。"
                }
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {error && reviews.length === 0 && (
                      <button
                        type="button"
                        onClick={() => void loadReviews({ showLoading: false })}
                        disabled={loading || refreshing}
                        aria-busy={refreshing}
                        className="ui-button-primary disabled:cursor-wait"
                      >
                        {refreshing && (
                          <LoaderCircle size={14} className="animate-spin" />
                        )}
                        {refreshing ? "重试中…" : "重试加载"}
                      </button>
                    )}
                    {hasActiveFilters && !(error && reviews.length === 0) && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="ui-button-secondary"
                      >
                        清除筛选
                      </button>
                    )}
                    {!hasActiveFilters &&
                      !(error && reviews.length === 0) &&
                      onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate("stats")}
                          className="ui-button-primary"
                        >
                          <Sparkles size={14} /> 去统计生成
                        </button>
                      )}
                    {error && reviews.length === 0 && onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate("settings")}
                        className="ui-button-secondary"
                      >
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
                    按月份整理 · 显示 {visibleMonthGroups.length} /{" "}
                    {monthGroups.length} 个月
                    {hasMoreReviews &&
                      ` · 已加载 ${filtered.length} / ${summary.total} 个版本（当前页）`}
                  </span>
                  {(canRevealMoreMonths || hasMoreReviews) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (canRevealMoreMonths)
                          setVisibleMonthCount(
                            (count) => count + MONTH_PAGE_SIZE,
                          );
                        else
                          void loadReviews({
                            showLoading: false,
                            append: true,
                          });
                      }}
                      disabled={loadingMore}
                      aria-busy={loadingMore}
                      className="font-semibold text-[var(--ui-accent-text)] hover:underline disabled:cursor-wait disabled:opacity-70"
                    >
                      {loadingMore
                        ? "加载中…"
                        : canRevealMoreMonths
                          ? "显示更早月份"
                          : "加载更早复盘"}
                    </button>
                  )}
                </div>
                <div className="rp-month-list">
                  {visibleMonthGroups.map((group) => (
                    <section
                      key={group.month}
                      id={`review-month-${group.month}`}
                      className="rp-month-group"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-[var(--ui-text)]">
                          {formatReviewMonth(group.month)}
                        </h3>
                        <span className="text-xs text-[var(--ui-text-subtle)]">
                          {group.periods.length} 个周期
                        </span>
                      </div>
                      <div className="rp-period-list">
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
        </section>
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
          onClose={() => {
            setEditingReview(null);
            setViewerReadOnly(false);
          }}
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
  onOpenSources: (
    review: Review,
    event?: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  actionInFlight: ReviewAction | null;
  partial: boolean;
  onCompare: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const latest = period.latest;
  const confirmedVersion =
    period.confirmed && period.confirmed.id !== latest.id
      ? period.confirmed
      : null;
  const previewContent = reviewPreview(
    latest.kind,
    latest.title,
    latest.content,
    300,
  );
  const kindLabel = period.kind === "weekly" ? "周复盘" : "月复盘";
  const sourceCount =
    period.kind === "weekly"
      ? latest.source_article_ids.length
      : latest.source_review_ids.length;
  const versionsId = `review-versions-${period.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <article className="wb-panel rp-period" data-kind={period.kind}>
      <div className="rp-period-main">
        <div className="rp-period-date">
          <CalendarDays size={18} />
          <strong>{period.periodStart.slice(5).replace("-", "/")}</strong>
          <span>{kindLabel}</span>
        </div>
        <div className="rp-period-copy">
          <div className="rp-period-meta">
            <ReviewStatusPill status={latest.status} />
            <span>v{latest.version}</span>
            <span>
              {period.periodStart} — {period.periodEnd}
            </span>
          </div>
          <h3>
            <button
              type="button"
              disabled={!!actionInFlight}
              onClick={(event) => onOpen(latest, event)}
            >
              {latest.title || "未命名复盘"}
              <ArrowRight size={16} />
            </button>
          </h3>
          <p>{previewContent}</p>
          {confirmedVersion && latest.status === "draft" && (
            <div className="rp-baseline" role="note">
              <CheckCircle2 size={13} />
              已确认基线 v{confirmedVersion.version}；最新 v{latest.version}{" "}
              仍是草稿。
            </div>
          )}
          <div className="rp-period-footer">
            <span>{formatReviewTimestamp(latest.generated_at)}</span>
            {sourceCount > 0 && (
              <button
                type="button"
                disabled={!!actionInFlight}
                onClick={(event) => onOpenSources(latest, event)}
              >
                来源 {sourceCount}{" "}
                {period.kind === "weekly" ? "篇记录" : "份复盘"}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="rp-period-actions">
        <button
          type="button"
          disabled={!!actionInFlight}
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={versionsId}
        >
          <Layers3 size={14} />
          {partial ? "已加载 " : ""}
          {period.versions.length} 个版本
          <ChevronDown size={13} className={expanded ? "rotate-180" : ""} />
        </button>
        {period.versions.length > 1 && (
          <button type="button" disabled={!!actionInFlight} onClick={onCompare}>
            <GitCompareArrows size={14} />
            版本对比
          </button>
        )}
        <button
          type="button"
          className="rp-read-action"
          disabled={!!actionInFlight}
          onClick={(event) => onOpen(latest, event)}
        >
          阅读最新版本
          <ArrowRight size={14} />
        </button>
      </div>
      {expanded && (
        <div
          id={versionsId}
          className="mt-3 space-y-2 border-t border-[var(--ui-border)] pt-3"
        >
          {period.versions.map((review) => {
            const itemAction =
              actionInFlight?.id === review.id ? actionInFlight.kind : null;
            return (
              <div key={review.id} className="ui-panel-muted rounded-lg p-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-[var(--ui-text-muted)]">
                        v{review.version}
                      </span>
                      <ReviewStatusPill status={review.status} />
                      {review.id === latest.id && (
                        <span className="ui-status-accent rounded-full px-2 py-0.5 text-[11px] font-medium">
                          最新
                        </span>
                      )}
                      {review.id === period.confirmed?.id && (
                        <span className="ui-status-success rounded-full px-2 py-0.5 text-[11px] font-medium">
                          已确认版本
                        </span>
                      )}
                      <span className="text-[11px] text-[var(--ui-text-subtle)]">
                        {formatReviewTimestamp(review.generated_at)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--ui-text-muted)]">
                      {review.title}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={(event) => onOpen(review, event)}
                      disabled={!!actionInFlight}
                      className="ui-button-secondary h-8 min-h-11 w-full disabled:cursor-wait sm:min-h-8 sm:w-auto"
                    >
                      查看/编辑
                    </button>
                    {review.status !== "confirmed" && (
                      <button
                        type="button"
                        onClick={() => void onConfirm(review)}
                        disabled={!!actionInFlight}
                        aria-busy={itemAction === "confirm"}
                        className="ui-button-success h-8 min-h-11 w-full px-3 text-xs disabled:cursor-wait sm:min-h-8 sm:w-auto"
                      >
                        {itemAction === "confirm" ? (
                          <LoaderCircle size={13} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={13} />
                        )}
                        {itemAction === "confirm" ? "确认中…" : "确认版本"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void onDelete(review)}
                      disabled={!!actionInFlight}
                      aria-busy={itemAction === "delete"}
                      className="ui-button-danger h-8 min-h-11 w-full disabled:cursor-wait sm:min-h-8 sm:w-auto"
                    >
                      {itemAction === "delete" ? (
                        <LoaderCircle size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
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

  const currentReview =
    versions.find((review) => review.id === currentId) || current;
  const previousReview =
    versions.find((review) => review.id === previousId) || previous;
  const previousOptions = versions.filter(
    (review) => review.id !== currentReview.id,
  );

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
          className="ui-modal-surface fixed inset-x-3 bottom-3 z-50 flex w-[calc(100%-1.5rem)] min-w-0 max-h-[min(92dvh,860px)] max-w-6xl flex-col overflow-hidden outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
        >
          <div className="ui-soft-divider flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <GitCompareArrows
                  size={17}
                  className="text-[var(--ui-accent-text)]"
                />
                <Dialog.Title className="text-base font-bold text-[var(--ui-text)]">
                  版本对比
                </Dialog.Title>
              </div>
              <Dialog.Description className="mt-1 break-words text-xs leading-5 text-[var(--ui-text-subtle)]">
                {currentReview.period_start} 至 {currentReview.period_end} · v
                {currentReview.version} 对比 v{previousReview.version}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="ui-icon-button h-11 w-11 sm:h-9 sm:w-9"
                aria-label="关闭版本对比"
              >
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
                      v{review.version} ·{" "}
                      {review.status === "confirmed" ? "已确认" : "草稿"}
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
                      v{review.version} ·{" "}
                      {review.status === "confirmed" ? "已确认" : "草稿"}
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
          <div className="grid min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto md:grid-cols-2">
            <ComparePane label="主版本" review={currentReview} accent />
            <ComparePane label="对比版本" review={previousReview} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ComparePane({
  label,
  review,
  accent = false,
}: {
  label: string;
  review: Review;
  accent?: boolean;
}) {
  return (
    <section
      className={[
        "ui-soft-divider min-w-0 min-h-[280px] border-t p-4 sm:min-h-[360px] md:border-l md:border-t-0",
        accent ? "border-t-0 md:border-l-0" : "",
      ].join(" ")}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={[
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            accent ? "ui-status-accent" : "ui-status-muted",
          ].join(" ")}
        >
          {label}
        </span>
        <ReviewStatusPill status={review.status} />
        <span className="text-xs text-[var(--ui-text-subtle)]">
          v{review.version}
        </span>
      </div>
      <h4 className="mb-3 break-words text-sm font-semibold text-[var(--ui-text)]">
        {review.title || "（无标题）"}
      </h4>
      <div className="ui-panel-muted min-w-0 max-w-none p-3">
        <MarkdownContent
          content={reviewBodyContent(review.kind, review.title, review.content)}
        />
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
  const sourceCount = isWeekly
    ? state.review.source_article_ids.length
    : state.review.source_review_ids.length;
  const loadedCount = state.articles.length + state.sourceReviews.length;

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
          className="ui-modal-surface fixed inset-x-3 bottom-3 z-50 flex w-[calc(100%-1.5rem)] min-w-0 max-h-[min(92dvh,760px)] max-w-2xl flex-col overflow-hidden outline-hidden sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2"
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
            <div className="min-w-0 flex-1">
              <Dialog.Title asChild>
                <h2
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-base font-bold text-[var(--ui-text)]"
                >
                  查看来源
                </h2>
              </Dialog.Title>
              <Dialog.Description className="mt-1 break-words text-xs leading-5 text-[var(--ui-text-subtle)]">
                {isWeekly ? "周复盘" : "月复盘"} · {state.review.period_start}{" "}
                至 {state.review.period_end} · 共 {sourceCount}{" "}
                {isWeekly ? "篇今日记录" : "个周期回顾"}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="ui-icon-button h-11 w-11 shrink-0 sm:h-9 sm:w-9"
                aria-label="关闭来源列表"
                title="关闭来源列表"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-5">
            {state.loading ? (
              <div
                className="ui-panel-muted flex min-h-32 items-center justify-center gap-2 text-sm text-[var(--ui-text-muted)]"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle
                  size={16}
                  className="animate-spin text-[var(--ui-accent-text)]"
                />{" "}
                正在加载来源…
              </div>
            ) : (
              <>
                {state.error && (
                  <div
                    className="ui-alert-bad mb-3 flex flex-wrap items-center justify-between gap-2"
                    role="alert"
                  >
                    <span>{state.error}</span>
                    <button
                      type="button"
                      onClick={onRetry}
                      className="font-semibold underline underline-offset-2"
                    >
                      重试
                    </button>
                  </div>
                )}
                {loadedCount === 0 ? (
                  <div className="ui-panel-muted flex min-h-32 items-center justify-center px-4 text-center text-sm text-[var(--ui-text-subtle)]">
                    暂时没有可打开的来源。
                  </div>
                ) : (
                  <ul className="space-y-2" aria-label="复盘来源列表">
                    {state.articles.map((article) => (
                      <li
                        key={article.id}
                        className="ui-panel-muted flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-chip h-6 gap-1 px-2 py-0 text-[11px]">
                              <CalendarDays size={12} /> {article.date}
                            </span>
                            <span className="min-w-0 break-words text-xs font-semibold text-[var(--ui-text)]">
                              {article.title || "（无标题）"}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-[var(--ui-text-muted)]">
                            {reviewExcerpt(article.content || "暂无正文", 150)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenArticle(article)}
                          className="ui-button-secondary min-h-11 w-full shrink-0 px-3 text-xs sm:h-9 sm:min-h-9 sm:w-auto"
                        >
                          打开今日记录
                        </button>
                      </li>
                    ))}
                    {state.sourceReviews.map((review) => (
                      <li
                        key={review.id}
                        className="ui-panel-muted flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-chip h-6 px-2 py-0 text-[11px]">
                              {review.kind === "weekly" ? "周复盘" : "月复盘"}
                            </span>
                            <ReviewStatusPill status={review.status} />
                            <span className="text-[11px] text-[var(--ui-text-subtle)]">
                              v{review.version}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 break-words text-xs font-semibold text-[var(--ui-text)]">
                            {review.title || "（无标题）"}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[var(--ui-text-subtle)]">
                            {review.period_start} 至 {review.period_end}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenReview(review)}
                          className="ui-button-secondary min-h-11 w-full shrink-0 px-3 text-xs sm:h-9 sm:min-h-9 sm:w-auto"
                        >
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
    const sorted = [...versions].sort(
      (a, b) =>
        b.version - a.version || b.generated_at.localeCompare(a.generated_at),
    );
    const latest = selectLatestReview(sorted);
    if (!latest) continue;
    const confirmed =
      sorted.find((review) => review.status === "confirmed") || null;
    const orderedVersions = [
      latest,
      ...sorted.filter((review) => review.id !== latest.id),
    ];
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
