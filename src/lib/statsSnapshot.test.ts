import { describe, expect, it, vi } from "vitest";
import { loadStatsSnapshot } from "./statsSnapshot";

describe("loadStatsSnapshot", () => {
  it("uses the selected week as the single anchor for weekly stats and reviews", async () => {
    const port = {
      getStatsOverview: vi.fn().mockResolvedValue({}),
      getMonthStats: vi.fn().mockResolvedValue([]),
      getWeekReview: vi.fn().mockResolvedValue({}),
      listReviews: vi.fn().mockResolvedValue([]),
    };

    await loadStatsSnapshot(port, {
      year: 2026,
      month: 7,
      monthFrom: "2026-07-01",
      monthTo: "2026-07-31",
      weekDate: "2026-06-18",
      weekFrom: "2026-06-15",
      weekTo: "2026-06-21",
    });

    expect(port.getWeekReview).toHaveBeenCalledWith("2026-06-18");
    expect(port.listReviews).toHaveBeenCalledWith("weekly", "2026-06-15", "2026-06-21");
  });
});
