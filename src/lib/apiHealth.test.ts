import { afterEach, describe, expect, it, vi } from "vitest";
import { healthCheck, isLoopbackServerUrl, validateServerUrl } from "./api";
import { LOCAL_AI_TOKEN_SESSION_KEY } from "./localAiAccess";

function storage(values: Record<string, string>) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("healthCheck", () => {
  it("recognizes IPv6 loopback without warning that it is a public HTTP server", () => {
    vi.stubGlobal("window", { location: new URL("http://[::1]:5173/settings") });

    expect(isLoopbackServerUrl("http://[::1]:8080/api")).toBe(true);
    expect(validateServerUrl("http://[::1]:8080/api")).toBe("");
    expect(validateServerUrl("http://192.0.2.10:8080/api")).toContain("不会加密传输");
  });

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

  it("uses the URL-bootstrap token only for a loopback API", async () => {
    vi.stubGlobal("window", { location: new URL("http://127.0.0.1:5173/today") });
    vi.stubGlobal("localStorage", storage({ server_url: "http://127.0.0.1:8080/api" }));
    vi.stubGlobal("sessionStorage", storage({ [LOCAL_AI_TOKEN_SESSION_KEY]: "local-test-token" }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: "1.0.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await healthCheck();

    const [, options] = fetchMock.mock.calls[0];
    expect((options.headers as Headers).get("Authorization")).toBe("Bearer local-test-token");
  });

  it("does not send the local URL-bootstrap token to a remote API", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, location: new URL("http://127.0.0.1:5173/today") });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    vi.stubGlobal("sessionStorage", storage({ [LOCAL_AI_TOKEN_SESSION_KEY]: "local-test-token" }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: "1.0.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await healthCheck();

    const [, options] = fetchMock.mock.calls[0];
    expect((options.headers as Headers).get("Authorization")).toBeNull();
  });

  it("does not treat a protocol-relative remote API as local", async () => {
    vi.stubGlobal("window", { location: new URL("http://127.0.0.1:5173/today") });
    vi.stubGlobal("localStorage", storage({ server_url: "//example.test/api" }));
    vi.stubGlobal("sessionStorage", storage({ [LOCAL_AI_TOKEN_SESSION_KEY]: "local-test-token" }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: "1.0.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await healthCheck();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("//example.test/api/health");
    expect((options.headers as Headers).get("Authorization")).toBeNull();
  });
});
