import { describe, expect, it } from "vitest";
import { inspectMarkdownFences, repairMarkdownFences } from "./markdownFences";

describe("markdown fence diagnostics", () => {
  it("leaves a valid C++ fence untouched", () => {
    const content = "```cpp\n#include <iostream>\n```";
    expect(inspectMarkdownFences(content)).toEqual([]);
    expect(repairMarkdownFences(content).fixedContent).toBe(content);
  });

  it("detects and removes a numeric prefix before a fence", () => {
    const content = "1```cpp\nint main() {}\n```";
    const result = repairMarkdownFences(content);

    expect(result.issues.map((issue) => issue.kind)).toEqual(["prefixed-fence"]);
    expect(result.fixedContent).toBe("```cpp\nint main() {}\n```");
    expect(inspectMarkdownFences(result.fixedContent)).toEqual([]);
  });

  it("adds a matching closing fence while preserving LF without a trailing newline", () => {
    const content = "```cpp\nint main() {}";
    const result = repairMarkdownFences(content);

    expect(result.issues.map((issue) => issue.kind)).toEqual(["unclosed-fence"]);
    expect(result.fixedContent).toBe("```cpp\nint main() {}\n```");
    expect(inspectMarkdownFences(result.fixedContent)).toEqual([]);
  });

  it("preserves CRLF and a final newline", () => {
    const content = "```cpp\r\nint main() {}\r\n";
    expect(repairMarkdownFences(content).fixedContent).toBe("```cpp\r\nint main() {}\r\n```\r\n");
  });

  it("does not flag inline code or ordinary prose", () => {
    const content = "Use ````cpp` as an example.\nA numbered item 1``` is prose.";
    expect(inspectMarkdownFences(content)).toEqual([]);
  });

  it("does not inspect fence-like lines inside an already open block", () => {
    const content = "```text\n1```cpp\n```";
    expect(inspectMarkdownFences(content)).toEqual([]);
  });

  it("is idempotent", () => {
    const content = "1```cpp\nint main() {}";
    const repaired = repairMarkdownFences(content).fixedContent;
    expect(repairMarkdownFences(repaired).fixedContent).toBe(repaired);
  });
});
