import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  HardDrive,
  ChevronRight,
  ImagePlus,
  Images,
  Layers,
  Monitor,
  Plus,
  Pencil,
  RotateCcw,
  Save,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useConfirmDialog } from "../ui/Feedback";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui/tabs";
import { processWallpaperFile } from "../../lib/wallpaperImageProcessing";
import {
  builtInWallpapers,
  defaultWallpaperPreference,
  defaultWallpaperPreferences,
  newWallpaperId,
  loadWallpaperAssetFiles,
  loadWallpaperAssetThumbnails,
  defaultWallpaperSurfacePreference,
  maxWallpapersPerModule,
  maxWallpaperPresets,
  maxWallpaperPresetNameLength,
  wallpaperPreferenceForTarget,
  wallpaperPreferencesEqual,
  wallpaperSurfaces,
  wallpaperSurfacesForModule,
  wallpaperTargetLabel,
  wallpaperIdForDate,
  wallpaperModules,
  type WallpaperApplyMode,
  type WallpaperAssetDraft,
  type WallpaperAssetMetadata,
  type WallpaperLibraryItem,
  type WallpaperAssignmentTargetId,
  type WallpaperModule,
  type WallpaperPreferenceValue,
  type WallpaperPreferences,
  type WallpaperPreset,
  type WallpaperSurfaceId,
} from "../../lib/wallpapers";

type Device = "desktop" | "mobile";
type Feedback = { kind: "error" | "success"; text: string } | null;
type PreviewFiles = { assetId: string; desktopUrl: string; mobileUrl: string };
type ThumbnailUrls = Record<string, { desktop: string; mobile: string }>;

const formatBytes = (bytes: number) => {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
};

const fileBaseName = (filename: string) =>
  filename.replace(/\.[^.]+$/, "").trim();

const formatPresetDate = (timestamp: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));

type WallpaperTargetOption = {
  id: WallpaperAssignmentTargetId;
  label: string;
  assignedCount: number;
};

function WallpaperTargetGroup({
  moduleLabel,
  targets,
  selectedTargets,
  expanded,
  onToggleExpanded,
  onToggleTarget,
  onToggleGroup,
}: {
  moduleLabel: string;
  targets: WallpaperTargetOption[];
  selectedTargets: WallpaperAssignmentTargetId[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleTarget: (target: WallpaperAssignmentTargetId) => void;
  onToggleGroup: (targets: WallpaperAssignmentTargetId[]) => void;
}) {
  const parentCheckbox = useRef<HTMLInputElement>(null);
  const selectedCount = targets.filter((target) =>
    selectedTargets.includes(target.id),
  ).length;
  const allSelected = selectedCount === targets.length;

  useEffect(() => {
    if (parentCheckbox.current) {
      parentCheckbox.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [allSelected, selectedCount]);

  return (
    <div className="wm-target-group">
      <div className="wm-target-group-head">
        {targets.length > 1 ? (
          <button
            type="button"
            className="wm-target-expand"
            aria-label={(expanded ? "收起" : "展开") + moduleLabel + "的页面区域"}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        ) : (
          <span className="wm-target-expand-spacer" aria-hidden="true" />
        )}
        <label className="wm-target-parent">
          <input
            ref={parentCheckbox}
            type="checkbox"
            checked={allSelected}
            onChange={() => onToggleGroup(targets.map((target) => target.id))}
          />
          <span>{moduleLabel}</span>
        </label>
        <small>{selectedCount}/{targets.length}</small>
      </div>
      {expanded && (
        <div
          className="wm-target-children"
          role="group"
          aria-label={moduleLabel + "可用页面区域"}
        >
          {targets.map((target) => (
            <label key={target.id} className="wm-target">
              <input
                type="checkbox"
                checked={selectedTargets.includes(target.id)}
                onChange={() => onToggleTarget(target.id)}
              />
              <span>{target.label}</span>
              <small>{target.assignedCount}</small>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function WallpaperPresetArtwork({
  assetIds,
  label,
  selected,
  items,
  thumbnails,
  previewFiles,
  device,
  onSelect,
}: {
  assetIds: string[];
  label: string;
  selected: boolean;
  items: Map<string, WallpaperLibraryItem>;
  thumbnails: ThumbnailUrls;
  previewFiles: PreviewFiles | null;
  device: Device;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="wm-preset-art"
      aria-label={"预览方案：" + label}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {assetIds.length === 0 ? (
        <span className="wm-preset-art-empty" aria-hidden="true">
          <Layers size={20} />
        </span>
      ) : assetIds.slice(0, 4).map((id) => {
        const item = items.get(id);
        const src = item?.kind === "built-in"
          ? device === "desktop" ? item.desktopUrl : item.mobileUrl
          : thumbnails[id]?.[device] ?? thumbnails[id]?.desktop ??
            (previewFiles?.assetId === id
              ? device === "desktop" ? previewFiles.desktopUrl : previewFiles.mobileUrl
              : undefined);
        return src ? (
          <img key={id} src={src} alt="" loading="lazy" decoding="async" />
        ) : (
          <span key={id} className={item ? "wm-preset-art-placeholder" : "wm-preset-art-missing"}>
            {item ? "暂无缩略图" : "缺失"}
          </span>
        );
      })}
    </button>
  );
}

function libraryItem(asset: WallpaperAssetMetadata): WallpaperLibraryItem {
  return { ...asset, kind: "uploaded" };
}

function presetTargetPreferences(preferences: WallpaperPreferences) {
  return wallpaperModules.flatMap(({ id: module }) => [
    preferences[module],
    ...wallpaperSurfacesForModule(module).map(
      ({ id }) => preferences[module].surfaces[id] ?? defaultWallpaperSurfacePreference(),
    ),
  ]);
}

function presetSummary(preferences: WallpaperPreferences) {
  const targets = presetTargetPreferences(preferences);
  return {
    areas: targets.filter((target) => target.wallpaperIds.length > 0).length,
    assets: [...new Set(targets.flatMap((target) => target.wallpaperIds))],
  };
}

export default function WallpaperManagerPanel({
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
  const { confirm, dialog } = useConfirmDialog();
  const [view, setView] = useState<"library" | "modules" | "presets">("library");
  const [presetDialog, setPresetDialog] = useState<{
    mode: "save" | "rename";
    presetId?: string;
  } | null>(null);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [presetDialogError, setPresetDialogError] = useState("");
  const [previewPresetId, setPreviewPresetId] = useState<string | null>(null);
  const [module, setModule] = useState<WallpaperModule>("stats");
  const [surfaceTarget, setSurfaceTarget] = useState<"page" | WallpaperSurfaceId>("page");
  const [device, setDevice] = useState<Device>(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches
      ? "mobile"
      : "desktop",
  );
  const [mobilePreviewExpanded, setMobilePreviewExpanded] = useState(false);
  const [selectedWallpaperIds, setSelectedWallpaperIds] = useState<string[]>([]);
  const [targetIds, setTargetIds] = useState<WallpaperAssignmentTargetId[]>([]);
  const [expandedTargetGroups, setExpandedTargetGroups] = useState<WallpaperModule[]>(["stats"]);
  const [applyMode, setApplyMode] = useState<WallpaperApplyMode>("append");
  const [importOpen, setImportOpen] = useState(false);
  const [bulkApplyOpen, setBulkApplyOpen] = useState(false);
  const [wallpaperName, setWallpaperName] = useState("");
  const [desktopFile, setDesktopFile] = useState<File | null>(null);
  const [mobileFile, setMobileFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [overlayDraft, setOverlayDraft] = useState(
    wallpaperPreferences[module].overlay,
  );
  const overlayRef = useRef(wallpaperPreferences[module].overlay);
  const [thumbnailUrls, setThumbnailUrls] = useState<ThumbnailUrls>({});
  const [previewFiles, setPreviewFiles] = useState<PreviewFiles | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const targetId: WallpaperAssignmentTargetId =
    surfaceTarget === "page" ? module : surfaceTarget;
  const preference = wallpaperPreferenceForTarget(wallpaperPreferences, targetId);
  const moduleLabel =
    wallpaperModules.find((item) => item.id === module)?.label ?? "当前组件";
  const targetLabel =
    surfaceTarget === "page"
      ? "整个页面"
      : wallpaperSurfaces.find((surface) => surface.id === surfaceTarget)?.label ?? "内容区域";
  const items = useMemo<WallpaperLibraryItem[]>(
    () => [
      ...builtInWallpapers,
      ...wallpaperAssets.map(libraryItem),
    ],
    [wallpaperAssets],
  );
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const targetGroups = useMemo(
    () => {
      const orderedModules = [
        ...wallpaperModules.filter((group) => group.id === module),
        ...wallpaperModules.filter((group) => group.id !== module),
      ];
      return orderedModules.map((group) => ({
        ...group,
        targets: [
          {
            id: group.id,
            label: "整个页面",
            assignedCount: wallpaperPreferences[group.id].wallpaperIds.length,
          },
          ...wallpaperSurfacesForModule(group.id).map((surface) => ({
            id: surface.id,
            label: surface.label,
            assignedCount:
              wallpaperPreferences[group.id].surfaces[surface.id]?.wallpaperIds.length ??
              0,
          })),
        ] as WallpaperTargetOption[],
      }));
    },
    [module, wallpaperPreferences],
  );
  const projectDefaultPreferences = useMemo(defaultWallpaperPreferences, []);
  const currentIsProjectDefault = wallpaperPreferencesEqual(
    wallpaperPreferences,
    projectDefaultPreferences,
  );
  const activePreset = currentIsProjectDefault
    ? null
    : wallpaperPresets.find((preset) =>
        wallpaperPreferencesEqual(wallpaperPreferences, preset.preferences),
      ) ?? null;
  const previewPreferences = view === "presets"
    ? previewPresetId === "__project-default__"
      ? projectDefaultPreferences
      : wallpaperPresets.find((preset) => preset.id === previewPresetId)?.preferences ??
        wallpaperPreferences
    : wallpaperPreferences;
  const previewTargetPreference =
    (view === "modules" || view === "presets") && surfaceTarget !== "page"
      ? wallpaperPreferenceForTarget(previewPreferences, targetId)
      : previewPreferences[module];
  const previewWallpaperId =
    view === "library" && selectedWallpaperIds.length > 0
      ? selectedWallpaperIds[0]
      : wallpaperIdForDate(previewTargetPreference);
  const previewItem = previewWallpaperId
    ? itemById.get(previewWallpaperId) ?? null
    : null;
  const previewMissingAsset = !!previewWallpaperId && !itemById.has(previewWallpaperId);
  const builtInPreview =
    previewItem?.kind === "built-in" ? previewItem : null;
  const activePreviewUrls = builtInPreview
    ? {
        desktopUrl: builtInPreview.desktopUrl,
        mobileUrl: builtInPreview.mobileUrl,
      }
    : previewFiles?.assetId === previewWallpaperId
      ? previewFiles
      : null;
  const isSurfacePreview =
    (view === "modules" || view === "presets") && surfaceTarget !== "page";
  const previewPresetName = view === "presets"
    ? previewPresetId === "__project-default__"
      ? "项目默认"
      : previewPresetId
        ? wallpaperPresets.find((preset) => preset.id === previewPresetId)?.name ?? "当前配置"
        : currentIsProjectDefault ? "项目默认" : activePreset?.name ?? "未保存的自定义配置"
    : null;
  const previewStyle = {
    "--wallpaper-preview-desktop": activePreviewUrls && !isSurfacePreview
      ? 'url("' + activePreviewUrls.desktopUrl + '")'
      : "none",
    "--wallpaper-preview-mobile": activePreviewUrls && !isSurfacePreview
      ? 'url("' + activePreviewUrls.mobileUrl + '")'
      : "none",
    "--wallpaper-preview-surface-desktop": activePreviewUrls && isSurfacePreview
      ? 'url("' + activePreviewUrls.desktopUrl + '")'
      : "none",
    "--wallpaper-preview-surface-mobile": activePreviewUrls && isSurfacePreview
      ? 'url("' + activePreviewUrls.mobileUrl + '")'
      : "none",
    "--wallpaper-preview-overlay": String(previewTargetPreference.overlay / 100),
  } as CSSProperties;
  const deletableSelection = selectedWallpaperIds.filter(
    (id) => !builtInWallpapers.some((builtIn) => builtIn.id === id),
  );
  const totalStorageBytes = wallpaperAssets.reduce(
    (total, asset) =>
      total +
      asset.optimizedBytes +
      (asset.desktopThumbnailBytes ?? 0) +
      (asset.mobileThumbnailBytes ?? 0),
    0,
  );
  const defaultPreference =
    surfaceTarget === "page"
      ? defaultWallpaperPreference(module)
      : defaultWallpaperSurfacePreference();
  const hasTargetOverrides =
    JSON.stringify(preference.wallpaperIds) !==
      JSON.stringify(defaultPreference.wallpaperIds) ||
    preference.overlay !== defaultPreference.overlay ||
    preference.cycleDaily !== defaultPreference.cycleDaily;
  const assignedItems = preference.wallpaperIds
    .map((id) => itemById.get(id))
    .filter((item): item is WallpaperLibraryItem => !!item);
  const missingAssignedIds = preference.wallpaperIds.filter(
    (id) => !itemById.has(id),
  );

  useEffect(() => {
    setExpandedTargetGroups([module]);
  }, [module]);

  useEffect(() => {
    overlayRef.current = preference.overlay;
    setOverlayDraft(preference.overlay);
  }, [targetId, preference.overlay]);

  useEffect(() => {
    let current = true;
    const urls = new Set<string>();
    setThumbnailUrls({});
    void loadWallpaperAssetThumbnails()
      .then((thumbnails) => {
        if (!current) return;
        const next: ThumbnailUrls = {};
        for (const thumbnail of thumbnails) {
          const desktopBlob = thumbnail.desktopThumbnailBlob;
          const mobileBlob =
            thumbnail.mobileThumbnailBlob ?? thumbnail.desktopThumbnailBlob;
          const desktop = URL.createObjectURL(desktopBlob);
          const mobile =
            mobileBlob === desktopBlob ? desktop : URL.createObjectURL(mobileBlob);
          urls.add(desktop);
          if (mobile !== desktop) urls.add(mobile);
          next[thumbnail.id] = { desktop, mobile };
        }
        setThumbnailUrls(next);
      })
      .catch(() => {
        if (current) setThumbnailUrls({});
      });
    return () => {
      current = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [wallpaperAssets]);

  useEffect(() => {
    let current = true;
    const urls = new Set<string>();
    setPreviewFiles(null);
    setPreviewLoading(false);
    if (!previewWallpaperId || builtInPreview) {
      return () => {
        current = false;
      };
    }
    setPreviewLoading(true);
    void loadWallpaperAssetFiles(previewWallpaperId)
      .then((files) => {
        if (!current) return;
        if (!files) {
          setPreviewLoading(false);
          return;
        }
        const desktopBlob = files.desktopBlob ?? files.mobileBlob;
        const mobileBlob = files.mobileBlob ?? files.desktopBlob;
        if (!desktopBlob || !mobileBlob) {
          setPreviewLoading(false);
          return;
        }
        const makeUrl = (blob: Blob) => {
          const url = URL.createObjectURL(blob);
          urls.add(url);
          return url;
        };
        const desktopUrl = makeUrl(desktopBlob);
        const mobileUrl =
          mobileBlob === desktopBlob ? desktopUrl : makeUrl(mobileBlob);
        setPreviewFiles({ assetId: previewWallpaperId, desktopUrl, mobileUrl });
        setPreviewLoading(false);
      })
      .catch(() => {
        if (current) setPreviewLoading(false);
      });
    return () => {
      current = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewWallpaperId, builtInPreview]);

  const updatePreference = async (
    next: WallpaperPreferenceValue,
  ): Promise<boolean> => {
    const saved = await onChangeWallpaperPreference(targetId, next);
    setFeedback(
      saved
        ? { kind: "success", text: "页面区域壁纸设置已保存。" }
        : { kind: "error", text: "无法保存壁纸设置；现有分配仍保留。" },
    );
    return saved;
  };

  const toggleWallpaperSelection = (id: string) => {
    if (
      !selectedWallpaperIds.includes(id) &&
      selectedWallpaperIds.length >= maxWallpapersPerModule
    ) {
      setFeedback({
        kind: "error",
        text: "每个页面区域最多分配 " + maxWallpapersPerModule + " 张壁纸，请减少所选数量。",
      });
      return;
    }
    setSelectedWallpaperIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
    setFeedback(null);
  };

  const selectAllWallpapers = () => {
    setSelectedWallpaperIds(items.slice(0, maxWallpapersPerModule).map((item) => item.id));
    setFeedback(
      items.length > maxWallpapersPerModule
        ? {
            kind: "error",
            text: "每个页面区域最多分配 " + maxWallpapersPerModule + " 张壁纸；已选择前 " + maxWallpapersPerModule + " 张。",
          }
        : null,
    );
  };

  const toggleAssignmentTarget = (target: WallpaperAssignmentTargetId) => {
    setTargetIds((current) =>
      current.includes(target)
        ? current.filter((value) => value !== target)
        : [...current, target],
    );
  };

  const toggleTargetGroup = (targets: WallpaperAssignmentTargetId[]) => {
    const allSelected = targets.every((target) => targetIds.includes(target));
    setTargetIds((current) =>
      allSelected
        ? current.filter((target) => !targets.includes(target))
        : [...new Set([...current, ...targets])],
    );
  };

  const toggleTargetGroupExpanded = (group: WallpaperModule) => {
    setExpandedTargetGroups((current) =>
      current.includes(group)
        ? current.filter((value) => value !== group)
        : [...current, group],
    );
  };

  const handleBulkApplyOpenChange = (open: boolean) => {
    setBulkApplyOpen(open);
    if (!open) {
      setTargetIds([]);
      setFeedback((current) => current?.kind === "error" ? null : current);
    }
  };

  const handleApply = async () => {
    if (
      selectedWallpaperIds.length === 0 ||
      targetIds.length === 0 ||
      busy
    ) {
      return;
    }
    const overLimitTargets = targetIds.filter(
      (target) =>
        applyMode === "append" &&
        new Set([
          ...wallpaperPreferenceForTarget(wallpaperPreferences, target).wallpaperIds,
          ...selectedWallpaperIds,
        ]).size > maxWallpapersPerModule,
    );
    if (overLimitTargets.length > 0) {
      setFeedback({
        kind: "error",
        text:
          "“" +
          overLimitTargets.map(wallpaperTargetLabel).join("、") +
          "”添加后会超过 " +
          maxWallpapersPerModule +
          " 张上限；请改用替换，或减少壁纸选择。",
      });
      return;
    }
    const affectedTargets = targetIds.filter(
      (target) =>
        applyMode === "replace" &&
        wallpaperPreferenceForTarget(wallpaperPreferences, target).wallpaperIds.length > 0,
    );
    if (affectedTargets.length > 0) {
      const confirmed = await confirm({
        title: "替换所选页面区域的壁纸？",
        message:
          "将替换 " +
          affectedTargets.map(wallpaperTargetLabel).join("、") +
          " 的壁纸列表。未选中的页面或区域不会改变。",
        confirmText: "替换并应用",
        danger: true,
      });
      if (!confirmed) return;
    }
    setBusy(true);
    setFeedback(null);
    const applied = await onApplyWallpaperAssets(
      targetIds,
      selectedWallpaperIds,
      applyMode,
    );
    setBusy(false);
    setFeedback(
      applied
        ? {
            kind: "success",
            text:
              "已将 " +
              selectedWallpaperIds.length +
              " 张壁纸应用到 " +
              targetIds.length +
              " 个页面区域。",
          }
        : {
            kind: "error",
            text: "本机壁纸设置无法保存；原有分配保持不变。",
          },
    );
    if (applied) {
      setTargetIds([]);
      setBulkApplyOpen(false);
    }
  };

  const handleDeleteSelection = async () => {
    if (deletableSelection.length === 0 || busy) return;
    const affectedTargets = wallpaperModules.flatMap((item) => [
      item.id,
      ...wallpaperSurfacesForModule(item.id).map((surface) => surface.id),
    ]).filter((target) =>
      wallpaperPreferenceForTarget(wallpaperPreferences, target).wallpaperIds.some(
        (id) => deletableSelection.includes(id),
      ),
    );
    const affectedPresets = wallpaperPresets.filter((preset) =>
      presetSummary(preset.preferences).assets.some((id) =>
        deletableSelection.includes(id),
      ),
    );
    const confirmed = await confirm({
      title: "从壁纸库删除所选图片？",
      message:
        "将删除 " +
        deletableSelection.length +
        " 张自定义壁纸" +
        (affectedTargets.length
          ? "，并从 " + affectedTargets.map(wallpaperTargetLabel).join("、") + " 解除分配"
          : "") +
        (affectedPresets.length
          ? "，同时从保存方案“" + affectedPresets.map((preset) => preset.name).join("、") + "”移除这些图片引用"
          : "") +
        "。此操作无法在应用内恢复。",
      confirmText: "删除所选图片",
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setFeedback(null);
    const deleted = await onDeleteWallpaperAssets(deletableSelection);
    setBusy(false);
    setFeedback(
      deleted
        ? { kind: "success", text: "所选壁纸已从图库删除。" }
        : { kind: "error", text: "未能删除图库图片；原有设置保持不变。" },
    );
    if (deleted) {
      setSelectedWallpaperIds((current) =>
        current.filter((id) => !deletableSelection.includes(id)),
      );
    }
  };

  const updateFile = (
    target: Device,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (target === "desktop") {
      setDesktopFile(file);
      if (file && !wallpaperName.trim()) {
        setWallpaperName(fileBaseName(file.name));
      }
    } else {
      setMobileFile(file);
      if (file && !wallpaperName.trim()) {
        setWallpaperName(fileBaseName(file.name));
      }
    }
  };

  const handleAddWallpaper = async () => {
    if ((!desktopFile && !mobileFile) || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const desktop = desktopFile
        ? await processWallpaperFile(desktopFile)
        : null;
      const mobile = mobileFile
        ? await processWallpaperFile(mobileFile)
        : null;
      const fallback = desktop ?? mobile;
      if (!fallback) throw new Error("请选择至少一张壁纸图片。");
      const id = newWallpaperId();
      const name =
        wallpaperName.trim() ||
        fileBaseName(desktopFile?.name ?? mobileFile?.name ?? "") ||
        "新壁纸";
      const desktopSource = desktop ?? fallback;
      const metadata: WallpaperAssetMetadata = {
        id,
        name,
        createdAt: Date.now(),
        originalBytes:
          (desktop?.originalBytes ?? 0) + (mobile?.originalBytes ?? 0),
        optimizedBytes:
          (desktop?.optimizedBytes ?? 0) + (mobile?.optimizedBytes ?? 0),
        desktopWidth: desktopSource.width,
        desktopHeight: desktopSource.height,
        mobileWidth: mobile?.width,
        mobileHeight: mobile?.height,
        desktopThumbnailBytes: desktopSource.thumbnail.size,
        mobileThumbnailBytes: mobile?.thumbnail.size,
        desktopName: desktopFile?.name,
        mobileName: mobileFile?.name,
      };
      const added = await onAddWallpaperAsset({
        metadata,
        files: {
          id,
          desktopBlob: desktopSource.blob,
          mobileBlob: mobile?.blob,
        },
        thumbnails: {
          id,
          desktopThumbnailBlob: desktopSource.thumbnail,
          mobileThumbnailBlob: mobile?.thumbnail,
        },
      });
      if (!added) {
        throw new Error("本机壁纸库保存失败；请稍后重试或减少图片大小。");
      }
      setSelectedWallpaperIds([id]);
      setTargetIds([]);
      setDesktopFile(null);
      setMobileFile(null);
      setWallpaperName("");
      setImportOpen(false);
      setFeedback({
        kind: "success",
        text:
          "已将“" +
          name +
          "”添加到壁纸库。展示图已处理，小缩略图已生成。",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "添加壁纸失败。",
      });
    } finally {
      setBusy(false);
    }
  };

  const setAssignment = async (wallpaperIds: string[], cycleDaily: boolean) => {
    await updatePreference({
      ...preference,
      wallpaperIds,
      cycleDaily,
    });
  };

  const reorderModuleWallpapers = (index: number, delta: -1 | 1) => {
    const nextIds = [...preference.wallpaperIds];
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= nextIds.length) return;
    [nextIds[index], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[index]];
    void setAssignment(nextIds, nextIds.length > 1 && preference.cycleDaily);
  };

  const removeModuleWallpaper = (id: string) => {
    const wallpaperIds = preference.wallpaperIds.filter((value) => value !== id);
    void setAssignment(
      wallpaperIds,
      wallpaperIds.length > 1 && preference.cycleDaily,
    );
  };

  const commitOverlay = () => {
    void updatePreference({
      ...preference,
      overlay: overlayRef.current,
    });
  };

  const handleResetModule = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const reset = await onResetWallpaper(targetId);
    setBusy(false);
    setFeedback(
      reset
        ? { kind: "success", text: moduleLabel + " · " + targetLabel + "已恢复默认壁纸。" }
        : { kind: "error", text: "未能恢复默认；当前分配保持不变。" },
    );
  };

  const openSavePresetDialog = () => {
    setPresetNameDraft("");
    setPresetDialogError("");
    setPresetDialog({ mode: "save" });
  };

  const openRenamePresetDialog = (preset: WallpaperPreset) => {
    setPresetNameDraft(preset.name);
    setPresetDialogError("");
    setPresetDialog({ mode: "rename", presetId: preset.id });
  };

  const handlePresetDialogSubmit = async () => {
    if (!presetDialog || busy) return;
    if (missingCurrentAssets.length > 0) {
      setPresetDialogError("当前设置引用的壁纸不在图库中；请先修复分配后再保存方案。");
      return;
    }
    const name = presetNameDraft.trim().replace(/\s+/g, " ");
    if (!name) {
      setPresetDialogError("请输入方案名称。");
      return;
    }
    if (Array.from(name).length > maxWallpaperPresetNameLength) {
      setPresetDialogError("方案名称不能超过 " + maxWallpaperPresetNameLength + " 个字符。");
      return;
    }
    if (wallpaperPresets.some((preset) =>
      preset.id !== presetDialog.presetId &&
      preset.name.toLowerCase() === name.toLowerCase(),
    )) {
      setPresetDialogError("已存在同名方案，请更换名称。");
      return;
    }

    setBusy(true);
    const saved = presetDialog.mode === "rename"
      ? await onRenameWallpaperPreset(presetDialog.presetId ?? "", name)
      : await onSaveWallpaperPreset(name);
    setBusy(false);
    if (!saved) {
      setPresetDialogError("未能保存方案，请稍后重试；现有壁纸设置保持不变。");
      return;
    }
    setPresetDialog(null);
    setPresetDialogError("");
    setFeedback({
      kind: "success",
      text: presetDialog.mode === "rename" ? "方案名称已更新。" : "当前壁纸设置已保存为方案。",
    });
  };

  const handleApplyPreset = async (presetId: string | null) => {
    if (busy) return;
    const isDefault = presetId === null;
    const preset = presetId
      ? wallpaperPresets.find((item) => item.id === presetId)
      : null;
    if (presetId && !preset) return;
    const confirmed = await confirm({
      title: isDefault ? "恢复项目默认壁纸？" : "应用壁纸方案？",
      message: isDefault
        ? "将重置 8 个页面和 21 个内容区域的壁纸、遮罩与轮播设置。壁纸库和已保存方案会保留。"
        : "将用“" + preset?.name + "”完整替换所有页面与内容区域的壁纸、遮罩和轮播设置。壁纸库与其他方案会保留。",
      confirmText: isDefault ? "恢复默认" : "应用方案",
      danger: isDefault,
    });
    if (!confirmed) return;
    setBusy(true);
    setFeedback(null);
    const applied = await onApplyWallpaperPreset(presetId);
    setBusy(false);
    if (applied) {
      setPreviewPresetId(presetId ?? "__project-default__");
      setFeedback({
        kind: "success",
        text: isDefault ? "所有页面和内容区域已恢复项目默认。" : "壁纸方案已应用。",
      });
    } else {
      setFeedback({
        kind: "error",
        text: "无法应用方案；当前壁纸设置保持不变。请检查方案引用的图片是否仍在图库中。",
      });
    }
  };

  const handleUpdatePreset = async (preset: WallpaperPreset) => {
    if (busy) return;
    if (missingCurrentAssets.length > 0) {
      setFeedback({ kind: "error", text: "当前设置引用的壁纸不在图库中；请先修复分配后再更新方案。" });
      return;
    }
    const confirmed = await confirm({
      title: "更新保存方案？",
      message:
        "将用当前所有页面与内容区域的壁纸、遮罩和轮播设置覆盖“" +
        preset.name +
        "”中的快照。",
      confirmText: "更新方案",
    });
    if (!confirmed) return;
    setBusy(true);
    const saved = await onSaveWallpaperPreset(preset.name, preset.id);
    setBusy(false);
    setFeedback(
      saved
        ? { kind: "success", text: "“" + preset.name + "”已更新为当前设置。" }
        : { kind: "error", text: "无法更新方案；原有快照保持不变。" },
    );
  };

  const handleDeletePreset = async (preset: WallpaperPreset) => {
    if (busy) return;
    const confirmed = await confirm({
      title: "删除壁纸方案？",
      message:
        "将删除“" + preset.name + "”保存的配置快照，不影响当前壁纸设置或图库图片。",
      confirmText: "删除方案",
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    const deleted = await onDeleteWallpaperPreset(preset.id);
    setBusy(false);
    if (previewPresetId === preset.id) setPreviewPresetId(null);
    setFeedback(
      deleted
        ? { kind: "success", text: "壁纸方案已删除。" }
        : { kind: "error", text: "无法删除方案；现有设置保持不变。" },
    );
  };

  const toggleWallpaperCycle = () => {
    void updatePreference({
      ...preference,
      cycleDaily: !preference.cycleDaily,
    });
  };
  const currentSummary = presetSummary(wallpaperPreferences);
  const missingCurrentAssets = currentSummary.assets.filter((id) => !itemById.has(id));
  const projectDefaultSummary = presetSummary(projectDefaultPreferences);

  return (
    <>
      {dialog}
      <section
        className="wb-panel st-appearance-section wm-manager"
        aria-label="壁纸管理"
      >
        <Tabs
          value={view}
          onValueChange={(value) => setView(value as "library" | "modules" | "presets")}
          className="wm-tabs"
        >
          <header className="wm-heading">
            <div className="wm-heading-copy">
              <span className="wm-title-icon" aria-hidden="true">
                <Images size={20} />
              </span>
              <div className="st-section-copy wm-title-copy">
                <h3>壁纸管理</h3>
                <p>整理壁纸，再把同一组背景分配给多个组件。</p>
              </div>
            </div>
            <TabsList className="wm-view-switch" aria-label="壁纸管理视图">
              <TabsTrigger value="library" disabled={!wallpaperPreferencesReady || !!wallpaperStorageError}>
                壁纸库
                <span>{items.length}</span>
              </TabsTrigger>
              <TabsTrigger value="modules" disabled={!wallpaperPreferencesReady || !!wallpaperStorageError}>
                组件分配
              </TabsTrigger>
              <TabsTrigger value="presets" disabled={!wallpaperPreferencesReady || !!wallpaperStorageError}>
                壁纸方案
                <span>{wallpaperPresets.length}</span>
              </TabsTrigger>
            </TabsList>
          </header>

          {wallpaperStorageError ? (
            <div className="wm-storage-blocked">
              <div>
                <strong>壁纸数据无法完整读取</strong>
                <p role="alert">{wallpaperStorageError}</p>
              </div>
              <button
                type="button"
                className="ui-button-secondary"
                onClick={() => window.location.reload()}
              >
                刷新重试
              </button>
            </div>
          ) : !wallpaperPreferencesReady ? (
            <div className="wm-storage-loading" role="status">
              正在读取本机壁纸数据…
            </div>
          ) : (
            <div className="wm-layout">
            <div className="wm-main">
              <TabsContent value="library" className="wm-tab-panel">
                <div className="wm-library">
                  <div className="wm-library-toolbar">
                    <div className="wm-library-heading">
                      <div>
                        <strong>壁纸图库</strong>
                        <span>
                          {wallpaperAssets.length} 张自定义 · {builtInWallpapers.length} 张内置
                        </span>
                      </div>
                    </div>
                    <div className="wm-toolbar-actions">
                      <span className="wm-storage-pill">
                        <HardDrive size={14} aria-hidden="true" />
                        占用 {formatBytes(totalStorageBytes)}
                      </span>
                      <button
                        type="button"
                        className="ui-button-primary wm-import-trigger"
                        aria-expanded={importOpen}
                        disabled={busy}
                        onClick={() => setImportOpen((open) => !open)}
                      >
                        <Plus size={15} aria-hidden="true" />
                        {importOpen ? "关闭导入" : "添加壁纸"}
                      </button>
                    </div>
                  </div>

                  {importOpen && (
                    <div className="wm-import-panel">
                      <div className="wm-import-heading">
                        <div>
                          <strong>添加到壁纸库</strong>
                          <span>为电脑和手机分别选择画面，也可以共用一张图。</span>
                        </div>
                        <button
                          type="button"
                          className="wm-import-close"
                          aria-label="关闭壁纸导入"
                          disabled={busy}
                          onClick={() => setImportOpen(false)}
                        >
                          ×
                        </button>
                      </div>
                      <label className="wm-field">
                        <span>壁纸名称</span>
                        <input
                          type="text"
                          maxLength={80}
                          value={wallpaperName}
                          onChange={(event) =>
                            setWallpaperName(event.currentTarget.value)
                          }
                          placeholder="例如：海边晚霞"
                        />
                      </label>
                      <div className="wm-file-grid">
                        <label className="wm-file-picker">
                          <Monitor size={17} aria-hidden="true" />
                          <span>
                            <strong>电脑端画面</strong>
                            <small>{desktopFile?.name ?? "选择图片"}</small>
                          </span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={busy}
                            onChange={(event) => updateFile("desktop", event)}
                          />
                        </label>
                        <label className="wm-file-picker">
                          <Smartphone size={17} aria-hidden="true" />
                          <span>
                            <strong>移动端画面</strong>
                            <small>{mobileFile?.name ?? "可选，缺省时共用电脑端"}</small>
                          </span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={busy}
                            onChange={(event) => updateFile("mobile", event)}
                          />
                        </label>
                      </div>
                      <div className="wm-import-footer">
                        <p>
                          图片在浏览器本机处理并保存，不会上传到服务端。
                        </p>
                        <button
                          type="button"
                          className="ui-button-primary"
                          disabled={busy || (!desktopFile && !mobileFile)}
                          onClick={() => void handleAddWallpaper()}
                        >
                          <Plus size={15} aria-hidden="true" />
                          {busy ? "正在优化并保存…" : "保存到壁纸库"}
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedWallpaperIds.length > 0 && (
                    <div className="wm-selection-bar">
                      <div className="wm-selection-meta">
                        <span className="wm-selection-count">
                          {selectedWallpaperIds.length}
                        </span>
                        <div>
                          <strong>张壁纸已选</strong>
                          <small>可统一分配到多个页面区域</small>
                        </div>
                      </div>
                      <div className="wm-selection-actions">
                        <button
                          type="button"
                          className="ui-button-ghost wm-text-action"
                          onClick={selectAllWallpapers}
                        >
                          全选
                        </button>
                        <button
                          type="button"
                          className="ui-button-ghost wm-text-action"
                          onClick={() => {
                            setSelectedWallpaperIds([]);
                            setTargetIds([]);
                            setBulkApplyOpen(false);
                            setFeedback(null);
                          }}
                        >
                          清空
                        </button>
                        <Dialog.Root open={bulkApplyOpen} onOpenChange={handleBulkApplyOpenChange}>
                          <Dialog.Trigger asChild>
                            <button
                              type="button"
                              className="ui-button-primary wm-apply-trigger"
                            >
                              <Layers size={15} aria-hidden="true" />
                              批量应用
                            </button>
                          </Dialog.Trigger>
                          <Dialog.Portal>
                            <Dialog.Overlay className="ui-overlay fixed inset-0 z-[70] data-[state=open]:animate-fade-in" />
                            <Dialog.Content className="ui-modal-surface wm-bulk-dialog fixed left-1/2 top-1/2 z-[71] -translate-x-1/2 -translate-y-1/2 outline-hidden">
                              <div className="wm-bulk-dialog-heading">
                                <span className="wm-bulk-dialog-icon" aria-hidden="true">
                                  <Layers size={17} />
                                </span>
                                <div>
                                  <Dialog.Title>应用到页面或区域</Dialog.Title>
                                  <Dialog.Description>
                                    已选 {selectedWallpaperIds.length} 张壁纸。展开页面，可只选择其中一个区域。
                                  </Dialog.Description>
                                </div>
                                <Dialog.Close asChild>
                                  <button
                                    type="button"
                                    className="wm-import-close"
                                    aria-label="关闭区域选择"
                                  >
                                    ×
                                  </button>
                                </Dialog.Close>
                              </div>
                              <div className="wm-target-tree" role="group" aria-label="选择页面和内容区域">
                                {targetGroups.map((group) => (
                                  <WallpaperTargetGroup
                                    key={group.id}
                                    moduleLabel={group.label}
                                    targets={group.targets}
                                    selectedTargets={targetIds}
                                    expanded={expandedTargetGroups.includes(group.id)}
                                    onToggleExpanded={() => toggleTargetGroupExpanded(group.id)}
                                    onToggleTarget={toggleAssignmentTarget}
                                    onToggleGroup={toggleTargetGroup}
                                  />
                                ))}
                              </div>
                              <fieldset className="wm-apply-mode">
                                <legend>应用方式</legend>
                                <label>
                                  <input
                                    type="radio"
                                    name="wallpaper-apply-mode"
                                    checked={applyMode === "append"}
                                    onChange={() => setApplyMode("append")}
                                  />
                                  添加到现有壁纸
                                </label>
                                <label>
                                  <input
                                    type="radio"
                                    name="wallpaper-apply-mode"
                                    checked={applyMode === "replace"}
                                    onChange={() => setApplyMode("replace")}
                                  />
                                  替换页面或区域
                                </label>
                              </fieldset>
                              <p className="wm-help">
                                勾选页面父项会同时选择整页和所有子区域；也可以只勾选子项。
                              </p>
                              {feedback?.kind === "error" && (
                                <p className="wm-error" role="alert">
                                  {feedback.text}
                                </p>
                              )}
                              <div className="wm-bulk-dialog-footer">
                                <Dialog.Close asChild>
                                  <button type="button" className="ui-button-secondary">
                                    取消
                                  </button>
                                </Dialog.Close>
                                <button
                                  type="button"
                                  className="ui-button-primary"
                                  disabled={busy || targetIds.length === 0}
                                  onClick={() => void handleApply()}
                                >
                                  {busy ? "正在应用…" : "应用到所选区域"}
                                </button>
                              </div>
                            </Dialog.Content>
                          </Dialog.Portal>
                        </Dialog.Root>
                        <button
                          type="button"
                          className="ui-button-danger wm-delete-trigger"
                          disabled={busy || deletableSelection.length === 0}
                          onClick={() => void handleDeleteSelection()}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          删除
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="wm-library-grid" role="group" aria-label="壁纸库">
                    {items.map((item) => {
                      const selected = selectedWallpaperIds.includes(item.id);
                      const usedIn = wallpaperModules.flatMap((target) => [
                        ...(wallpaperPreferences[target.id].wallpaperIds.includes(item.id)
                          ? [{ label: target.label + " · 整个页面" }]
                          : []),
                        ...wallpaperSurfacesForModule(target.id)
                          .filter((surface) =>
                            wallpaperPreferences[target.id].surfaces[surface.id]?.wallpaperIds.includes(item.id),
                          )
                          .map((surface) => ({ label: target.label + " · " + surface.label })),
                      ]);
                      const thumbnail =
                        item.kind === "built-in"
                          ? device === "desktop"
                            ? item.desktopUrl
                            : item.mobileUrl
                          : thumbnailUrls[item.id]?.[device] ??
                            thumbnailUrls[item.id]?.desktop ??
                            (previewFiles?.assetId === item.id
                              ? device === "desktop" ? previewFiles.desktopUrl : previewFiles.mobileUrl
                              : "");
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="wm-asset-card"
                          aria-pressed={selected}
                          aria-label={
                            (selected ? "取消选择：" : "选择：") +
                            item.name +
                            (usedIn.length
                              ? "，已用于 " +
                                usedIn.map((entry) => entry.label).join("、")
                              : "")
                          }
                          onClick={() => toggleWallpaperSelection(item.id)}
                        >
                          <span className="wm-asset-thumb">
                            {thumbnail ? (
                              <img
                                src={thumbnail}
                                alt=""
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <span className="wm-asset-thumb-empty">
                                <ImagePlus size={19} aria-hidden="true" />
                              </span>
                            )}
                            {selected && (
                              <i className="wm-asset-selected">
                                <Check size={14} aria-hidden="true" />
                              </i>
                            )}
                          </span>
                          <span className="wm-asset-copy">
                            <strong>{item.name}</strong>
                            <small>
                              {item.kind === "built-in"
                                ? "内置壁纸 · 双端适配"
                                : "自定义壁纸 · " + formatBytes(item.optimizedBytes)}
                            </small>
                            <small>
                              {usedIn.length
                                ? "用于 " + usedIn.map((entry) => entry.label).join("、")
                                : "尚未分配"}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="wm-upload-card"
                      aria-label="添加一张壁纸到图库"
                      onClick={() => setImportOpen(true)}
                    >
                      <span className="wm-upload-art">
                        <ImagePlus size={24} aria-hidden="true" />
                        <span>导入电脑与手机壁纸</span>
                      </span>
                      <span className="wm-asset-copy">
                        <strong>添加到壁纸库</strong>
                        <small>支持 PNG、JPEG 和 WebP</small>
                        <small>本机优化，随时应用到组件</small>
                      </span>
                    </button>
                  </div>
                </div>
                {feedback && !bulkApplyOpen && (
                  <p
                    className={feedback.kind === "error" ? "wm-error" : "wm-status"}
                    role={feedback.kind === "error" ? "alert" : "status"}
                  >
                    {feedback.text}
                  </p>
                )}
              </TabsContent>

              <TabsContent value="modules" className="wm-tab-panel">
                <div className="wm-module-settings">
                  <div className="wm-target-fields">
                    <div className="wm-module-field">
                      <label htmlFor="wm-module-select">所属页面</label>
                      <Select
                        value={module}
                        onValueChange={(value) => {
                          setModule(value as WallpaperModule);
                          setSurfaceTarget("page");
                        }}
                      >
                        <SelectTrigger
                          id="wm-module-select"
                          className="wm-module-select"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {wallpaperModules.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="wm-module-field">
                      <label htmlFor="wm-surface-select">应用区域</label>
                      <Select
                        value={surfaceTarget}
                        onValueChange={(value) =>
                          setSurfaceTarget(value as "page" | WallpaperSurfaceId)
                        }
                      >
                        <SelectTrigger
                          id="wm-surface-select"
                          className="wm-module-select"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="page">整个页面</SelectItem>
                          {wallpaperSurfacesForModule(module).map((surface) => (
                            <SelectItem key={surface.id} value={surface.id}>
                              {surface.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="wm-assigned-heading">
                    <div>
                      <strong>{moduleLabel} · {targetLabel}</strong>
                      <span>{assignedItems.length ? `${assignedItems.length} 张已分配` : "沿用页面原有样式"}</span>
                    </div>
                    <button
                      type="button"
                      className="ui-button-ghost wm-text-action"
                      onClick={() => setView("library")}
                    >
                      从壁纸库添加到此区域
                    </button>
                  </div>
                  {missingAssignedIds.length > 0 && (
                    <p className="wm-error" role="alert">
                      有已分配的壁纸不在图库中；请恢复默认或重新应用图库图片。
                    </p>
                  )}
                  {assignedItems.length > 0 ? (
                    <ol className="wm-assigned-list">
                      {assignedItems.map((item, index) => {
                        const thumbnail =
                          item.kind === "built-in"
                            ? item.desktopUrl
                            : thumbnailUrls[item.id]?.desktop ?? "";
                        return (
                          <li key={item.id} className="wm-assigned-item">
                            <span className="wm-assigned-thumb">
                              {thumbnail && (
                                <img
                                  src={thumbnail}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                />
                              )}
                            </span>
                            <span className="wm-assigned-name">
                              <strong>{item.name}</strong>
                              <small>{index === 0 ? "列表首张" : "轮换候选"}</small>
                            </span>
                            <div className="wm-assigned-actions">
                              <button
                                type="button"
                                className="wm-icon-button"
                                disabled={index === 0}
                                aria-label={"将" + item.name + "上移"}
                                onClick={() => reorderModuleWallpapers(index, -1)}
                              >
                                <ArrowUp size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="wm-icon-button"
                                disabled={index === assignedItems.length - 1}
                                aria-label={"将" + item.name + "下移"}
                                onClick={() => reorderModuleWallpapers(index, 1)}
                              >
                                <ArrowDown size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="wm-icon-button wm-remove-assignment"
                                aria-label={"从" + targetLabel + "移除" + item.name}
                                onClick={() => removeModuleWallpaper(item.id)}
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                  {preference.wallpaperIds.length > 1 && (
                    <label className="wm-cycle-toggle">
                      <input
                        type="checkbox"
                        checked={preference.cycleDaily}
                        onChange={toggleWallpaperCycle}
                      />
                      <span>
                        <strong>每天轮换</strong>
                        <small>按上方顺序每天切换一张，同一天内保持稳定。</small>
                      </span>
                    </label>
                  )}
                  {preference.wallpaperIds.length > 0 && (
                    <div className="wm-overlay-control">
                      <label htmlFor="wm-module-overlay">
                        <span>背景遮罩</span>
                        <strong>{overlayDraft}%</strong>
                      </label>
                      <input
                        id="wm-module-overlay"
                        type="range"
                        min={45}
                        max={85}
                        step={1}
                        value={overlayDraft}
                        aria-valuetext={overlayDraft + "%"}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value);
                          overlayRef.current = value;
                          setOverlayDraft(value);
                        }}
                        onPointerUp={commitOverlay}
                        onKeyUp={commitOverlay}
                        onBlur={commitOverlay}
                      />
                    </div>
                  )}
                  <div className="wm-module-footer">
                    {hasTargetOverrides && (
                      <button
                        type="button"
                        className="ui-button-secondary"
                        disabled={busy}
                        onClick={() => void handleResetModule()}
                      >
                        <RotateCcw size={15} aria-hidden="true" />
                        恢复区域默认
                      </button>
                    )}
                    {feedback && (
                      <p
                        className={feedback.kind === "error" ? "wm-error" : "wm-status"}
                        role={feedback.kind === "error" ? "alert" : "status"}
                      >
                        {feedback.text}
                      </p>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="presets" className="wm-tab-panel">
                <div className="wm-presets">
                  <div className="wm-library-toolbar wm-presets-toolbar">
                    <div className="wm-library-heading">
                      <div>
                        <strong>壁纸方案</strong>
                        <span>保存当前配置，随时切换。</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ui-button-primary wm-save-preset-trigger"
                      disabled={busy || missingCurrentAssets.length > 0 || wallpaperPresets.length >= maxWallpaperPresets}
                      title={wallpaperPresets.length >= maxWallpaperPresets
                        ? "最多保存 " + maxWallpaperPresets + " 组方案"
                        : undefined}
                      onClick={openSavePresetDialog}
                    >
                      <Save size={15} aria-hidden="true" />
                      保存当前设置
                    </button>
                  </div>

                  {missingCurrentAssets.length > 0 && (
                    <p className="wm-error" role="alert">
                      当前配置有 {missingCurrentAssets.length} 张壁纸不在图库中；请先修复分配再保存或更新方案。
                    </p>
                  )}
                  <div className="wm-preset-section-heading">
                    <strong>方案列表</strong>
                    {wallpaperPresets.length > 0 && (
                      <small>{wallpaperPresets.length} 组已保存</small>
                    )}
                  </div>

                  <div className="wm-preset-list">
                    <article
                      className="wm-preset-card wm-preset-card-default"
                      data-active={currentIsProjectDefault}
                    >
                      <WallpaperPresetArtwork
                        assetIds={projectDefaultSummary.assets}
                        label="项目默认"
                        selected={previewPresetId === "__project-default__"}
                        items={itemById}
                        thumbnails={thumbnailUrls}
                        previewFiles={previewFiles}
                        device={device}
                        onSelect={() => setPreviewPresetId("__project-default__")}
                      />
                      <div className="wm-preset-copy">
                        <strong>项目默认</strong>
                        <p>清除壁纸分配，恢复所有页面与内容区域的默认样式。</p>
                      </div>
                      <div className="wm-preset-actions">
                        {currentIsProjectDefault ? (
                          <span className="wm-preset-current-state" role="status">当前使用</span>
                        ) : (
                          <button
                            type="button"
                            className="ui-button-primary"
                            disabled={busy}
                            onClick={() => void handleApplyPreset(null)}
                          >
                            恢复默认
                          </button>
                        )}
                      </div>
                    </article>

                    {wallpaperPresets.map((preset) => {
                      const summary = presetSummary(preset.preferences);
                      const missingAssets = summary.assets.filter((id) => !itemById.has(id));
                      const isActive = wallpaperPreferencesEqual(
                        wallpaperPreferences,
                        preset.preferences,
                      );
                      return (
                        <article
                          key={preset.id}
                          className="wm-preset-card"
                          data-active={isActive}
                        >
                          <WallpaperPresetArtwork
                            assetIds={summary.assets}
                            label={preset.name}
                            selected={previewPresetId === preset.id}
                            items={itemById}
                            thumbnails={thumbnailUrls}
                            previewFiles={previewFiles}
                            device={device}
                            onSelect={() => setPreviewPresetId(preset.id)}
                          />
                          <div className="wm-preset-copy">
                            <strong>{preset.name}</strong>
                            <p>{summary.areas} 个已配置区域 · {summary.assets.length} 张引用图片</p>
                            <small>更新于 {formatPresetDate(preset.updatedAt)}</small>
                            {missingAssets.length > 0 && (
                              <small className="wm-preset-missing">
                                缺少 {missingAssets.length} 张壁纸；更新此方案可用当前设置修复。
                              </small>
                            )}
                          </div>
                          <div className="wm-preset-actions" data-active={isActive}>
                            {isActive ? (
                              <span className="wm-preset-current-state" role="status">当前使用</span>
                            ) : (
                              <button
                                type="button"
                                className="ui-button-primary"
                                disabled={busy || missingAssets.length > 0}
                                onClick={() => void handleApplyPreset(preset.id)}
                              >
                                {missingAssets.length ? "图片缺失" : "应用方案"}
                              </button>
                            )}
                            <button
                              type="button"
                              className="ui-button-secondary"
                              disabled={busy || isActive}
                              onClick={() => void handleUpdatePreset(preset)}
                            >
                              更新为当前
                            </button>
                            <button
                              type="button"
                              className="ui-button-secondary"
                              disabled={busy}
                              onClick={() => openRenamePresetDialog(preset)}
                            >
                              <Pencil size={14} aria-hidden="true" />
                              重命名
                            </button>
                            <button
                              type="button"
                              className="ui-button-danger"
                              disabled={busy}
                              onClick={() => void handleDeletePreset(preset)}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              删除
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {wallpaperPresets.length === 0 && (
                    <div className="wm-empty wm-preset-empty">
                      暂无自定义方案
                    </div>
                  )}
                  {feedback && (
                    <p
                      className={feedback.kind === "error" ? "wm-error" : "wm-status"}
                      role={feedback.kind === "error" ? "alert" : "status"}
                    >
                      {feedback.text}
                    </p>
                  )}
                </div>

                <Dialog.Root
                  open={presetDialog !== null}
                  onOpenChange={(open) => {
                    if (!open && !busy) {
                      setPresetDialog(null);
                      setPresetDialogError("");
                    }
                  }}
                >
                  <Dialog.Portal>
                    <Dialog.Overlay className="ui-overlay fixed inset-0 z-[80] data-[state=open]:animate-fade-in" />
                    <Dialog.Content className="ui-modal-surface wm-profile-dialog fixed left-1/2 top-1/2 z-[81] -translate-x-1/2 -translate-y-1/2 outline-hidden">
                      <div className="wm-profile-dialog-heading">
                        <div>
                          <Dialog.Title>
                            {presetDialog?.mode === "rename" ? "重命名方案" : "保存当前为方案"}
                          </Dialog.Title>
                          <Dialog.Description>
                            保存整套页面和内容区域配置；图片继续使用壁纸库中的原文件。
                          </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                          <button
                            type="button"
                            className="wm-import-close"
                            aria-label="关闭方案编辑"
                            disabled={busy}
                          >
                            ×
                          </button>
                        </Dialog.Close>
                      </div>
                      <form
                        className="wm-profile-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handlePresetDialogSubmit();
                        }}
                      >
                        <label className="wm-field" htmlFor="wm-preset-name">
                          <span>方案名称</span>
                          <input
                            id="wm-preset-name"
                            type="text"
                            autoFocus
                            maxLength={maxWallpaperPresetNameLength}
                            value={presetNameDraft}
                            onChange={(event) => {
                              setPresetNameDraft(event.currentTarget.value);
                              setPresetDialogError("");
                            }}
                            placeholder="例如：专注阅读"
                          />
                        </label>
                        {presetDialogError && (
                          <p className="wm-error" role="alert">{presetDialogError}</p>
                        )}
                        <div className="wm-profile-dialog-footer">
                          <Dialog.Close asChild>
                            <button type="button" className="ui-button-secondary" disabled={busy}>
                              取消
                            </button>
                          </Dialog.Close>
                          <button type="submit" className="ui-button-primary" disabled={busy}>
                            {busy ? "正在保存…" : presetDialog?.mode === "rename" ? "保存名称" : "保存方案"}
                          </button>
                        </div>
                      </form>
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>
              </TabsContent>
            </div>

            <aside
              className="wm-preview"
              data-mobile-expanded={mobilePreviewExpanded}
            >
              <div className="wm-preview-toolbar">
                <div>
                  <span className="wm-preview-kicker">
                    {view === "presets" ? "方案预览 · " + previewPresetName : "实时预览"}
                  </span>
                  <strong>
                    {previewItem?.name ?? (previewMissingAsset ? "壁纸图片缺失" : "尚未分配壁纸")}
                  </strong>
                </div>
                <div className="wm-device-switch" role="group" aria-label="预览设备">
                  <button
                    type="button"
                    aria-pressed={device === "desktop"}
                    onClick={() => setDevice("desktop")}
                  >
                    <Monitor size={14} aria-hidden="true" />电脑
                  </button>
                  <button
                    type="button"
                    aria-pressed={device === "mobile"}
                    onClick={() => setDevice("mobile")}
                  >
                    <Smartphone size={14} aria-hidden="true" />手机
                  </button>
                </div>
                <button
                  type="button"
                  className="wm-mobile-preview-toggle"
                  aria-expanded={mobilePreviewExpanded}
                  aria-controls="wm-preview-canvas"
                  onClick={() => setMobilePreviewExpanded((expanded) => !expanded)}
                >
                  {mobilePreviewExpanded ? "收起预览" : "查看预览"}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </div>
              <div
                id="wm-preview-canvas"
                className="wm-preview-canvas"
                data-device={device}
                data-target={isSurfacePreview ? "surface" : "page"}
                style={previewStyle}
                role="group"
                aria-label={
                  (previewPresetName ? previewPresetName + " · " : "") +
                  moduleLabel + " · " + targetLabel + "壁纸预览"
                }
              >
                <div className="wm-preview-page">
                  <div className="wm-preview-page-heading">
                    <small>
                      {moduleLabel}
                    </small>
                    <strong>
                      {isSurfacePreview
                        ? targetLabel
                        : module === "stats"
                          ? "本月概览"
                          : moduleLabel}
                    </strong>
                  </div>
                  <div className="wm-preview-page-content">
                    <div
                      className="wm-preview-content-card"
                      data-wallpaper-preview-target={isSurfacePreview ? "true" : undefined}
                    >
                      <small>{isSurfacePreview ? targetLabel : "内容示意"}</small>
                      <strong>{isSurfacePreview ? "选定区域" : "标题与正文"}</strong>
                      <i />
                      <i />
                    </div>
                    <div className="wm-preview-content-card wm-preview-side-card">
                      <small>模块卡片</small>
                      <i />
                    </div>
                  </div>
                </div>
              </div>
              {previewLoading && <p className="wm-help" role="status">正在读取壁纸…</p>}
              {previewMissingAsset && (
                <p className="wm-error" role="alert">当前设置引用的壁纸不在图库中。</p>
              )}
              {view === "library" && selectedWallpaperIds.length > 1 && (
                <p className="wm-help">预览所选列表中的第一张壁纸。</p>
              )}
            </aside>
            </div>
          )}

          <p className="wm-storage-note">
            壁纸图片与方案保存在本机浏览器；清理站点数据后需重新导入图片并重新保存方案。
          </p>
        </Tabs>
      </section>
    </>
  );
}
