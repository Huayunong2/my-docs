import { describe, expect, it } from "vitest";
import { formatReviewMonth, formatReviewTimestamp, reviewBodyContent, reviewExcerpt, reviewPreview } from "./reviewContent";

describe("review list presentation", () => {
  it("turns Markdown structure into a readable excerpt", () => {
    expect(reviewExcerpt("## 标题\n\n### 概览\n\n- 第一条\n- 第二条\n\n**重点**：[文档](https://example.test)"))
      .toBe("标题 概览 第一条 第二条 重点：文档");
  });

  it("keeps code content while removing the fence and truncates by characters", () => {
    expect(reviewExcerpt("```ts\nconst 结果 = true;\n```", 8)).toBe("const 结…");
  });

  it("does not repeat the review title in a card preview", () => {
    const preview = reviewPreview("weekly", "本周复盘", JSON.stringify({ overview: "先看概览" }));
    expect(preview).not.toContain("本周复盘");
    expect(preview).toContain("本周材料概览 先看概览");
  });

  it("removes the generated document title from the full reader body", () => {
    const body = reviewBodyContent("weekly", "本周复盘", JSON.stringify({ overview: "先看概览" }));
    expect(body).not.toMatch(/^##\s/);
    expect(body).toContain("### 本周材料概览");
  });

  it("formats month labels and preserves unparseable timestamps", () => {
    expect(formatReviewMonth("2026-08")).toBe("2026 年 8 月");
    expect(formatReviewMonth("未知月份")).toBe("未知月份");
    expect(formatReviewTimestamp("不是时间")).toBe("不是时间");
  });
});
