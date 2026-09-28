import { describe, expect, it } from "vitest";
import {
  builtInWallpaperPresets,
  defaultWallpaperPreferences,
  findWallpaperPreset,
  wallpaperModules,
  wallpaperSurfaces,
} from "./wallpapers";

describe("wallpaper project defaults", () => {
  it("restore every page and component to its plain default background", () => {
    const defaults = defaultWallpaperPreferences();

    for (const { id: module } of wallpaperModules) {
      expect(defaults[module].wallpaperIds, module).toEqual([]);
    }
    for (const { id, module } of wallpaperSurfaces) {
      expect(defaults[module].surfaces[id]?.wallpaperIds, id).toEqual([]);
    }
  });
});

describe("wallpaper preset lookup", () => {
  it("resolves a built-in preset even when the server has no saved presets", () => {
    const builtInPreset = builtInWallpaperPresets[0];

    expect(findWallpaperPreset(builtInPreset.id, [])).toEqual(builtInPreset);
  });
});
