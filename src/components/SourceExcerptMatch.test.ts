import { describe, expect, it } from "vitest";
import { findSourceExcerptMatch } from "./SourceExcerptMatch";

describe("findSourceExcerptMatch", () => {
  it("matches whitespace differences while preserving original text", () => {
    const match = findSourceExcerptMatch("来源片段\n会保留原文格式。", "来源 片段 会保留");

    expect(match?.matched).toBe("来源片段\n会保留");
    expect(match?.before).toBe("");
  });

  it("returns null when the excerpt is not present", () => {
    expect(findSourceExcerptMatch("真实来源", "不存在的片段")).toBeNull();
  });
});
