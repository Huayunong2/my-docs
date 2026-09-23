import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { MouseEvent } from "react";
import MonthPicker from "./workspace/MonthPicker";
import WorkspaceHeader from "./workspace/WorkspaceHeader";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BarChart3,
  BookMarked,
  BookOpenText,
  Brain,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Coffee,
  FileText,
  Folder,
  HeartPulse,
  LineChart,
  LoaderCircle,
  PencilLine,
  Plane,
  ShieldCheck,
  Sparkles,
  Tags,
  Umbrella,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as api from "../lib/api";
import type {
  MonthDayStats,
  Review,
  ReviewKind,
  StatsOverview,
  WeekReview,
} from "../lib/api";
import type { Page } from "../App";
import { reviewPreview } from "../lib/reviewContent";
import {
  generateReviewVersion,
  selectLatestReview,
  upsertReviewVersion,
} from "../lib/reviewGeneration";
import type { ReviewGenerationStep } from "../lib/reviewGeneration";
import { loadStatsSnapshot } from "../lib/statsSnapshot";
import { ReviewStatusPill } from "./reviews/ReviewShared";
import DatePickerPopover from "./ui/date-picker";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string; name?: string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  return (
    <div className="ui-modal-surface w-auto px-3 py-2 text-xs">
      {label != null && label !== "" && (
        <div className="mb-1 font-medium text-[var(--ui-text-muted)]">
          {formatDateLabel(String(label))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: p.color || "var(--ui-accent-solid)" }}
        />
        {p.name ? (
          <span className="text-[var(--ui-text-muted)]">{p.name}</span>
        ) : null}
        <span className="ml-auto font-semibold text-[var(--ui-text)]">
          {p.value}
        </span>
      </div>
    </div>
  );
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatMonthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`;
}

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatDateLabel(value: string): string {
  const parts = dateParts(value);
  return parts ? `${parts.year}年${parts.month}月${parts.day}日` : value;
}

function formatMonthDay(value: string): string {
  const parts = dateParts(value);
  return parts ? `${parts.month}月${parts.day}日` : value;
}

function formatDateRange(from: string, to: string): string {
  const start = dateParts(from);
  const end = dateParts(to);
  if (!start || !end) return `${from} 至 ${to}`;
  if (start.year === end.year && start.month === end.month) {
    return `${start.year}年${start.month}月${start.day}—${end.day}日`;
  }
  if (start.year === end.year) {
    return `${start.year}年${start.month}月${start.day}日—${end.month}月${end.day}日`;
  }
  return `${formatDateLabel(from)}—${formatDateLabel(to)}`;
}

function monthBounds(year: number, month: number) {
  const first = new Date(year, month - 1, 1);
  const next = new Date(year, month, 1);
  const last = new Date(next);
  last.setDate(last.getDate() - 1);
  return {
    first: formatDate(first),
    last: formatDate(last),
    offset: first.getDay(),
    daysInMonth: last.getDate(),
  };
}

function weekBounds(date: string) {
  const anchor = new Date(`${date}T12:00:00`);
  const day = anchor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const first = new Date(anchor);
  first.setDate(anchor.getDate() + mondayOffset);
  const last = new Date(first);
  last.setDate(first.getDate() + 6);
  return { first: formatDate(first), last: formatDate(last) };
}

function todayDate(): string {
  return formatDate(new Date());
}

function parseMonthParam(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const exemptionReasons = ["休息", "放假", "请假", "生病", "出差", "其他"];
type StatTone = "accent" | "green" | "amber" | "gray" | "rose" | "sky";

const knowledgeQualityOptions: Array<{
  key: api.KnowledgeCardQuality;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: StatTone;
}> = [
  {
    key: "missing_source",
    label: "未关联来源",
    hint: "仅筛选没有来源定位的知识条目",
    icon: FileText,
    tone: "gray",
  },
  {
    key: "missing_project",
    label: "未归入空间",
    hint: "主题或项目归属",
    icon: Folder,
    tone: "sky",
  },
  {
    key: "missing_tags",
    label: "缺少标签",
    hint: "补充检索标签",
    icon: Tags,
    tone: "accent",
  },
  {
    key: "short_content",
    label: "内容过短",
    hint: "补成可复习的完整表述",
    icon: BookMarked,
    tone: "rose",
  },
];

const STEP_LABELS: Record<Exclude<ReviewGenerationStep, "idle">, string> = {
  collecting: "收集本周记录",
  requesting: "请求 AI",
  saving: "生成草稿",
};

function chooseCurrentReview(reviews: Review[]): Review | null {
  return selectLatestReview(reviews);
}

export default function StatsPage({
  onEditDate,
  onSearchTerm,
  onNavigate,
  onOpenKnowledgeQuality,
  initialMonth,
  onMonthChange,
}: {
  onEditDate: (date: string) => void;
  onSearchTerm: (term: string) => void;
  onNavigate: (page: Page) => void;
  onOpenKnowledgeQuality: (quality: api.KnowledgeCardQuality) => void;
  initialMonth?: string;
  onMonthChange?: (month: string) => void;
}) {
  const [statsTab, setStatsTab] = useState("records");
  const now = new Date();
  const initialMonthParts = parseMonthParam(initialMonth);
  const initialIsCurrentMonth = Boolean(
    initialMonthParts &&
    initialMonthParts.year === now.getFullYear() &&
    initialMonthParts.month === now.getMonth() + 1,
  );
  const [year, setYear] = useState(
    initialMonthParts?.year ?? now.getFullYear(),
  );
  const [month, setMonth] = useState(
    initialMonthParts?.month ?? now.getMonth() + 1,
  );
  const lastInitialMonth = useRef(initialMonth);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [days, setDays] = useState<MonthDayStats[]>([]);
  const [reviewStats, setReviewStats] =
    useState<api.ReviewStatsResponse | null>(null);
  const [heatmap, setHeatmap] = useState<api.DailyReviewCount[]>([]);
  const [heatmapLoaded, setHeatmapLoaded] = useState(false);
  const [weekReview, setWeekReview] = useState<WeekReview | null>(null);
  const [weeklyReviews, setWeeklyReviews] = useState<Review[]>([]);
  const [monthlyReviews, setMonthlyReviews] = useState<Review[]>([]);
  const [reviewWeekDate, setReviewWeekDate] = useState(() =>
    initialMonthParts && !initialIsCurrentMonth
      ? `${initialMonthParts.year}-${String(initialMonthParts.month).padStart(2, "0")}-15`
      : todayDate(),
  );
  const [reviewError, setReviewError] = useState("");
  const [generatingKind, setGeneratingKind] = useState<ReviewKind | null>(null);
  const [generationStep, setGenerationStep] =
    useState<ReviewGenerationStep>("idle");
  const [dayActionTarget, setDayActionTarget] = useState<MonthDayStats | null>(
    null,
  );
  const [exemptionTarget, setExemptionTarget] = useState<MonthDayStats | null>(
    null,
  );
  const [exemptionNote, setExemptionNote] = useState("");
  const [exemptionError, setExemptionError] = useState("");
  const [savingExemption, setSavingExemption] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewStatsError, setReviewStatsError] = useState("");
  const [heatmapError, setHeatmapError] = useState("");
  const loadRevision = useRef(0);
  const generationInFlight = useRef(false);
  const loadedMonthKey = useRef<string | null>(null);
  const loadedWeekDate = useRef<string | null>(null);
  const knowledgeSummaryQuery = useQuery({
    queryKey: api.knowledgeQueryKeys.summary(),
    queryFn: ({ signal }) => api.getKnowledgeSummary("", { signal }),
    staleTime: 30_000,
  });

  const bounds = useMemo(() => monthBounds(year, month), [year, month]);
  const selectedWeekBounds = useMemo(
    () => weekBounds(reviewWeekDate),
    [reviewWeekDate],
  );
  const generationAnchors = useRef({
    weekly: reviewWeekDate,
    monthly: bounds.first,
  });
  generationAnchors.current = { weekly: reviewWeekDate, monthly: bounds.first };
  const selectedMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const monthDataChanged = loadedMonthKey.current !== selectedMonthKey;
  const weekReady = Boolean(
    weekReview && loadedWeekDate.current === reviewWeekDate,
  );
  const writtenDays = overview?.days_written || 0;
  const exemptedDays = overview?.exempted_days || 0;
  const coveredDays = writtenDays + exemptedDays;
  const completion = bounds.daysInMonth
    ? Math.round((coveredDays / bounds.daysInMonth) * 100)
    : 0;
  const completionPercent = Math.min(100, Math.max(0, completion));
  const coreLoading =
    (loading && !overview) || (monthDataChanged && Boolean(overview));
  const coreError = !overview && !loading && Boolean(error);
  const today = todayDate();
  const selectedWeeklyReview = chooseCurrentReview(weeklyReviews);
  const selectedMonthlyReview = chooseCurrentReview(monthlyReviews);
  const activeDays = useMemo(
    () => days.filter((day) => day.has_article),
    [days],
  );
  const longestDay = useMemo(
    () =>
      activeDays.reduce<MonthDayStats | null>(
        (best, day) => (!best || day.word_count > best.word_count ? day : best),
        null,
      ),
    [activeDays],
  );
  const moodEntries = Object.entries(overview?.mood_counts || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const knowledgeSummary = knowledgeSummaryQuery.data;
  const missingDays = weekReady ? weekReview?.missing_days || [] : [];
  const hasReviewActivity = reviewStats?.daily.some((day) => day.count > 0) ?? false;
  const hasUpcomingReviews =
    reviewStats?.upcoming.some((day) => day.count > 0) ?? false;
  const hasMemoryReviewData = Boolean(
    reviewStats &&
      (reviewStats.total_reviews > 0 ||
        reviewStats.streak_days > 0 ||
        reviewStats.reviewed_today > 0 ||
        hasReviewActivity ||
        hasUpcomingReviews),
  );
  const calendarCells = useMemo(() => {
    const leading = Array.from({ length: bounds.offset }, () => null);
    const totalCells = Math.ceil((leading.length + days.length) / 7) * 7;
    const trailingCount = totalCells - leading.length - days.length;
    return [
      ...leading,
      ...days,
      ...Array.from({ length: trailingCount }, () => null),
    ];
  }, [bounds.offset, days]);

  const loadStats = useCallback(
    async (showLoading = true) => {
      const revision = ++loadRevision.current;
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const monthChanged = loadedMonthKey.current !== monthKey;
      const weekChanged = loadedWeekDate.current !== reviewWeekDate;
      if (showLoading) setLoading(true);
      setError("");
      setReviewError("");
      if (showLoading && monthChanged) {
        setOverview(null);
        setDays([]);
        setMonthlyReviews([]);
      }
      if (showLoading && weekChanged) {
        setWeekReview(null);
        setWeeklyReviews([]);
      }
      try {
        const snapshot = await loadStatsSnapshot(api, {
          year,
          month,
          monthFrom: bounds.first,
          monthTo: bounds.last,
          weekDate: reviewWeekDate,
          weekFrom: selectedWeekBounds.first,
          weekTo: selectedWeekBounds.last,
        });
        if (revision !== loadRevision.current) return;
        setOverview(snapshot.overview);
        setDays(snapshot.days);
        setWeekReview(snapshot.week);
        setWeeklyReviews(snapshot.weeklyReviews);
        setMonthlyReviews(snapshot.monthlyReviews);
        loadedMonthKey.current = monthKey;
        loadedWeekDate.current = reviewWeekDate;

        if (snapshot.reviewError) {
          const reviewLoadError = snapshot.reviewError;
          if (
            reviewLoadError instanceof api.ApiError &&
            reviewLoadError.status === 404
          ) {
            setReviewError(
              "AI 复盘接口不存在：服务端可能还在运行旧版本。基础统计仍可使用，请更新并重启服务端。",
            );
          } else {
            setReviewError(api.getErrorMessage(reviewLoadError));
          }
        }
      } catch (e: any) {
        if (revision !== loadRevision.current) return;
        setError(api.getErrorMessage(e) || "加载统计失败");
      } finally {
        if (showLoading && revision === loadRevision.current) setLoading(false);
      }
    },
    [
      bounds.first,
      bounds.last,
      selectedWeekBounds.first,
      selectedWeekBounds.last,
      year,
      month,
      reviewWeekDate,
    ],
  );

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (initialMonth === lastInitialMonth.current) return;
    lastInitialMonth.current = initialMonth;
    const next = parseMonthParam(initialMonth);
    if (!next) return;
    if (next.year === year && next.month === month) return;
    setYear(next.year);
    setMonth(next.month);
    setReviewWeekDate(`${next.year}-${String(next.month).padStart(2, "0")}-15`);
  }, [initialMonth, month, year]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setReviewWeekDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15`,
    );
    onMonthChange?.(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  };

  const goCurrentMonth = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setReviewWeekDate(today);
    onMonthChange?.(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    );
  };

  const openExemptionMenu = (day: MonthDayStats) => {
    setExemptionTarget(day);
    setExemptionNote(day.exemption?.note || "");
    setExemptionError("");
  };

  const openDayActions = (day: MonthDayStats) => {
    setDayActionTarget(day);
  };

  const saveExemption = async (reason: string) => {
    if (!exemptionTarget) return;
    setSavingExemption(true);
    setExemptionError("");
    try {
      await api.setDayExemption(exemptionTarget.date, {
        reason,
        note: exemptionNote.trim(),
      });
      toast.success(`${exemptionTarget.date} 已设置为「${reason}」`);
      setExemptionTarget(null);
      await loadStats(false);
    } catch (e: any) {
      const message = e.message || "保存日期状态失败";
      setExemptionError(message);
      toast.error(message);
    } finally {
      setSavingExemption(false);
    }
  };

  const clearExemption = async () => {
    if (!exemptionTarget) return;
    setSavingExemption(true);
    setExemptionError("");
    try {
      await api.deleteDayExemption(exemptionTarget.date);
      toast.success(`${exemptionTarget.date} 已恢复为普通日期`);
      setExemptionTarget(null);
      await loadStats(false);
    } catch (e: any) {
      const message = e.message || "清除日期状态失败";
      setExemptionError(message);
      toast.error(message);
    } finally {
      setSavingExemption(false);
    }
  };

  const openMissingExemption = (date: string) => {
    openExemptionMenu({
      date,
      has_article: false,
      word_count: 0,
      mood: "",
      title: "",
      id: null,
      exemption: null,
    });
  };

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 复习统计 + 热力图（可降级提示，不影响页面主体）
  useEffect(() => {
    setReviewStatsError("");
    setHeatmapError("");
    api
      .getReviewStats()
      .then((stats) => {
        if (mountedRef.current) setReviewStats(stats);
      })
      .catch((e) => {
        if (!mountedRef.current) return;
        setReviewStats(null);
        setReviewStatsError(api.getErrorMessage(e) || "复习统计暂时不可用");
      });
    api
      .getReviewHeatmap(365)
      .then((data) => {
        if (!mountedRef.current) return;
        setHeatmap(data);
        setHeatmapLoaded(true);
      })
      .catch((e) => {
        if (!mountedRef.current) return;
        setHeatmap([]);
        setHeatmapLoaded(true);
        setHeatmapError(api.getErrorMessage(e) || "复习热力图暂时不可用");
      });
  }, []);

  const generateAiReview = async (kind: ReviewKind) => {
    if (!mountedRef.current || generationInFlight.current) return;
    generationInFlight.current = true;
    const anchorDate = kind === "weekly" ? reviewWeekDate : bounds.first;
    setGeneratingKind(kind);
    setReviewError("");
    try {
      const generated = await generateReviewVersion(
        api,
        { kind, date: anchorDate },
        () =>
          mountedRef.current && generationAnchors.current[kind] === anchorDate,
        setGenerationStep,
      );
      if (!generated) return;
      if (kind === "weekly") {
        setWeeklyReviews((reviews) => upsertReviewVersion(reviews, generated));
      } else {
        setMonthlyReviews((reviews) => upsertReviewVersion(reviews, generated));
      }
    } catch (e) {
      const message = api.getErrorMessage(e);
      setReviewError(message);
      toast.error(message);
    } finally {
      generationInFlight.current = false;
      if (mountedRef.current) {
        setGeneratingKind(null);
        setGenerationStep("idle");
      }
    }
  };

  return (
    <div className="ft-page ft-stats">
      <WorkspaceHeader
        icon={BarChart3}
        title="统计"
        actions={
          <div className="ft-month-nav">
            <button
              className="shell-icon"
              onClick={() => shiftMonth(-1)}
              aria-label="上个月"
            >
              <ChevronLeft size={18} />
            </button>
            <MonthPicker year={year} month={month} onChange={(nextYear, nextMonth) => shiftMonth((nextYear - year) * 12 + nextMonth - month)} />
            <button
              className="shell-icon"
              onClick={() => shiftMonth(1)}
              aria-label="下个月"
            >
              <ChevronRight size={18} />
            </button>
            <button className="ui-button-secondary" onClick={goCurrentMonth}>
              本月
            </button>
          </div>
        }
      />
      <div className="ft-stats-toolbar">
        <Tabs value={statsTab} onValueChange={setStatsTab} className="ft-tabs">
          <TabsList aria-label="统计分类">
            <TabsTrigger value="records">
              <CalendarRange size={15} aria-hidden="true" />记录概览
            </TabsTrigger>
            <TabsTrigger value="memory">
              <Brain size={15} aria-hidden="true" />记忆复习
            </TabsTrigger>
            <TabsTrigger value="knowledge">
              <BookMarked size={15} aria-hidden="true" />知识整理
            </TabsTrigger>
            <TabsTrigger value="generate">
              <Sparkles size={15} aria-hidden="true" />生成复盘
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {coreLoading ? (
        <StatsLoadingState monthLabel={formatMonthLabel(year, month)} />
      ) : coreError ? (
        <StatsErrorState
          message={error}
          onRetry={() => loadStats()}
          onOpenSettings={() => onNavigate("settings")}
        />
      ) : (
        <>
          {error && (
            <div className="ui-alert-bad mb-4" role="alert">
              {error}
              <button
                onClick={() => loadStats()}
                className="ui-button-secondary"
              >
                重试
              </button>
            </div>
          )}
          {statsTab === "records" && (
            <section className="ft-stats-view ft-stats-records">
              <div className="ft-monthly-story">
                <div className="ft-monthly-story-copy">
                  <h2>本月概览</h2>
                  <div className="ft-monthly-story-actions">
                    <button
                      className="ui-button-primary"
                      onClick={() => setStatsTab("generate")}
                    >
                      <Sparkles size={15} />
                      生成周期复盘
                    </button>
                    <button
                      className="ui-button-ghost"
                      onClick={() => onNavigate("reviews")}
                    >
                      浏览复盘库
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
                <div className="ft-monthly-story-progress">
                  <div
                    className="ft-monthly-ring"
                    role="img"
                    aria-label={"本月覆盖率 " + completion + "%"}
                    style={{
                      background:
                        "conic-gradient(var(--ui-accent-solid) " +
                        completionPercent +
                        "%, var(--ui-surface-inset) 0)",
                    }}
                  >
                    <div aria-hidden="true">
                      <strong>{completion}%</strong>
                      <span>月度覆盖</span>
                    </div>
                  </div>
                  <div className="ft-monthly-legend">
                    <span>
                      <i data-kind="record" />
                      已记录
                    </span>
                    <span>
                      <i data-kind="exempt" />
                      日期状态
                    </span>
                  </div>
                </div>
              </div>
              <div className="ft-metrics">
                <Metric
                  label="记录天数"
                  icon={CalendarRange}
                  value={writtenDays}
                  unit="天"
                  note="已保存的今日记录"
                />
                <Metric
                  label="累计字数"
                  icon={FileText}
                  value={overview?.total_words || 0}
                  unit="字"
                  note="本月记录中的文字"
                />
                <Metric
                  label="连续覆盖"
                  icon={BarChart3}
                  value={overview?.current_streak || 0}
                  unit="天"
                  note={
                    overview?.streak_exempted_days
                      ? "含 " + overview.streak_exempted_days + " 天日期状态"
                      : "当前连续记录覆盖天数"
                  }
                />
                <Metric
                  label="日期状态"
                  icon={ShieldCheck}
                  value={exemptedDays}
                  unit="天"
                  note="不计为记录，也不会打断连续覆盖"
                />
              </div>
              <div className="ft-stats-overview">
                <section className="ft-panel ft-calendar">
                  <header className="ft-panel-heading">
                    <h2>记录月历</h2>
                    <span className="ft-caption">日期编辑 · 盾牌设状态</span>
                  </header>
                  <div className="ft-weekdays">
                    {weekdays.map((day) => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>
                  <div
                    data-calendar-grid="month"
                    className="ft-calendar-grid"
                    style={{
                      gridTemplateRows:
                        "repeat(" + calendarCells.length / 7 + ", minmax(0, 1fr))",
                      height:
                        "calc(" + calendarCells.length / 7 + " * clamp(52px, 6vw, 64px))",
                    }}
                  >
                    {calendarCells.map((day, index) =>
                      day ? (
                        <CalendarDay
                          key={day.date}
                          day={day}
                          isToday={day.date === today}
                          onEditDate={onEditDate}
                          onOpenDayActions={openDayActions}
                          onManageExemption={openExemptionMenu}
                        />
                      ) : (
                        <div key={index} data-calendar-cell="blank" />
                      ),
                    )}
                  </div>
                  <footer className="ft-calendar-legend">
                    <span>
                      <i className="ui-accent-fill" />
                      有记录
                    </span>
                    <span>
                      <i className="ui-success-fill" />
                      已设日期状态
                    </span>
                    <span>
                      <i />
                      未记录
                    </span>
                  </footer>
                </section>
                <div className="ft-stats-aside">
                  <section className="ft-panel">
                    <header className="ft-panel-heading">
                      <h2>每日字数</h2>
                      <span className="ft-caption">
                        {longestDay
                          ? formatMonthDay(longestDay.date) +
                            " · " +
                            longestDay.word_count.toLocaleString() +
                            " 字"
                          : "等待第一篇记录"}
                      </span>
                    </header>
                    <div
                      className="ft-word-chart"
                      role="img"
                      aria-label={formatMonthLabel(year, month) + "每日记录字数"}
                    >
                      {days.map((day) => (
                        <div
                          key={day.date}
                          title={day.date + "：" + day.word_count + " 字"}
                        >
                          <span
                            style={{
                              height: day.has_article
                                ? Math.max(
                                    3,
                                    (day.word_count /
                                      Math.max(1, longestDay?.word_count || 1)) *
                                      100,
                                  ) + "%"
                                : "3px",
                            }}
                            data-filled={day.has_article}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="ft-chart-axis">
                      <span>1 日</span>
                      <span>{bounds.daysInMonth} 日</span>
                    </div>
                    <div className="ft-stats-average">
                      <span>有记录日平均</span>
                      <strong>
                        {Math.round(overview?.avg_words || 0).toLocaleString()}{" "}
                        <small>字</small>
                      </strong>
                    </div>
                  </section>
                  <section className="ft-panel ft-quick-review">
                    <h2>周期复盘</h2>
                    <div>
                      <button
                        className="ui-button-primary"
                        onClick={() => setStatsTab("generate")}
                      >
                        生成周期复盘
                        <ChevronRight size={14} />
                      </button>
                      <button
                        className="ui-button-ghost"
                        onClick={() => onNavigate("reviews")}
                      >
                        查看复盘库
                      </button>
                    </div>
                  </section>
                  {moodEntries.length > 0 && (
                    <section className="ft-panel">
                      <header className="ft-panel-heading">
                        <h2>心情记录</h2>
                        <span className="ft-caption">本月标记</span>
                      </header>
                      <div className="ft-moods">
                        {moodEntries.map(([mood, count]) => (
                          <span key={mood}>
                            {mood}
                            <b>{count}</b>
                          </span>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </section>
          )}
          {statsTab === "memory" && (
            <div className="ft-stats-view ft-stats-section ft-stats-memory">
              {reviewStatsError ? (
                <div className="ui-alert-warn" role="alert">
                  {reviewStatsError}
                </div>
              ) : !reviewStats ? (
                <div className="ft-panel ft-search-empty">
                  正在读取复习统计…
                </div>
              ) : (
                <>
                  <div className="ft-section-lead">
                    <div className="ft-section-copy">
                      <h2>记忆复习</h2>
                    </div>
                    <button
                      className="ui-button-primary"
                      onClick={() => onNavigate("review")}
                    >
                      <Brain size={15} />
                      前往复习
                      {reviewStats.due > 0 ? ` · ${reviewStats.due}` : ""}
                    </button>
                  </div>
                  <div className="ft-metrics">
                    <Metric
                      label="累计评分"
                      icon={Brain}
                      value={reviewStats.total_reviews}
                      unit="次"
                    />
                    <Metric
                      label="连续复习"
                      icon={HeartPulse}
                      value={reviewStats.streak_days}
                      unit="天"
                    />
                    <Metric
                      label="今日评分"
                      icon={CalendarRange}
                      value={reviewStats.reviewed_today}
                      unit="次"
                    />
                    <Metric
                      label="当前待复习"
                      icon={BookMarked}
                      value={reviewStats.due}
                      unit="题"
                    />
                  </div>
                  {hasMemoryReviewData ? (
                    <div className="ft-memory-panels">
                      <section className="ft-panel">
                        <header className="ft-panel-heading">
                          <h2>近 30 天复习</h2>
                        </header>
                        <div className="ft-review-chart">
                          {hasReviewActivity ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={reviewStats.daily}>
                                <XAxis dataKey="date" hide />
                                <Tooltip content={<ChartTooltip />} />
                                <Bar
                                  dataKey="count"
                                  name="评分次数"
                                  fill="var(--ui-accent-solid)"
                                  radius={[3, 3, 0, 0]}
                                  isAnimationActive={false}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="ft-review-empty">
                              <span aria-hidden="true"><Brain size={17} /></span>
                              <strong>近 30 天暂无记忆复习</strong>
                            </div>
                          )}
                        </div>
                        <div className="ft-chart-axis">
                          <span>{reviewStats.daily[0]?.date}</span>
                          <span>{reviewStats.daily.at(-1)?.date}</span>
                        </div>
                      </section>
                      <section className="ft-panel ft-upcoming">
                        <header className="ft-panel-heading">
                          <h2>接下来 7 天</h2>
                        </header>
                        {hasUpcomingReviews ? (
                          <div>
                            {reviewStats.upcoming.map((day) => (
                              <span key={day.date} title={formatDateLabel(day.date)}>
                                <time>{formatMonthDay(day.date)}</time>
                                <strong>{day.count}</strong>
                                <small>题</small>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="ft-upcoming-empty">
                            <span aria-hidden="true"><CalendarRange size={17} /></span>
                            <strong>未来 7 天暂无待复习题</strong>
                          </div>
                        )}
                      </section>
                    </div>
                  ) : (
                    <section className="ft-panel ft-memory-empty-state">
                      <span className="ft-memory-empty-icon" aria-hidden="true">
                        <Brain size={19} />
                      </span>
                      <div className="ft-memory-empty-copy">
                        <h3>开始复习后查看趋势</h3>
                      </div>
                      <span className="ft-memory-empty-badge">尚无复习记录</span>
                    </section>
                  )}
                  <details className="ft-panel ft-heatmap">
                    <summary>
                      一年复习热力图
                      <ChevronRight size={15} />
                    </summary>
                    {heatmapError ? (
                      <p className="ft-heatmap-message" role="status">
                        {heatmapError}
                      </p>
                    ) : !heatmapLoaded ? (
                      <p className="ft-heatmap-message" role="status">
                        正在读取年度热力图…
                      </p>
                    ) : !heatmap.some((day) => day.count > 0) ? (
                      <div className="ft-heatmap-empty">
                        <CalendarRange size={16} aria-hidden="true" />
                        <p>首次记忆复习后开始记录。</p>
                      </div>
                    ) : (
                      <div>
                        <div>
                          {heatmap.map((day) => (
                            <span
                              key={day.date}
                              title={`${day.date}：${day.count} 次`}
                              style={{
                                background: day.count
                                  ? `color-mix(in srgb, var(--ui-accent-solid) ${Math.min(100, 25 + day.count * 12)}%, var(--ui-surface-inset))`
                                  : "var(--ui-surface-inset)",
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </details>
                </>
              )}
            </div>
          )}
          {statsTab === "knowledge" && (
            <div className="ft-stats-view ft-stats-section ft-stats-knowledge">
              <div className="ft-section-lead">
                <div className="ft-section-copy">
                  <h2>知识整理</h2>
                </div>
                <button
                  className="ui-button-secondary"
                  onClick={() => onNavigate("knowledge")}
                >
                  打开知识库
                  <ChevronRight size={14} />
                </button>
              </div>
              {knowledgeSummaryQuery.isError ? (
                <div className="ui-alert-warn" role="alert">
                  知识统计读取失败
                  <button
                    className="ui-button-secondary"
                    onClick={() => knowledgeSummaryQuery.refetch()}
                  >
                    重试
                  </button>
                </div>
              ) : !knowledgeSummary ? (
                <p>正在读取…</p>
              ) : (
                <>
                  <div className="ft-metrics">
                    <Metric label="全部条目" value={knowledgeSummary.total} icon={BookMarked} />
                    <Metric label="待确认" value={knowledgeSummary.draft} icon={PencilLine} />
                    <Metric label="已沉淀" value={knowledgeSummary.confirmed} icon={BookOpenText} />
                    <Metric label="已过时" value={knowledgeSummary.outdated} icon={CircleHelp} />
                  </div>
                  <section className="ft-panel">
                    <header className="ft-panel-heading">
                      <h2>按需完善</h2>
                      <span className="ft-caption">以下条件可能重叠</span>
                    </header>
                    <div className="ft-quality-list">
                      {knowledgeQualityOptions.map(
                        ({ key, label, icon: Icon }) => (
                          <button
                            key={key}
                            onClick={() => onOpenKnowledgeQuality(key)}
                          >
                            <Icon size={18} />
                            <span>
                              {label}
                              {key === "missing_source" ? "（来源可选）" : ""}
                            </span>
                            <strong>{knowledgeSummary[key]}</strong>
                            <ChevronRight size={16} />
                          </button>
                        ),
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          )}
          {statsTab === "generate" && (
            <div className="ft-stats-view ft-stats-section ft-stats-generate">
              <div className="ft-section-lead">
                <div className="ft-section-copy">
                  <h2>生成周期复盘</h2>
                  <p>基于选定周期的今日记录生成独立草稿，原始记录保持不变。</p>
                </div>
                <button
                  className="ui-button-secondary"
                  onClick={() => onNavigate("reviews")}
                >
                  复盘库
                  <ChevronRight size={14} />
                </button>
              </div>
              {reviewError && (
                <div className="ui-alert-bad mb-4" role="alert">
                  {reviewError}
                </div>
              )}
              <div className="ft-generation-context">
                <DatePickerPopover
                  value={reviewWeekDate}
                  onChange={setReviewWeekDate}
                  label="选择一周"
                  className="ft-week-picker"
                />
                <div>
                  <span>
                    {formatDateRange(
                      selectedWeekBounds.first,
                      selectedWeekBounds.last,
                    )}
                  </span>
                  <p>
                    {weekReady && weekReview
                      ? `${weekReview.days_written} 天记录 · ${weekReview.total_words.toLocaleString()} 字`
                      : "正在读取本周记录…"}
                  </p>
                </div>
              </div>
              <div className="ft-generation-grid">
                <ReviewPanel
                  title="周复盘"
                  description="使用所选周的今日记录，生成独立草稿。"
                  kind="weekly"
                  periodLabel={formatDateRange(
                    selectedWeekBounds.first,
                    selectedWeekBounds.last,
                  )}
                  reviews={weeklyReviews}
                  selectedReview={selectedWeeklyReview}
                  generating={generatingKind === "weekly"}
                  generationDisabled={generatingKind !== null || !weekReady}
                  generationStep={generationStep}
                  onGenerate={() => generateAiReview("weekly")}
                  onOpenLibrary={() => onNavigate("reviews")}
                />
                <ReviewPanel
                  title="月复盘"
                  description="优先使用已确认周复盘，补充未覆盖的记录。"
                  kind="monthly"
                  periodLabel={formatMonthLabel(year, month)}
                  reviews={monthlyReviews}
                  selectedReview={selectedMonthlyReview}
                  generating={generatingKind === "monthly"}
                  generationDisabled={generatingKind !== null}
                  generationStep={generationStep}
                  onGenerate={() => generateAiReview("monthly")}
                  onOpenLibrary={() => onNavigate("reviews")}
                />
              </div>
              {weekReady && weekReview && (
                <div className="ft-week-details">
                  {missingDays.length > 0 && (
                    <details className="ft-panel">
                      <summary>
                        本周未记录 · {missingDays.length} 天
                        <ChevronRight size={15} />
                      </summary>
                      <div className="ft-missing-days">
                        {missingDays.map((date) => (
                          <div key={date}>
                            <time>{formatDateLabel(date)}</time>
                            <button
                              className="ui-button-secondary"
                              onClick={() => onEditDate(date)}
                            >
                              补写
                            </button>
                            <button
                              className="ui-button-ghost"
                              onClick={() => openMissingExemption(date)}
                            >
                              日期状态
                            </button>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {weekReview.top_terms.length > 0 && (
                    <div className="ft-week-terms">
                      <span>本周关键词</span>
                      {weekReview.top_terms.slice(0, 10).map((item) => (
                        <button
                          key={item.term}
                          onClick={() => onSearchTerm(item.term)}
                        >
                          {item.term}
                          <small>{item.count}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
      <Dialog.Root
        open={!!dayActionTarget}
        onOpenChange={(open) => {
          if (!open) setDayActionTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in md:hidden" />
          {dayActionTarget && (
            <Dialog.Content className="ui-modal-surface fixed inset-x-0 bottom-0 z-[51] rounded-t-2xl border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] outline-hidden data-[state=open]:animate-slide-up md:hidden">
              <div
                className="ui-sheet-grabber mx-auto mb-3 h-1 w-10 rounded-full"
                aria-hidden="true"
              />
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <Dialog.Title className="text-base font-semibold text-[var(--ui-text)]">
                    日期操作
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
                    {formatDateLabel(dayActionTarget.date)} · 选择要执行的操作
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="ui-icon-button h-9 w-9"
                    aria-label="关闭日期操作"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </Dialog.Close>
              </div>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = dayActionTarget;
                    setDayActionTarget(null);
                    onEditDate(target.date);
                  }}
                  className="ui-button-secondary min-h-12 justify-start px-4 text-sm"
                >
                  <PencilLine
                    size={17}
                    className="text-[var(--ui-accent-text)]"
                  />
                  <span className="flex flex-col items-start">
                    <span className="font-semibold">编辑记录</span>
                    <span className="mt-0.5 text-xs font-normal text-[var(--ui-text-subtle)]">
                      {dayActionTarget.has_article
                        ? "打开这一天的总结"
                        : "补写这一天的总结"}
                    </span>
                  </span>
                </button>
                {!dayActionTarget.has_article && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = dayActionTarget;
                      setDayActionTarget(null);
                      openExemptionMenu(target);
                    }}
                    className="ui-button-secondary min-h-12 justify-start px-4 text-sm"
                  >
                    <ShieldCheck
                      size={17}
                      className="text-[var(--ui-warning-text)]"
                    />
                    <span className="flex flex-col items-start">
                      <span className="font-semibold">
                        {dayActionTarget.exemption
                          ? "编辑日期状态"
                          : "设置日期状态"}
                      </span>
                      <span className="mt-0.5 text-xs font-normal text-[var(--ui-text-subtle)]">
                        选择请假、休息、生病或出差
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </Dialog.Content>
          )}
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={!!exemptionTarget}
        onOpenChange={(open) => {
          if (!open && !savingExemption) setExemptionTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
          {exemptionTarget && (
            <Dialog.Content className="ui-modal-surface fixed inset-x-3 bottom-3 z-[51] max-h-[min(90dvh,560px)] overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] outline-hidden data-[state=open]:animate-fade-in sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-1.5rem)] sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2">
              <div className="mb-3">
                <Dialog.Title className="text-sm font-semibold text-[var(--ui-text)]">
                  日期状态
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-[var(--ui-text-muted)]">
                  {formatDateLabel(exemptionTarget.date)} ·
                  选择一个状态；这一天不算记录，但不会打断连续覆盖。
                </Dialog.Description>
              </div>
              <label
                htmlFor="exemption-note"
                className="mb-1.5 block text-xs font-medium text-[var(--ui-text-muted)]"
              >
                状态备注{" "}
                <span className="font-normal text-[var(--ui-text-subtle)]">
                  （可选）
                </span>
              </label>
              <textarea
                id="exemption-note"
                value={exemptionNote}
                onChange={(e) => setExemptionNote(e.target.value)}
                rows={2}
                placeholder="补充原因或安排"
                className="ui-textarea mb-3"
              />
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="日期状态选项"
              >
                {exemptionReasons.map((reason) => {
                  const tone = getExemptionTone(reason);
                  const ReasonIcon = getExemptionIcon(reason);
                  const selected = exemptionTarget.exemption?.reason === reason;
                  return (
                    <button
                      key={reason}
                      type="button"
                      disabled={savingExemption}
                      onClick={() => saveExemption(reason)}
                      aria-pressed={selected}
                      className={[
                        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-60",
                        selected ? tone.solid : tone.option,
                      ].join(" ")}
                    >
                      <ReasonIcon size={15} />
                      {reason}
                    </button>
                  );
                })}
              </div>
              {exemptionError && (
                <p role="alert" className="ui-alert-bad mt-3 text-xs">
                  {exemptionError}
                </p>
              )}
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    disabled={savingExemption}
                    className="ui-button-secondary h-10 px-4 text-sm"
                  >
                    取消
                  </button>
                </Dialog.Close>
                {exemptionTarget.exemption && (
                  <button
                    type="button"
                    onClick={clearExemption}
                    disabled={savingExemption}
                    className="ui-button-danger h-10 px-4 text-sm disabled:opacity-60"
                  >
                    清除原因
                  </button>
                )}
              </div>
            </Dialog.Content>
          )}
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function StatsLoadingState({ monthLabel }: { monthLabel: string }) {
  return (
    <div
      className="ui-panel-muted flex min-h-[240px] flex-col items-center justify-center rounded-2xl px-6 py-10 text-center"
      role="status"
      aria-live="polite"
    >
      <span className="ui-status-accent inline-flex h-11 w-11 items-center justify-center rounded-2xl">
        <LoaderCircle size={21} className="animate-spin" />
      </span>
      <h2 className="mt-4 text-sm font-semibold text-[var(--ui-text)]">
        正在加载统计
      </h2>
      <p className="mt-1.5 max-w-sm text-xs leading-5 text-[var(--ui-text-subtle)]">
        正在同步 {monthLabel} 的记录、月历和本周复盘。
      </p>
      <div
        className="mt-5 grid w-full max-w-md grid-cols-3 gap-2"
        aria-hidden="true"
      >
        <span className="ui-skeleton h-2 rounded-full" />
        <span className="ui-skeleton h-2 rounded-full" />
        <span className="ui-skeleton h-2 rounded-full" />
      </div>
    </div>
  );
}

function StatsErrorState({
  message,
  onRetry,
  onOpenSettings,
}: {
  message: string;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div
      className="ui-alert-bad flex flex-col gap-4 rounded-2xl p-4 sm:p-5"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <span
          className="ui-status-danger flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          aria-hidden="true"
        >
          <CircleHelp size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--ui-text)]">
            统计暂时无法加载
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
            {message || "请检查连接设置后重试。"}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onRetry}
          className="ui-button-primary min-h-11 px-4 text-sm sm:min-h-10"
        >
          重试
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="ui-button-secondary min-h-11 px-4 text-sm sm:min-h-10"
        >
          打开连接设置
        </button>
      </div>
    </div>
  );
}

function CalendarDay({
  day,
  isToday,
  onEditDate,
  onOpenDayActions,
  onManageExemption,
}: {
  day: MonthDayStats;
  isToday: boolean;
  onEditDate: (date: string) => void;
  onOpenDayActions: (day: MonthDayStats) => void;
  onManageExemption: (day: MonthDayStats) => void;
}) {
  const dateNum = Number(day.date.slice(-2));
  const words = Math.min(100, Math.max(8, Math.round(day.word_count / 8)));
  const canManageExemption = !day.has_article;
  const exemptionTone = getExemptionTone(day.exemption?.reason);
  const ExemptionIcon = day.exemption
    ? getExemptionIcon(day.exemption.reason)
    : ShieldCheck;
  const openExemption = (e: MouseEvent<HTMLElement>) => {
    if (!canManageExemption) return;
    e.preventDefault();
    e.stopPropagation();
    onManageExemption(day);
  };
  return (
    <div
      data-calendar-cell="day"
      onContextMenu={openExemption}
      title={day.title || day.exemption?.reason || formatDateLabel(day.date)}
      className={[
        "ui-calendar-cell group relative box-border h-full min-h-0 overflow-hidden rounded-lg text-left",
        day.has_article
          ? "ui-calendar-cell-article"
          : day.exemption
            ? `${exemptionTone.card} ${exemptionTone.hover}`
            : "",
        isToday ? "ui-calendar-cell-today" : "",
      ].join(" ")}
    >
      <div
        className="ft-calendar-day-content pointer-events-none absolute inset-0 flex flex-col gap-0.5 p-0.5"
        aria-hidden="true"
      >
        <div className="ft-calendar-day-head flex h-5 shrink-0 items-center justify-between gap-1">
          <span
            className={[
              "ui-calendar-date inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[11px] font-semibold leading-none",
              day.has_article ? "ui-calendar-date-article" : "",
            ].join(" ")}
          >
            {dateNum}
          </span>
          {day.has_article ? (
            <span className="ui-calendar-doc inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
              <FileText size={10} />
            </span>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}
        </div>

        {day.has_article ? (
          <div className="ft-calendar-day-footer mt-auto min-w-0">
            <div className="ui-calendar-meter-track mb-0.5 h-0.5 overflow-hidden rounded-full sm:h-1">
              <div
                className="ui-calendar-meter-fill h-full rounded-full"
                style={{ width: words + "%" }}
              />
            </div>
            <div className="hidden items-center justify-between gap-1 truncate text-[9px] leading-none text-[var(--ui-text-muted)] sm:flex">
              <span className="truncate">{day.word_count} 字</span>
              {day.mood && <span className="max-w-[40%] shrink-0 truncate">{day.mood}</span>}
            </div>
          </div>
        ) : day.exemption ? (
          <div className="ft-calendar-day-status flex min-h-0 flex-1 items-center justify-center px-1">
            <span className={"inline-flex max-w-full items-center gap-1 truncate rounded-full px-1 py-0.5 text-[10px] font-medium sm:px-1.5 " + exemptionTone.pill}>
              <ExemptionIcon size={12} />
              <span className="hidden sm:inline">{day.exemption.reason}</span>
            </span>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() =>
          day.exemption && !day.has_article
            ? onManageExemption(day)
            : onEditDate(day.date)
        }
        aria-label={`${formatDateLabel(day.date)}，${day.has_article ? "编辑记录" : day.exemption ? `编辑${day.exemption.reason}状态` : "补写记录"}`}
        className="absolute inset-0 z-10 hidden overflow-hidden rounded-lg text-left focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-[var(--ui-focus)]/40 md:block"
      />

      <button
        type="button"
        onClick={() => onOpenDayActions(day)}
        aria-label={`${formatDateLabel(day.date)}，打开日期操作`}
        className="absolute inset-0 z-10 rounded-lg text-left focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-[var(--ui-focus)]/40 md:hidden"
      />

      {canManageExemption && (
        <button
          type="button"
          onClick={openExemption}
          aria-label={`${formatDateLabel(day.date)} ${day.exemption ? "编辑" : "设置"}日期状态`}
          title={`${day.exemption ? "编辑" : "设置"}日期状态`}
          className={[
            "ui-calendar-action absolute right-1 top-1 z-20 hidden h-5 w-5 items-center justify-center rounded-md transition-colors transition-opacity focus:outline-hidden focus:ring-2 focus:ring-[var(--ui-focus)]/50 sm:inline-flex sm:right-1 sm:top-1",
            day.exemption
              ? `${exemptionTone.pill} sm:opacity-100`
              : "ui-calendar-action-default text-[var(--ui-text-subtle)] sm:opacity-50 sm:hover:opacity-100",
          ].join(" ")}
        >
          <ExemptionIcon size={13} />
        </button>
      )}
    </div>
  );
}

function getExemptionTone(reason?: string) {
  if (reason === "休息" || reason === "放假") {
    return {
      card: "ui-status-success",
      hover: "hover:shadow-xs",
      pill: "ui-status-success",
      note: "text-[var(--ui-success-text)]",
      bar: "bg-[var(--ui-success-action)]",
      option: "ui-status-success",
      solid: "ui-status-success-solid",
    };
  }
  if (reason === "生病") {
    return {
      card: "ui-status-danger",
      hover: "hover:shadow-xs",
      pill: "ui-status-danger",
      note: "text-[var(--ui-danger-text)]",
      bar: "bg-[var(--ui-danger-action)]",
      option: "ui-status-danger",
      solid: "ui-status-danger-solid",
    };
  }
  if (reason === "出差") {
    return {
      card: "ui-status-info",
      hover: "hover:shadow-xs",
      pill: "ui-status-info",
      note: "text-[var(--ui-info-text)]",
      bar: "bg-[var(--ui-info-action)]",
      option: "ui-status-info",
      solid: "ui-status-info-solid",
    };
  }
  return {
    card: "ui-status-warning",
    hover: "hover:shadow-xs",
    pill: "ui-status-warning",
    note: "text-[var(--ui-warning-text)]",
    bar: "bg-[var(--ui-warning-action)]",
    option: "ui-status-warning",
    solid: "ui-status-warning-solid",
  };
}

function getExemptionIcon(reason?: string): LucideIcon {
  if (reason === "休息" || reason === "放假") return Coffee;
  if (reason === "生病") return HeartPulse;
  if (reason === "出差") return Plane;
  if (reason === "请假") return Umbrella;
  return CircleHelp;
}

function ReviewPanel({
  className = "",
  title,
  description,
  kind,
  periodLabel,
  reviews,
  selectedReview,
  generating,
  generationDisabled,
  generationStep = "collecting",
  estimateLabel,
  onGenerate,
  onOpenLibrary,
}: {
  className?: string;
  title: string;
  description: string;
  kind: ReviewKind;
  periodLabel: string;
  reviews: Review[];
  selectedReview: Review | null;
  generating: boolean;
  generationDisabled: boolean;
  generationStep?: ReviewGenerationStep;
  estimateLabel?: string;
  onGenerate: () => void;
  onOpenLibrary: () => void;
}) {
  const previewContent = selectedReview
    ? reviewPreview(
        selectedReview.kind,
        selectedReview.title,
        selectedReview.content,
        360,
      )
    : "";

  return (
    <section className={`ui-panel p-4 transition-colors sm:p-4 ${className}`}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-bold text-[var(--ui-text)]">
            {kind === "weekly" ? (
              <BarChart3 size={16} />
            ) : (
              <LineChart size={16} />
            )}{" "}
            {title}
          </h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ui-text-muted)]">
            {description}
          </p>
        </div>
        {selectedReview && (
          <span className="ui-status-muted shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium">
            v{selectedReview.version} · {reviews.length} 版
          </span>
        )}
      </div>

      <div className="ui-panel-muted mb-3 rounded-lg px-3 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="ui-section-kicker inline-flex items-center gap-1.5">
              <CalendarRange size={12} /> 生成周期
            </div>
            <div className="mt-0.5 truncate text-xs font-semibold text-[var(--ui-text)]">
              {periodLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Review preview */}
      {selectedReview ? (
        <div className="ui-panel-muted mb-3 rounded-lg p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="truncate text-xs font-medium text-[var(--ui-text-muted)]">
              {selectedReview.title}
            </span>
            <ReviewStatusPill status={selectedReview.status} />
          </div>
          <p className="line-clamp-4 break-words text-xs leading-5 text-[var(--ui-text-muted)]">
            {previewContent}
          </p>
        </div>
      ) : reviews.length > 0 ? (
        <p className="mb-4 text-xs text-[var(--ui-text-subtle)]">
          进入复盘库查看历史版本
        </p>
      ) : (
        <p className="mb-4 text-xs text-[var(--ui-text-subtle)]">
          还没有 AI 复盘版本
        </p>
      )}

      {(estimateLabel || generating) && (
        <div
          className={`mb-3 min-h-[52px] rounded-lg border px-3 py-2 text-xs leading-5 ${generating ? "ui-status-accent" : "ui-panel-muted text-[var(--ui-text-muted)]"}`}
        >
          {generating ? (
            <>
              <div className="mb-1.5 flex items-center gap-2 font-medium">
                <LoaderCircle
                  size={13}
                  className="animate-spin text-[var(--ui-accent-text)]"
                />
                {generationStep === "idle"
                  ? "准备生成"
                  : STEP_LABELS[generationStep]}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ui-surface-inset)]">
                <div
                  className="h-full rounded-full bg-[var(--ui-accent-solid)] transition-all duration-300"
                  style={{
                    width:
                      generationStep === "saving"
                        ? "100%"
                        : generationStep === "requesting"
                          ? "66%"
                          : "33%",
                  }}
                />
              </div>
            </>
          ) : (
            estimateLabel
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generationDisabled}
          className="ui-button-primary min-h-11 w-full sm:min-h-10 sm:w-auto"
        >
          {generating ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {generating
            ? "生成中..."
            : kind === "weekly"
              ? "AI 周复盘"
              : "AI 月复盘"}
        </button>
        <button
          type="button"
          onClick={onOpenLibrary}
          className="ui-button-secondary min-h-11 w-full px-3 sm:min-h-10 sm:w-auto"
          title="打开复盘库"
        >
          <BookOpenText size={15} />
          复盘库
        </button>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  unit,
  note,
  icon: Icon,
}: {
  label: string;
  value: number;
  unit?: string;
  note?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="ft-metric" title={note}>
      <div className="ft-metric-top">
        <span>{label}</span>
        <span className="ft-metric-icon" aria-hidden="true">
          <Icon size={14} strokeWidth={1.8} />
        </span>
      </div>
      <strong>
        {value.toLocaleString()}
        <small>{unit}</small>
      </strong>
      {note && <p>{note}</p>}
    </div>
  );
}
