import { afterEach, describe, expect, it, vi } from "vitest";
import { healthCheck } from "./api";

function storage(values: Record<string, string>) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("healthCheck", () => {
  it("uses the configured API server and authenticates detailed health requests", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({
      server_url: "https://example.test/api",
      server_token: "secret-token",
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: "1.0.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await healthCheck();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/health");
    expect((options.headers as Headers).get("Authorization")).toBe("Bearer secret-token");
  });

  it("does not fall back to somebody else's server on an unconfigured desktop", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({}));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => healthCheck()).toThrow("桌面端尚未配置服务器地址");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
