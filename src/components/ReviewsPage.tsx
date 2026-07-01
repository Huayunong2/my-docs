import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  FileClock,
  GitCompareArrows,
  Layers3,
  Pin,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as api from "../lib/api";
import type { Review, ReviewKind, ReviewStatus } from "../lib/api";
import { normalizeReviewContent } from "../lib/reviewContent";
import { ReviewViewerModal, ReviewStatusPill } from "./reviews/ReviewShared";
import MarkdownContent from "./MarkdownContent";
import { EmptyState, LoadingState, useConfirmDialog } from "./ui/Feedback";

type KindFilter = "all" | ReviewKind;
type StatusFilter = "all" | ReviewStatus;

type PeriodGroup = {
  key: string;
  kind: ReviewKind;
  periodStart: string;
  periodEnd: string;
  current: Review;
  versions: Review[];
};

type MonthGroup = {
  month: string;
  periods: PeriodGroup[];
};

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedPeriods, setExpandedPeriods] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [comparePair, setComparePair] = useState<{ current: Review; previous: Review } | null>(null);
  const [saving, setSaving] = useState(false);
  const [extractingKnowledgeId, setExtractingKnowledgeId] = useState("");
  const [notice, setNotice] = useState("");
  const { confirm, dialog } = useConfirmDialog();

  const loadReviews = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReviews(await api.listAllReviews(kindFilter === "all" ? undefined : kindFilter));
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [kindFilter]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reviews.filter((review) => {
      if (statusFilter !== "all" && review.status !== statusFilter) return false;
      if (!q) return true;
      return [
        review.title,
        review.content,
        review.period_start,
        review.period_end,
        review.model,
        review.kind === "weekly" ? "周复盘" : "月复盘",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [query, reviews, statusFilter]);

  const monthGroups = useMemo(() => groupReviewsByMonth(filtered), [filtered]);
  const summary = useMemo(() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const drafts = filtered.filter((review) => review.status === "draft").length;
    const confirmed = filtered.filter((review) => review.status === "confirmed").length;
    const currentMonthWeeklyDrafts = filtered.filter(
      (review) => review.kind === "weekly" && review.period_start.startsWith(currentMonth) && review.status === "draft"
    ).length;
    const latest = filtered
      .map((review) => review.generated_at)
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))[0];
    return {
      total: filtered.length,
      drafts,
      confirmed,
      currentMonthWeeklyDrafts,
      latest: latest || "暂无",
    };
  }, [filtered]);

  const openEditor = (review: Review) => {
    setEditingReview(review);
    setEditTitle(review.title);
    setEditContent(review.content);
  };

  const saveReview = async (status?: ReviewStatus) => {
    if (!editingReview) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateReview(editingReview.id, {
        title: editTitle,
        content: editContent,
        status,
      });
      setEditingReview(updated);
      setEditTitle(updated.title);
      setEditContent(updated.content);
      await loadReviews();
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteReview = async (review: Review) => {
    const ok = await confirm({
      title: "删除 AI 复盘",
      message: `删除「${review.title}」v${review.version}？\n\n只会删除这个复盘版本，不会删除每日记录或其他版本。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    setError("");
    try {
      await api.deleteReview(review.id);
      if (editingReview?.id === review.id) setEditingReview(null);
      await loadReviews();
    } catch (e) {
      setError(api.getErrorMessage(e));
    }
  };

  const confirmReview = async (review: Review) => {
    setError("");
    try {
      await api.updateReview(review.id, { status: "confirmed" });
      await loadReviews();
    } catch (e) {
      setError(api.getErrorMessage(e));
    }
  };

  const extractKnowledgeFromReview = async (review: Review) => {
    setExtractingKnowledgeId(review.id);
    setNotice("");
    setError("");
    try {
      const cards = await api.extractKnowledgeCards({
        content: normalizeReviewContent(review.kind, review.title, review.content),
        source_review_id: review.id,
        source_date: review.period_end,
        max_cards: review.kind === "monthly" ? 12 : 8,
      });
      setNotice(
        cards.length
          ? `已从「${review.title}」提取 ${cards.length} 张知识卡片草稿，可到知识工作台确认。`
          : "这份复盘里没有足够稳定的知识卡片。"
      );
    } catch (e) {
      setError(api.getErrorMessage(e));
    } finally {
      setExtractingKnowledgeId("");
    }
  };

  const togglePeriod = (key: string) => {
    setExpandedPeriods((current) => ({ ...current, [key]: !current[key] }));
  };

  const openCompare = (period: PeriodGroup) => {
    const previous =
      period.versions.find((review) => review.id !== period.current.id && review.version < period.current.version) ||
      period.versions.find((review) => review.id !== period.current.id);
    if (previous) setComparePair({ current: period.current, previous });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-full overflow-y-auto px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 md:mb-6">
        <div className="flex items-start gap-3">
          <span className="hidden h-10 w-10 items-center justify-center rounded-xl bg-accent-light text-accent dark:bg-accent-light/20 sm:flex">
            <BookOpenText size={19} strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">复盘库</h2>
            <p className="mt-0.5 text-sm text-gray-400 dark:text-gray-400">
              按年月和周期管理 AI 周复盘、月复盘及历史版本
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="ui-alert-bad mb-4">
          {error}
        </div>
      )}
      {notice && (
        <div className="ui-alert-good mb-4">
          {notice}
        </div>
      )}

      <div className="ui-panel mb-4 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索复盘..."
            className="ui-field h-10 bg-gray-50 pl-9 pr-10 dark:bg-white/[0.04]"
          />
          <button onClick={loadReviews}
            className="ui-icon-button absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="ui-segment">
            {(["all","weekly","monthly"] as const).map((k) => (
              <button key={k} onClick={() => setKindFilter(k)}
                className={`ui-segment-item h-7 px-2.5 ${kindFilter === k ? "ui-segment-item-active" : ""}`}>
                {{all:"全部",weekly:"周复盘",monthly:"月复盘"}[k]}
              </button>
            ))}
          </div>
          <div className="ui-segment">
            {(["all","draft","confirmed"] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`ui-segment-item h-7 px-2.5 ${statusFilter === s ? "ui-segment-item-active" : ""}`}>
                {{all:"全部",draft:"草稿",confirmed:"已确认"}[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!loading && filtered.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <ReviewMetric icon={Layers3} label="复盘版本" value={summary.total} tone="accent" />
          <ReviewMetric icon={CheckCircle2} label="已确认" value={summary.confirmed} tone="green" />
          <ReviewMetric icon={FileClock} label="草稿" value={summary.drafts} tone="amber" />
          <ReviewMetric icon={BookOpenText} label="本月待确认" value={summary.currentMonthWeeklyDrafts} tone="gray" />
        </div>
      )}

      {loading ? (
        <LoadingState label="加载复盘..." rows={3} />
      ) : monthGroups.length === 0 ? (
        <EmptyState
          icon={BookOpenText}
          title="没有符合条件的复盘"
          description="调整筛选条件，或先生成周复盘、月复盘草稿。"
        />
      ) : (
        <div className="space-y-4">
          {monthGroups.map((group) => (
            <section key={group.month} className="ui-panel p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{group.month}</h3>
                <span className="text-xs text-gray-400 dark:text-gray-500">{group.periods.length} 个周期</span>
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
                    onCompare={() => openCompare(period)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editingReview && (
        <ReviewViewerModal
          review={editingReview}
          title={editTitle}
          content={editContent}
          saving={saving}
          onTitleChange={setEditTitle}
          onContentChange={setEditContent}
          onSave={() => saveReview()}
          onConfirm={() => saveReview("confirmed")}
          onDelete={() => deleteReview(editingReview)}
          onExtractKnowledge={() => extractKnowledgeFromReview(editingReview)}
          extractingKnowledge={extractingKnowledgeId === editingReview.id}
          onClose={() => setEditingReview(null)}
        />
      )}
      {comparePair && (
        <ReviewCompareModal
          current={comparePair.current}
          previous={comparePair.previous}
          onClose={() => setComparePair(null)}
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
    accent: "bg-accent-light text-accent dark:bg-accent-light/20",
    green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
    gray: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
  }[tone];

  return (
    <div className="ui-panel flex items-center gap-3 px-3 py-2.5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <div className="min-w-0">
        <div className="text-lg font-bold leading-none text-gray-800 dark:text-gray-100">{value}</div>
        <div className="mt-1 truncate text-[11px] text-gray-400 dark:text-gray-500">{label}</div>
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
  onCompare,
}: {
  period: PeriodGroup;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (review: Review) => void;
  onConfirm: (review: Review) => void;
  onDelete: (review: Review) => void;
  onCompare: () => void;
}) {
  const current = period.current;
  const previewContent = normalizeReviewContent(current.kind, current.title, current.content);
  const kindLabel = period.kind === "weekly" ? "周复盘" : "月复盘";
  const sourceCount = period.kind === "weekly"
    ? countJsonItems(current.source_article_ids)
    : countJsonItems(current.source_review_ids);
  return (
    <article className="relative rounded-xl border border-gray-100 bg-gray-50/70 p-3 pl-7 transition-colors hover:border-accent/25 dark:border-white/10 dark:bg-white/[0.025]">
      <div className="absolute bottom-3 left-3 top-3 w-px bg-gray-200 dark:bg-white/10" />
      <div
        className={[
          "absolute left-[7px] top-5 h-3 w-3 rounded-full ring-4",
          period.kind === "monthly"
            ? "bg-accent ring-accent-light dark:ring-accent-light/20"
            : current.status === "confirmed"
              ? "bg-emerald-500 ring-emerald-50 dark:ring-emerald-900/30"
              : "bg-amber-500 ring-amber-50 dark:ring-amber-900/30",
        ].join(" ")}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="ui-chip h-6 px-2 py-0 text-[11px]">
              {kindLabel} · {period.periodStart} 至 {period.periodEnd}
            </span>
            <ReviewStatusPill status={current.status} />
            <span className="ui-chip h-6 px-2 py-0 text-[11px] text-accent">
              <Pin size={11} />
              当前版本
            </span>
            <span className="ui-chip h-6 px-2 py-0 text-[11px] text-gray-400 dark:text-gray-500">
              当前 v{current.version} / 共 {period.versions.length} 版
            </span>
            <span className="ui-chip h-6 px-2 py-0 text-[11px] text-gray-400 dark:text-gray-500">
              来源 {sourceCount} {period.kind === "weekly" ? "篇" : "个"}
            </span>
          </div>
          <h4 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{current.title}</h4>
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-gray-500 dark:text-gray-400">
            {previewContent}
          </p>
          <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
            生成：{current.generated_at || "未知"} · 模型：{current.model || "AI"}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:w-32">
          <button
            type="button"
            onClick={() => onOpen(current)}
            className="ui-button-primary"
          >
            查看全文
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="ui-button-secondary"
          >
            <ChevronDown size={14} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
            {expanded ? "收起版本" : `${period.versions.length} 个版本`}
          </button>
          {period.versions.length > 1 && (
            <button
              type="button"
              onClick={onCompare}
              className="ui-button-ghost"
            >
              <GitCompareArrows size={14} />
              版本对比
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-700">
          {period.versions.map((review) => (
            <div key={review.id} className="rounded-lg border border-gray-100 bg-white p-2 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">v{review.version}</span>
                    <ReviewStatusPill status={review.status} />
                    {review.id === current.id && (
                      <span className="rounded-full bg-accent-light px-2 py-0.5 text-[11px] font-medium text-accent dark:bg-accent-light/20">
                        当前
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">{review.generated_at}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{review.title}</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => onOpen(review)}
                    className="ui-button-secondary h-8"
                  >
                    查看/编辑
                  </button>
                  {review.status !== "confirmed" && (
                    <button
                      type="button"
                      onClick={() => onConfirm(review)}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                    >
                      <CheckCircle2 size={13} />
                      确认归档
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(review)}
                    className="ui-button-danger h-8"
                  >
                    <Trash2 size={13} />
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function ReviewCompareModal({
  current,
  previous,
  onClose,
}: {
  current: Review;
  previous: Review;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 sm:items-center" onClick={onClose}>
      <div
        className="ui-modal-surface flex max-h-[92vh] max-w-6xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10 sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <GitCompareArrows size={17} className="text-accent" />
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">版本对比</h3>
            </div>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {current.period_start} 至 {current.period_end} · 当前 v{current.version} 对比 v{previous.version}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ui-icon-button h-9 w-9">
            <X size={16} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-2">
          <ComparePane label="当前版本" review={current} accent />
          <ComparePane label="对比版本" review={previous} />
        </div>
      </div>
    </div>
  );
}

function ComparePane({ label, review, accent = false }: { label: string; review: Review; accent?: boolean }) {
  return (
    <section className={["min-h-[360px] border-gray-100 p-4 dark:border-white/10 md:border-l", accent ? "md:border-l-0" : ""].join(" ")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={[
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            accent
              ? "bg-accent-light text-accent dark:bg-accent-light/20"
              : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300",
          ].join(" ")}
        >
          {label}
        </span>
        <ReviewStatusPill status={review.status} />
        <span className="text-xs text-gray-400 dark:text-gray-500">v{review.version}</span>
      </div>
      <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{review.title}</h4>
      <div className="max-w-none rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-white/10 dark:bg-white/[0.035]">
        <MarkdownContent content={review.content} />
      </div>
    </section>
  );
}

function countJsonItems(raw: string) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function groupReviewsByMonth(reviews: Review[]): MonthGroup[] {
  const periodMap = new Map<string, Review[]>();
  for (const review of reviews) {
    const key = `${review.kind}:${review.period_start}:${review.period_end}`;
    periodMap.set(key, [...(periodMap.get(key) || []), review]);
  }

  const monthMap = new Map<string, PeriodGroup[]>();
  for (const [key, versions] of periodMap.entries()) {
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    const current = sorted.find((review) => review.status === "confirmed") || sorted[0];
    const orderedVersions = [current, ...sorted.filter((review) => review.id !== current.id)];
    const month = current.period_start.slice(0, 7);
    const period: PeriodGroup = {
      key,
      kind: current.kind,
      periodStart: current.period_start,
      periodEnd: current.period_end,
      current,
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
