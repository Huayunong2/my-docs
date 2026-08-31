import { readLocalStorage, removeLocalStorage, writeLocalStorage } from "./storage";

const knowledgeDraftPrefix = "daily-summary:knowledge-draft:";
const inSessionDrafts = new Map<string, string>();

export type KnowledgeDraftSnapshot<T> = {
  cardId: string | null;
  draft: T;
  relatedIds: string[];
  savedAt: number;
  baseUpdatedAt?: string;
};

export function knowledgeDraftStorageKey(cardId?: string | null) {
  return `${knowledgeDraftPrefix}${cardId || "new"}`;
}

export function readKnowledgeDraft<T>(cardId?: string | null): KnowledgeDraftSnapshot<T> | null {
  const key = knowledgeDraftStorageKey(cardId);
  const raw = readLocalStorage(key) || inSessionDrafts.get(key) || null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<KnowledgeDraftSnapshot<T>>;
    if (!parsed || typeof parsed !== "object" || !parsed.draft || typeof parsed.savedAt !== "number") return null;
    return {
      cardId: typeof parsed.cardId === "string" ? parsed.cardId : null,
      draft: parsed.draft as T,
      relatedIds: Array.isArray(parsed.relatedIds) ? parsed.relatedIds.filter((id): id is string => typeof id === "string") : [],
      savedAt: parsed.savedAt,
      baseUpdatedAt: typeof parsed.baseUpdatedAt === "string" ? parsed.baseUpdatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function writeKnowledgeDraft<T>(cardId: string | null | undefined, snapshot: Omit<KnowledgeDraftSnapshot<T>, "cardId" | "savedAt"> & { savedAt?: number }) {
  const key = knowledgeDraftStorageKey(cardId);
  const serialized = JSON.stringify({
    cardId: cardId || null,
    draft: snapshot.draft,
    relatedIds: snapshot.relatedIds || [],
    savedAt: snapshot.savedAt || Date.now(),
    baseUpdatedAt: snapshot.baseUpdatedAt,
  } satisfies KnowledgeDraftSnapshot<T>);
  inSessionDrafts.set(key, serialized);
  return writeLocalStorage(key, serialized) || true;
}

export function removeKnowledgeDraft(cardId?: string | null) {
  const key = knowledgeDraftStorageKey(cardId);
  inSessionDrafts.delete(key);
  removeLocalStorage(key);
}
