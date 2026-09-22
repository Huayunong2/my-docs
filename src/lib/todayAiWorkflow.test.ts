import { describe, expect, it } from "vitest";
import { matchesAiSource, validKnowledgeCandidate } from "./todayAiWorkflow";

describe("Today AI source snapshots", () => {
  const source = { date: "2026-09-22", content: "Original content" };
  it("accepts the exact date and original content", () => {
    expect(matchesAiSource(source, { ...source })).toBe(true);
  });
  it("does not attach an older day result to the current record", () => {
    expect(matchesAiSource(source, { ...source, date: "2026-09-23" })).toBe(
      false,
    );
  });
  it("invalidates results even after a whitespace edit", () => {
    expect(
      matchesAiSource(source, { ...source, content: source.content + " " }),
    ).toBe(false);
  });
  it("rejects an uninitialized snapshot", () => {
    expect(
      matchesAiSource({ date: "", content: "" }, { date: "", content: "" }),
    ).toBe(false);
  });
});
describe("knowledge candidate validation", () => {
  it("requires both a meaningful title and a body", () => {
    expect(validKnowledgeCandidate({ title: "  ", content: "Body" })).toBe(
      false,
    );
    expect(validKnowledgeCandidate({ title: "Title", content: "\n " })).toBe(
      false,
    );
    expect(validKnowledgeCandidate({ title: "Title", content: "Body" })).toBe(
      true,
    );
  });
});
