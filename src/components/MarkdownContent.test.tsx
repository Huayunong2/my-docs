import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarkdownContent from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders C++ fences with highlight tokens while keeping the language label", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent content={"```cpp\n#include <iostream>\nint main() { return 0; }\n```"} />,
    );

    expect(markup).toContain('data-language="cpp"');
    expect(markup).toContain("hljs");
    expect(markup).toContain("include");
  });

  it("shows a repair action for malformed fences without changing content", () => {
    const onRepairContent = () => undefined;
    const markup = renderToStaticMarkup(
      <MarkdownContent content={"1```cpp\nint main() {}"} onRepairContent={onRepairContent} />,
    );

    expect(markup).toContain("Markdown 围栏需要修复");
    expect(markup).toContain("应用修复");
  });

  it("uses a read-only copy action when no repair callback is supplied", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent content={"```cpp\nint main() {}"} />,
    );

    expect(markup).toContain("复制修正版");
  });

  it("keeps an unknown language readable instead of guessing", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent content={"```not-a-real-language\nplain text\n```"} />,
    );

    expect(markup).toContain('data-language="not-a-real-language"');
    expect(markup).toContain("plain text");
  });
});
