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
  HardDrive,
  ChevronRight,
  ImagePlus,
  Images,
  Layers,
  Monitor,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Search,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useConfirmDialog } from "../ui/Feedback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import * as api from "../../lib/api";
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
import { loadWallpaperAssetFiles, loadWallpaperAssetThumbnails } from "../../lib/wallpapers";
import {
  builtInWallpaperPresets,
  defaultWallpaperPreference,
  defaultWallpaperPreferences,
  newWallpaperId,
  defaultWallpaperSurfacePreference,
  maxWallpapersPerModule,
  maxCustomWallpaperAssets,
  maxWallpaperPresets,
  maxWallpaperPresetNameLength,
  wallpaperPreferenceForTarget,
  wallpaperModuleForTarget,
  wallpaperPreferencesEqual,
  wallpaperSurfaces,
  wallpaperSurfacesForModule,
  wallpaperTargetLabel,
  wallpaperIdForDate,
  wallpaperAssetStoredBytes,
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
  type LocalWallpaperMigrationSource,
  type WallpaperSurfaceId,
} from "../../lib/wallpapers";

type Device = "desktop" | "mobile";
type LibraryUsageFilter = "all" | "referenced" | "unused";
type Feedback = { kind: "error" | "success"; text: string } | null;
type PreviewFiles = { assetId: string; desktopUrl: string; mobileUrl: string };
type ThumbnailUrls = Record<string, { desktop: string; mobile: string }>;

const formatBytes = (bytes: number) => {
  if (bytes <= 0) return "0 KiB";
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KiB";
  return (bytes / 1024 / 1024).toFixed(1) + " MiB";
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
  items,
  thumbnails,
  previewFiles,
  device,
}: {
  assetIds: string[];
  items: Map<string, WallpaperLibraryItem>;
  thumbnails: ThumbnailUrls;
  previewFiles: PreviewFiles | null;
  device: Device;
}) {
  return (
    <span className="wm-preset-art" aria-hidden="true">
      {assetIds.length === 0 ? (
        <span className="wm-preset-art-empty"><Layers size={22} /></span>
      ) : assetIds.slice(0, 4).map((id) => {
        const item = items.get(id);
        const src = thumbnails[id]?.[device] ?? thumbnails[id]?.desktop ??
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
    </span>
  );
}

function WallpaperPagination({
  page,
  pageCount,
  pageStart,
  pageSize,
  total,
  label,
  onChange,
}: {
  page: number;
  pageCount: number;
  pageStart: number;
  pageSize: number;
  total: number;
  label: string;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  const first = pageStart + 1;
  const last = Math.min(pageStart + pageSize, total);
  return (
    <nav className="wm-pagination" aria-label={label}>
      <span>{first}–{last} / 共 {total} 项</span>
      <div>
        <button type="button" className="ui-button-secondary" disabled={page === 1} onClick={() => onChange(page - 1)}>
          上一页
        </button>
        <span aria-live="polite">{page} / {pageCount}</span>
        <button type="button" className="ui-button-secondary" disabled={page === pageCount} onClick={() => onChange(page + 1)}>
          下一页
        </button>
      </div>
    </nav>
  );
}

function libraryItem(asset: WallpaperAssetMetadata): WallpaperLibraryItem {
  return { ...asset, kind: asset.isBuiltIn ? "built-in" : "uploaded" };
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

function configuredWallpaperTargets(preferences: WallpaperPreferences): WallpaperAssignmentTargetId[] {
  const targets: WallpaperAssignmentTargetId[] = [];
  for (const { id: module } of wallpaperModules) {
    if (preferences[module].wallpaperIds.length > 0) targets.push(module);
    for (const surface of wallpaperSurfacesForModule(module)) {
      if (preferences[module].surfaces[surface.id]?.wallpaperIds.length) targets.push(surface.id);
    }
  }
  return targets;
}

export default function WallpaperManagerPanel({
  wallpaperPreferences,
  wallpaperPreferencesReady,
  wallpaperStorageError,
  wallpaperReadOnly,
  wallpaperStorageUsedBytes,
  wallpaperStorageQuotaBytes,
  localWallpaperMigration,
  onMigrateLocalWallpaper,
  onRefreshWallpaperSnapshot,
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
  wallpaperReadOnly: boolean;
  wallpaperStorageUsedBytes: number;
  wallpaperStorageQuotaBytes: number;
  localWallpaperMigration: { source: LocalWallpaperMigrationSource; serverHasUserData: boolean } | null;
  onMigrateLocalWallpaper: () => Promise<boolean>;
  onRefreshWallpaperSnapshot: () => Promise<boolean>;
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
  const allPresets = useMemo(
    () => [...builtInWallpaperPresets, ...wallpaperPresets],
    [wallpaperPresets],
  );
  const [view, setView] = useState<"library" | "modules" | "presets">("library");
  const [presetDialog, setPresetDialog] = useState<{
    mode: "save" | "rename";
    presetId?: string;
  } | null>(null);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [presetDialogError, setPresetDialogError] = useState("");
  const [previewPresetId, setPreviewPresetId] = useState<string | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [previewTargetOverride, setPreviewTargetOverride] = useState<WallpaperAssignmentTargetId | null>(null);
  const [libraryPage, setLibraryPage] = useState(1);
  const [presetPage, setPresetPage] = useState(1);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryUsageFilter, setLibraryUsageFilter] =
    useState<LibraryUsageFilter>("all");
  const [module, setModule] = useState<WallpaperModule>("stats");
  const [surfaceTarget, setSurfaceTarget] = useState<"page" | WallpaperSurfaceId>("page");
  const [device, setDevice] = useState<Device>(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches
      ? "mobile"
      : "desktop",
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedWallpaperIds, setSelectedWallpaperIds] = useState<string[]>([]);
  const [targetIds, setTargetIds] = useState<WallpaperAssignmentTargetId[]>([]);
  const contextualTarget = useRef<WallpaperAssignmentTargetId | null>(null);
  const [expandedTargetGroups, setExpandedTargetGroups] = useState<WallpaperModule[]>(["stats"]);
  const [applyMode, setApplyMode] = useState<WallpaperApplyMode>("append");
  const [importOpen, setImportOpen] = useState(false);
  const [bulkApplyOpen, setBulkApplyOpen] = useState(false);
  const [wallpaperName, setWallpaperName] = useState("");
  const [desktopFile, setDesktopFile] = useState<File | null>(null);
  const [mobileFile, setMobileFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [localMigrationOpen, setLocalMigrationOpen] = useState(false);
  const promptedMigrationId = useRef<string | null>(null);
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
    wallpaperModules.find((item) => item.id === module)?.label ?? "当前页面";
  const targetLabel =
    surfaceTarget === "page"
      ? "整个页面"
      : wallpaperSurfaces.find((surface) => surface.id === surfaceTarget)?.label ?? "内容区域";
  const items = useMemo<WallpaperLibraryItem[]>(
    () => wallpaperAssets.map(libraryItem),
    [wallpaperAssets],
  );
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const wallpaperAssetSignature = JSON.stringify(wallpaperAssets);
  const wallpaperUsage = useMemo(() => {
    const usage = new Map<string, string[]>();
    const addReference = (id: string, label: string) => {
      const references = usage.get(id) ?? [];
      if (!references.includes(label)) references.push(label);
      usage.set(id, references);
    };

    for (const module of wallpaperModules) {
      const preference = wallpaperPreferences[module.id];
      for (const id of preference.wallpaperIds) {
        addReference(id, wallpaperTargetLabel(module.id));
      }
      for (const surface of wallpaperSurfacesForModule(module.id)) {
        for (const id of preference.surfaces[surface.id]?.wallpaperIds ?? []) {
          addReference(id, wallpaperTargetLabel(surface.id));
        }
      }
    }
    for (const preset of allPresets) {
      for (const id of presetSummary(preset.preferences).assets) {
        addReference(id, "方案 · " + preset.name);
      }
    }
    return usage;
  }, [allPresets, wallpaperPreferences]);
  const filteredItems = useMemo(() => {
    const query = librarySearch.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (query && !item.name.toLocaleLowerCase().includes(query)) return false;
      const referenced = (wallpaperUsage.get(item.id)?.length ?? 0) > 0;
      return libraryUsageFilter === "all" ||
        (libraryUsageFilter === "referenced" && referenced) ||
        (libraryUsageFilter === "unused" && !referenced);
    });
  }, [items, librarySearch, libraryUsageFilter, wallpaperUsage]);
  const preferredLibraryPageSize = isMobile ? 4 : 6;
  const libraryPageCount = Math.max(1, Math.ceil(filteredItems.length / preferredLibraryPageSize));
  const visibleLibraryPage = Math.min(libraryPage, libraryPageCount);
  const libraryBasePageSize = Math.floor(filteredItems.length / libraryPageCount);
  const largerLibraryPages = filteredItems.length % libraryPageCount;
  const visibleLibraryStart =
    (visibleLibraryPage - 1) * libraryBasePageSize + Math.min(visibleLibraryPage - 1, largerLibraryPages);
  const visibleLibraryPageSize = libraryBasePageSize + (visibleLibraryPage <= largerLibraryPages ? 1 : 0);
  const visibleLibraryItems = filteredItems.slice(
    visibleLibraryStart,
    visibleLibraryStart + visibleLibraryPageSize,
  );
  const presetPageSize = isMobile ? 3 : 4;
  const presetPageCount = Math.max(1, Math.ceil(allPresets.length / presetPageSize));
  const visiblePresetPage = Math.min(presetPage, presetPageCount);
  const visiblePresets = allPresets.slice(
    (visiblePresetPage - 1) * presetPageSize,
    visiblePresetPage * presetPageSize,
  );
  const referencedItemCount = items.reduce(
    (count, item) => count + ((wallpaperUsage.get(item.id)?.length ?? 0) > 0 ? 1 : 0),
    0,
  );
  const unusedItemCount = items.length - referencedItemCount;
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
    : allPresets.find((preset) =>
        wallpaperPreferencesEqual(wallpaperPreferences, preset.preferences),
      ) ?? null;
  const previewPreferences = view === "presets"
    ? previewPresetId === "__project-default__"
      ? projectDefaultPreferences
      : allPresets.find((preset) => preset.id === previewPresetId)?.preferences ??
        wallpaperPreferences
    : wallpaperPreferences;
  const configuredPreviewTargets = view === "presets"
    ? configuredWallpaperTargets(previewPreferences)
    : [];
  const previewTargetId: WallpaperAssignmentTargetId = view === "presets"
    ? previewTargetOverride && configuredPreviewTargets.includes(previewTargetOverride)
      ? previewTargetOverride
      : configuredPreviewTargets.find((target) => wallpaperModuleForTarget(target) === module)
        ?? configuredPreviewTargets[0]
        ?? targetId
    : targetId;
  const previewModule = wallpaperModuleForTarget(previewTargetId);
  const previewModuleLabel = wallpaperModules.find((item) => item.id === previewModule)?.label ?? "页面";
  const previewTargetLabel = wallpaperTargetLabel(previewTargetId);
  const previewHeading = previewTargetId === previewModule
    ? previewModuleLabel + "页面"
    : wallpaperSurfaces.find((surface) => surface.id === previewTargetId)?.label ?? previewModuleLabel;
  const previewTargetPreference = view === "library"
    ? previewPreferences[module]
    : wallpaperPreferenceForTarget(previewPreferences, previewTargetId);
  const visiblePreviewAssetId = previewAssetId && filteredItems.some((item) => item.id === previewAssetId)
    ? previewAssetId
    : visibleLibraryItems[0]?.id;
  const previewWallpaperId = view === "library"
    ? visiblePreviewAssetId ?? wallpaperIdForDate(previewTargetPreference)
    : wallpaperIdForDate(previewTargetPreference);
  const previewItem = previewWallpaperId
    ? itemById.get(previewWallpaperId) ?? null
    : null;
  const previewMissingAsset = !!previewWallpaperId && !itemById.has(previewWallpaperId);
  const previewThumbnail = previewWallpaperId ? thumbnailUrls[previewWallpaperId] : null;
  const activePreviewUrls = previewFiles?.assetId === previewWallpaperId
    ? previewFiles
    : previewThumbnail && previewWallpaperId
      ? { assetId: previewWallpaperId, desktopUrl: previewThumbnail.desktop, mobileUrl: previewThumbnail.mobile }
      : null;
  const isSurfacePreview = view !== "library" && previewTargetId !== previewModule;
  const previewPresetName = view === "presets"
    ? previewPresetId === "__project-default__"
      ? "项目默认"
      : previewPresetId
        ? allPresets.find((preset) => preset.id === previewPresetId)?.name ?? "当前配置"
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
    (id) => itemById.get(id)?.kind === "uploaded",
  );
  const totalStorageBytes = wallpaperStorageUsedBytes;
  const customWallpaperCount = wallpaperAssets.filter(
    (asset) => !asset.isBuiltIn,
  ).length;
  const assetCountAtCapacity =
    customWallpaperCount >= maxCustomWallpaperAssets;
  const libraryAtCapacity =
    assetCountAtCapacity || totalStorageBytes >= wallpaperStorageQuotaBytes;
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
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    setLibraryPage(1);
  }, [librarySearch, libraryUsageFilter, isMobile]);

  useEffect(() => {
    if (wallpaperPreferencesReady) void onRefreshWallpaperSnapshot();
  }, [view, wallpaperPreferencesReady, onRefreshWallpaperSnapshot]);

  useEffect(() => {
    const migrationId = localWallpaperMigration?.source.migrationId;
    if (!migrationId || promptedMigrationId.current === migrationId) return;
    promptedMigrationId.current = migrationId;
    setLocalMigrationOpen(true);
  }, [localWallpaperMigration?.source.migrationId]);

  useEffect(() => {
    overlayRef.current = preference.overlay;
    setOverlayDraft(preference.overlay);
  }, [targetId, preference.overlay]);

  useEffect(() => {
    let current = true;
    const urls = new Set<string>();
    setThumbnailUrls({});
    void Promise.all(wallpaperAssets.map(async (asset) => {
      const read = async (variant: "desktop-thumbnail" | "mobile-thumbnail") => {
        try {
          return await api.getWallpaperAssetFile(asset.id, variant);
        } catch {
          const [legacyThumbnails, files] = await Promise.all([
            loadWallpaperAssetThumbnails(),
            loadWallpaperAssetFiles(asset.id),
          ]);
          const local = legacyThumbnails.find((item) => item.id === asset.id);
          if (variant === "desktop-thumbnail") {
            return local?.desktopThumbnailBlob ?? files?.desktopBlob ?? files?.mobileBlob ?? null;
          }
          return local?.mobileThumbnailBlob ?? local?.desktopThumbnailBlob ?? files?.mobileBlob ?? files?.desktopBlob ?? null;
        }
      };
      const [desktopBlob, mobileBlob] = await Promise.all([
        read("desktop-thumbnail"),
        read("mobile-thumbnail"),
      ]);
      return { id: asset.id, desktopBlob, mobileBlob };
    }))
      .then((thumbnails) => {
        if (!current) return;
        const next: ThumbnailUrls = {};
        for (const thumbnail of thumbnails) {
          if (!thumbnail.desktopBlob) continue;
          const desktop = URL.createObjectURL(thumbnail.desktopBlob);
          const mobileBlob = thumbnail.mobileBlob ?? thumbnail.desktopBlob;
          const mobile = mobileBlob === thumbnail.desktopBlob
            ? desktop
            : URL.createObjectURL(mobileBlob);
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
  }, [wallpaperAssetSignature]);

  useEffect(() => {
    let current = true;
    const urls = new Set<string>();
    setPreviewFiles(null);
    setPreviewLoading(false);
    if (!previewWallpaperId) {
      return () => {
        current = false;
      };
    }
    setPreviewLoading(true);
    const readPreview = async (variant: "desktop" | "mobile") => {
      try {
        return await api.getWallpaperAssetFile(previewWallpaperId, variant);
      } catch {
        const local = await loadWallpaperAssetFiles(previewWallpaperId);
        if (!local) throw new Error("wallpaper image unavailable");
        return variant === "mobile"
          ? local.mobileBlob ?? local.desktopBlob
          : local.desktopBlob ?? local.mobileBlob;
      }
    };
    void Promise.all([readPreview("desktop"), readPreview("mobile")])
      .then(([desktopBlob, mobileBlob]) => {
        if (!current) return;
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
  }, [previewWallpaperId]);

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
    setPreviewAssetId(id);
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
    setSelectedWallpaperIds(filteredItems.slice(0, maxWallpapersPerModule).map((item) => item.id));
    setFeedback(
      filteredItems.length > maxWallpapersPerModule
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
    if (open && targetIds.length === 0 && contextualTarget.current) {
      setTargetIds([contextualTarget.current]);
      const owner = wallpaperModuleForTarget(contextualTarget.current);
      setExpandedTargetGroups((current) => current.includes(owner) ? current : [...current, owner]);
    }
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
            text: "壁纸设置未同步到服务器；原有分配保持不变。",
          },
    );
    if (applied) {
      setTargetIds([]);
      setBulkApplyOpen(false);
      if (contextualTarget.current) setView("modules");
      contextualTarget.current = null;
    }
  };

  const handleMigrateLocalWallpaper = async () => {
    if (!localWallpaperMigration || busy || wallpaperReadOnly) return;
    setBusy(true);
    const migrated = await onMigrateLocalWallpaper();
    setBusy(false);
    if (migrated) {
      setLocalMigrationOpen(false);
      setFeedback({ kind: "success", text: "本机壁纸已迁移到当前服务器；本机副本仍保留作离线缓存。" });
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
    if (assetCountAtCapacity) {
      setFeedback({
        kind: "error",
        text:
          "壁纸库最多保存 " +
          maxCustomWallpaperAssets +
          " 张自定义壁纸；请删除未引用图片后再添加。",
      });
      return;
    }
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
      const incomingBytes = wallpaperAssetStoredBytes(metadata);
      if (totalStorageBytes + incomingBytes > wallpaperStorageQuotaBytes) {
        throw new Error(
          "服务器壁纸库容量上限为 " + formatBytes(wallpaperStorageQuotaBytes) + "；删除未引用图片或选择更小的图片后重试。",
        );
      }
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
        throw new Error(
          "壁纸未能上传到服务器；请检查网络和服务器容量后重试。",
        );
      }
      setSelectedWallpaperIds([id]);
      setPreviewAssetId(id);
      setLibraryPage(1);
      if (contextualTarget.current) {
        setTargetIds([contextualTarget.current]);
        setBulkApplyOpen(true);
      } else {
        setTargetIds([]);
      }
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
    if (allPresets.some((preset) =>
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
    setPresetPage(1);
    setFeedback({
      kind: "success",
      text: presetDialog.mode === "rename" ? "方案名称已更新。" : "当前壁纸设置已保存为方案。",
    });
  };

  const handleApplyPreset = async (presetId: string | null) => {
    if (busy) return;
    const isDefault = presetId === null;
    const preset = presetId
      ? allPresets.find((item) => item.id === presetId)
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
      setPreviewTargetOverride(null);
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
    if (busy || preset.source === "built-in") return;
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
    if (busy || preset.source === "built-in") return;
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
    if (previewPresetId === preset.id) {
      setPreviewPresetId(null);
      setPreviewTargetOverride(null);
    }
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
                <p>整理壁纸，并为页面和内容区域设置背景。</p>
              </div>
            </div>
            <div className="wm-heading-tools">
              <TabsList className="wm-view-switch" aria-label="壁纸管理视图">
                <TabsTrigger value="library" disabled={!wallpaperPreferencesReady}>
                  壁纸库
                  <span>{items.length}</span>
                </TabsTrigger>
                <TabsTrigger value="modules" disabled={!wallpaperPreferencesReady}>
                  页面与区域
                </TabsTrigger>
                <TabsTrigger value="presets" disabled={!wallpaperPreferencesReady}>
                  壁纸方案
                  <span>{wallpaperPresets.length + builtInWallpaperPresets.length}</span>
                </TabsTrigger>
              </TabsList>
              <button
                type="button"
                className="ui-button-secondary wm-preview-trigger"
                aria-expanded={previewOpen}
                aria-controls={previewOpen ? "wm-preview-panel" : undefined}
                onClick={() => setPreviewOpen((open) => !open)}
              >
                {previewOpen ? "收起预览" : "查看效果"}
              </button>
            </div>
          </header>

          {localWallpaperMigration && (
            <div className="wm-sync-banner wm-migration-banner" role="status">
              <span>
                发现此设备有 {localWallpaperMigration.source.assets.length} 张旧壁纸、{localWallpaperMigration.source.presets.length} 组方案和本机分配。
              </span>
              <button type="button" className="ui-button-secondary" onClick={() => setLocalMigrationOpen(true)}>
                查看迁移
              </button>
            </div>
          )}
          <Dialog.Root
            open={localMigrationOpen && !!localWallpaperMigration}
            onOpenChange={(open) => {
              setLocalMigrationOpen(open);
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className="ui-overlay fixed inset-0 z-[70] data-[state=open]:animate-fade-in" />
              <Dialog.Content className="ui-modal-surface wm-bulk-dialog fixed left-1/2 top-1/2 z-[71] -translate-x-1/2 -translate-y-1/2 outline-hidden">
                <div className="wm-bulk-dialog-heading">
                  <span className="wm-bulk-dialog-icon" aria-hidden="true"><HardDrive size={17} /></span>
                  <div>
                    <Dialog.Title>迁移此设备的旧壁纸</Dialog.Title>
                    <Dialog.Description>先查看将同步到当前服务器的数据，再确认迁移。</Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button type="button" className="wm-import-close" aria-label="稍后迁移">×</button>
                  </Dialog.Close>
                </div>
                {localWallpaperMigration && (
                  <div className="wm-migration-summary">
                    <p><strong>{localWallpaperMigration.source.assets.length}</strong> 张图片 · <strong>{localWallpaperMigration.source.presets.length}</strong> 组保存方案</p>
                    <p>{localWallpaperMigration.serverHasUserData
                      ? "服务器已有壁纸数据：服务器当前配置会保留；本机当前配置会作为一组新方案保存，图片与本机方案会合并。"
                      : "服务器目前只有项目素材和默认空分配：本机当前分配会成为服务器当前配置，图片与方案会一起迁入。"}</p>
                    <p>迁移成功后，同一服务器上的设备会共享这些图片和配置。本机副本保留；取消或容量不足时可以稍后重试。</p>
                  </div>
                )}
                <div className="wm-bulk-dialog-footer">
                  <Dialog.Close asChild>
                    <button type="button" className="ui-button-secondary">稍后</button>
                  </Dialog.Close>
                  <button type="button" className="ui-button-primary" disabled={busy || wallpaperReadOnly} onClick={() => void handleMigrateLocalWallpaper()}>
                    {busy ? "正在迁移…" : "确认并迁移"}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          {wallpaperStorageError && (
            <div className="wm-sync-banner" role="status">
              <span>{wallpaperStorageError}</span>
              <button type="button" className="ui-button-secondary" onClick={() => void onRefreshWallpaperSnapshot()}>
                重试连接
              </button>
            </div>
          )}
          {!wallpaperPreferencesReady ? (
            <div className="wm-storage-loading" role="status">正在同步服务器壁纸数据…</div>
          ) : (
            <div className="wm-layout" data-preview-open={previewOpen}>
            <div className="wm-main">
              <TabsContent value="library" className="wm-tab-panel">
                <div className="wm-library">
                  <div className="wm-library-toolbar">
                    <div className="wm-library-heading">
                      <div>
                        <strong>壁纸图库</strong>
                        <span>
                          {customWallpaperCount} / {maxCustomWallpaperAssets} 张自定义 · {wallpaperAssets.length - customWallpaperCount} 张内置
                        </span>
                      </div>
                    </div>
                    <div className="wm-toolbar-actions">
                      <span
                        className="wm-storage-pill"
                        role="status"
                        aria-label={
                          "服务器图库占用 " +
                          formatBytes(totalStorageBytes) +
                          "，上限 " +
                          formatBytes(wallpaperStorageQuotaBytes)
                        }
                      >
                        <HardDrive size={14} aria-hidden="true" />
                        <strong>{formatBytes(totalStorageBytes)} / {formatBytes(wallpaperStorageQuotaBytes)}</strong>
                      </span>
                      <button
                        type="button"
                        className="ui-button-primary wm-import-trigger"
                        aria-expanded={importOpen}
                        disabled={busy || wallpaperReadOnly}
                        title={
                          assetCountAtCapacity
                            ? "自定义壁纸已达 " + maxCustomWallpaperAssets + " 张上限"
                            : totalStorageBytes >= wallpaperStorageQuotaBytes
                              ? "壁纸库容量已满；请删除未引用图片后再添加"
                              : undefined
                        }
                        onClick={() => setImportOpen((open) => !open)}
                      >
                        <Plus size={15} aria-hidden="true" />
                        {importOpen ? "关闭导入" : "添加壁纸"}
                      </button>
                    </div>
                  </div>

                  <div className="wm-library-filters">
                    <label className="wm-library-search">
                      <Search size={15} aria-hidden="true" />
                      <input
                        type="search"
                        aria-label="按名称搜索壁纸"
                        placeholder="搜索壁纸名称"
                        value={librarySearch}
                        onChange={(event) => setLibrarySearch(event.currentTarget.value)}
                      />
                    </label>
                    <div
                      className="wm-library-usage-filter"
                      role="group"
                      aria-label="按壁纸引用状态筛选"
                    >
                      <button
                        type="button"
                        aria-pressed={libraryUsageFilter === "all"}
                        onClick={() => setLibraryUsageFilter("all")}
                      >
                        全部 <small>{items.length}</small>
                      </button>
                      <button
                        type="button"
                        aria-pressed={libraryUsageFilter === "referenced"}
                        onClick={() => setLibraryUsageFilter("referenced")}
                      >
                        已引用 <small>{referencedItemCount}</small>
                      </button>
                      <button
                        type="button"
                        aria-pressed={libraryUsageFilter === "unused"}
                        onClick={() => setLibraryUsageFilter("unused")}
                      >
                        未引用 <small>{unusedItemCount}</small>
                      </button>
                    </div>
                    <span className="wm-library-result-count" role="status">
                      {filteredItems.length === items.length
                        ? "共 " + items.length + " 张"
                        : "匹配 " + filteredItems.length + " / " + items.length}
                    </span>
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
                          disabled={busy || wallpaperReadOnly}
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
                            disabled={busy || wallpaperReadOnly}
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
                            disabled={busy || wallpaperReadOnly}
                            onChange={(event) => updateFile("mobile", event)}
                          />
                        </label>
                      </div>
                      <div className="wm-import-footer">
                        <p>
                          图片保存在当前服务器并可跨设备共享。最多保存 {maxCustomWallpaperAssets} 张自定义壁纸；总量上限 {formatBytes(wallpaperStorageQuotaBytes)}。
                        </p>
                        <button
                          type="button"
                          className="ui-button-primary"
                          disabled={
                            busy || wallpaperReadOnly ||
                            (!desktopFile && !mobileFile) ||
                            libraryAtCapacity
                          }
                          onClick={() => void handleAddWallpaper()}
                        >
                          <Plus size={15} aria-hidden="true" />
                          {busy
                            ? "正在优化并保存…"
                            : libraryAtCapacity ? "壁纸库已达上限" : "保存到壁纸库"}
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
                          <small>
                            {selectedWallpaperIds.length === 1
                              ? "下一步选择要应用的页面或区域。"
                              : "可统一应用到多个页面区域。"}
                          </small>
                        </div>
                      </div>
                      <div className="wm-selection-actions">
                        <button
                          type="button"
                          className="ui-button-ghost wm-text-action"
                          onClick={selectAllWallpapers}
                        >
                          全选筛选结果
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
                              {selectedWallpaperIds.length === 1 ? "选择应用位置" : "批量应用"}
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
                                  disabled={busy || wallpaperReadOnly || targetIds.length === 0}
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
                          disabled={busy || wallpaperReadOnly || deletableSelection.length === 0}
                          onClick={() => void handleDeleteSelection()}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          删除
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="wm-library-grid" role="group" aria-label="壁纸图库">
                    {filteredItems.length === 0 && (
                      <p className="wm-library-empty" role="status">
                        没有符合条件的壁纸；调整搜索词或引用状态筛选。
                      </p>
                    )}
                    {visibleLibraryItems.map((item) => {
                      const selected = selectedWallpaperIds.includes(item.id);
                      const usedIn = wallpaperUsage.get(item.id) ?? [];
                      const assignmentRefs = usedIn.filter((reference) => !reference.startsWith("方案 · "));
                      const presetRefs = usedIn.length - assignmentRefs.length;
                      const usageSummary = [
                        assignmentRefs.length ? "用于 " + assignmentRefs.length + " 处" : "",
                        presetRefs ? presetRefs + " 组方案引用" : "",
                      ].filter(Boolean).join(" · ") || "尚未引用";
                      const usageDetails = usedIn.length
                        ? "引用于 " + usedIn.join("、")
                        : "尚未被页面或方案引用";
                      const thumbnail = thumbnailUrls[item.id]?.[device] ??
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
                            "，" + usageDetails
                          }
                          title={usageDetails}
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
                            <i className="wm-asset-selected" data-selected={selected} aria-hidden="true">
                              {selected && <Check size={14} />}
                            </i>
                          </span>
                          <span className="wm-asset-copy">
                            <strong>{item.name}</strong>
                            <small>
                              {item.kind === "built-in"
                                ? "内置壁纸 · 双端适配"
                                : "自定义壁纸 · " + formatBytes(item.optimizedBytes)}
                            </small>
                            <small>{usageSummary}</small>
                          </span>
                        </button>
                      );
                    })}

                  </div>
                  <WallpaperPagination
                    page={visibleLibraryPage}
                    pageCount={libraryPageCount}
                    pageStart={visibleLibraryStart}
                    pageSize={visibleLibraryPageSize}
                    total={filteredItems.length}
                    label="壁纸图库翻页"
                    onChange={setLibraryPage}
                  />
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
                        disabled={wallpaperReadOnly}
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
                      disabled={wallpaperReadOnly}
                      onClick={() => {
                        contextualTarget.current = targetId;
                        setSelectedWallpaperIds([]);
                        setTargetIds([targetId]);
                        setView("library");
                      }}
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
                    <ol
                      className="wm-assigned-list"
                      aria-label={isMobile ? "已分配壁纸" : "已分配壁纸，可滚动浏览"}
                      tabIndex={isMobile ? undefined : 0}
                    >
                      {assignedItems.map((item, index) => {
                        const thumbnail = thumbnailUrls[item.id]?.desktop ??
                          (previewFiles?.assetId === item.id ? previewFiles.desktopUrl : "");
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
                                disabled={wallpaperReadOnly || index === 0}
                                aria-label={"将" + item.name + "上移"}
                                onClick={() => reorderModuleWallpapers(index, -1)}
                              >
                                <ArrowUp size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="wm-icon-button"
                                disabled={wallpaperReadOnly || index === assignedItems.length - 1}
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
                        disabled={wallpaperReadOnly}
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
                        disabled={wallpaperReadOnly}
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
                        disabled={busy || wallpaperReadOnly}
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
                      disabled={busy || wallpaperReadOnly || missingCurrentAssets.length > 0 || wallpaperPresets.length >= maxWallpaperPresets}
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
                    <small>
                      {builtInWallpaperPresets.length} 个内置 · {wallpaperPresets.length} 个自定义
                    </small>
                  </div>

                  <div className="wm-preset-list" role="group" aria-label="壁纸方案列表">
                    <article
                      className="wm-preset-card wm-preset-card-default"
                      data-active={currentIsProjectDefault}
                      data-previewed={previewPresetId === "__project-default__"}
                    >
                      <button
                        type="button"
                        className="wm-preset-preview"
                        aria-pressed={previewPresetId === "__project-default__"}
                        aria-label="预览项目默认背景"
                        onClick={() => {
                          setPreviewPresetId("__project-default__");
                          setPreviewTargetOverride(null);
                        }}
                      >
                        <WallpaperPresetArtwork
                          assetIds={projectDefaultSummary.assets}
                          items={itemById}
                          thumbnails={thumbnailUrls}
                          previewFiles={previewFiles}
                          device={device}
                        />
                        <span className="wm-preset-copy">
                          <strong>项目默认</strong>
                          <span>所有页面和内容区域使用原有背景</span>
                        </span>
                      </button>
                      <div className="wm-preset-actions">
                        {currentIsProjectDefault ? (
                          <span className="wm-preset-current-state" role="status">当前使用</span>
                        ) : (
                          <button
                            type="button"
                            className="ui-button-secondary"
                            disabled={busy || wallpaperReadOnly}
                            onClick={() => void handleApplyPreset(null)}
                          >
                            恢复默认
                          </button>
                        )}
                      </div>
                    </article>

                    {visiblePresets.map((preset) => {
                      const summary = presetSummary(preset.preferences);
                      const missingAssets = summary.assets.filter((id) => !itemById.has(id));
                      const isActive = wallpaperPreferencesEqual(wallpaperPreferences, preset.preferences);
                      return (
                        <article
                          key={preset.id}
                          className="wm-preset-card"
                          data-active={isActive}
                          data-previewed={previewPresetId === preset.id}
                        >
                          <button
                            type="button"
                            className="wm-preset-preview"
                            aria-pressed={previewPresetId === preset.id}
                            aria-label={"预览方案：" + preset.name}
                            onClick={() => {
                              setPreviewPresetId(preset.id);
                              setPreviewTargetOverride(null);
                            }}
                          >
                            <WallpaperPresetArtwork
                              assetIds={summary.assets}
                              items={itemById}
                              thumbnails={thumbnailUrls}
                              previewFiles={previewFiles}
                              device={device}
                            />
                            <span className="wm-preset-copy">
                              <strong>{preset.name}</strong>
                              <span>{summary.areas} 个已配置区域 · {summary.assets.length} 张图片</span>
                              <small>{preset.source === "built-in" ? "内置方案" : "更新于 " + formatPresetDate(preset.updatedAt)}</small>
                              {missingAssets.length > 0 && (
                                <small className="wm-preset-missing">缺少 {missingAssets.length} 张图片，请更新方案。</small>
                              )}
                            </span>
                          </button>
                          <div className="wm-preset-actions">
                            {isActive ? (
                              <span className="wm-preset-current-state" role="status">当前使用</span>
                            ) : (
                              <button
                                type="button"
                                className="ui-button-secondary"
                                disabled={busy || wallpaperReadOnly || missingAssets.length > 0}
                                onClick={() => void handleApplyPreset(preset.id)}
                              >
                                {missingAssets.length ? "图片缺失" : "应用"}
                              </button>
                            )}
                            {preset.source !== "built-in" && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className="wm-preset-more"
                                    aria-label={"更多方案操作：" + preset.name}
                                    disabled={busy || wallpaperReadOnly}
                                  >
                                    <MoreHorizontal size={18} aria-hidden="true" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem disabled={isActive} onSelect={() => void handleUpdatePreset(preset)}>
                                    更新为当前设置
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => openRenamePresetDialog(preset)}>
                                    重命名
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-[var(--ui-danger-text)]" onSelect={() => void handleDeletePreset(preset)}>
                                    删除方案
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <WallpaperPagination
                    page={visiblePresetPage}
                    pageCount={presetPageCount}
                    pageStart={(visiblePresetPage - 1) * presetPageSize}
                    pageSize={presetPageSize}
                    total={allPresets.length}
                    label="壁纸方案翻页"
                    onChange={setPresetPage}
                  />

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
                            disabled={busy || wallpaperReadOnly}
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
                            <button type="button" className="ui-button-secondary" disabled={busy || wallpaperReadOnly}>
                              取消
                            </button>
                          </Dialog.Close>
                          <button type="submit" className="ui-button-primary" disabled={busy || wallpaperReadOnly}>
                            {busy ? "正在保存…" : presetDialog?.mode === "rename" ? "保存名称" : "保存方案"}
                          </button>
                        </div>
                      </form>
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>
              </TabsContent>
            </div>

            {previewOpen && (
            <aside id="wm-preview-panel" className="wm-preview" aria-label="壁纸效果预览">
              <div className="wm-preview-toolbar">
                <div>
                  <span className="wm-preview-kicker">
                    {view === "presets" ? "方案预览" : view === "library" ? "图库预览" : "区域效果"}
                  </span>
                  <strong>
                    {view === "presets"
                      ? previewPresetName
                      : previewItem?.name ?? (previewMissingAsset ? "壁纸图片缺失" : "原有背景")}
                  </strong>
                </div>
                <div className="wm-device-switch" role="group" aria-label="预览设备">
                  <button
                    type="button"
                    aria-pressed={device === "desktop"}
                    onClick={() => setDevice("desktop")}
                  >
                    <Monitor size={16} aria-hidden="true" />电脑
                  </button>
                  <button
                    type="button"
                    aria-pressed={device === "mobile"}
                    onClick={() => setDevice("mobile")}
                  >
                    <Smartphone size={16} aria-hidden="true" />手机
                  </button>
                </div>
                <button
                  type="button"
                  className="wm-icon-button wm-preview-close"
                  aria-label="收起壁纸预览"
                  onClick={() => setPreviewOpen(false)}
                >
                  ×
                </button>
              </div>
              {view === "presets" && configuredPreviewTargets.length > 0 && (
                <div className="wm-preview-target-row">
                  <div>
                    <strong>预览区域</strong>
                    <span>{configuredPreviewTargets.length} 个区域已配置</span>
                  </div>
                  <Select
                    value={previewTargetId}
                    onValueChange={(value) => setPreviewTargetOverride(value as WallpaperAssignmentTargetId)}
                  >
                    <SelectTrigger className="wm-preview-target-select" aria-label="选择方案预览区域">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {configuredPreviewTargets.map((target) => (
                        <SelectItem key={target} value={target}>
                          {wallpaperTargetLabel(target)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div
                id="wm-preview-canvas"
                className="wm-preview-canvas"
                data-device={device}
                data-target={isSurfacePreview ? "surface" : "page"}
                style={previewStyle}
                role="group"
                aria-label={(previewPresetName ? previewPresetName + " · " : "") + previewTargetLabel + "壁纸预览"}
              >
                <div className="wm-preview-page">
                  <div className="wm-preview-page-heading">
                    <small>{previewModuleLabel}</small>
                    <strong>{previewHeading}</strong>
                  </div>
                  <div className="wm-preview-page-content">
                    <div
                      className="wm-preview-content-card"
                      data-wallpaper-preview-target={isSurfacePreview ? "true" : undefined}
                    >
                      <small>{isSurfacePreview ? "内容区域" : "内容示意"}</small>
                      <strong>标题与正文</strong>
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
              <p className="wm-preview-caption">
                {view === "library"
                  ? "预览当前图片；应用前不会更改页面背景。"
                  : "页面内容为示意，壁纸与遮罩反映所选区域的配置。"}
              </p>
              {previewLoading && <p className="wm-help" role="status">正在读取壁纸…</p>}
              {previewMissingAsset && (
                <p className="wm-error" role="alert">当前设置引用的壁纸不在图库中。</p>
              )}
            </aside>
            )}
            </div>
          )}

        </Tabs>
      </section>
    </>
  );
}
