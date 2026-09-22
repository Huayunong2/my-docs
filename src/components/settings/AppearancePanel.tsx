import { Check, Monitor, Moon, Sun } from "lucide-react";
import { themeModeLabels, themeModes, type ThemeMode } from "../../lib/theme";
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
}: {
  accentTheme: string;
  onChangeAccentTheme: (theme: string) => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
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
      <p className="wb-muted st-appearance-note">
        <Check size={14} />
        外观修改即时生效，自动保存在当前设备。
      </p>
    </div>
  );
}
