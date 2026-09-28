import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readFullPackageManifest, validateFullPackageManifest } from "./fullPackage";

describe("full wallpaper migration package preview", () => {
  it("reads only the versioned manifest from a ZIP stream", async () => {
    const manifest = {
      formatVersion: 1,
      dataFile: "data.json",
      summary: { articleCount: 1, reviewCount: 0, knowledgeCount: 0, dateRange: "2026-09-28" },
      preferences: { stats: {} },
      presets: [{ id: "preset-1" }],
      assets: [{ metadata: { name: "夜色" } }],
    };
    const zipped = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "wallpapers/assets/0/desktop": new Uint8Array([1, 2, 3]),
    });

    const value = await readFullPackageManifest(new Blob([zipped]));
    expect(validateFullPackageManifest(value)).toMatchObject({
      formatVersion: 1,
      assets: [{ metadata: { name: "夜色" } }],
      presets: [{ id: "preset-1" }],
    });
  });

  it("rejects unsupported package versions and ZIPs without a manifest", async () => {
    const zipped = zipSync({
      "manifest.json": strToU8(JSON.stringify({ formatVersion: 2, dataFile: "data.json", summary: { articleCount: 0, reviewCount: 0, knowledgeCount: 0, dateRange: "未标注日期" }, preferences: {}, assets: [], presets: [] })),
    });
    const value = await readFullPackageManifest(new Blob([zipped]));
    expect(() => validateFullPackageManifest(value)).toThrow("不支持此迁移包版本");

    const noManifest = zipSync({ "other.txt": strToU8("x") });
    await expect(readFullPackageManifest(new Blob([noManifest]))).rejects.toThrow("没有迁移包清单");
  });
});
