import { describe, expect, it } from "vitest";
import {
  defaultWallpaperPreferences,
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
