import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Check,
  ImagePlus,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
} from "lucide-react";
import { themeModeLabels, themeModes, type ThemeMode } from "../../lib/theme";
import {
  defaultWallpaperPreference,
  loadWallpaperImage,
  normalizeWallpaperPreference,
  wallpaperModules,
  type WallpaperImageTarget,
  type WallpaperModule,
  type WallpaperPreference,
  type WallpaperPreferences,
} from "../../lib/wallpapers";

const themes = [
  { id: "", name: "靛蓝", color: "#6366f1" },
  { id: "violet", name: "紫罗兰", color: "#8b5cf6" },
  { id: "blue", name: "晴蓝", color: "#3b82f6" },
  { id: "emerald", name: "翡翠绿", color: "#10b981" },
  { id: "rose", name: "玫瑰红", color: "#f43f5e" },
  { id: "cyan", name: "青色", color: "#06b6d4" },
];
const icons = { system: Monitor, light: Sun, dark: Moon };
const desktopWallpaper = "/backgrounds/stats-overview-desktop.png";
const mobileWallpaper = "/backgrounds/stats-overview-mobile.png";
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 20 * 1024 * 1024;
const maxImagePixels = 16_777_216;
const maxImageEdge = 8192;

async function validateWallpaperFile(file: File) {
  if (!acceptedImageTypes.has(file.type)) {
    throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
  }
  if (file.size > maxImageBytes) {
    throw new Error("单张壁纸不能超过 20 MiB。");
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      image.naturalWidth > maxImageEdge ||
      image.naturalHeight > maxImageEdge ||
      image.naturalWidth * image.naturalHeight > maxImagePixels
    ) {
      throw new Error("图片分辨率过大；请使用每边不超过 8192 像素、总像素不超过 16 MP 的图片。");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("图片分辨率过大")) {
      throw error;
    }
    throw new Error("无法读取这张图片，请换一张 PNG、JPEG 或 WebP 图片。");
  } finally {
    URL.revokeObjectURL(url);
  }
}

type CustomWallpaperPreview = {
  desktopUrl: string;
  mobileUrl: string;
  desktopName?: string;
  mobileName?: string;
};

type Feedback = { kind: "error" | "success"; text: string } | null;

export default function AppearancePanel({
  accentTheme,
  onChangeAccentTheme,
  themeMode,
  onChangeThemeMode,
  wallpaperPreferences,
  onChangeWallpaperPreference,
  onSaveWallpaperImage,
  onResetWallpaper,
}: {
  accentTheme: string;
  onChangeAccentTheme: (theme: string) => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
  wallpaperPreferences: WallpaperPreferences;
  onChangeWallpaperPreference: (
    module: WallpaperModule,
    preference: WallpaperPreference,
  ) => Promise<boolean>;
  onSaveWallpaperImage: (
    module: WallpaperModule,
    target: WallpaperImageTarget,
    file: File,
  ) => Promise<boolean>;
  onResetWallpaper: (module: WallpaperModule) => Promise<boolean>;
}) {
  const [wallpaperModule, setWallpaperModule] =
    useState<WallpaperModule>("stats");
  const [customPreview, setCustomPreview] =
    useState<CustomWallpaperPreview | null>(null);
  const [wallpaperLoading, setWallpaperLoading] = useState(false);
  const [missingCustomImage, setMissingCustomImage] = useState(false);
  const [imageRevision, setImageRevision] = useState(0);
  const [savingTarget, setSavingTarget] =
    useState<WallpaperImageTarget | "reset" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [overlayDraft, setOverlayDraft] = useState(
    wallpaperPreferences[wallpaperModule].overlay,
  );
  const overlayRef = useRef(overlayDraft);
  const preference = wallpaperPreferences[wallpaperModule];
  const moduleLabel =
    wallpaperModules.find((item) => item.id === wallpaperModule)?.label ??
    "当前模块";

  useEffect(() => {
    overlayRef.current = preference.overlay;
    setOverlayDraft(preference.overlay);
  }, [wallpaperModule, preference.overlay]);

  useEffect(() => {
    let current = true;
    const objectUrls = new Set<string>();
    setCustomPreview(null);
    setMissingCustomImage(false);
    setWallpaperLoading(true);
    void loadWallpaperImage(wallpaperModule)
      .then((record) => {
        if (!current) return;
        if (!record) {
          setMissingCustomImage(preference.source === "custom");
          setWallpaperLoading(false);
          return;
        }
        const desktopBlob = record.desktopBlob ?? record.mobileBlob;
        const mobileBlob = record.mobileBlob ?? record.desktopBlob;
        if (!desktopBlob || !mobileBlob) {
          setMissingCustomImage(preference.source === "custom");
          setWallpaperLoading(false);
          return;
        }
        const makeUrl = (blob: Blob) => {
          const url = URL.createObjectURL(blob);
          objectUrls.add(url);
          return url;
        };
        const desktopUrl = makeUrl(desktopBlob);
        const mobileUrl =
          mobileBlob === desktopBlob ? desktopUrl : makeUrl(mobileBlob);
        setCustomPreview({
          desktopUrl,
          mobileUrl,
          desktopName: record.desktopName,
          mobileName: record.mobileName,
        });
        setWallpaperLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setMissingCustomImage(preference.source === "custom");
        setWallpaperLoading(false);
      });
    return () => {
      current = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [wallpaperModule, preference.source, imageRevision]);

  const previewImage =
    preference.source === "anime-night"
      ? {
          desktopUrl: desktopWallpaper,
          mobileUrl: mobileWallpaper,
        }
      : preference.source === "custom"
        ? customPreview
        : null;
  const previewStyle = {
    "--wallpaper-preview-desktop": previewImage
      ? `url("${previewImage.desktopUrl}")`
      : "none",
    "--wallpaper-preview-mobile": previewImage
      ? `url("${previewImage.mobileUrl}")`
      : "none",
    "--wallpaper-preview-overlay": String(overlayDraft / 100),
  } as React.CSSProperties;

  const updatePreference = async (
    patch: Partial<WallpaperPreference>,
  ): Promise<boolean> => {
    const next = normalizeWallpaperPreference(wallpaperModule, {
      ...preference,
      ...patch,
    });
    if (next.source === preference.source && next.overlay === preference.overlay) {
      return true;
    }
    const saved = await onChangeWallpaperPreference(wallpaperModule, next);
    setFeedback(
      saved
        ? { kind: "success", text: "壁纸设置已保存。" }
        : { kind: "error", text: "无法保存壁纸设置；旧设置仍保留，请重试。" },
    );
    return saved;
  };

  const chooseSource = (source: WallpaperPreference["source"]) => {
    if (source === "custom" && !customPreview) return;
    setFeedback(null);
    void updatePreference({ source });
  };

  const handleUpload = async (
    target: WallpaperImageTarget,
    file: File | undefined,
  ) => {
    if (!file || savingTarget) return;
    setFeedback(null);
    setSavingTarget(target);
    try {
      await validateWallpaperFile(file);
      const saved = await onSaveWallpaperImage(wallpaperModule, target, file);
      if (!saved) {
        throw new Error("本地存储未能保存图片；原有壁纸保持不变，请重试或换一张较小的图片。");
      }
      setImageRevision((revision) => revision + 1);
      setFeedback({
        kind: "success",
        text: `${target === "desktop" ? "电脑端" : "移动端"}壁纸已应用到${moduleLabel}。`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "壁纸保存失败，请重试。",
      });
    } finally {
      setSavingTarget(null);
    }
  };

  const handleFileChange =
    (target: WallpaperImageTarget) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      void handleUpload(target, file);
    };

  const commitOverlay = () => {
    void updatePreference({ overlay: overlayRef.current });
  };

  const handleReset = async () => {
    if (savingTarget) return;
    setSavingTarget("reset");
    setFeedback(null);
    const reset = await onResetWallpaper(wallpaperModule);
    setSavingTarget(null);
    if (!reset) {
      setFeedback({
        kind: "error",
        text: "无法恢复默认壁纸；现有设置和图片保持不变，请重试。",
      });
      return;
    }
    overlayRef.current = 64;
    setOverlayDraft(64);
    setImageRevision((revision) => revision + 1);
    setFeedback({ kind: "success", text: `${moduleLabel}已恢复项目默认壁纸。` });
  };

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
      <section className="wb-panel st-appearance-section st-wallpaper-section">
        <div className="st-section-copy">
          <h3>模块壁纸</h3>
          <p>为不同模块单独选择背景，电脑端和移动端可使用不同图片。</p>
        </div>
        <label className="st-wallpaper-module-label" htmlFor="st-wallpaper-module">
          选择模块
        </label>
        <select
          id="st-wallpaper-module"
          className="st-wallpaper-module-select"
          value={wallpaperModule}
          onChange={(event) => {
            setWallpaperModule(event.currentTarget.value as WallpaperModule);
            setFeedback(null);
          }}
        >
          {wallpaperModules.map((module) => (
            <option key={module.id} value={module.id}>
              {module.label}
            </option>
          ))}
        </select>
        <div className="st-wallpaper-choices" role="group" aria-label={`${moduleLabel}壁纸来源`}>
          <button
            type="button"
            className="st-wallpaper-choice"
            aria-pressed={preference.source === "none"}
            disabled={!!savingTarget}
            onClick={() => chooseSource("none")}
          >
            <span className="st-wallpaper-choice-mark" aria-hidden="true" />
            <strong>不使用壁纸</strong>
            <small>保持模块原有背景</small>
          </button>
          <button
            type="button"
            className="st-wallpaper-choice"
            aria-pressed={preference.source === "anime-night"}
            disabled={!!savingTarget}
            onClick={() => chooseSource("anime-night")}
          >
            <span className="st-wallpaper-choice-mark st-wallpaper-choice-art" aria-hidden="true" />
            <strong>二次元夜樱</strong>
            <small>内置电脑端与移动端配套图</small>
          </button>
          <button
            type="button"
            className="st-wallpaper-choice"
            aria-pressed={preference.source === "custom"}
            disabled={!!savingTarget || !customPreview}
            onClick={() => chooseSource("custom")}
          >
            <span className="st-wallpaper-choice-mark st-wallpaper-choice-custom" aria-hidden="true">
              <ImagePlus size={18} />
            </span>
            <strong>自定义图片</strong>
            <small>{customPreview ? "已保存，可应用到此模块" : "上传电脑端或移动端图片"}</small>
          </button>
        </div>
        <div
          className="st-wallpaper-preview"
          style={previewStyle}
          aria-label={`${moduleLabel}壁纸预览`}
        >
          <div className="st-wallpaper-preview-heading">
            <span>{moduleLabel} · 预览</span>
            <strong>让内容保持清晰</strong>
          </div>
          <div className="st-wallpaper-preview-card" aria-hidden="true">
            <i />
            <span />
            <span />
          </div>
        </div>
        <div className="st-wallpaper-upload-grid">
          <label className="st-wallpaper-upload">
            <Monitor size={16} />
            <span>{savingTarget === "desktop" ? "正在保存电脑端图片…" : "上传 / 替换电脑端图片"}</span>
            <input
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!!savingTarget}
              onChange={handleFileChange("desktop")}
            />
          </label>
          <label className="st-wallpaper-upload">
            <Sun size={16} />
            <span>{savingTarget === "mobile" ? "正在保存移动端图片…" : "上传 / 替换移动端图片"}</span>
            <input
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!!savingTarget}
              onChange={handleFileChange("mobile")}
            />
          </label>
        </div>
        <div className="st-wallpaper-file-info">
          <span>电脑端：{customPreview?.desktopName ?? (customPreview?.mobileName ? "使用移动端图片适配" : "尚未上传")}</span>
          <span>移动端：{customPreview?.mobileName ?? (customPreview?.desktopName ? "使用电脑端图片适配" : "尚未上传")}</span>
        </div>
        <label className="st-wallpaper-overlay-label" htmlFor="st-wallpaper-overlay">
          <span>
            遮罩强度
            <small>提高遮罩可让文字更清晰</small>
          </span>
          <strong>{overlayDraft}%</strong>
        </label>
        <input
          id="st-wallpaper-overlay"
          className="st-wallpaper-overlay"
          type="range"
          min={45}
          max={85}
          step={1}
          value={overlayDraft}
          aria-valuetext={`${overlayDraft}%`}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            overlayRef.current = value;
            setOverlayDraft(value);
          }}
          onPointerUp={commitOverlay}
          onKeyUp={commitOverlay}
          onBlur={commitOverlay}
        />
        {wallpaperLoading && (
          <p className="st-wallpaper-status" role="status">正在读取本地图片…</p>
        )}
        {missingCustomImage && (
          <p className="st-wallpaper-error" role="alert">
            找不到已保存的自定义壁纸；请重新上传，或恢复此模块默认设置。
          </p>
        )}
        {feedback && (
          <p
            className={feedback.kind === "error" ? "st-wallpaper-error" : "st-wallpaper-status"}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.text}
          </p>
        )}
        <div className="st-wallpaper-footer">
          <p className="wb-muted">
            支持 PNG、JPEG、WebP，单张不超过 20 MiB / 16 MP。只上传一张时会在另一端适配使用。壁纸保存在当前设备，不会上传服务器。
          </p>
          <button
            type="button"
            className="ui-button-secondary st-wallpaper-reset"
            disabled={!!savingTarget}
            onClick={() => void handleReset()}
          >
            <RotateCcw size={15} />
            {savingTarget === "reset" ? "正在恢复…" : "恢复此模块默认"}
          </button>
        </div>
      </section>
      <p className="wb-muted st-appearance-note">
        <Check size={14} />
        外观修改即时生效，自动保存在当前设备。
      </p>
    </div>
  );
}
