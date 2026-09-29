export const wallpaperModules = [
  { id: "today", label: "今日记录" },
  { id: "records", label: "历史记录与归档" },
  { id: "search", label: "搜索" },
  { id: "knowledge", label: "知识条目" },
  { id: "review", label: "记忆复习" },
  { id: "stats", label: "统计" },
  { id: "reviews", label: "周期回顾" },
  { id: "settings", label: "设置" },
] as const;

export type WallpaperModule = (typeof wallpaperModules)[number]["id"];
export const wallpaperSurfaces = [
  { id: "today.editor", module: "today", label: "正文编辑区" },
  { id: "today.preview", module: "today", label: "实时预览" },
  { id: "records.timeline", module: "records", label: "记录时间线" },
  { id: "records.detail", module: "records", label: "记录详情" },
  { id: "search.results", module: "search", label: "搜索结果" },
  { id: "knowledge.library", module: "knowledge", label: "知识浏览" },
  { id: "knowledge.reader", module: "knowledge", label: "知识正文" },
  { id: "review.session", module: "review", label: "复习题与答案" },
  { id: "review.schedule", module: "review", label: "接下来 7 天" },
  { id: "stats.monthlyOverview", module: "stats", label: "本月概览" },
  { id: "stats.metrics", module: "stats", label: "本月指标" },
  { id: "stats.calendar", module: "stats", label: "记录月历" },
  { id: "stats.dailyWords", module: "stats", label: "每日字数" },
  { id: "stats.quickReview", module: "stats", label: "周期复盘入口" },
  { id: "stats.moods", module: "stats", label: "心情记录" },
  { id: "stats.reviewTrends", module: "stats", label: "近 30 天复习" },
  { id: "stats.upcoming", module: "stats", label: "复习安排" },
  { id: "stats.heatmap", module: "stats", label: "一年复习热力图" },
  { id: "stats.knowledge", module: "stats", label: "知识整理" },
  { id: "stats.generate", module: "stats", label: "生成周期复盘" },
  { id: "reviews.archive", module: "reviews", label: "复盘档案" },
] as const satisfies readonly {
  id: string;
  module: WallpaperModule;
  label: string;
}[];
export type WallpaperSurfaceId = (typeof wallpaperSurfaces)[number]["id"];
export type WallpaperAssignmentTargetId = WallpaperModule | WallpaperSurfaceId;
export type WallpaperApplyMode = "append" | "replace";
export type WallpaperPreferenceValue = {
  wallpaperIds: string[];
  overlay: number;
  cycleDaily: boolean;
};
export type WallpaperPreference = WallpaperPreferenceValue & {
  surfaces: Partial<Record<WallpaperSurfaceId, WallpaperPreferenceValue>>;
};
export type WallpaperPreferences = Record<WallpaperModule, WallpaperPreference>;
export type WallpaperPreset = {
  id: string;
  name: string;
  schemaVersion: 1;
  createdAt: number;
  updatedAt: number;
  preferences: WallpaperPreferences;
  source?: "built-in";
};

export function wallpaperSurfacesForModule(module: WallpaperModule) {
  return wallpaperSurfaces.filter((surface) => surface.module === module);
}

export function wallpaperModuleForTarget(
  target: WallpaperAssignmentTargetId,
): WallpaperModule {
  if (wallpaperModules.some((module) => module.id === target)) {
    return target as WallpaperModule;
  }
  return (
    wallpaperSurfaces.find((surface) => surface.id === target)?.module ?? "today"
  );
}

export function wallpaperTargetLabel(target: WallpaperAssignmentTargetId): string {
  const module = wallpaperModules.find(({ id }) => id === wallpaperModuleForTarget(target));
  if (wallpaperModules.some((item) => item.id === target)) {
    return (module?.label ?? "页面") + " · 整个页面";
  }
  const surface = wallpaperSurfaces.find((item) => item.id === target);
  return (module?.label ?? "页面") + " · " + (surface?.label ?? "内容区");
}
export type WallpaperAssetMetadata = {
  id: string;
  cacheVersion?: string;
  name: string;
  createdAt: number;
  originalBytes: number;
  optimizedBytes: number;
  desktopWidth: number;
  desktopHeight: number;
  mobileWidth?: number;
  mobileHeight?: number;
  desktopThumbnailBytes?: number;
  mobileThumbnailBytes?: number;
  isBuiltIn?: boolean;
  desktopName?: string;
  mobileName?: string;
};
export type WallpaperAssetFiles = {
  id: string;
  desktopBlob: Blob;
  mobileBlob?: Blob;
};
export type WallpaperAssetThumbnails = {
  id: string;
  desktopThumbnailBlob: Blob;
  mobileThumbnailBlob?: Blob;
};
export type WallpaperLibraryItem = WallpaperAssetMetadata & {
  kind: "built-in" | "uploaded";
};
export type WallpaperAssetDraft = {
  metadata: WallpaperAssetMetadata;
  files: WallpaperAssetFiles;
  thumbnails: WallpaperAssetThumbnails;
};
export type WallpaperSnapshot = {
  revision: number;
  hasUserData: boolean;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  preferences: WallpaperPreferences;
  assets: WallpaperAssetMetadata[];
  presets: WallpaperPreset[];
};

export const builtInWallpaperIds = [
  "qiguang-fog-observatory",
  "qiguang-rain-platform",
  "qiguang-windowsill-sprout",
  "qiguang-afternoon-reading-room",
  "qiguang-river-tide",
  "qiguang-mountain-shelter",
  "qiguang-night-train-window",
  "qiguang-woodwork-studio",
  "qiguang-greenhouse-gardener",
  "qiguang-record-shop",
  "qiguang-rooftop-garden",
  "qiguang-closing-market",
] as const;

const builtInIds = new Set<string>(builtInWallpaperIds);
const databaseName = "daily-summary-wallpapers";
const databaseVersion = 4;
const preferenceStoreName = "preferences";
const presetStoreName = "wallpaper-presets";
const legacyImageStoreName = "images";
const assetMetadataStoreName = "wallpaper-assets";
const assetFilesStoreName = "wallpaper-files";
const assetThumbnailsStoreName = "wallpaper-thumbnails";
type LegacyWallpaperImage = {
  module?: unknown;
  desktopBlob?: Blob;
  desktopName?: string;
  mobileBlob?: Blob;
  mobileName?: string;
};

const defaultOverlay = 64;
const minOverlay = 45;
const maxOverlay = 85;
export const maxWallpapersPerModule = 32;
export const maxCustomWallpaperAssets = 32;
export const maxWallpaperLibraryBytes = 256 * 1024 * 1024;
export const maxWallpaperPresets = 30;

export function wallpaperAssetStoredBytes(
  asset: Pick<
    WallpaperAssetMetadata,
    "optimizedBytes" | "desktopThumbnailBytes" | "mobileThumbnailBytes"
  >,
): number {
  return [
    asset.optimizedBytes,
    asset.desktopThumbnailBytes ?? 0,
    asset.mobileThumbnailBytes ?? 0,
  ].reduce(
    (total, bytes) =>
      total + (Number.isFinite(bytes) ? Math.max(0, Math.floor(bytes)) : 0),
    0,
  );
}
export const maxWallpaperPresetNameLength = 40;
export const wallpaperPresetSchemaVersion = 1 as const;

let databasePromise: Promise<IDBDatabase> | null = null;

export function defaultWallpaperSurfacePreference(): WallpaperPreferenceValue {
  return {
    wallpaperIds: [],
    overlay: defaultOverlay,
    cycleDaily: false,
  };
}

export function defaultWallpaperPreference(
  module: WallpaperModule,
): WallpaperPreference {
  return {
    wallpaperIds: [],
    overlay: defaultOverlay,
    cycleDaily: false,
    surfaces: Object.fromEntries(
      wallpaperSurfacesForModule(module).map(({ id }) => [
        id,
        defaultWallpaperSurfacePreference(),
      ]),
    ),
  };
}

export function defaultWallpaperPreferences(): WallpaperPreferences {
  return Object.fromEntries(
    wallpaperModules.map(({ id }) => [id, defaultWallpaperPreference(id)]),
  ) as WallpaperPreferences;
}

const qiguangPreferences = defaultWallpaperPreferences();
qiguangPreferences.records.wallpaperIds = ["qiguang-rain-platform"];
qiguangPreferences.records.overlay = 82;
qiguangPreferences.search.wallpaperIds = ["qiguang-fog-observatory"];
qiguangPreferences.search.overlay = 82;
qiguangPreferences.today.surfaces["today.preview"] = {
  wallpaperIds: ["qiguang-windowsill-sprout"],
  overlay: 84,
  cycleDaily: false,
};
qiguangPreferences.knowledge.wallpaperIds = ["qiguang-afternoon-reading-room"];
qiguangPreferences.knowledge.overlay = 82;
qiguangPreferences.stats.surfaces["stats.monthlyOverview"] = {
  wallpaperIds: ["qiguang-river-tide"],
  overlay: 68,
  cycleDaily: false,
};
qiguangPreferences.reviews.surfaces["reviews.archive"] = {
  wallpaperIds: ["qiguang-mountain-shelter"],
  overlay: 83,
  cycleDaily: false,
};

export const builtInWallpaperPresets: WallpaperPreset[] = [
  {
    id: "builtin-qiguang-light",
    name: "栖光 · 轻描",
    schemaVersion: wallpaperPresetSchemaVersion,
    createdAt: 0,
    updatedAt: 0,
    source: "built-in",
    preferences: qiguangPreferences,
  },
];

export function findWallpaperPreset(
  presetId: string,
  savedPresets: readonly WallpaperPreset[],
): WallpaperPreset | null {
  return builtInWallpaperPresets.find((preset) => preset.id === presetId)
    ?? savedPresets.find((preset) => preset.id === presetId)
    ?? null;
}

function normalizeWallpaperPreferences(value: unknown): WallpaperPreferences {
  const candidate = value && typeof value === "object"
    ? value as Partial<WallpaperPreferences>
    : {};
  return Object.fromEntries(
    wallpaperModules.map(({ id }) => [id, normalizeWallpaperPreference(id, candidate[id])]),
  ) as WallpaperPreferences;
}

function sameWallpaperPreference(left: WallpaperPreferenceValue, right: WallpaperPreferenceValue) {
  return left.overlay === right.overlay &&
    left.cycleDaily === right.cycleDaily &&
    left.wallpaperIds.length === right.wallpaperIds.length &&
    left.wallpaperIds.every((id, index) => id === right.wallpaperIds[index]);
}

export function wallpaperPreferencesEqual(
  left: WallpaperPreferences,
  right: WallpaperPreferences,
): boolean {
  return wallpaperModules.every(({ id }) =>
    sameWallpaperPreference(left[id], right[id]) &&
    wallpaperSurfacesForModule(id).every(({ id: surfaceId }) =>
      sameWallpaperPreference(
        left[id].surfaces[surfaceId] ?? defaultWallpaperSurfacePreference(),
        right[id].surfaces[surfaceId] ?? defaultWallpaperSurfacePreference(),
      ),
    ),
  );
}

function wallpaperIdsInPreferences(preferences: WallpaperPreferences): string[] {
  return wallpaperModules.flatMap(({ id: module }) => [
    ...preferences[module].wallpaperIds,
    ...wallpaperSurfacesForModule(module).flatMap(({ id }) =>
      preferences[module].surfaces[id]?.wallpaperIds ?? [],
    ),
  ]);
}

export function newWallpaperId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "wallpaper-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function wallpaperModuleForPage(page: string): WallpaperModule {
  if (page === "history" || page === "archive") return "records";
  if (
    page === "today" ||
    page === "search" ||
    page === "knowledge" ||
    page === "review" ||
    page === "stats" ||
    page === "reviews" ||
    page === "settings"
  ) {
    return page;
  }
  return "today";
}

function normalizeWallpaperPreferenceValue(
  value: unknown,
  fallback: WallpaperPreferenceValue,
): WallpaperPreferenceValue {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<WallpaperPreferenceValue>;
  const wallpaperIds = Array.isArray(candidate.wallpaperIds)
    ? [...new Set(
        candidate.wallpaperIds.filter(
          (id): id is string =>
            typeof id === "string" && id.length > 0 && id.length <= 120,
        ),
      )].slice(0, maxWallpapersPerModule)
    : fallback.wallpaperIds;
  const overlay =
    typeof candidate.overlay === "number" && Number.isFinite(candidate.overlay)
      ? Math.min(maxOverlay, Math.max(minOverlay, Math.round(candidate.overlay)))
      : fallback.overlay;
  return {
    wallpaperIds,
    overlay,
    cycleDaily: wallpaperIds.length > 1 && candidate.cycleDaily === true,
  };
}

export function normalizeWallpaperSurfacePreference(
  surface: WallpaperSurfaceId,
  value: unknown,
): WallpaperPreferenceValue {
  if (!wallpaperSurfaces.some((item) => item.id === surface)) {
    return defaultWallpaperSurfacePreference();
  }
  return normalizeWallpaperPreferenceValue(value, defaultWallpaperSurfacePreference());
}

export function normalizeWallpaperPreference(
  module: WallpaperModule,
  value: unknown,
): WallpaperPreference {
  const fallback = defaultWallpaperPreference(module);
  const page = normalizeWallpaperPreferenceValue(value, fallback);
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<WallpaperPreference>)
      : {};
  const surfaces = Object.fromEntries(
    wallpaperSurfacesForModule(module).map(({ id }) => [
      id,
      normalizeWallpaperSurfacePreference(id, candidate.surfaces?.[id]),
    ]),
  );
  return { ...page, surfaces };
}

export function wallpaperPreferenceForTarget(
  preferences: WallpaperPreferences,
  target: WallpaperAssignmentTargetId,
): WallpaperPreferenceValue {
  if (wallpaperModules.some((module) => module.id === target)) {
    return preferences[target as WallpaperModule];
  }
  const surface = wallpaperSurfaces.find((item) => item.id === target);
  if (!surface) return defaultWallpaperSurfacePreference();
  return (
    preferences[surface.module].surfaces[surface.id] ??
    defaultWallpaperSurfacePreference()
  );
}

export function wallpaperIdForDate(
  preference: WallpaperPreferenceValue,
  date = new Date(),
): string | null {
  const { wallpaperIds } = preference;
  if (wallpaperIds.length === 0) return null;
  if (wallpaperIds.length === 1 || !preference.cycleDaily) {
    return wallpaperIds[0];
  }
  const dayNumber = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
  return wallpaperIds[dayNumber % wallpaperIds.length];
}

function migrateV1WallpaperData(
  database: IDBDatabase,
  transaction: IDBTransaction,
) {
  if (
    !database.objectStoreNames.contains(legacyImageStoreName) ||
    !database.objectStoreNames.contains(preferenceStoreName)
  ) {
    transaction.abort();
    return;
  }

  const preferenceStore = transaction.objectStore(preferenceStoreName);
  const legacyImageStore = transaction.objectStore(legacyImageStoreName);
  const metadataStore = transaction.objectStore(assetMetadataStoreName);
  const filesStore = transaction.objectStore(assetFilesStoreName);
  const oldPreferencesRequest = preferenceStore.getAll() as IDBRequest<
    Array<{ module: unknown; source?: unknown; overlay?: unknown }>
  >;
  const oldImagesRequest = legacyImageStore.getAll() as IDBRequest<
    Array<{
      module?: unknown;
      desktopBlob?: Blob;
      desktopName?: string;
      mobileBlob?: Blob;
      mobileName?: string;
    }>
  >;
  let oldPreferences:
    | Array<{ module: unknown; source?: unknown; overlay?: unknown }>
    | undefined;
  let oldImages:
    | Array<{
        module?: unknown;
        desktopBlob?: Blob;
        desktopName?: string;
        mobileBlob?: Blob;
        mobileName?: string;
      }>
    | undefined;

  const migrate = () => {
    if (!oldPreferences || !oldImages) return;
    try {
      const preferenceByModule = new Map(
        oldPreferences
          .filter((record) => isWallpaperModule(record.module))
          .map((record) => [record.module, record]),
      );
      const imageByModule = new Map<WallpaperModule, LegacyWallpaperImage>();
      for (const record of oldImages) {
        if (!isWallpaperModule(record.module)) continue;
        const desktopBlob = record.desktopBlob ?? record.mobileBlob;
        if (!desktopBlob) continue;
        const id = "legacy-" + record.module;
        imageByModule.set(record.module, record);
        metadataStore.put({
          id,
          name:
            record.desktopName ??
            record.mobileName ??
            (wallpaperModules.find((module) => module.id === record.module)?.label ??
              "模块") + "壁纸",
          createdAt: Date.now(),
          originalBytes: (record.desktopBlob?.size ?? 0) + (record.mobileBlob?.size ?? 0),
          optimizedBytes: (record.desktopBlob?.size ?? 0) + (record.mobileBlob?.size ?? 0),
          desktopWidth: 0,
          desktopHeight: 0,
          desktopThumbnailBytes: 0,
          mobileThumbnailBytes: 0,
        } satisfies WallpaperAssetMetadata);
        filesStore.put({
          id,
          desktopBlob,
          mobileBlob: record.mobileBlob ?? record.desktopBlob,
        });
      }
      for (const { id: module } of wallpaperModules) {
        const oldPreference = preferenceByModule.get(module);
        if (!oldPreference) {
          preferenceStore.put({
            module,
            ...defaultWallpaperPreference(module),
          });
          continue;
        }
        const legacyImage = imageByModule.get(module);
        const wallpaperIds =
          oldPreference.source === "anime-night"
            ? ["anime-night"]
            : oldPreference.source === "custom" && legacyImage
              ? ["legacy-" + module]
              : [];
        preferenceStore.put({
          module,
          wallpaperIds,
          overlay:
            typeof oldPreference.overlay === "number" &&
            Number.isFinite(oldPreference.overlay)
              ? Math.min(
                  maxOverlay,
                  Math.max(minOverlay, Math.round(oldPreference.overlay)),
                )
              : defaultOverlay,
          cycleDaily: false,
        });
      }
      database.deleteObjectStore(legacyImageStoreName);
    } catch {
      transaction.abort();
    }
  };

  oldPreferencesRequest.onsuccess = () => {
    oldPreferences = oldPreferencesRequest.result;
    migrate();
  };
  oldImagesRequest.onsuccess = () => {
    oldImages = oldImagesRequest.result;
    migrate();
  };
  oldPreferencesRequest.onerror = () => transaction.abort();
  oldImagesRequest.onerror = () => transaction.abort();
}

function migrateV2WallpaperData(transaction: IDBTransaction) {
  const metadataStore = transaction.objectStore(assetMetadataStoreName);
  const thumbnailsStore = transaction.objectStore(assetThumbnailsStoreName);
  const request = metadataStore.getAll() as IDBRequest<
    Array<
      WallpaperAssetMetadata & {
        desktopThumbnailBlob?: Blob;
        mobileThumbnailBlob?: Blob;
      }
    >
  >;
  request.onsuccess = () => {
    try {
      for (const record of request.result) {
        const {
          desktopThumbnailBlob,
          mobileThumbnailBlob,
          ...metadata
        } = record;
        if (desktopThumbnailBlob || mobileThumbnailBlob) {
          const desktop = desktopThumbnailBlob ?? mobileThumbnailBlob;
          if (desktop) {
            thumbnailsStore.put({
              id: record.id,
              desktopThumbnailBlob: desktop,
              mobileThumbnailBlob,
            } satisfies WallpaperAssetThumbnails);
          }
        }
        metadataStore.put({
          ...metadata,
          desktopThumbnailBytes:
            record.desktopThumbnailBytes ?? desktopThumbnailBlob?.size ?? 0,
          mobileThumbnailBytes:
            record.mobileThumbnailBytes ?? mobileThumbnailBlob?.size ?? 0,
        } satisfies WallpaperAssetMetadata);
      }
    } catch {
      transaction.abort();
    }
  };
  request.onerror = () => transaction.abort();
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("当前环境不支持本地壁纸存储"));
  }
  if (databasePromise) return databasePromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = globalThis.indexedDB.open(databaseName, databaseVersion);
    let blocked = false;
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) {
        reject(new Error("无法启动本地壁纸迁移"));
        return;
      }
      if (!database.objectStoreNames.contains(preferenceStoreName)) {
        database.createObjectStore(preferenceStoreName, { keyPath: "module" });
      }
      const presetStore = database.objectStoreNames.contains(presetStoreName)
        ? transaction.objectStore(presetStoreName)
        : database.createObjectStore(presetStoreName, { keyPath: "id" });
      if (!presetStore.indexNames.contains("nameKey")) {
        presetStore.createIndex("nameKey", "nameKey", { unique: true });
      }
      if (!database.objectStoreNames.contains(assetMetadataStoreName)) {
        database.createObjectStore(assetMetadataStoreName, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(assetFilesStoreName)) {
        database.createObjectStore(assetFilesStoreName, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(assetThumbnailsStoreName)) {
        database.createObjectStore(assetThumbnailsStoreName, { keyPath: "id" });
      }
      if (event.oldVersion === 1) {
        migrateV1WallpaperData(database, transaction);
      } else if (event.oldVersion === 2) {
        migrateV2WallpaperData(transaction);
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开本地壁纸存储"));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("本地壁纸存储正被其他页面占用，请刷新后重试"));
    };
  }).catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  databasePromise = opening;
  return opening;
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("本地壁纸操作失败"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("本地壁纸操作已取消"));
  });
}

function isWallpaperModule(value: unknown): value is WallpaperModule {
  return wallpaperModules.some((module) => module.id === value);
}

function isWallpaperSurfaceId(value: unknown): value is WallpaperSurfaceId {
  return wallpaperSurfaces.some((surface) => surface.id === value);
}

type WallpaperPresetRecord = WallpaperPreset & { nameKey: string };

function normalizedPresetName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("请输入方案名称。");
  if (Array.from(normalized).length > maxWallpaperPresetNameLength) {
    throw new Error("方案名称不能超过 " + maxWallpaperPresetNameLength + " 个字符。");
  }
  return normalized;
}

function normalizeWallpaperPreset(value: unknown): WallpaperPreset | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WallpaperPreset>;
  if (
    candidate.schemaVersion !== wallpaperPresetSchemaVersion ||
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    typeof candidate.name !== "string"
  ) return null;
  const name = candidate.name.trim().replace(/\s+/g, " ");
  if (!name || Array.from(name).length > maxWallpaperPresetNameLength) return null;
  const now = Date.now();
  return {
    id: candidate.id,
    name,
    schemaVersion: wallpaperPresetSchemaVersion,
    createdAt: typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
      ? candidate.createdAt
      : now,
    updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : now,
    preferences: normalizeWallpaperPreferences(candidate.preferences),
  };
}

export async function loadWallpaperPreferences(): Promise<WallpaperPreferences> {
  const database = await openDatabase();
  const transaction = database.transaction(preferenceStoreName, "readonly");
  const completed = transactionCompletion(transaction);
  const request = transaction
    .objectStore(preferenceStoreName)
    .getAll() as IDBRequest<
    Array<{ module: unknown } & Partial<WallpaperPreference>>
  >;
  const [records] = await Promise.all([
    new Promise<typeof request.result>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("无法读取壁纸设置"));
    }),
    completed,
  ]);
  const preferences = defaultWallpaperPreferences();
  for (const record of records) {
    if (!isWallpaperModule(record.module)) continue;
    preferences[record.module] = normalizeWallpaperPreference(record.module, record);
  }
  return preferences;
}

export async function loadWallpaperAssets(): Promise<WallpaperAssetMetadata[]> {
  const database = await openDatabase();
  const transaction = database.transaction(assetMetadataStoreName, "readonly");
  const completed = transactionCompletion(transaction);
  const request = transaction
    .objectStore(assetMetadataStoreName)
    .getAll() as IDBRequest<WallpaperAssetMetadata[]>;
  const [assets] = await Promise.all([
    new Promise<WallpaperAssetMetadata[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("无法读取壁纸库"));
    }),
    completed,
  ]);
  return assets.sort((left, right) => right.createdAt - left.createdAt);
}

export async function loadWallpaperAssetThumbnails(): Promise<
  WallpaperAssetThumbnails[]
> {
  const database = await openDatabase();
  const transaction = database.transaction(assetThumbnailsStoreName, "readonly");
  const completed = transactionCompletion(transaction);
  const request = transaction
    .objectStore(assetThumbnailsStoreName)
    .getAll() as IDBRequest<WallpaperAssetThumbnails[]>;
  const [thumbnails] = await Promise.all([
    new Promise<WallpaperAssetThumbnails[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("无法读取壁纸缩略图"));
    }),
    completed,
  ]);
  return thumbnails;
}

export async function loadWallpaperAssetFiles(
  id: string,
): Promise<WallpaperAssetFiles | null> {
  const database = await openDatabase();
  const transaction = database.transaction(assetFilesStoreName, "readonly");
  const completed = transactionCompletion(transaction);
  const request = transaction
    .objectStore(assetFilesStoreName)
    .get(id) as IDBRequest<WallpaperAssetFiles | undefined>;
  const [files] = await Promise.all([
    new Promise<WallpaperAssetFiles | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () =>
        reject(request.error ?? new Error("无法读取壁纸文件"));
    }),
    completed,
  ]);
  return files;
}


export type LocalWallpaperMigrationSource = {
  migrationId: string;
  preferences: WallpaperPreferences;
  presets: WallpaperPreset[];
  assets: WallpaperAssetDraft[];
};

const localWallpaperMigrationIdKey = "daily-summary-wallpaper-migration-id";

async function createMigrationThumbnail(blob: Blob, name: string): Promise<Blob> {
  const { processWallpaperFile } = await import("./wallpaperImageProcessing");
  const type = ["image/jpeg", "image/png", "image/webp"].includes(blob.type)
    ? blob.type
    : name.toLowerCase().endsWith(".png")
      ? "image/png"
      : name.toLowerCase().endsWith(".jpg") || name.toLowerCase().endsWith(".jpeg")
        ? "image/jpeg"
        : "image/webp";
  return (await processWallpaperFile(new File([blob], name, { type }))).thumbnail;
}

function getLocalWallpaperMigrationId(): string {
  try {
    const existing = globalThis.localStorage?.getItem(localWallpaperMigrationIdKey);
    if (existing) return existing;
    const id = newWallpaperId();
    globalThis.localStorage?.setItem(localWallpaperMigrationIdKey, id);
    return id;
  } catch {
    return newWallpaperId();
  }
}

/** Read the former per-browser store only when an explicit server migration is needed. */
export async function loadLocalWallpaperMigrationSource(): Promise<LocalWallpaperMigrationSource | null> {
  const [storedPreferences, presets, metadata, thumbnails] = await Promise.all([
    loadWallpaperPreferences(),
    loadWallpaperPresets(),
    loadWallpaperAssets(),
    loadWallpaperAssetThumbnails(),
  ]);
  const files = await Promise.all(metadata.map((asset) => loadWallpaperAssetFiles(asset.id)));
  const preferences = wallpaperPreferencesEqual(storedPreferences, defaultWallpaperPreferences())
    ? defaultWallpaperPreferences()
    : storedPreferences;
  const thumbnailById = new Map(thumbnails.map((item) => [item.id, item]));
  const fileById = new Map<string, WallpaperAssetFiles>();
  metadata.forEach((asset, index) => {
    const item = files[index];
    if (item) fileById.set(asset.id, item);
  });
  const assets: WallpaperAssetDraft[] = [];
  for (const asset of metadata) {
    if (asset.isBuiltIn || builtInIds.has(asset.id)) continue;
    const storedFiles = fileById.get(asset.id);
    const storedThumbnails = thumbnailById.get(asset.id);
    if (!storedFiles?.desktopBlob) {
      throw new Error("本机壁纸“" + asset.name + "”缺少图片文件；本机副本仍保留，请重新导入该图片后再迁移。");
    }
    const desktopThumbnailBlob = storedThumbnails?.desktopThumbnailBlob
      ?? await createMigrationThumbnail(storedFiles.desktopBlob, asset.desktopName ?? asset.name + ".webp");
    const mobileThumbnailBlob = storedFiles.mobileBlob
      ? storedThumbnails?.mobileThumbnailBlob
        ?? await createMigrationThumbnail(storedFiles.mobileBlob, asset.mobileName ?? asset.name + "-mobile.webp")
      : undefined;
    const normalizedThumbnails = {
      id: asset.id,
      desktopThumbnailBlob,
      mobileThumbnailBlob,
    } satisfies WallpaperAssetThumbnails;
    assets.push({
      metadata: {
        ...asset,
        isBuiltIn: false,
        originalBytes: Number.isFinite(asset.originalBytes) ? asset.originalBytes : storedFiles.desktopBlob.size + (storedFiles.mobileBlob?.size ?? 0),
        optimizedBytes: storedFiles.desktopBlob.size + (storedFiles.mobileBlob?.size ?? 0),
        desktopThumbnailBytes: desktopThumbnailBlob.size,
        mobileThumbnailBytes: mobileThumbnailBlob?.size,
      },
      files: storedFiles,
      thumbnails: normalizedThumbnails,
    });
  }
  const hasData = assets.length > 0 || presets.length > 0 ||
    !wallpaperPreferencesEqual(preferences, defaultWallpaperPreferences());
  if (!hasData) return null;
  return {
    migrationId: getLocalWallpaperMigrationId(),
    preferences,
    presets,
    assets,
  };
}

export async function saveWallpaperAsset(
  metadata: WallpaperAssetMetadata,
  files: WallpaperAssetFiles,
  thumbnails: WallpaperAssetThumbnails,
): Promise<void> {
  const imageBytes =
    files.desktopBlob.size + (files.mobileBlob?.size ?? 0);
  const thumbnailBytes =
    thumbnails.desktopThumbnailBlob.size +
    (thumbnails.mobileThumbnailBlob?.size ?? 0);
  const incomingBytes = imageBytes + thumbnailBytes;
  if (incomingBytes > maxWallpaperLibraryBytes) {
    throw new Error("这组图片超过壁纸库容量上限 256 MiB。");
  }

  const database = await openDatabase();
  const transaction = database.transaction(
    [assetMetadataStoreName, assetFilesStoreName, assetThumbnailsStoreName],
    "readwrite",
  );
  const completed = transactionCompletion(transaction);
  const metadataStore = transaction.objectStore(assetMetadataStoreName);
  const request = metadataStore.getAll() as IDBRequest<WallpaperAssetMetadata[]>;
  let operationError: Error | null = null;

  request.onsuccess = () => {
    try {
      const existing = request.result.filter((asset) => asset.id !== metadata.id);
      if (existing.length >= maxCustomWallpaperAssets) {
        throw new Error(
          "壁纸库已达到图片数量限制；请删除未引用的图片后再添加。",
        );
      }
      const usedBytes = existing.reduce(
        (total, asset) => total + wallpaperAssetStoredBytes(asset),
        0,
      );
      if (usedBytes + incomingBytes > maxWallpaperLibraryBytes) {
        throw new Error(
          "壁纸库容量上限为 256 MiB；请删除未引用的图片或选择更小的图片。",
        );
      }

      metadataStore.put({
        ...metadata,
        optimizedBytes: imageBytes,
        desktopThumbnailBytes: thumbnails.desktopThumbnailBlob.size,
        mobileThumbnailBytes: thumbnails.mobileThumbnailBlob?.size ?? 0,
      } satisfies WallpaperAssetMetadata);
      transaction.objectStore(assetFilesStoreName).put(files);
      transaction.objectStore(assetThumbnailsStoreName).put(thumbnails);
    } catch (error) {
      operationError = error instanceof Error
        ? error
        : new Error("无法保存壁纸。");
      transaction.abort();
    }
  };
  request.onerror = () => transaction.abort();

  try {
    await completed;
  } catch (error) {
    if (operationError) throw operationError;
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: unknown }).name === "QuotaExceededError"
    ) {
      throw new Error(
        "浏览器可用存储空间不足；请删除未引用的壁纸或选择更小的图片。",
      );
    }
    throw error;
  }
}

async function updateWallpaperModulePreference(
  module: WallpaperModule,
  update: (current: WallpaperPreference) => WallpaperPreference,
): Promise<WallpaperPreferences> {
  const database = await openDatabase();
  const transaction = database.transaction(preferenceStoreName, "readwrite");
  const completed = transactionCompletion(transaction);
  const store = transaction.objectStore(preferenceStoreName);
  const request = store.getAll() as IDBRequest<
    Array<{ module: unknown } & Partial<WallpaperPreference>>
  >;
  let result: WallpaperPreferences | null = null;
  let operationError: Error | null = null;
  request.onsuccess = () => {
    try {
      const current = defaultWallpaperPreferences();
      for (const record of request.result) {
        if (!isWallpaperModule(record.module)) continue;
        current[record.module] = normalizeWallpaperPreference(record.module, record);
      }
      const next = normalizeWallpaperPreference(module, update(current[module]));
      result = { ...current, [module]: next };
      store.put({ module, ...next });
    } catch (error) {
      operationError = error instanceof Error ? error : new Error("无法保存壁纸设置。");
      transaction.abort();
    }
  };
  request.onerror = () => transaction.abort();
  try {
    await completed;
  } catch (error) {
    throw operationError ?? error;
  }
  if (!result) throw new Error("无法保存壁纸设置。");
  return result;
}

export async function saveWallpaperTargetPreference(
  target: WallpaperAssignmentTargetId,
  preference: WallpaperPreferenceValue,
): Promise<WallpaperPreferences> {
  const module = wallpaperModuleForTarget(target);
  return updateWallpaperModulePreference(module, (current) =>
    isWallpaperModule(target)
      ? {
          ...current,
          ...normalizeWallpaperPreferenceValue(
            preference,
            defaultWallpaperPreference(module),
          ),
          surfaces: current.surfaces,
        }
      : {
          ...current,
          surfaces: {
            ...current.surfaces,
            [target]: normalizeWallpaperSurfacePreference(target, preference),
          },
        },
  );
}

export async function applyWallpaperAssetsToTargets(
  targetIds: WallpaperAssignmentTargetId[],
  wallpaperIds: string[],
  mode: WallpaperApplyMode,
): Promise<WallpaperPreferences> {
  const selectedIds = [...new Set(wallpaperIds)].slice(0, maxWallpapersPerModule);
  const targets = [...new Set(targetIds)].filter(
    (target) => isWallpaperModule(target) || isWallpaperSurfaceId(target),
  );
  if (targets.length === 0 || selectedIds.length === 0) {
    throw new Error("请选择壁纸和要应用的区域");
  }

  const database = await openDatabase();
  const transaction = database.transaction(
    [preferenceStoreName, assetMetadataStoreName],
    "readwrite",
  );
  const completed = transactionCompletion(transaction);
  const preferenceStore = transaction.objectStore(preferenceStoreName);
  const preferencesRequest = preferenceStore.getAll() as IDBRequest<
    Array<{ module: unknown } & Partial<WallpaperPreference>>
  >;
  const assetsRequest = transaction.objectStore(assetMetadataStoreName).getAll() as IDBRequest<
    WallpaperAssetMetadata[]
  >;
  let records: Array<{ module: unknown } & Partial<WallpaperPreference>> | undefined;
  let assets: WallpaperAssetMetadata[] | undefined;
  let preferences: WallpaperPreferences | null = null;
  let operationError: Error | null = null;
  const writeWhenReady = () => {
    if (records === undefined || assets === undefined) return;
    try {
      const available = new Set([...builtInIds, ...assets.map((asset) => asset.id)]);
      if (selectedIds.some((id) => !available.has(id))) {
        throw new Error("所选壁纸已不在图库中；请刷新后重新选择。");
      }
      const result = defaultWallpaperPreferences();
      for (const record of records) {
        if (!isWallpaperModule(record.module)) continue;
        result[record.module] = normalizeWallpaperPreference(record.module, record);
      }
      const changedModules = new Set<WallpaperModule>();
      for (const target of targets) {
        const module = wallpaperModuleForTarget(target);
        const current = wallpaperPreferenceForTarget(result, target);
        const nextIds = mode === "replace"
          ? selectedIds
          : [...new Set([...current.wallpaperIds, ...selectedIds])].slice(
              0,
              maxWallpapersPerModule,
            );
        const next: WallpaperPreferenceValue = {
          ...current,
          wallpaperIds: nextIds,
          cycleDaily:
            nextIds.length > 1 &&
            (mode === "replace" || current.cycleDaily || current.wallpaperIds.length <= 1),
        };
        result[module] = isWallpaperModule(target)
          ? { ...result[module], ...next }
          : {
              ...result[module],
              surfaces: { ...result[module].surfaces, [target]: next },
            };
        changedModules.add(module);
      }
      for (const module of changedModules) {
        preferenceStore.put({ module, ...result[module] });
      }
      preferences = result;
    } catch (error) {
      operationError = error instanceof Error ? error : new Error("无法应用壁纸。");
      transaction.abort();
    }
  };
  preferencesRequest.onsuccess = () => {
    records = preferencesRequest.result;
    writeWhenReady();
  };
  assetsRequest.onsuccess = () => {
    assets = assetsRequest.result;
    writeWhenReady();
  };
  preferencesRequest.onerror = () => transaction.abort();
  assetsRequest.onerror = () => transaction.abort();
  try {
    await completed;
  } catch (error) {
    throw operationError ?? error;
  }
  if (!preferences) throw new Error("无法应用壁纸。");
  return preferences;
}

export async function loadWallpaperPresets(): Promise<WallpaperPreset[]> {
  const database = await openDatabase();
  const transaction = database.transaction(presetStoreName, "readonly");
  const completed = transactionCompletion(transaction);
  const request = transaction.objectStore(presetStoreName).getAll() as IDBRequest<unknown[]>;
  const [records] = await Promise.all([
    new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("无法读取壁纸方案"));
    }),
    completed,
  ]);
  return records
    .map(normalizeWallpaperPreset)
    .filter((preset): preset is WallpaperPreset => !!preset)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function saveWallpaperPreset(
  name: string,
  presetId?: string,
): Promise<WallpaperPreset> {
  if (presetId && builtInWallpaperPresets.some((preset) => preset.id === presetId)) {
    throw new Error("内置壁纸方案不可修改。");
  }
  const safeName = normalizedPresetName(name);
  const nameKey = safeName.toLowerCase();
  const database = await openDatabase();
  const transaction = database.transaction(
    [presetStoreName, preferenceStoreName, assetMetadataStoreName],
    "readwrite",
  );
  const completed = transactionCompletion(transaction);
  const store = transaction.objectStore(presetStoreName);
  const presetsRequest = store.getAll() as IDBRequest<unknown[]>;
  const preferencesRequest = transaction.objectStore(preferenceStoreName).getAll() as IDBRequest<
    Array<{ module: unknown } & Partial<WallpaperPreference>>
  >;
  const assetsRequest = transaction.objectStore(assetMetadataStoreName).getAll() as IDBRequest<
    WallpaperAssetMetadata[]
  >;
  let presetRecords: unknown[] | undefined;
  let preferenceRecords: Array<{ module: unknown } & Partial<WallpaperPreference>> | undefined;
  let assets: WallpaperAssetMetadata[] | undefined;
  let operationError: Error | null = null;
  let savedPreset: WallpaperPreset | null = null;
  const writeWhenReady = () => {
    if (presetRecords === undefined || preferenceRecords === undefined || assets === undefined) return;
    try {
      const currentPresets = presetRecords
        .map(normalizeWallpaperPreset)
        .filter((preset): preset is WallpaperPreset => !!preset);
      const existing = presetId
        ? currentPresets.find((preset) => preset.id === presetId)
        : null;
      if (presetId && !existing) throw new Error("找不到要更新的壁纸方案。");
      if (!existing && currentPresets.length >= maxWallpaperPresets) {
        throw new Error("最多保存 " + maxWallpaperPresets + " 组壁纸方案，请先整理现有方案。");
      }
      if (
        currentPresets.some((preset) =>
          preset.id !== presetId && preset.name.toLowerCase() === nameKey,
        ) ||
        builtInWallpaperPresets.some((preset) =>
          preset.id !== presetId && preset.name.toLowerCase() === nameKey,
        )
      ) throw new Error("已存在同名方案，请更换名称。");

      const currentPreferences = defaultWallpaperPreferences();
      for (const record of preferenceRecords) {
        if (!isWallpaperModule(record.module)) continue;
        currentPreferences[record.module] = normalizeWallpaperPreference(record.module, record);
      }
      const available = new Set([...builtInIds, ...assets.map((asset) => asset.id)]);
      if (wallpaperIdsInPreferences(currentPreferences).some((id) => !available.has(id))) {
        throw new Error("当前设置引用的壁纸不在图库中；修复后再保存方案。");
      }
      const now = Date.now();
      savedPreset = {
        id: existing?.id ?? "wallpaper-preset-" + newWallpaperId(),
        name: safeName,
        schemaVersion: wallpaperPresetSchemaVersion,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        preferences: currentPreferences,
      };
      const record: WallpaperPresetRecord = { ...savedPreset, nameKey };
      if (existing) store.put(record);
      else store.add(record);
    } catch (error) {
      operationError = error instanceof Error ? error : new Error("无法保存壁纸方案。");
      transaction.abort();
    }
  };
  presetsRequest.onsuccess = () => {
    presetRecords = presetsRequest.result;
    writeWhenReady();
  };
  preferencesRequest.onsuccess = () => {
    preferenceRecords = preferencesRequest.result;
    writeWhenReady();
  };
  assetsRequest.onsuccess = () => {
    assets = assetsRequest.result;
    writeWhenReady();
  };
  presetsRequest.onerror = () => transaction.abort();
  preferencesRequest.onerror = () => transaction.abort();
  assetsRequest.onerror = () => transaction.abort();
  try {
    await completed;
  } catch (error) {
    throw operationError ?? error;
  }
  if (!savedPreset) throw new Error("无法保存壁纸方案。");
  return savedPreset;
}

export async function renameWallpaperPreset(
  presetId: string,
  name: string,
): Promise<WallpaperPreset> {
  if (builtInWallpaperPresets.some((preset) => preset.id === presetId)) {
    throw new Error("内置壁纸方案不可重命名。");
  }
  const safeName = normalizedPresetName(name);
  const current = await loadWallpaperPresets();
  const preset = current.find((item) => item.id === presetId);
  if (!preset) throw new Error("找不到要重命名的壁纸方案。");
  if (
    current.some((item) =>
      item.id !== presetId && item.name.toLowerCase() === safeName.toLowerCase(),
    ) ||
    builtInWallpaperPresets.some((item) =>
      item.id !== presetId && item.name.toLowerCase() === safeName.toLowerCase(),
    )
  ) throw new Error("已存在同名方案，请更换名称。");

  const updated: WallpaperPreset = {
    ...preset,
    name: safeName,
    updatedAt: Date.now(),
  };
  const database = await openDatabase();
  const transaction = database.transaction(presetStoreName, "readwrite");
  const completed = transactionCompletion(transaction);
  transaction.objectStore(presetStoreName).put({
    ...updated,
    nameKey: safeName.toLowerCase(),
  } satisfies WallpaperPresetRecord);
  await completed;
  return updated;
}

export async function deleteWallpaperPreset(presetId: string): Promise<void> {
  if (builtInWallpaperPresets.some((preset) => preset.id === presetId)) {
    throw new Error("内置壁纸方案不可删除。");
  }
  const database = await openDatabase();
  const transaction = database.transaction(presetStoreName, "readwrite");
  const completed = transactionCompletion(transaction);
  transaction.objectStore(presetStoreName).delete(presetId);
  await completed;
}

export async function applyWallpaperPreset(
  presetId: string | null,
): Promise<WallpaperPreferences> {
  const database = await openDatabase();
  const builtInPreset = presetId
    ? builtInWallpaperPresets.find((preset) => preset.id === presetId)
    : undefined;
  if (presetId === null || builtInPreset) {
    const preferences = builtInPreset
      ? normalizeWallpaperPreferences(builtInPreset.preferences)
      : defaultWallpaperPreferences();
    const transaction = database.transaction(preferenceStoreName, "readwrite");
    const completed = transactionCompletion(transaction);
    const store = transaction.objectStore(preferenceStoreName);
    for (const { id: module } of wallpaperModules) {
      store.put({ module, ...preferences[module] });
    }
    await completed;
    return preferences;
  }

  const transaction = database.transaction(
    [preferenceStoreName, presetStoreName, assetMetadataStoreName],
    "readwrite",
  );
  const completed = transactionCompletion(transaction);
  const presetRequest = transaction.objectStore(presetStoreName).get(presetId) as IDBRequest<unknown>;
  const assetsRequest = transaction.objectStore(assetMetadataStoreName).getAll() as IDBRequest<WallpaperAssetMetadata[]>;
  let preset: WallpaperPreset | null | undefined;
  let assets: WallpaperAssetMetadata[] | undefined;
  let operationError: Error | null = null;
  let preferences: WallpaperPreferences | null = null;
  const writeIfReady = () => {
    if (preset === undefined || assets === undefined) return;
    try {
      if (!preset) throw new Error("找不到要应用的壁纸方案。");
      const next = normalizeWallpaperPreferences(preset.preferences);
      const available = new Set([...builtInIds, ...assets.map((asset) => asset.id)]);
      const missing = wallpaperIdsInPreferences(next).filter((id) => !available.has(id));
      if (missing.length > 0) {
        throw new Error("此方案引用的壁纸不在图库中；请更新或删除该方案后再应用。");
      }
      const store = transaction.objectStore(preferenceStoreName);
      for (const { id: module } of wallpaperModules) {
        store.put({ module, ...next[module] });
      }
      preferences = next;
    } catch (error) {
      operationError = error instanceof Error ? error : new Error("无法应用壁纸方案。");
      transaction.abort();
    }
  };
  presetRequest.onsuccess = () => {
    preset = normalizeWallpaperPreset(presetRequest.result);
    writeIfReady();
  };
  assetsRequest.onsuccess = () => {
    assets = assetsRequest.result;
    writeIfReady();
  };
  presetRequest.onerror = () => transaction.abort();
  assetsRequest.onerror = () => transaction.abort();
  try {
    await completed;
  } catch (error) {
    throw operationError ?? error;
  }
  if (!preferences) throw new Error("无法应用壁纸方案。");
  return preferences;
}

function withoutWallpaperAssets(
  preferences: WallpaperPreferences,
  ids: Set<string>,
): WallpaperPreferences {
  const next = normalizeWallpaperPreferences(preferences);
  for (const { id: module } of wallpaperModules) {
    const current = next[module];
    const wallpaperIds = current.wallpaperIds.filter((id) => !ids.has(id));
    const surfaces = { ...current.surfaces };
    for (const surface of wallpaperSurfacesForModule(module)) {
      const preference = surfaces[surface.id] ?? defaultWallpaperSurfacePreference();
      const remaining = preference.wallpaperIds.filter((id) => !ids.has(id));
      if (remaining.length === preference.wallpaperIds.length) continue;
      surfaces[surface.id] = {
        ...preference,
        wallpaperIds: remaining,
        cycleDaily: remaining.length > 1 && preference.cycleDaily,
      };
    }
    next[module] = {
      ...current,
      wallpaperIds,
      cycleDaily: wallpaperIds.length > 1 && current.cycleDaily,
      surfaces,
    };
  }
  return next;
}

export async function deleteWallpaperAssets(
  wallpaperIds: string[],
): Promise<{ preferences: WallpaperPreferences; presets: WallpaperPreset[] }> {
  const ids = new Set(wallpaperIds.filter((id) => !builtInIds.has(id)));
  if (ids.size === 0) {
    const [preferences, presets] = await Promise.all([
      loadWallpaperPreferences(),
      loadWallpaperPresets(),
    ]);
    return { preferences, presets };
  }

  const database = await openDatabase();
  const transaction = database.transaction(
    [
      preferenceStoreName,
      presetStoreName,
      assetMetadataStoreName,
      assetFilesStoreName,
      assetThumbnailsStoreName,
    ],
    "readwrite",
  );
  const completed = transactionCompletion(transaction);
  const preferenceStore = transaction.objectStore(preferenceStoreName);
  const presetStore = transaction.objectStore(presetStoreName);
  const metadataStore = transaction.objectStore(assetMetadataStoreName);
  const filesStore = transaction.objectStore(assetFilesStoreName);
  const thumbnailsStore = transaction.objectStore(assetThumbnailsStoreName);
  const preferencesRequest = preferenceStore.getAll() as IDBRequest<
    Array<{ module: unknown } & Partial<WallpaperPreference>>
  >;
  let preferences = defaultWallpaperPreferences();
  let presets: WallpaperPreset[] = [];
  preferencesRequest.onsuccess = () => {
    const presetsRequest = presetStore.getAll() as IDBRequest<unknown[]>;
    presetsRequest.onsuccess = () => {
      try {
        const current = defaultWallpaperPreferences();
        for (const record of preferencesRequest.result) {
          if (!isWallpaperModule(record.module)) continue;
          current[record.module] = normalizeWallpaperPreference(record.module, record);
        }
        preferences = withoutWallpaperAssets(current, ids);
        if (!wallpaperPreferencesEqual(current, preferences)) {
          for (const { id: module } of wallpaperModules) {
            preferenceStore.put({ module, ...preferences[module] });
          }
        }

        presets = presetsRequest.result
          .map(normalizeWallpaperPreset)
          .filter((preset): preset is WallpaperPreset => !!preset)
          .map((preset) => {
            const next = withoutWallpaperAssets(preset.preferences, ids);
            if (wallpaperPreferencesEqual(preset.preferences, next)) return preset;
            const updated = { ...preset, preferences: next, updatedAt: Date.now() };
            presetStore.put({
              ...updated,
              nameKey: updated.name.toLowerCase(),
            } satisfies WallpaperPresetRecord);
            return updated;
          })
          .sort((left, right) => right.updatedAt - left.updatedAt);

        for (const id of ids) {
          metadataStore.delete(id);
          filesStore.delete(id);
          thumbnailsStore.delete(id);
        }
      } catch {
        transaction.abort();
      }
    };
    presetsRequest.onerror = () => transaction.abort();
  };
  preferencesRequest.onerror = () => transaction.abort();
  await completed;
  return { preferences, presets };
}

export async function resetWallpaper(
  target: WallpaperAssignmentTargetId,
): Promise<WallpaperPreferences> {
  const module = wallpaperModuleForTarget(target);
  return updateWallpaperModulePreference(module, (current) =>
    isWallpaperModule(target)
      ? {
          ...defaultWallpaperPreference(module),
          surfaces: current.surfaces,
        }
      : {
          ...current,
          surfaces: {
            ...current.surfaces,
            [target]: defaultWallpaperSurfacePreference(),
          },
        },
  );
}
