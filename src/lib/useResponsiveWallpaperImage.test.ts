import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWallpaperImage, wallpaperImageVariantForWidth } from "./useResponsiveWallpaperImage";

function storage(values: Record<string, string>) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("responsive wallpaper loading", () => {
  it("uses the layout breakpoint for desktop and mobile variants", () => {
    expect(wallpaperImageVariantForWidth(767)).toBe("mobile");
    expect(wallpaperImageVariantForWidth(768)).toBe("desktop");
  });

  it("requests just the selected variant with its cache version", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://summary.test/api", api_token: "secret-test-token" }));
    const blob = new Blob([new Uint8Array([7])], { type: "image/webp" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadWallpaperImage("river", "version-4", "mobile")).resolves.toBe(blob);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://summary.test/api/wallpapers/assets/river/mobile?v=version-4");
  });
});
