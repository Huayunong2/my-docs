import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("copies through the browser fallback when Clipboard API is unavailable", async () => {
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    };
    const execCommand = vi.fn(() => true);
    const fakeDocument = {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn() },
      execCommand,
    };
    const payload = '{"cards":[{"title":"可复制的知识条目"}]}';

    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", fakeDocument);

    await expect(copyText(payload)).resolves.toBeUndefined();
    expect(textarea.value).toBe(payload);
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalledOnce();
  });

  it("copies through the browser fallback when Clipboard API rejects", async () => {
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    };
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    const execCommand = vi.fn(() => true);
    const fakeDocument = {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn() },
      execCommand,
    };

    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", fakeDocument);

    await expect(copyText("permission fallback")).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith("permission fallback");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalledOnce();
  });
});
