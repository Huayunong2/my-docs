import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import * as api from "../lib/api";
import type { MonthDayStats, Review, ReviewKind, StatsOverview, WeekReview } from "../lib/api";
import type { Page } from "../App";
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

function todayDate(): string {
  return formatDate(new Date());
}

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const exemptionReasons = ["请假", "放假", "生病", "出差", "休息", "其他"];
type GenerationStep = "idle" | "collecting" | "requesting" | "saving";
type StatTone = "accent" | "green" | "amber" | "gray" | "rose" | "sky";

const STEP_LABELS: Record<Exclude<GenerationStep, "idle">, string> = {
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
  const [reviewError, setReviewError] = useState("");
  const [generatingKind, setGeneratingKind] = useState<ReviewKind | null>(null);
  const [generationStep, setGenerationStep] = useState<GenerationStep>("idle");
  const [expandedMissingDays, setExpandedMissingDays] = useState(false);
  const [activeMissingDay, setActiveMissingDay] = useState<string | null>(null);
  const [exemptionTarget, setExemptionTarget] = useState<MonthDayStats | null>(null);
  const [exemptionNote, setExemptionNote] = useState("");
  const [exemptionError, setExemptionError] = useState("");
  const [savingExemption, setSavingExemption] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const bounds = useMemo(() => monthBounds(year, month), [year, month]);
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
  const missingDays = weekReview?.missing_days || [];
  const visibleMissingDays = expandedMissingDays ? missingDays : missingDays.slice(0, 5);
  const monthHighlights = [
    { label: "最长记录", value: longestDay ? `${longestDay.word_count} 字` : "暂无", meta: longestDay?.date || "写下第一篇后出现" },
    { label: "最近记录", value: latestDay ? latestDay.date.slice(5) : "暂无", meta: latestDay?.title || "本月还没有记录" },
    { label: "当前空缺", value: `${overview?.missing_days || 0} 天`, meta: remainingDays ? `本月还剩 ${remainingDays} 天` : "当前月份已无剩余天" },
  ];
  const monthActionItems = [
    {
      label: "今日记录",
      value: latestDay?.date === today ? "已完成" : "待处理",
      meta: latestDay?.date === today ? "今天已有记录" : "补上今天，连续覆盖更稳定",
      action: "编辑今天",
      onClick: () => onEditDate(today),
    },
    {
      label: "空缺处理",
      value: missingDays.length ? `${missingDays.length} 天` : "无空缺",
      meta: missingDays.length ? `优先处理 ${missingDays[0]}` : "本周覆盖完整",
      action: missingDays.length ? "处理首个" : "查看月历",
      onClick: () => (missingDays.length ? onEditDate(missingDays[0]) : undefined),
    },
    {
      label: "复盘归档",
      value: selectedWeeklyReview ? (selectedWeeklyReview.status === "confirmed" ? "已确认" : "草稿") : "未生成",
      meta: selectedWeeklyReview ? `周复盘 v${selectedWeeklyReview.version}` : "生成草稿后再确认归档",
      action: "进复盘库",
      onClick: () => onNavigate("reviews"),
    },
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
    if (showLoading) setLoading(true);
    setError("");
    setReviewError("");
    try {
      const [overviewRes, monthRes, weekRes] = await Promise.all([
        api.getStatsOverview(bounds.first, bounds.last),
        api.getMonthStats(year, month),
        api.getWeekReview(today),
      ]);
      setOverview(overviewRes);
      setDays(monthRes);
      setWeekReview(weekRes);

      let weeklyReviewVersions: Review[] = [];
      let monthlyReviewVersions: Review[] = [];
      try {
        [weeklyReviewVersions, monthlyReviewVersions] = await Promise.all([
          api.listReviews("weekly", weekRes.from, weekRes.to),
          api.listReviews("monthly", bounds.first, bounds.last),
        ]);
      } catch (reviewLoadError) {
        if (reviewLoadError instanceof api.ApiError && reviewLoadError.status === 404) {
          setReviewError("AI 复盘接口不存在：服务端可能还在运行旧版本。基础统计仍可使用，请更新并重启服务端。");
        } else {
          setReviewError(api.getErrorMessage(reviewLoadError));
        }
      }

      setWeeklyReviews(weeklyReviewVersions);
      setMonthlyReviews(monthlyReviewVersions);
    } catch (e: any) {
      setError(api.getErrorMessage(e) || "加载统计失败");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [bounds.first, bounds.last, year, month, today]);

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
  useEffect(() => () => { mountedRef.current = false; }, []);

  const generateAiReview = async (kind: ReviewKind) => {
    if (!mountedRef.current) return;
    setGeneratingKind(kind);
    setGenerationStep("collecting");
    setReviewError("");
    try {
      await new Promise(r => setTimeout(r, 600));
      if (!mountedRef.current) return;
      setGenerationStep("requesting");
      await api.generateReview({ kind, date: kind === "weekly" ? today : bounds.first });
      if (!mountedRef.current) return;
      setGenerationStep("saving");
      await loadStats(false);
    } catch (e) {
      setReviewError(api.getErrorMessage(e));
    } finally {
      if (mountedRef.current) { setGeneratingKind(null); setGenerationStep("idle"); }
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
        <StatCard label="记录天数" value={loading ? "..." : `${writtenDays} 天`} tone="accent" />
        <StatCard
          label="连续覆盖"
          value={loading ? "..." : `${overview?.current_streak || 0} 天`}
          meta={overview?.streak_exempted_days ? `含 ${overview.streak_exempted_days} 天豁免` : "不含豁免"}
          tone="green"
        />
        <StatCard label="总字数" value={loading ? "..." : `${overview?.total_words || 0}`} tone="amber" />
        <StatCard
          label="豁免天数"
          value={loading ? "..." : `${exemptedDays} 天`}
          meta={dominantExemptionReason ? `主要：${dominantExemptionReason}` : undefined}
          tone={exemptionMetricTone}
        />
      </div>

      <div className="space-y-4 md:space-y-6">
        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
        <section className="min-w-0 h-full">
          <div className="ui-panel flex h-full flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">月历</h3>
                <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">点击任意日期直接编辑当天记录</p>
              </div>
              <div className="hidden flex-wrap items-center justify-end gap-2 lg:flex">
                <LegendDot className="bg-accent" label="记录" />
                <LegendDot className="bg-emerald-400" label="休息" />
                <LegendDot className="bg-rose-400" label="生病" />
                <LegendDot className="bg-sky-400" label="出差" />
                <LegendDot className="bg-amber-400" label="请假" />
                <LegendDot className="bg-gray-300 dark:bg-white/20" label="空缺" />
              </div>
              <div className="w-24 shrink-0 sm:w-36">
                <div className="flex justify-between text-[11px] text-gray-400 dark:text-gray-400 mb-1">
                  <span>覆盖度</span>
                  <span>{completion}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${completion}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="-mx-1 sm:mx-0">
              <div className="p-2 sm:p-3">
                <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1.5">
                  {weekdays.map((d) => (
                    <div key={d} className="text-center text-xs font-medium text-gray-400 dark:text-gray-500 py-1">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1 sm:gap-2">
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
                      <div
                        key={`blank-${i}`}
                        className="min-h-[68px] rounded-lg bg-gray-50/60 dark:bg-gray-900/20 sm:min-h-[86px]"
                      />
                    )
                  ))}
              </div>
            </div>
            </div>
          </div>
        </section>

          <section className="ui-panel flex h-full flex-col p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">本月概况</h3>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">覆盖节奏、记录强度和本月亮点</p>
              </div>
              <span className="rounded-full bg-accent-light px-2.5 py-1 text-[11px] font-medium text-accent dark:bg-accent-light/20">
                {coveredDays}/{bounds.daysInMonth} 天
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
              <div className="flex items-center justify-center sm:justify-start">
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

              <div className="grid grid-cols-3 gap-2">
                <CompactMetric label="覆盖" value={`${coveredDays}`} unit="天" tone="accent" />
                <CompactMetric label="剩余" value={`${remainingDays}`} unit="天" tone="gray" />
                <CompactMetric label="连续" value={`${overview?.current_streak || 0}`} unit="天" tone="green" />
                <CompactMetric label="记录" value={`${writtenDays}`} unit="天" tone="green" />
                <CompactMetric label="豁免" value={`${exemptedDays}`} unit="天" tone={exemptionMetricTone} />
                <CompactMetric label="日均" value={`${Math.round(overview?.avg_words || 0)}`} unit="字" tone="gray" />
              </div>
            </div>

            <div className="mt-5 rounded-xl bg-gray-50 p-3 dark:bg-white/[0.04]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">本月节奏</h4>
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
                <div key={item.label} className="rounded-xl border border-gray-100 bg-white px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">{item.label}</div>
                  <div className="mt-1 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{item.value}</div>
                  <div className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">{item.meta}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-gray-100 p-3 dark:border-white/5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">心情分布</h4>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">{moodEntries.length} 类</span>
              </div>
              {moodEntries.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-400">本月还没有心情记录</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {moodEntries.map(([mood, count], index) => (
                    <div key={mood} className="rounded-lg bg-gray-50 px-2.5 py-2 dark:bg-white/[0.04]">
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-gray-700 dark:text-gray-200">{mood}</span>
                        <span className="text-gray-400 dark:text-gray-500">{count} 天</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                        <div
                          className={[
                            "h-full rounded-full",
                            index % 3 === 0 ? "bg-accent" : index % 3 === 1 ? "bg-emerald-500" : "bg-amber-500",
                          ].join(" ")}
                          style={{ width: `${(count / maxMoodCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 flex-1 rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-white/5 dark:bg-white/[0.03]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">本月行动</h4>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">下一步</span>
              </div>
              <div className="grid gap-2 xl:grid-cols-3">
                {monthActionItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.onClick}
                    className="group rounded-xl border border-gray-100 bg-white px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-accent-light/40 dark:border-white/5 dark:bg-gray-900/30 dark:hover:bg-accent-light/10"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">{item.label}</span>
                      <span className="text-[11px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                        {item.action}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-semibold text-gray-800 dark:text-gray-100">{item.value}</div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-gray-400 dark:text-gray-500">{item.meta}</div>
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => onEditDate(today)}
              className="mt-4 w-full h-10 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              编辑今天
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
              description="基于本周每日记录生成。草稿确认后，才会进入月复盘输入。"
              kind="weekly"
              reviews={weeklyReviews}
              selectedReview={selectedWeeklyReview}
              generating={generatingKind === "weekly"}
              generationStep={generationStep}
              onGenerate={() => generateAiReview("weekly")}
              onOpenLibrary={() => onNavigate("reviews")}
            />
            <ReviewPanel
              className="mt-4"
              title="AI 月复盘"
              description="只读取本月已确认周复盘。没有确认周复盘时不会生成。"
              kind="monthly"
              reviews={monthlyReviews}
              selectedReview={selectedMonthlyReview}
              generating={generatingKind === "monthly"}
              generationStep={generationStep}
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
                const selected = exemptionTarget.exemption?.reason === reason;
                return (
                  <button
                    key={reason}
                    disabled={savingExemption}
                    onClick={() => saveExemption(reason)}
                    className={[
                      "h-10 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-60",
                      selected
                        ? tone.solid
                        : tone.option,
                    ].join(" ")}
                  >
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
  const openExemption = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (canManageExemption) onManageExemption(day);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEditDate(day.date)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onEditDate(day.date);
      }}
      onContextMenu={openExemption}
      title={day.title || day.exemption?.reason || day.date}
      className={[
        "group relative min-h-[68px] overflow-hidden rounded-lg border p-1.5 text-left transition-all sm:min-h-[86px] sm:p-2",
        "focus:outline-none focus:ring-2 focus:ring-accent/30",
        day.has_article
          ? "border-accent/30 bg-accent-light/80 dark:bg-accent-light/20 hover:border-accent hover:shadow-sm"
          : day.exemption
            ? `${exemptionTone.card} ${exemptionTone.hover}`
            : "border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/20 hover:bg-gray-50 dark:hover:bg-gray-700/30",
        isToday ? "ring-2 ring-amber-300 dark:ring-amber-500/60" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={[
            "inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 font-semibold text-xs",
            day.has_article
              ? "bg-white/80 text-accent dark:bg-gray-900/30"
              : "text-gray-400 dark:text-gray-500",
          ].join(" ")}
        >
          {dateNum}
        </span>
        <span className="flex items-center gap-1 min-w-0">
          {day.mood && <span className="text-xs leading-none truncate max-w-[20px]">{day.mood}</span>}
          {canManageExemption && (
            <button
              type="button"
              onClick={openExemption}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-gray-300 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              title="设置未写原因"
            >
              …
            </button>
          )}
        </span>
      </div>

      {day.has_article ? (
        <div className="mt-1 sm:mt-2 space-y-1">
          <div className="truncate text-[11px] sm:text-xs font-medium text-gray-700 dark:text-gray-200">
            {day.title || "(无标题)"}
          </div>
          <div className="h-1 sm:h-1.5 rounded-full bg-white/80 dark:bg-gray-700 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${words}%` }} />
          </div>
          <div className="text-[10px] sm:text-[11px] text-gray-500 dark:text-gray-400">
            {day.word_count} 字
          </div>
        </div>
      ) : day.exemption ? (
        <div className="mt-1 sm:mt-3">
          <div className={`inline-flex max-w-full items-center truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${exemptionTone.pill}`}>
            {day.exemption.reason}
          </div>
          {day.exemption.note && (
            <div className={`mt-0.5 truncate text-[10px] ${exemptionTone.note}`}>
              {day.exemption.note}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-1 sm:mt-3 text-[10px] sm:text-[11px] text-gray-300 group-hover:text-gray-400 dark:text-gray-600">
          可补写
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

function ReviewPanel({
  className = "",
  title,
  description,
  kind,
  reviews,
  selectedReview,
  generating,
  generationStep = "collecting",
  onGenerate,
  onOpenLibrary,
}: {
  className?: string;
  title: string;
  description: string;
  kind: ReviewKind;
  reviews: Review[];
  selectedReview: Review | null;
  generating: boolean;
  generationStep?: string;
  onGenerate: () => void;
  onOpenLibrary: () => void;
}) {

  return (
    <section className={`rounded-2xl border border-gray-100/80 dark:border-white/5 bg-white dark:bg-white/[0.04] p-4 sm:p-5 hover:border-gray-200 dark:hover:border-white/10 transition-colors ${className}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            {kind === "weekly" ? "📊" : "📈"} {title}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{description}</p>
        </div>
        {reviews.length > 0 && (
          <span className="shrink-0 rounded-full bg-gray-100 dark:bg-white/10 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
            v{reviews.length}
          </span>
        )}
      </div>

      {/* Review preview */}
      {selectedReview ? (
        <div className="mb-4 rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-100/80 dark:border-white/5 p-3.5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">{selectedReview.title}</span>
            <ReviewStatusPill status={selectedReview.status} />
          </div>
          <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            {selectedReview.content}
          </p>
        </div>
      ) : reviews.length > 0 ? (
        <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">进入复盘库查看历史版本</p>
      ) : (
        <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">还没有 AI 复盘版本</p>
      )}

      {generating && (
        <div className="mb-3 rounded-xl bg-gray-50 dark:bg-white/[0.04] px-3 py-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            {(["collecting","requesting","saving"] as const).map((step, i) => {
              const currentIdx = generationStep === "collecting" ? 0 : generationStep === "requesting" ? 1 : generationStep === "saving" ? 2 : 0;
              const done = i <= currentIdx;
              return (
                <div key={step} className="flex items-center gap-1.5 flex-1">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${done ? "bg-accent text-white" : "bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500"}`}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span className={`truncate text-[11px] transition-colors ${done ? "text-gray-700 dark:text-gray-200 font-medium" : "text-gray-400 dark:text-gray-500"}`}>
                    {STEP_LABELS[step]}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${(generationStep === "collecting" ? 33 : generationStep === "requesting" ? 66 : generationStep === "saving" ? 100 : 0)}%` }} />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="flex-1 h-12 sm:h-10 rounded-2xl bg-accent text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          {generating ? (
            <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <span>✨</span>
          )}
          {generating ? "生成中..." : kind === "weekly" ? "AI 周复盘" : "AI 月复盘"}
        </button>
        <button
          type="button"
          onClick={onOpenLibrary}
          className="h-12 sm:h-10 px-4 rounded-2xl bg-gray-100 dark:bg-white/10 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/15 transition-all duration-200 active:scale-[0.98]"
        >
          📚
        </button>
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta?: string;
  tone: StatTone;
}) {
  const toneClass = {
    accent: "bg-accent-light text-accent dark:bg-accent-light/20",
    green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-300",
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-300",
    gray: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200",
  }[tone];

  return (
      <div className="ui-panel p-3 md:p-4">
      <div className={`mb-3 h-1.5 w-10 rounded-full ${toneClass}`} />
      <p className="text-xs text-gray-400 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</p>
      {meta && <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-400">{meta}</p>}
    </div>
  );
}

function CompactMetric({
  label,
  value,
  unit,
  tone,
}: {
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
    <div className={`rounded-xl px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className="mt-1 text-lg font-bold leading-none">
        {value}
        <span className="ml-0.5 text-[11px] font-medium opacity-70">{unit}</span>
      </div>
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
    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}
