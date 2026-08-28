import { describe, expect, it } from "vitest";
import {
  nextExplicitThemeMode,
  resolveDarkTheme,
  themeColorForMode,
  themeModeLabels,
  themeModes,
} from "./theme";

describe("theme state", () => {
  it("keeps system mode tied to the current system preference", () => {
    expect(resolveDarkTheme("system", true)).toBe(true);
    expect(resolveDarkTheme("system", false)).toBe(false);
  });

  it("always honors an explicit light or dark mode", () => {
    expect(resolveDarkTheme("light", true)).toBe(false);
    expect(resolveDarkTheme("dark", false)).toBe(true);
  });

  it("offers all three modes to mobile and settings surfaces", () => {
    expect(themeModes).toEqual(["system", "light", "dark"]);
    expect(themeModeLabels.light).toBe("浅色");
  });

  it("uses a light browser surface color for light mode", () => {
    expect(themeColorForMode(false)).toBe("#eef2f6");
    expect(themeColorForMode(true)).toBe("#11151b");
  });

  it("turns the quick toggle into an explicit persisted mode", () => {
    expect(nextExplicitThemeMode(true)).toBe("light");
    expect(nextExplicitThemeMode(false)).toBe("dark");
  });
});
