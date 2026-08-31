export const themeModes = ["system", "light", "dark"] as const;

export type ThemeMode = (typeof themeModes)[number];
export type ExplicitThemeMode = Exclude<ThemeMode, "system">;

export const themeModeLabels: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

export function resolveDarkTheme(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemDark);
}

export function nextExplicitThemeMode(dark: boolean): ExplicitThemeMode {
  return dark ? "light" : "dark";
}

export function themeColorForMode(dark: boolean): string {
  return dark ? "#11151b" : "#eef2f6";
}

export function colorSchemeForMode(dark: boolean): "only light" | "only dark" {
  return dark ? "only dark" : "only light";
}
