import type { MonthDayStats, Review, ReviewKind, StatsOverview, WeekReview } from "./api";

export interface StatsSnapshotPort {
  getStatsOverview(from: string, to: string): Promise<StatsOverview>;
  getMonthStats(year: number, month: number): Promise<MonthDayStats[]>;
  getWeekReview(date: string): Promise<WeekReview>;
  listReviews(kind: ReviewKind, from: string, to: string): Promise<Review[]>;
}

export interface StatsSnapshotSelection {
  year: number;
  month: number;
  monthFrom: string;
  monthTo: string;
  weekDate: string;
  weekFrom: string;
  weekTo: string;
}

export interface StatsSnapshot {
  overview: StatsOverview;
  days: MonthDayStats[];
  week: WeekReview;
  weeklyReviews: Review[];
  monthlyReviews: Review[];
  reviewError: unknown | null;
}

export async function loadStatsSnapshot(
  port: StatsSnapshotPort,
  selection: StatsSnapshotSelection,
): Promise<StatsSnapshot> {
  const [overview, days, week] = await Promise.all([
    port.getStatsOverview(selection.monthFrom, selection.monthTo),
    port.getMonthStats(selection.year, selection.month),
    port.getWeekReview(selection.weekDate),
  ]);
  const reviewResults = await Promise.allSettled([
    port.listReviews("weekly", selection.weekFrom, selection.weekTo),
    port.listReviews("monthly", selection.monthFrom, selection.monthTo),
  ]);
  const reviewError = reviewResults.find((result) => result.status === "rejected");

  return {
    overview,
    days,
    week,
    weeklyReviews: reviewResults[0].status === "fulfilled" ? reviewResults[0].value : [],
    monthlyReviews: reviewResults[1].status === "fulfilled" ? reviewResults[1].value : [],
    reviewError: reviewError?.status === "rejected" ? reviewError.reason : null,
  };
}
