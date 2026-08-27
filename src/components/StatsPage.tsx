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
import { normalizeReviewContent } from "../lib/reviewContent";
import { generateReviewVersion, upsertReviewVersion } from "../lib/reviewGeneration";
import type { ReviewGenerationStep } from "../lib/reviewGeneration";
import { loadStatsSnapshot } from "../lib/statsSnapshot";
import { useCountUp } from "../lib/useCountUp";
import { ReviewStatusPill } from "./reviews/ReviewShared";
import PageHeader from "./ui/PageHeader";
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
        <div className="mb-1 font-medium text-[var(--ui-text-muted)]">{label}</div>
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
  if (reviews.length === 0) return null;
  const byVersion = [...reviews].sort((a, b) => b.version - a.version);
  return byVersion.find((review) => review.status === "confirmed") || byVersion[0];
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
  const [year, setYear] = useState(initialMonthParts?.year ?? now.getFullYear());
  const [month, setMonth] = useState(initialMonthParts?.month ?? now.getMonth() + 1);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [days, setDays] = useState<MonthDayStats[]>([]);
  const [reviewStats, setReviewStats] = useState<api.ReviewStatsResponse | null>(null);
  const [heatmap, setHeatmap] = useState<api.DailyReviewCount[]>([]);
  const [weekReview, setWeekReview] = useState<WeekReview | null>(null);
  const [weeklyReviews, setWeeklyReviews] = useState<Review[]>([]);
  const [monthlyReviews, setMonthlyReviews] = useState<Review[]>([]);
  const [reviewWeekDate, setReviewWeekDate] = useState(() => todayDate());
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
  const loadRevision = useRef(0);
  const generationInFlight = useRef(false);
  const knowledgeSummaryQuery = useQuery({
    queryKey: api.knowledgeQueryKeys.summary,
    queryFn: ({ signal }) => api.getKnowledgeSummary({ signal }),
    staleTime: 30_000,
  });

  const bounds = useMemo(() => monthBounds(year, month), [year, month]);
  const selectedWeekBounds = useMemo(() => weekBounds(reviewWeekDate), [reviewWeekDate]);
  const generationAnchors = useRef({ weekly: reviewWeekDate, monthly: bounds.first });
  generationAnchors.current = { weekly: reviewWeekDate, monthly: bounds.first };
  const maxMoodCount = Math.max(1, ...Object.values(overview?.mood_counts || {}));
  const writtenDays = overview?.days_written || 0;
  const exemptedDays = overview?.exempted_days || 0;
  const coveredDays = writtenDays + exemptedDays;
  const completion = bounds.daysInMonth > 0 ? Math.round((coveredDays / bounds.daysInMonth) * 100) : 0;
  const animatedCompletion = useCountUp(loading ? null : completion);
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
        let color = "#d1d5db";
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
              ? "#34d399"
              : reason === "生病"
                ? "#fb7185"
                : reason === "出差"
                  ? "#38bdf8"
                  : "#fbbf24";
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
  const missingDays = weekReview?.missing_days || [];
  const visibleMissingDays = expandedMissingDays ? missingDays : missingDays.slice(0, 5);
  const monthHighlights = [
    { icon: Trophy, label: "最长记录", value: longestDay ? `${longestDay.word_count} 字` : "暂无", meta: longestDay?.date || "写下第一篇后出现" },
    { icon: Clock, label: "最近记录", value: latestDay ? latestDay.date.slice(5) : "暂无", meta: latestDay?.title || "本月还没有记录" },
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
    if (showLoading) setLoading(true);
    setError("");
    setReviewError("");
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
    const next = parseMonthParam(initialMonth);
    if (!next || (next.year === year && next.month === month)) return;
    setYear(next.year);
    setMonth(next.month);
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
    onMonthChange?.(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const goCurrentMonth = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
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

  // 复习统计 + 热力图（静默失败，不影响页面主体）
  useEffect(() => {
    api.getReviewStats()
      .then((stats) => { if (mountedRef.current) setReviewStats(stats); })
      .catch(() => { if (mountedRef.current) setReviewStats(null); });
    api.getReviewHeatmap(365)
      .then((data) => { if (mountedRef.current) setHeatmap(data); })
      .catch(() => { if (mountedRef.current) setHeatmap([]); });
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
      setReviewError(api.getErrorMessage(e));
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
      className="page-surface page-surface-stats min-h-full overflow-y-auto px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6"
    >
      <PageHeader
        icon={BarChart3}
        title="统计"
        description={`${year} 年 ${month} 月 · ${loading ? "加载中" : `${writtenDays} 天记录，${exemptedDays} 天豁免`}`}
        navigation={
          <div className="ui-toolbar flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="ui-icon-button h-8 w-8"
              title="上个月"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={goCurrentMonth}
              className="ui-button-ghost h-8 min-h-8 px-3 text-xs font-semibold text-[var(--ui-accent-text)]"
            >
              本月
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="ui-icon-button h-8 w-8"
              title="下个月"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="ui-alert-bad mb-4">
          {error}
        </div>
      )}
      {reviewError && (
        <div className="ui-alert-bad mb-4">
          {reviewError}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 mb-4 md:mb-6">
        <StatCard icon={CalendarDays} label="记录天数" value={loading ? "..." : `${writtenDays} 天`} tone="accent" animate />
        <StatCard
          icon={TrendingUp}
          label="连续覆盖"
          value={loading ? "..." : `${overview?.current_streak || 0} 天`}
          meta={overview?.streak_exempted_days ? `含 ${overview.streak_exempted_days} 天豁免` : "不含豁免"}
          tone="sky"
          animate
        />
        <StatCard icon={FileText} label="总字数" value={loading ? "..." : `${overview?.total_words || 0}`} tone="amber" animate />
        <StatCard
          icon={ShieldCheck}
          label="豁免天数"
          value={loading ? "..." : `${exemptedDays} 天`}
          meta={dominantExemptionReason ? `主要：${dominantExemptionReason}` : undefined}
          tone={exemptionMetricTone}
          animate
        />
      </div>

      {reviewStats && (
        <section className="ui-panel mb-4 p-4 md:mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-text)]">
                <Brain size={16} className="text-[var(--ui-accent-text)]" /> 复习
              </h3>
              <p className="mt-0.5 text-xs text-[var(--ui-text-subtle)]">
                学习中 {reviewStats.learning} 张 · 已掌握 {reviewStats.mature} 张 · 累计确认 {reviewStats.total_confirmed} 张
              </p>
            </div>
            {reviewStats.due > 0 && (
              <button
                type="button"
                onClick={() => onNavigate("review")}
                className="ui-button-primary h-8 px-3 text-xs"
              >
                去复习 {reviewStats.due} 张 →
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <CompactMetric icon={Repeat} label="累计复习" value={String(reviewStats.total_reviews)} unit="次" tone="accent" />
            <CompactMetric icon={Flame} label="连续复习" value={String(reviewStats.streak_days)} unit="天" tone="amber" />
            <CompactMetric icon={CheckCircle2} label="今日已复习" value={String(reviewStats.reviewed_today)} unit="张" tone="green" />
            <CompactMetric icon={CalendarClock} label="待复习" value={reviewStats.due > 0 ? String(reviewStats.due) : "无"} unit={reviewStats.due > 0 ? "张" : ""} tone={reviewStats.due > 0 ? "rose" : "gray"} />
          </div>
          <div className="mt-4">
            <div className="ui-section-kicker mb-1.5">
              近 30 天复习趋势
            </div>
            {reviewStats.daily.some((d) => d.count > 0) ? (
              <div className="h-24">
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
            ) : (
              <p className="ui-panel-muted rounded-lg px-3 py-4 text-center text-xs text-[var(--ui-text-subtle)]">
                还没有复习记录——确认卡片后到「复习」页开始第一次间隔复习
              </p>
            )}
            {reviewStats.daily.some((d) => d.count > 0) && (
              <p className="mt-1.5 text-[11px] text-[var(--ui-text-subtle)]">
                每天复习的卡片数，坚持连续复习比单次量大更重要
              </p>
            )}
          </div>
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="ui-section-kicker">
                未来 7 天到期
              </span>
              <span className="text-[11px] text-[var(--ui-text-subtle)]">
                {reviewStats.upcoming.reduce((sum, day) => sum + day.count, 0)} 张
              </span>
            </div>
            <div className="flex items-end gap-1.5">
              {reviewStats.upcoming.map((day) => (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={`${day.date} · ${day.count} 张`}>
                  <span className={`font-mono text-[11px] leading-none ${day.count > 0 ? "text-[var(--ui-accent-text)]" : "text-[var(--ui-text-disabled)]"}`}>
                    {day.count || ""}
                  </span>
                  <div className={`h-2 w-full rounded-full ${day.count > 0 ? "bg-[var(--ui-accent-text)]/50" : "bg-[var(--ui-surface-inset)]"}`} />
                </div>
              ))}
            </div>
          </div>
          {heatmap.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="ui-section-kicker">
                  一年复习热力图
                </span>
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
                      title={`${day.date} · 复习 ${day.count} 次`}
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
        </section>
      )}

      {(knowledgeSummary || knowledgeSummaryQuery.isPending) && (
        <section className="ui-panel mb-4 p-4 md:mb-6">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-text)]">
                <BookMarked size={16} className="text-[var(--ui-accent-text)]" /> 知识健康
              </h3>
              <p className="mt-0.5 text-xs text-[var(--ui-text-subtle)]">
                {knowledgeSummary ? `${knowledgeSummary.total} 张活跃卡片 · ${knowledgeQualityIssueCount} 个待完善项` : "正在检查卡片完整度..."}
              </p>
            </div>
            <button type="button" onClick={() => onNavigate("knowledge")} className="ui-button-secondary h-8 px-2.5 text-xs">
              打开知识库 <ChevronRight size={13} />
            </button>
          </div>

          {knowledgeSummaryQuery.isPending && !knowledgeSummary ? (
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
        </section>
      )}

      <div className="space-y-4 md:space-y-6">
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
        <section className="min-w-0 h-[min(78dvh,644px)] min-h-[520px] sm:h-[684px] xl:h-[760px]">
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

          <section className="ui-panel h-[644px] min-w-0 overflow-y-auto p-3 sm:h-[684px] sm:p-4 xl:h-[760px]">
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
              <div className="h-20">
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
                <span>{bounds.first.slice(5)}</span>
                <span>最长 {longestDay ? `${longestDay.word_count} 字` : "暂无"}</span>
                <span>{bounds.last.slice(5)}</span>
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
              className={[
                "ui-button-primary h-10 w-full text-sm",
                moodEntries.length == 0 ? "mt-16" :
                moodEntries.length > 0 && moodEntries.length <= 6 ? "mt-11" : 
                "mt-4",
              ].join(" ")}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <PencilLine size={15} /> 编辑今天
              </span>
            </button>
          </section>
        </div>

          <section className="ui-panel h-full p-4">
            <h3 className="mb-1 text-sm font-semibold text-[var(--ui-text)]">本周复盘</h3>
            <p className="mb-3 text-xs text-[var(--ui-text-subtle)]">
              {weekReview ? `${weekReview.from} 至 ${weekReview.to}` : "加载中"}
            </p>
            <div className="space-y-3 text-sm">
              <InfoRow label="记录 / 豁免" value={`${weekReview?.days_written || 0} / ${weekReview?.exempted_days || 0} 天`} />
              <InfoRow
                label="空缺天"
                value={weekReview?.missing_days.length ? `${weekReview.missing_days.length} 天` : "无"}
              />
              <InfoRow label="总字数" value={`${weekReview?.total_words || 0}`} />
              <InfoRow label="平均字数" value={`${Math.round(weekReview?.avg_words || 0)}`} />
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
                  {weekReview.longest_article.date} · {weekReview.longest_article.word_count} 字
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
                      className="ui-button-ghost h-7 min-h-7 px-1 text-xs text-[var(--ui-accent-text)]"
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
                        "ui-filter-button min-h-8 rounded-full px-2.5 py-1 font-mono text-xs",
                        activeMissingDay === date ? "ui-filter-button-active" : "",
                      ].join(" ")}
                    >
                      {date.slice(5)}
                    </button>
                  ))}
                </div>
                {activeMissingDay && (
                  <div className="ui-panel-muted mt-2 flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-mono text-xs text-[var(--ui-text-muted)]">{activeMissingDay}</span>
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
              periodLabel={`${selectedWeekBounds.first} 至 ${selectedWeekBounds.last}`}
              anchorDate={reviewWeekDate}
              onAnchorDateChange={setReviewWeekDate}
              reviews={weeklyReviews}
              selectedReview={selectedWeeklyReview}
              generating={generatingKind === "weekly"}
              generationDisabled={generatingKind !== null}
              generationStep={generationStep}
              estimateLabel={`${weekReview?.total_words || 0} 字材料 · 服务端模型`}
              onGenerate={() => generateAiReview("weekly")}
              onOpenLibrary={() => onNavigate("reviews")}
            />
            <ReviewPanel
              className="mt-4"
              title="AI 月复盘"
              description="优先读取本月已确认周复盘，并补充未被周复盘覆盖的每日记录摘要。"
              kind="monthly"
              periodLabel={`${bounds.first.slice(0, 7)} 月`}
              reviews={monthlyReviews}
              selectedReview={selectedMonthlyReview}
              generating={generatingKind === "monthly"}
              generationDisabled={generatingKind !== null}
              generationStep={generationStep}
              estimateLabel={`${overview?.total_words || 0} 字记录规模 · 服务端模型`}
              onGenerate={() => generateAiReview("monthly")}
              onOpenLibrary={() => onNavigate("reviews")}
            />
          </section>
        </div>

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
                    {dayActionTarget.date} · 选择要执行的操作
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
                  {exemptionTarget.date} · 选择一个状态；这一天不算记录，但不会打断连续覆盖。
                </Dialog.Description>
              </div>
              <textarea
                value={exemptionNote}
                onChange={(e) => setExemptionNote(e.target.value)}
                rows={2}
                placeholder="备注，可留空"
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
    e.preventDefault();
    e.stopPropagation();
    if (canManageExemption) onManageExemption(day);
  };
  return (
    <div
      data-calendar-cell="day"
      onContextMenu={openExemption}
      title={day.title || day.exemption?.reason || day.date}
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
        aria-label={`${day.date}，${day.has_article ? "编辑记录" : day.exemption ? `编辑${day.exemption.reason}状态` : "补写记录"}`}
          className="absolute inset-0 z-10 hidden overflow-hidden rounded-lg text-left focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-[var(--ui-focus)]/40 md:block"
      />

      <button
        type="button"
        onClick={() => onOpenDayActions(day)}
        aria-label={`${day.date}，打开日期操作`}
        className="absolute inset-0 z-10 rounded-lg text-left focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-[var(--ui-focus)]/40 md:hidden"
      />

      {canManageExemption && (
        <button
          type="button"
          onClick={openExemption}
          aria-label={`${day.date} ${day.exemption ? "编辑" : "设置"}日期状态`}
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
  anchorDate,
  onAnchorDateChange,
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
  anchorDate?: string;
  onAnchorDateChange?: (date: string) => void;
  reviews: Review[];
  selectedReview: Review | null;
  generating: boolean;
  generationDisabled: boolean;
  generationStep?: ReviewGenerationStep;
  estimateLabel?: string;
  onGenerate: () => void;
  onOpenLibrary: () => void;
}) {
  const previewContent = selectedReview ? normalizeReviewContent(selectedReview.kind, selectedReview.title, selectedReview.content) : "";
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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
        {reviews.length > 0 && (
          <span className="ui-status-muted shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium">
            v{reviews.length}
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
          {kind === "weekly" && anchorDate && onAnchorDateChange && (
            <ReviewDatePicker
              value={anchorDate}
              open={datePickerOpen}
              onOpenChange={setDatePickerOpen}
              onChange={onAnchorDateChange}
            />
          )}
        </div>
      </div>

      {/* Review preview */}
      {selectedReview ? (
        <div className="ui-panel-muted mb-3 rounded-lg p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="truncate text-xs font-medium text-[var(--ui-text-muted)]">{selectedReview.title}</span>
            <ReviewStatusPill status={selectedReview.status} />
          </div>
          <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-[var(--ui-text-muted)]">
            {previewContent}
          </p>
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
          className="ui-button-primary w-full sm:w-auto"
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
          className="ui-button-secondary w-full px-3 sm:w-auto"
          title="打开复盘库"
        >
          <BookOpenText size={15} />
          复盘库
        </button>
      </div>
    </section>
  );
}

function ReviewDatePicker({
  value,
  open,
  onOpenChange,
  onChange,
}: {
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (date: string) => void;
}) {
  const [viewDate, setViewDate] = useState(() => new Date(`${value}T12:00:00`));
  useEffect(() => {
    if (!open) return;
    setViewDate(new Date(`${value}T12:00:00`));
  }, [open, value]);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: first.getDay() }, () => ""),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }),
  ];
  return (
    <div className="relative sm:w-[168px]">
      <div className="mb-1 text-xs text-[var(--ui-text-subtle)]">周内任意一天</div>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="ui-field flex h-9 w-full items-center justify-between rounded-lg px-3 py-0 font-mono text-xs font-semibold"
      >
        {value.replace(/-/g, "/")}
        <CalendarRange size={13} className="text-[var(--ui-text-subtle)]" />
      </button>
      {open && (
        <div className="ui-floating-surface absolute right-0 top-full z-40 mt-2 w-[280px] rounded-xl p-3">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))} className="ui-icon-button h-8 w-8"><ChevronLeft size={16} /></button>
            <div className="text-sm font-semibold text-[var(--ui-text)]">{year} 年 {month + 1} 月</div>
            <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))} className="ui-icon-button h-8 w-8"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-[var(--ui-text-subtle)]">
            {weekdays.map((day) => <div key={day} className="py-1">{day}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((cell, index) => (
              cell ? (
                <button
                  key={cell}
                  type="button"
                  onClick={() => {
                    onChange(cell);
                    onOpenChange(false);
                  }}
                  className={[
                    "h-8 rounded-lg text-xs font-medium transition-colors",
                      cell === value ? "ui-button-primary h-8 px-0 text-xs" : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-hover)]",
                  ].join(" ")}
                >
                  {Number(cell.slice(-2))}
                </button>
              ) : (
                <div key={`blank-${index}`} className="h-8" />
              )
            ))}
          </div>
        </div>
      )}
    </div>
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
