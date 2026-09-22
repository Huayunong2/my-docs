import { describe, expect, it } from "vitest";
import {
  hasIncompleteImportCandidates,
  importFileError,
} from "./importWorkflow";

describe("import file guidance", () => {
  it.each(["note.md", "NOTE.MARKDOWN", "笔记.txt"])(
    "accepts local text source %s",
    (name) => {
      expect(importFileError({ name, size: 100 }, "ai")).toBe("");
    },
  );
  it("reserves JSON for the structured manual parser", () => {
    expect(importFileError({ name: "cards.json", size: 100 }, "manual")).toBe(
      "",
    );
    expect(importFileError({ name: "cards.json", size: 100 }, "ai")).not.toBe(
      "",
    );
  });
  it("does not pretend to support binary documents", () => {
    expect(importFileError({ name: "file.pdf", size: 100 }, "manual")).not.toBe(
      "",
    );
  });
  it("rejects oversized files without rejecting the exact size boundary", () => {
    expect(importFileError({ name: "file.md", size: 8_000_000 }, "ai")).toBe(
      "",
    );
    expect(
      importFileError({ name: "file.md", size: 8_000_001 }, "ai"),
    ).toContain("8 MB");
  });
});
describe("edited candidate validation", () => {
  it("accepts a complete selection", () => {
    expect(
      hasIncompleteImportCandidates([{ title: "结论", content: "方法与依据" }]),
    ).toBe(false);
  });
  it("blocks whitespace-only titles or content without silently deleting rows", () => {
    const cards = [
      { title: " \n", content: "正文" },
      { title: "标题", content: "\t" },
    ];
    expect(hasIncompleteImportCandidates(cards)).toBe(true);
    expect(cards).toHaveLength(2);
  });
});
