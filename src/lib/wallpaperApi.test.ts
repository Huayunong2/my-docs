import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFullPackage, getWallpaperAssetFile, getWallpaperSnapshot, importFullPackage, migrateLocalWallpaperState, uploadWallpaperAsset } from "./api";
import type { WallpaperAssetDraft } from "./wallpapers";

function storage(values: Record<string, string>) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  };
}

function jsonResponse(value: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(value) };
}

afterEach(() => vi.unstubAllGlobals());

describe("wallpaper server API", () => {
  it("loads the server-owned snapshot through the authenticated API", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://summary.test/api", api_token: "secret-test-token" }));
    const snapshot = {
      revision: 4,
      storageUsedBytes: 64,
      storageQuotaBytes: 256 * 1024 * 1024,
      preferences: {},
      assets: [],
      presets: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getWallpaperSnapshot()).resolves.toEqual(snapshot);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://summary.test/api/wallpapers");
    expect(options.headers.get("Authorization")).toBe("Bearer secret-test-token");
  });

  it("uploads both device variants as multipart without overriding the browser boundary", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://summary.test/api", api_token: "secret-test-token" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ revision: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
    const asset: WallpaperAssetDraft = {
      metadata: {
        id: "wallpaper-pair",
        name: "海边",
        createdAt: 1,
        originalBytes: 6,
        optimizedBytes: 6,
        desktopWidth: 3,
        desktopHeight: 2,
        mobileWidth: 2,
        mobileHeight: 3,
        desktopThumbnailBytes: 3,
        mobileThumbnailBytes: 3,
        desktopName: "desktop.webp",
        mobileName: "mobile.webp",
      },
      files: { id: "wallpaper-pair", desktopBlob: blob, mobileBlob: blob },
      thumbnails: { id: "wallpaper-pair", desktopThumbnailBlob: blob, mobileThumbnailBlob: blob },
    };

    await uploadWallpaperAsset(asset, 1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://summary.test/api/wallpapers/assets");
    expect(options.headers.get("Authorization")).toBe("Bearer secret-test-token");
    expect(options.headers.has("Content-Type")).toBe(false);
    expect(options.body.get("metadata")).toContain('"expectedRevision":1');
    expect(options.body.get("desktop")).toBeInstanceOf(Blob);
    expect(options.body.get("mobile")).toBeInstanceOf(Blob);
  });

  it("submits a confirmed local migration as one authenticated multipart request", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://summary.test/api", api_token: "secret-test-token" }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ revision: 8 }));
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
    const asset: WallpaperAssetDraft = {
      metadata: { id: "local-1", name: "本机图", createdAt: 1, originalBytes: 3, optimizedBytes: 3, desktopWidth: 3, desktopHeight: 2 },
      files: { id: "local-1", desktopBlob: blob },
      thumbnails: { id: "local-1", desktopThumbnailBlob: blob },
    };
    await migrateLocalWallpaperState({ migrationId: "migration-1", preferences: {} as never, presets: [], assets: [asset] }, 7);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://summary.test/api/wallpapers/migrate-local");
    expect(options.headers.get("Authorization")).toBe("Bearer secret-test-token");
    expect(options.body.get("manifest")).toContain('"expectedRevision":7');
    expect(options.body.get("asset-0-desktop")).toBeInstanceOf(Blob);
    expect(options.body.get("asset-0-desktop-thumbnail")).toBeInstanceOf(Blob);
  });

  it("downloads and imports full packages through authenticated ZIP endpoints", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://summary.test/api", api_token: "secret-test-token" }));
    const file = new File([new Uint8Array([1, 2, 3])], "full.zip", { type: "application/zip" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, blob: () => Promise.resolve(file) })
      .mockResolvedValueOnce(jsonResponse({ snapshotName: "pre-full-package.db" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadFullPackage()).resolves.toBe(file);
    await importFullPackage(file, 17);

    const [downloadUrl, downloadOptions] = fetchMock.mock.calls[0];
    expect(downloadUrl).toBe("https://summary.test/api/export/full-package");
    expect(downloadOptions.headers.get("Authorization")).toBe("Bearer secret-test-token");
    const [importUrl, importOptions] = fetchMock.mock.calls[1];
    expect(importUrl).toBe("https://summary.test/api/import/full-package?revision=17");
    expect(importOptions.headers.get("Authorization")).toBe("Bearer secret-test-token");
    expect(importOptions.headers.get("Content-Type")).toBe("application/zip");
    expect(importOptions.body).toBe(file);
  });

  it("fetches protected image bytes through the shared API auth helper", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("localStorage", storage({ server_url: "https://summary.test/api", api_token: "secret-test-token" }));
    const blob = new Blob([new Uint8Array([4, 5])], { type: "image/webp" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(blob) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getWallpaperAssetFile("anime-night", "mobile")).resolves.toBe(blob);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://summary.test/api/wallpapers/assets/anime-night/mobile");
    expect(options.headers.get("Authorization")).toBe("Bearer secret-test-token");
  });
});
