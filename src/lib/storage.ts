type BrowserStorageKind = "local" | "session";

function getStorage(kind: BrowserStorageKind): Storage | null {
  try {
    return kind === "local" ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function readLocalStorage(key: string): string | null {
  const storage = getStorage("local");
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string): boolean {
  const storage = getStorage("local");
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeLocalStorage(key: string): void {
  try {
    getStorage("local")?.removeItem(key);
  } catch {
    // 隐私模式或存储配额限制不应阻断主流程。
  }
}

export function readSessionStorage(key: string): string | null {
  const storage = getStorage("session");
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSessionStorage(key: string, value: string): boolean {
  const storage = getStorage("session");
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeSessionStorage(key: string): void {
  try {
    getStorage("session")?.removeItem(key);
  } catch {
    // 隐私模式下 sessionStorage 可能不可用。
  }
}
