import type { Review, ReviewKind, ReviewListPage, ReviewStatus } from "./api";

/** Read-only adaptation for servers predating /reviews/query. */
export function paginateLegacyReviews(
  reviews: Review[],
  filters: {
    kind?: ReviewKind;
    status?: ReviewStatus;
    q?: string;
    page?: number;
    page_size?: number;
  },
  now = new Date(),
): ReviewListPage {
  const page = Math.max(1, Math.floor(filters.page || 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(filters.page_size || 24)),
  );
  const query = (filters.q || "").replace(/\0/g, " ").trim();
  // Preserve the existing SQLite LIKE search behavior, including % and _.
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = query
    ? new RegExp(
        query
          .split("")
          .map((char) =>
            char === "%"
              ? "[\\s\\S]*"
              : char === "_"
                ? "[\\s\\S]"
                : escape(char),
          )
          .join(""),
        "i",
      )
    : null;
  const filtered = reviews.filter(
    (review) =>
      (!filters.kind || review.kind === filters.kind) &&
      (!filters.status || review.status === filters.status) &&
      (!pattern ||
        [
          review.title,
          review.content,
          review.model,
          review.period_start,
          review.period_end,
          review.kind,
        ].some((value) => pattern.test(value))),
  );
  const sorted = [...filtered].sort(
    (a, b) =>
      b.period_start.localeCompare(a.period_start) ||
      b.period_end.localeCompare(a.period_end) ||
      a.kind.localeCompare(b.kind) ||
      b.version - a.version ||
      b.updated_at.localeCompare(a.updated_at),
  );
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const weeklyMonth = (review: Review) => {
    const date = new Date(`${review.period_start}T12:00:00`);
    date.setDate(date.getDate() + 3);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };
  return {
    reviews: sorted.slice((page - 1) * pageSize, page * pageSize),
    total: sorted.length,
    draft_count: sorted.filter((review) => review.status === "draft").length,
    confirmed_count: sorted.filter((review) => review.status === "confirmed")
      .length,
    current_month_weekly_drafts: sorted.filter(
      (review) =>
        review.kind === "weekly" &&
        review.status === "draft" &&
        weeklyMonth(review) === currentMonth,
    ).length,
    latest_generated_at: sorted.reduce<string | null>(
      (latest, review) =>
        !latest || review.generated_at > latest ? review.generated_at : latest,
      null,
    ),
    page,
    page_size: pageSize,
    has_more: page * pageSize < sorted.length,
  };
}
