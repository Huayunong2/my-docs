import { describe, expect, it } from "vitest";
import { nextKnowledgeCardStatus } from "./knowledgeStatus";

describe("knowledge entry status quick action", () => {
  it("confirms drafts and restores outdated entries", () => {
    expect(nextKnowledgeCardStatus("draft")).toBe("confirmed");
    expect(nextKnowledgeCardStatus("outdated")).toBe("confirmed");
  });

  it("marks confirmed entries as outdated", () => {
    expect(nextKnowledgeCardStatus("confirmed")).toBe("outdated");
  });
});
