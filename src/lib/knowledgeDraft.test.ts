import { beforeEach, describe, expect, it } from "vitest";
import { readKnowledgeDraft, removeKnowledgeDraft, writeKnowledgeDraft } from "./knowledgeDraft";

describe("knowledge draft storage", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem">,
    });
  });

  it("round-trips a draft by card id", () => {
    const draft = { title: "标题", content: "正文" };
    expect(writeKnowledgeDraft("card-1", { draft, relatedIds: ["card-2"], baseUpdatedAt: "2026-08-31T10:00:00" })).toBe(true);
    expect(readKnowledgeDraft<typeof draft>("card-1")).toMatchObject({
      cardId: "card-1",
      draft,
      relatedIds: ["card-2"],
      baseUpdatedAt: "2026-08-31T10:00:00",
    });
  });

  it("ignores malformed data and can remove a new-card draft", () => {
    globalThis.localStorage.setItem("daily-summary:knowledge-draft:new", "not-json");
    expect(readKnowledgeDraft("new")).toBeNull();
    writeKnowledgeDraft(null, { draft: { title: "新卡" }, relatedIds: [] });
    expect(readKnowledgeDraft(null)?.draft).toEqual({ title: "新卡" });
    removeKnowledgeDraft(null);
    expect(readKnowledgeDraft(null)).toBeNull();
  });
});
