import { Check, Monitor, Moon, Sun } from "lucide-react";
import { themeModeLabels, themeModes, type ThemeMode } from "../../lib/theme";
import {
  type WallpaperApplyMode,
  type WallpaperAssetDraft,
  type WallpaperAssetMetadata,
  type WallpaperAssignmentTargetId,
  type WallpaperPreferenceValue,
  type WallpaperPreferences,
  type WallpaperPreset,
} from "../../lib/wallpapers";
import WallpaperManagerPanel from "./WallpaperManagerPanel";

const themes = [
  { id: "", name: "靛蓝", color: "#6366f1" },
  { id: "violet", name: "紫罗兰", color: "#8b5cf6" },
  { id: "blue", name: "晴蓝", color: "#3b82f6" },
  { id: "emerald", name: "翡翠绿", color: "#10b981" },
  { id: "rose", name: "玫瑰红", color: "#f43f5e" },
  { id: "cyan", name: "青色", color: "#06b6d4" },
];
const icons = { system: Monitor, light: Sun, dark: Moon };

export default function AppearancePanel({
  accentTheme,
  onChangeAccentTheme,
  themeMode,
  onChangeThemeMode,
  wallpaperPreferences,
  wallpaperPreferencesReady,
  wallpaperStorageError,
  wallpaperAssets,
  wallpaperPresets,
  onChangeWallpaperPreference,
  onApplyWallpaperAssets,
  onAddWallpaperAsset,
  onDeleteWallpaperAssets,
  onSaveWallpaperPreset,
  onRenameWallpaperPreset,
  onDeleteWallpaperPreset,
  onApplyWallpaperPreset,
  onResetWallpaper,
}: {
  accentTheme: string;
  onChangeAccentTheme: (theme: string) => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
  wallpaperPreferences: WallpaperPreferences;
  wallpaperPreferencesReady: boolean;
  wallpaperStorageError: string | null;
  wallpaperAssets: WallpaperAssetMetadata[];
  wallpaperPresets: WallpaperPreset[];
  onChangeWallpaperPreference: (
    target: WallpaperAssignmentTargetId,
    preference: WallpaperPreferenceValue,
  ) => Promise<boolean>;
  onApplyWallpaperAssets: (
    targets: WallpaperAssignmentTargetId[],
    wallpaperIds: string[],
    mode: WallpaperApplyMode,
  ) => Promise<boolean>;
  onAddWallpaperAsset: (asset: WallpaperAssetDraft) => Promise<boolean>;
  onDeleteWallpaperAssets: (wallpaperIds: string[]) => Promise<boolean>;
  onSaveWallpaperPreset: (name: string, presetId?: string) => Promise<boolean>;
  onRenameWallpaperPreset: (presetId: string, name: string) => Promise<boolean>;
  onDeleteWallpaperPreset: (presetId: string) => Promise<boolean>;
  onApplyWallpaperPreset: (presetId: string | null) => Promise<boolean>;
  onResetWallpaper: (target: WallpaperAssignmentTargetId) => Promise<boolean>;
}) {
  return (
    <div className="settings-appearance-workspace">
      <section className="wb-panel st-appearance-section">
        <div className="st-section-copy">
          <h3>显示模式</h3>
          <p>在不同光线下保持舒适阅读。跟随系统会自动适配设备设置。</p>
        </div>
        <div className="st-mode-grid" role="group" aria-label="显示模式">
          {themeModes.map((id) => {
            const Icon = icons[id];
            return (
              <button
                key={id}
                type="button"
                className="st-mode"
                data-mode={id}
                aria-pressed={themeMode === id}
                onClick={() => onChangeThemeMode(id)}
              >
                <span className="st-mode-preview" aria-hidden="true">
                  <i />
                  <span>
                    <b />
                    <em />
                    <em />
                    <em />
                  </span>
                </span>
                <span className="st-mode-label">
                  <Icon size={16} />
                  {themeModeLabels[id]}
                  {themeMode === id && <Check size={15} />}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="wb-panel st-appearance-section">
        <div className="st-section-copy">
          <h3>强调色</h3>
          <p>只改变交互与选中状态，页面底色保持一致。</p>
        </div>
        <div className="st-color-grid" role="group" aria-label="主题色">
          {themes.map((theme) => (
            <button
              key={theme.id || "default"}
              type="button"
              aria-pressed={accentTheme === theme.id}
              onClick={() => onChangeAccentTheme(theme.id)}
            >
              <span style={{ backgroundColor: theme.color }} />
              {theme.name}
              {accentTheme === theme.id && <Check size={14} />}
            </button>
          ))}
        </div>
      </section>
      <WallpaperManagerPanel
        wallpaperPreferences={wallpaperPreferences}
        wallpaperPreferencesReady={wallpaperPreferencesReady}
        wallpaperStorageError={wallpaperStorageError}
        wallpaperAssets={wallpaperAssets}
        wallpaperPresets={wallpaperPresets}
        onChangeWallpaperPreference={onChangeWallpaperPreference}
        onApplyWallpaperAssets={onApplyWallpaperAssets}
        onAddWallpaperAsset={onAddWallpaperAsset}
        onDeleteWallpaperAssets={onDeleteWallpaperAssets}
        onSaveWallpaperPreset={onSaveWallpaperPreset}
        onRenameWallpaperPreset={onRenameWallpaperPreset}
        onDeleteWallpaperPreset={onDeleteWallpaperPreset}
        onApplyWallpaperPreset={onApplyWallpaperPreset}
        onResetWallpaper={onResetWallpaper}
      />
    </div>
  );
}
