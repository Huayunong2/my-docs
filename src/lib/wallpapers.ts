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
export type WallpaperSource = "none" | "anime-night" | "custom";
export type WallpaperPreference = {
  source: WallpaperSource;
  overlay: number;
};
export type WallpaperPreferences = Record<WallpaperModule, WallpaperPreference>;
export type WallpaperImageTarget = "desktop" | "mobile";
export type WallpaperImageRecord = {
  module: WallpaperModule;
  desktopBlob?: Blob;
  desktopName?: string;
  mobileBlob?: Blob;
  mobileName?: string;
};

const databaseName = "daily-summary-wallpapers";
const databaseVersion = 1;
const preferenceStoreName = "preferences";
const imageStoreName = "images";
const defaultOverlay = 64;
const minOverlay = 45;
const maxOverlay = 85;

let databasePromise: Promise<IDBDatabase> | null = null;

export function defaultWallpaperPreference(
  module: WallpaperModule,
): WallpaperPreference {
  return {
    source: module === "stats" ? "anime-night" : "none",
    overlay: defaultOverlay,
  };
}

export function defaultWallpaperPreferences(): WallpaperPreferences {
  return Object.fromEntries(
    wallpaperModules.map(({ id }) => [id, defaultWallpaperPreference(id)]),
  ) as WallpaperPreferences;
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

export function normalizeWallpaperPreference(
  module: WallpaperModule,
  value: unknown,
): WallpaperPreference {
  const fallback = defaultWallpaperPreference(module);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<WallpaperPreference>;
  const source =
    candidate.source === "none" ||
    candidate.source === "anime-night" ||
    candidate.source === "custom"
      ? candidate.source
      : fallback.source;
  const overlay =
    typeof candidate.overlay === "number" && Number.isFinite(candidate.overlay)
      ? Math.min(maxOverlay, Math.max(minOverlay, Math.round(candidate.overlay)))
      : fallback.overlay;
  return { source, overlay };
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("当前环境不支持本地壁纸存储"));
  }
  if (databasePromise) return databasePromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = globalThis.indexedDB.open(databaseName, databaseVersion);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(preferenceStoreName)) {
        database.createObjectStore(preferenceStoreName, { keyPath: "module" });
      }
      if (!database.objectStoreNames.contains(imageStoreName)) {
        database.createObjectStore(imageStoreName, { keyPath: "module" });
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

export async function loadWallpaperPreferences(): Promise<WallpaperPreferences> {
  const database = await openDatabase();
  const transaction = database.transaction(preferenceStoreName, "readonly");
  const completed = transactionCompletion(transaction);
  const request = transaction
    .objectStore(preferenceStoreName)
    .getAll() as IDBRequest<Array<{ module: unknown; source?: unknown; overlay?: unknown }>>;
  const recordsPromise = new Promise<typeof request.result>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法读取壁纸设置"));
  });
  const [records] = await Promise.all([recordsPromise, completed]);

  const preferences = defaultWallpaperPreferences();
  for (const record of records) {
    if (!isWallpaperModule(record.module)) continue;
    preferences[record.module] = normalizeWallpaperPreference(
      record.module,
      record,
    );
  }
  return preferences;
}

export async function saveWallpaperPreference(
  module: WallpaperModule,
  preference: WallpaperPreference,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(preferenceStoreName, "readwrite");
  const completed = transactionCompletion(transaction);
  transaction.objectStore(preferenceStoreName).put({
    module,
    ...normalizeWallpaperPreference(module, preference),
  });
  await completed;
}

export async function saveWallpaperImage(
  module: WallpaperModule,
  target: WallpaperImageTarget,
  file: File,
  preference: WallpaperPreference,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [preferenceStoreName, imageStoreName],
    "readwrite",
  );
  const completed = transactionCompletion(transaction);
  const imageStore = transaction.objectStore(imageStoreName);
  const request = imageStore.get(module) as IDBRequest<WallpaperImageRecord | undefined>;
  request.onsuccess = () => {
    try {
      const previous = request.result ?? { module };
      const next: WallpaperImageRecord =
        target === "desktop"
          ? {
              ...previous,
              module,
              desktopBlob: file,
              desktopName: file.name,
            }
          : {
              ...previous,
              module,
              mobileBlob: file,
              mobileName: file.name,
            };
      imageStore.put(next);
      transaction
        .objectStore(preferenceStoreName)
        .put({ module, ...normalizeWallpaperPreference(module, { ...preference, source: "custom" }) });
    } catch {
      transaction.abort();
    }
  };
  await completed;
}

export async function loadWallpaperImage(
  module: WallpaperModule,
): Promise<WallpaperImageRecord | null> {
  const database = await openDatabase();
  const transaction = database.transaction(imageStoreName, "readonly");
  const completed = transactionCompletion(transaction);
  const request = transaction
    .objectStore(imageStoreName)
    .get(module) as IDBRequest<WallpaperImageRecord | undefined>;
  const recordPromise = new Promise<WallpaperImageRecord | null>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () =>
      reject(request.error ?? new Error("无法读取自定义壁纸"));
  });
  const [record] = await Promise.all([recordPromise, completed]);
  return record;
}

export async function resetWallpaper(
  module: WallpaperModule,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [preferenceStoreName, imageStoreName],
    "readwrite",
  );
  const completed = transactionCompletion(transaction);
  transaction
    .objectStore(preferenceStoreName)
    .put({ module, ...defaultWallpaperPreference(module) });
  transaction.objectStore(imageStoreName).delete(module);
  await completed;
}
