import { describe, expect, it, vi } from "vitest";
import type { Review } from "./api";
import { generateReviewVersion, upsertReviewVersion } from "./reviewGeneration";

const generated: Review = {
  id: "review-2",
  kind: "weekly",
  period_start: "2026-07-13",
  period_end: "2026-07-19",
  version: 2,
  status: "draft",
  title: "第二版",
  content: "内容",
  source_article_ids: [],
  source_review_ids: [],
  model: "mock",
  generated_at: "2026-07-16T00:00:00",
  updated_at: "2026-07-16T00:00:00",
};

describe("review generation workflow", () => {
  it("starts the AI request immediately and returns the generated version", async () => {
    const generateReview = vi.fn().mockResolvedValue(generated);

    const result = generateReviewVersion(
      { generateReview },
      { kind: "weekly", date: "2026-07-16" },
      () => true,
    );

    expect(generateReview).toHaveBeenCalledOnce();
    await expect(result).resolves.toEqual(generated);
  });

  it("merges the returned version without duplicating an existing id", () => {
    const old = { ...generated, id: "review-1", version: 1 };
    expect(upsertReviewVersion([old], generated)).toEqual([generated, old]);
    expect(upsertReviewVersion([old, generated], { ...generated, title: "更新" }))
      .toEqual([{ ...generated, title: "更新" }, old]);
  });

  it("does not apply a result after the page becomes inactive", async () => {
    let resolve!: (review: Review) => void;
    let active = true;
    const pending = new Promise<Review>((done) => { resolve = done; });
    const result = generateReviewVersion(
      { generateReview: vi.fn().mockReturnValue(pending) },
      { kind: "weekly", date: "2026-07-16" },
      () => active,
    );
    active = false;
    resolve(generated);

    await expect(result).resolves.toBeNull();
  });
});
