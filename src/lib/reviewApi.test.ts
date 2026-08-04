import { afterEach, describe, expect, it, vi } from "vitest";
import { getDueReviewCards, gradeReviewCard, touchKnowledgeCard } from "./api";

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
      stats: { due: 1, reviewed_today: 2, total_confirmed: 5 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await getDueReviewCards(10);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/review/due?limit=10");
    expect(options.method).toBeUndefined();
    expect(res.cards[0].tags).toEqual(["架构", "Rust"]);
    expect(res.stats.due).toBe(1);
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
});
