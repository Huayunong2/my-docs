import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paginateLegacyReviews } from "./reviewCompatibility";
import { queryReviews, type Review } from "./api";
const first: Review = {
  id: "a",
  kind: "weekly",
  period_start: "2026-08-31",
  period_end: "2026-09-06",
  version: 1,
  status: "confirmed",
  title: "RAII 资源",
  content: "原文",
  source_article_ids: [],
  source_review_ids: [],
  model: "test",
  generated_at: "2026-09-07",
  updated_at: "2026-09-07",
};
const second: Review = {
  ...first,
  id: "b",
  version: 2,
  status: "draft",
  title: "RAII 第二版",
  generated_at: "2026-09-08",
  updated_at: "2026-09-08",
};
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.stubGlobal("window", {}));
describe("legacy review pagination", () => {
  it("sorts versions and pages without losing counts", () => {
    const result = paginateLegacyReviews(
      [first, second],
      { page: 1, page_size: 1 },
      new Date(2026, 8, 22),
    );
    expect(result.reviews.map((item) => item.id)).toEqual(["b"]);
    expect(result.total).toBe(2);
    expect(result.has_more).toBe(true);
    expect(result.confirmed_count).toBe(1);
    expect(result.draft_count).toBe(1);
    expect(result.current_month_weekly_drafts).toBe(1);
  });
  it("filters literal punctuation and existing LIKE wildcards", () => {
    expect(
      paginateLegacyReviews([first, second], { q: "RAII", status: "draft" })
        .total,
    ).toBe(1);
    expect(
      paginateLegacyReviews([first, second], { q: "RA%第二_" }).total,
    ).toBe(1);
    expect(paginateLegacyReviews([first, second], { q: "[" }).total).toBe(0);
  });
  it("uses read-only legacy listing after a missing endpoint", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }))
      .mockResolvedValueOnce(Response.json([first, second]));
    vi.stubGlobal("fetch", fetch);
    const result = await queryReviews({ page_size: 1 });
    expect(result.total).toBe(2);
    expect(fetch.mock.calls[1][0]).toBe("/api/reviews");
  });
  it.each([401, 403, 500])(
    "does not conceal HTTP %i failures",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("failure", { status }));
      vi.stubGlobal("fetch", fetch);
      await expect(queryReviews()).rejects.toMatchObject({ status });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
});
