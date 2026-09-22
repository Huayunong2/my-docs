import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isKnowledgeShortcut,
  knowledgeDate,
  knowledgeExcerpt,
} from "./knowledgePresentation";

describe("knowledgeExcerpt", () => {
  it("renders a readable preview without altering stored Markdown", () => {
    const source = "# 标题\n\n- **结论**与[依据](https://example.test)\n> 引用";
    expect(knowledgeExcerpt(source)).toBe("标题 结论与依据 引用");
    expect(source).toContain("**结论**");
  });
  it("keeps code identifiers and removes fenced language markers", () => {
    expect(
      knowledgeExcerpt("```cpp\nauto unique_ptr = make_unique();\n```"),
    ).toBe("auto unique_ptr = make_unique();");
  });
  it("truncates Unicode without splitting surrogate pairs", () => {
    expect(knowledgeExcerpt("甲😀乙丙", 2)).toBe("甲😀…");
  });
  it("handles short and empty content", () => {
    expect(knowledgeExcerpt("短句", 2)).toBe("短句");
    expect(knowledgeExcerpt("  \n ")).toBe("");
  });
});
describe("knowledgeDate", () => {
  it("preserves the server date without a timezone shift", () => {
    expect(knowledgeDate("2026-09-22T00:01:00+08:00")).toBe("2026.09.22");
    expect(knowledgeDate("2026-09-22")).toBe("2026.09.22");
  });
  it("handles missing and malformed dates", () => {
    expect(knowledgeDate()).toBe("未记录");
    expect(knowledgeDate("invalid")).toBe("未记录");
  });
});
describe("knowledge keyboard shortcuts", () => {
  const event = {
    target: null,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  };
  afterEach(() => vi.unstubAllGlobals());
  it("does not intercept an IME or platform shortcut", () => {
    expect(isKnowledgeShortcut({ ...event, isComposing: true })).toBe(false);
    expect(isKnowledgeShortcut({ ...event, ctrlKey: true })).toBe(false);
    expect(isKnowledgeShortcut({ ...event, metaKey: true })).toBe(false);
    expect(isKnowledgeShortcut({ ...event, altKey: true })).toBe(false);
  });
  it("allows unmodified shortcuts outside editable elements", () => {
    expect(isKnowledgeShortcut(event)).toBe(true);
  });
  it("excludes editable fields and dialogs", () => {
    class FakeElement {
      closest(selector: string) {
        return selector.includes('[role="dialog"]') ? this : null;
      }
    }
    vi.stubGlobal("Element", FakeElement);
    expect(
      isKnowledgeShortcut({
        ...event,
        target: new FakeElement() as unknown as EventTarget,
      }),
    ).toBe(false);
  });
});

describe("technical knowledge previews", () => {
  it("preserves C++ template parameters and comparisons", () => {
    expect(knowledgeExcerpt("`std::vector<int>`：a < b && c > d")).toBe(
      "std::vector<int>：a < b && c > d",
    );
  });
  it("removes actual HTML wrappers without losing their text", () => {
    expect(
      knowledgeExcerpt('<p class="note">结论</p><br><strong>依据</strong>'),
    ).toBe("结论 依据");
  });
});
