import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import { Activity, BarChart3, BookMarked, BookOpenText, Brain, CalendarCheck, CalendarClock, CalendarDays, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock, Coffee, FileText, Flame, Folder, Heart, HeartPulse, LineChart, LoaderCircle, PencilLine, Plane, Repeat, ShieldCheck, Sparkles, Tags, Target, TrendingUp, Trophy, Umbrella } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as api from "../lib/api";
import type { MonthDayStats, Review, ReviewKind, StatsOverview, WeekReview } from "../lib/api";
import type { Page } from "../App";
import { reviewPreview } from "../lib/reviewContent";
import { generateReviewVersion, selectLatestReview, upsertReviewVersion } from "../lib/reviewGeneration";
import type { ReviewGenerationStep } from "../lib/reviewGeneration";
import { loadStatsSnapshot } from "../lib/statsSnapshot";
import { useCountUp } from "../lib/useCountUp";
import { ReviewStatusPill } from "./reviews/ReviewShared";
import PageHeader from "./ui/PageHeader";
import DatePickerPopover from "./ui/date-picker";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value?: number | string; name?: string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  return (
    <div className="ui-modal-surface w-auto px-3 py-2 text-xs">
      {label != null && label !== "" && (
        <div className="mb-1 font-medium text-[var(--ui-text-muted)]">{formatDateLabel(String(label))}</div>
      )}
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: p.color || "var(--ui-accent-solid)" }}
        />
        {p.name ? (
          <span className="text-[var(--ui-text-muted)]">{p.name}</span>
        ) : null}
        <span className="ml-auto font-semibold text-[var(--ui-text)]">{p.value}</span>
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
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
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
  { key: "missing_source", label: "缺少来源", hint: "补回日期或证据片段", icon: FileText, tone: "amber" },
  { key: "missing_project", label: "未归入项目", hint: "补充项目归属", icon: Folder, tone: "sky" },
  { key: "missing_tags", label: "缺少标签", hint: "补充检索标签", icon: Tags, tone: "accent" },
  { key: "short_content", label: "内容过短", hint: "补成可复习的完整表述", icon: BookMarked, tone: "rose" },
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
  const now = new Date();
  const initialMonthParts = parseMonthParam(initialMonth);
  const initialIsCurrentMonth = Boolean(initialMonthParts && initialMonthParts.year === now.getFullYear() && initialMonthParts.month === now.getMonth() + 1);
  const [year, setYear] = useState(initialMonthParts?.year ?? now.getFullYear());
  const [month, setMonth] = useState(initialMonthParts?.month ?? now.getMonth() + 1);
  const lastInitialMonth = useRef(initialMonth);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [days, setDays] = useState<MonthDayStats[]>([]);
  const [reviewStats, setReviewStats] = useState<api.ReviewStatsResponse | null>(null);
  const [heatmap, setHeatmap] = useState<api.DailyReviewCount[]>([]);
  const [weekReview, setWeekReview] = useState<WeekReview | null>(null);
  const [weeklyReviews, setWeeklyReviews] = useState<Review[]>([]);
  const [monthlyReviews, setMonthlyReviews] = useState<Review[]>([]);
  const [reviewWeekDate, setReviewWeekDate] = useState(() =>
    initialMonthParts && !initialIsCurrentMonth ? `${initialMonthParts.year}-${String(initialMonthParts.month).padStart(2, "0")}-15` : todayDate()
  );
  const [reviewError, setReviewError] = useState("");
  const [generatingKind, setGeneratingKind] = useState<ReviewKind | null>(null);
  const [generationStep, setGenerationStep] = useState<ReviewGenerationStep>("idle");
  const [expandedMissingDays, setExpandedMissingDays] = useState(false);
  const [activeMissingDay, setActiveMissingDay] = useState<string | null>(null);
  const [dayActionTarget, setDayActionTarget] = useState<MonthDayStats | null>(null);
  const [exemptionTarget, setExemptionTarget] = useState<MonthDayStats | null>(null);
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
  const selectedWeekBounds = useMemo(() => weekBounds(reviewWeekDate), [reviewWeekDate]);
  const generationAnchors = useRef({ weekly: reviewWeekDate, monthly: bounds.first });
  generationAnchors.current = { weekly: reviewWeekDate, monthly: bounds.first };
  const selectedMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const monthDataChanged = loadedMonthKey.current !== selectedMonthKey;
  const weekReady = Boolean(weekReview && loadedWeekDate.current === reviewWeekDate);
  const maxMoodCount = Math.max(1, ...Object.values(overview?.mood_counts || {}));
  const writtenDays = overview?.days_written || 0;
  const exemptedDays = overview?.exempted_days || 0;
  const coveredDays = writtenDays + exemptedDays;
  const completion = bounds.daysInMonth > 0 ? Math.round((coveredDays / bounds.daysInMonth) * 100) : 0;
  const coreLoading = (loading && !overview) || (monthDataChanged && Boolean(overview));
  const coreError = !overview && !loading && Boolean(error);
  const animatedCompletion = useCountUp(coreLoading ? null : completion);
  const today = todayDate();
  const selectedWeeklyReview = chooseCurrentReview(weeklyReviews);
  const selectedMonthlyReview = chooseCurrentReview(monthlyReviews);
  const activeDays = useMemo(() => days.filter((day) => day.has_article), [days]);
  const longestDay = useMemo(
    () => activeDays.reduce<MonthDayStats | null>((best, day) => (!best || day.word_count > best.word_count ? day : best), null),
    [activeDays]
  );
  const latestDay = useMemo(() => [...activeDays].reverse()[0] || null, [activeDays]);
  const rhythmData = useMemo(
    () =>
      days.map((day) => {
        let color = "var(--ui-border-strong)";
        let value = 0;
        let status = "空缺";
        if (day.has_article) {
          color = "var(--ui-accent-solid)";
          value = day.word_count;
          status = `${day.word_count} 字`;
        } else if (day.exemption) {
          const reason = day.exemption.reason;
          color =
            reason === "休息" || reason === "放假"
              ? "var(--ui-success-action)"
              : reason === "生病"
                ? "var(--ui-danger-action)"
                : reason === "出差"
                  ? "var(--ui-info-action)"
                  : "var(--ui-warning-action)";
          value = 1;
          status = `豁免：${reason}`;
        }
        return { date: day.date, value, color, status };
      }),
    [days]
  );
  const exemptionReasonCounts = useMemo(
    () =>
      days.reduce<Record<string, number>>((acc, day) => {
        if (day.exemption?.reason) acc[day.exemption.reason] = (acc[day.exemption.reason] || 0) + 1;
        return acc;
      }, {}),
    [days]
  );
  const dominantExemptionReason = useMemo(
    () => Object.entries(exemptionReasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0],
    [exemptionReasonCounts]
  );
  const exemptionMetricTone = exemptedDays > 0 ? getExemptionToneName(dominantExemptionReason) : "gray";
  const todayInSelectedMonth = today.startsWith(`${year}-${String(month).padStart(2, "0")}`);
  const selectedMonthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const remainingDays = todayInSelectedMonth
    ? Math.max(0, bounds.daysInMonth - Number(today.slice(-2)))
    : selectedMonthStart > today
      ? bounds.daysInMonth
      : 0;
  const moodEntries = useMemo(
    () => Object.entries(overview?.mood_counts || {}).sort((a, b) => b[1] - a[1]),
    [overview?.mood_counts]
  );
  const moodDisplayLimit = moodEntries.length > 12 ? 11 : 12;
  const visibleMoodEntries = moodEntries.slice(0, moodDisplayLimit);
  const hiddenMoodCount = Math.max(0, moodEntries.length - visibleMoodEntries.length);
  const moodColumnCount = Math.min(6, Math.max(1, moodEntries.length));
  const compactMood = moodEntries.length > 6;
  const denseMood = moodEntries.length > 12;
  const knowledgeSummary = knowledgeSummaryQuery.data;
  const knowledgeQualityIssueCount = knowledgeSummary
    ? knowledgeQualityOptions.reduce((total, option) => total + knowledgeSummary[option.key], 0)
    : 0;
  const missingDays = weekReady ? weekReview?.missing_days || [] : [];
  const visibleMissingDays = expandedMissingDays ? missingDays : missingDays.slice(0, 5);
  const monthHighlights = [
    { icon: Trophy, label: "最长记录", value: longestDay ? `${longestDay.word_count} 字` : "暂无", meta: longestDay ? formatDateLabel(longestDay.date) : "写下第一篇后出现" },
    { icon: Clock, label: "最近记录", value: latestDay ? formatMonthDay(latestDay.date) : "暂无", meta: latestDay?.title || "本月还没有记录" },
    { icon: Target, label: "当前空缺", value: `${overview?.missing_days || 0} 天`, meta: remainingDays ? `本月还剩 ${remainingDays} 天` : "当前月份已无剩余天" },
  ];

  const calendarCells = useMemo(() => {
    const leading = Array.from({ length: bounds.offset }, () => null);
    const trailingCount = Math.max(0, 42 - leading.length - days.length);
    return [
      ...leading,
      ...days,
      ...Array.from({ length: trailingCount }, () => null),
    ];
  }, [bounds.offset, days]);

  const loadStats = useCallback(async (showLoading = true) => {
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
        if (reviewLoadError instanceof api.ApiError && reviewLoadError.status === 404) {
          setReviewError("AI 复盘接口不存在：服务端可能还在运行旧版本。基础统计仍可使用，请更新并重启服务端。");
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
  }, [bounds.first, bounds.last, selectedWeekBounds.first, selectedWeekBounds.last, year, month, reviewWeekDate]);

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

  useEffect(() => {
    if (activeMissingDay && !missingDays.includes(activeMissingDay)) {
      setActiveMissingDay(null);
    }
  }, [activeMissingDay, missingDays]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setReviewWeekDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15`);
    onMonthChange?.(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const goCurrentMonth = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setReviewWeekDate(today);
    onMonthChange?.(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
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
    setActiveMissingDay(null);
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
    return () => { mountedRef.current = false; };
  }, []);

  // 复习统计 + 热力图（可降级提示，不影响页面主体）
  useEffect(() => {
    setReviewStatsError("");
    setHeatmapError("");
    api.getReviewStats()
      .then((stats) => { if (mountedRef.current) setReviewStats(stats); })
      .catch((e) => {
        if (!mountedRef.current) return;
        setReviewStats(null);
        setReviewStatsError(api.getErrorMessage(e) || "复习统计暂时不可用");
      });
    api.getReviewHeatmap(365)
      .then((data) => { if (mountedRef.current) setHeatmap(data); })
      .catch((e) => {
        if (!mountedRef.current) return;
        setHeatmap([]);
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
        () => mountedRef.current && generationAnchors.current[kind] === anchorDate,
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
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-surface page-surface-stats min-h-full px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6"
    >
      <PageHeader
        icon={BarChart3}
        title="统计"
        description={`${formatMonthLabel(year, month)} · ${coreLoading ? "正在加载统计" : coreError ? "暂时无法加载统计" : `${writtenDays} 天记录，${exemptedDays} 天豁免`}`}
        navigation={
          <div className="ui-toolbar flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="ui-icon-button h-11 w-11 md:h-8 md:w-8"
              title="上个月"
              aria-label="上个月"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={goCurrentMonth}
              className="ui-button-ghost h-11 min-h-11 px-3 text-xs font-semibold text-[var(--ui-accent-text)] md:h-8 md:min-h-8"
              aria-label="回到本月"
            >
              本月
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="ui-icon-button h-11 w-11 md:h-8 md:w-8"
              title="下个月"
              aria-label="下个月"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      {coreLoading ? (
        <StatsLoadingState monthLabel={formatMonthLabel(year, month)} />
      ) : coreError ? (
        <StatsErrorState message={error} onRetry={() => loadStats()} onOpenSettings={() => onNavigate("settings")} />
      ) : (
        <>
      {reviewError && (
        <div className="ui-alert-bad mb-4" role="alert" aria-live="assertive">
          {reviewError}
        </div>
      )}
      {reviewStatsError && !reviewStats && (
        <div className="ui-alert-warn mb-4" role="status" aria-live="polite">
          复习统计暂时不可用：{reviewStatsError}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 mb-4 md:mb-6">
        <StatCard icon={CalendarDays} label="记录天数" value={coreLoading ? "..." : `${writtenDays} 天`} tone="accent" animate />
        <StatCard
          icon={TrendingUp}
          label="连续覆盖"
          value={coreLoading ? "..." : `${overview?.current_streak || 0} 天`}
          meta={overview?.streak_exempted_days ? `含 ${overview.streak_exempted_days} 天豁免` : "不含豁免"}
          tone="sky"
          animate
        />
        <StatCard icon={FileText} label="总字数" value={coreLoading ? "..." : `${overview?.total_words || 0}`} tone="amber" animate />
        <StatCard
          icon={ShieldCheck}
          label="豁免天数"
          value={coreLoading ? "..." : `${exemptedDays} 天`}
          meta={dominantExemptionReason ? `主要：${dominantExemptionReason}` : undefined}
          tone={exemptionMetricTone}
          animate
        />
      </div>

      <div className="space-y-4 md:space-y-6">
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
        <section className="min-w-0 h-[clamp(440px,78dvh,644px)] min-h-[440px] sm:h-[684px] sm:min-h-0 xl:h-[760px]">
          <div className="ui-panel flex h-full flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3 sm:px-4 ui-soft-divider">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-text)]">
                  <CalendarRange size={16} className="text-[var(--ui-accent-text)]" /> 月历
                </h3>
                <p className="mt-0.5 text-xs text-[var(--ui-text-subtle)]">
                  <span className="hidden sm:inline">点击日期编辑记录；空缺日右上角可设置请假、休息等状态</span>
                  <span className="sm:hidden">点击日期选择编辑记录或设置日期状态</span>
                </p>
              </div>
              <div className="w-24 shrink-0 sm:w-36">
                <div className="mb-1 flex justify-between text-[11px] text-[var(--ui-text-subtle)]">
                  <span>覆盖度</span>
                  <span>{animatedCompletion}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--ui-surface-inset)]">
                  <div className="ui-accent-fill h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${animatedCompletion}%` }} />
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
              <div className="mb-1.5 grid shrink-0 grid-cols-7 gap-1 sm:gap-2">
                {weekdays.map((d) => (
                  <div key={d} className="py-1.5 text-center text-xs font-semibold uppercase tracking-wider text-[var(--ui-text-subtle)]">
                    {d}
                  </div>
                ))}
              </div>
              <div
                data-calendar-grid="month"
                className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[repeat(6,minmax(0,1fr))] items-stretch gap-1 overflow-hidden sm:gap-2"
              >
                {calendarCells.map((day, i) => (
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
                    <div key={`blank-${i}`} data-calendar-cell="blank" className="ui-calendar-cell-blank box-border h-full min-h-0 rounded-lg" />
                  )
                ))}
              </div>
            </div>

            <div className="ui-soft-divider flex h-9 shrink-0 items-center border-t px-2 sm:px-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <LegendDot className="ui-accent-fill" label="记录" />
                <LegendDot className="ui-success-fill" label="休息/放假" />
                <LegendDot className="ui-warning-fill" label="请假/其他" />
                <LegendDot className="ui-danger-fill" label="生病" />
                <LegendDot className="ui-info-fill" label="出差" />
                <LegendDot className="bg-[var(--ui-border-strong)]" label="空缺" />
                <span className="ui-chip ml-1 h-6 shrink-0 px-2 text-[11px] sm:ml-auto">
                  {writtenDays} 天记录 · {exemptedDays} 天豁免
                </span>
              </div>
            </div>
          </div>
        </section>

          <section className="ui-panel h-auto min-h-0 min-w-0 overflow-visible p-3 sm:h-[684px] sm:overflow-y-auto sm:p-4 xl:h-[760px]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-text)]">
                  <BarChart3 size={16} className="text-[var(--ui-accent-text)]" /> 本月概况
                </h3>
                <p className="mt-1 text-xs text-[var(--ui-text-subtle)]">覆盖节奏、记录强度和本月亮点</p>
              </div>
              <span className="ui-status-accent inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium">
                <CalendarRange size={12} />
                {coveredDays}/{bounds.daysInMonth} 天
              </span>
            </div>

            <div className="ui-panel-muted grid gap-4 p-3 sm:grid-cols-[150px_1fr]">
              <div className="flex items-center justify-center">
                <div className="relative h-24 w-24">
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="52" fill="none" strokeWidth="10" className="stroke-[var(--ui-border)]" />
                    <circle
                      cx="60"
                      cy="60"
                      r="52"
                      fill="none"
                      strokeWidth="10"
                      strokeLinecap="round"
                      className="stroke-accent transition-[stroke-dasharray] duration-500 ease-out"
                      strokeDasharray={`${Math.min(100, Math.max(0, animatedCompletion)) * 3.267} 326.7`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-[var(--ui-text)]">{animatedCompletion}%</span>
                    <span className="mt-0.5 text-xs text-[var(--ui-text-subtle)]">覆盖度</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <CompactMetric icon={CalendarCheck} label="覆盖" value={`${coveredDays}`} unit="天" tone="accent" />
                <CompactMetric icon={Clock} label="剩余" value={`${remainingDays}`} unit="天" tone="gray" />
                <CompactMetric icon={TrendingUp} label="连续" value={`${overview?.current_streak || 0}`} unit="天" tone="sky" />
                <CompactMetric icon={FileText} label="记录" value={`${writtenDays}`} unit="天" tone="green" />
                <CompactMetric icon={ShieldCheck} label="豁免" value={`${exemptedDays}`} unit="天" tone="rose" />
                <CompactMetric icon={Activity} label="日均" value={`${Math.round(overview?.avg_words || 0)}`} unit="字" tone="amber" />
              </div>
            </div>

            <div className="ui-panel-muted mt-3 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ui-text-muted)]">
                  <Activity size={14} /> 本月节奏
                </h4>
                <span className="text-[11px] text-[var(--ui-text-subtle)]">记录 / 豁免 / 空缺</span>
              </div>
              <div className="h-24" role="img" aria-label="本月记录、豁免和空缺节奏图">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rhythmData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <Tooltip
                      cursor={{ fill: "var(--ui-surface-selected)" }}
                      content={<ChartTooltip />}
                      formatter={(_value, _name, item) => {
                        const payload = item?.payload as { status?: string } | undefined;
                        return [payload?.status ?? "", "状态"];
                      }}
                    />
                    <Bar
                      dataKey="value"
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(data) => {
                        const d = data as { date?: string };
                        if (d?.date) onEditDate(d.date);
                      }}
                    >
                      {rhythmData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--ui-text-subtle)]">
                <span>{formatMonthDay(bounds.first)}</span>
                <span>最长 {longestDay ? `${longestDay.word_count} 字` : "暂无"}</span>
                <span>{formatMonthDay(bounds.last)}</span>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {monthHighlights.map((item) => (
                <MonthHighlightCard key={item.label} {...item} />
              ))}
            </div>

              <div className="ui-panel-muted mt-3 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ui-text-muted)]">
                  <Heart size={14} /> 心情分布
                </h4>
                <span className="text-[11px] text-[var(--ui-text-subtle)]">{moodEntries.length} 类</span>
              </div>
              {moodEntries.length === 0 ? (
                <p className="text-sm text-[var(--ui-text-subtle)]">本月还没有心情记录</p>
              ) : (
                <div
                  className="grid gap-1.5 overflow-hidden"
                  style={{
                    gridTemplateColumns: `repeat(${moodColumnCount}, minmax(0, 1fr))`,
                    gridAutoRows: compactMood ? "32px" : "42px",
                    maxHeight: compactMood ? "70px" : "42px",
                  }}
                >
                  {visibleMoodEntries.map(([mood, count], index) => (
                    <MoodMetric
                      key={mood}
                      mood={mood}
                      count={count}
                      ratio={(count / maxMoodCount) * 100}
                      colorClass={moodColorClass(index)}
                      compact={compactMood}
                      dense={denseMood}
                    />
                  ))}
                  {hiddenMoodCount > 0 && (
                    <div className="ui-panel-muted flex h-full min-h-0 items-center justify-center rounded-lg px-2 text-center text-xs font-medium text-[var(--ui-text-subtle)]">
                      +{hiddenMoodCount}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <button
              type="button"
              onClick={() => onEditDate(today)}
              className="ui-button-primary mt-4 h-11 w-full text-sm md:h-10"
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <PencilLine size={15} /> 编辑今天
              </span>
            </button>
          </section>
        </div>

          <section className="ui-panel h-full p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ui-text)]">本周复盘</h3>
                <p className="mt-1 text-xs text-[var(--ui-text-subtle)]">
                  {formatDateRange(selectedWeekBounds.first, selectedWeekBounds.last)} · {weekReady ? "可查看本周记录" : "正在加载"}
                </p>
              </div>
              <DatePickerPopover
                value={reviewWeekDate}
                onChange={setReviewWeekDate}
                label="选择一周"
                className="w-full sm:w-[168px]"
              />
            </div>
            {weekReady && weekReview ? (
              <>
            <div className="space-y-3 text-sm">
              <InfoRow label="记录 / 豁免" value={`${weekReview.days_written} / ${weekReview.exempted_days} 天`} />
              <InfoRow
                label="空缺天"
                value={weekReview.missing_days.length ? `${weekReview.missing_days.length} 天` : "无"}
              />
              <InfoRow label="总字数" value={`${weekReview.total_words}`} />
              <InfoRow label="平均字数" value={`${Math.round(weekReview.avg_words)}`} />
            </div>
            {weekReview?.longest_article && (
              <button
                type="button"
                onClick={() => onEditDate(weekReview.longest_article!.date)}
                className="ui-panel-muted mt-4 w-full px-3 py-2 text-left transition-colors hover:border-[var(--ui-selected-border)]"
              >
                <div className="text-[11px] text-[var(--ui-text-subtle)]">最长记录</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--ui-text)]">
                  {weekReview.longest_article.title || "(无标题)"}
                </div>
                <div className="mt-0.5 text-xs text-[var(--ui-text-subtle)]">
                  {formatDateLabel(weekReview.longest_article.date)} · {weekReview.longest_article.word_count} 字
                </div>
              </button>
            )}
            {missingDays.length ? (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--ui-text-subtle)]">空缺日操作</span>
                  {missingDays.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setExpandedMissingDays((value) => !value)}
                      className="ui-button-ghost min-h-11 px-1 text-xs text-[var(--ui-accent-text)] sm:h-7 sm:min-h-7"
                    >
                      {expandedMissingDays ? "收起" : `显示全部 ${missingDays.length} 天`}
                    </button>
                  )}
                </div>
                <div className={["flex flex-wrap gap-1.5", expandedMissingDays ? "max-h-24 overflow-y-auto pr-1" : ""].join(" ")}>
                  {visibleMissingDays.map((date) => (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setActiveMissingDay((current) => (current === date ? null : date))}
                      className={[
                        "ui-filter-button min-h-11 rounded-full px-2.5 py-1 font-mono text-xs sm:min-h-8",
                        activeMissingDay === date ? "ui-filter-button-active" : "",
                      ].join(" ")}
                    >
                      {formatMonthDay(date)}
                    </button>
                  ))}
                </div>
                {activeMissingDay && (
                  <div className="ui-panel-muted mt-2 flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-mono text-xs text-[var(--ui-text-muted)]">{formatDateLabel(activeMissingDay)}</span>
                    <div className="grid grid-cols-2 gap-2 sm:flex">
                      <button
                        type="button"
                        onClick={() => {
                          const date = activeMissingDay;
                          setActiveMissingDay(null);
                          onEditDate(date);
                        }}
                        className="ui-button-secondary h-8 px-3 text-xs text-[var(--ui-accent-text)]"
                      >
                        补写
                      </button>
                      <button
                        type="button"
                        onClick={() => openMissingExemption(activeMissingDay)}
                        className="ui-button-secondary h-8 px-3 text-xs text-[var(--ui-warning-text)]"
                      >
                        豁免
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            <div className="mt-4">
              <div className="ui-section-kicker mb-2">高频词</div>
              {weekReview?.top_terms.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {weekReview.top_terms.map((item) => (
                    <button
                      type="button"
                      key={item.term}
                      onClick={() => onSearchTerm(item.term)}
                      className="ui-status-accent rounded-full px-2 py-1 text-xs"
                    >
                      {item.term} × {item.count}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--ui-text-subtle)]">本周内容还不足以提取关键词</p>
              )}
            </div>
            <div className="ui-panel-muted mt-4 px-3 py-2 text-xs text-[var(--ui-text-muted)]">
              周复盘将作为独立 AI 派生记录生成，不写入当天日复盘。
            </div>
            <ReviewPanel
              className="mt-4"
              title="AI 周复盘"
              description="基于所选周的每日记录生成。草稿确认后，会作为月复盘的主要输入。"
              kind="weekly"
              periodLabel={formatDateRange(selectedWeekBounds.first, selectedWeekBounds.last)}
              reviews={weeklyReviews}
              selectedReview={selectedWeeklyReview}
              generating={generatingKind === "weekly"}
              generationDisabled={generatingKind !== null}
              generationStep={generationStep}
              estimateLabel={`${weekReview.total_words} 字材料 · 服务端模型`}
              onGenerate={() => generateAiReview("weekly")}
              onOpenLibrary={() => onNavigate("reviews")}
            />
            <ReviewPanel
              className="mt-4"
              title="AI 月复盘"
              description="优先读取本月已确认周复盘，并补充未被周复盘覆盖的每日记录摘要。"
              kind="monthly"
              periodLabel={formatMonthLabel(year, month)}
              reviews={monthlyReviews}
              selectedReview={selectedMonthlyReview}
              generating={generatingKind === "monthly"}
              generationDisabled={generatingKind !== null}
              generationStep={generationStep}
              estimateLabel={`${overview?.total_words || 0} 字记录规模 · 服务端模型`}
              onGenerate={() => generateAiReview("monthly")}
              onOpenLibrary={() => onNavigate("reviews")}
            />
              </>
            ) : (
              <div className="ui-panel-muted flex min-h-24 items-center justify-center gap-2 rounded-xl px-3 py-4 text-center text-xs text-[var(--ui-text-subtle)]" role="status">
                {loading ? <LoaderCircle size={15} className="animate-spin" /> : null}
                {loading ? "正在加载本周统计…" : "本周统计暂时不可用，请稍后重试。"}
              </div>
            )}
          </section>
        </div>

      {reviewStats && (
        <details className="ui-panel group mb-4 p-4 md:mb-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40 [&::-webkit-details-marker]:hidden">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-text)]">
                <Brain size={16} className="text-[var(--ui-accent-text)]" /> 复习
              </h3>
              <p className="mt-0.5 text-xs text-[var(--ui-text-subtle)]">
                学习中 {reviewStats.learning} 张 · 已掌握 {reviewStats.mature} 张 · 累计确认 {reviewStats.total_confirmed} 张
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {reviewStats.due > 0 && <span className="ui-status-warning rounded-full px-2.5 py-1 text-[11px] font-medium">待复习 {reviewStats.due} 张</span>}
              <ChevronRight size={16} className="text-[var(--ui-text-subtle)] transition-transform group-open:rotate-90" aria-hidden="true" />
            </div>
          </summary>
          <div className="mt-4">
            {reviewStats.due > 0 && (
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => onNavigate("review")}
                  className="ui-button-primary min-h-11 px-3 text-xs sm:min-h-8"
                >
                  去复习 {reviewStats.due} 张 →
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <CompactMetric icon={Repeat} label="累计复习" value={String(reviewStats.total_reviews)} unit="次" tone="accent" />
              <CompactMetric icon={Flame} label="连续复习" value={String(reviewStats.streak_days)} unit="天" tone="amber" />
              <CompactMetric icon={CheckCircle2} label="今日已复习" value={String(reviewStats.reviewed_today)} unit="张" tone="green" />
              <CompactMetric icon={CalendarClock} label="待复习" value={reviewStats.due > 0 ? String(reviewStats.due) : "无"} unit={reviewStats.due > 0 ? "张" : ""} tone={reviewStats.due > 0 ? "rose" : "gray"} />
            </div>
            <div className="mt-4">
              <div className="ui-section-kicker mb-1.5">近 30 天复习趋势</div>
              {reviewStats.daily.some((d) => d.count > 0) ? (
                <>
                  <div className="h-28" role="img" aria-label="近 30 天复习趋势图">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reviewStats.daily} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="accentGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--ui-accent-solid)" />
                            <stop offset="100%" stopColor="var(--ui-accent-text)" />
                          </linearGradient>
                        </defs>
                        <Tooltip
                          cursor={{ fill: "var(--ui-surface-selected)" }}
                          content={<ChartTooltip />}
                          formatter={(value) => [`${value} 次`, "复习"]}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="url(#accentGradient)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-[var(--ui-text-subtle)]">
                    <span>{formatMonthDay(reviewStats.daily[0]?.date || "")}</span>
                    <span>{formatMonthDay(reviewStats.daily[reviewStats.daily.length - 1]?.date || "")}</span>
                  </div>
                </>
              ) : (
                <p className="ui-panel-muted rounded-lg px-3 py-4 text-center text-xs text-[var(--ui-text-subtle)]">
                  还没有复习记录——确认卡片后到「复习」页开始第一次间隔复习
                </p>
              )}
              {reviewStats.daily.some((d) => d.count > 0) && (
                <p className="mt-1.5 text-[11px] text-[var(--ui-text-subtle)]">每天复习的卡片数，坚持连续复习比单次量大更重要</p>
              )}
            </div>
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="ui-section-kicker">未来 7 天到期</span>
                <span className="text-[11px] text-[var(--ui-text-subtle)]">
                  {reviewStats.upcoming.reduce((sum, day) => sum + day.count, 0)} 张
                </span>
              </div>
              <div className="flex items-end gap-1.5">
                {reviewStats.upcoming.map((day) => (
                  <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={`${formatDateLabel(day.date)} · ${day.count} 张`}>
                    <span className={`font-mono text-[11px] leading-none ${day.count > 0 ? "text-[var(--ui-accent-text)]" : "text-[var(--ui-text-disabled)]"}`}>
                      {day.count || ""}
                    </span>
                    <div className={`h-2 w-full rounded-full ${day.count > 0 ? "bg-[var(--ui-accent-text)]/50" : "bg-[var(--ui-surface-inset)]"}`} />
                  </div>
                ))}
              </div>
            </div>
            {heatmapError ? (
              <p className="ui-panel-muted mt-4 rounded-lg px-3 py-3 text-xs text-[var(--ui-text-subtle)]" role="status">
                一年复习热力图暂时不可用。
              </p>
            ) : heatmap.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="ui-section-kicker">一年复习热力图</span>
                  <span className="flex items-center gap-1 text-[11px] text-[var(--ui-text-subtle)]">
                    少
                    {[0, 1, 2, 4, 7].map((level) => (
                      <span
                        key={level}
                        className={`inline-block h-2.5 w-2.5 rounded-[3px] ${level === 0 ? "bg-[var(--ui-surface-inset)]" : level <= 1 ? "ui-accent-fill-20" : level <= 2 ? "ui-accent-fill-40" : level <= 4 ? "ui-accent-fill-70" : "ui-accent-fill"}`}
                      />
                    ))}
                    多
                  </span>
                </div>
                <div className="overflow-x-auto pb-1">
                  <div className="grid min-w-[560px] grid-flow-col grid-rows-7 gap-[3px]">
                    {heatmap.map((day) => (
                      <span
                        key={day.date}
                        title={`${formatDateLabel(day.date)} · 复习 ${day.count} 次`}
                        role="img"
                        aria-label={`${formatDateLabel(day.date)}，复习 ${day.count} 次`}
                        className={[
                          "h-[11px] w-[11px] rounded-[3px]",
                          day.count === 0
                            ? "bg-[var(--ui-surface-inset)]"
                            : day.count === 1
                              ? "ui-accent-fill-20"
                              : day.count <= 2
                                ? "ui-accent-fill-40"
                                : day.count <= 4
                                  ? "ui-accent-fill-70"
                                  : "ui-accent-fill",
                        ].join(" ")}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      {(knowledgeSummary || knowledgeSummaryQuery.isPending || knowledgeSummaryQuery.isError) && (
        <details className="ui-panel group mb-4 p-4 md:mb-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40 [&::-webkit-details-marker]:hidden">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-text)]">
                <BookMarked size={16} className="text-[var(--ui-accent-text)]" /> 知识健康
              </h3>
              <p className="mt-0.5 text-xs text-[var(--ui-text-subtle)]">
                {knowledgeSummary ? `${knowledgeSummary.total} 张活跃卡片 · ${knowledgeQualityIssueCount} 个待完善项` : knowledgeSummaryQuery.isError ? "知识健康暂时不可用" : "正在检查卡片完整度…"}
              </p>
            </div>
            <ChevronRight size={16} className="shrink-0 text-[var(--ui-text-subtle)] transition-transform group-open:rotate-90" aria-hidden="true" />
          </summary>
          <div className="mt-4">
            <div className="mb-3 flex justify-end">
              <button type="button" onClick={() => onNavigate("knowledge")} className="ui-button-secondary min-h-11 px-2.5 text-xs sm:min-h-8">
                打开知识库 <ChevronRight size={13} />
              </button>
            </div>
            {knowledgeSummaryQuery.isError ? (
              <div className="ui-alert-warn flex flex-col gap-3 rounded-xl px-3 py-3 text-xs sm:flex-row sm:items-center sm:justify-between" role="status">
                <span>暂时无法检查知识卡片完整度。</span>
                <button type="button" onClick={() => knowledgeSummaryQuery.refetch()} className="ui-button-secondary min-h-10 px-3 text-xs">
                  重试
                </button>
              </div>
            ) : knowledgeSummaryQuery.isPending && !knowledgeSummary ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="status" aria-label="正在加载知识健康">
                {["w-3/5", "w-2/3", "w-1/2", "w-4/5"].map((width) => (
                  <div key={width} className="ui-panel-muted rounded-xl p-3">
                    <div className={`ui-skeleton h-3 ${width}`} />
                    <div className="ui-skeleton mt-3 h-5 w-1/3" />
                  </div>
                ))}
              </div>
            ) : knowledgeSummary?.total === 0 ? (
              <div className="ui-panel-muted rounded-xl border-dashed px-3 py-4 text-center text-xs text-[var(--ui-text-subtle)]">
                还没有知识卡片；从今日记录或复盘中提取第一张卡片吧。
              </div>
            ) : knowledgeSummary && knowledgeQualityIssueCount > 0 ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {knowledgeQualityOptions.map(({ key, label, hint, icon: Icon, tone }) => {
                    const count = knowledgeSummary[key];
                    const toneClass = {
                      accent: "ui-status-accent",
                      green: "ui-status-success",
                      amber: "ui-status-warning",
                      gray: "ui-status-muted",
                      rose: "ui-status-danger",
                      sky: "ui-status-info",
                    }[tone];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onOpenKnowledgeQuality(key)}
                        className="ui-panel card-interactive group flex min-w-0 items-center gap-3 p-3 text-left"
                      >
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneClass}`}><Icon size={16} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--ui-text)]">
                            <span className="truncate">{label}</span>
                            <span className="font-mono text-sm text-[var(--ui-text)]">{count}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--ui-text-subtle)]">{hint}</span>
                        </span>
                        <ChevronRight size={14} className="shrink-0 text-[var(--ui-text-disabled)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ui-accent-text)]" />
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11px] leading-4 text-[var(--ui-text-subtle)]">同一张卡片可能同时命中多个问题；点击后会打开全部状态的对应修复视图。</p>
              </>
            ) : (
              <div className="ui-status-success flex items-center gap-2 rounded-xl px-3 py-3 text-xs">
                <ShieldCheck size={16} /> 当前卡片字段完整度良好，可以继续专注于复习。
              </div>
            )}
          </div>
        </details>
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
              <div className="ui-sheet-grabber mx-auto mb-3 h-1 w-10 rounded-full" aria-hidden="true" />
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <Dialog.Title className="text-base font-semibold text-[var(--ui-text)]">日期操作</Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
                    {formatDateLabel(dayActionTarget.date)} · 选择要执行的操作
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button type="button" className="ui-icon-button h-9 w-9" aria-label="关闭日期操作">
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
                  <PencilLine size={17} className="text-[var(--ui-accent-text)]" />
                  <span className="flex flex-col items-start">
                    <span className="font-semibold">编辑记录</span>
                    <span className="mt-0.5 text-xs font-normal text-[var(--ui-text-subtle)]">
                      {dayActionTarget.has_article ? "打开这一天的总结" : "补写这一天的总结"}
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
                    <ShieldCheck size={17} className="text-[var(--ui-warning-text)]" />
                    <span className="flex flex-col items-start">
                      <span className="font-semibold">{dayActionTarget.exemption ? "编辑日期状态" : "设置日期状态"}</span>
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
                <Dialog.Title className="text-sm font-semibold text-[var(--ui-text)]">日期状态</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-[var(--ui-text-muted)]">
                  {formatDateLabel(exemptionTarget.date)} · 选择一个状态；这一天不算记录，但不会打断连续覆盖。
                </Dialog.Description>
              </div>
              <label htmlFor="exemption-note" className="mb-1.5 block text-xs font-medium text-[var(--ui-text-muted)]">
                状态备注 <span className="font-normal text-[var(--ui-text-subtle)]">（可选）</span>
              </label>
              <textarea
                id="exemption-note"
                value={exemptionNote}
                onChange={(e) => setExemptionNote(e.target.value)}
                rows={2}
                placeholder="补充原因或安排"
                className="ui-textarea mb-3"
              />
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="日期状态选项">
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
              {exemptionError && <p role="alert" className="ui-alert-bad mt-3 text-xs">{exemptionError}</p>}
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <button type="button" disabled={savingExemption} className="ui-button-secondary h-10 px-4 text-sm">
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
    </motion.div>
  );
}

function StatsLoadingState({ monthLabel }: { monthLabel: string }) {
  return (
    <div className="ui-panel-muted flex min-h-[240px] flex-col items-center justify-center rounded-2xl px-6 py-10 text-center" role="status" aria-live="polite">
      <span className="ui-status-accent inline-flex h-11 w-11 items-center justify-center rounded-2xl">
        <LoaderCircle size={21} className="animate-spin" />
      </span>
      <h2 className="mt-4 text-sm font-semibold text-[var(--ui-text)]">正在加载统计</h2>
      <p className="mt-1.5 max-w-sm text-xs leading-5 text-[var(--ui-text-subtle)]">
        正在同步 {monthLabel} 的记录、月历和本周复盘。
      </p>
      <div className="mt-5 grid w-full max-w-md grid-cols-3 gap-2" aria-hidden="true">
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
    <div className="ui-alert-bad flex flex-col gap-4 rounded-2xl p-4 sm:p-5" role="alert" aria-live="assertive">
      <div className="flex items-start gap-3">
        <span className="ui-status-danger flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" aria-hidden="true">
          <CircleHelp size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--ui-text)]">统计暂时无法加载</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">{message || "请检查连接设置后重试。"}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onRetry} className="ui-button-primary min-h-11 px-4 text-sm sm:min-h-10">
          重试
        </button>
        <button type="button" onClick={onOpenSettings} className="ui-button-secondary min-h-11 px-4 text-sm sm:min-h-10">
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
  const ExemptionIcon = getExemptionIcon(day.exemption?.reason);
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
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg" aria-hidden="true">
        <span className={[
          "ui-calendar-date absolute left-1.5 top-1.5 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-semibold sm:left-2 sm:top-2",
          day.has_article ? "ui-calendar-date-article" : ""
        ].join(" ")}>
          {dateNum}
        </span>

        {day.has_article && (
          <span className="ui-calendar-doc absolute right-1.5 top-1.5 z-10 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md sm:right-2 sm:top-2">
            <FileText size={11} />
          </span>
        )}

        {day.has_article ? (
          <div className="absolute inset-x-1.5 bottom-1.5 sm:inset-x-2 sm:bottom-2">
            <div className="ui-calendar-meter-track mb-1 h-0.5 overflow-hidden rounded-full sm:h-1.5">
              <div className="ui-calendar-meter-fill h-full rounded-full" style={{ width: `${words}%` }} />
            </div>
            <div className="hidden items-center justify-between gap-1 text-[10px] leading-none text-[var(--ui-text-muted)] sm:flex">
              <span className="truncate">{day.word_count} 字</span>
              {day.mood && <span className="shrink-0">{day.mood}</span>}
            </div>
          </div>
        ) : day.exemption ? (
          <div className="absolute inset-x-1.5 top-1/2 flex -translate-y-1/2 justify-center sm:inset-x-2">
            <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-1 py-0.5 text-[10px] font-medium sm:px-1.5 ${exemptionTone.pill}`}>
              <ExemptionIcon size={12} />
              <span className="hidden sm:inline">{day.exemption.reason}</span>
            </span>
          </div>
        ) : (
          <div className="ui-calendar-empty-icon pointer-events-none absolute inset-0 flex items-center justify-center">
            <PencilLine size={12} />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onEditDate(day.date)}
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
            "ui-calendar-action absolute right-1 top-1 z-20 hidden h-7 w-7 items-center justify-center rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-[var(--ui-focus)]/50 sm:inline-flex sm:right-1.5 sm:top-1.5 sm:h-6 sm:w-6 sm:opacity-60 sm:hover:opacity-100",
            day.exemption ? exemptionTone.pill : "ui-calendar-action-default text-[var(--ui-text-subtle)]",
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

function getExemptionToneName(reason?: string): StatTone {
  if (reason === "休息" || reason === "放假") return "green";
  if (reason === "生病") return "rose";
  if (reason === "出差") return "sky";
  if (reason) return "amber";
  return "gray";
}

function getExemptionIcon(reason?: string): LucideIcon {
  if (reason === "休息" || reason === "放假") return Coffee;
  if (reason === "生病") return HeartPulse;
  if (reason === "出差") return Plane;
  if (reason === "请假") return Umbrella;
  return CircleHelp;
}

function moodColorClass(index: number) {
  return [
    "bg-[var(--ui-accent-solid)]",
    "bg-[var(--ui-success-action)]",
    "bg-[var(--ui-warning-action)]",
    "bg-[var(--ui-info-action)]",
    "bg-[var(--ui-danger-action)]",
    "bg-[var(--ui-accent-solid)]",
  ][index % 6];
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
  const previewContent = selectedReview ? reviewPreview(selectedReview.kind, selectedReview.title, selectedReview.content, 360) : "";

  return (
    <section className={`ui-panel p-3 transition-colors sm:p-4 ${className}`}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-bold text-[var(--ui-text)]">
            {kind === "weekly" ? <BarChart3 size={16} /> : <LineChart size={16} />} {title}
          </h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ui-text-muted)]">{description}</p>
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
            <div className="mt-0.5 truncate text-xs font-semibold text-[var(--ui-text)]">{periodLabel}</div>
          </div>
        </div>
      </div>

      {/* Review preview */}
      {selectedReview ? (
        <div className="ui-panel-muted mb-3 rounded-lg p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="truncate text-xs font-medium text-[var(--ui-text-muted)]">{selectedReview.title}</span>
            <ReviewStatusPill status={selectedReview.status} />
          </div>
          <p className="line-clamp-4 text-xs leading-5 text-[var(--ui-text-muted)]">{previewContent}</p>
        </div>
      ) : reviews.length > 0 ? (
        <p className="mb-4 text-xs text-[var(--ui-text-subtle)]">进入复盘库查看历史版本</p>
      ) : (
        <p className="mb-4 text-xs text-[var(--ui-text-subtle)]">还没有 AI 复盘版本</p>
      )}

      {(estimateLabel || generating) && (
        <div className={`mb-3 min-h-[52px] rounded-lg border px-3 py-2 text-xs leading-5 ${generating ? "ui-status-accent" : "ui-panel-muted text-[var(--ui-text-muted)]"}`}>
          {generating ? (
            <>
              <div className="mb-1.5 flex items-center gap-2 font-medium">
                <LoaderCircle size={13} className="animate-spin text-[var(--ui-accent-text)]" />
                {generationStep === "idle" ? "准备生成" : STEP_LABELS[generationStep]}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ui-surface-inset)]">
                <div className="h-full rounded-full bg-[var(--ui-accent-solid)] transition-all duration-300" style={{ width: generationStep === "saving" ? "100%" : generationStep === "requesting" ? "66%" : "33%" }} />
              </div>
            </>
          ) : estimateLabel}
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
          {generating ? "生成中..." : kind === "weekly" ? "AI 周复盘" : "AI 月复盘"}
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

function splitLeadingNumber(value: string): { number: number; suffix: string } | null {
  const match = /^(\d[\d,]*)(.*)$/.exec(value);
  if (!match) return null;
  return { number: Number(match[1].replace(/,/g, "")), suffix: match[2] };
}

function StatCard({
  icon: Icon,
  label,
  value,
  meta,
  tone,
  animate,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  meta?: string;
  tone: StatTone;
  animate?: boolean;
}) {
  const numeric = animate ? splitLeadingNumber(value) : null;
  const animated = useCountUp(numeric?.number ?? null);
  const displayValue = numeric ? `${animated.toLocaleString()}${numeric.suffix}` : value;
  const toneClass = {
    accent: {
      icon: "ui-status-accent",
    },
    green: {
      icon: "ui-status-success",
    },
    amber: {
      icon: "ui-status-warning",
    },
    rose: {
      icon: "ui-status-danger",
    },
    sky: {
      icon: "ui-status-info",
    },
    gray: {
      icon: "ui-status-muted",
    },
  }[tone];

  return (
    <div className="ui-panel p-3 md:p-4">
      <div className="flex min-h-[84px] flex-col justify-between gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--ui-text-subtle)]">{label}</p>
            {meta && <p className="mt-1 truncate text-[11px] text-[var(--ui-text-subtle)]">{meta}</p>}
          </div>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneClass.icon}`}>
            <Icon size={17} />
          </span>
        </div>
        <p className="text-2xl font-bold leading-none text-[var(--ui-text)] md:text-[26px]">
          {value === "..." ? <span className="ui-skeleton inline-block h-7 w-20 align-middle" /> : displayValue}
        </p>
      </div>
    </div>
  );
}

function CompactMetric({
  icon: Icon,
  label,
  value,
  unit,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit: string;
  tone: StatTone;
}) {
  const toneClass = {
    accent: "ui-status-accent",
    green: "ui-status-success",
    amber: "ui-status-warning",
    rose: "ui-status-danger",
    sky: "ui-status-info",
    gray: "ui-status-muted",
  }[tone];

  return (
    <div className={`rounded-xl px-3 py-2.5 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] opacity-70">{label}</div>
        <Icon size={13} className="opacity-70" />
      </div>
      <div className="mt-1.5 text-lg font-bold leading-none">
        {value}
        <span className="ml-0.5 text-[11px] font-medium opacity-70">{unit}</span>
      </div>
    </div>
  );
}

function MoodMetric({
  mood,
  count,
  ratio,
  colorClass,
  compact,
  dense,
}: {
  mood: string;
  count: number;
  ratio: number;
  colorClass: string;
  compact: boolean;
  dense: boolean;
}) {
  if (dense) {
    return (
      <div className="ui-panel-muted flex h-full min-h-0 items-center justify-between gap-1 rounded-lg px-2">
        <span className="truncate text-sm leading-none">{mood}</span>
        <span className="shrink-0 text-[11px] font-medium text-[var(--ui-text-subtle)]">{count} 天</span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="ui-panel-muted flex h-full min-h-0 items-center justify-between gap-1 rounded-lg px-2">
        <span className="truncate text-sm leading-none">{mood}</span>
        <span className="shrink-0 text-[11px] font-medium text-[var(--ui-text-subtle)]">{count} 天</span>
      </div>
    );
  }

  return (
    <div className="ui-panel-muted h-full min-h-0 rounded-lg px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-sm leading-none">{mood}</span>
        <span className="shrink-0 text-[11px] font-medium text-[var(--ui-text-subtle)]">{count} 天</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ui-surface-inset)]">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

function MonthHighlightCard({
  icon: Icon,
  label,
  value,
  meta,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="ui-panel-muted px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-[var(--ui-text-subtle)]">{label}</div>
        <span className="ui-status-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-lg">
          <Icon size={13} />
        </span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--ui-text)]">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-[var(--ui-text-subtle)]">{meta}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--ui-text-subtle)]">{label}</span>
      <span className="font-medium text-[var(--ui-text)]">{value}</span>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="ui-chip h-6 shrink-0 px-2 text-[11px]">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full shadow-xs ${className}`} />
      {label}
    </span>
  );
}
