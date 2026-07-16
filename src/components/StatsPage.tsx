import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import { Activity, BarChart3, BookOpenText, CalendarCheck, CalendarDays, CalendarRange, CircleHelp, Clock, Coffee, FileText, Heart, HeartPulse, LineChart, LoaderCircle, PencilLine, Plane, ShieldCheck, Sparkles, Target, TrendingUp, Trophy, Umbrella } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as api from "../lib/api";
import type { MonthDayStats, Review, ReviewKind, StatsOverview, WeekReview } from "../lib/api";
import type { Page } from "../App";
import { normalizeReviewContent } from "../lib/reviewContent";
import { generateReviewVersion, upsertReviewVersion } from "../lib/reviewGeneration";
import type { ReviewGenerationStep } from "../lib/reviewGeneration";
import { loadStatsSnapshot } from "../lib/statsSnapshot";
import { ReviewStatusPill } from "./reviews/ReviewShared";

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

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const exemptionReasons = ["休息", "请假", "生病", "出差"];
type StatTone = "accent" | "green" | "amber" | "gray" | "rose" | "sky";

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
}: {
  onEditDate: (date: string) => void;
  onSearchTerm: (term: string) => void;
  onNavigate: (page: Page) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [days, setDays] = useState<MonthDayStats[]>([]);
  const [weekReview, setWeekReview] = useState<WeekReview | null>(null);
  const [weeklyReviews, setWeeklyReviews] = useState<Review[]>([]);
  const [monthlyReviews, setMonthlyReviews] = useState<Review[]>([]);
  const [reviewWeekDate, setReviewWeekDate] = useState(() => todayDate());
  const [reviewError, setReviewError] = useState("");
  const [generatingKind, setGeneratingKind] = useState<ReviewKind | null>(null);
  const [generationStep, setGenerationStep] = useState<ReviewGenerationStep>("idle");
  const [expandedMissingDays, setExpandedMissingDays] = useState(false);
  const [activeMissingDay, setActiveMissingDay] = useState<string | null>(null);
  const [exemptionTarget, setExemptionTarget] = useState<MonthDayStats | null>(null);
  const [exemptionNote, setExemptionNote] = useState("");
  const [exemptionError, setExemptionError] = useState("");
  const [savingExemption, setSavingExemption] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadRevision = useRef(0);
  const generationInFlight = useRef(false);

  const bounds = useMemo(() => monthBounds(year, month), [year, month]);
  const selectedWeekBounds = useMemo(() => weekBounds(reviewWeekDate), [reviewWeekDate]);
  const generationAnchors = useRef({ weekly: reviewWeekDate, monthly: bounds.first });
  generationAnchors.current = { weekly: reviewWeekDate, monthly: bounds.first };
  const maxMoodCount = Math.max(1, ...Object.values(overview?.mood_counts || {}));
  const writtenDays = overview?.days_written || 0;
  const exemptedDays = overview?.exempted_days || 0;
  const coveredDays = writtenDays + exemptedDays;
  const completion = bounds.daysInMonth > 0 ? Math.round((coveredDays / bounds.daysInMonth) * 100) : 0;
  const today = todayDate();
  const selectedWeeklyReview = chooseCurrentReview(weeklyReviews);
  const selectedMonthlyReview = chooseCurrentReview(monthlyReviews);
  const activeDays = useMemo(() => days.filter((day) => day.has_article), [days]);
  const longestDay = useMemo(
    () => activeDays.reduce<MonthDayStats | null>((best, day) => (!best || day.word_count > best.word_count ? day : best), null),
    [activeDays]
  );
  const latestDay = useMemo(() => [...activeDays].reverse()[0] || null, [activeDays]);
  const maxDayWords = Math.max(1, ...days.map((day) => day.word_count));
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
    if (activeMissingDay && !missingDays.includes(activeMissingDay)) {
      setActiveMissingDay(null);
    }
  }, [activeMissingDay, missingDays]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const goCurrentMonth = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  };

  const openExemptionMenu = (day: MonthDayStats) => {
    setExemptionTarget(day);
    setExemptionNote(day.exemption?.note || "");
    setExemptionError("");
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
      setExemptionTarget(null);
      await loadStats(false);
    } catch (e: any) {
      setExemptionError(e.message || "保存未写原因失败");
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
      setExemptionTarget(null);
      await loadStats(false);
    } catch (e: any) {
      setExemptionError(e.message || "删除未写原因失败");
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
      className="min-h-full overflow-y-auto px-3 pb-24 pt-4 sm:px-4 md:px-8 md:py-6"
    >
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4 md:mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">统计</h2>
          <p className="text-sm text-gray-400 dark:text-gray-400 mt-0.5">
            {year} 年 {month} 月 · {loading ? "加载中" : `${writtenDays} 天记录，${exemptedDays} 天豁免`}
          </p>
        </div>
        <div className="ui-toolbar flex items-center gap-1">
          <button
            onClick={() => shiftMonth(-1)}
            className="ui-icon-button h-8 w-8"
            title="上个月"
          >
            ‹
          </button>
          <button
            onClick={goCurrentMonth}
            className="h-8 rounded-lg px-3 text-xs font-semibold text-accent transition-colors hover:bg-white dark:hover:bg-white/10"
          >
            本月
          </button>
          <button
            onClick={() => shiftMonth(1)}
            className="ui-icon-button h-8 w-8"
            title="下个月"
          >
            ›
          </button>
        </div>
      </div>

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
        <StatCard icon={CalendarDays} label="记录天数" value={loading ? "..." : `${writtenDays} 天`} tone="accent" />
        <StatCard
          icon={TrendingUp}
          label="连续覆盖"
          value={loading ? "..." : `${overview?.current_streak || 0} 天`}
          meta={overview?.streak_exempted_days ? `含 ${overview.streak_exempted_days} 天豁免` : "不含豁免"}
          tone="sky"
        />
        <StatCard icon={FileText} label="总字数" value={loading ? "..." : `${overview?.total_words || 0}`} tone="amber" />
        <StatCard
          icon={ShieldCheck}
          label="豁免天数"
          value={loading ? "..." : `${exemptedDays} 天`}
          meta={dominantExemptionReason ? `主要：${dominantExemptionReason}` : undefined}
          tone={exemptionMetricTone}
        />
      </div>

      <div className="space-y-4 md:space-y-6">
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
        <section className="min-w-0 h-[644px] sm:h-[684px] xl:h-[724px]">
          <div className="ui-panel flex h-full flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  <CalendarRange size={16} className="text-accent" /> 月历
                </h3>
                <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">点击任意日期编辑当天记录</p>
              </div>
              <div className="w-24 shrink-0 sm:w-36">
                <div className="flex justify-between text-[11px] text-gray-400 dark:text-gray-400 mb-1">
                  <span>覆盖度</span>
                  <span>{completion}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${completion}%` }} />
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
              <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1.5 shrink-0">
                {weekdays.map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-gray-400 dark:text-gray-500 py-1.5 uppercase tracking-wider">
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
                      onManageExemption={openExemptionMenu}
                    />
                  ) : (
                    <div key={`blank-${i}`} data-calendar-cell="blank" className="box-border h-full min-h-0 rounded-lg border border-transparent bg-gray-50/40 dark:bg-white/[0.02]" />
                  )
                ))}
              </div>
            </div>

            <div className="flex h-9 shrink-0 items-center border-t border-gray-100 px-2 dark:border-gray-700 sm:px-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <LegendDot className="bg-accent" label="记录" />
                <LegendDot className="bg-emerald-400" label="休息" />
                <LegendDot className="bg-amber-400" label="请假" />
                <LegendDot className="bg-rose-400" label="生病" />
                <LegendDot className="bg-sky-400" label="出差" />
                <LegendDot className="bg-gray-300 dark:bg-white/20" label="空缺" />
                <span className="ml-1 inline-flex h-6 shrink-0 items-center rounded-full border border-gray-100 bg-white/70 px-2 text-[11px] font-medium text-gray-500 dark:border-white/5 dark:bg-white/[0.04] dark:text-gray-400 sm:ml-auto">
                  {writtenDays} 天记录 · {exemptedDays} 天豁免
                </span>
              </div>
            </div>
          </div>
        </section>

          <section className="ui-panel h-[644px] min-w-0 overflow-y-auto p-3 sm:h-[684px] sm:p-4 xl:h-[724px]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  <BarChart3 size={16} className="text-accent" /> 本月概况
                </h3>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">覆盖节奏、记录强度和本月亮点</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-light px-2.5 py-1 text-[11px] font-medium text-accent dark:bg-accent-light/20">
                <CalendarRange size={12} />
                {coveredDays}/{bounds.daysInMonth} 天
              </span>
            </div>

            <div className="grid gap-4 rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-white/5 dark:bg-white/[0.03] sm:grid-cols-[150px_1fr]">
              <div className="flex items-center justify-center">
                <div className="relative h-32 w-32">
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="52" fill="none" strokeWidth="10" className="stroke-gray-100 dark:stroke-white/10" />
                    <circle
                      cx="60"
                      cy="60"
                      r="52"
                      fill="none"
                      strokeWidth="10"
                      strokeLinecap="round"
                      className="stroke-accent"
                      strokeDasharray={`${Math.min(100, Math.max(0, completion)) * 3.267} 326.7`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-gray-800 dark:text-gray-100">{completion}%</span>
                    <span className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">覆盖度</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
                <CompactMetric icon={CalendarCheck} label="覆盖" value={`${coveredDays}`} unit="天" tone="accent" />
                <CompactMetric icon={Clock} label="剩余" value={`${remainingDays}`} unit="天" tone="gray" />
                <CompactMetric icon={TrendingUp} label="连续" value={`${overview?.current_streak || 0}`} unit="天" tone="sky" />
                <CompactMetric icon={FileText} label="记录" value={`${writtenDays}`} unit="天" tone="green" />
                <CompactMetric icon={ShieldCheck} label="豁免" value={`${exemptedDays}`} unit="天" tone="rose" />
                <CompactMetric icon={Activity} label="日均" value={`${Math.round(overview?.avg_words || 0)}`} unit="字" tone="amber" />
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/5 dark:bg-white/[0.04]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  <Activity size={14} /> 本月节奏
                </h4>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">记录 / 豁免 / 空缺</span>
              </div>
              <div className="flex h-20 items-end gap-[3px]">
                {days.map((day) => {
                  const height = day.has_article ? Math.max(14, Math.round((day.word_count / maxDayWords) * 100)) : day.exemption ? 18 : 8;
                  const status = day.has_article ? `${day.word_count} 字` : day.exemption ? `豁免：${day.exemption.reason}` : "空缺";
                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => onEditDate(day.date)}
                      title={`${day.date} · ${status}`}
                      className="group flex h-full min-w-0 flex-1 items-end justify-center rounded-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                    >
                      <span
                        className={[
                          "block min-h-[4px] w-full rounded-t-[3px] transition-all group-hover:opacity-80",
                          day.has_article
                            ? "bg-accent shadow-sm shadow-accent/20"
                            : day.exemption
                              ? getExemptionTone(day.exemption.reason).bar
                              : "bg-gray-200 dark:bg-white/20",
                        ].join(" ")}
                        style={{ height: `${height}%` }}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
                <span>{bounds.first.slice(5)}</span>
                <span>最长 {longestDay ? `${longestDay.word_count} 字` : "暂无"}</span>
                <span>{bounds.last.slice(5)}</span>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {monthHighlights.map((item) => (
                <MonthHighlightCard key={item.label} {...item} />
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-gray-100 p-3 dark:border-white/5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  <Heart size={14} /> 心情分布
                </h4>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">{moodEntries.length} 类</span>
              </div>
              {moodEntries.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-400">本月还没有心情记录</p>
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
                    <div className="flex h-full min-h-0 items-center justify-center rounded-lg bg-gray-50 px-2 text-center text-xs font-medium text-gray-400 dark:bg-white/[0.04] dark:text-gray-500">
                      +{hiddenMoodCount}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <button
              onClick={() => onEditDate(today)}
              className={[
                "h-10 w-full rounded-lg bg-accent text-sm font-medium text-white transition-colors hover:bg-accent-hover",
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
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">本周复盘</h3>
            <p className="text-xs text-gray-400 dark:text-gray-400 mb-3">
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
                onClick={() => onEditDate(weekReview.longest_article!.date)}
                className="mt-4 w-full rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-3 py-2 text-left hover:border-accent/40"
              >
                <div className="text-[11px] text-gray-400 dark:text-gray-400">最长记录</div>
                <div className="mt-1 truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                  {weekReview.longest_article.title || "(无标题)"}
                </div>
                <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-400">
                  {weekReview.longest_article.date} · {weekReview.longest_article.word_count} 字
                </div>
              </button>
            )}
            {missingDays.length ? (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 dark:text-gray-400">空缺日操作</span>
                  {missingDays.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setExpandedMissingDays((value) => !value)}
                      className="text-xs font-medium text-accent hover:underline"
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
                        "rounded-full border px-2.5 py-1 font-mono text-xs transition-colors",
                        activeMissingDay === date
                          ? "border-accent/50 bg-accent-light text-accent dark:bg-accent-light/20"
                          : "border-gray-100 bg-gray-50 text-gray-500 hover:border-accent/30 hover:text-accent dark:border-white/5 dark:bg-gray-900/30 dark:text-gray-400",
                      ].join(" ")}
                    >
                      {date.slice(5)}
                    </button>
                  ))}
                </div>
                {activeMissingDay && (
                  <div className="mt-2 flex flex-col gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-white/5 dark:bg-gray-900/30 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{activeMissingDay}</span>
                    <div className="grid grid-cols-2 gap-2 sm:flex">
                      <button
                        type="button"
                        onClick={() => {
                          const date = activeMissingDay;
                          setActiveMissingDay(null);
                          onEditDate(date);
                        }}
                        className="h-8 rounded-lg bg-accent-light px-3 text-xs font-medium text-accent hover:bg-accent-light/80 dark:bg-accent-light/20"
                      >
                        补写
                      </button>
                      <button
                        type="button"
                        onClick={() => openMissingExemption(activeMissingDay)}
                        className="h-8 rounded-lg bg-amber-50 px-3 text-xs font-medium text-amber-600 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300"
                      >
                        豁免
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            <div className="mt-4">
              <div className="mb-2 text-xs text-gray-400 dark:text-gray-400">高频词</div>
              {weekReview?.top_terms.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {weekReview.top_terms.map((item) => (
                    <button
                      key={item.term}
                      onClick={() => onSearchTerm(item.term)}
                      className="rounded-full bg-accent-light px-2 py-1 text-xs text-accent dark:bg-accent-light/20"
                    >
                      {item.term} × {item.count}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-400">本周内容还不足以提取关键词</p>
              )}
            </div>
            <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
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

      {exemptionTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center"
          onClick={() => setExemptionTarget(null)}
        >
          <div
            className="ui-modal-surface max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">未写原因</h3>
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-400">
                {exemptionTarget.date} · 豁免日不算记录，但不会打断连续覆盖。
              </p>
            </div>
            <textarea
              value={exemptionNote}
              onChange={(e) => setExemptionNote(e.target.value)}
              rows={2}
              placeholder="备注，可留空"
              className="ui-textarea mb-3"
            />
            <div className="grid grid-cols-2 gap-2">
              {exemptionReasons.map((reason) => {
                const tone = getExemptionTone(reason);
                const ReasonIcon = getExemptionIcon(reason);
                const selected = exemptionTarget.exemption?.reason === reason;
                return (
                  <button
                    key={reason}
                    disabled={savingExemption}
                    onClick={() => saveExemption(reason)}
                    className={[
                      "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-60",
                      selected
                        ? tone.solid
                        : tone.option,
                    ].join(" ")}
                  >
                    <ReasonIcon size={15} />
                    {reason}
                  </button>
                );
              })}
            </div>
            {exemptionError && (
              <p className="ui-alert-bad mt-3 text-xs">
                {exemptionError}
              </p>
            )}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setExemptionTarget(null)}
                disabled={savingExemption}
                className="ui-button-secondary h-10 px-4 text-sm"
              >
                取消
              </button>
              {exemptionTarget.exemption && (
                <button
                  onClick={clearExemption}
                  disabled={savingExemption}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-red-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-60"
                >
                  清除原因
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function CalendarDay({
  day,
  isToday,
  onEditDate,
  onManageExemption,
}: {
  day: MonthDayStats;
  isToday: boolean;
  onEditDate: (date: string) => void;
  onManageExemption: (day: MonthDayStats) => void;
}) {
  const dateNum = Number(day.date.slice(-2));
  const words = Math.min(100, Math.max(8, Math.round(day.word_count / 8)));
  const canManageExemption = !day.has_article;
  const exemptionTone = getExemptionTone(day.exemption?.reason);
  const ExemptionIcon = getExemptionIcon(day.exemption?.reason);
  const openExemption = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (canManageExemption) onManageExemption(day);
  };
  return (
    <div
      data-calendar-cell="day"
      role="button"
      tabIndex={0}
      onClick={() => onEditDate(day.date)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onEditDate(day.date);
      }}
      onContextMenu={openExemption}
      title={day.title || day.exemption?.reason || day.date}
      className={[
        "group relative box-border h-full min-h-0 overflow-hidden rounded-lg border text-left transition-all",
        "focus:outline-none focus:ring-2 focus:ring-accent/30",
        day.has_article
          ? "border-accent/30 bg-accent-light/80 dark:bg-accent-light/20 hover:border-accent hover:shadow-sm"
          : day.exemption
            ? `${exemptionTone.card} ${exemptionTone.hover}`
            : "border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/20 hover:bg-gray-50 dark:hover:bg-gray-700/30",
        isToday ? "ring-2 ring-inset ring-amber-300 dark:ring-amber-500/60" : "",
      ].join(" ")}
    >
      <span className={[
        "absolute left-1.5 top-1.5 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-semibold sm:left-2 sm:top-2",
        day.has_article ? "bg-white/80 text-accent dark:bg-gray-900/30" : "text-gray-400 dark:text-gray-500"
      ].join(" ")}>
        {dateNum}
      </span>

      <span className="absolute right-1.5 top-1.5 z-20 flex items-center gap-0.5 sm:right-2 sm:top-2">
        {day.has_article && (
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/70 text-accent dark:bg-gray-900/30">
            <FileText size={11} />
          </span>
        )}
        {canManageExemption && (
          <button type="button" onClick={openExemption}
            className="inline-flex h-5 w-5 items-center justify-center rounded-md text-gray-300 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            title="豁免原因"><ExemptionIcon size={12} /></button>
        )}
      </span>

      {day.has_article ? (
        <div className="absolute inset-x-1.5 bottom-1.5 sm:inset-x-2 sm:bottom-2">
          <div className="mb-1 h-1 overflow-hidden rounded-full bg-white/80 dark:bg-gray-700 sm:h-1.5">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${words}%` }} />
          </div>
          <div className="flex items-center justify-between gap-1 text-[10px] leading-none text-gray-500 dark:text-gray-400">
            <span className="truncate">{day.word_count} 字</span>
            {day.mood && <span className="shrink-0">{day.mood}</span>}
          </div>
        </div>
      ) : day.exemption ? (
        <div className="absolute inset-x-1.5 top-1/2 flex -translate-y-1/2 justify-center sm:inset-x-2">
          <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${exemptionTone.pill}`}>
            <ExemptionIcon size={12} />
            {day.exemption.reason}
          </span>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600 group-hover:text-gray-400">
          <PencilLine size={12} />
        </div>
      )}
    </div>
  );
}

function getExemptionTone(reason?: string) {
  if (reason === "休息" || reason === "放假") {
    return {
      card: "border-emerald-200 bg-emerald-50/85 dark:border-emerald-500/35 dark:bg-emerald-500/10",
      hover: "hover:border-emerald-300 dark:hover:border-emerald-400/50",
      pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
      note: "text-emerald-700/70 dark:text-emerald-200/70",
      bar: "bg-emerald-400 shadow-sm shadow-emerald-400/20",
      option: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100 dark:hover:bg-emerald-500/20",
      solid: "border-emerald-400 bg-emerald-500 text-white shadow-sm shadow-emerald-500/25",
    };
  }
  if (reason === "生病") {
    return {
      card: "border-rose-200 bg-rose-50/85 dark:border-rose-500/35 dark:bg-rose-500/10",
      hover: "hover:border-rose-300 dark:hover:border-rose-400/50",
      pill: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
      note: "text-rose-700/70 dark:text-rose-200/70",
      bar: "bg-rose-400 shadow-sm shadow-rose-400/20",
      option: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100 dark:hover:bg-rose-500/20",
      solid: "border-rose-400 bg-rose-500 text-white shadow-sm shadow-rose-500/25",
    };
  }
  if (reason === "出差") {
    return {
      card: "border-sky-200 bg-sky-50/85 dark:border-sky-500/35 dark:bg-sky-500/10",
      hover: "hover:border-sky-300 dark:hover:border-sky-400/50",
      pill: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
      note: "text-sky-700/70 dark:text-sky-200/70",
      bar: "bg-sky-400 shadow-sm shadow-sky-400/20",
      option: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100 dark:hover:bg-sky-500/20",
      solid: "border-sky-400 bg-sky-500 text-white shadow-sm shadow-sky-500/25",
    };
  }
  return {
    card: "border-amber-200 bg-amber-50/85 dark:border-amber-500/35 dark:bg-amber-500/10",
    hover: "hover:border-amber-300 dark:hover:border-amber-400/50",
    pill: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
    note: "text-amber-700/70 dark:text-amber-200/70",
    bar: "bg-amber-400 shadow-sm shadow-amber-400/20",
    option: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/20",
    solid: "border-amber-400 bg-amber-500 text-white shadow-sm shadow-amber-500/25",
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
    "bg-accent",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-sky-500",
    "bg-rose-500",
    "bg-violet-500",
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
    <section className={`rounded-xl border border-gray-100 bg-white p-3 transition-colors dark:border-white/10 dark:bg-white/[0.035] sm:p-4 ${className}`}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            {kind === "weekly" ? <BarChart3 size={16} /> : <LineChart size={16} />} {title}
          </h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</p>
        </div>
        {reviews.length > 0 && (
          <span className="shrink-0 rounded-full bg-gray-100 dark:bg-white/10 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
            v{reviews.length}
          </span>
        )}
      </div>

      <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.035]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              <CalendarRange size={12} /> 生成周期
            </div>
            <div className="mt-0.5 truncate text-xs font-semibold text-gray-700 dark:text-gray-200">{periodLabel}</div>
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
        <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.035]">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">{selectedReview.title}</span>
            <ReviewStatusPill status={selectedReview.status} />
          </div>
          <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-gray-600 dark:text-gray-400">
            {previewContent}
          </p>
        </div>
      ) : reviews.length > 0 ? (
        <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">进入复盘库查看历史版本</p>
      ) : (
        <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">还没有 AI 复盘版本</p>
      )}

      {(estimateLabel || generating) && (
        <div className={`mb-3 min-h-[52px] rounded-lg border px-3 py-2 text-xs leading-5 ${generating ? "border-accent/15 bg-accent-light/40 text-gray-600 dark:bg-accent-light/10 dark:text-gray-300" : "border-gray-100 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/[0.035] dark:text-gray-400"}`}>
          {generating ? (
            <>
              <div className="mb-1.5 flex items-center gap-2 font-medium">
                <LoaderCircle size={13} className="animate-spin text-accent" />
                {generationStep === "idle" ? "准备生成" : STEP_LABELS[generationStep]}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: generationStep === "saving" ? "100%" : generationStep === "requesting" ? "66%" : "33%" }} />
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
      <div className="mb-1 text-xs text-gray-400 dark:text-gray-500">周内任意一天</div>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 font-mono text-xs font-semibold text-gray-700 outline-none transition-colors hover:border-accent/30 dark:border-white/10 dark:bg-gray-950/30 dark:text-gray-100"
      >
        {value.replace(/-/g, "/")}
        <CalendarRange size={13} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[280px] rounded-xl border border-gray-100 bg-white p-3 shadow-modal dark:border-white/10 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))} className="ui-icon-button h-8 w-8">‹</button>
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{year} 年 {month + 1} 月</div>
            <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))} className="ui-icon-button h-8 w-8">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-gray-400 dark:text-gray-500">
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
                    cell === value
                      ? "bg-accent text-white"
                      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10",
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

function StatCard({
  icon: Icon,
  label,
  value,
  meta,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  meta?: string;
  tone: StatTone;
}) {
  const toneClass = {
    accent: {
      icon: "bg-accent-light text-accent dark:bg-accent-light/20",
      glow: "from-accent/12",
    },
    green: {
      icon: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
      glow: "from-emerald-500/12",
    },
    amber: {
      icon: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
      glow: "from-amber-500/12",
    },
    rose: {
      icon: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
      glow: "from-rose-500/12",
    },
    sky: {
      icon: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300",
      glow: "from-sky-500/12",
    },
    gray: {
      icon: "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300",
      glow: "from-gray-500/10",
    },
  }[tone];

  return (
    <div className="ui-panel relative overflow-hidden p-3 md:p-4">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${toneClass.glow} to-transparent`} />
      <div className="relative flex min-h-[84px] flex-col justify-between gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-400 dark:text-gray-400">{label}</p>
            {meta && <p className="mt-1 truncate text-[11px] text-gray-400/90 dark:text-gray-500">{meta}</p>}
          </div>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneClass.icon}`}>
            <Icon size={17} />
          </span>
        </div>
        <p className="text-2xl font-bold leading-none text-gray-800 dark:text-gray-100 md:text-[26px]">{value}</p>
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
    accent: "text-accent bg-accent-light dark:bg-accent-light/20",
    green: "text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/20",
    amber: "text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/20",
    rose: "text-rose-600 bg-rose-50 dark:text-rose-300 dark:bg-rose-900/20",
    sky: "text-sky-600 bg-sky-50 dark:text-sky-300 dark:bg-sky-900/20",
    gray: "text-gray-600 bg-gray-50 dark:text-gray-300 dark:bg-white/[0.05]",
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
      <div className="flex h-full min-h-0 items-center justify-between gap-1 rounded-lg bg-gray-50 px-2 dark:bg-white/[0.04]">
        <span className="truncate text-sm leading-none">{mood}</span>
        <span className="shrink-0 text-[11px] font-medium text-gray-400 dark:text-gray-500">{count} 天</span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex h-full min-h-0 items-center justify-between gap-1 rounded-lg bg-gray-50 px-2 dark:bg-white/[0.04]">
        <span className="truncate text-sm leading-none">{mood}</span>
        <span className="shrink-0 text-[11px] font-medium text-gray-400 dark:text-gray-500">{count} 天</span>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-white/[0.04]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-sm leading-none">{mood}</span>
        <span className="shrink-0 text-[11px] font-medium text-gray-400 dark:text-gray-500">{count} 天</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
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
    <div className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-gray-400 dark:text-gray-500">{label}</div>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-400 dark:bg-white/[0.06] dark:text-gray-500">
          <Icon size={13} />
        </span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">{meta}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-400 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-700 dark:text-gray-200">{value}</span>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-gray-100 bg-white/70 px-2 text-[11px] font-medium text-gray-500 dark:border-white/5 dark:bg-white/[0.04] dark:text-gray-400">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full shadow-sm ${className}`} />
      {label}
    </span>
  );
}
