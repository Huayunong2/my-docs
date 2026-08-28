import { afterEach, describe, expect, it, vi } from "vitest";
import { getAiConfig, getAiRouting, updateAiConfig, updateAiRouting } from "./api";

function storage(values: Record<string, string>) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  };
}

function jsonResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("AI configuration API", () => {
  it("loads the non-sensitive AI configuration without an API key", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api", server_token: "server-token" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      configured: true,
      api_key_configured: true,
      api_key_source: "environment",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 0,
      timeout_secs: 45,
      retries: 2,
      min_interval_ms: 1200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const config = await getAiConfig();

    expect(config.api_key_source).toBe("environment");
    expect(config.model).toBe("gpt-4o-mini");
    expect(Object.prototype.hasOwnProperty.call(config, "api_key")).toBe(false);
  });

  it("sends a replacement API key only when the user provides one", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      configured: true,
      api_key_configured: true,
      api_key_source: "settings",
      base_url: "https://example.test/v1",
      model: "local-model",
      temperature: 0.4,
      max_tokens: 1024,
      timeout_secs: 60,
      retries: 1,
      min_interval_ms: 0,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await updateAiConfig({
      api_key: "new-secret",
      base_url: "https://example.test/v1",
      model: "local-model",
      temperature: 0.4,
      max_tokens: 1024,
      timeout_secs: 60,
      retries: 1,
      min_interval_ms: 0,
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/ai/config");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body)).toMatchObject({ api_key: "new-secret", model: "local-model" });
  });

  it("loads and saves task-to-profile routes without mixing in credentials", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://example.test/api" }));
    const routing = {
      profiles: [{
        id: "fast",
        name: "快速模型",
        model: "deepseek-flash",
        temperature: 0.2,
        max_tokens: 0,
        timeout_secs: 45,
        retries: 2,
        min_interval_ms: 1200,
      }],
      routes: { daily_summary: "fast" },
      fallback_profile: "fast",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(routing))
      .mockResolvedValueOnce(jsonResponse(routing));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAiRouting()).resolves.toEqual(routing);
    await updateAiRouting(routing);

    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe("https://example.test/api/ai/routing");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body)).toEqual(routing);
    expect(JSON.parse(options.body)).not.toHaveProperty("api_key");
  });
});
