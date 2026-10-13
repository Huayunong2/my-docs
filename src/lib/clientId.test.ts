import { afterEach, describe, expect, it, vi } from "vitest";
import { newClientId } from "./clientId";

afterEach(() => vi.unstubAllGlobals());
describe("client IDs in HTTP deployments", () => {
  it("opens new workflows without the secure-context-only randomUUID method", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
    expect(newClientId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });
  it("generates independent UUIDs for distinct requests", () => {
    const values = Array.from({ length: 100 }, newClientId);
    expect(new Set(values).size).toBe(100);
    expect(values.every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))).toBe(true);
  });
});
