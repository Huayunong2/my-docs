import { afterEach, describe, expect, it, vi } from "vitest";
import { getDueReviewCards, getKnowledgeCard, getKnowledgeSummary, getReviewPreview, getReviewSettings, getReviewStats, gradeReviewCard, queryKnowledgeCards, touchKnowledgeCard, updateReviewSettings } from "./api";

function storage(values: Record<string, string>) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  };
}

function jsonResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("review scheduling API", () => {
  it("loads due cards with limit and maps tags", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      cards: [{ id: "card-1", tags: ["架构", "Rust"] }],
      stats: { due: 1, due_reviews: 1, new_cards: 0, reviewed_today: 2, total_confirmed: 5 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await getDueReviewCards(10);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/review/due?limit=10");
    expect(options.method).toBeUndefined();
    expect(res.cards[0].tags).toEqual(["架构", "Rust"]);
    expect(res.stats.due).toBe(1);
    expect(res.stats.due_reviews).toBe(1);
  });

  it("posts the grade to the card endpoint", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "card-1", tags: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await gradeReviewCard("card-1", "good");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/review/card-1/grade");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ grade: "good" });
  });

  it("posts the touch to the knowledge card endpoint", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "card-1", tags: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await touchKnowledgeCard("card-1");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/knowledge-cards/card-1/touch");
    expect(options.method).toBe("POST");
  });

  it("loads the read-only next-review preview for a card", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { grade: "again", interval_days: 0, next_review_at: "2026-08-26" },
      { grade: "good", interval_days: 4, next_review_at: "2026-08-30" },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const res = await getReviewPreview("card/1", { signal: controller.signal });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/review/card%2F1/preview");
    expect(options.signal).toBe(controller.signal);
    expect(res[1].interval_days).toBe(4);
  });

  it("loads review stats from the stats endpoint", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      total_reviews: 12,
      streak_days: 3,
      reviewed_today: 2,
      due: 5,
      total_confirmed: 20,
      learning: 14,
      mature: 6,
      daily: [{ date: "2026-08-01", count: 2 }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await getReviewStats();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/review/stats");
    expect(res.total_reviews).toBe(12);
    expect(res.streak_days).toBe(3);
    expect(res.daily[0].count).toBe(2);
  });

  it("loads and updates persisted review settings", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ new_cards_per_day: 20, session_limit: 20 }))
      .mockResolvedValueOnce(jsonResponse({ new_cards_per_day: 12, session_limit: 8 }));
    vi.stubGlobal("fetch", fetchMock);

    const current = await getReviewSettings();
    const next = await updateReviewSettings({ new_cards_per_day: 12, session_limit: 8 });

    expect(current.session_limit).toBe(20);
    expect(next.new_cards_per_day).toBe(12);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/review/settings");
    expect(fetchMock.mock.calls[1][0]).toBe("https://example.test/api/review/settings");
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ new_cards_per_day: 12, session_limit: 8 });
  });

  it("passes an abort signal through paginated knowledge queries", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      cards: [],
      total: 0,
      page: 2,
      page_size: 24,
      has_more: false,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await queryKnowledgeCards({ q: "中文", quality: "missing_source", page: 2, page_size: 24, sort: "updated" }, { signal: controller.signal });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/knowledge-cards/query?q=%E4%B8%AD%E6%96%87&quality=missing_source&sort=updated&page=2&page_size=24");
    expect(options.signal).toBe(controller.signal);
  });

  it("loads a knowledge detail and its aggregate summary independently", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "card/1", tags: ["Rust"], projects: ["架构"] }))
      .mockResolvedValueOnce(jsonResponse({ total: 3, draft: 1, confirmed: 1, outdated: 1, missing_source: 1, missing_project: 1, missing_tags: 1, short_content: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const card = await getKnowledgeCard("card/1");
    const summary = await getKnowledgeSummary();

    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/knowledge-cards/card%2F1");
    expect(card.projects).toEqual(["架构"]);
    expect(summary.total).toBe(3);
    expect(fetchMock.mock.calls[1][0]).toBe("https://example.test/api/knowledge-cards/summary");
  });

  it("scopes a knowledge summary to the selected space", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      total: 1,
      draft: 0,
      confirmed: 1,
      outdated: 0,
      missing_source: 0,
      missing_project: 0,
      missing_tags: 0,
      short_content: 0,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await getKnowledgeSummary("C++");

    expect(summary.total).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/knowledge-cards/summary?project=C%2B%2B");
  });
});
