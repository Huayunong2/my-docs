import { describe, expect, it, vi } from "vitest";
import { consumeLocalAiTokenFromUrl, isLocalHttpLocation, isLoopbackHostname, isLoopbackHttpUrl } from "./localAiAccess";

describe("local AI access bootstrap", () => {
  it("recognizes only exact loopback hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("localhost.evil.example")).toBe(false);
    expect(isLocalHttpLocation({ protocol: "https:", hostname: "localhost" })).toBe(true);
    expect(isLocalHttpLocation({ protocol: "https:", hostname: "tauri.localhost" })).toBe(false);
    expect(isLoopbackHttpUrl("http://127.0.0.1:5173/api")).toBe(true);
    expect(isLoopbackHttpUrl("https://example.test/api")).toBe(false);
  });

  it("stores the token only from a local URL and removes it from the URL", () => {
    const saveToken = vi.fn(() => true);
    const url = new URL("http://localhost:5173/today?local_ai_token=test-value&date=2026-09-01#main");

    expect(consumeLocalAiTokenFromUrl(url, saveToken)).toBe(true);
    expect(saveToken).toHaveBeenCalledWith("test-value");
    expect(url.toString()).toBe("http://localhost:5173/today?date=2026-09-01#main");
  });

  it("does not persist a token from a non-local URL", () => {
    const saveToken = vi.fn(() => true);
    const url = new URL("https://example.test/today?local_ai_token=test-value");

    expect(consumeLocalAiTokenFromUrl(url, saveToken)).toBe(true);
    expect(saveToken).not.toHaveBeenCalled();
    expect(url.search).toBe("");
  });
});
