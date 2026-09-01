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

    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", fakeDocument);

    await expect(copyText(payload)).resolves.toBeUndefined();
    expect(textarea.value).toBe(payload);
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalledOnce();
  });

  it("keeps the legacy fallback synchronous on an insecure page", async () => {
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

    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", fakeDocument);

    await expect(copyText("permission fallback")).resolves.toBeUndefined();
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalledOnce();
  });

  it("does not report success after a secure Clipboard API rejection", async () => {
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

    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", fakeDocument);

    await expect(copyText("rejected copy")).rejects.toThrow("clipboard unavailable");
    expect(writeText).toHaveBeenCalledWith("rejected copy");
    expect(execCommand).not.toHaveBeenCalled();
    expect(textarea.remove).not.toHaveBeenCalled();
  });
});
